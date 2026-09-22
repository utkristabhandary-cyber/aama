from datetime import date

from django.contrib.auth import get_user_model

from rest_framework.test import APITestCase

from apps.academics.models import (
    AssignmentStatus,
    Semester,
    SemesterStatus,
    Section,
    Subject,
    SubjectType,
    TeacherAssignment,
)
from apps.accounts.models import Role
from apps.students.models import Student
from apps.teachers.models import Teacher

User = get_user_model()


class IdentityFixture(APITestCase):
    def setUp(self):
        self.semester = Semester.objects.create(
            code="SEM-IDENT",
            name="Identity",
            academic_year="2025-2026",
            start_date=date(2026, 1, 12),
            end_date=date(2026, 5, 22),
            status=SemesterStatus.ACTIVE,
        )
        self.section = Section.objects.create(
            semester=self.semester, name="A", capacity=5
        )
        self.other_section = Section.objects.create(
            semester=self.semester, name="B", capacity=5
        )
        self.subject = Subject.objects.create(
            semester=self.semester,
            code="ID1",
            name="Identity Subject",
            type=SubjectType.LECTURE,
        )

        self.teacher_user = User.objects.create_user(
            username="tch-ident",
            email="teacher@ident.local",
            password="Passw0rd!",
            role=Role.TEACHER,
        )
        self.teacher = Teacher.objects.create(
            teacher_id="tch-ident", name="Dr. Identity", email=self.teacher_user.email
        )
        self.teacher_user.teacher_profile = self.teacher
        self.teacher_user.save(update_fields=["teacher_profile"])
        self.assignment = TeacherAssignment.objects.create(
            teacher=self.teacher,
            semester=self.semester,
            section=self.section,
            subject=self.subject,
            status=AssignmentStatus.ACTIVE,
        )

        self.student_user = User.objects.create_user(
            username="std-ident",
            email="student@ident.local",
            password="Passw0rd!",
            role=Role.STUDENT,
        )
        self.student = Student.objects.create(
            student_id="std-ident",
            roll_no="01",
            name="Identity Student",
            email=self.student_user.email,
            section=self.section,
            semester=self.semester,
        )
        self.student_user.student_profile = self.student
        self.student_user.save(update_fields=["student_profile"])

        self.admin_user = User.objects.create_user(
            username="admin-ident",
            email="admin@ident.local",
            password="Passw0rd!",
            role=Role.ADMIN,
        )


class TeacherMeTests(IdentityFixture):
    def test_teacher_me_returns_own_profile(self):
        self.client.force_authenticate(user=self.teacher_user)
        response = self.client.get("/api/teachers/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["teacher_id"], "tch-ident")
        self.assertEqual(response.data["name"], "Dr. Identity")

    def test_admin_me_returns_404_without_teacher_profile(self):
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get("/api/teachers/me/")
        self.assertEqual(response.status_code, 404)

    def test_student_me_returns_404_without_teacher_profile(self):
        self.client.force_authenticate(user=self.student_user)
        response = self.client.get("/api/teachers/me/")
        self.assertEqual(response.status_code, 404)


class StudentMeTests(IdentityFixture):
    def test_student_me_returns_own_profile(self):
        self.client.force_authenticate(user=self.student_user)
        response = self.client.get("/api/students/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["student_id"], "std-ident")
        self.assertEqual(response.data["section_name"], "A")

    def test_admin_me_returns_404_without_student_profile(self):
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get("/api/students/me/")
        self.assertEqual(response.status_code, 404)


class TeacherScopingTests(IdentityFixture):
    def _auth_as(self, user):
        self.client.force_authenticate(user=user)

    def test_teacher_assignments_scoped_to_self(self):
        # Admin creates an assignment for a different teacher.
        other_teacher = Teacher.objects.create(
            teacher_id="tch-other", name="Other", email="other@ident.local"
        )
        TeacherAssignment.objects.create(
            teacher=other_teacher,
            semester=self.semester,
            section=self.section,
            subject=self.subject,
            status=AssignmentStatus.ACTIVE,
        )
        self._auth_as(self.teacher_user)
        # Even an explicit ?teacher= targeting another teacher is ignored.
        response = self.client.get("/api/academics/assignments/", {"teacher": other_teacher.pk})
        self.assertEqual(response.status_code, 200)
        ids = [a["id"] for a in response.data["results"]]
        self.assertIn(self.assignment.pk, ids)
        self.assertEqual(len(ids), 1)
        self.assertEqual(response.data["results"][0]["teacher"], self.teacher.pk)

    def test_admin_can_scope_assignments_by_teacher(self):
        self._auth_as(self.admin_user)
        response = self.client.get("/api/academics/assignments/", {"teacher": self.teacher.pk})
        self.assertEqual(response.status_code, 200)
        ids = [a["id"] for a in response.data["results"]]
        self.assertEqual(ids, [self.assignment.pk])

    def test_teacher_assignments_ignores_probe_for_other_teacher(self):
        other_teacher = Teacher.objects.create(
            teacher_id="tch-probe", name="Probe", email="probe@ident.local"
        )
        TeacherAssignment.objects.create(
            teacher=other_teacher,
            semester=self.semester,
            section=self.section,
            subject=self.subject,
            status=AssignmentStatus.ACTIVE,
        )
        self._auth_as(self.teacher_user)
        response = self.client.get("/api/academics/assignments/", {"teacher": other_teacher.pk})
        self.assertEqual(response.status_code, 200)
        ids = [a["id"] for a in response.data["results"]]
        self.assertNotIn(other_teacher.pk, [a["teacher"] for a in response.data["results"]])
        self.assertEqual(response.data["results"][0]["teacher"], self.teacher.pk)
