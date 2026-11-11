from django.contrib import admin

from .models import EventDelivery, Medicine, MedicineLeaflet, Presentation, RegulatoryEvent, SafetyNotice, SupplyProblem


class ReadOnlyAdmin(admin.ModelAdmin):
    """The catalogue comes from the agency: corrected by a refresh, not by hand.

    Deleting stays possible — a row is rebuilt from the stock's code at the
    next sync — but adding or editing would only be overwritten.
    """

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


class SupplyProblemInline(admin.TabularInline):
    model = SupplyProblem
    extra = 0
    can_delete = False
    fields = ["native_type", "severity", "started_on", "expected_end_on", "first_seen_at", "resolved_at", "note"]
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Medicine)
class MedicineAdmin(ReadOnlyAdmin):
    list_display = ["code", "name", "source", "status", "fetched_at"]
    list_filter = ["source"]
    search_fields = ["code", "name"]
    exclude = ["raw"]


@admin.register(Presentation)
class PresentationAdmin(ReadOnlyAdmin):
    list_display = ["code", "name", "source", "fetch_status", "supply_severity", "marketed", "fetched_at"]
    list_filter = ["source", "fetch_status", "supply_severity"]
    search_fields = ["code", "name"]
    exclude = ["raw"]
    inlines = [SupplyProblemInline]


@admin.register(SupplyProblem)
class SupplyProblemAdmin(ReadOnlyAdmin):
    list_display = ["presentation", "native_type", "severity", "started_on", "expected_end_on", "resolved_at"]
    list_filter = ["severity", "native_type"]
    search_fields = ["presentation__code", "presentation__name"]


@admin.register(SafetyNotice)
class SafetyNoticeAdmin(ReadOnlyAdmin):
    list_display = ["reference", "title", "source", "published_on"]
    list_filter = ["source"]
    search_fields = ["reference", "title"]


@admin.register(MedicineLeaflet)
class MedicineLeafletAdmin(ReadOnlyAdmin):
    """Which leaflets are stored and how fresh — the HTML itself is the app's to show."""

    list_display = ["medicine", "section_count", "fetched_at"]
    search_fields = ["medicine__code", "medicine__name"]
    exclude = ["sections"]
    readonly_fields = ["section_titles"]

    @admin.display(description="Sections")
    def section_count(self, leaflet):
        return len(leaflet.sections)

    @admin.display(description="Section titles")
    def section_titles(self, leaflet):
        return " · ".join(section.get("title", "") for section in leaflet.sections) or "—"


@admin.register(RegulatoryEvent)
class RegulatoryEventAdmin(ReadOnlyAdmin):
    list_display = ["detected_at", "kind", "presentation"]
    list_filter = ["kind"]
    search_fields = ["presentation__code", "presentation__name"]
    list_select_related = ["presentation"]


@admin.register(EventDelivery)
class EventDeliveryAdmin(ReadOnlyAdmin):
    list_display = ["event", "user", "stock", "created_at", "delivered_at"]
    list_filter = ["event__kind"]
    search_fields = ["user__email", "stock__name"]
    list_select_related = ["event__presentation", "user", "stock"]
