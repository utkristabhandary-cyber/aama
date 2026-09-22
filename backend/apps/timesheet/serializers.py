from django.utils import timezone

from rest_framework import serializers

from apps.academics.models import Section, Semester, Subject
from apps.teachers.models import Teacher

from .models import TimesheetEntry, TimesheetEntryType
from .services import holiday_on


class TimesheetEntrySerializer(serializers.ModelSerializer):
    """Timesheet entry payload.

    Every rule here is server-authoritative:

    - ``teacher`` is writable only for admins; a teacher role is forced to
      their own ``teacher_profile`` in the view (never client-supplied).
    - ``duration_minutes`` is computed by the model from ``start_time`` /
      ``end_time`` — a client duration is never accepted.
    - CLASS entries require a subject + at least one section all in the
      subject's semester; the semester is derived, never client-chosen.
    - DUTY/OTHER entries forbid subject/sections.
    - Future dates are rejected; holidays are surfaced, not blocked.
    """

    teacher = serializers.PrimaryKeyRelatedField(
        queryset=Teacher.objects.all(), required=False
    )
    teacher_name = serializers.CharField(source="teacher.name", read_only=True)
    subject = serializers.PrimaryKeyRelatedField(
        queryset=Subject.objects.all(), required=False, allow_null=True
    )
    semester = serializers.PrimaryKeyRelatedField(
        queryset=Semester.objects.all(), required=False, allow_null=True
    )
    section_ids = serializers.PrimaryKeyRelatedField(
        source="sections",
        queryset=Section.objects.all(),
        many=True,
        required=False,
        allow_empty=True,
    )
    duration_minutes = serializers.SerializerMethodField()
    is_holiday = serializers.SerializerMethodField()
    holiday_title = serializers.SerializerMethodField()
    subject_code = serializers.SerializerMethodField()
    subject_name = serializers.SerializerMethodField()
    semester_name = serializers.SerializerMethodField()
    section_names = serializers.SerializerMethodField()

    class Meta:
        model = TimesheetEntry
        fields = [
            "id",
            "teacher",
            "teacher_name",
            "entry_date",
            "type",
            "subject",
            "subject_code",
            "subject_name",
            "section_ids",
            "sections",
            "section_names",
            "semester",
            "semester_name",
            "start_time",
            "end_time",
            "duration_minutes",
            "note",
            "status",
            "rejection_reason",
            "is_holiday",
            "holiday_title",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "sections",
            "status",
            "rejection_reason",
            "created_at",
            "updated_at",
        ]

    def get_subject_code(self, obj):
        return obj.subject.code if obj.subject_id else ""

    def get_subject_name(self, obj):
        return obj.subject.name if obj.subject_id else ""

    def get_semester_name(self, obj):
        return obj.semester.name if obj.semester_id else ""

    def get_duration_minutes(self, obj):
        return obj.duration_minutes

    def get_section_names(self, obj):
        return [section.name for section in obj.sections.all()]

    def get_is_holiday(self, obj):
        return holiday_on(obj.entry_date) is not None

    def get_holiday_title(self, obj):
        holiday = holiday_on(obj.entry_date)
        return holiday.title if holiday else ""

    def validate(self, attrs):
        instance = getattr(self, "instance", None)

        entry_type = attrs.get("type")
        subject = attrs.get("subject")
        sections = attrs.get("sections")
        semester = attrs.get("semester")
        start_time = attrs.get("start_time")
        end_time = attrs.get("end_time")
        entry_date = attrs.get("entry_date")

        if instance is not None:
            entry_type = entry_type or instance.type
            if subject is None:
                subject = instance.subject
            if sections is None:
                sections = list(instance.sections.all())
            if semester is None:
                semester = instance.semester
            if start_time is None:
                start_time = instance.start_time
            if end_time is None:
                end_time = instance.end_time
            if entry_date is None:
                entry_date = instance.entry_date
        else:
            entry_type = entry_type or TimesheetEntryType.CLASS

        if start_time and end_time and end_time <= start_time:
            raise serializers.ValidationError(
                {"end_time": "End time must be after start time."}
            )

        if entry_type == TimesheetEntryType.CLASS:
            if subject is None:
                raise serializers.ValidationError(
                    {"subject": "Subject is required for class entries."}
                )
            if subject.semester_id is None:
                raise serializers.ValidationError(
                    {"subject": "The selected subject has no semester."}
                )
            sections = list(sections or [])
            if not sections:
                raise serializers.ValidationError(
                    {"section_ids": "At least one section is required for class entries."}
                )
            for section in sections:
                if section.semester_id != subject.semester_id:
                    raise serializers.ValidationError(
                        {
                            "section_ids": (
                                "All sections must belong to the same semester as "
                                "the selected subject."
                            )
                        }
                    )
            attrs["semester"] = subject.semester
        else:
            if subject is not None:
                raise serializers.ValidationError(
                    {"subject": "Subject is only allowed for class entries."}
                )
            if sections:
                raise serializers.ValidationError(
                    {"section_ids": "Sections are only allowed for class entries."}
                )

        if entry_date is not None and entry_date > timezone.localdate():
            raise serializers.ValidationError(
                {"entry_date": "Entry date cannot be in the future."}
            )

        return attrs