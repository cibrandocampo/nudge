from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.routines.models import Routine, RoutineEntry

from .models import NotificationState, PushSubscription
from .push import (
    TYPE_DAILY,
    TYPE_DUE,
    TYPE_REMINDER,
    TYPE_TEST,
    notify_daily_heads_up,
    notify_due,
    notify_reminder,
    notify_test,
    send_push_notification,
)
from .tasks import (
    _check_daily_heads_up,
    _check_due_notification,
    _check_reminder,
    _get_or_create_state,
    _is_due_today,
)

User = get_user_model()


# ── Helpers ──────────────────────────────────────────────────────────────────


def make_user(username="tester", tz="UTC", daily_time="08:30"):
    user = User.objects.create_user(
        username=username,
        password="pass",
        timezone=tz,
        daily_notification_time=daily_time,
    )
    user.refresh_from_db()
    return user


def make_routine(user, name="Test routine", interval_hours=24, is_active=True):
    return Routine.objects.create(
        user=user,
        name=name,
        interval_hours=interval_hours,
        is_active=is_active,
    )


def make_entry(routine, offset_hours=0):
    entry = RoutineEntry.objects.create(routine=routine)
    if offset_hours:
        RoutineEntry.objects.filter(pk=entry.pk).update(created_at=timezone.now() + timedelta(hours=offset_hours))
        entry.refresh_from_db()
    return entry


def make_subscription(user, endpoint="https://example.com/push/1"):
    return PushSubscription.objects.create(
        user=user,
        endpoint=endpoint,
        p256dh="key123",
        auth="auth123",
    )


# ── NotificationState model ───────────────────────────────────────────────────


class NotificationStateModelTest(TestCase):
    def test_str(self):
        user = make_user()
        routine = make_routine(user, name="My Routine")
        state = NotificationState.objects.create(routine=routine)
        self.assertIn("My Routine", str(state))

    def test_defaults_are_null(self):
        user = make_user()
        routine = make_routine(user)
        state = NotificationState.objects.create(routine=routine)
        self.assertIsNone(state.last_due_notification)
        self.assertIsNone(state.last_reminder)
        self.assertIsNone(state.last_daily_notification)

    def test_one_to_one_with_routine(self):
        user = make_user()
        routine = make_routine(user)
        NotificationState.objects.create(routine=routine)
        with self.assertRaises(Exception):
            NotificationState.objects.create(routine=routine)


# ── PushSubscription model ────────────────────────────────────────────────────


class PushSubscriptionModelTest(TestCase):
    def test_str_truncates_endpoint(self):
        user = make_user()
        sub = make_subscription(user, endpoint="https://example.com/push/" + "x" * 100)
        s = str(sub)
        self.assertIn("tester", s)
        self.assertIn("...", s)

    def test_endpoint_is_unique(self):
        user = make_user()
        make_subscription(user, endpoint="https://example.com/push/1")
        with self.assertRaises(Exception):
            make_subscription(user, endpoint="https://example.com/push/1")


# ── PushSubscription views ────────────────────────────────────────────────────


class SubscribeViewTest(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.client.force_authenticate(user=self.user)
        self.valid_data = {
            "endpoint": "https://push.example.com/abc123",
            "keys": {"p256dh": "key1", "auth": "auth1"},
        }

    def test_subscribe_creates_subscription(self):
        response = self.client.post("/api/push/subscribe/", self.valid_data, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            PushSubscription.objects.filter(user=self.user, endpoint="https://push.example.com/abc123").exists()
        )

    def test_subscribe_missing_keys_returns_400(self):
        response = self.client.post(
            "/api/push/subscribe/",
            {
                "endpoint": "https://push.example.com/abc",
                "keys": {"p256dh": "only_one"},  # missing 'auth'
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_subscribe_missing_endpoint_returns_400(self):
        response = self.client.post(
            "/api/push/subscribe/",
            {
                "keys": {"p256dh": "k", "auth": "a"},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_subscribe_updates_existing_subscription(self):
        """Subscribing again with same endpoint should update, not duplicate."""
        PushSubscription.objects.create(
            user=self.user,
            endpoint="https://push.example.com/abc123",
            p256dh="old_key",
            auth="old_auth",
        )
        response = self.client.post(
            "/api/push/subscribe/",
            {
                "endpoint": "https://push.example.com/abc123",
                "keys": {"p256dh": "new_key", "auth": "new_auth"},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(PushSubscription.objects.filter(endpoint="https://push.example.com/abc123").count(), 1)

    def test_subscribe_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.post("/api/push/subscribe/", self.valid_data, format="json")
        self.assertEqual(response.status_code, 401)


class UnsubscribeViewTest(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.client.force_authenticate(user=self.user)

    def test_unsubscribe_removes_subscription(self):
        make_subscription(self.user, endpoint="https://push.example.com/del")
        response = self.client.delete(
            "/api/push/unsubscribe/",
            {
                "endpoint": "https://push.example.com/del",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 204)
        self.assertFalse(PushSubscription.objects.filter(endpoint="https://push.example.com/del").exists())

    def test_unsubscribe_missing_endpoint_returns_400(self):
        response = self.client.delete("/api/push/unsubscribe/", {}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_unsubscribe_other_users_subscription_is_no_op(self):
        other = make_user(username="other")
        make_subscription(other, endpoint="https://push.example.com/other")
        response = self.client.delete(
            "/api/push/unsubscribe/",
            {
                "endpoint": "https://push.example.com/other",
            },
            format="json",
        )
        # Returns 204 but does not delete (filtered by user)
        self.assertEqual(response.status_code, 204)
        self.assertTrue(PushSubscription.objects.filter(endpoint="https://push.example.com/other").exists())

    def test_unsubscribe_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.delete(
            "/api/push/unsubscribe/",
            {
                "endpoint": "https://push.example.com/x",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 401)


class VapidPublicKeyViewTest(APITestCase):
    @override_settings(VAPID_PUBLIC_KEY="test-public-key-abc")
    def test_returns_public_key(self):
        response = self.client.get("/api/push/vapid-public-key/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["public_key"], "test-public-key-abc")

    def test_no_authentication_required(self):
        self.client.force_authenticate(user=None)
        response = self.client.get("/api/push/vapid-public-key/")
        self.assertNotEqual(response.status_code, 401)


class TestPushViewTest(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.client.force_authenticate(user=self.user)

    def test_returns_404_when_no_subscriptions(self):
        response = self.client.post("/api/push/test/")
        self.assertEqual(response.status_code, 404)

    @override_settings(VAPID_PRIVATE_KEY="priv", VAPID_PUBLIC_KEY="pub", VAPID_CLAIMS_EMAIL="test@x.com")
    def test_sends_test_notification(self):
        make_subscription(self.user)
        with patch("apps.notifications.views.notify_test") as mock_notify:
            response = self.client.post("/api/push/test/")
        self.assertEqual(response.status_code, 204)
        mock_notify.assert_called_once_with(self.user)

    def test_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.post("/api/push/test/")
        self.assertEqual(response.status_code, 401)


# ── send_push_notification ────────────────────────────────────────────────────


@override_settings(VAPID_PRIVATE_KEY="", VAPID_PUBLIC_KEY="")
class SendPushNoVapidTest(TestCase):
    def test_skips_when_vapid_not_configured(self):
        user = make_user()
        make_subscription(user)
        with patch("apps.notifications.push.webpush") as mock_wp:
            send_push_notification(user, title="T", body="B", type=TYPE_DUE)
            mock_wp.assert_not_called()


@override_settings(VAPID_PRIVATE_KEY="priv", VAPID_PUBLIC_KEY="pub", VAPID_CLAIMS_EMAIL="test@x.com")
class SendPushNotificationTest(TestCase):
    def setUp(self):
        self.user = make_user()

    def test_no_op_when_no_subscriptions(self):
        with patch("apps.notifications.push.webpush") as mock_wp:
            send_push_notification(self.user, title="T", body="B", type=TYPE_DUE)
            mock_wp.assert_not_called()

    def test_sends_to_all_subscriptions(self):
        make_subscription(self.user, endpoint="https://push.a.com/1")
        make_subscription(self.user, endpoint="https://push.a.com/2")
        with patch("apps.notifications.push.webpush") as mock_wp:
            send_push_notification(self.user, title="T", body="B", type=TYPE_DUE)
            self.assertEqual(mock_wp.call_count, 2)

    def test_removes_expired_subscription_on_404(self):
        sub = make_subscription(self.user)
        exc = MagicMock()
        exc.response = MagicMock()
        exc.response.status_code = 404

        from pywebpush import WebPushException

        with patch("apps.notifications.push.webpush", side_effect=WebPushException("gone", response=exc.response)):
            send_push_notification(self.user, title="T", body="B", type=TYPE_DUE)

        self.assertFalse(PushSubscription.objects.filter(pk=sub.pk).exists())

    def test_removes_expired_subscription_on_410(self):
        sub = make_subscription(self.user)
        exc = MagicMock()
        exc.response = MagicMock()
        exc.response.status_code = 410

        from pywebpush import WebPushException

        with patch("apps.notifications.push.webpush", side_effect=WebPushException("expired", response=exc.response)):
            send_push_notification(self.user, title="T", body="B", type=TYPE_DUE)

        self.assertFalse(PushSubscription.objects.filter(pk=sub.pk).exists())

    def test_keeps_subscription_on_other_errors(self):
        sub = make_subscription(self.user)
        exc = MagicMock()
        exc.response = MagicMock()
        exc.response.status_code = 500

        from pywebpush import WebPushException

        with patch("apps.notifications.push.webpush", side_effect=WebPushException("error", response=exc.response)):
            send_push_notification(self.user, title="T", body="B", type=TYPE_DUE)

        self.assertTrue(PushSubscription.objects.filter(pk=sub.pk).exists())

    def test_updates_last_used_on_success(self):
        sub = make_subscription(self.user)
        with patch("apps.notifications.push.webpush"):
            send_push_notification(self.user, title="T", body="B", type=TYPE_DUE)
        sub.refresh_from_db()
        self.assertIsNotNone(sub.last_used)


# ── push helpers ──────────────────────────────────────────────────────────────


@override_settings(VAPID_PRIVATE_KEY="", VAPID_PUBLIC_KEY="")
class PushHelperTest(TestCase):
    """Verify helpers call send_push_notification with correct arguments."""

    def setUp(self):
        self.user = make_user()

    def test_notify_daily_heads_up_singular(self):
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(self.user, due_count=1)
            args = mock_send.call_args
            self.assertEqual(args[1]["type"], TYPE_DAILY)
            self.assertIn("1", args[1]["body"])
            self.assertIn("task", args[1]["body"])

    def test_notify_daily_heads_up_plural(self):
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(self.user, due_count=3)
            body = mock_send.call_args[1]["body"]
            self.assertIn("3", body)
            self.assertIn("tasks", body)

    def test_notify_due(self):
        routine = make_routine(self.user, name="Filter change")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_due(routine)
            args = mock_send.call_args
            self.assertEqual(args[1]["type"], TYPE_DUE)
            self.assertIn("Filter change", args[1]["title"])

    def test_notify_reminder(self):
        routine = make_routine(self.user, name="Check engine")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_reminder(routine, hours_overdue=5)
            args = mock_send.call_args
            self.assertEqual(args[1]["type"], TYPE_REMINDER)
            self.assertIn("5", args[1]["body"])

    def test_notify_test(self):
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_test(self.user)
            args = mock_send.call_args
            self.assertEqual(args[1]["type"], TYPE_TEST)
            self.assertIn("Test", args[1]["title"])


# ── tasks helpers ─────────────────────────────────────────────────────────────


class GetOrCreateStateTest(TestCase):
    def test_creates_state_if_not_exists(self):
        user = make_user()
        routine = make_routine(user)
        state = _get_or_create_state(routine)
        self.assertIsNotNone(state)
        self.assertEqual(state.routine, routine)

    def test_returns_existing_state(self):
        user = make_user()
        routine = make_routine(user)
        existing = NotificationState.objects.create(routine=routine)
        state = _get_or_create_state(routine)
        self.assertEqual(state.pk, existing.pk)


class IsDueTodayTest(TestCase):
    def test_returns_true_when_never_logged(self):
        user = make_user(tz="UTC")
        routine = make_routine(user, interval_hours=24)
        now_local = timezone.now()
        self.assertTrue(_is_due_today(routine, now_local))

    def test_returns_true_when_due_today(self):
        user = make_user(tz="UTC")
        routine = make_routine(user, interval_hours=1)
        make_entry(routine, offset_hours=-2)  # 2h ago → due 1h ago
        now_local = timezone.now()
        self.assertTrue(_is_due_today(routine, now_local))

    def test_returns_false_when_due_in_future(self):
        user = make_user(tz="UTC")
        routine = make_routine(user, interval_hours=100)
        make_entry(routine)  # just now → not due for 100h
        now_local = timezone.now()
        self.assertFalse(_is_due_today(routine, now_local))


class CheckDailyHeadsUpTest(TestCase):
    def setUp(self):
        self.user = make_user(tz="UTC", daily_time="08:30")

    def _now_at(self, hour, minute):
        """Return a timezone-aware UTC datetime at the given hour:minute today."""
        return timezone.now().replace(hour=hour, minute=minute, second=0, microsecond=0)

    def test_does_not_send_when_wrong_time(self):
        make_routine(self.user)
        now = self._now_at(10, 0)  # configured time is 08:30
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(self.user, now, now)
            mock_notify.assert_not_called()

    def test_does_not_send_when_no_due_routines(self):
        # Routine not due (logged very recently)
        routine = make_routine(self.user, interval_hours=100)
        make_entry(routine)
        now = self._now_at(8, 30)
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(self.user, now, now)
            mock_notify.assert_not_called()

    def test_sends_when_at_configured_time_with_due_routines(self):
        make_routine(self.user, interval_hours=1)  # never logged → due
        now = self._now_at(8, 30)
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(self.user, now, now)
            mock_notify.assert_called_once()

    def test_does_not_repeat_if_already_sent_today(self):
        routine = make_routine(self.user, interval_hours=1)
        now = self._now_at(8, 30)
        NotificationState.objects.create(
            routine=routine,
            last_daily_notification=now.date(),
        )
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(self.user, now, now)
            mock_notify.assert_not_called()

    def test_marks_all_due_routines_as_notified(self):
        r1 = make_routine(self.user, name="R1", interval_hours=1)
        r2 = make_routine(self.user, name="R2", interval_hours=1)
        now = self._now_at(8, 30)
        expected_date = now.date()
        with patch("apps.notifications.tasks.notify_daily_heads_up"):
            _check_daily_heads_up(self.user, now, now)
        for routine in [r1, r2]:
            state = NotificationState.objects.get(routine=routine)
            self.assertEqual(state.last_daily_notification, expected_date)

    def test_window_tolerance_at_minus_5_minutes(self):
        """8:25 should still trigger (within ±5 min of 8:30)."""
        make_routine(self.user, interval_hours=1)
        now = self._now_at(8, 25)
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(self.user, now, now)
            mock_notify.assert_called_once()

    def test_window_tolerance_at_plus_5_minutes(self):
        """8:35 should still trigger."""
        make_routine(self.user, interval_hours=1)
        now = self._now_at(8, 35)
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(self.user, now, now)
            mock_notify.assert_called_once()

    def test_outside_window_does_not_trigger(self):
        """8:36 should not trigger (outside ±5 min)."""
        make_routine(self.user, interval_hours=1)
        now = self._now_at(8, 36)
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(self.user, now, now)
            mock_notify.assert_not_called()


class CheckDueNotificationTest(TestCase):
    def setUp(self):
        self.user = make_user()

    def test_does_not_send_when_not_due(self):
        routine = make_routine(self.user, interval_hours=100)
        make_entry(routine)  # just now → not due yet
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_due") as mock_notify:
            _check_due_notification(routine, now)
            mock_notify.assert_not_called()

    def test_sends_when_overdue_and_never_notified(self):
        routine = make_routine(self.user, interval_hours=1)
        make_entry(routine, offset_hours=-2)  # overdue
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_due") as mock_notify:
            _check_due_notification(routine, now)
            mock_notify.assert_called_once_with(routine)

    def test_does_not_repeat_for_same_cycle(self):
        routine = make_routine(self.user, interval_hours=1)
        make_entry(routine, offset_hours=-2)
        # Notification sent after the entry → same cycle
        NotificationState.objects.create(
            routine=routine,
            last_due_notification=timezone.now(),
        )
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_due") as mock_notify:
            _check_due_notification(routine, now)
            mock_notify.assert_not_called()

    def test_resends_after_new_entry(self):
        routine = make_routine(self.user, interval_hours=1)
        # Simulate: old notification was sent, then user logged (entry), now overdue again
        old_time = timezone.now() - timedelta(hours=10)
        NotificationState.objects.create(
            routine=routine,
            last_due_notification=old_time,
        )
        # New entry more recent than notification, but 2h ago → overdue
        make_entry(routine, offset_hours=-2)
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_due") as mock_notify:
            _check_due_notification(routine, now)
            mock_notify.assert_called_once()

    def test_does_not_repeat_when_never_logged_and_already_notified(self):
        """Never-logged routine that was already notified should not re-notify."""
        routine = make_routine(self.user, interval_hours=1)
        # No entries, but already sent a due notification
        NotificationState.objects.create(
            routine=routine,
            last_due_notification=timezone.now() - timedelta(minutes=10),
        )
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_due") as mock_notify:
            _check_due_notification(routine, now)
            mock_notify.assert_not_called()

    def test_updates_state_after_sending(self):
        routine = make_routine(self.user, interval_hours=1)
        make_entry(routine, offset_hours=-2)
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_due"):
            _check_due_notification(routine, now)
        state = NotificationState.objects.get(routine=routine)
        self.assertIsNotNone(state.last_due_notification)


class CheckReminderTest(TestCase):
    def setUp(self):
        self.user = make_user()

    def test_does_not_send_when_not_due(self):
        routine = make_routine(self.user, interval_hours=100)
        make_entry(routine)
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_reminder") as mock_notify:
            _check_reminder(routine, now)
            mock_notify.assert_not_called()

    def test_does_not_send_when_no_due_notification_yet(self):
        routine = make_routine(self.user, interval_hours=1)
        make_entry(routine, offset_hours=-2)
        # No NotificationState → no last_due_notification
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_reminder") as mock_notify:
            _check_reminder(routine, now)
            mock_notify.assert_not_called()

    def test_does_not_send_when_interval_not_elapsed(self):
        routine = make_routine(self.user, interval_hours=1)
        make_entry(routine, offset_hours=-2)
        # Due notification sent 1h ago — reminder interval is 8h
        NotificationState.objects.create(
            routine=routine,
            last_due_notification=timezone.now() - timedelta(hours=1),
        )
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_reminder") as mock_notify:
            _check_reminder(routine, now)
            mock_notify.assert_not_called()

    def test_sends_when_8h_elapsed_since_due_notification(self):
        routine = make_routine(self.user, interval_hours=1)
        make_entry(routine, offset_hours=-10)
        NotificationState.objects.create(
            routine=routine,
            last_due_notification=timezone.now() - timedelta(hours=9),
        )
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_reminder") as mock_notify:
            _check_reminder(routine, now)
            mock_notify.assert_called_once()

    def test_uses_last_reminder_for_interval_if_set(self):
        routine = make_routine(self.user, interval_hours=1)
        make_entry(routine, offset_hours=-10)
        # last_reminder was sent 1h ago — should not send again
        NotificationState.objects.create(
            routine=routine,
            last_due_notification=timezone.now() - timedelta(hours=20),
            last_reminder=timezone.now() - timedelta(hours=1),
        )
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_reminder") as mock_notify:
            _check_reminder(routine, now)
            mock_notify.assert_not_called()

    def test_updates_last_reminder_after_sending(self):
        routine = make_routine(self.user, interval_hours=1)
        make_entry(routine, offset_hours=-10)
        NotificationState.objects.create(
            routine=routine,
            last_due_notification=timezone.now() - timedelta(hours=9),
        )
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_reminder"):
            _check_reminder(routine, now)
        state = NotificationState.objects.get(routine=routine)
        self.assertIsNotNone(state.last_reminder)

    def test_hours_overdue_calculated_correctly(self):
        routine = make_routine(self.user, interval_hours=1)
        # Entry 5h ago → overdue by 4h
        make_entry(routine, offset_hours=-5)
        NotificationState.objects.create(
            routine=routine,
            last_due_notification=timezone.now() - timedelta(hours=9),
        )
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_reminder") as mock_notify:
            _check_reminder(routine, now)
            _, kwargs = mock_notify.call_args
            self.assertEqual(kwargs["hours_overdue"], 4)


# ── check_notifications Celery task ──────────────────────────────────────────


class CheckNotificationsTaskTest(TestCase):
    """Integration-style test for the main Celery task."""

    def test_invalid_timezone_skips_user_without_error(self):
        from .tasks import check_notifications

        user = make_user(username="badtz")
        # Force invalid timezone bypassing model validation
        User.objects.filter(pk=user.pk).update(timezone="Not/Valid")
        # Should not raise
        check_notifications()

    def test_processes_active_users(self):
        from .tasks import check_notifications

        user = make_user(username="active")
        make_routine(user, interval_hours=1)
        # Should not raise; patches avoid actual push sends
        with (
            patch("apps.notifications.tasks.notify_due"),
            patch("apps.notifications.tasks.notify_daily_heads_up"),
            patch("apps.notifications.tasks.notify_reminder"),
        ):
            check_notifications()

    def test_skips_inactive_users(self):
        from .tasks import check_notifications

        user = make_user(username="inactive")
        User.objects.filter(pk=user.pk).update(is_active=False)
        make_routine(user, interval_hours=1)
        with patch("apps.notifications.tasks.notify_due") as mock_due:
            check_notifications()
            mock_due.assert_not_called()


# ── Push message i18n ─────────────────────────────────────────────────────────


class PushHelperLanguageTest(TestCase):
    """
    Verify that notification title/body/actions follow user.language.
    All tests patch send_push_notification directly, so VAPID config is irrelevant.
    """

    def _user(self, language, username=None):
        user = User.objects.create_user(
            username=username or f"user_{language}",
            password="pass",
            timezone="UTC",
            daily_notification_time="08:30",
        )
        User.objects.filter(pk=user.pk).update(language=language)
        user.refresh_from_db()
        return user

    # ── daily heads-up ────────────────────────────────────────────────────────

    def test_daily_english_singular(self):
        user = self._user("en")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(user, due_count=1)
        kwargs = mock_send.call_args[1]
        self.assertIn("Tasks for today", kwargs["title"])
        self.assertEqual(kwargs["body"], "You have 1 pending task today.")

    def test_daily_english_plural(self):
        user = self._user("en", username="user_en2")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(user, due_count=3)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["body"], "You have 3 pending tasks today.")

    def test_daily_spanish_singular(self):
        user = self._user("es")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(user, due_count=1)
        kwargs = mock_send.call_args[1]
        self.assertIn("hoy", kwargs["title"])
        self.assertEqual(kwargs["body"], "Tienes 1 tarea pendiente hoy.")

    def test_daily_spanish_plural(self):
        user = self._user("es", username="user_es2")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(user, due_count=4)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["body"], "Tienes 4 tareas pendientes hoy.")

    def test_daily_galician_singular(self):
        user = self._user("gl")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(user, due_count=1)
        kwargs = mock_send.call_args[1]
        self.assertIn("hoxe", kwargs["title"])
        self.assertEqual(kwargs["body"], "Tes 1 tarefa pendente hoxe.")

    def test_daily_galician_plural(self):
        user = self._user("gl", username="user_gl2")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(user, due_count=2)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["body"], "Tes 2 tarefas pendentes hoxe.")

    # ── due notification ──────────────────────────────────────────────────────

    def test_due_english(self):
        user = self._user("en")
        routine = make_routine(user, name="Oil change", interval_hours=720)
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_due(routine)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "Time for: Oil change")
        self.assertIn("720", kwargs["body"])

    def test_due_spanish(self):
        user = self._user("es")
        routine = make_routine(user, name="Cambiar filtro", interval_hours=24)
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_due(routine)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "Pendiente: Cambiar filtro")
        self.assertIn("alcanzado", kwargs["body"])

    def test_due_galician(self):
        user = self._user("gl")
        routine = make_routine(user, name="Revisar aceite", interval_hours=24)
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_due(routine)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "Pendente: Revisar aceite")
        self.assertIn("alcanzado", kwargs["body"])

    def test_due_uses_description_over_default_body(self):
        """If the routine has a description, it is used as body regardless of language."""
        user = self._user("es")
        routine = Routine.objects.create(
            user=user,
            name="Test",
            interval_hours=24,
            description="Descripción personalizada",
        )
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_due(routine)
        self.assertEqual(mock_send.call_args[1]["body"], "Descripción personalizada")

    # ── reminder notification ─────────────────────────────────────────────────

    def test_reminder_english(self):
        user = self._user("en")
        routine = make_routine(user, name="Check engine")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_reminder(routine, hours_overdue=5)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "Still pending: Check engine")
        self.assertEqual(kwargs["body"], "Overdue by 5h.")

    def test_reminder_spanish(self):
        user = self._user("es")
        routine = make_routine(user, name="Revisar motor")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_reminder(routine, hours_overdue=3)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "Sigue pendiente: Revisar motor")
        self.assertEqual(kwargs["body"], "Lleva 3h de retraso.")

    def test_reminder_galician(self):
        user = self._user("gl")
        routine = make_routine(user, name="Revisar motor")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_reminder(routine, hours_overdue=3)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "Segue pendente: Revisar motor")
        self.assertEqual(kwargs["body"], "Leva 3h de atraso.")

    # ── test notification ───────────────────────────────────────────────────

    def test_test_english(self):
        user = self._user("en")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_test(user)
        kwargs = mock_send.call_args[1]
        self.assertIn("Test", kwargs["title"])
        self.assertIn("working", kwargs["body"])

    def test_test_spanish(self):
        user = self._user("es")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_test(user)
        kwargs = mock_send.call_args[1]
        self.assertIn("prueba", kwargs["title"])
        self.assertIn("funcionan", kwargs["body"])

    def test_test_galician(self):
        user = self._user("gl")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_test(user)
        kwargs = mock_send.call_args[1]
        self.assertIn("proba", kwargs["title"])
        self.assertIn("funcionan", kwargs["body"])

    # ── action buttons ────────────────────────────────────────────────────────

    def test_actions_english(self):
        user = self._user("en")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(user, due_count=1)
        action_titles = [a["title"] for a in mock_send.call_args[1]["actions"]]
        self.assertIn("Mark as done", action_titles)
        self.assertIn("Dismiss", action_titles)

    def test_actions_spanish(self):
        user = self._user("es")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(user, due_count=1)
        action_titles = [a["title"] for a in mock_send.call_args[1]["actions"]]
        self.assertIn("Marcar como hecho", action_titles)
        self.assertIn("Ignorar", action_titles)

    def test_actions_galician(self):
        user = self._user("gl")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(user, due_count=1)
        action_titles = [a["title"] for a in mock_send.call_args[1]["actions"]]
        self.assertIn("Marcar como feito", action_titles)
        self.assertIn("Ignorar", action_titles)

    def test_action_ids_are_stable(self):
        """Action IDs must match what the service worker expects."""
        user = self._user("gl")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_due(make_routine(user))
        action_ids = [a["action"] for a in mock_send.call_args[1]["actions"]]
        self.assertIn("mark-done", action_ids)
        self.assertIn("dismiss", action_ids)

    # ── fallback ──────────────────────────────────────────────────────────────

    def test_unknown_language_falls_back_to_english(self):
        user = self._user("en", username="user_xx")
        User.objects.filter(pk=user.pk).update(language="xx")
        user.refresh_from_db()
        routine = make_routine(user, name="Test")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_due(routine)
        self.assertIn("Time for", mock_send.call_args[1]["title"])


# ── DST / timezone edge cases ───────────────────────────────────────────────


class DSTDailyHeadsUpTest(TestCase):
    """
    Verify that daily heads-up works correctly with real timezones,
    including around DST transitions.
    """

    def test_daily_heads_up_europe_madrid_summer(self):
        """In CEST (UTC+2), 08:30 local = 06:30 UTC."""
        from datetime import datetime
        from zoneinfo import ZoneInfo

        user = make_user(username="madrid", tz="Europe/Madrid", daily_time="08:30")
        make_routine(user, interval_hours=1)  # never logged → due

        # July 15 at 06:30 UTC = 08:30 CEST
        now_utc = datetime(2025, 7, 15, 6, 30, tzinfo=ZoneInfo("UTC"))
        now_local = now_utc.astimezone(ZoneInfo("Europe/Madrid"))

        self.assertEqual(now_local.hour, 8)
        self.assertEqual(now_local.minute, 30)

        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(user, now_utc, now_local)
            mock_notify.assert_called_once()

    def test_daily_heads_up_europe_madrid_winter(self):
        """In CET (UTC+1), 08:30 local = 07:30 UTC."""
        from datetime import datetime
        from zoneinfo import ZoneInfo

        user = make_user(username="madrid_w", tz="Europe/Madrid", daily_time="08:30")
        make_routine(user, interval_hours=1)  # never logged → due

        # January 15 at 07:30 UTC = 08:30 CET
        now_utc = datetime(2025, 1, 15, 7, 30, tzinfo=ZoneInfo("UTC"))
        now_local = now_utc.astimezone(ZoneInfo("Europe/Madrid"))

        self.assertEqual(now_local.hour, 8)
        self.assertEqual(now_local.minute, 30)

        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(user, now_utc, now_local)
            mock_notify.assert_called_once()

    def test_wrong_utc_offset_does_not_trigger(self):
        """06:30 UTC is NOT 08:30 in Madrid during winter (CET, UTC+1)."""
        from datetime import datetime
        from zoneinfo import ZoneInfo

        user = make_user(username="madrid_no", tz="Europe/Madrid", daily_time="08:30")
        make_routine(user, interval_hours=1)

        # January 15 at 06:30 UTC = 07:30 CET (not 08:30)
        now_utc = datetime(2025, 1, 15, 6, 30, tzinfo=ZoneInfo("UTC"))
        now_local = now_utc.astimezone(ZoneInfo("Europe/Madrid"))

        self.assertEqual(now_local.hour, 7)  # too early

        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(user, now_utc, now_local)
            mock_notify.assert_not_called()

    def test_is_due_today_across_timezone(self):
        """A routine due at 23:00 UTC on Jan 14 is due on Jan 15 in Madrid (00:00 CET)."""
        from datetime import datetime
        from zoneinfo import ZoneInfo

        user = make_user(username="madrid_due", tz="Europe/Madrid")
        routine = make_routine(user, interval_hours=24)

        # Create entry at Jan 13 22:30 UTC → next_due = Jan 14 22:30 UTC
        entry = make_entry(routine)
        entry_time = datetime(2025, 1, 13, 22, 30, tzinfo=ZoneInfo("UTC"))
        RoutineEntry.objects.filter(pk=entry.pk).update(created_at=entry_time)

        # Jan 14 at 23:30 UTC = Jan 15 at 00:30 CET
        now_utc = datetime(2025, 1, 14, 23, 30, tzinfo=ZoneInfo("UTC"))
        now_local = now_utc.astimezone(ZoneInfo("Europe/Madrid"))

        # In Madrid it's already Jan 15 — routine should be due today
        self.assertEqual(now_local.date().day, 15)
        self.assertTrue(_is_due_today(routine, now_local))
