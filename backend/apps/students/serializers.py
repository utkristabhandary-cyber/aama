from rest_framework import serializers

from apps.students.models import Student


class StudentSerializer(serializers.ModelSerializer):
    section_name = serializers.CharField(source="section.name", read_only=True)
    semester_code = serializers.CharField(source="semester.code", read_only=True)

    class Meta:
        model = Student
        fields = [
            "id",
            "student_id",
            "roll_no",
            "name",
            "email",
            "phone",
            "section",
            "section_name",
            "semester",
            "semester_code",
            "avatar",
            "admission_year",
            "dob",
            "address",
            "guardian_name",
            "guardian_phone",
            "status",
        ]
        read_only_fields = ["semester"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        section = attrs.get("section", self.instance.section if self.instance else None)
        semester = attrs.get("semester", self.instance.semester if self.instance else None)
        if section is not None and semester is not None:
            if section.semester_id != semester.id:
                raise serializers.ValidationError(
                    {"section": "Section does not belong to the selected semester."}
                )
        elif section is not None and semester is None:
            raise serializers.ValidationError(
                {"semester": "Semester is required when a section is set."}
            )
        return attrs

    def create(self, validated_data):
        section = validated_data.get("section")
        if section is not None and "semester" not in validated_data:
            validated_data["semester"] = section.semester
        return super().create(validated_data)

    def update(self, instance, validated_data):
        section = validated_data.get("section")
        if section is not None:
            validated_data["semester"] = section.semester
        return super().update(instance, validated_data)