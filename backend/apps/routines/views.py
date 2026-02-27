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

    @action(detail=True, methods=["post"], url_path="log")
    def log(self, request, pk=None):
        """
        Log a routine execution (create a RoutineEntry).
        Decrements stock quantity in FEFO order if a stock item is linked.
        Resets notification state for this cycle.
        """
        routine = self.get_object()

        with transaction.atomic():
            entry = RoutineEntry.objects.create(
                routine=routine,
                notes=request.data.get("notes", ""),
            )
            # Invalidate cached last_entry so subsequent calls see the new entry
            routine._last_entry_cache = entry

            # Decrement stock using FEFO (First Expired, First Out)
            if routine.stock:
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
