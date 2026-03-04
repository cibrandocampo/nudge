import logging
from datetime import timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from celery import shared_task
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Prefetch
from django.utils import timezone

from apps.routines.models import Routine, RoutineEntry

from .models import NotificationState
from .push import notify_daily_heads_up, notify_due, notify_reminder

logger = logging.getLogger(__name__)

REMINDER_INTERVAL_HOURS = 2
DAILY_WINDOW_MINUTES = 5  # tolerance around the user's configured time


@shared_task(
    name="apps.notifications.tasks.check_notifications",
    time_limit=300,
    soft_time_limit=250,
)
def check_notifications():
    """
    Runs every 5 minutes. For each active user:
      1. Daily heads-up  — once per day at the user's configured local time.
      2. Due notification — when a routine becomes overdue, once per cycle.
      3. Reminder        — every REMINDER_INTERVAL_HOURS while the routine remains overdue.
    """
    User = get_user_model()
    now_utc = timezone.now()

    users = (
        User.objects.filter(
            is_active=True,
            push_subscriptions__isnull=False,
        )
        .distinct()
        .prefetch_related(
            Prefetch(
                "routines",
                queryset=Routine.objects.filter(is_active=True)
                .select_related("stock")
                .prefetch_related(
                    Prefetch(
                        "entries",
                        queryset=RoutineEntry.objects.order_by("-created_at"),
                        to_attr="_prefetched_entries",
                    )
                ),
            ),
        )
    )

    for user in users:
        try:
            user_tz = ZoneInfo(user.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            logger.warning("Invalid timezone %r for user %s — skipping.", user.timezone, user.id)
            continue

        now_local = now_utc.astimezone(user_tz)
        routines = list(user.routines.all())
        logger.debug("Checking user %s (%d active routines).", user.username, len(routines))

        _check_daily_heads_up(user, now_utc, now_local)

        for routine in routines:
            try:
                _check_due_notification(routine, now_utc)
                _check_reminder(routine, now_utc)
            except Exception:
                logger.exception("Error processing routine %s for user %s.", routine.id, user.id)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _get_or_create_state(routine, *, lock=False):
    state, _ = NotificationState.objects.get_or_create(routine=routine)
    if lock:
        state = NotificationState.objects.select_for_update().get(pk=state.pk)
    return state


def _is_due_today(routine, now_local):
    """True if the routine is due today or already overdue (in the user's local date)."""
    next_due = routine.next_due_at()
    if next_due is None:
        return True  # Never logged — always due
    user_tz = ZoneInfo(routine.user.timezone)
    next_due_local = next_due.astimezone(user_tz)
    return next_due_local.date() <= now_local.date()


def _check_daily_heads_up(user, now_utc, now_local):
    """
    Send the daily heads-up if:
      - The current local time matches the user's configured time (±DAILY_WINDOW_MINUTES).
      - At least one routine is due today.
      - It hasn't been sent yet today for those routines.
    """
    target = user.daily_notification_time
    hour_match = now_local.hour == target.hour
    minute_match = abs(now_local.minute - target.minute) <= DAILY_WINDOW_MINUTES

    if not (hour_match and minute_match):
        logger.debug(
            "Daily heads-up: not in time window for user %s (now=%s, target=%s).",
            user.username,
            now_local.strftime("%H:%M"),
            target.strftime("%H:%M"),
        )
        return

    due_routines = [r for r in user.routines.all() if _is_due_today(r, now_local)]
    if not due_routines:
        logger.debug("Daily heads-up: no routines due today for user %s.", user.username)
        return

    today_local = now_local.date()

    with transaction.atomic():
        # Lock all notification states for due routines
        states = {r.id: _get_or_create_state(r, lock=True) for r in due_routines}

        # Skip if we already sent the daily notification for any due routine today
        already_sent = any(states[r.id].last_daily_notification == today_local for r in due_routines)
        if already_sent:
            logger.debug("Daily heads-up: already sent today for user %s.", user.username)
            return

        notify_daily_heads_up(user, due_count=len(due_routines), names=[r.name for r in due_routines])
        logger.info(
            "Daily heads-up sent to user %s (%d due: %s).",
            user.username,
            len(due_routines),
            ", ".join(r.name for r in due_routines),
        )

        # Mark all due routines as notified today
        for routine in due_routines:
            state = states[routine.id]
            state.last_daily_notification = today_local
            state.save(update_fields=["last_daily_notification"])


def _check_due_notification(routine, now_utc):
    """
    Send a 'due' notification when the routine first becomes overdue.
    Does not repeat within the same cycle (i.e. until the next RoutineEntry).
    """
    if not routine.is_overdue():
        logger.debug("Due: routine %r not overdue — skipped.", routine.name)
        return

    with transaction.atomic():
        state = _get_or_create_state(routine, lock=True)
        last_entry = routine.last_entry()

        if state.last_due_notification:
            if last_entry is None:
                logger.debug("Due: routine %r never logged, already notified — skipped.", routine.name)
                return
            if state.last_due_notification > last_entry.created_at:
                logger.debug("Due: routine %r already notified this cycle — skipped.", routine.name)
                return

        notify_due(routine)
        logger.info("Due notification sent for routine %r (user %s).", routine.name, routine.user.username)

        state.last_due_notification = now_utc
        state.save(update_fields=["last_due_notification"])


def _check_reminder(routine, now_utc):
    """
    Send a reminder every REMINDER_INTERVAL_HOURS while the routine remains overdue.
    Only fires after the initial 'due' notification has been sent.
    """
    if not routine.is_overdue():
        logger.debug("Reminder: routine %r not overdue — skipped.", routine.name)
        return

    with transaction.atomic():
        state = _get_or_create_state(routine, lock=True)

        if not state.last_due_notification:
            logger.debug("Reminder: routine %r waiting for due notification first — skipped.", routine.name)
            return

        last_notif = state.last_reminder or state.last_due_notification

        if (now_utc - last_notif) < timedelta(hours=REMINDER_INTERVAL_HOURS):
            logger.debug("Reminder: routine %r too soon since last notification — skipped.", routine.name)
            return

        next_due = routine.next_due_at()
        if next_due:
            hours_overdue = round((now_utc - next_due).total_seconds() / 3600)
        else:
            hours_overdue = round((now_utc - state.last_due_notification).total_seconds() / 3600)

        notify_reminder(routine, hours_overdue=hours_overdue)
        logger.info(
            "Reminder sent for routine %r (user %s, %dh overdue).",
            routine.name,
            routine.user.username,
            hours_overdue,
        )

        state.last_reminder = now_utc
        state.save(update_fields=["last_reminder"])
