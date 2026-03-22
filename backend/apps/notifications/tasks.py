import logging
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from celery import shared_task
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Prefetch
from django.utils import timezone

from apps.routines.models import Routine, RoutineEntry

from .models import NotificationState
from .push import notify_daily_heads_up, notify_due, notify_reminder, notify_test

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

    Shared routines are included: due/reminder notifications are sent to all
    members (owner + shared_with). A processed_routines set prevents duplicate
    processing when the same routine appears for multiple users.
    """
    User = get_user_model()
    now_utc = timezone.now()
    start_time = time.monotonic()

    entry_prefetch = Prefetch(
        "entries",
        queryset=RoutineEntry.objects.order_by("-created_at"),
        to_attr="_prefetched_entries",
    )
    active_routines_qs = (
        Routine.objects.filter(is_active=True)
        .select_related("stock", "user")
        .prefetch_related(entry_prefetch, "shared_with")
    )

    users = (
        User.objects.filter(
            is_active=True,
            push_subscriptions__isnull=False,
        )
        .distinct()
        .prefetch_related(
            Prefetch("routines", queryset=active_routines_qs),
            Prefetch("shared_routines", queryset=active_routines_qs),
        )
    )

    processed_routines = set()

    for user in users:
        try:
            user_tz = ZoneInfo(user.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            logger.warning("Invalid timezone %r for user %s — skipping.", user.timezone, user.id)
            continue

        now_local = now_utc.astimezone(user_tz)

        # Combine owned + shared routines, deduplicate
        all_routines = _unique_routines(user)

        logger.debug("Checking user %s (%d active routines).", user.username, len(all_routines))

        _check_daily_heads_up(user, now_utc, now_local, user_tz, all_routines)

        for routine in all_routines:
            if routine.id in processed_routines:
                continue
            processed_routines.add(routine.id)
            try:
                _check_due_notification(routine, now_utc)
                _check_reminder(routine, now_utc)
            except Exception:
                logger.exception("Error processing routine %s for user %s.", routine.id, user.id)

    elapsed_ms = round((time.monotonic() - start_time) * 1000)
    logger.info(
        "check_notifications completed: %d users, %d routines in %dms.",
        len(users),
        len(processed_routines),
        elapsed_ms,
    )


@shared_task(
    name="apps.notifications.tasks.send_scheduled_test",
    time_limit=30,
    soft_time_limit=25,
)
def send_scheduled_test(user_id):
    """Send a test push notification via Celery (used to verify the worker pipeline)."""
    User = get_user_model()
    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        logger.warning("send_scheduled_test: user %s not found.", user_id)
        return
    notify_test(user)
    logger.info("Scheduled test notification sent to user %s.", user.username)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _unique_routines(user):
    """Return deduplicated list of owned + shared routines from prefetch cache."""
    seen = set()
    result = []
    for r in list(user.routines.all()) + list(user.shared_routines.all()):
        if r.id not in seen:
            seen.add(r.id)
            result.append(r)
    return result


def _get_routine_members(routine):
    """Return all users who have access to this routine (owner + shared_with)."""
    members = [routine.user]
    members.extend(routine.shared_with.all())
    return members


def _get_or_create_state(routine, *, lock=False):
    state, _ = NotificationState.objects.get_or_create(routine=routine)
    if lock:
        state = NotificationState.objects.select_for_update().get(pk=state.pk)
    return state


def _is_due_today(routine, now_local, user_tz):
    """True if the routine is due today or already overdue (in the recipient's local date)."""
    next_due = routine.next_due_at()
    if next_due is None:
        return True  # Never logged — always due
    next_due_local = next_due.astimezone(user_tz)
    return next_due_local.date() <= now_local.date()


def _check_daily_heads_up(user, now_utc, now_local, user_tz, all_routines=None):
    """
    Send the daily heads-up if:
      - The current local time matches the user's configured time (±DAILY_WINDOW_MINUTES).
      - At least one routine is due today.
      - It hasn't been sent yet today for those routines.
    """
    target = user.daily_notification_time
    target_dt = datetime.combine(now_local.date(), target, tzinfo=now_local.tzinfo)
    diff_seconds = abs((now_local - target_dt).total_seconds())

    if diff_seconds > DAILY_WINDOW_MINUTES * 60:
        logger.debug(
            "Daily heads-up: not in time window for user %s (now=%s, target=%s).",
            user.username,
            now_local.strftime("%H:%M"),
            target.strftime("%H:%M"),
        )
        return

    if all_routines is None:
        all_routines = _unique_routines(user)

    due_routines = [r for r in all_routines if _is_due_today(r, now_local, user_tz)]
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
    Sends to all members (owner + shared_with).
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
                logger.debug(
                    "Due: routine %r already notified this cycle (last_due=%s, last_entry=%s) — skipped.",
                    routine.name,
                    state.last_due_notification.isoformat(),
                    last_entry.created_at.isoformat(),
                )
                return

        members = _get_routine_members(routine)
        for member in members:
            notify_due(routine, target_user=member)
        logger.info("Due notification sent for routine %r (user %s).", routine.name, routine.user.username)

        state.last_due_notification = now_utc
        state.save(update_fields=["last_due_notification"])


def _check_reminder(routine, now_utc):
    """
    Send a reminder every REMINDER_INTERVAL_HOURS while the routine remains overdue.
    Only fires after the initial 'due' notification has been sent.
    Sends to all members (owner + shared_with).
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
            remaining = timedelta(hours=REMINDER_INTERVAL_HOURS) - (now_utc - last_notif)
            logger.debug(
                "Reminder: routine %r too soon (last_notif=%s, remaining=%s) — skipped.",
                routine.name,
                last_notif.isoformat(),
                remaining,
            )
            return

        next_due = routine.next_due_at()
        if next_due:
            hours_overdue = round((now_utc - next_due).total_seconds() / 3600)
        else:
            hours_overdue = round((now_utc - state.last_due_notification).total_seconds() / 3600)

        members = _get_routine_members(routine)
        for member in members:
            notify_reminder(routine, hours_overdue=hours_overdue, target_user=member)
        logger.info(
            "Reminder sent for routine %r (user %s, %dh overdue, last_notif=%s).",
            routine.name,
            routine.user.username,
            hours_overdue,
            last_notif.isoformat(),
        )

        state.last_reminder = now_utc
        state.save(update_fields=["last_reminder"])
