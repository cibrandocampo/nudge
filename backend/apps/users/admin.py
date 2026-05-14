from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    # Añadir los campos propios al formulario de edición
    fieldsets = BaseUserAdmin.fieldsets + (
        (
            "Auth method",
            {
                "fields": ("auth_method",),
                "description": (
                    "OTP users log in with a 6-digit code emailed to them. "
                    "Password users log in with username + password. Admins "
                    "typically use Password."
                ),
            },
        ),
        (
            "Nudge settings",
            {
                "fields": ("timezone", "daily_notification_time", "language"),
            },
        ),
        (
            "Contacts",
            {
                "fields": ("contacts",),
            },
        ),
    )
    filter_horizontal = ("contacts",)
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        (
            "Auth method",
            {
                "fields": ("auth_method",),
            },
        ),
        (
            "Nudge settings",
            {
                "fields": ("timezone", "daily_notification_time", "language"),
            },
        ),
    )
    list_display = [
        "display_name",
        "username",
        "email",
        "auth_method",
        "timezone",
        "daily_notification_time",
        "is_staff",
        "is_active",
    ]
    list_filter = ["auth_method", "is_staff", "is_active", "timezone"]
    search_fields = ["username", "email", "first_name", "last_name"]
