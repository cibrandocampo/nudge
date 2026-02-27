from django.contrib import admin

from .models import Routine, RoutineEntry, Stock, StockLot


class RoutineEntryInline(admin.TabularInline):
    model = RoutineEntry
    extra = 0
    readonly_fields = ["created_at"]
    ordering = ["-created_at"]


class StockLotInline(admin.TabularInline):
    model = StockLot
    extra = 1
    fields = ["lot_number", "quantity", "expiry_date", "created_at"]
    readonly_fields = ["created_at"]
    ordering = ["expiry_date", "created_at"]


@admin.register(Stock)
class StockAdmin(admin.ModelAdmin):
    list_display = ["name", "user", "total_quantity", "updated_at"]
    list_filter = ["user"]
    search_fields = ["name"]
    readonly_fields = ["updated_at"]
    inlines = [StockLotInline]

    @admin.display(description="Total quantity")
    def total_quantity(self, obj):
        return obj.quantity


@admin.register(Routine)
class RoutineAdmin(admin.ModelAdmin):
    list_display = ["name", "user", "interval_hours", "stock", "is_active", "updated_at"]
    list_filter = ["is_active", "user"]
    search_fields = ["name", "description"]
    readonly_fields = ["created_at", "updated_at"]
    inlines = [RoutineEntryInline]


@admin.register(RoutineEntry)
class RoutineEntryAdmin(admin.ModelAdmin):
    list_display = ["routine", "created_at", "notes"]
    list_filter = ["routine__user", "routine"]
    search_fields = ["routine__name", "notes"]
    readonly_fields = ["created_at"]
