"""Wipe business data and seed a deterministic fixture for marketing screenshots.

Mirrors `seed_e2e.py` structurally but produces a compact, realistic
fixture tuned for the "How it works" landing section (see
`docs/plans/marketing-lifecycle-section.md` and `docs/tasks/T082`).

Fixture:

- 2 users:
    * alex   (primary, EN, Europe/Madrid, 08:00 daily)
    * jordan (shared contact, EN, Europe/Madrid, 09:00 daily)
- Mutual contacts.
- 2 stock groups owned by alex: Health, Home.
- 5 stocks owned by alex:
    * Brita filter cartridge  — 1 lot, shared with jordan (Home)
    * Vitamin D 1000IU        — 2 lots, FEFO order (Health)
    * Descaling tablets       — 1 lot (Home)
    * Cactus food             — 1 lot with quantity=0 (Home)
    * Coffee machine pods     — 1 lot (Home)
- 4 routines owned by alex:
    * Take Vitamin D            (24h,  stock=Vitamin D)
    * Change Brita filter       (720h, stock=Brita, shared with jordan)
    * Water the cactus          (168h, no stock)
    * Clean the coffee machine  (336h, stock=Coffee pods)

No RoutineEntry, StockConsumption, NotificationState or PushSubscription
rows are created. "Take Vitamin D" renders as due-today because
`Routine.is_due()` returns True for never-run routines (verified in
`apps/routines/models.py`: `next_due_at()` returns None when the
last entry is None, and `is_due()` short-circuits True on None).

The "Cactus food" zero-quantity lot is inserted via `StockLot.objects.
bulk_create([...])` to bypass the `delete_empty_lot` `post_save` signal.
A plain `create(quantity=0)` would be deleted immediately after save.

Triple gate identical to `seed_e2e`: refuses to run unless DEBUG is True
OR `E2E_SEED_ALLOWED=true`.
"""

import os
from datetime import time, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.idempotency.models import IdempotencyRecord
from apps.notifications.models import NotificationState, PushSubscription
from apps.routines.models import (
    Routine,
    RoutineEntry,
    Stock,
    StockConsumption,
    StockGroup,
    StockLot,
)

User = get_user_model()


class Command(BaseCommand):
    help = "Wipes business data and seeds a deterministic fixture for marketing screenshots."

    def handle(self, *args, **options):
        self._assert_gate()
        self.stdout.write(self.style.WARNING("⚠ WIPING DATABASE — DEV/MARKETING ONLY"))

        with transaction.atomic():
            self._wipe()
            users = self._create_users()
            self._create_contacts(users)
            groups = self._create_groups(users)
            stocks = self._create_stocks(users, groups)
            self._create_routines(users, stocks)

        self.stdout.write(self.style.SUCCESS("Marketing seed complete."))

    # ── Gate ────────────────────────────────────────────────────────────────

    def _assert_gate(self):
        if settings.DEBUG:
            return
        if os.environ.get("E2E_SEED_ALLOWED", "").lower() == "true":
            return
        raise CommandError("seed_marketing refused to run: DEBUG is False and E2E_SEED_ALLOWED is not 'true'.")

    # ── Wipe ────────────────────────────────────────────────────────────────

    def _wipe(self):
        # Order respects FK dependencies. Same order as seed_e2e._wipe().
        StockConsumption.objects.all().delete()
        RoutineEntry.objects.all().delete()
        NotificationState.objects.all().delete()
        StockLot.objects.all().delete()
        Routine.objects.all().delete()
        Stock.objects.all().delete()
        StockGroup.objects.all().delete()
        PushSubscription.objects.all().delete()
        IdempotencyRecord.objects.all().delete()
        # Keep superuser (admin) — matches seed_e2e.
        User.objects.filter(is_superuser=False).delete()

    # ── Users ───────────────────────────────────────────────────────────────

    def _create_users(self):
        password = os.environ.get("MARKETING_USER_PASSWORD", "marketing-pass")
        specs = [
            {
                "username": "alex",
                "timezone": "Europe/Madrid",
                "language": "en",
                "daily_notification_time": time(8, 0),
            },
            {
                "username": "jordan",
                "timezone": "Europe/Madrid",
                "language": "en",
                "daily_notification_time": time(9, 0),
            },
        ]
        users = {}
        for spec in specs:
            user = User.objects.create_user(is_active=True, **spec)
            user.set_password(password)
            user.save(update_fields=["password"])
            users[spec["username"]] = user
        return users

    def _create_contacts(self, users):
        # User.contacts is symmetrical — adding alex→jordan also creates jordan→alex.
        users["alex"].contacts.add(users["jordan"])

    # ── Stock groups ────────────────────────────────────────────────────────

    def _create_groups(self, users):
        alex = users["alex"]
        return {
            "health": StockGroup.objects.create(user=alex, name="Health"),
            "home": StockGroup.objects.create(user=alex, name="Home"),
        }

    # ── Stocks ──────────────────────────────────────────────────────────────

    def _create_stocks(self, users, groups):
        alex, jordan = users["alex"], users["jordan"]
        today = timezone.localdate()
        stocks = {}

        stocks["brita"] = Stock.objects.create(
            user=alex,
            name="Brita filter cartridge",
            group=groups["home"],
        )
        stocks["brita"].shared_with.add(jordan)
        StockLot.objects.create(
            stock=stocks["brita"],
            quantity=2,
            expiry_date=today + timedelta(days=180),
            lot_number="BRITA-2026",
        )

        # Vitamin D — 2 lots so the lot-selection modal has something to show.
        # Lot A is near-expiry (FEFO picks it first).
        stocks["vitamin_d"] = Stock.objects.create(
            user=alex,
            name="Vitamin D 1000IU",
            group=groups["health"],
        )
        StockLot.objects.create(
            stock=stocks["vitamin_d"],
            quantity=15,
            expiry_date=today + timedelta(days=45),
            lot_number="VD-A",
        )
        StockLot.objects.create(
            stock=stocks["vitamin_d"],
            quantity=60,
            expiry_date=today + timedelta(days=240),
            lot_number="VD-B",
        )

        stocks["descaling"] = Stock.objects.create(
            user=alex,
            name="Descaling tablets",
            group=groups["home"],
        )
        StockLot.objects.create(
            stock=stocks["descaling"],
            quantity=6,
            expiry_date=today + timedelta(days=300),
        )

        # Cactus food — bulk_create bypasses the delete_empty_lot signal so
        # the quantity=0 lot survives (the stock renders as depleted).
        stocks["cactus"] = Stock.objects.create(
            user=alex,
            name="Cactus food",
            group=groups["home"],
        )
        StockLot.objects.bulk_create(
            [
                StockLot(
                    stock=stocks["cactus"],
                    quantity=0,
                    expiry_date=today + timedelta(days=365),
                ),
            ]
        )

        stocks["coffee"] = Stock.objects.create(
            user=alex,
            name="Coffee machine pods",
            group=groups["home"],
        )
        StockLot.objects.create(
            stock=stocks["coffee"],
            quantity=10,
            expiry_date=today + timedelta(days=90),
        )

        return stocks

    # ── Routines ────────────────────────────────────────────────────────────

    def _create_routines(self, users, stocks):
        alex, jordan = users["alex"], users["jordan"]
        routines = {}

        routines["vitamin_d"] = Routine.objects.create(
            user=alex,
            name="Take Vitamin D",
            interval_hours=24,
            stock=stocks["vitamin_d"],
            stock_usage=1,
        )

        routines["brita"] = Routine.objects.create(
            user=alex,
            name="Change Brita filter",
            interval_hours=720,
            stock=stocks["brita"],
            stock_usage=1,
        )
        routines["brita"].shared_with.add(jordan)

        routines["cactus"] = Routine.objects.create(
            user=alex,
            name="Water the cactus",
            interval_hours=168,
        )

        routines["coffee"] = Routine.objects.create(
            user=alex,
            name="Clean the coffee machine",
            interval_hours=336,
            stock=stocks["coffee"],
            stock_usage=1,
        )

        return routines
