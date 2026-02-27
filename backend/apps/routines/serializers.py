from datetime import date, timedelta

from django.utils import timezone
from rest_framework import serializers

from .models import Routine, RoutineEntry, Stock, StockLot


class StockLotSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockLot
        fields = ["id", "quantity", "expiry_date", "lot_number", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_quantity(self, value):
        if value < 0:
            raise serializers.ValidationError("Quantity cannot be negative.")
        return value

    def validate_expiry_date(self, value):
        if value and value < date.today():
            raise serializers.ValidationError("Expiry date cannot be in the past.")
        return value


class StockSerializer(serializers.ModelSerializer):
    lots = StockLotSerializer(many=True, read_only=True)
    quantity = serializers.SerializerMethodField()
    has_expiring_lots = serializers.SerializerMethodField()
    expiring_lots = serializers.SerializerMethodField()

    class Meta:
        model = Stock
        fields = ["id", "name", "quantity", "lots", "has_expiring_lots", "expiring_lots", "updated_at"]
        read_only_fields = ["id", "quantity", "lots", "has_expiring_lots", "expiring_lots", "updated_at"]

    def get_quantity(self, obj):
        # Use prefetched lots if available to avoid an extra aggregate query
        if "lots" in obj.__dict__.get("_prefetched_objects_cache", {}):
            return sum(lot.quantity for lot in obj.lots.all())
        return obj.quantity

    def _expiring_lots(self, obj):
        """Return expiring lots from the prefetch cache (no extra queries)."""
        threshold = date.today() + timedelta(days=90)
        return [
            lot
            for lot in obj.lots.all()
            if lot.expiry_date is not None and lot.expiry_date <= threshold and lot.quantity > 0
        ]

    def get_has_expiring_lots(self, obj):
        return len(self._expiring_lots(obj)) > 0

    def get_expiring_lots(self, obj):
        return StockLotSerializer(self._expiring_lots(obj), many=True).data


class RoutineSerializer(serializers.ModelSerializer):
    # Read-only convenience field so the frontend doesn't need an extra request
    stock_name = serializers.CharField(source="stock.name", read_only=True)
    stock_quantity = serializers.IntegerField(source="stock.quantity", read_only=True)

    # Computed fields
    last_entry_at = serializers.SerializerMethodField()
    next_due_at = serializers.SerializerMethodField()
    is_due = serializers.SerializerMethodField()
    hours_until_due = serializers.SerializerMethodField()

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
            "stock_usage",
            "is_active",
            "created_at",
            "updated_at",
            "last_entry_at",
            "next_due_at",
            "is_due",
            "hours_until_due",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "stock_name", "stock_quantity"]

    def validate_stock(self, value):
        # Ensure the stock item belongs to the requesting user
        request = self.context.get("request")
        if value and request and value.user != request.user:
            raise serializers.ValidationError("Invalid stock item.")
        return value

    def get_last_entry_at(self, obj):
        last = obj.last_entry()
        return last.created_at if last else None

    def get_next_due_at(self, obj):
        return obj.next_due_at()

    def get_is_due(self, obj):
        return obj.is_due()

    def get_hours_until_due(self, obj):
        due = obj.next_due_at()
        if due is None:
            return None
        delta = (due - timezone.now()).total_seconds() / 3600
        return round(delta, 1)


class RoutineEntrySerializer(serializers.ModelSerializer):
    routine_name = serializers.CharField(source="routine.name", read_only=True)

    class Meta:
        model = RoutineEntry
        fields = ["id", "routine", "routine_name", "created_at", "notes"]
        read_only_fields = ["id", "routine", "created_at"]
