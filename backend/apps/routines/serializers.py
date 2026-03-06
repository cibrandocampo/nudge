from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import serializers

from .models import Routine, RoutineEntry, Stock, StockConsumption, StockGroup, StockLot

User = get_user_model()


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


class StockGroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockGroup
        fields = ["id", "name", "display_order", "created_at"]
        read_only_fields = ["id", "created_at"]


class StockSerializer(serializers.ModelSerializer):
    lots = StockLotSerializer(many=True, read_only=True)
    quantity = serializers.SerializerMethodField()
    group_name = serializers.CharField(source="group.name", read_only=True, default=None)
    has_expiring_lots = serializers.SerializerMethodField()
    expiring_lots = serializers.SerializerMethodField()
    requires_lot_selection = serializers.SerializerMethodField()
    shared_with = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=User.objects.all(),
        required=False,
    )
    shared_with_details = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()
    owner_username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = Stock
        fields = [
            "id",
            "name",
            "group",
            "group_name",
            "quantity",
            "lots",
            "has_expiring_lots",
            "expiring_lots",
            "requires_lot_selection",
            "shared_with",
            "shared_with_details",
            "is_owner",
            "owner_username",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "quantity",
            "group_name",
            "lots",
            "has_expiring_lots",
            "expiring_lots",
            "requires_lot_selection",
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

    def validate_shared_with(self, value):
        request = self.context.get("request")
        if not request:
            return value
        if self.instance and self.instance.user != request.user:
            raise serializers.ValidationError("Only the owner can modify shared_with.")
        contact_ids = set(request.user.contacts.values_list("pk", flat=True))
        for user in value:
            if user.pk not in contact_ids:
                raise serializers.ValidationError(f"User {user.pk} is not in your contacts.")
        return value

    def get_shared_with_details(self, obj):
        return [{"id": u.pk, "username": u.username} for u in obj.shared_with.all()]

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

    def get_requires_lot_selection(self, obj):
        # Use prefetch cache when available to avoid an extra query
        if "lots" in obj.__dict__.get("_prefetched_objects_cache", {}):
            return any(lot.lot_number and lot.quantity > 0 for lot in obj.lots.all())
        return obj.lots.filter(quantity__gt=0).exclude(lot_number="").exists()


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
        ]
        read_only_fields = [
            "id",
            "stock",
            "stock_name",
            "quantity",
            "consumed_lots",
            "consumed_by_username",
            "created_at",
        ]


class RoutineSerializer(serializers.ModelSerializer):
    # Read-only convenience field so the frontend doesn't need an extra request
    stock_name = serializers.CharField(source="stock.name", read_only=True)
    stock_quantity = serializers.IntegerField(source="stock.quantity", read_only=True)

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
            "requires_lot_selection",
            "shared_with_details",
            "is_owner",
            "owner_username",
        ]

    def validate_stock(self, value):
        request = self.context.get("request")
        if value and request and value.user != request.user:
            raise serializers.ValidationError("Invalid stock item.")
        return value

    def validate_shared_with(self, value):
        request = self.context.get("request")
        if not request:
            return value
        if self.instance and self.instance.user != request.user:
            raise serializers.ValidationError("Only the owner can modify shared_with.")
        contact_ids = set(request.user.contacts.values_list("pk", flat=True))
        for user in value:
            if user.pk not in contact_ids:
                raise serializers.ValidationError(f"User {user.pk} is not in your contacts.")
        return value

    def get_shared_with_details(self, obj):
        return [{"id": u.pk, "username": u.username} for u in obj.shared_with.all()]

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
        return last.created_at if last else None

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
            "notes",
            "consumed_lots",
        ]
        read_only_fields = [
            "id",
            "routine",
            "created_at",
            "consumed_lots",
            "stock_name",
            "completed_by_username",
        ]
