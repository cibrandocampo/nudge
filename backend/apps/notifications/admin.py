from django.contrib import admin

from .models import NotificationState, PushSubscription


@admin.register(NotificationState)
class NotificationStateAdmin(admin.ModelAdmin):
    list_display = ["routine", "last_due_notification", "last_reminder", "last_daily_notification"]
    list_filter = ["routine__user"]
    search_fields = ["routine__name"]
    readonly_fields = ["last_due_notification", "last_reminder", "last_daily_notification"]


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    list_display = ["user", "created_at", "last_used"]
    list_filter = ["user"]
    search_fields = ["user__username"]
    readonly_fields = ["created_at", "last_used"]
