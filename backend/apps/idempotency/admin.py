from django.contrib import admin

from .models import IdempotencyRecord


@admin.register(IdempotencyRecord)
class IdempotencyRecordAdmin(admin.ModelAdmin):
    list_display = ("key", "user", "endpoint", "method", "response_status", "created_at")
    list_filter = ("method", "response_status")
    search_fields = ("key", "user__username", "endpoint")
    readonly_fields = (
        "key",
        "user",
        "endpoint",
        "method",
        "body_hash",
        "response_status",
        "response_body",
        "created_at",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
