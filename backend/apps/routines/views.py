import logging

from django.db import transaction
from django.db.models import F, Prefetch, Q
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.notifications.models import NotificationState

from .models import Routine, RoutineEntry, Stock, StockConsumption, StockGroup, StockLot
from .serializers import (
    RoutineEntrySerializer,
    RoutineSerializer,
    StockConsumptionSerializer,
    StockGroupSerializer,
    StockLotSerializer,
    StockSerializer,
)

logger = logging.getLogger(__name__)


class StockGroupViewSet(viewsets.ModelViewSet):
    serializer_class = StockGroupSerializer

    def get_queryset(self):
        return StockGroup.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class StockViewSet(viewsets.ModelViewSet):
    serializer_class = StockSerializer

    def get_queryset(self):
        return (
            Stock.objects.filter(Q(user=self.request.user) | Q(shared_with=self.request.user))
            .distinct()
            .select_related("group", "user")
            .prefetch_related("lots", "shared_with")
            .order_by("name")
        )

    def perform_create(self, serializer):
        stock = serializer.save(user=self.request.user)
        logger.info("Stock %r created (user %s).", stock.name, self.request.user.username)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.user != request.user:
            return Response({"detail": "Only the owner can edit this stock."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.user != request.user:
            return Response({"detail": "Only the owner can delete this stock."}, status=status.HTTP_403_FORBIDDEN)
        logger.info("Stock %r deleted (user %s).", instance.name, request.user.username)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["get"], url_path="lots-for-selection")
    def lots_for_selection(self, request, pk=None):
        """
        Return available lots grouped (one row per lot, FEFO order).
        Used to populate the lot selection modal when consuming stock directly.
        """
        stock = self.get_object()
        lots = stock.lots.filter(quantity__gt=0).order_by(F("expiry_date").asc(nulls_last=True), "created_at")
        data = [
            {
                "lot_id": lot.id,
                "lot_number": lot.lot_number or None,
                "expiry_date": lot.expiry_date.isoformat() if lot.expiry_date else None,
                "quantity": lot.quantity,
            }
            for lot in lots
        ]
        return Response(data)

    @action(detail=True, methods=["post"], url_path="consume")
    def consume(self, request, pk=None):
        """
        Consume units from a stock item directly (without a routine).
        Accepts optional lot_selections; otherwise uses FEFO.
        """
        stock = self.get_object()
        try:
            quantity = int(request.data.get("quantity", 1))
        except (TypeError, ValueError):
            return Response({"quantity": "Must be a positive integer."}, status=status.HTTP_400_BAD_REQUEST)
        if quantity <= 0:
            return Response({"quantity": "Must be > 0."}, status=status.HTTP_400_BAD_REQUEST)

        lot_selections = request.data.get("lot_selections")

        with transaction.atomic():
            consumed_lots = []

            if lot_selections is not None:
                total = sum(sel.get("quantity", 0) for sel in lot_selections)
                if total != quantity:
                    return Response(
                        {"lot_selections": "Total quantity must equal quantity."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                lot_ids = [sel["lot_id"] for sel in lot_selections]
                valid_ids = set(stock.lots.filter(id__in=lot_ids).values_list("id", flat=True))
                invalid = set(lot_ids) - valid_ids
                if invalid:
                    return Response(
                        {"lot_selections": "One or more lot_ids are invalid."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                for sel in lot_selections:
                    qty = sel["quantity"]
                    if qty <= 0:
                        continue
                    lot = StockLot.objects.select_for_update().get(id=sel["lot_id"], stock=stock)
                    consume_qty = min(lot.quantity, qty)
                    lot.quantity -= consume_qty
                    lot.save(update_fields=["quantity"])
                    consumed_lots.append(
                        {
                            "lot_number": lot.lot_number or None,
                            "expiry_date": lot.expiry_date.isoformat() if lot.expiry_date else None,
                            "quantity": consume_qty,
                        }
                    )
            else:
                remaining = quantity
                for lot in (
                    stock.lots.select_for_update()
                    .filter(quantity__gt=0)
                    .order_by(F("expiry_date").asc(nulls_last=True), "created_at")
                ):
                    if remaining <= 0:
                        break
                    consume = min(lot.quantity, remaining)
                    lot.quantity -= consume
                    lot.save(update_fields=["quantity"])
                    remaining -= consume
                    consumed_lots.append(
                        {
                            "lot_number": lot.lot_number or None,
                            "expiry_date": lot.expiry_date.isoformat() if lot.expiry_date else None,
                            "quantity": consume,
                        }
                    )

            StockConsumption.objects.create(
                stock=stock,
                consumed_by=request.user,
                quantity=quantity,
                consumed_lots=consumed_lots,
            )
            stock.save(update_fields=["updated_at"])

        logger.info("Stock %r consumed %d unit(s) (user %s).", stock.name, quantity, request.user.username)
        stock.refresh_from_db()
        stock = Stock.objects.prefetch_related("lots").get(pk=stock.pk)
        return Response(StockSerializer(stock).data)


class StockLotViewSet(viewsets.ModelViewSet):
    serializer_class = StockLotSerializer
    http_method_names = ["post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        stock_pk = self.kwargs.get("stock_pk")
        return StockLot.objects.filter(
            Q(stock__user=self.request.user) | Q(stock__shared_with=self.request.user),
            stock_id=stock_pk,
        ).distinct()

    def perform_create(self, serializer):
        stock_pk = self.kwargs.get("stock_pk")
        try:
            stock = Stock.objects.get(pk=stock_pk, user=self.request.user)
        except Stock.DoesNotExist:
            raise PermissionDenied("Stock item not found.")
        serializer.save(stock=stock)


class RoutineViewSet(viewsets.ModelViewSet):
    serializer_class = RoutineSerializer

    def get_queryset(self):
        latest_entry = Prefetch(
            "entries",
            queryset=RoutineEntry.objects.order_by("-created_at"),
            to_attr="_prefetched_entries",
        )
        return (
            Routine.objects.filter(Q(user=self.request.user) | Q(shared_with=self.request.user))
            .distinct()
            .select_related("stock", "user")
            .prefetch_related(latest_entry, "shared_with")
        )

    def perform_create(self, serializer):
        routine = serializer.save(user=self.request.user)
        logger.info("Routine %r created (user %s).", routine.name, self.request.user.username)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.user != request.user:
            return Response({"detail": "Only the owner can edit this routine."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.user != request.user:
            return Response({"detail": "Only the owner can delete this routine."}, status=status.HTTP_403_FORBIDDEN)
        logger.info("Routine %r deleted (user %s).", instance.name, request.user.username)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["get"], url_path="lots-for-selection")
    def lots_for_selection(self, request, pk=None):
        """
        Return available lots grouped (one row per lot, FEFO order).
        Used to populate the lot selection modal on the frontend.
        """
        routine = self.get_object()
        if not routine.stock:
            return Response([])

        lots = routine.stock.lots.filter(quantity__gt=0).order_by(F("expiry_date").asc(nulls_last=True), "created_at")
        data = [
            {
                "lot_id": lot.id,
                "lot_number": lot.lot_number or None,
                "expiry_date": lot.expiry_date.isoformat() if lot.expiry_date else None,
                "quantity": lot.quantity,
            }
            for lot in lots
        ]
        return Response(data)

    @action(detail=True, methods=["post"], url_path="log")
    def log(self, request, pk=None):
        """
        Log a routine execution (create a RoutineEntry).
        Decrements stock quantity in FEFO order if a stock item is linked.
        Accepts optional lot_selections to specify which lots to consume.
        Resets notification state for this cycle.
        """
        routine = self.get_object()
        lot_selections = request.data.get("lot_selections")

        with transaction.atomic():
            entry = RoutineEntry.objects.create(
                routine=routine,
                completed_by=request.user,
                notes=request.data.get("notes", ""),
            )
            # Invalidate cached last_entry so subsequent calls see the new entry
            routine._last_entry_cache = entry

            if routine.stock:
                consumed_lots = []

                if lot_selections is not None:
                    # Validate total quantity matches stock_usage
                    total = sum(sel.get("quantity", 0) for sel in lot_selections)
                    if total != routine.stock_usage:
                        return Response(
                            {"lot_selections": "Total quantity must equal stock_usage."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    # Validate lot_ids belong to this routine's stock
                    lot_ids = [sel["lot_id"] for sel in lot_selections]
                    valid_ids = set(routine.stock.lots.filter(id__in=lot_ids).values_list("id", flat=True))
                    invalid = set(lot_ids) - valid_ids
                    if invalid:
                        return Response(
                            {"lot_selections": "One or more lot_ids are invalid."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    # Decrement specified lots
                    for sel in lot_selections:
                        qty = sel["quantity"]
                        if qty <= 0:
                            continue
                        lot = StockLot.objects.select_for_update().get(id=sel["lot_id"], stock=routine.stock)
                        consume = min(lot.quantity, qty)
                        lot.quantity -= consume
                        lot.save(update_fields=["quantity"])
                        consumed_lots.append(
                            {
                                "lot_number": lot.lot_number or None,
                                "expiry_date": lot.expiry_date.isoformat() if lot.expiry_date else None,
                                "quantity": consume,
                            }
                        )
                else:
                    # Decrement stock using FEFO (First Expired, First Out)
                    remaining = routine.stock_usage
                    for lot in (
                        routine.stock.lots.select_for_update()
                        .filter(quantity__gt=0)
                        .order_by(F("expiry_date").asc(nulls_last=True), "created_at")
                    ):
                        if remaining <= 0:
                            break
                        consume = min(lot.quantity, remaining)
                        lot.quantity -= consume
                        lot.save(update_fields=["quantity"])
                        remaining -= consume
                        consumed_lots.append(
                            {
                                "lot_number": lot.lot_number or None,
                                "expiry_date": lot.expiry_date.isoformat() if lot.expiry_date else None,
                                "quantity": consume,
                            }
                        )

                entry.consumed_lots = consumed_lots
                entry.save(update_fields=["consumed_lots"])
                routine.stock.save(update_fields=["updated_at"])

            # Reset notification state so the worker doesn't send stale reminders
            state, _ = NotificationState.objects.get_or_create(routine=routine)
            state.last_due_notification = None
            state.last_reminder = None
            state.save(update_fields=["last_due_notification", "last_reminder"])

        logger.info("Routine %r logged (user %s).", routine.name, request.user.username)
        return Response(RoutineEntrySerializer(entry).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="entries")
    def entries(self, request, pk=None):
        """Return the full entry history for a single routine."""
        routine = self.get_object()
        qs = routine.entries.all()
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(RoutineEntrySerializer(page, many=True).data)
        return Response(RoutineEntrySerializer(qs, many=True).data)


class StockConsumptionViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """List stock consumptions and edit notes."""

    serializer_class = StockConsumptionSerializer

    def get_queryset(self):
        qs = (
            StockConsumption.objects.filter(
                Q(stock__user=self.request.user) | Q(stock__shared_with=self.request.user),
            )
            .distinct()
            .select_related("stock", "consumed_by")
        )
        stock_id = self.request.query_params.get("stock")
        if stock_id:
            qs = qs.filter(stock_id=stock_id)
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        return qs


class RoutineEntryViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Global entry history for the authenticated user."""

    serializer_class = RoutineEntrySerializer

    def get_queryset(self):
        qs = (
            RoutineEntry.objects.filter(
                Q(routine__user=self.request.user) | Q(routine__shared_with=self.request.user),
            )
            .distinct()
            .select_related("routine", "routine__stock", "completed_by")
        )
        routine_id = self.request.query_params.get("routine")
        if routine_id:
            qs = qs.filter(routine_id=routine_id)
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        return qs


@api_view(["GET"])
def dashboard(request):
    """
    Returns routines split into two groups:
    - due: already overdue or never logged
    - upcoming: not yet due, ordered by next due date
    """
    latest_entry = Prefetch(
        "entries",
        queryset=RoutineEntry.objects.order_by("-created_at"),
        to_attr="_prefetched_entries",
    )
    routines = (
        Routine.objects.filter(
            Q(user=request.user) | Q(shared_with=request.user),
            is_active=True,
        )
        .distinct()
        .select_related("stock", "user")
        .prefetch_related(latest_entry, "shared_with")
    )

    due = []
    upcoming = []

    for routine in routines:
        is_due = routine.is_due()
        serialized = RoutineSerializer(routine, context={"request": request}).data

        if is_due:
            due.append(serialized)
        else:
            upcoming.append(serialized)

    # Sort upcoming by next_due_at ascending
    upcoming.sort(key=lambda r: r["next_due_at"] or "")

    return Response({"due": due, "upcoming": upcoming})
