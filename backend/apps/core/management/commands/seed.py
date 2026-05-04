"""Wipe business data and seed the unified Nudge demo fixture (T137).

One single seed command that replaces both `seed_e2e` and `seed_demo`. The
fixture is shaped to:

1. Cover every dimension the app models — never-started / due / overdue /
   upcoming / blocked routines · out / low / ok stock severities ·
   reached / soon / ok expiry severities · owner-only / shared-by-me /
   shared-with-me / private sharing modes · multi-lot FEFO · bulk_create
   to bypass `delete_empty_lot` · mixed lot SN/no-SN/no-expiry shapes.

2. Read like a real person's life rather than a QA matrix. The chosen
   protagonist is `cibran` (the maintainer): type-1 diabetes management
   (Hidroferol, pump cannulas, glucose sensors), home medicine cabinet
   (ibuprofen, paracetamol, antihistamine), travel (Biodramina), and
   shared household routines (Brita filter, orchid fertilizer, cactus,
   descale coffee — the last one owned by `maria`). `laura` is a third
   mutual contact with no resources, used by `unshare.spec.js`.

3. Be deterministic across runs. Every `created_at` is anchored to
   `now()` minus a fixed offset, never to wall-clock dates.

Triple gate identical to the previous seeds: refuses to run unless
DEBUG is True OR `E2E_SEED_ALLOWED=true`. Destructive — wipes every
non-admin user and all business data.

Single password env var: `DEMO_USERS_PASSWORD` (default `change-me`).
Applied to all three users.
"""

import os
from datetime import time, timedelta
from zoneinfo import ZoneInfo

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
    help = "Wipes business data and seeds the unified Nudge demo fixture."

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
            self._create_history(users, routines, stocks)

        self.stdout.write(self.style.SUCCESS("Seed complete."))

    # ── Gate ────────────────────────────────────────────────────────────────

    def _assert_gate(self):
        if settings.DEBUG:
            return
        if os.environ.get("E2E_SEED_ALLOWED", "").lower() == "true":
            return
        raise CommandError("seed refused to run: DEBUG is False and E2E_SEED_ALLOWED is not 'true'.")

    # ── Wipe ────────────────────────────────────────────────────────────────

    def _wipe(self):
        # FK-respecting order. Same as the previous seeds.
        StockConsumption.objects.all().delete()
        RoutineEntry.objects.all().delete()
        NotificationState.objects.all().delete()
        StockLot.objects.all().delete()
        Routine.objects.all().delete()
        Stock.objects.all().delete()
        StockGroup.objects.all().delete()
        PushSubscription.objects.all().delete()
        IdempotencyRecord.objects.all().delete()
        # Preserve the admin superuser (created by `ensure_admin` at boot).
        User.objects.filter(is_superuser=False).delete()

    # ── Users ───────────────────────────────────────────────────────────────

    def _create_users(self):
        password = os.environ.get("DEMO_USERS_PASSWORD", "change-me")
        # No first_name / last_name on purpose — keeps the displayLabel
        # helper (`first_name + last_name`, falls back to `username`)
        # rendering the username on chips, which is what the E2E specs
        # match against. Locale spread mirrors the previous E2E seed
        # (en / es / gl) so `i18n.spec.js` has a `gl` baseline to flip
        # to `en` from.
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
                "language": "es",
                "daily_notification_time": time(9, 0),
            },
            {
                "username": "laura",
                "timezone": "Europe/Madrid",
                "language": "gl",
                "daily_notification_time": time(8, 30),
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
        # User.contacts is symmetrical — adding u1→u2 also creates u2→u1.
        user_list = list(users.values())
        for i, u1 in enumerate(user_list):
            for u2 in user_list[i + 1 :]:
                u1.contacts.add(u2)

    # ── Stock groups ────────────────────────────────────────────────────────

    def _create_groups(self, users):
        # Owner-scoped. Maria's groups are independent rows from cibran's
        # despite sharing display names — `StockGroup` has no global unique.
        cibran, maria = users["cibran"], users["maria"]
        groups = {}
        for owner_username, name, order in [
            ("cibran", "Diabetes", 0),
            ("cibran", "Home", 1),
            ("cibran", "Medicine cabinet", 2),
            ("cibran", "Travel", 3),
            ("maria", "Home", 0),
            ("maria", "Medicine cabinet", 1),
        ]:
            owner = cibran if owner_username == "cibran" else maria
            groups[(owner_username, name)] = StockGroup.objects.create(user=owner, name=name, display_order=order)
        return groups

    # ── Stocks ──────────────────────────────────────────────────────────────

    def _create_stocks(self, users, groups):
        cibran, maria = users["cibran"], users["maria"]
        today = timezone.localdate()
        stocks = {}

        # ── Cibran — Diabetes ───────────────────────────────────────────────

        # Hidroferol drops — three lots (two with SN + one without) so the
        # E2E suite can exercise FEFO ordering and lot-dedup paths
        # (`stock-expiry.spec.js` asserts merge-by-(SN+expiry),
        # merge-by-(no-SN+expiry), and "different SN/expiry creates a new
        # row"). HID-A is the FEFO front (closest expiry, still valid);
        # HID-B is far; the third lot has no SN and a mid-range expiry.
        # Demo readout: `expiry_severity=soon` because HID-A expires in
        # 7 days.
        stocks["hidroferol"] = Stock.objects.create(
            user=cibran, name="Hidroferol drops", group=groups[("cibran", "Diabetes")]
        )
        StockLot.objects.create(
            stock=stocks["hidroferol"],
            quantity=5,
            expiry_date=today + timedelta(days=7),
            lot_number="HID-A",
        )
        StockLot.objects.create(
            stock=stocks["hidroferol"],
            quantity=30,
            expiry_date=today + timedelta(days=180),
            lot_number="HID-B",
        )
        StockLot.objects.create(
            stock=stocks["hidroferol"],
            quantity=20,
            expiry_date=today + timedelta(days=60),
        )

        # Insulin pump cannulas — qty=0 (bulk_create bypasses delete_empty_lot
        # so the lot survives at zero). Drives the `blocked` routine state.
        stocks["pump_cannulas"] = Stock.objects.create(
            user=cibran,
            name="Insulin pump cannulas",
            group=groups[("cibran", "Diabetes")],
        )
        StockLot.objects.bulk_create(
            [
                StockLot(
                    stock=stocks["pump_cannulas"],
                    quantity=0,
                    expiry_date=today + timedelta(days=90),
                    lot_number="CAN-A",
                ),
            ]
        )

        # Glucose monitor sensors — single lot already expired (bulk_create
        # bypasses `delete_empty_lot` to keep the qty=1 lot alive). Demo
        # case: a stock with `expiry_severity='reached'`. A real diabetic
        # might still be wearing this sensor while shopping for a fresh box.
        stocks["glucose_sensors"] = Stock.objects.create(
            user=cibran,
            name="Glucose monitor sensors",
            group=groups[("cibran", "Diabetes")],
        )
        StockLot.objects.bulk_create(
            [
                StockLot(
                    stock=stocks["glucose_sensors"],
                    quantity=1,
                    expiry_date=today - timedelta(days=3),
                    lot_number="SEN-OLD",
                ),
            ]
        )

        # ── Cibran — Medicine cabinet ───────────────────────────────────────

        # Ibuprofen — multi-lot same SKU, exercises FEFO ordering when picked
        # from the lot-selection modal.
        stocks["ibuprofen"] = Stock.objects.create(
            user=cibran,
            name="Ibuprofen 600mg",
            group=groups[("cibran", "Medicine cabinet")],
        )
        StockLot.objects.create(
            stock=stocks["ibuprofen"],
            quantity=12,
            expiry_date=today + timedelta(days=200),
            lot_number="IBU-1",
        )
        StockLot.objects.create(
            stock=stocks["ibuprofen"],
            quantity=8,
            expiry_date=today + timedelta(days=540),
            lot_number="IBU-2",
        )

        # Paracetamol — single lot with SN.
        stocks["paracetamol"] = Stock.objects.create(
            user=cibran,
            name="Paracetamol 1g",
            group=groups[("cibran", "Medicine cabinet")],
        )
        StockLot.objects.create(
            stock=stocks["paracetamol"],
            quantity=20,
            expiry_date=today + timedelta(days=400),
            lot_number="PCT-2028",
        )

        # Ebastine — backs the `Take antihistamine` routine (daily).
        # Three lots with SN so the FEFO modal has something to pick from
        # and `offline-read.spec.js` can iterate the SNs visible in the
        # cached lot list. EBA-1 is the FEFO front.
        # Name kept dose-free ("Ebastine" instead of "Ebastine 10mg") so
        # `readNumericValue(stockCard)` in `routine-completion.spec.js`
        # captures the aggregate quantity, not a digit from the SKU name.
        stocks["ebastine"] = Stock.objects.create(
            user=cibran,
            name="Ebastine",
            group=groups[("cibran", "Medicine cabinet")],
        )
        StockLot.objects.create(
            stock=stocks["ebastine"],
            quantity=10,
            expiry_date=today + timedelta(days=220),
            lot_number="EBA-1",
        )
        StockLot.objects.create(
            stock=stocks["ebastine"],
            quantity=10,
            expiry_date=today + timedelta(days=400),
            lot_number="EBA-2",
        )
        StockLot.objects.create(
            stock=stocks["ebastine"],
            quantity=10,
            expiry_date=today + timedelta(days=540),
            lot_number="EBA-3",
        )

        # ── Cibran — Travel ─────────────────────────────────────────────────

        # Biodramina — no SN (single lot without lot_number). Owner-only.
        stocks["biodramina"] = Stock.objects.create(user=cibran, name="Biodramina", group=groups[("cibran", "Travel")])
        StockLot.objects.create(
            stock=stocks["biodramina"],
            quantity=6,
            expiry_date=today + timedelta(days=300),
        )

        # ── Cibran — Home (shared with maria) ───────────────────────────────

        # Brita filter cartridges — single lot with no SN and no expiry
        # (qty=1). This shape is the canary for two specs:
        #   * `stock-expiry.spec.js` — "lot without expiry_date is not
        #     flagged" needs a lot with no expiry.
        #   * `routine-completion.spec.js` — the Undo flow needs a stock
        #     that drops to qty=0 after one Done click and back to 1
        #     after Undo.
        # Shared with maria so the spec ecosystem also exercises the
        # shared-stock path through this stock.
        stocks["brita"] = Stock.objects.create(
            user=cibran,
            name="Brita filter cartridges",
            group=groups[("cibran", "Home")],
        )
        stocks["brita"].shared_with.add(maria)
        StockLot.objects.create(stock=stocks["brita"], quantity=1)

        # Orchid fertilizer — no SN (single lot without lot_number). Shared
        # with maria.
        stocks["orchid"] = Stock.objects.create(user=cibran, name="Orchid fertilizer", group=groups[("cibran", "Home")])
        stocks["orchid"].shared_with.add(maria)
        StockLot.objects.create(
            stock=stocks["orchid"],
            quantity=12,
            expiry_date=today + timedelta(days=365),
        )

        # ── Maria — Home (shared with cibran) ───────────────────────────────

        # Descaler tablets — qty=2 → 'low'. No SN, no expiry. Maria owns and
        # shares with cibran. Backs `Descale coffee machine` (also maria's).
        stocks["descaler"] = Stock.objects.create(user=maria, name="Descaler tablets", group=groups[("maria", "Home")])
        stocks["descaler"].shared_with.add(cibran)
        StockLot.objects.create(stock=stocks["descaler"], quantity=2)

        # ── Maria — Medicine cabinet (PRIVATE — NOT shared) ─────────────────

        # Birth control pills — maria-only. The privacy contract: cibran's
        # session must never see this stock or its consuming routine. No
        # `shared_with.add()` call.
        stocks["birth_control"] = Stock.objects.create(
            user=maria,
            name="Birth control pills",
            group=groups[("maria", "Medicine cabinet")],
        )
        StockLot.objects.create(
            stock=stocks["birth_control"],
            quantity=21,
            expiry_date=today + timedelta(days=90),
            lot_number="BCP-2026",
        )

        return stocks

    # ── Routines ────────────────────────────────────────────────────────────

    def _create_routines(self, users, stocks):
        cibran, maria = users["cibran"], users["maria"]
        routines = {}

        # ── Cibran — Diabetes ───────────────────────────────────────────────

        # Take Vitamin D — overdue (history places last entry 35d ago,
        # interval 28d → 7d overdue).
        routines["take_vitamin_d"] = Routine.objects.create(
            user=cibran,
            name="Take Vitamin D",
            interval_hours=672,
            stock=stocks["hidroferol"],
            stock_usage=1,
        )

        # Change pump cannula — due today + blocked (cannulas qty=0). The
        # latest entry is placed 70h ago so due lands +2h from now: today's
        # date is >= due_date but `now < due` → is_due=True, is_overdue=False.
        routines["change_cannula"] = Routine.objects.create(
            user=cibran,
            name="Change pump cannula",
            interval_hours=72,
            stock=stocks["pump_cannulas"],
            stock_usage=1,
        )

        # Replace glucose sensor — upcoming.
        routines["replace_sensor"] = Routine.objects.create(
            user=cibran,
            name="Replace glucose sensor",
            interval_hours=360,
            stock=stocks["glucose_sensors"],
            stock_usage=1,
        )

        # ── Cibran — Medicine cabinet ───────────────────────────────────────

        # Take antihistamine — daily, due today. Latest entry placed at
        # interval-2h so due is in +2h.
        routines["take_antihistamine"] = Routine.objects.create(
            user=cibran,
            name="Take antihistamine",
            interval_hours=24,
            stock=stocks["ebastine"],
            stock_usage=1,
        )

        # ── Cibran — shared with maria ──────────────────────────────────────

        # Change Brita filter — due today, shared.
        routines["change_brita"] = Routine.objects.create(
            user=cibran,
            name="Change Brita filter",
            interval_hours=1008,  # 6 weeks
            stock=stocks["brita"],
            stock_usage=1,
        )
        routines["change_brita"].shared_with.add(maria)

        # Fertilize orchid — upcoming, shared.
        routines["fertilize_orchid"] = Routine.objects.create(
            user=cibran,
            name="Fertilize orchid",
            interval_hours=2160,  # 90 days ≈ 3 months
            stock=stocks["orchid"],
            stock_usage=1,
        )
        routines["fertilize_orchid"].shared_with.add(maria)

        # Water cactus — due today, no stock, shared.
        routines["water_cactus"] = Routine.objects.create(
            user=cibran,
            name="Water cactus",
            interval_hours=504,  # 3 weeks
        )
        routines["water_cactus"].shared_with.add(maria)

        # ── Cibran — aesthetic ──────────────────────────────────────────────

        # IPL hair removal — never-started (no entries → is_due() short-
        # circuits to True regardless of when the seed runs).
        routines["ipl"] = Routine.objects.create(user=cibran, name="IPL hair removal", interval_hours=336)

        # ── Maria — shares with cibran ──────────────────────────────────────

        # Descale coffee machine — upcoming, shared with cibran (cibran sees
        # this routine as `shared-with-me`, the only such case in the seed).
        routines["descale_coffee"] = Routine.objects.create(
            user=maria,
            name="Descale coffee machine",
            interval_hours=1440,  # 60 days ≈ 2 months
            stock=stocks["descaler"],
            stock_usage=1,
        )
        routines["descale_coffee"].shared_with.add(cibran)

        # ── Maria — PRIVATE ─────────────────────────────────────────────────

        # Take birth control pill — daily, NOT shared. Cibran must never see
        # this routine in his queries (querysets filter by user|shared_with).
        routines["take_birth_control"] = Routine.objects.create(
            user=maria,
            name="Take birth control pill",
            interval_hours=24,
            stock=stocks["birth_control"],
            stock_usage=1,
        )

        return routines

    # ── History ─────────────────────────────────────────────────────────────

    def _create_history(self, users, routines, stocks):
        """Place RoutineEntry rows so `is_due / is_overdue` match the plan.

        Strategy: each schedule declares `(routine, completed_by, status,
        count)`. The most recent entry is placed `_latest_offset(interval,
        status)` ago; prior entries land at multiples of the interval before
        that anchor.
        """

        cibran, maria = users["cibran"], users["maria"]
        now = timezone.now()

        schedules = [
            (routines["take_vitamin_d"], cibran, "overdue", 6),
            (routines["change_cannula"], cibran, "due", 8),
            (routines["replace_sensor"], cibran, "upcoming", 2),
            (routines["take_antihistamine"], cibran, "due", 14),
            (routines["change_brita"], cibran, "due", 2),
            (routines["fertilize_orchid"], cibran, "upcoming", 2),
            (routines["water_cactus"], cibran, "due", 1),
            (routines["descale_coffee"], maria, "upcoming", 1),
            # IPL has no entries (never-started).
            (routines["take_birth_control"], maria, "due", 14),
        ]

        # Routines whose entries should be tagged with a recurring note.
        # `Take antihistamine` carries "morning dose" every third entry —
        # enough density that `/history` always shows the note within the
        # default 15-day filter, and the inline-edit spec has a stable
        # target.
        notes_pattern = {
            routines["take_antihistamine"]: ("morning dose", 3),
        }

        for routine, completed_by, status, count in schedules:
            latest = self._latest_offset(routine, status, now)
            note_text, note_every = notes_pattern.get(routine, ("", 1))
            for i in range(count):
                offset = latest + timedelta(hours=routine.interval_hours * i)
                timestamp = now - offset
                RoutineEntry.objects.create(
                    routine=routine,
                    completed_by=completed_by,
                    created_at=timestamp,
                    client_created_at=timestamp,
                    notes=note_text if (note_text and i % note_every == 0) else "",
                )

        # Direct StockConsumption rows surface a "consumption"-typed row in
        # `/history` and exercise the Stock filter on the History page.
        # - Pump cannulas: the consumption that drove the stock to qty=0.
        # - Hidroferol: a couple of standalone consumptions so the stock
        #   filter for `Hidroferol drops` has something to show.
        cannula_consumed_at = now - timedelta(days=1, hours=2)
        StockConsumption.objects.create(
            stock=stocks["pump_cannulas"],
            consumed_by=cibran,
            quantity=1,
            created_at=cannula_consumed_at,
            client_created_at=cannula_consumed_at,
        )
        for days_ago in (4, 9):
            consumed_at = now - timedelta(days=days_ago, hours=2)
            StockConsumption.objects.create(
                stock=stocks["hidroferol"],
                consumed_by=cibran,
                quantity=1,
                created_at=consumed_at,
                client_created_at=consumed_at,
            )

        # Ibuprofen — 3 direct consumptions (no linked routine) so the demo
        # exercises the "estimated from past usage" branch added in T141:
        # 2 in the last 30 days + 1 in the prior 30 days satisfies trigger
        # B (`last_30d ≥ 1 AND prev_30d ≥ 1`), yielding daily ≈ 3/60 = 0.05.
        # The Ibuprofen card then shows `≈ Until <date>` with the lucide
        # `equal-approximately` glyph rendered by the frontend.
        for days_ago, hours_ago in ((5, 2), (18, 4), (40, 1)):
            consumed_at = now - timedelta(days=days_ago, hours=hours_ago)
            StockConsumption.objects.create(
                stock=stocks["ibuprofen"],
                consumed_by=cibran,
                quantity=1,
                created_at=consumed_at,
                client_created_at=consumed_at,
            )

    @staticmethod
    def _latest_offset(routine, status, now):
        """How long ago the most recent entry should land for a given status.

        - `overdue`: last entry placed past one full interval, comfortably
          beyond — 7 days past the cycle end so it reads as overdue regardless
          of seed-run time-of-day.
        - `due`: last entry placed so the next due time is in the future but
          still on today's local date in the routine owner's timezone.
          `is_due()` rounds to local date, so a naive "+2h from now" offset
          flakes when seed runs late in the local day and the +2h crosses
          midnight (next_due_at lands on tomorrow's date → is_due=False).
          Aim for now+2h, but cap the target so it never crosses midnight
          in the user's TZ — leaves a 10-min buffer before end of day.
        - `upcoming`: last entry placed at one third of the interval ago — a
          comfortable mid-cycle anchor that never reads as due.
        """
        interval_hours = routine.interval_hours
        if status == "overdue":
            return timedelta(hours=interval_hours + 24 * 7)
        if status == "due":
            user_tz = ZoneInfo(routine.user.timezone)
            now_local = now.astimezone(user_tz)
            end_of_today_local = now_local.replace(hour=23, minute=59, second=0, microsecond=0) - timedelta(minutes=10)
            target_next_due = min(now + timedelta(hours=2), end_of_today_local)
            # Guarantee the target is in the future so is_overdue=False holds.
            target_next_due = max(target_next_due, now + timedelta(minutes=1))
            return timedelta(hours=interval_hours) - (target_next_due - now)
        if status == "upcoming":
            return timedelta(hours=interval_hours // 3)
        raise ValueError(f"unknown status: {status}")
