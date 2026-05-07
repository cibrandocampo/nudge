from datetime import date, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.db.models import F, Q, Sum
from django.db.models.signals import m2m_changed, post_save
from django.dispatch import receiver
from django.utils import timezone
from rest_framework import serializers


class StockGroup(models.Model):
    """User-defined grouping for stock items (e.g. 'Diabetes', 'Household')."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="stock_groups",
    )
    name = models.CharField(max_length=100)
    display_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["display_order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "name"],
                name="unique_stock_group_per_user",
            ),
        ]

    def __str__(self):
        return self.name


class Stock(models.Model):
    """
    A consumable item with a tracked quantity managed via StockLot entries.
    Independent of any specific routine — multiple routines can reference
    the same stock item (e.g. two machines sharing the same filter type).
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="stocks",
    )
    name = models.CharField(max_length=200)
    shared_with = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="shared_stocks",
    )
    group = models.ForeignKey(
        StockGroup,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="stocks",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.quantity})"

    @property
    def quantity(self):
        if "lots" in self.__dict__.get("_prefetched_objects_cache", {}):
            return sum(lot.quantity for lot in self.lots.all())
        return self.lots.aggregate(total=Sum("quantity"))["total"] or 0

    @property
    def quantity_available(self):
        """Sum of qty across lots that are NOT expired today.

        A lot counts as consumable when it has no expiry_date or its
        expiry_date is strictly after today. Used by `StockSerializer` and
        `RoutineSerializer` as the basis for severity calculation, depletion
        estimation, and the user-facing "X ud." figure.

        Prefetch-aware: when the caller has prefetched `lots`, the partition
        is computed in Python from the cached list. Otherwise it falls back
        to a single aggregate query. This keeps `RoutineSerializer.stock_quantity_available`
        (which reaches through `source="stock.quantity_available"`) free of
        per-routine queries when the viewset prefetches `stock__lots`.
        """
        today = date.today()
        if "lots" in self.__dict__.get("_prefetched_objects_cache", {}):
            return sum(lot.quantity for lot in self.lots.all() if lot.expiry_date is None or lot.expiry_date > today)
        agg = self.lots.filter(Q(expiry_date__isnull=True) | Q(expiry_date__gt=today)).aggregate(total=Sum("quantity"))
        return agg["total"] or 0

    @transaction.atomic
    def consume_lots(self, quantity, lot_selections=None):
        """
        Decrement units from this stock, either via explicit lot
        selections (each {lot_id, quantity}) or FEFO fallback.

        Args:
            quantity: total units to consume.
            lot_selections: optional list of dicts
                [{"lot_id": int, "quantity": int}, ...]. When None, FEFO
                (First Expired, First Out) consumes from earliest expiry
                until `quantity` reached or lots exhausted.

        Returns: list of consumed_lot dicts
            [{"lot_number", "expiry_date", "quantity"}, ...]

        Raises:
            rest_framework.serializers.ValidationError on bad input.
            DRF translates to 400 when this bubbles from a viewset action.
        """
        consumed_lots = []

        if lot_selections is not None:
            total = sum(sel.get("quantity", 0) for sel in lot_selections)
            if total != quantity:
                raise serializers.ValidationError({"lot_selections": "Total quantity must equal quantity."})
            lot_ids = [sel["lot_id"] for sel in lot_selections]
            valid_ids = set(self.lots.filter(id__in=lot_ids).values_list("id", flat=True))
            invalid = set(lot_ids) - valid_ids
            if invalid:
                raise serializers.ValidationError({"lot_selections": "One or more lot_ids are invalid."})
            for sel in lot_selections:
                qty = sel["quantity"]
                if qty <= 0:
                    continue
                lot = StockLot.objects.select_for_update().get(id=sel["lot_id"], stock=self)
                consume_qty = min(lot.quantity, qty)
                lot.quantity -= consume_qty
                lot.save(update_fields=["quantity"])
                consumed_lots.append(_lot_consumed_dict(lot, consume_qty))
        else:
            remaining = quantity
            for lot in (
                self.lots.select_for_update()
                .filter(quantity__gt=0)
                .order_by(F("expiry_date").asc(nulls_last=True), "created_at")
            ):
                if remaining <= 0:
                    break
                consume = min(lot.quantity, remaining)
                lot.quantity -= consume
                lot.save(update_fields=["quantity"])
                remaining -= consume
                consumed_lots.append(_lot_consumed_dict(lot, consume))

        return consumed_lots


def _lot_consumed_dict(lot, qty):
    """Build the dict shape used by `Stock.consume_lots` for each consumed lot.

    Centralised so the format stays in sync between the explicit-selection
    and FEFO branches.
    """
    return {
        "lot_number": lot.lot_number or None,
        "expiry_date": lot.expiry_date.isoformat() if lot.expiry_date else None,
        "quantity": qty,
    }


class UserStockGroup(models.Model):
    """Per-user group assignment for a stock.

    The owner's group lives in Stock.group. For every other user who has
    access to a shared stock, their personal category is stored here.
    One record per (user, stock) pair; group may be null (= uncategorised).
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="stock_group_overrides",
    )
    stock = models.ForeignKey(
        "Stock",
        on_delete=models.CASCADE,
        related_name="group_overrides",
    )
    group = models.ForeignKey(
        "StockGroup",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="stock_overrides",
    )

    class Meta:
        unique_together = [("user", "stock")]


class StockLot(models.Model):
    """
    A single batch/lot of a Stock item with its own quantity and optional expiry.
    FEFO ordering: lots with sooner expiry_date are consumed first.
    Lots without expiry_date are ordered last (treated as far future).
    """

    stock = models.ForeignKey(
        Stock,
        on_delete=models.CASCADE,
        related_name="lots",
    )
    quantity = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    expiry_date = models.DateField(null=True, blank=True)
    lot_number = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = [F("expiry_date").asc(nulls_last=True), "created_at"]
        constraints = [
            models.CheckConstraint(condition=models.Q(quantity__gte=0), name="stocklot_qty_gte_0"),
        ]

    def __str__(self):
        label = self.lot_number or f"#{self.pk}"
        return f"{self.stock.name} — {label} ({self.quantity})"


@receiver(post_save, sender=StockLot)
def delete_empty_lot(sender, instance, **kwargs):
    if instance.quantity == 0:
        instance.delete()


@receiver(m2m_changed, sender=Stock.shared_with.through)
def unlink_routines_on_unshare(sender, instance, action, pk_set, **kwargs):
    """When users are removed from a stock's shared_with, unlink their routines."""
    if action == "post_remove" and pk_set:
        Routine.objects.filter(stock=instance, user_id__in=pk_set).update(stock=None)
        UserStockGroup.objects.filter(user_id__in=pk_set, stock=instance).delete()
    elif action == "post_clear":
        Routine.objects.filter(stock=instance).exclude(user=instance.user).update(stock=None)
        UserStockGroup.objects.filter(stock=instance).delete()


class StockConsumption(models.Model):
    """Audit record of a direct stock consumption (outside routines)."""

    stock = models.ForeignKey(
        Stock,
        on_delete=models.CASCADE,
        related_name="consumptions",
    )
    consumed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="stock_consumptions",
    )
    quantity = models.PositiveIntegerField(
        validators=[MinValueValidator(1)],
    )
    consumed_lots = models.JSONField(
        default=list,
        blank=True,
        help_text="Lots consumed: [{lot_number, expiry_date, quantity}]",
    )
    notes = models.CharField(max_length=1000, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    # Functional time: the moment the user actually performed the consumption,
    # captured by the client (works offline). Defaults to `now()` server-side
    # for admin / direct-API writes that don't send the field. `created_at`
    # remains audit-only — see docs/plans/client-time-as-source-of-truth.md.
    client_created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.stock.name} — consumed {self.quantity} — {self.created_at:%Y-%m-%d %H:%M}"

    @property
    def effective_created_at(self):
        return self.client_created_at or self.created_at


class Routine(models.Model):
    """
    A recurring task that must be performed at regular intervals.
    Optionally linked to a Stock item that gets decremented on each entry.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="routines",
    )
    shared_with = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="shared_routines",
    )
    name = models.CharField(max_length=200)
    description = models.CharField(max_length=1000, blank=True)
    interval_hours = models.PositiveIntegerField(
        validators=[MinValueValidator(1)],
        help_text="Number of hours between entries (minimum 1)",
    )
    stock = models.ForeignKey(
        Stock,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="routines",
        help_text="Optional stock item consumed on each entry",
    )
    stock_usage = models.PositiveIntegerField(
        default=1,
        validators=[MinValueValidator(1)],
        help_text="Units deducted from stock per entry",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def last_entry(self):
        if not hasattr(self, "_last_entry_cache"):
            if hasattr(self, "_prefetched_entries"):
                self._last_entry_cache = self._prefetched_entries[0] if self._prefetched_entries else None
            else:
                self._last_entry_cache = self.entries.order_by("-client_created_at").first()
        return self._last_entry_cache

    def next_due_at(self):
        last = self.last_entry()
        if last is None:
            # Never logged — already due
            return None
        # Use the effective action time (client_created_at when provided,
        # else server-assigned created_at). Keeps due-time math correct for
        # entries synced from offline.
        return last.effective_created_at + timedelta(hours=self.interval_hours)

    def is_overdue(self):
        """True when the exact due time has passed (or routine was never logged)."""
        due = self.next_due_at()
        if due is None:
            return True
        return timezone.now() >= due

    def is_due(self):
        """True when the routine is due today or already overdue (user's local date)."""
        due = self.next_due_at()
        if due is None:
            return True
        user_tz = ZoneInfo(self.user.timezone)
        due_date = due.astimezone(user_tz).date()
        today = timezone.now().astimezone(user_tz).date()
        return today >= due_date


class RoutineEntry(models.Model):
    """
    Audit record of a single routine execution.
    The most recent entry determines when the next due date is.
    """

    routine = models.ForeignKey(
        Routine,
        on_delete=models.CASCADE,
        related_name="entries",
    )
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="completed_entries",
    )
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    # Functional time: the moment the user actually marked the routine done,
    # captured by the client (works offline). Defaults to `now()` server-side
    # for admin / direct-API writes that don't send the field. `created_at`
    # remains audit-only — see docs/plans/client-time-as-source-of-truth.md.
    client_created_at = models.DateTimeField(default=timezone.now)
    notes = models.CharField(max_length=1000, blank=True)
    consumed_lots = models.JSONField(
        default=list,
        blank=True,
        help_text="Lots consumed in this entry: [{lot_number, expiry_date, quantity}]",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "routine entries"

    def __str__(self):
        return f"{self.routine.name} — {self.created_at:%Y-%m-%d %H:%M}"

    @property
    def effective_created_at(self):
        return self.client_created_at or self.created_at
