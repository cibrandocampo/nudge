from datetime import timedelta

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import F, Sum
from django.utils import timezone


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
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.quantity})"

    @property
    def quantity(self):
        return self.lots.aggregate(total=Sum("quantity"))["total"] or 0


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

    class Meta:
        ordering = [F("expiry_date").asc(nulls_last=True), "created_at"]
        constraints = [
            models.CheckConstraint(condition=models.Q(quantity__gte=0), name="stocklot_qty_gte_0"),
        ]

    def __str__(self):
        label = self.lot_number or f"#{self.pk}"
        return f"{self.stock.name} — {label} ({self.quantity})"


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
                self._last_entry_cache = self.entries.order_by("-created_at").first()
        return self._last_entry_cache

    def next_due_at(self):
        last = self.last_entry()
        if last is None:
            # Never logged — already due
            return None
        return last.created_at + timedelta(hours=self.interval_hours)

    def is_due(self):
        due = self.next_due_at()
        if due is None:
            return True
        return timezone.now() >= due


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
    created_at = models.DateTimeField(default=timezone.now)
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
