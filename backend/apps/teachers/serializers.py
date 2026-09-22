from rest_framework import serializers

from apps.teachers.models import Teacher


class TeacherSerializer(serializers.ModelSerializer):
    class Meta:
        model = Teacher
        fields = [
            "id",
            "teacher_id",
            "name",
            "email",
            "phone",
            "department",
            "designation",
            "qualification",
            "avatar",
            "status",
        ]