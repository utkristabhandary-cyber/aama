from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from apps.academics.models import (
    Holiday,
    Section,
    Semester,
    Subject,
    TeacherAssignment,
    TeachingSession,
    TimetableSlot,
)
from apps.academics.services import (
    assert_teacher_single_module_per_semester,
    check_timetable_conflicts,
    participating_section_ids,
    validate_semester_consistency,
)


class SemesterSerializer(serializers.ModelSerializer):
    class Meta:
        model = Semester
        fields = [
            "id",
            "name",
            "code",
            "academic_year",
            "start_date",
            "end_date",
            "status",
            "description",
        ]


class SectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Section
        fields = ["id", "name", "semester", "capacity", "room"]


class SectionDetailSerializer(SectionSerializer):
    semester_code = serializers.CharField(source="semester.code", read_only=True)

    class Meta(SectionSerializer.Meta):
        fields = SectionSerializer.Meta.fields + ["semester_code"]


class SubjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = ["id", "code", "name", "semester", "credits", "type", "status"]


class HolidaySerializer(serializers.ModelSerializer):
    class Meta:
        model = Holiday
        fields = ["id", "date", "title", "description", "type"]


class TeacherAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = TeacherAssignment
        fields = [
            "id",
            "teacher",
            "semester",
            "section",
            "subject",
            "status",
            "created_at",
        ]
        read_only_fields = ["created_at"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        instance = self.instance
        teacher = attrs.get("teacher", instance.teacher if instance else None)
        semester = attrs.get("semester", instance.semester if instance else None)
        subject = attrs.get("subject", instance.subject if instance else None)
        section = attrs.get("section", instance.section if instance else None)

        validate_semester_consistency(semester=semester, section=section, subject=subject)

        assert_teacher_single_module_per_semester(
            teacher,
            subject,
            semester,
            exclude_assignment_id=instance.pk if instance else None,
        )

        queryset = TeacherAssignment.objects.all()
        if instance:
            queryset = queryset.exclude(pk=instance.pk)
        if queryset.filter(
            teacher=teacher,
            semester=semester,
            section=section,
            subject=subject,
        ).exists():
            raise ValidationError(
                "This teacher is already assigned to this subject and section."
            )
        return attrs


class TimetableSlotSerializer(serializers.ModelSerializer):
    section_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, write_only=True
    )
    is_combined = serializers.BooleanField(read_only=True)
    subject_code = serializers.CharField(source="subject.code", read_only=True)
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    teacher_name = serializers.CharField(source="teacher.name", read_only=True)
    section_name = serializers.CharField(source="section.name", read_only=True)
    section_names = serializers.SerializerMethodField()

    class Meta:
        model = TimetableSlot
        fields = [
            "id",
            "semester",
            "section",
            "section_ids",
            "subject",
            "teacher",
            "day",
            "start_time",
            "end_time",
            "room",
            "class_type",
            "notes",
            "is_combined",
            "subject_code",
            "subject_name",
            "teacher_name",
            "section_name",
            "section_names",
        ]

    def get_section_names(self, obj):
        # Combined lectures list every participating section; otherwise the
        # default section name is repeated so the client never needs lookups.
        names = list(obj.sections.values_list("name", flat=True))
        if names:
            return names
        return [obj.section.name] if obj.section else []

    def _validate_and_prepare(self, attrs, instance_pk=None):
        semester = attrs["semester"]
        teacher = attrs["teacher"]
        subject = attrs["subject"]
        section = attrs["section"]
        section_ids = attrs.get("section_ids", [])

        validate_semester_consistency(semester=semester, section=section, subject=subject)

        assert_teacher_single_module_per_semester(
            teacher,
            subject,
            semester,
            exclude_timetable_slot_id=instance_pk,
        )

        conflict = check_timetable_conflicts(
            semester=semester,
            teacher=teacher,
            section=section,
            section_ids=section_ids,
            day=attrs["day"],
            start_time=attrs["start_time"],
            end_time=attrs["end_time"],
            room=attrs.get("room", ""),
            class_type=attrs["class_type"],
            exclude_slot_id=instance_pk,
        )
        if conflict:
            raise ValidationError(conflict)

        target = participating_section_ids(section, section_ids) or [section.pk]
        return target, len(target) > 1

    def create(self, validated_data):
        validated_data.pop("section_ids", None)
        target, combined = self._validate_and_prepare(validated_data)
        slot = TimetableSlot.objects.create(**validated_data, is_combined=combined)
        slot.sections.set(Section.objects.filter(pk__in=target))
        return slot

    def update(self, instance, validated_data):
        validated_data.pop("section_ids", None)
        target, combined = self._validate_and_prepare(validated_data, instance.pk)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.is_combined = combined
        instance.save()
        instance.sections.set(Section.objects.filter(pk__in=target))
        return instance


class TeachingSessionSerializer(serializers.ModelSerializer):
    section_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False
    )
    is_combined = serializers.BooleanField(read_only=True)

    class Meta:
        model = TeachingSession
        fields = [
            "id",
            "semester",
            "subject",
            "teacher",
            "class_type",
            "section_ids",
            "is_combined",
            "day",
            "start_time",
            "end_time",
            "room",
            "notes",
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        instance = self.instance
        semester = attrs.get("semester", instance.semester if instance else None)
        subject = attrs.get("subject", instance.subject if instance else None)
        section_ids = attrs.get("section_ids")
        if section_ids is None and instance is not None:
            section_ids = instance.section_ids
        section = None
        if section_ids:
            section = Section.objects.filter(pk=section_ids[0]).first()
        validate_semester_consistency(semester=semester, subject=subject, section=section)
        return attrs

    def create(self, validated_data):
        section_ids = validated_data.pop("section_ids", [])
        target = participating_section_ids(None, section_ids)
        combined = len(target) > 1
        session = TeachingSession.objects.create(**validated_data, is_combined=combined)
        if target:
            session.sections.set(Section.objects.filter(pk__in=target))
        return session

    def update(self, instance, validated_data):
        section_ids = validated_data.pop("section_ids", instance.section_ids)
        target = participating_section_ids(None, section_ids)
        instance.is_combined = len(target) > 1
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if target:
            instance.sections.set(Section.objects.filter(pk__in=target))
        return instance