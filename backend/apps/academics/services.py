"""Academic business rules and timetable validation.

These mirror the frontend implementation exactly:
- ``assertTeacherSingleModulePerSemester`` (Phase 1, ``academicRules.ts``)
- ``checkConflicts`` for timetable slots (``timetableService.ts``)

They are enforced in the backend service/serializer/API layer so the rules
hold regardless of which frontend path (or direct API call) created the data.
"""
from django.core.exceptions import ValidationError
from django.db.models import Q

from apps.academics.models import AssignmentStatus


def time_to_minutes(value) -> int:
    if isinstance(value, str):
        hh, mm = value.split(":")
        return int(hh) * 60 + int(mm)
    return value.hour * 60 + value.minute


def times_overlap(start_a, end_a, start_b, end_b) -> bool:
    return max(time_to_minutes(start_a), time_to_minutes(start_b)) < min(
        time_to_minutes(end_a), time_to_minutes(end_b)
    )


def participating_section_ids(section, section_ids):
    """Normalize participating sections the way the frontend does."""
    if section_ids:
        return [int(s) for s in section_ids]
    if section is not None:
        return [section.pk]
    return []


def distinct_subjects_for_teacher_in_semester(
    teacher,
    semester,
    exclude_timetable_slot_id=None,
    exclude_assignment_id=None,
    exclude_teaching_session_id=None,
):
    """Distinct subjects a teacher teaches in a semester.

    Mirrors ``getDistinctSubjectsForTeacherInSemester``: the union of subjects
    from active assignments, teaching sessions and timetable slots.
    """
    from apps.academics.models import TeachingSession, TimetableSlot

    subject_ids = set()

    assignments = teacher.assignments.filter(
        semester=semester, status=AssignmentStatus.ACTIVE
    )
    if exclude_assignment_id:
        assignments = assignments.exclude(id=exclude_assignment_id)
    subject_ids.update(assignments.values_list("subject_id", flat=True))

    sessions = TeachingSession.objects.filter(teacher=teacher, semester=semester)
    if exclude_teaching_session_id:
        sessions = sessions.exclude(id=exclude_teaching_session_id)
    subject_ids.update(sessions.values_list("subject_id", flat=True))

    slots = TimetableSlot.objects.filter(teacher=teacher, semester=semester)
    if exclude_timetable_slot_id:
        slots = slots.exclude(id=exclude_timetable_slot_id)
    subject_ids.update(slots.values_list("subject_id", flat=True))

    return subject_ids


def assert_teacher_single_module_per_semester(
    teacher,
    subject,
    semester,
    exclude_timetable_slot_id=None,
    exclude_assignment_id=None,
    exclude_teaching_session_id=None,
):
    """Reject assigning a teacher a *different* subject in one semester.

    Mirrors ``assertTeacherSingleModulePerSemester`` in ``academicRules.ts``.
    """
    existing_ids = distinct_subjects_for_teacher_in_semester(
        teacher,
        semester,
        exclude_timetable_slot_id=exclude_timetable_slot_id,
        exclude_assignment_id=exclude_assignment_id,
        exclude_teaching_session_id=exclude_teaching_session_id,
    )
    if subject.pk in existing_ids:
        return
    if existing_ids:
        from apps.academics.models import Subject

        names = ", ".join(
            f'"{s.name}"' for s in Subject.objects.filter(id__in=existing_ids)
        )
        raise ValidationError(
            f"Business rule violation: {teacher.name} is already assigned to "
            f"{names} in this semester. A teacher may teach only one module per "
            f"semester, so {subject.name} cannot be assigned."
        )


def check_timetable_conflicts(
    *,
    semester,
    teacher,
    section,
    section_ids,
    day,
    start_time,
    end_time,
    room,
    class_type,
    exclude_slot_id=None,
):
    """Return the first conflict reason for a timetable slot, or None.

    Mirrors ``checkConflicts``: teacher collision, venue collision, section
    collision across all participating sections, and the practical-only-single
    section rule.
    """
    from apps.academics.models import SubjectType, TimetableSlot

    target_sections = participating_section_ids(section, section_ids)

    reasons = []

    same_day = TimetableSlot.objects.filter(
        day=day, semester=semester
    ).exclude(id=exclude_slot_id)

    teacher_name = teacher.name

    teacher_conflict = (
        same_day.filter(teacher=teacher)
        .filter(start_time__lt=end_time, end_time__gt=start_time)
        .first()
    )
    if teacher_conflict:
        reasons.append(
            f"Teacher {teacher_name} already has a scheduled class "
            f"({teacher_conflict.subject.name}, {teacher_conflict.section.name}) "
            f"from {teacher_conflict.start_time:%H:%M} to "
            f"{teacher_conflict.end_time:%H:%M} on {day}."
        )

    if room and room.strip():
        room_conflict = (
            same_day.filter(room__iexact=room.strip())
            .filter(start_time__lt=end_time, end_time__gt=start_time)
            .first()
        )
        if room_conflict:
            reasons.append(
                f'Classroom/Hall "{room}" is already booked by '
                f"{room_conflict.teacher.name} for {room_conflict.subject.name} "
                f"from {room_conflict.start_time:%H:%M} to "
                f"{room_conflict.end_time:%H:%M} on {day}."
            )

    for sec_id in target_sections:
        section_conflict = (
            same_day.filter(
                Q(sections=sec_id) | Q(section_id=sec_id)
            )
            .filter(start_time__lt=end_time, end_time__gt=start_time)
            .first()
        )
        if section_conflict:
            sec = section.__class__.objects.filter(pk=sec_id).first()
            reasons.append(
                f'Participating Section "{sec.name if sec else sec_id}" already '
                f"has a scheduled {section_conflict.class_type} "
                f"({section_conflict.subject.name}) from "
                f"{section_conflict.start_time:%H:%M} to "
                f"{section_conflict.end_time:%H:%M} on {day}."
            )
            break

    if class_type == SubjectType.PRACTICAL and len(target_sections) > 1:
        reasons.append(
            "Practical classes are configured for single-section lab "
            "allocation. Combined teaching groups should be conducted as "
            "Lectures or configured with lab sub-batches."
        )

    return reasons[0] if reasons else None


def validate_semester_consistency(*, semester=None, section=None, subject=None):
    errors = {}
    if subject and semester and subject.semester_id != semester.pk:
        errors["subject"] = "Subject does not belong to the selected semester."
    if section and semester and section.semester_id != semester.pk:
        errors["section"] = "Section does not belong to the selected semester."
    if errors:
        raise ValidationError(errors)