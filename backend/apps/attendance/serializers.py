from django.utils import timezone
from rest_framework import serializers

from apps.academics.models import Section
from apps.attendance.models import (
    AttendanceRecord,
    AttendanceSession,
    QRAttendanceSession,
)
from apps.students.serializers import StudentSerializer


class AttendanceRecordSerializer(serializers.ModelSerializer):
    student = StudentSerializer(read_only=True)

    class Meta:
        model = AttendanceRecord
        fields = [
            "id",
            "student",
            "status",
            "marking",
            "marking_complete",
            "submitted_at",
            "checked_in_at",
            "network_verification_method",
        ]


class AttendanceSessionSerializer(serializers.ModelSerializer):
    section_ids = serializers.PrimaryKeyRelatedField(
        source="sections", queryset=Section.objects.all(), many=True
    )
    teacher = serializers.PrimaryKeyRelatedField(read_only=True)
    is_combined = serializers.SerializerMethodField()
    is_finalized = serializers.SerializerMethodField()
    semester_id = serializers.SerializerMethodField()
    semester_name = serializers.SerializerMethodField()
    subject_code = serializers.SerializerMethodField()
    subject_name = serializers.SerializerMethodField()
    teacher_name = serializers.SerializerMethodField()
    section_names = serializers.SerializerMethodField()
    records = AttendanceRecordSerializer(many=True, read_only=True)

    class Meta:
        model = AttendanceSession
        fields = [
            "id",
            "session_date",
            "subject",
            "subject_code",
            "subject_name",
            "teacher",
            "teacher_name",
            "phase",
            "start_time",
            "planned_end_time",
            "end_time",
            "section_ids",
            "sections",
            "section_names",
            "is_combined",
            "is_finalized",
            "semester_id",
            "semester_name",
            "teaching_session",
            "attendance_ids",
            "marked_ids",
            "late_reason",
            "is_auto_present",
            "records",
            "submitted_at",
            "created_at",
        ]
        read_only_fields = [
            "sections",
            "section_names",
            "is_combined",
            "is_finalized",
            "semester_id",
            "semester_name",
            "subject_code",
            "subject_name",
            "teacher_name",
            "records",
            "attendance_ids",
            "marked_ids",
            "is_auto_present",
            "submitted_at",
            "created_at",
        ]

    def get_is_combined(self, obj):
        return obj.sections.count() > 1

    def get_is_finalized(self, obj):
        return obj.is_finalized

    def get_semester_id(self, obj):
        return obj.subject.semester_id

    def get_semester_name(self, obj):
        return obj.subject.semester.name

    def get_subject_code(self, obj):
        return obj.subject.code

    def get_subject_name(self, obj):
        return obj.subject.name

    def get_teacher_name(self, obj):
        return obj.teacher.name

    def get_section_names(self, obj):
        return list(obj.sections.values_list("name", flat=True))

    def create(self, validated_data):
        sections = validated_data.pop("sections", [])
        session = AttendanceSession.objects.create(**validated_data)
        session.sections.set(sections)
        return session

    def update(self, instance, validated_data):
        sections = validated_data.pop("sections", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if sections is not None:
            instance.sections.set(sections)
        return instance


class MyAttendanceSerializer(serializers.Serializer):
    """Summary of a student's own attendance across sessions.

    The server aggregates the student's attendance records, grouped by subject,
    and exposes a per-subject breakdown plus an overall percentage. This is the
    authoritative source for the student dashboard/history views.
    """

    student = StudentSerializer(read_only=True)
    overallPercentage = serializers.FloatField(source="overall_percentage")
    overallPresent = serializers.IntegerField(source="overall_present")
    overallTotal = serializers.IntegerField(source="overall_total")
    subjects = serializers.ListField(child=serializers.DictField(), read_only=True)
    logs = serializers.ListField(child=serializers.DictField(), read_only=True)


class QRAttendanceSessionSerializer(serializers.ModelSerializer):
    payload = serializers.SerializerMethodField()
    checked_in_count = serializers.SerializerMethodField()
    expires_in_seconds = serializers.SerializerMethodField()

    class Meta:
        model = QRAttendanceSession
        fields = [
            "id",
            "teacher",
            "attendance_session",
            "token",
            "token_generated_at",
            "student_ids",
            "revoked",
            "payload",
            "checked_in_count",
            "expires_in_seconds",
            "created_at",
        ]
        read_only_fields = ["payload", "checked_in_count", "expires_in_seconds"]

    def get_payload(self, obj):
        from apps.attendance.services import build_qr_payload

        return build_qr_payload(obj)

    def get_checked_in_count(self, obj):
        return len(obj.student_ids or [])

    def get_expires_in_seconds(self, obj):
        from django.conf import settings

        ttl = getattr(settings, "AAMS_QR_TOKEN_TTL_SECONDS", obj.TTL_SECONDS)
        elapsed = (
            (timezone.now() - obj.token_generated_at).total_seconds()
            if obj.token_generated_at
            else ttl
        )
        return max(0, int(ttl - elapsed))