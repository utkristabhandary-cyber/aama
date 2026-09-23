from datetime import date

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.academics.models import (
    AssignmentStatus,
    DayOfWeek,
    Holiday,
    HolidayType,
    Section,
    Semester,
    SemesterStatus,
    Subject,
    SubjectType,
    TeacherAssignment,
    TeachingSession,
    TimetableSlot,
)
from apps.accounts.models import Role, User
from apps.notifications.models import Notification
from apps.students.models import Student
from apps.teachers.models import Teacher

DEMO_PASSWORD = "AaMS@#2026!"


class Command(BaseCommand):
    """Seed a small, idempotent, non-destructive demo dataset."""

    help = "Seed demo data mirroring the frontend Phase 1 dataset (safe to re-run)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--quiet",
            action="store_true",
            help=(
                "Suppress the demo password in stdout. Intended for "
                "deployment build logs (e.g. Render), where stdout is "
                "persisted. Default output is unchanged."
            ),
        )

    @transaction.atomic
    def handle(self, *args, **options):
        semester, _ = Semester.objects.get_or_create(
            code="SEM-S4",
            defaults={
                "name": "Semester 4",
                "academic_year": "2025-2026",
                "start_date": date(2026, 1, 12),
                "end_date": date(2026, 5, 22),
                "status": SemesterStatus.ACTIVE,
            },
        )
        section_a, _ = Section.objects.get_or_create(
            semester=semester,
            name="A",
            defaults={"capacity": 60, "room": "T-301"},
        )
        section_b, _ = Section.objects.get_or_create(
            semester=semester,
            name="B",
            defaults={"capacity": 60, "room": "T-302"},
        )

        admin_user, _ = User.objects.get_or_create(
            email="admin@aams.local",
            defaults={"role": Role.ADMIN, "name": "System Admin", "username": "admin"},
        )
        admin_user.username = "admin"
        admin_user.set_password(DEMO_PASSWORD)
        admin_user.is_staff = True
        admin_user.is_superuser = True
        admin_user.is_active = True
        admin_user.save()

        teacher_c = Teacher.objects.get_or_create(
            teacher_id="tch-3",
            defaults={
                "name": "Dr. R. Kumar",
                "email": "r.prof@aams.local",
                "department": "Computer Science",
                "designation": "Associate Professor",
            },
        )[0]
        teacher_a = Teacher.objects.get_or_create(
            teacher_id="tch-1",
            defaults={"name": "Dr. A. Sharma", "email": "a.prof@aams.local", "department": "Computer Science"},
        )[0]
        teacher_b = Teacher.objects.get_or_create(
            teacher_id="tch-2",
            defaults={"name": "Dr. B. Gupta", "email": "b.prof@aams.local", "department": "Computer Science"},
        )[0]

        for t in (teacher_c, teacher_a, teacher_b):
            user = User.objects.filter(email=t.email).first()
            if user is None:
                user = User(
                    email=t.email,
                    username=t.teacher_id,
                    name=t.name,
                    role=Role.TEACHER,
                    is_active=True,
                )
                user.set_password(DEMO_PASSWORD)
                user.save()
            else:
                user.username = t.teacher_id
            user.teacher_profile = t
            user.save(update_fields=["teacher_profile", "username"])

        subjects = {}
        subject_data = {
            "sub-101": ("COMP1", "Introduction to Programming", 5, SubjectType.LECTURE),
            "sub-202": ("MATH2", "Discrete Mathematics", 4, SubjectType.LECTURE),
            "sub-303": ("COMP3", "Database Systems", 4, SubjectType.LECTURE),
            "sub-404": ("LAB1", "Programming Lab", 1, SubjectType.PRACTICAL),
        }
        for code, (short_code, name, credits, stype) in subject_data.items():
            subjects[code], _ = Subject.objects.get_or_create(
                semester=semester,
                code=short_code,
                defaults={"name": name, "credits": credits, "type": stype},
            )

        students_by_section = {}
        student_names_a = [
            ("std-1", "101", "Ananya Verma", "ananya.v@aams.local"),
            ("std-2", "102", "Rohan Mehta", "rohan.m@aams.local"),
            ("std-3", "103", "Sneha Patil", "sneha.p@aams.local"),
        ]
        student_names_b = [
            ("std-4", "104", "Aditya Rao", "aditya.r@aams.local"),
            ("std-5", "105", "Ishita Sen", "ishita.s@aams.local"),
        ]
        for section, rows in ((section_a, student_names_a), (section_b, student_names_b)):
            students_by_section[section.pk] = []
            for student_id, roll_no, name, email in rows:
                student, _ = Student.objects.get_or_create(
                    student_id=student_id,
                    defaults={
                        "roll_no": roll_no,
                        "name": name,
                        "email": email,
                        "section": section,
                        "semester": semester,
                        "admission_year": 2025,
                    },
                )
                students_by_section[section.pk].append(student)
                user = User.objects.filter(email=email).first()
                if user is None:
                    user = User(
                        email=email,
                        username=student_id,
                        name=name,
                        role=Role.STUDENT,
                        is_active=True,
                    )
                    user.set_password(DEMO_PASSWORD)
                    user.save()
                else:
                    user.username = student_id
                user.student_profile = student
                user.save(update_fields=["student_profile", "username"])

        # Assignments: asg-6 -> teacher tch-3 mirrors the frontend.
        TeacherAssignment.objects.get_or_create(
            teacher=teacher_c,
            semester=semester,
            section=section_a,
            subject=subjects["sub-101"],
            defaults={"status": AssignmentStatus.ACTIVE},
        )
        TeacherAssignment.objects.get_or_create(
            teacher=teacher_c,
            semester=semester,
            section=section_b,
            subject=subjects["sub-101"],
            defaults={"status": AssignmentStatus.ACTIVE},
        )

        # Timetable: tt-17 -> tch-3 Monday 11:15-12:15.
        slot, _ = TimetableSlot.objects.get_or_create(
            semester=semester,
            section=section_a,
            subject=subjects["sub-101"],
            teacher=teacher_c,
            day=DayOfWeek.MONDAY,
            start_time="11:15",
            end_time="12:15",
            defaults={"room": "T-301"},
        )
        slot.is_combined = False
        slot.save(update_fields=["is_combined"])

        # Teaching session: ts-2 -> sub-101 (mirrors frontend teachingSessionId).
        TeachingSession.objects.get_or_create(
            semester=semester,
            subject=subjects["sub-101"],
            teacher=teacher_c,
            class_type=SubjectType.LECTURE,
            day=DayOfWeek.MONDAY,
            start_time="11:15",
            end_time="12:15",
            defaults={"room": "T-301", "is_combined": False},
        )

        td = date(2026, 4, 3)
        for name in ("Holi", "Good Friday"):
            Holiday.objects.get_or_create(
                date=td,
                title=name,
                defaults={"type": HolidayType.NATIONAL},
            )

        # Idempotent demo notifications so the Notification Center is populated.
        demo_usernames = ["admin", "tch-1", "tch-2", "tch-3", "std-1", "std-2", "std-3", "std-4", "std-5"]
        notified = 0
        for u in User.objects.filter(username__in=demo_usernames):
            _, created = Notification.objects.get_or_create(
                recipient=u,
                title="Welcome to AAMS Academic Portal",
                defaults={
                    "message": "Your institution has activated the Academic Attendance Management System for SEM-S4.",
                    "notification_type": "info",
                },
            )
            notified += 1 if created else 0
            _, created = Notification.objects.get_or_create(
                recipient=u,
                title="75% Attendance Compliance Reminder",
                defaults={
                    "message": "University regulations require 75% attendance to appear for semester examinations.",
                    "notification_type": "warning",
                },
            )
            notified += 1 if created else 0

        if options.get("quiet"):
            self.stdout.write(
                self.style.SUCCESS(
                    f"Seed complete for {semester.code} (teachers: 3, students: {sum(len(v) for v in students_by_section.values())}, subjects: {len(subjects)}, notifications created: {notified})."
                )
            )
            return
        self.stdout.write(
            self.style.SUCCESS(
                f"Seed complete for {semester.code} (teachers: 3, students: {sum(len(v) for v in students_by_section.values())}, subjects: {len(subjects)}, notifications created: {notified}). "
                f"All demo logins use password: {DEMO_PASSWORD}"
            )
        )