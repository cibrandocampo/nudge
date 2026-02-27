from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    # Añadir los campos propios al formulario de edición
    fieldsets = BaseUserAdmin.fieldsets + (
        (
            "Nudge settings",
            {
                "fields": ("timezone", "daily_notification_time", "language"),
            },
        ),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        (
            "Nudge settings",
            {
                "fields": ("timezone", "daily_notification_time", "language"),
            },
        ),
    )
    list_display = ["username", "email", "timezone", "daily_notification_time", "is_staff", "is_active"]
    list_filter = ["is_staff", "is_active", "timezone"]
    search_fields = ["username", "email"]
