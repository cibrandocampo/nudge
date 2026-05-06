from datetime import date, timedelta
from math import floor

from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import serializers

from apps.core.mixins import SharedWithMixin

from .models import Routine, RoutineEntry, Stock, StockConsumption, StockGroup, StockLot

User = get_user_model()


def validate_client_created_at(value):
    """
    Validator for client-provided action timestamps.

    Returns the value unchanged when no skew limit is configured or when the
    value is within skew. Raises ValidationError otherwise. Shared between the
    RoutineEntry and StockConsumption entry points so the rule is consistent.
    """
    if value is None:
        return None
    skew = getattr(settings, "OFFLINE_MAX_CLIENT_TIMESTAMP_SKEW_SECONDS", None)
    if skew is None:
        return value
    delta = abs((timezone.now() - value).total_seconds())
    if delta > skew:
        raise serializers.ValidationError(f"Client timestamp exceeds allowed skew ({skew}s).")
    return value


class ClientTimestampInputSerializer(serializers.Serializer):
    """
    Tiny input-only serializer for endpoints that accept an optional
    `client_created_at` alongside their domain payload (log, consume).
    """

    client_created_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate_client_created_at(self, value):
        return validate_client_created_at(value)


class StockLotSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockLot
        fields = ["id", "quantity", "expiry_date", "lot_number", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_quantity(self, value):
        if value < 0:
            raise serializers.ValidationError("Quantity cannot be negative.")
        return value

    def validate_expiry_date(self, value):
        if value and value < date.today():
            raise serializers.ValidationError("Expiry date cannot be in the past.")
        return value


class StockGroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockGroup
        fields = ["id", "name", "display_order", "created_at"]
        read_only_fields = ["id", "created_at"]


class StockSerializer(SharedWithMixin, serializers.ModelSerializer):
    lots = StockLotSerializer(many=True, read_only=True)
    quantity = serializers.SerializerMethodField()
    quantity_available = serializers.SerializerMethodField()
    quantity_soon = serializers.SerializerMethodField()
    quantity_healthy = serializers.SerializerMethodField()
    quantity_expired = serializers.SerializerMethodField()
    group_name = serializers.CharField(source="group.name", read_only=True, default=None)
    requires_lot_selection = serializers.SerializerMethodField()
    estimated_depletion_date = serializers.SerializerMethodField()
    depletion_is_estimated = serializers.SerializerMethodField()
    daily_consumption_own = serializers.SerializerMethodField()
    daily_consumption_shared = serializers.SerializerMethodField()
    stock_severity = serializers.SerializerMethodField()
    expiry_severity = serializers.SerializerMethodField()
    shared_with = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=User.objects.all(),
        required=False,
    )
    shared_with_details = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()
    owner_username = serializers.CharField(source="user.username", read_only=True)

    WARNING_THRESHOLD_DAYS = 30
    CRITICAL_THRESHOLD_DAYS = 7
    LOW_STOCK_THRESHOLD_UNITS = 3
    # Window for the "estimate depletion from past direct consumption" branch.
    # Trigger requires ≥1 unit consumed in EACH half (last 30d AND prev 30d).
    DIRECT_CONSUMPTION_WINDOW_DAYS = 60
    DIRECT_CONSUMPTION_HALF_DAYS = 30

    class Meta:
        model = Stock
        fields = [
            "id",
            "name",
            "group",
            "group_name",
            "quantity",
            "quantity_available",
            "quantity_soon",
            "quantity_healthy",
            "quantity_expired",
            "lots",
            "requires_lot_selection",
            "estimated_depletion_date",
            "depletion_is_estimated",
            "daily_consumption_own",
            "daily_consumption_shared",
            "stock_severity",
            "expiry_severity",
            "shared_with",
            "shared_with_details",
            "is_owner",
            "owner_username",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "quantity",
            "quantity_available",
            "quantity_soon",
            "quantity_healthy",
            "quantity_expired",
            "group_name",
            "lots",
            "requires_lot_selection",
            "estimated_depletion_date",
            "depletion_is_estimated",
            "daily_consumption_own",
            "daily_consumption_shared",
            "stock_severity",
            "expiry_severity",
            "shared_with_details",
            "is_owner",
            "owner_username",
            "updated_at",
        ]

    def validate_group(self, value):
        request = self.context.get("request")
        if value and request and value.user != request.user:
            raise serializers.ValidationError("Invalid stock group.")
        return value

    def get_is_owner(self, obj):
        request = self.context.get("request")
        if not request:
            return True
        return obj.user == request.user

    def get_quantity(self, obj):
        # Use prefetched lots if available to avoid an extra aggregate query
        if "lots" in obj.__dict__.get("_prefetched_objects_cache", {}):
            return sum(lot.quantity for lot in obj.lots.all())
        return obj.quantity

    def _quantity_partition(self, obj):
        """Partition lot quantities into soon / healthy / expired buckets.

        Returns a cached dict so the four `get_quantity_*` getters share
        a single iteration over the lots list. Lots with `quantity <= 0`
        are skipped defensively (the post_save signal deletes them but
        bulk paths can leave stragglers — see MEMORY.md).

        Buckets follow the plan (`docs/plans/stock-severity-revised.md`):
            expired:  expiry_date <= today
            soon:     today < expiry_date < today + WARNING_THRESHOLD_DAYS
            healthy:  expiry_date IS NULL or expiry_date >= today + WARNING_THRESHOLD_DAYS
        """
        cache_attr = "_quantity_partition_cache"
        if hasattr(obj, cache_attr):
            return getattr(obj, cache_attr)

        today = date.today()
        cutoff = today + timedelta(days=self.WARNING_THRESHOLD_DAYS)
        soon = healthy = expired = 0
        for lot in obj.lots.all():
            if lot.quantity <= 0:
                continue
            if lot.expiry_date is None:
                healthy += lot.quantity
            elif lot.expiry_date <= today:
                expired += lot.quantity
            elif lot.expiry_date < cutoff:
                soon += lot.quantity
            else:
                healthy += lot.quantity

        result = {
            "available": soon + healthy,
            "soon": soon,
            "healthy": healthy,
            "expired": expired,
        }
        setattr(obj, cache_attr, result)
        return result

    def get_quantity_available(self, obj):
        return self._quantity_partition(obj)["available"]

    def get_quantity_soon(self, obj):
        return self._quantity_partition(obj)["soon"]

    def get_quantity_healthy(self, obj):
        return self._quantity_partition(obj)["healthy"]

    def get_quantity_expired(self, obj):
        return self._quantity_partition(obj)["expired"]

    def get_requires_lot_selection(self, obj):
        # Use prefetch cache when available to avoid an extra query
        if "lots" in obj.__dict__.get("_prefetched_objects_cache", {}):
            return any(lot.lot_number and lot.quantity > 0 for lot in obj.lots.all())
        return obj.lots.filter(quantity__gt=0).exclude(lot_number="").exists()

    def _consumption_data(self, obj):
        """Compute and cache consumption data for the stock.

        Combines two sources:
          1. Active routines linked to the stock (24/interval × usage).
          2. Direct `StockConsumption` rows in the last 60 days, when
             trigger B is met (≥1 unit in last 30d AND ≥1 in prev 30d).

        The direct branch contribution is split between `_own` and
        `_shared` based on `consumed_by_id == obj.user_id`. A null
        `consumed_by` (FK SET_NULL after a user delete) counts as
        `_own` to keep the orphan datum useful without inflating the
        shared rate.

        `is_estimated` is True iff the direct branch contributed any
        non-zero units to the rate. The frontend uses this flag to
        prepend a subtle `≈` icon to the rendered "Until …" line.
        """
        cache_attr = "_consumption_data_cache"
        if hasattr(obj, cache_attr):
            return getattr(obj, cache_attr)

        active_routines = getattr(obj, "active_routines", None)
        if active_routines is None:
            active_routines = list(obj.routines.filter(is_active=True).select_related("user"))

        own = 0.0
        shared = 0.0
        for routine in active_routines:
            daily_rate = (24.0 / routine.interval_hours) * routine.stock_usage
            if routine.user_id == obj.user_id:
                own += daily_rate
            else:
                shared += daily_rate

        # Direct-consumption augmentation. Always evaluated — the trigger
        # decides whether it contributes anything.
        recent = getattr(obj, "recent_consumptions", None)
        if recent is None:
            window_start = timezone.now() - timedelta(days=self.DIRECT_CONSUMPTION_WINDOW_DAYS)
            recent = list(obj.consumptions.filter(client_created_at__gte=window_start))

        half_ago = timezone.now() - timedelta(days=self.DIRECT_CONSUMPTION_HALF_DAYS)
        last_month_units = sum(c.quantity for c in recent if c.client_created_at >= half_ago)
        prev_month_units = sum(c.quantity for c in recent if c.client_created_at < half_ago)

        is_estimated = False
        if last_month_units >= 1 and prev_month_units >= 1:
            own_direct_units = 0
            shared_direct_units = 0
            for c in recent:
                if c.consumed_by_id is None or c.consumed_by_id == obj.user_id:
                    own_direct_units += c.quantity
                else:
                    shared_direct_units += c.quantity

            window = float(self.DIRECT_CONSUMPTION_WINDOW_DAYS)
            own += own_direct_units / window
            shared += shared_direct_units / window
            is_estimated = (own_direct_units + shared_direct_units) > 0

        total = own + shared
        # Depletion is computed from the consumable quantity — expired lots
        # are NOT subtracted from the user's burn rate, so including them in
        # the numerator would overestimate days remaining (T164).
        qty_available = self.get_quantity_available(obj)

        if total > 0 and qty_available > 0:
            days = floor(qty_available / total)
            depletion_date = date.today() + timedelta(days=days)
        elif total > 0 and qty_available == 0:
            depletion_date = date.today()
        else:
            depletion_date = None

        result = {
            "own": round(own, 2) if own > 0 else None,
            "shared": round(shared, 2) if shared > 0 else None,
            "depletion_date": depletion_date,
            "is_estimated": is_estimated,
        }
        setattr(obj, cache_attr, result)
        return result

    def get_estimated_depletion_date(self, obj):
        return self._consumption_data(obj)["depletion_date"]

    def get_depletion_is_estimated(self, obj):
        return self._consumption_data(obj)["is_estimated"]

    def get_daily_consumption_own(self, obj):
        return self._consumption_data(obj)["own"]

    def get_daily_consumption_shared(self, obj):
        return self._consumption_data(obj)["shared"]

    def get_stock_severity(self, obj):
        """3-tier severity (T164). Replaces the previous `'out'`/`'low'`/`'ok'`
        model. The expiry signal lives on per-lot indicators only —
        `expiry_severity='soon'` no longer pushes the stock-level border.

        Returns:
            'critical' — red. Triggers:
                         - quantity_available == 0 (no lots, or all expired)
                         - depletion_date < today + CRITICAL_THRESHOLD_DAYS
            'low'      — orange. Triggers:
                         Tipo 2 (depletion present): days_left < WARNING_THRESHOLD_DAYS
                         Tipo 1 (no depletion):      quantity_healthy < LOW_STOCK_THRESHOLD_UNITS
            'ok'       — green. Otherwise.

        See `docs/plans/stock-severity-revised.md`.
        """
        qty_available = self.get_quantity_available(obj)
        if qty_available == 0:
            return "critical"

        depletion = self._consumption_data(obj)["depletion_date"]
        if depletion is not None:
            days_left = (depletion - date.today()).days
            if days_left < self.CRITICAL_THRESHOLD_DAYS:
                return "critical"
            if days_left < self.WARNING_THRESHOLD_DAYS:
                return "low"
            return "ok"

        # Tipo 1 — no consumption estimate; fall back to healthy-units count.
        if self.get_quantity_healthy(obj) >= self.LOW_STOCK_THRESHOLD_UNITS:
            return "ok"
        return "low"

    def get_expiry_severity(self, obj):
        """Severity tier for stock lots' expiry dates.

        - any lot with qty > 0 and expiry_date <= today              → 'reached'
        - any lot with qty > 0 and today < expiry_date < today + 30d → 'soon'
        - otherwise                                                  → 'ok'

        'reached' takes precedence: a stock with one expired lot AND one
        soon-to-expire lot returns 'reached'.
        """
        today = date.today()
        cutoff = today + timedelta(days=self.WARNING_THRESHOLD_DAYS)
        has_reached = False
        has_soon = False
        for lot in obj.lots.all():
            if lot.expiry_date is None or lot.quantity <= 0:
                continue
            if lot.expiry_date <= today:
                has_reached = True
            elif lot.expiry_date < cutoff:
                has_soon = True
        if has_reached:
            return "reached"
        if has_soon:
            return "soon"
        return "ok"

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if request and instance.user != request.user:
            overrides = getattr(instance, "_my_group_override", None) or []
            if overrides:
                override = overrides[0]
                data["group"] = override.group_id
                data["group_name"] = override.group.name if override.group else None
            else:
                data["group"] = None
                data["group_name"] = None
        return data


class StockConsumptionSerializer(serializers.ModelSerializer):
    stock_name = serializers.CharField(source="stock.name", read_only=True)
    consumed_by_username = serializers.CharField(source="consumed_by.username", read_only=True, default=None)

    class Meta:
        model = StockConsumption
        fields = [
            "id",
            "stock",
            "stock_name",
            "quantity",
            "consumed_lots",
            "notes",
            "consumed_by_username",
            "created_at",
            "updated_at",
            "client_created_at",
        ]
        read_only_fields = [
            "id",
            "stock",
            "stock_name",
            "quantity",
            "consumed_lots",
            "consumed_by_username",
            "created_at",
            "updated_at",
            "client_created_at",
        ]


class RoutineSerializer(SharedWithMixin, serializers.ModelSerializer):
    # Read-only convenience field so the frontend doesn't need an extra request
    stock_name = serializers.CharField(source="stock.name", read_only=True)
    stock_quantity = serializers.IntegerField(source="stock.quantity", read_only=True)
    stock_quantity_available = serializers.IntegerField(
        source="stock.quantity_available", read_only=True, allow_null=True
    )

    # Computed fields
    last_entry_at = serializers.SerializerMethodField()
    next_due_at = serializers.SerializerMethodField()
    is_due = serializers.SerializerMethodField()
    is_overdue = serializers.SerializerMethodField()
    hours_until_due = serializers.SerializerMethodField()
    requires_lot_selection = serializers.SerializerMethodField()

    # Sharing fields
    shared_with = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=User.objects.all(),
        required=False,
    )
    shared_with_details = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()
    owner_username = serializers.CharField(source="user.username", read_only=True)

    # Write-only: backdates the first entry so the routine isn't immediately overdue
    last_done_at = serializers.DateTimeField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = Routine
        fields = [
            "id",
            "name",
            "description",
            "interval_hours",
            "stock",
            "stock_name",
            "stock_quantity",
            "stock_quantity_available",
            "stock_usage",
            "is_active",
            "created_at",
            "updated_at",
            "last_entry_at",
            "next_due_at",
            "is_due",
            "is_overdue",
            "hours_until_due",
            "requires_lot_selection",
            "shared_with",
            "shared_with_details",
            "is_owner",
            "owner_username",
            "last_done_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "stock_name",
            "stock_quantity",
            "stock_quantity_available",
            "requires_lot_selection",
            "shared_with_details",
            "is_owner",
            "owner_username",
        ]

    def validate_stock(self, value):
        request = self.context.get("request")
        if value and request:
            is_owner = value.user == request.user
            is_shared = value.shared_with.filter(pk=request.user.pk).exists()
            if not is_owner and not is_shared:
                raise serializers.ValidationError("Invalid stock item.")
        return value

    def get_is_owner(self, obj):
        request = self.context.get("request")
        if not request:
            return True
        return obj.user == request.user

    def validate_last_done_at(self, value):
        if value and value > timezone.now():
            raise serializers.ValidationError("Cannot be in the future.")
        return value

    def create(self, validated_data):
        last_done_at = validated_data.pop("last_done_at", None)
        routine = super().create(validated_data)
        if last_done_at:
            RoutineEntry.objects.create(routine=routine, created_at=last_done_at)
        return routine

    def get_last_entry_at(self, obj):
        last = obj.last_entry()
        # Use the effective action time so UI "last done" reflects when the
        # user actually performed the routine, not when the offline queue
        # synced it (same principle as next_due_at).
        return last.effective_created_at if last else None

    def get_next_due_at(self, obj):
        return obj.next_due_at()

    def get_is_due(self, obj):
        return obj.is_due()

    def get_is_overdue(self, obj):
        return obj.is_overdue()

    def get_hours_until_due(self, obj):
        due = obj.next_due_at()
        if due is None:
            return None
        delta = (due - timezone.now()).total_seconds() / 3600
        return round(delta, 1)

    def get_requires_lot_selection(self, obj):
        if not obj.stock_id:
            return False
        return obj.stock.lots.filter(quantity__gt=0).exclude(lot_number="").exists()


class RoutineEntrySerializer(serializers.ModelSerializer):
    routine_name = serializers.CharField(source="routine.name", read_only=True)
    stock_name = serializers.CharField(source="routine.stock.name", read_only=True, default=None)
    completed_by_username = serializers.CharField(source="completed_by.username", read_only=True, default=None)

    class Meta:
        model = RoutineEntry
        fields = [
            "id",
            "routine",
            "routine_name",
            "stock_name",
            "completed_by_username",
            "created_at",
            "updated_at",
            "client_created_at",
            "notes",
            "consumed_lots",
        ]
        read_only_fields = [
            "id",
            "routine",
            "created_at",
            "updated_at",
            "client_created_at",
            "consumed_lots",
            "stock_name",
            "completed_by_username",
        ]
