import logging
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import F, Prefetch, Q
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.mixins import OptimisticLockingMixin
from apps.core.permissions import IsOwner
from apps.notifications.models import NotificationState
from apps.notifications.push import notify_routine_shared, notify_stock_shared

from .models import Routine, RoutineEntry, Stock, StockConsumption, StockGroup, StockLot, UserStockGroup
from .serializers import (
    ClientTimestampInputSerializer,
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


class StockViewSet(OptimisticLockingMixin, viewsets.ModelViewSet):
    serializer_class = StockSerializer

    def get_queryset(self):
        active_routines = Prefetch(
            "routines",
            queryset=Routine.objects.filter(is_active=True).select_related("user"),
            to_attr="active_routines",
        )
        # Mirrors `StockSerializer.DIRECT_CONSUMPTION_WINDOW_DAYS` — kept
        # locally to avoid a circular import at module load time.
        consumptions_window_start = timezone.now() - timedelta(days=60)
        recent_consumptions = Prefetch(
            "consumptions",
            queryset=StockConsumption.objects.filter(client_created_at__gte=consumptions_window_start),
            to_attr="recent_consumptions",
        )
        return (
            Stock.objects.filter(Q(user=self.request.user) | Q(shared_with=self.request.user))
            .distinct()
            .select_related("group", "user")
            .prefetch_related(
                "lots",
                "shared_with",
                active_routines,
                recent_consumptions,
                Prefetch(
                    "group_overrides",
                    queryset=UserStockGroup.objects.select_related("group").filter(user=self.request.user),
                    to_attr="_my_group_override",
                ),
            )
            .order_by("name")
        )

    def get_permissions(self):
        if self.action in ("update", "partial_update", "destroy"):
            return [IsAuthenticated(), IsOwner()]
        return super().get_permissions()

    def perform_create(self, serializer):
        stock = serializer.save(user=self.request.user)
        logger.info("Stock %r created (user %s).", stock.name, self.request.user.username)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        previous_shared = set(instance.shared_with.values_list("pk", flat=True))
        response = super().update(request, *args, **kwargs)
        instance.refresh_from_db()
        new_shared = set(instance.shared_with.values_list("pk", flat=True))
        for user_pk in new_shared - previous_shared:
            new_user = get_user_model().objects.filter(pk=user_pk).first()
            if new_user:
                notify_stock_shared(instance, new_user)
        return response

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        logger.info("Stock %r deleted (user %s).", instance.name, request.user.username)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["patch"], url_path="my-group")
    def my_group(self, request, pk=None):
        """Set the requesting user's personal group for this stock."""
        stock = self.get_object()
        group_id = request.data.get("group")

        if group_id is not None:
            try:
                group = StockGroup.objects.get(id=group_id, user=request.user)
            except StockGroup.DoesNotExist:
                return Response(
                    {"group": ["Invalid group."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            group = None

        if stock.user == request.user:
            stock.group = group
            stock.save(update_fields=["group"])
        else:
            usg, _ = UserStockGroup.objects.update_or_create(
                user=request.user,
                stock=stock,
                defaults={"group": group},
            )
            stock._my_group_override = [usg]

        serializer = self.get_serializer(stock)
        return Response(serializer.data)

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

        ts_serializer = ClientTimestampInputSerializer(data=request.data)
        ts_serializer.is_valid(raise_exception=True)
        client_created_at = ts_serializer.validated_data.get("client_created_at")

        lot_selections = request.data.get("lot_selections")

        with transaction.atomic():
            consumed_lots = stock.consume_lots(quantity, lot_selections)
            consumption_kwargs = {
                "stock": stock,
                "consumed_by": request.user,
                "quantity": quantity,
                "consumed_lots": consumed_lots,
            }
            if client_created_at is not None:
                consumption_kwargs["client_created_at"] = client_created_at
            StockConsumption.objects.create(**consumption_kwargs)
            stock.save(update_fields=["updated_at"])

        logger.info("Stock %r consumed %d unit(s) (user %s).", stock.name, quantity, request.user.username)
        stock.refresh_from_db()
        stock = Stock.objects.prefetch_related("lots").get(pk=stock.pk)
        return Response(StockSerializer(stock).data)


class StockLotViewSet(OptimisticLockingMixin, viewsets.ModelViewSet):
    serializer_class = StockLotSerializer
    http_method_names = ["post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        stock_pk = self.kwargs.get("stock_pk")
        return StockLot.objects.filter(
            Q(stock__user=self.request.user) | Q(stock__shared_with=self.request.user),
            stock_id=stock_pk,
        ).distinct()

    def _get_stock_for_create(self):
        stock_pk = self.kwargs.get("stock_pk")
        try:
            return Stock.objects.get(pk=stock_pk, user=self.request.user)
        except Stock.DoesNotExist:
            raise PermissionDenied("Stock item not found.")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        stock = self._get_stock_for_create()
        data = serializer.validated_data
        existing = StockLot.objects.filter(
            stock=stock,
            lot_number=data.get("lot_number", ""),
            expiry_date=data.get("expiry_date"),
        ).first()
        if existing:
            existing.quantity = F("quantity") + data["quantity"]
            existing.save(update_fields=["quantity"])
            existing.refresh_from_db()
            return Response(
                StockLotSerializer(existing).data,
                status=status.HTTP_201_CREATED,
            )
        serializer.save(stock=stock)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class RoutineViewSet(OptimisticLockingMixin, viewsets.ModelViewSet):
    serializer_class = RoutineSerializer

    def get_queryset(self):
        latest_entry = Prefetch(
            "entries",
            queryset=RoutineEntry.objects.order_by("-client_created_at"),
            to_attr="_prefetched_entries",
        )
        return (
            Routine.objects.filter(Q(user=self.request.user) | Q(shared_with=self.request.user))
            .distinct()
            .select_related("stock", "user")
            .prefetch_related(latest_entry, "shared_with")
        )

    def get_permissions(self):
        if self.action in ("update", "partial_update", "destroy"):
            return [IsAuthenticated(), IsOwner()]
        return super().get_permissions()

    def perform_create(self, serializer):
        routine = serializer.save(user=self.request.user)
        logger.info("Routine %r created (user %s).", routine.name, self.request.user.username)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        previous_shared = set(instance.shared_with.values_list("pk", flat=True))
        response = super().update(request, *args, **kwargs)
        instance.refresh_from_db()
        new_shared = set(instance.shared_with.values_list("pk", flat=True))
        for user_pk in new_shared - previous_shared:
            new_user = get_user_model().objects.filter(pk=user_pk).first()
            if new_user:
                notify_routine_shared(instance, new_user)
        return response

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        logger.info("Routine %r deleted (user %s).", instance.name, request.user.username)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="log")
    def log(self, request, pk=None):
        """
        Log a routine execution (create a RoutineEntry).
        Decrements stock quantity in FEFO order if a stock item is linked.
        Accepts optional lot_selections to specify which lots to consume.
        Resets notification state for this cycle.
        """
        routine = self.get_object()

        ts_serializer = ClientTimestampInputSerializer(data=request.data)
        ts_serializer.is_valid(raise_exception=True)
        client_created_at = ts_serializer.validated_data.get("client_created_at")

        lot_selections = request.data.get("lot_selections")

        # Refuse to log when the routine has a linked stock whose total
        # quantity is below `stock_usage`. Otherwise the entry would be
        # recorded as "consumed" while no stock actually existed — an
        # audit hole that also let `pain_relief` (seeded with 0-qty
        # Ibuprofen) be marked done without blocking in the UI.
        if routine.stock and routine.stock.quantity < routine.stock_usage:
            return Response(
                {
                    "detail": "Insufficient stock to log this routine.",
                    "code": "insufficient_stock",
                    "required": routine.stock_usage,
                    "available": routine.stock.quantity,
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        with transaction.atomic():
            entry_kwargs = {
                "routine": routine,
                "completed_by": request.user,
                "notes": request.data.get("notes", ""),
            }
            if client_created_at is not None:
                entry_kwargs["client_created_at"] = client_created_at
            entry = RoutineEntry.objects.create(**entry_kwargs)
            # Invalidate cached last_entry so subsequent calls see the new entry
            routine._last_entry_cache = entry

            if routine.stock:
                consumed_lots = routine.stock.consume_lots(routine.stock_usage, lot_selections)
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


class StockConsumptionViewSet(
    OptimisticLockingMixin,
    mixins.ListModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
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
            qs = qs.filter(client_created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(client_created_at__date__lte=date_to)
        return qs


class RoutineEntryViewSet(
    OptimisticLockingMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
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
            qs = qs.filter(client_created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(client_created_at__date__lte=date_to)
        return qs

    def destroy(self, request, *args, **kwargs):
        """
        Delete a routine entry and restore the consumed stock.

        Used by the Undo flow after "Mark done" (T036): clicking the
        toast's Undo button within its lifetime must fully reverse the
        action. For each lot listed in `entry.consumed_lots` we look
        up the matching StockLot (by lot_number + expiry_date) and
        increment its quantity — or re-create the lot if the
        `delete_empty_lot` signal wiped it when the last unit was
        consumed.
        """
        entry = self.get_object()
        # Only the owner can delete history entries. Shared users can see
        # but not undo another user's action.
        if entry.routine.user_id != request.user.id:
            return Response(
                {"detail": "Only the owner can delete this entry."},
                status=status.HTTP_403_FORBIDDEN,
            )

        with transaction.atomic():
            stock = entry.routine.stock
            if stock and entry.consumed_lots:
                for lot_data in entry.consumed_lots:
                    qty = int(lot_data.get("quantity", 0) or 0)
                    if qty <= 0:
                        continue
                    lot_number = lot_data.get("lot_number") or ""
                    expiry_date = lot_data.get("expiry_date")
                    lot = (
                        StockLot.objects.select_for_update()
                        .filter(stock=stock, lot_number=lot_number, expiry_date=expiry_date)
                        .first()
                    )
                    if lot is not None:
                        lot.quantity += qty
                        lot.save(update_fields=["quantity"])
                    else:
                        StockLot.objects.create(
                            stock=stock,
                            lot_number=lot_number,
                            expiry_date=expiry_date,
                            quantity=qty,
                        )
            entry.delete()

        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def dashboard(request):
    """
    Returns routines split into two groups:
    - due: already overdue or never logged
    - upcoming: not yet due, ordered by next due date
    """
    latest_entry = Prefetch(
        "entries",
        queryset=RoutineEntry.objects.order_by("-client_created_at"),
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
