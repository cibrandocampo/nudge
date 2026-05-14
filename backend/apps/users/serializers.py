from django.utils.timezone import now as tz_now
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from .models import User

SETTINGS_FIELDS = (
    "timezone",
    "daily_notification_time",
    "language",
    "quiet_hours_enabled",
    "quiet_hours_start",
    "quiet_hours_end",
)


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
            "quiet_hours_enabled",
            "quiet_hours_start",
            "quiet_hours_end",
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
    # `email` replaces `username` as the visible identifier — the frontend
    # phase-out of `username` (T197) renders display_name (first+last name,
    # fallback email) wherever a contact appears.
    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "email"]
        read_only_fields = ["id", "first_name", "last_name", "email"]


class LoginStartSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def to_internal_value(self, data):
        # Normalize email at the boundary so every downstream lookup
        # operates on the canonical lowercased form.
        email = data.get("email")
        if isinstance(email, str):
            data = {**data, "email": email.strip().lower()}
        return super().to_internal_value(data)


class LoginVerifySerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.CharField(required=False, allow_blank=False)
    password = serializers.CharField(required=False, allow_blank=False)

    def to_internal_value(self, data):
        email = data.get("email")
        if isinstance(email, str):
            data = {**data, "email": email.strip().lower()}
        return super().to_internal_value(data)

    def validate(self, attrs):
        has_code = bool(attrs.get("code"))
        has_password = bool(attrs.get("password"))
        if has_code == has_password:
            # Both or neither — caller must send exactly one.
            raise serializers.ValidationError(_("Send exactly one of 'code' or 'password'."))
        return attrs


class UserUpdateSerializer(serializers.ModelSerializer):
    settings_updated_at = serializers.DateTimeField(read_only=True)

    class Meta:
        model = User
        fields = [
            "timezone",
            "daily_notification_time",
            "language",
            "quiet_hours_enabled",
            "quiet_hours_start",
            "quiet_hours_end",
            "first_name",
            "last_name",
            "settings_updated_at",
        ]
        read_only_fields = ["settings_updated_at"]

    def validate_first_name(self, value):
        # Reject sending the field with whitespace/empty content; absent
        # is fine (partial update). Keeps the onboarding step honest.
        if not value.strip():
            raise serializers.ValidationError(_("First name cannot be empty."))
        return value.strip()

    def validate_last_name(self, value):
        if not value.strip():
            raise serializers.ValidationError(_("Last name cannot be empty."))
        return value.strip()

    def validate(self, attrs):
        """Reject overlap between daily_notification_time and the active quiet hours range.

        Only validates when quiet hours are enabled (post-PATCH effective value).
        Anchored to `daily_notification_time` so the error surfaces on that field
        in the frontend.
        """
        inst = self.instance

        def eff(key):
            if key in attrs:
                return attrs[key]
            return getattr(inst, key) if inst else None

        enabled = eff("quiet_hours_enabled")
        if not enabled:
            return attrs

        start = eff("quiet_hours_start")
        end = eff("quiet_hours_end")
        daily = eff("daily_notification_time")
        if start == end or not daily:
            return attrs

        in_quiet = (start < end and start <= daily < end) or (start > end and (daily >= start or daily < end))
        if in_quiet:
            raise serializers.ValidationError(
                {"daily_notification_time": _("Daily heads-up time cannot be inside your quiet hours.")}
            )
        return attrs

    def update(self, instance, validated_data):
        changed = any(
            field in validated_data and getattr(instance, field) != validated_data[field] for field in SETTINGS_FIELDS
        )
        if changed:
            validated_data["settings_updated_at"] = tz_now()
        return super().update(instance, validated_data)
