"""Server-backed AAMS data exports (Phase H).

Real database rows, rendered by the server, authorized server-side (the
endpoints are admin-only). Every export header is an alias of its importer so
an exported workbook round-trips back into the preview/confirm pipeline for a
deterministic result (new / update / unchanged — never a mystery).

Honesty rules:

- No fabricated data: an empty database exports a headers-only workbook.
- Student export deliberately mirrors import-relevant canonical columns —
  ``Avatar``, account-only fields and B.S.-date/gender informational columns
  are NOT emitted because they are not importable.
- The timetable export renders participating section names delimited with
  ``+`` (the exact combined-section syntax the importer parses) and writes
  full weekday names and ``HH:MM`` times so the file re-imports cleanly.
"""
import io

import openpyxl

from apps.academics.models import TimetableSlot
from apps.imports.contracts import (
    STUDENT_EXPORT_FILENAME,
    TEACHER_EXPORT_FILENAME,
    TIMETABLE_EXPORT_FILENAME,
)
from apps.students.models import Student
from apps.teachers.models import Teacher

# Canonical AAMS export headers — each maps back into the importer aliases
# (see student_import.FIELD_ALIASES / teacher_import.FIELD_ALIASES /
# timetable_import.FIELD_ALIASES).
STUDENT_EXPORT_HEADERS = [
    "Student ID",
    "Roll Number",
    "Name",
    "Email",
    "Phone",
    "DOB (A.D.)",
    "Admission Year",
    "Status",
    "Program/Sec.",
    "Year/Semester",
    "Address",
    "Guardian Name",
    "Guardian Phone",
]

TEACHER_EXPORT_HEADERS = [
    "Teacher ID",
    "Name",
    "Email",
    "Phone",
    "Department",
    "Designation",
    "Qualification",
    "Status",
]

TIMETABLE_EXPORT_HEADERS = [
    "Semester",
    "Section",
    "Day",
    "Start Time",
    "End Time",
    "Module Code",
    "Module Title",
    "Teacher ID",
    "Lecturer",
    "Class Type",
    "Room",
]


def _workbook_bytes(headers, rows):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Export"
    sheet.append(headers)
    for cell in sheet[1]:
        cell.font = openpyxl.styles.Font(bold=True)
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer.getvalue()


def _timestamp(value):
    return value.strftime("%H:%M") if value else ""


def build_student_export_bytes():
    """Export the real student roster (server-side, deterministic order)."""
    rows = []
    students = Student.objects.select_related("section", "semester").order_by(
        "name", "student_id"
    )
    for student in students:
        rows.append([
            student.student_id,
            student.roll_no,
            student.name,
            student.email,
            student.phone,
            student.dob.isoformat() if student.dob else "",
            student.admission_year if student.admission_year is not None else "",
            student.status,
            student.section.name if student.section_id else "",
            student.semester.code if student.semester_id else "",
            student.address,
            student.guardian_name,
            student.guardian_phone,
        ])
    return _workbook_bytes(STUDENT_EXPORT_HEADERS, rows)


def build_teacher_export_bytes():
    """Export the real teacher roster (server-side, deterministic order)."""
    rows = []
    teachers = Teacher.objects.order_by("name", "teacher_id")
    for teacher in teachers:
        rows.append([
            teacher.teacher_id,
            teacher.name,
            teacher.email,
            teacher.phone,
            teacher.department,
            teacher.designation,
            teacher.qualification,
            teacher.status,
        ])
    return _workbook_bytes(TEACHER_EXPORT_HEADERS, rows)


def build_timetable_export_bytes():
    """Export the real timetable (server-side, deterministic order).

    Combined slots write every participating section name joined with ``+`` —
    the exact expression the importer's ``expand_combined_sections`` parses —
    so a combined timetable round-trips without inventing a section.
    """
    rows = []
    slots = (
        TimetableSlot.objects.select_related("semester", "subject", "teacher", "section")
        .prefetch_related("sections")
        .order_by("day", "start_time", "semester__code", "section__name")
    )
    for slot in slots:
        names = sorted(
            {s.name for s in slot.sections.all()} | {slot.section.name}
        )
        section_expr = "+".join(names)
        rows.append([
            slot.semester.code,
            section_expr,
            slot.day,
            _timestamp(slot.start_time),
            _timestamp(slot.end_time),
            slot.subject.code,
            slot.subject.name,
            slot.teacher.teacher_id,
            slot.teacher.name,
            slot.class_type,
            slot.room,
        ])
    return _workbook_bytes(TIMETABLE_EXPORT_HEADERS, rows)


EXPORT_BUILDERS = {
    "students": build_student_export_bytes,
    "teachers": build_teacher_export_bytes,
    "timetable": build_timetable_export_bytes,
}

EXPORT_FILENAMES = {
    "students": STUDENT_EXPORT_FILENAME,
    "teachers": TEACHER_EXPORT_FILENAME,
    "timetable": TIMETABLE_EXPORT_FILENAME,
}