import zoneinfo

from django.utils.timezone import now as tz_now
from rest_framework import serializers

from .models import User

SETTINGS_FIELDS = ("timezone", "daily_notification_time", "language")


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "timezone",
            "daily_notification_time",
            "is_staff",
            "language",
            "settings_updated_at",
        ]
        read_only_fields = [
            "id",
            "username",
            "first_name",
            "last_name",
            "is_staff",
            "settings_updated_at",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if request and not request.user.is_staff:
            data.pop("is_staff", None)
        return data


class ContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username"]
        read_only_fields = ["id", "username"]


class UserUpdateSerializer(serializers.ModelSerializer):
    timezone = serializers.CharField(max_length=64)
    settings_updated_at = serializers.DateTimeField(read_only=True)

    class Meta:
        model = User
        fields = ["timezone", "daily_notification_time", "language", "settings_updated_at"]
        read_only_fields = ["settings_updated_at"]

    def validate_timezone(self, value):
        if value not in zoneinfo.available_timezones():
            raise serializers.ValidationError(f'"{value}" is not a valid IANA timezone.')
        return value

    def update(self, instance, validated_data):
        changed = any(
            field in validated_data and getattr(instance, field) != validated_data[field] for field in SETTINGS_FIELDS
        )
        if changed:
            validated_data["settings_updated_at"] = tz_now()
        return super().update(instance, validated_data)
