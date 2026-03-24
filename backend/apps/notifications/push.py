import json
import logging
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.utils import timezone
from pywebpush import WebPushException, webpush

from .models import PushSubscription

logger = logging.getLogger(__name__)

# Notification type constants
TYPE_DAILY = "daily_heads_up"
TYPE_DUE = "due"
TYPE_REMINDER = "reminder"
TYPE_TEST = "test"
TYPE_CONTACT_ADDED = "contact_added"
TYPE_ROUTINE_SHARED = "routine_shared"
TYPE_STOCK_SHARED = "stock_shared"

_MSGS = {
    "en": {
        "daily_one": "1 task today",
        "daily_many": "{n} tasks today",
        "due_title": "{name}",
        "due_body": "Due at {time}",
        "reminder_title": "{name}",
        "reminder_body": "{hours}h overdue",
        "action_done": "Mark as done",
        "action_dismiss": "Dismiss",
        "test_title": "Push test",
        "test_body": "It works!",
        "contact_added_title": "New contact",
        "contact_added_body": "{owner} added you as a contact",
        "routine_shared_title": "{name}",
        "routine_shared_body": "{owner} shared this routine with you",
        "stock_shared_title": "{name}",
        "stock_shared_body": "{owner} shared this item with you",
    },
    "es": {
        "daily_one": "1 tarea hoy",
        "daily_many": "{n} tareas hoy",
        "due_title": "{name}",
        "due_body": "Desde las {time}",
        "reminder_title": "{name}",
        "reminder_body": "{hours}h de retraso",
        "action_done": "Marcar como hecho",
        "action_dismiss": "Ignorar",
        "test_title": "Prueba push",
        "test_body": "¡Funciona!",
        "contact_added_title": "Nuevo contacto",
        "contact_added_body": "{owner} te ha añadido como contacto",
        "routine_shared_title": "{name}",
        "routine_shared_body": "{owner} ha compartido esta rutina contigo",
        "stock_shared_title": "{name}",
        "stock_shared_body": "{owner} ha compartido este artículo contigo",
    },
    "gl": {
        "daily_one": "1 tarefa hoxe",
        "daily_many": "{n} tarefas hoxe",
        "due_title": "{name}",
        "due_body": "Dende as {time}",
        "reminder_title": "{name}",
        "reminder_body": "{hours}h de atraso",
        "action_done": "Marcar como feito",
        "action_dismiss": "Ignorar",
        "test_title": "Proba push",
        "test_body": "Funciona!",
        "contact_added_title": "Novo contacto",
        "contact_added_body": "{owner} engadiuche como contacto",
        "routine_shared_title": "{name}",
        "routine_shared_body": "{owner} compartiu esta rutina contigo",
        "stock_shared_title": "{name}",
        "stock_shared_body": "{owner} compartiu este artigo contigo",
    },
}


def _m(user, key, **kwargs):
    """Return a translated message string for the user's language."""
    msgs = _MSGS.get(getattr(user, "language", "en"), _MSGS["en"])
    text = msgs[key]
    return text.format(**kwargs) if kwargs else text


def send_push_notification(user, *, title: str, body: str, type: str, data: dict = None, actions: list = None):
    """
    Send a Web Push notification to all registered devices for a user.

    Invalid or expired subscriptions (HTTP 404/410) are automatically removed.
    If VAPID keys are not configured, the call is a no-op with a warning.

    Args:
        user:  Django user instance.
        title: Notification title shown by the browser/OS.
        body:  Notification body text.
        type:  One of TYPE_DAILY, TYPE_DUE, TYPE_REMINDER — used by the SW.
        data:  Optional extra payload passed to the service worker.
    """
    if not settings.VAPID_PRIVATE_KEY or not settings.VAPID_PUBLIC_KEY:
        logger.warning("VAPID keys not configured — push skipped (user=%s, type=%s).", user.username, type)
        return

    subscriptions = PushSubscription.objects.filter(user=user)
    if not subscriptions.exists():
        logger.debug("No push subscriptions for user %s — skipped.", user.username)
        return

    payload = json.dumps(
        {
            "title": title,
            "body": body,
            "type": type,
            "data": data or {},
            "actions": actions or [],
        }
    )

    to_delete = []

    for subscription in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {
                        "p256dh": subscription.p256dh,
                        "auth": subscription.auth,
                    },
                },
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={
                    "sub": f"mailto:{settings.VAPID_CLAIMS_EMAIL}",
                },
                headers={"Urgency": "high"},
            )
            subscription.last_used = timezone.now()
            subscription.save(update_fields=["last_used"])
            logger.info("Push delivered to subscription %s (user=%s, type=%s).", subscription.id, user.username, type)

        except WebPushException as exc:
            response = getattr(exc, "response", None)
            if response is not None and response.status_code in (404, 410):
                logger.warning(
                    "Removing expired subscription %s (user=%s, status=%s).",
                    subscription.id,
                    user.username,
                    response.status_code,
                )
                to_delete.append(subscription.id)
            else:
                logger.error(
                    "Push failed for subscription %s (user=%s): %s",
                    subscription.id,
                    user.username,
                    exc,
                )

    if to_delete:
        PushSubscription.objects.filter(id__in=to_delete).delete()


# ── Convenience helpers used by the Celery worker ────────────────────────────


def _actions(user):
    return [
        {"action": "mark-done", "title": _m(user, "action_done")},
        {"action": "dismiss", "title": _m(user, "action_dismiss")},
    ]


def notify_daily_heads_up(user, due_count: int, names: list = None):
    title = _m(user, "daily_one") if due_count == 1 else _m(user, "daily_many", n=due_count)
    body = ", ".join(names) if names else ""
    send_push_notification(
        user,
        title=title,
        body=body,
        type=TYPE_DAILY,
        actions=_actions(user),
    )


def notify_due(routine, *, target_user=None):
    user = target_user or routine.user
    if routine.description:
        body = routine.description
    else:
        try:
            user_tz = ZoneInfo(user.timezone)
            next_due = routine.next_due_at()
            time_str = next_due.astimezone(user_tz).strftime("%H:%M") if next_due else ""
        except (ZoneInfoNotFoundError, ValueError):
            time_str = ""
        body = _m(user, "due_body", time=time_str) if time_str else ""
    send_push_notification(
        user,
        title=_m(user, "due_title", name=routine.name),
        body=body,
        type=TYPE_DUE,
        data={"routine_id": routine.id},
        actions=_actions(user),
    )


def notify_reminder(routine, hours_overdue: int, *, target_user=None):
    user = target_user or routine.user
    send_push_notification(
        user,
        title=_m(user, "reminder_title", name=routine.name),
        body=_m(user, "reminder_body", hours=hours_overdue),
        type=TYPE_REMINDER,
        data={"routine_id": routine.id},
        actions=_actions(user),
    )


def notify_test(user):
    send_push_notification(
        user,
        title=_m(user, "test_title"),
        body=_m(user, "test_body"),
        type=TYPE_TEST,
    )


def notify_contact_added(requester, target):
    send_push_notification(
        target,
        title=_m(target, "contact_added_title"),
        body=_m(target, "contact_added_body", owner=requester.username),
        type=TYPE_CONTACT_ADDED,
    )


def notify_routine_shared(routine, new_user):
    send_push_notification(
        new_user,
        title=_m(new_user, "routine_shared_title", name=routine.name),
        body=_m(new_user, "routine_shared_body", owner=routine.user.username),
        type=TYPE_ROUTINE_SHARED,
        data={"routine_id": routine.id},
    )


def notify_stock_shared(stock, new_user):
    send_push_notification(
        new_user,
        title=_m(new_user, "stock_shared_title", name=stock.name),
        body=_m(new_user, "stock_shared_body", owner=stock.user.username),
        type=TYPE_STOCK_SHARED,
    )
