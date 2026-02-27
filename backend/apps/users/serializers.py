import zoneinfo

from rest_framework import serializers

from .models import User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email", "timezone", "daily_notification_time", "is_staff", "language"]
        read_only_fields = ["id", "username", "is_staff"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if request and not request.user.is_staff:
            data.pop("is_staff", None)
        return data


class UserUpdateSerializer(serializers.ModelSerializer):
    timezone = serializers.CharField(max_length=64)

    class Meta:
        model = User
        fields = ["timezone", "daily_notification_time", "language"]

    def validate_timezone(self, value):
        if value not in zoneinfo.available_timezones():
            raise serializers.ValidationError(f'"{value}" is not a valid IANA timezone.')
        return value
