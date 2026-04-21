"""Wipe business data and seed a deterministic fixture for public screenshots.

One seed to drive every scene the consolidated `e2e/screenshots.js`
pipeline captures: the 12 scenes previously seeded inline by the old
`screenshots.js` (login, dashboard, sharing popover, routine detail,
new-routine, inventory, stock detail, history, settings, shared
dashboard, offline banner, conflict modal) plus the lot-selection
modal introduced in T082. Replaces the bitrotten `seed_demo.py` that
lived under `apps/routines/` and the `seed_marketing.py` from T082.

See `docs/plans/screenshots-pipeline-consolidation.md` and
`docs/tasks/T085` for the full rationale.

Fixture:

- 2 users (mutual contacts):
    * cibran (primary, EN, Europe/Madrid, 08:00 daily) — owns every
      stock and routine; subject of all captures except scene 10.
    * maria  (shared contact, EN, Europe/Madrid, 09:00 daily) —
      login target for `shared-dashboard.png`.
- 2 stock groups owned by cibran: Health, Home.
- 6 stocks owned by cibran:
    * Brita filter cartridge  — 1 lot, shared with maria (Home)
    * Vitamin D 1000IU        — 2 lots, FEFO order (Health) — drives lot-selection
    * Descaling tablets       — 1 lot (Home)
    * Cactus food             — 1 lot with quantity=0 (Home) — empty-state in inventory
    * Coffee machine pods     — 1 lot (Home)
    * Ibuprofen 600mg         — 1 lot, shared with maria (Health)
- 6 routines owned by cibran:
    * Take Vitamin D            (24h,  stock=Vitamin D)       — due today + multi-lot
    * Change Brita filter       (720h, stock=Brita, shared)   — sharing popover + maria dashboard
    * Water the cactus          (168h, no stock)              — target for offline-banner scene
    * Clean the coffee machine  (336h, stock=Coffee pods)
    * Morning stretch           (24h,  no stock)              — second stock-less routine
    * Take Ibuprofen            (8h,   stock=Ibuprofen, shared) — short interval + second shared
- 6 RoutineEntry rows:
    * Change Brita filter — 2 entries, 30d apart
    * Morning stretch     — 4 entries in the last week

"Take Vitamin D" has no entries by design: `Routine.is_due()`
short-circuits to True when `last_entry()` is None
(`apps/routines/models.py`), so the routine renders as "due today"
regardless of when the seed runs — essential for the dashboard and
lot-selection captures.

The "Cactus food" zero-quantity lot is inserted via
`StockLot.objects.bulk_create([...])` to bypass the
`delete_empty_lot` `post_save` signal. A plain `create(quantity=0)`
would be deleted immediately after save.

Triple gate identical to `seed_e2e`: refuses to run unless DEBUG is
True OR `E2E_SEED_ALLOWED=true`. Destructive — wipes every non-admin
user and all business data.
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
    help = "Wipes business data and seeds a deterministic fixture for public screenshots."

    def handle(self, *args, **options):
        self._assert_gate()
        self.stdout.write(self.style.WARNING("⚠ WIPING DATABASE — DEV/DEMO ONLY"))

        with transaction.atomic():
            self._wipe()
            users = self._create_users()
            self._create_contacts(users)
            groups = self._create_groups(users)
            stocks = self._create_stocks(users, groups)
            routines = self._create_routines(users, stocks)
            self._create_history(users, routines)

        self.stdout.write(self.style.SUCCESS("Demo seed complete."))

    # ── Gate ────────────────────────────────────────────────────────────────

    def _assert_gate(self):
        if settings.DEBUG:
            return
        if os.environ.get("E2E_SEED_ALLOWED", "").lower() == "true":
            return
        raise CommandError("seed_demo refused to run: DEBUG is False and E2E_SEED_ALLOWED is not 'true'.")

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
        password = os.environ.get("DEMO_USER_PASSWORD", "demo-pass")
        specs = [
            {
                "username": "cibran",
                "timezone": "Europe/Madrid",
                "language": "en",
                "daily_notification_time": time(8, 0),
            },
            {
                "username": "maria",
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
        # User.contacts is symmetrical — adding cibran→maria also creates maria→cibran.
        users["cibran"].contacts.add(users["maria"])

    # ── Stock groups ────────────────────────────────────────────────────────

    def _create_groups(self, users):
        cibran = users["cibran"]
        return {
            "health": StockGroup.objects.create(user=cibran, name="Health"),
            "home": StockGroup.objects.create(user=cibran, name="Home"),
        }

    # ── Stocks ──────────────────────────────────────────────────────────────

    def _create_stocks(self, users, groups):
        cibran, maria = users["cibran"], users["maria"]
        today = timezone.localdate()
        stocks = {}

        stocks["brita"] = Stock.objects.create(
            user=cibran,
            name="Brita filter cartridge",
            group=groups["home"],
        )
        stocks["brita"].shared_with.add(maria)
        StockLot.objects.create(
            stock=stocks["brita"],
            quantity=2,
            expiry_date=today + timedelta(days=180),
            lot_number="BRITA-2026",
        )

        # Vitamin D — 2 lots so the lot-selection modal has something to show.
        # Lot A is near-expiry (FEFO picks it first).
        stocks["vitamin_d"] = Stock.objects.create(
            user=cibran,
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
            user=cibran,
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
            user=cibran,
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
            user=cibran,
            name="Coffee machine pods",
            group=groups["home"],
        )
        StockLot.objects.create(
            stock=stocks["coffee"],
            quantity=10,
            expiry_date=today + timedelta(days=90),
        )

        stocks["ibuprofen"] = Stock.objects.create(
            user=cibran,
            name="Ibuprofen 600mg",
            group=groups["health"],
        )
        stocks["ibuprofen"].shared_with.add(maria)
        StockLot.objects.create(
            stock=stocks["ibuprofen"],
            quantity=20,
            expiry_date=today + timedelta(days=300),
        )

        return stocks

    # ── Routines ────────────────────────────────────────────────────────────

    def _create_routines(self, users, stocks):
        cibran, maria = users["cibran"], users["maria"]
        routines = {}

        routines["vitamin_d"] = Routine.objects.create(
            user=cibran,
            name="Take Vitamin D",
            interval_hours=24,
            stock=stocks["vitamin_d"],
            stock_usage=1,
        )

        routines["brita"] = Routine.objects.create(
            user=cibran,
            name="Change Brita filter",
            interval_hours=720,
            stock=stocks["brita"],
            stock_usage=1,
        )
        routines["brita"].shared_with.add(maria)

        routines["cactus"] = Routine.objects.create(
            user=cibran,
            name="Water the cactus",
            interval_hours=168,
        )

        routines["coffee"] = Routine.objects.create(
            user=cibran,
            name="Clean the coffee machine",
            interval_hours=336,
            stock=stocks["coffee"],
            stock_usage=1,
        )

        routines["stretch"] = Routine.objects.create(
            user=cibran,
            name="Morning stretch",
            interval_hours=24,
        )

        routines["ibuprofen"] = Routine.objects.create(
            user=cibran,
            name="Take Ibuprofen",
            interval_hours=8,
            stock=stocks["ibuprofen"],
            stock_usage=1,
        )
        routines["ibuprofen"].shared_with.add(maria)

        return routines

    # ── History ─────────────────────────────────────────────────────────────

    def _create_history(self, users, routines):
        cibran = users["cibran"]
        now = timezone.now()

        # Change Brita filter — 2 entries, 30d apart. Last entry ~30d ago with
        # a 720h (30d) interval → next_due lands around "today or within a
        # few days", so the routine still reads as due/upcoming on the
        # dashboard.
        for days_ago in [30, 60]:
            RoutineEntry.objects.create(
                routine=routines["brita"],
                completed_by=cibran,
                created_at=now - timedelta(days=days_ago),
            )

        # Morning stretch — 4 entries in the last week, daily cadence. Plenty
        # of material for the history capture without drowning it.
        for days_ago in [1, 2, 4, 6]:
            RoutineEntry.objects.create(
                routine=routines["stretch"],
                completed_by=cibran,
                created_at=now - timedelta(days=days_ago, hours=2),
            )
