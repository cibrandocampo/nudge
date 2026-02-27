import json
import logging

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

_MSGS = {
    "en": {
        "daily_title": "Nudge — Tasks for today",
        "daily_one": "You have 1 pending task today.",
        "daily_many": "You have {n} pending tasks today.",
        "due_title": "Time for: {name}",
        "due_body": "Interval of {hours}h reached.",
        "reminder_title": "Still pending: {name}",
        "reminder_body": "Overdue by {hours}h.",
        "action_done": "Mark as done",
        "action_dismiss": "Dismiss",
        "test_title": "Nudge — Test notification",
        "test_body": "If you see this, push notifications are working!",
    },
    "es": {
        "daily_title": "Nudge — Tareas para hoy",
        "daily_one": "Tienes 1 tarea pendiente hoy.",
        "daily_many": "Tienes {n} tareas pendientes hoy.",
        "due_title": "Pendiente: {name}",
        "due_body": "Intervalo de {hours}h alcanzado.",
        "reminder_title": "Sigue pendiente: {name}",
        "reminder_body": "Lleva {hours}h de retraso.",
        "action_done": "Marcar como hecho",
        "action_dismiss": "Ignorar",
        "test_title": "Nudge — Notificación de prueba",
        "test_body": "Si ves esto, ¡las notificaciones push funcionan!",
    },
    "gl": {
        "daily_title": "Nudge — Tarefas para hoxe",
        "daily_one": "Tes 1 tarefa pendente hoxe.",
        "daily_many": "Tes {n} tarefas pendentes hoxe.",
        "due_title": "Pendente: {name}",
        "due_body": "Intervalo de {hours}h alcanzado.",
        "reminder_title": "Segue pendente: {name}",
        "reminder_body": "Leva {hours}h de atraso.",
        "action_done": "Marcar como feito",
        "action_dismiss": "Ignorar",
        "test_title": "Nudge — Notificación de proba",
        "test_body": "Se ves isto, as notificacións push funcionan!",
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
        logger.warning("VAPID keys not configured — push notification skipped.")
        return

    subscriptions = PushSubscription.objects.filter(user=user)
    if not subscriptions.exists():
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
            )
            subscription.last_used = timezone.now()
            subscription.save(update_fields=["last_used"])
            logger.debug("Push sent to subscription %s (user=%s)", subscription.id, user.username)

        except WebPushException as exc:
            response = getattr(exc, "response", None)
            if response is not None and response.status_code in (404, 410):
                logger.info(
                    "Removing expired push subscription %s (user=%s, status=%s)",
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


def notify_daily_heads_up(user, due_count: int):
    body = _m(user, "daily_one") if due_count == 1 else _m(user, "daily_many", n=due_count)
    send_push_notification(
        user,
        title=_m(user, "daily_title"),
        body=body,
        type=TYPE_DAILY,
        actions=_actions(user),
    )


def notify_due(routine):
    user = routine.user
    send_push_notification(
        user,
        title=_m(user, "due_title", name=routine.name),
        body=routine.description or _m(user, "due_body", hours=routine.interval_hours),
        type=TYPE_DUE,
        data={"routine_id": routine.id},
        actions=_actions(user),
    )


def notify_reminder(routine, hours_overdue: int):
    user = routine.user
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
