"""Wipe business data and seed a deterministic fixture for E2E tests.

Every Playwright run calls this (via `POST /api/internal/e2e-seed/`) so the
suite starts from an identical database state. The wipe is destructive — a
triple gate (DEBUG=True OR E2E_SEED_ALLOWED=true) keeps it out of production.

Fixture (T073):

- 3 users (user1, user2, user3) + mutual contacts.
- 7 routines owned by user1, covering 6 state combinations + a blocked case:
    * Take vitamins         — 24h, no stock,  overdue       (30 entries)
    * Morning stretch       — 24h, no stock,  never started (0 entries)
    * Weekly cleaning       — 168h (7d), no stock, upcoming (4 entries)
    * Water filter          — 2160h (90d), with stock, never started (0)
    * Vitamin D supplement  — 48h, with stock, upcoming     (15 entries)
    * Medication            — 8h, with stock, overdue, shared (40+2 entries)
    * Pain relief           — 6h, with stock=0, blocked     (0 entries)
- 5 stocks with varied lot distribution:
    * Vitamin D       — 3 lots (near-expiry SN, far SN, no-SN with expiry)
    * Filter cartridge — 1 lot (no SN, no expiry)
    * Pills           — 3 lots, shared with user2
    * Ibuprofen       — 1 lot with quantity=0 (blocks Pain relief)
    * Personal stock (user2) — 1 lot
- ~91 routine entries + 6 stock consumptions over the last 60 days,
  concentrated in 2–3 routines to stress History pagination.

The "upcoming" state is more fragile than it looks: `Routine.is_due()`
rounds to the user's local date, so a 24h interval with a recent last
entry can still evaluate as "due today" depending on the hour the seed
runs. We use 48h for `vitamin_d_supplement` and 168h for
`weekly_cleaning` to guarantee `due_date > today` regardless of the
wall-clock time of the seed run.
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

USERNAMES = ["user1", "user2", "user3"]

ROUTINES = {
    "take_vitamins": "Take vitamins",
    "morning_stretch": "Morning stretch",
    "weekly_cleaning": "Weekly cleaning",
    "water_filter": "Water filter",
    "vitamin_d_supplement": "Vitamin D supplement",
    "medication": "Medication",
    "pain_relief": "Pain relief",
}

STOCKS = {
    "vitamin_d": "Vitamin D",
    "filter_cartridge": "Filter cartridge",
    "pills": "Pills",
    "ibuprofen": "Ibuprofen",
    "personal": "Personal stock",
}


class Command(BaseCommand):
    help = "Wipes business data and seeds a deterministic fixture for E2E tests."

    def handle(self, *args, **options):
        self._assert_gate()
        self.stdout.write(self.style.WARNING("⚠ WIPING DATABASE — DEV/E2E ONLY"))

        with transaction.atomic():
            self._wipe()
            users = self._create_users()
            self._create_contacts(users)
            stocks = self._create_stocks(users)
            routines = self._create_routines(users, stocks)
            self._create_history(users, routines, stocks)

        self.stdout.write(self.style.SUCCESS("E2E seed complete."))

    # ── Gate ────────────────────────────────────────────────────────────────

    def _assert_gate(self):
        if settings.DEBUG:
            return
        if os.environ.get("E2E_SEED_ALLOWED", "").lower() == "true":
            return
        raise CommandError("seed_e2e refused to run: DEBUG is False and E2E_SEED_ALLOWED is not 'true'.")

    # ── Wipe ────────────────────────────────────────────────────────────────

    def _wipe(self):
        # Order respects FK dependencies. Models with CASCADE on user deletion
        # still get wiped explicitly so the wipe is robust to future schema
        # changes.
        StockConsumption.objects.all().delete()
        RoutineEntry.objects.all().delete()
        NotificationState.objects.all().delete()
        StockLot.objects.all().delete()
        Routine.objects.all().delete()
        Stock.objects.all().delete()
        StockGroup.objects.all().delete()
        PushSubscription.objects.all().delete()
        IdempotencyRecord.objects.all().delete()
        # Drop all non-superuser accounts. The admin user (created by
        # `ensure_admin` at startup) is preserved — E2E specs log in as admin
        # for admin.spec.js and other superuser flows.
        User.objects.filter(is_superuser=False).delete()

    # ── Users ───────────────────────────────────────────────────────────────

    def _create_users(self):
        specs = [
            {
                "username": "user1",
                "password": os.environ.get("E2E_USER1_PASSWORD", "e2e-pass-1"),
                "timezone": "Europe/Madrid",
                "language": "en",
                "daily_notification_time": time(8, 0),
            },
            {
                "username": "user2",
                "password": os.environ.get("E2E_USER2_PASSWORD", "e2e-pass-2"),
                "timezone": "America/New_York",
                "language": "es",
                "daily_notification_time": time(9, 0),
            },
            {
                "username": "user3",
                "password": os.environ.get("E2E_USER3_PASSWORD", "e2e-pass-3"),
                "timezone": "UTC",
                "language": "gl",
                "daily_notification_time": time(7, 0),
            },
        ]
        users = {}
        for spec in specs:
            password = spec.pop("password")
            user = User.objects.create_user(is_active=True, **spec)
            user.set_password(password)
            user.save(update_fields=["password"])
            users[spec["username"]] = user
        return users

    def _create_contacts(self, users):
        # User.contacts is symmetrical — adding u1→u2 also creates u2→u1.
        user_list = list(users.values())
        for i, u1 in enumerate(user_list):
            for u2 in user_list[i + 1 :]:
                u1.contacts.add(u2)

    # ── Stocks ──────────────────────────────────────────────────────────────

    def _create_stocks(self, users):
        user1, user2, _user3 = users["user1"], users["user2"], users["user3"]
        today = timezone.localdate()
        stocks = {}

        # Vitamin D — 3 lots exercising the dedup matrix:
        # "VIT-A" near-expiry (SN + expiry), "VIT-B" far (SN + expiry),
        # and one with NO lot_number but an expiry_date (for the "no SN +
        # matching expiry → merge" dedup test in T037).
        stocks["vitamin_d"] = Stock.objects.create(user=user1, name=STOCKS["vitamin_d"])
        StockLot.objects.create(
            stock=stocks["vitamin_d"],
            quantity=5,
            expiry_date=today + timedelta(days=7),
            lot_number="VIT-A",
        )
        StockLot.objects.create(
            stock=stocks["vitamin_d"],
            quantity=30,
            expiry_date=today + timedelta(days=180),
            lot_number="VIT-B",
        )
        StockLot.objects.create(
            stock=stocks["vitamin_d"],
            quantity=20,
            expiry_date=today + timedelta(days=60),
            lot_number="",
        )

        # Filter cartridge — 1 lot, no SN and no expiry. Exercises the
        # "no alert" case in T037 test 2.
        stocks["filter_cartridge"] = Stock.objects.create(user=user1, name=STOCKS["filter_cartridge"])
        StockLot.objects.create(stock=stocks["filter_cartridge"], quantity=1)

        # Pills — 3 lots at different expiries, shared with user2.
        stocks["pills"] = Stock.objects.create(user=user1, name=STOCKS["pills"])
        stocks["pills"].shared_with.add(user2)
        for i, offset in enumerate([30, 60, 90], start=1):
            StockLot.objects.create(
                stock=stocks["pills"],
                quantity=10,
                expiry_date=today + timedelta(days=offset),
                lot_number=f"PILL-{i}",
            )

        # Ibuprofen — depleted (quantity=0). The post_save signal
        # `delete_empty_lot` would remove this lot on a normal create(); we
        # use bulk_create to bypass signals. The lot must exist so the UI
        # can render "Ibuprofen: 0 u." and the Pain relief routine can show
        # the "no stock available" block in T036.
        stocks["ibuprofen"] = Stock.objects.create(user=user1, name=STOCKS["ibuprofen"])
        StockLot.objects.bulk_create(
            [
                StockLot(
                    stock=stocks["ibuprofen"],
                    quantity=0,
                    expiry_date=today + timedelta(days=45),
                    lot_number="IBU-1",
                ),
            ]
        )

        # Personal stock (owned by user2).
        stocks["personal"] = Stock.objects.create(user=user2, name=STOCKS["personal"])
        StockLot.objects.create(stock=stocks["personal"], quantity=5, lot_number="PERS-1")

        return stocks

    # ── Routines ────────────────────────────────────────────────────────────

    def _create_routines(self, users, stocks):
        user1, user2, _user3 = users["user1"], users["user2"], users["user3"]
        routines = {}

        routines["take_vitamins"] = Routine.objects.create(
            user=user1,
            name=ROUTINES["take_vitamins"],
            interval_hours=24,
        )
        routines["morning_stretch"] = Routine.objects.create(
            user=user1,
            name=ROUTINES["morning_stretch"],
            interval_hours=24,
        )
        routines["weekly_cleaning"] = Routine.objects.create(
            user=user1,
            name=ROUTINES["weekly_cleaning"],
            interval_hours=168,
        )
        routines["water_filter"] = Routine.objects.create(
            user=user1,
            name=ROUTINES["water_filter"],
            interval_hours=24 * 90,
            stock=stocks["filter_cartridge"],
        )
        # 48h (not 24h) so next_due always lands on "tomorrow or later" in
        # the user's local TZ regardless of when the seed runs. See module
        # docstring for the reasoning.
        routines["vitamin_d_supplement"] = Routine.objects.create(
            user=user1,
            name=ROUTINES["vitamin_d_supplement"],
            interval_hours=48,
            stock=stocks["vitamin_d"],
        )
        routines["medication"] = Routine.objects.create(
            user=user1,
            name=ROUTINES["medication"],
            interval_hours=8,
            stock=stocks["pills"],
        )
        routines["medication"].shared_with.add(user2)
        routines["pain_relief"] = Routine.objects.create(
            user=user1,
            name=ROUTINES["pain_relief"],
            interval_hours=6,
            stock=stocks["ibuprofen"],
        )

        return routines

    # ── History ─────────────────────────────────────────────────────────────

    def _create_history(self, users, routines, stocks):
        user1, user2, _user3 = users["user1"], users["user2"], users["user3"]
        now = timezone.now()

        # Take vitamins — overdue, 30 entries spanning ~45 days. Last entry
        # 72h ago: next_due = last + 24h = 48h ago → due_date is 2 days ago
        # in user1's TZ → is_due() True → overdue.
        for i in range(30):
            RoutineEntry.objects.create(
                routine=routines["take_vitamins"],
                completed_by=user1,
                created_at=now - timedelta(hours=72 + i * 36),
            )

        # Medication — overdue, 40 entries of user1 + 2 of user2 over ~16
        # days. Last user1 entry 48h ago with interval 8h → well overdue.
        # A few entries carry notes so History tests can assert filtering
        # by text.
        for i in range(40):
            RoutineEntry.objects.create(
                routine=routines["medication"],
                completed_by=user1,
                notes="morning dose" if i % 3 == 0 else "",
                created_at=now - timedelta(hours=48 + i * 9),
            )
        RoutineEntry.objects.create(
            routine=routines["medication"],
            completed_by=user2,
            created_at=now - timedelta(days=1, hours=2),
        )
        RoutineEntry.objects.create(
            routine=routines["medication"],
            completed_by=user2,
            created_at=now - timedelta(days=6, hours=4),
        )

        # Vitamin D supplement — upcoming, 15 entries, daily cadence. Last
        # entry 8h ago with interval 48h → next_due ≈ 40h → tomorrow or
        # later in user1's TZ → upcoming.
        for i in range(15):
            RoutineEntry.objects.create(
                routine=routines["vitamin_d_supplement"],
                completed_by=user1,
                created_at=now - timedelta(hours=8 + i * 24),
            )

        # Weekly cleaning — upcoming, 4 entries, weekly cadence. Last 48h
        # ago with interval 168h → 5 days in the future → upcoming.
        for i in range(4):
            RoutineEntry.objects.create(
                routine=routines["weekly_cleaning"],
                completed_by=user1,
                created_at=now - timedelta(hours=48 + i * 168),
            )

        # Direct stock consumptions (not tied to routines). Useful for
        # History filtering tests and for warming the consumption log.
        for days_ago in [2, 5, 10]:
            StockConsumption.objects.create(
                stock=stocks["vitamin_d"],
                consumed_by=user1,
                quantity=1,
                created_at=now - timedelta(days=days_ago),
            )
        for days_ago in [3, 7]:
            StockConsumption.objects.create(
                stock=stocks["pills"],
                consumed_by=user1,
                quantity=1,
                created_at=now - timedelta(days=days_ago),
            )
        StockConsumption.objects.create(
            stock=stocks["personal"],
            consumed_by=user2,
            quantity=1,
            created_at=now - timedelta(days=4),
        )
