from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.academics.models import AssignmentStatus, TeacherAssignment
from apps.accounts.permissions import AdminOrTeacherRead
from apps.students.models import Student
from apps.students.serializers import StudentSerializer


class StudentViewSet(viewsets.ModelViewSet):
    queryset = Student.objects.select_related("section", "semester").all()
    serializer_class = StudentSerializer
    permission_classes = [AdminOrTeacherRead]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "email", "student_id", "roll_no"]
    ordering_fields = ["name", "roll_no"]

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def me(self, request):
        student = getattr(request.user, "student_profile", None)
        if student is None:
            raise NotFound("No student profile is linked to this account.")
        return Response(self.get_serializer(student).data)

    def get_queryset(self):
        if self.request.user.role == "teacher":
            teacher = getattr(self.request.user, "teacher_profile", None)
            if teacher is None:
                return self.queryset.none()
            assigned_sections = TeacherAssignment.objects.filter(
                teacher=teacher, status=AssignmentStatus.ACTIVE
            ).values_list("section_id", flat=True)
            return self.queryset.filter(section_id__in=assigned_sections)
        queryset = self.queryset
        section_id = self.request.query_params.get("section")
        semester_id = self.request.query_params.get("semester")
        status = self.request.query_params.get("status")
        if section_id:
            queryset = queryset.filter(section_id=section_id)
        if semester_id:
            queryset = queryset.filter(semester_id=semester_id)
        if status:
            queryset = queryset.filter(status=status)
        return queryset