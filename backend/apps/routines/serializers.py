from datetime import date, timedelta
from math import floor

from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_flex_fields import FlexFieldsModelSerializer
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


class StockLotSerializer(FlexFieldsModelSerializer):
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


class StockGroupSerializer(FlexFieldsModelSerializer):
    class Meta:
        model = StockGroup
        fields = ["id", "name", "display_order", "created_at"]
        read_only_fields = ["id", "created_at"]


class StockSerializer(SharedWithMixin, FlexFieldsModelSerializer):
    """Serializer for Stock items.

    Raw fields a generic API consumer should rely on:

    - ``id``, ``name``, ``group`` / ``group_name``, ``lots``, ``updated_at``.
    - ``quantity``, ``quantity_available``, ``quantity_soon``,
      ``quantity_healthy``, ``quantity_expired`` — partitioned counts derived
      directly from ``lots``.
    - ``owner_id``, ``owner_display_name`` and ``user_timezone`` — identify
      the owner whose timezone anchors any time-based interpretation a
      client wishes to make.
    - ``shared_with`` / ``shared_with_details``, ``is_owner``.

    Convenience fields, **Nudge-specific** and computed from the raw fields
    above using Nudge's policy. A generic consumer is free to ignore them
    and apply its own classification:

    - ``stock_severity``, ``expiry_severity`` — Nudge's 3-tier severity strings.
      Thresholds configurable via ``STOCK_SEVERITY_*`` settings (see
      ``docs/configuration.md``).
    - ``estimated_depletion_date``, ``depletion_is_estimated``,
      ``daily_consumption_own``, ``daily_consumption_shared`` — depletion
      estimate using Nudge's heuristic.
    - ``requires_lot_selection`` — UI hint: the stock has lot-numbered lots,
      so the client must let the user pick which to consume before any decrement.
    """

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
    owner_id = serializers.IntegerField(source="user.id", read_only=True)
    owner_display_name = serializers.CharField(source="user.display_name", read_only=True)
    user_timezone = serializers.CharField(source="user.timezone", read_only=True)
    my_group = serializers.SerializerMethodField()
    my_group_name = serializers.SerializerMethodField()

    class Meta:
        model = Stock
        fields = [
            "id",
            "name",
            "group",
            "group_name",
            "my_group",
            "my_group_name",
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
            "owner_id",
            "owner_display_name",
            "user_timezone",
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
            "my_group",
            "my_group_name",
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
            "owner_id",
            "owner_display_name",
            "user_timezone",
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
            soon:     today < expiry_date < today + STOCK_SEVERITY_WARNING_DAYS
            healthy:  expiry_date IS NULL or expiry_date >= today + STOCK_SEVERITY_WARNING_DAYS
        """
        cache_attr = "_quantity_partition_cache"
        if hasattr(obj, cache_attr):
            return getattr(obj, cache_attr)

        today = date.today()
        cutoff = today + timedelta(days=settings.STOCK_SEVERITY_WARNING_DAYS)
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
            window_start = timezone.now() - timedelta(days=settings.STOCK_DIRECT_CONSUMPTION_WINDOW_DAYS)
            recent = list(obj.consumptions.filter(client_created_at__gte=window_start))

        half_ago = timezone.now() - timedelta(days=settings.STOCK_DIRECT_CONSUMPTION_HALF_DAYS)
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

            window = float(settings.STOCK_DIRECT_CONSUMPTION_WINDOW_DAYS)
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
                         - depletion_date < today + STOCK_SEVERITY_CRITICAL_DAYS
            'low'      — orange. Triggers:
                         Tipo 2 (depletion present): days_left < STOCK_SEVERITY_WARNING_DAYS
                         Tipo 1 (no depletion):      quantity_healthy < STOCK_LOW_THRESHOLD_UNITS
            'ok'       — green. Otherwise.

        See `docs/plans/stock-severity-revised.md`.
        """
        qty_available = self.get_quantity_available(obj)
        if qty_available == 0:
            return "critical"

        depletion = self._consumption_data(obj)["depletion_date"]
        if depletion is not None:
            days_left = (depletion - date.today()).days
            if days_left < settings.STOCK_SEVERITY_CRITICAL_DAYS:
                return "critical"
            if days_left < settings.STOCK_SEVERITY_WARNING_DAYS:
                return "low"
            return "ok"

        # Tipo 1 — no consumption estimate; fall back to healthy-units count.
        if self.get_quantity_healthy(obj) >= settings.STOCK_LOW_THRESHOLD_UNITS:
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
        cutoff = today + timedelta(days=settings.STOCK_SEVERITY_WARNING_DAYS)
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

    def _get_override(self, obj):
        """Return the viewer's UserStockGroup row for `obj` (or None).

        ``None`` when there is no request, when the viewer is the stock's
        owner (the owner's group lives on ``Stock.group`` directly, no
        override concept applies), or when no override row exists. Reads
        from the prefetched ``_my_group_override`` attribute populated by
        ``StockViewSet.get_queryset`` to stay query-free in list endpoints.
        """
        request = self.context.get("request")
        if not request or obj.user_id == request.user.id:
            return None
        overrides = getattr(obj, "_my_group_override", None) or []
        return overrides[0] if overrides else None

    def get_my_group(self, obj):
        override = self._get_override(obj)
        return override.group_id if override else None

    def get_my_group_name(self, obj):
        override = self._get_override(obj)
        if not override or not override.group:
            return None
        return override.group.name


class StockConsumptionSerializer(FlexFieldsModelSerializer):
    stock_name = serializers.CharField(source="stock.name", read_only=True)
    consumed_by_id = serializers.IntegerField(source="consumed_by.id", read_only=True, default=None)
    consumed_by_display_name = serializers.CharField(source="consumed_by.display_name", read_only=True, default=None)

    class Meta:
        model = StockConsumption
        fields = [
            "id",
            "stock",
            "stock_name",
            "quantity",
            "consumed_lots",
            "notes",
            "consumed_by_id",
            "consumed_by_display_name",
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
            "consumed_by_id",
            "consumed_by_display_name",
            "created_at",
            "updated_at",
            "client_created_at",
        ]


class RoutineSerializer(SharedWithMixin, FlexFieldsModelSerializer):
    """Serializer for Routine items.

    Raw fields a generic API consumer should rely on to compute its own
    interpretation of "due":

    - ``interval_hours`` — recurrence period.
    - ``last_entry_at`` — ISO timestamp of the most recent completion (UTC).
    - ``next_due_at`` — ISO timestamp of the next due moment (UTC), derived
      from ``last_entry_at + interval_hours``.
    - ``user_timezone`` — IANA string of the routine owner. Use it to render
      ``next_due_at`` / ``last_entry_at`` in local time and to apply any
      day-bucket logic the client needs.
    - ``stock`` (FK), ``stock_name``, ``stock_quantity``,
      ``stock_quantity_available`` — current state of the linked stock, if any.

    Convenience fields, **Nudge-specific**: ``is_due``, ``is_overdue``,
    ``hours_until_due``. They encode Nudge's policy ("due today in the
    owner's timezone" / "the exact due moment has passed"). A consumer
    that wants different semantics (e.g. "due this week", "due in less
    than 6 hours UTC") should ignore these and recompute from the raw
    fields above. They may be omitted in future versions.
    """

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
    owner_id = serializers.IntegerField(source="user.id", read_only=True)
    owner_display_name = serializers.CharField(source="user.display_name", read_only=True)
    user_timezone = serializers.CharField(source="user.timezone", read_only=True)

    backdated_first_entry_at = serializers.DateTimeField(
        write_only=True,
        required=False,
        allow_null=True,
        help_text=(
            "Optional. When creating a routine, pre-dates the first "
            "RoutineEntry to this timestamp so the routine doesn't become "
            "immediately overdue. Useful when adding a routine that the "
            "user has already been doing prior to setup. Must not be in "
            "the future."
        ),
    )

    class Meta:
        model = Routine
        fields = [
            "id",
            "name",
            "description",
            "interval_hours",
            "reminder_mode",
            "reminder_interval_minutes",
            "respect_quiet_hours",
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
            "user_timezone",
            "is_due",
            "is_overdue",
            "hours_until_due",
            "requires_lot_selection",
            "shared_with",
            "shared_with_details",
            "is_owner",
            "owner_id",
            "owner_display_name",
            "backdated_first_entry_at",
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
            "owner_id",
            "owner_display_name",
            "user_timezone",
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

    def validate_backdated_first_entry_at(self, value):
        if value and value > timezone.now():
            raise serializers.ValidationError("Cannot be in the future.")
        return value

    def create(self, validated_data):
        backdated_at = validated_data.pop("backdated_first_entry_at", None)
        routine = super().create(validated_data)
        if backdated_at:
            RoutineEntry.objects.create(routine=routine, created_at=backdated_at)
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
        stock = obj.stock
        if "lots" in stock.__dict__.get("_prefetched_objects_cache", {}):
            return any(lot.lot_number and lot.quantity > 0 for lot in stock.lots.all())
        return stock.lots.filter(quantity__gt=0).exclude(lot_number="").exists()


class RoutineEntrySerializer(FlexFieldsModelSerializer):
    routine_name = serializers.CharField(source="routine.name", read_only=True)
    stock_name = serializers.CharField(source="routine.stock.name", read_only=True, default=None)
    completed_by_id = serializers.IntegerField(source="completed_by.id", read_only=True, default=None)
    completed_by_display_name = serializers.CharField(source="completed_by.display_name", read_only=True, default=None)

    class Meta:
        model = RoutineEntry
        fields = [
            "id",
            "routine",
            "routine_name",
            "stock_name",
            "completed_by_id",
            "completed_by_display_name",
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
            "completed_by_id",
            "completed_by_display_name",
        ]
