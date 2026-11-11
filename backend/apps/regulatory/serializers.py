"""API shape of the regulatory data attached to a stock.

Agency-neutral like the models: every field is a model column or a client
constant, never a field of the agency's payload.
"""

from django.db.models import F
from rest_framework import serializers

from .clients import aemps
from .models import MedicineLeaflet, RegulatoryEvent, SafetyNotice, SupplyProblem

# One entry because there is one agency. Picking the right constants by
# `source` is all this dict does — on purpose there is no client registry.
CLIENTS_BY_SOURCE = {aemps.SOURCE: aemps}


def _client(presentation):
    return CLIENTS_BY_SOURCE.get(presentation.source)


class RegulatorySummarySerializer(serializers.Serializer):
    """Compact summary for the stock list and detail, built from joins only.

    Serialises a ``Stock`` with ``presentation__medicine`` already loaded, so
    the inventory list stays within its query budget.
    """

    source = serializers.CharField(source="presentation.source")
    code = serializers.CharField(source="presentation.code")
    display_name = serializers.SerializerMethodField()
    attribution = serializers.SerializerMethodField()
    language = serializers.SerializerMethodField()
    official_name = serializers.SerializerMethodField()
    fetch_status = serializers.CharField(source="presentation.fetch_status")
    fetched_at = serializers.DateTimeField(source="presentation.fetched_at")
    marketed = serializers.BooleanField(source="presentation.marketed", allow_null=True)
    status = serializers.SerializerMethodField()
    affects_driving = serializers.SerializerMethodField()
    supply_severity = serializers.CharField(source="presentation.supply_severity", allow_null=True)
    name_offer_pending = serializers.SerializerMethodField()

    def _constant(self, stock, name):
        client = _client(stock.presentation)
        return getattr(client, name) if client else None

    def get_display_name(self, stock):
        return self._constant(stock, "DISPLAY_NAME")

    def get_attribution(self, stock):
        return self._constant(stock, "ATTRIBUTION")

    def get_language(self, stock):
        return self._constant(stock, "LANGUAGE")

    def get_official_name(self, stock):
        medicine = stock.presentation.medicine
        return medicine.name if medicine else None

    def get_status(self, stock):
        medicine = stock.presentation.medicine
        return medicine.status if medicine else None

    def get_affects_driving(self, stock):
        medicine = stock.presentation.medicine
        return medicine.affects_driving if medicine else None

    def get_name_offer_pending(self, stock):
        # The offer is the owner's to answer; a guest never sees it pending.
        request = self.context.get("request")
        is_owner = request is None or stock.user_id == request.user.pk
        return bool(stock.name_offer_pending and is_owner)


class SupplyProblemSerializer(serializers.ModelSerializer):
    active = serializers.SerializerMethodField()

    class Meta:
        model = SupplyProblem
        fields = [
            "native_type",
            "severity",
            "note",
            "started_on",
            "expected_end_on",
            "first_seen_at",
            "resolved_at",
            "active",
        ]

    def get_active(self, problem):
        return problem.resolved_at is None


class RegulatoryEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = RegulatoryEvent
        fields = ["kind", "payload", "detected_at"]


class SafetyNoticeSerializer(serializers.ModelSerializer):
    class Meta:
        model = SafetyNotice
        fields = ["reference", "native_kind", "title", "url", "published_on"]


class RegulatoryDetailSerializer(RegulatorySummarySerializer):
    """Everything the product page shows about the stock's medicine."""

    # The latest changes detected on the presentation. No screen shows them yet;
    # the daily push (and a later history view) build on them.
    EVENT_LIMIT = 20

    agency_url = serializers.SerializerMethodField()
    presentation_name = serializers.CharField(source="presentation.name")
    supply_problems = serializers.SerializerMethodField()
    safety_notices = serializers.SerializerMethodField()
    events = serializers.SerializerMethodField()

    def get_agency_url(self, stock):
        medicine = stock.presentation.medicine
        return medicine.agency_url if medicine else ""

    def get_supply_problems(self, stock):
        # The active problem first, then past ones from the most recent.
        problems = stock.presentation.supply_problems.order_by(
            F("resolved_at").desc(nulls_first=True), "-first_seen_at"
        )
        return SupplyProblemSerializer(problems, many=True).data

    def get_safety_notices(self, stock):
        medicine = stock.presentation.medicine
        if medicine is None:
            return []
        notices = medicine.safety_notices.order_by(F("published_on").desc(nulls_last=True), "reference")
        return SafetyNoticeSerializer(notices, many=True).data

    def get_events(self, stock):
        events = stock.presentation.events.order_by("-detected_at", "-pk")[: self.EVENT_LIMIT]
        return RegulatoryEventSerializer(events, many=True).data


class MedicineLeafletSerializer(serializers.ModelSerializer):
    """The sanitised leaflet sections; ``source_url`` is the fallback when there are none.

    ``pdf_url`` is the whole leaflet as a file to download, empty when the agency
    publishes none.
    """

    language = serializers.SerializerMethodField()
    pdf_url = serializers.URLField(source="medicine.leaflet_pdf_url", read_only=True)

    class Meta:
        model = MedicineLeaflet
        fields = ["sections", "source_url", "pdf_url", "fetched_at", "language"]

    def get_language(self, leaflet):
        client = CLIENTS_BY_SOURCE.get(leaflet.medicine.source)
        return client.LANGUAGE if client else None
