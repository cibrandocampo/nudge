from django.contrib import admin

from .models import Routine, RoutineEntry, Stock, StockConsumption, StockGroup, StockLot


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


@admin.register(StockGroup)
class StockGroupAdmin(admin.ModelAdmin):
    list_display = ["name", "user", "display_order", "created_at"]
    list_filter = ["user"]
    search_fields = ["name"]
    readonly_fields = ["created_at"]


class StockConsumptionInline(admin.TabularInline):
    model = StockConsumption
    extra = 0
    readonly_fields = ["created_at", "quantity", "consumed_lots", "notes"]
    ordering = ["-created_at"]


@admin.register(Stock)
class StockAdmin(admin.ModelAdmin):
    list_display = ["name", "user", "group", "total_quantity", "updated_at"]
    list_filter = ["user", "group"]
    search_fields = ["name"]
    readonly_fields = ["updated_at"]
    filter_horizontal = ["shared_with"]
    inlines = [StockLotInline, StockConsumptionInline]

    @admin.display(description="Total quantity")
    def total_quantity(self, obj):
        return obj.quantity


@admin.register(Routine)
class RoutineAdmin(admin.ModelAdmin):
    list_display = ["name", "user", "interval_hours", "stock", "is_active", "updated_at"]
    list_filter = ["is_active", "user"]
    search_fields = ["name", "description"]
    readonly_fields = ["created_at", "updated_at"]
    filter_horizontal = ["shared_with"]
    inlines = [RoutineEntryInline]


@admin.register(StockConsumption)
class StockConsumptionAdmin(admin.ModelAdmin):
    list_display = ["stock", "quantity", "consumed_by", "notes", "created_at"]
    list_filter = ["stock__user", "stock"]
    search_fields = ["stock__name", "notes"]
    readonly_fields = ["created_at"]


@admin.register(RoutineEntry)
class RoutineEntryAdmin(admin.ModelAdmin):
    list_display = ["routine", "completed_by", "created_at", "notes"]
    list_filter = ["routine__user", "routine"]
    search_fields = ["routine__name", "notes"]
    readonly_fields = ["created_at"]
