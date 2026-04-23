"""Wipe business data and seed a deterministic fixture for public screenshots.

One seed to drive every scene the consolidated `e2e/screenshots.js`
pipeline captures: login, dashboard, sharing popover, routine detail,
new-routine, inventory, stock detail, history, settings, shared
dashboard, offline banner, conflict modal, and the lot-selection
modal.

Fixture:

- 2 users (mutual contacts). Names avoid non-ASCII characters so the
  UI and any downstream tooling stay free of encoding surprises:
    * cibran (primary, EN, Europe/Madrid, 08:00 daily) — owns every
      stock and routine; subject of all captures except the shared
      dashboard scene.
    * maria  (shared contact, EN, Europe/Madrid, 09:00 daily) —
      login target for `shared-dashboard.png`.

- 3 stock groups owned by cibran: Home, Medicine cabinet, Roomba.

- 10 stocks owned by cibran:
    Home
      * Brita filter cartridges  — 1 lot, shared with maria
      * Orchid fertilizer tablets
      * Air purifier filter
    Medicine cabinet
      * Hidroferol drops  — 2 lots (FEFO order) — drives lot-selection
      * Ibuprofen 600mg   — 1 lot, shared with maria
      * Paracetamol 500mg — 1 lot
      * Toothbrush heads  — 1 lot
    Roomba
      * Side brushes      — 1 lot
      * Rollers           — 1 lot
      * Roomba filter     — 1 lot

- 5 routines owned by cibran:
    * Take Vitamin D             (240h,  stock=Hidroferol drops)       — due today + multi-lot
    * Change Brita filter        (720h,  stock=Brita, shared)          — sharing popover + maria dashboard
    * Water the cactus           (672h,  no stock)                     — target for offline-banner scene
    * Orchid fertilizer          (336h,  stock=Orchid fertilizer)
    * Replace air purifier filter (2160h, stock=Air purifier, shared)  — second shared routine

- 6 RoutineEntry rows + 1 StockConsumption:
    * Change Brita filter — 2 entries, 30d apart (due window lands ~today)
    * Orchid fertilizer   — 4 entries (3d, 14d, 28d, 42d ago) so the
                            default 15-day history filter renders
                            multiple dated rows
    * Ibuprofen 600mg     — 1 direct consumption 5d ago to surface the
                            "consumption" history row type alongside
                            the routine entries

"Take Vitamin D", "Replace air purifier filter", and "Water the
cactus" have no entries by design: `Routine.is_due()` short-circuits
to True when `last_entry()` is None, so they render as due regardless
of when the seed runs. Vitamin D backs the lot-selection modal,
Water the cactus backs the offline-banner scene (stock-less → Done
fires without a lot modal), and Air purifier gives the shared
dashboard a second entry for maria.

The screenshots pipeline hardcodes three names: `Take Vitamin D`,
`Hidroferol drops`, and `Water the cactus`. Renaming any of them
requires a matching update to `e2e/screenshots.js`.

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
        # ASCII-only first/last names so downstream tooling (exports,
        # screenshots, URL slugs) never trips on encoding differences.
        specs = [
            {
                "username": "cibran",
                "first_name": "Cibran",
                "last_name": "Docampo",
                "timezone": "Europe/Madrid",
                "language": "en",
                "daily_notification_time": time(8, 0),
            },
            {
                "username": "maria",
                "first_name": "Maria",
                "last_name": "Gonzalez",
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
            "home": StockGroup.objects.create(user=cibran, name="Home", display_order=0),
            "medicine": StockGroup.objects.create(user=cibran, name="Medicine cabinet", display_order=1),
            "roomba": StockGroup.objects.create(user=cibran, name="Roomba", display_order=2),
        }

    # ── Stocks ──────────────────────────────────────────────────────────────

    def _create_stocks(self, users, groups):
        cibran, maria = users["cibran"], users["maria"]
        today = timezone.localdate()
        stocks = {}

        # ── Home ────────────────────────────────────────────────────────────

        stocks["brita"] = Stock.objects.create(
            user=cibran,
            name="Brita filter cartridges",
            group=groups["home"],
        )
        stocks["brita"].shared_with.add(maria)
        StockLot.objects.create(
            stock=stocks["brita"],
            quantity=2,
            expiry_date=today + timedelta(days=180),
            lot_number="BRITA-2026",
        )

        stocks["orchid"] = Stock.objects.create(
            user=cibran,
            name="Orchid fertilizer tablets",
            group=groups["home"],
        )
        StockLot.objects.create(
            stock=stocks["orchid"],
            quantity=12,
            expiry_date=today + timedelta(days=365),
        )

        stocks["air_filter"] = Stock.objects.create(
            user=cibran,
            name="Air purifier filter",
            group=groups["home"],
        )
        StockLot.objects.create(
            stock=stocks["air_filter"],
            quantity=3,
            expiry_date=today + timedelta(days=210),
            lot_number="AIR-F12",
        )

        # ── Medicine cabinet ────────────────────────────────────────────────

        # Hidroferol — 2 lots so the lot-selection modal has something to
        # show. Lot A is near-expiry (FEFO picks it first).
        stocks["hidroferol"] = Stock.objects.create(
            user=cibran,
            name="Hidroferol drops",
            group=groups["medicine"],
        )
        StockLot.objects.create(
            stock=stocks["hidroferol"],
            quantity=3,
            expiry_date=today + timedelta(days=45),
            lot_number="HID-A",
        )
        StockLot.objects.create(
            stock=stocks["hidroferol"],
            quantity=10,
            expiry_date=today + timedelta(days=240),
            lot_number="HID-B",
        )

        stocks["ibuprofen"] = Stock.objects.create(
            user=cibran,
            name="Ibuprofen 600mg",
            group=groups["medicine"],
        )
        stocks["ibuprofen"].shared_with.add(maria)
        StockLot.objects.create(
            stock=stocks["ibuprofen"],
            quantity=20,
            expiry_date=today + timedelta(days=300),
            lot_number="IBU-2027",
        )

        stocks["paracetamol"] = Stock.objects.create(
            user=cibran,
            name="Paracetamol 500mg",
            group=groups["medicine"],
        )
        StockLot.objects.create(
            stock=stocks["paracetamol"],
            quantity=15,
            expiry_date=today + timedelta(days=400),
            lot_number="PCT-2028",
        )

        stocks["toothbrush"] = Stock.objects.create(
            user=cibran,
            name="Toothbrush heads",
            group=groups["medicine"],
        )
        StockLot.objects.create(stock=stocks["toothbrush"], quantity=4)

        # ── Roomba ──────────────────────────────────────────────────────────

        stocks["roomba_brushes"] = Stock.objects.create(
            user=cibran,
            name="Side brushes",
            group=groups["roomba"],
        )
        StockLot.objects.create(stock=stocks["roomba_brushes"], quantity=2)

        stocks["roomba_rollers"] = Stock.objects.create(
            user=cibran,
            name="Rollers",
            group=groups["roomba"],
        )
        StockLot.objects.create(stock=stocks["roomba_rollers"], quantity=1)

        stocks["roomba_filter"] = Stock.objects.create(
            user=cibran,
            name="Roomba filter",
            group=groups["roomba"],
        )
        StockLot.objects.create(stock=stocks["roomba_filter"], quantity=3)

        return stocks

    # ── Routines ────────────────────────────────────────────────────────────

    def _create_routines(self, users, stocks):
        cibran, maria = users["cibran"], users["maria"]
        routines = {}

        # Every 10 days; no entries → always due; multi-lot stock for the
        # lot-selection modal capture.
        routines["vitamin_d"] = Routine.objects.create(
            user=cibran,
            name="Take Vitamin D",
            interval_hours=240,
            stock=stocks["hidroferol"],
            stock_usage=1,
        )

        # Monthly. Shared with maria. History entries below land the next
        # due date near "today" so the dashboard shows it as due.
        routines["brita"] = Routine.objects.create(
            user=cibran,
            name="Change Brita filter",
            interval_hours=720,
            stock=stocks["brita"],
            stock_usage=1,
        )
        routines["brita"].shared_with.add(maria)

        # Every 4 weeks, stock-less — target for the offline-banner scene
        # (Done click fires useLogRoutine straight away, no lot modal).
        routines["cactus"] = Routine.objects.create(
            user=cibran,
            name="Water the cactus",
            interval_hours=672,
        )

        # Biweekly.
        routines["orchid"] = Routine.objects.create(
            user=cibran,
            name="Orchid fertilizer",
            interval_hours=336,
            stock=stocks["orchid"],
            stock_usage=1,
        )

        # Every 3 months, shared with maria — gives the shared dashboard a
        # second routine and the sharing popover a second candidate.
        routines["air_filter"] = Routine.objects.create(
            user=cibran,
            name="Replace air purifier filter",
            interval_hours=2160,
            stock=stocks["air_filter"],
            stock_usage=1,
        )
        routines["air_filter"].shared_with.add(maria)

        return routines

    # ── History ─────────────────────────────────────────────────────────────

    def _create_history(self, users, routines):
        cibran = users["cibran"]
        now = timezone.now()

        # Change Brita filter — 2 entries, 30d apart. Last entry ~30d ago
        # with a 720h (30d) interval → next_due lands around today, so the
        # routine reads as due/upcoming on the dashboard.
        for days_ago in [30, 60]:
            RoutineEntry.objects.create(
                routine=routines["brita"],
                completed_by=cibran,
                created_at=now - timedelta(days=days_ago),
            )

        # Orchid fertilizer — 4 entries on a biweekly cadence with the
        # most recent ones inside the default 15-day history filter.
        # Last entry ~3d ago with 336h (14d) interval → routine reads as
        # upcoming (not due), keeping the dashboard balanced between due
        # and upcoming.
        for days_ago in [3, 14, 28, 42]:
            RoutineEntry.objects.create(
                routine=routines["orchid"],
                completed_by=cibran,
                created_at=now - timedelta(days=days_ago, hours=3),
            )

        # A direct Ibuprofen consumption so the history page surfaces the
        # "consumption" row type (package icon) alongside routine
        # entries. Five days ago puts it inside the default 15-day
        # history filter.
        ibuprofen = routines["brita"].user.stocks.get(name="Ibuprofen 600mg")
        lot = ibuprofen.lots.first()
        StockConsumption.objects.create(
            stock=ibuprofen,
            consumed_by=cibran,
            quantity=1,
            created_at=now - timedelta(days=5, hours=2),
        )
        StockLot.objects.filter(pk=lot.pk).update(quantity=lot.quantity - 1)
