import logging

from django.db import transaction
from django.db.models import F, Prefetch
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.notifications.models import NotificationState

from .models import Routine, RoutineEntry, Stock, StockLot
from .serializers import RoutineEntrySerializer, RoutineSerializer, StockLotSerializer, StockSerializer

logger = logging.getLogger(__name__)


class StockViewSet(viewsets.ModelViewSet):
    serializer_class = StockSerializer

    def get_queryset(self):
        return Stock.objects.filter(user=self.request.user).prefetch_related("lots")

    def perform_create(self, serializer):
        stock = serializer.save(user=self.request.user)
        logger.info("Stock %s created by user %s.", stock.id, self.request.user.id)

    def perform_destroy(self, instance):
        logger.info("Stock %s deleted by user %s.", instance.id, self.request.user.id)
        super().perform_destroy(instance)


class StockLotViewSet(viewsets.ModelViewSet):
    serializer_class = StockLotSerializer
    http_method_names = ["post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        stock_pk = self.kwargs.get("stock_pk")
        return StockLot.objects.filter(
            stock__user=self.request.user,
            stock_id=stock_pk,
        )

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
        return Routine.objects.filter(user=self.request.user).select_related("stock").prefetch_related(latest_entry)

    def perform_create(self, serializer):
        routine = serializer.save(user=self.request.user)
        logger.info("Routine %s created by user %s.", routine.id, self.request.user.id)

    def perform_destroy(self, instance):
        logger.info("Routine %s deleted by user %s.", instance.id, self.request.user.id)
        super().perform_destroy(instance)

    @action(detail=True, methods=["get"], url_path="lots-for-selection")
    def lots_for_selection(self, request, pk=None):
        """
        Return the available lots expanded into individual units (FEFO order).
        Used to populate the lot selection modal on the frontend.
        """
        routine = self.get_object()
        if not routine.stock:
            return Response([])

        units = []
        lots = (
            routine.stock.lots.filter(quantity__gt=0)
            .order_by(F("expiry_date").asc(nulls_last=True), "created_at")
        )
        for lot in lots:
            lot_number = lot.lot_number or None
            expiry_date = lot.expiry_date.isoformat() if lot.expiry_date else None
            for i in range(1, lot.quantity + 1):
                units.append({
                    "lot_id": lot.id,
                    "lot_number": lot_number,
                    "expiry_date": expiry_date,
                    "unit_index": i,
                })
        return Response(units)

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
                    valid_ids = set(
                        routine.stock.lots.filter(id__in=lot_ids).values_list("id", flat=True)
                    )
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
                        lot = StockLot.objects.select_for_update().get(
                            id=sel["lot_id"], stock=routine.stock
                        )
                        consume = min(lot.quantity, qty)
                        lot.quantity -= consume
                        lot.save(update_fields=["quantity"])
                        consumed_lots.append({
                            "lot_number": lot.lot_number or None,
                            "expiry_date": lot.expiry_date.isoformat() if lot.expiry_date else None,
                            "quantity": consume,
                        })
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
                        consumed_lots.append({
                            "lot_number": lot.lot_number or None,
                            "expiry_date": lot.expiry_date.isoformat() if lot.expiry_date else None,
                            "quantity": consume,
                        })

                entry.consumed_lots = consumed_lots
                entry.save(update_fields=["consumed_lots"])
                routine.stock.save(update_fields=["updated_at"])

            # Reset notification state so the worker doesn't send stale reminders
            state, _ = NotificationState.objects.get_or_create(routine=routine)
            state.last_due_notification = None
            state.last_reminder = None
            state.save(update_fields=["last_due_notification", "last_reminder"])

        logger.info(
            "Routine %s logged by user %s (entry %s).",
            routine.id,
            request.user.id,
            entry.id,
        )
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


class RoutineEntryViewSet(viewsets.ReadOnlyModelViewSet):
    """Global entry history for the authenticated user."""

    serializer_class = RoutineEntrySerializer

    def get_queryset(self):
        qs = RoutineEntry.objects.filter(routine__user=self.request.user).select_related("routine")
        routine_id = self.request.query_params.get("routine")
        if routine_id:
            qs = qs.filter(routine_id=routine_id)
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
        Routine.objects.filter(user=request.user, is_active=True).select_related("stock").prefetch_related(latest_entry)
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
