from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.routines.models import Routine, RoutineEntry, Stock

from .models import NotificationState, PushSubscription
from .push import (
    TYPE_CONTACT_ADDED,
    TYPE_DAILY,
    TYPE_DUE,
    TYPE_REMINDER,
    TYPE_ROUTINE_SHARED,
    TYPE_STOCK_SHARED,
    TYPE_TEST,
    notify_contact_added,
    notify_daily_heads_up,
    notify_due,
    notify_reminder,
    notify_routine_shared,
    notify_stock_shared,
    notify_test,
    send_push_notification,
)
from .tasks import (
    _check_daily_heads_up,
    _check_due_notification,
    _check_reminder,
    _get_or_create_state,
    _is_due_today,
    check_notifications,
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


class TestPushScheduledViewTest(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.client.force_authenticate(user=self.user)

    def test_returns_404_when_no_subscriptions(self):
        response = self.client.post("/api/push/test/scheduled/")
        self.assertEqual(response.status_code, 404)

    def test_schedules_test_notification(self):
        make_subscription(self.user)
        with patch("apps.notifications.views.send_scheduled_test") as mock_task:
            mock_task.apply_async = MagicMock()
            response = self.client.post("/api/push/test/scheduled/")
        self.assertEqual(response.status_code, 202)
        mock_task.apply_async.assert_called_once_with(
            args=[self.user.id], countdown=300,
        )

    def test_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.post("/api/push/test/scheduled/")
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
            notify_daily_heads_up(self.user, due_count=1, names=["Filter change"])
            args = mock_send.call_args
            self.assertEqual(args[1]["type"], TYPE_DAILY)
            self.assertIn("1", args[1]["title"])
            self.assertIn("task", args[1]["title"])
            self.assertEqual(args[1]["body"], "Filter change")

    def test_notify_daily_heads_up_plural(self):
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(self.user, due_count=3, names=["A", "B", "C"])
            args = mock_send.call_args
            title = args[1]["title"]
            self.assertIn("3", title)
            self.assertIn("tasks", title)
            self.assertEqual(args[1]["body"], "A, B, C")

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
            self.assertIn("Push test", args[1]["title"])

    def test_notify_contact_added(self):
        requester = make_user(username="alice")
        target = make_user(username="bob")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_contact_added(requester, target)
            args = mock_send.call_args
            self.assertEqual(args[0][0], target)
            self.assertEqual(args[1]["type"], TYPE_CONTACT_ADDED)
            self.assertIn("alice", args[1]["body"])

    def test_notify_routine_shared(self):
        owner = make_user(username="alice")
        recipient = make_user(username="bob")
        routine = make_routine(owner, name="Water filter")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_routine_shared(routine, recipient)
            args = mock_send.call_args
            self.assertEqual(args[0][0], recipient)
            self.assertEqual(args[1]["type"], TYPE_ROUTINE_SHARED)
            self.assertIn("Water filter", args[1]["title"])
            self.assertIn("alice", args[1]["body"])
            self.assertEqual(args[1]["data"]["routine_id"], routine.id)

    def test_notify_stock_shared(self):
        owner = make_user(username="alice")
        recipient = make_user(username="bob")
        stock = Stock.objects.create(user=owner, name="Insulin pens")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_stock_shared(stock, recipient)
            args = mock_send.call_args
            self.assertEqual(args[0][0], recipient)
            self.assertEqual(args[1]["type"], TYPE_STOCK_SHARED)
            self.assertIn("Insulin pens", args[1]["title"])
            self.assertIn("alice", args[1]["body"])


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
        self.assertTrue(_is_due_today(routine, now_local, ZoneInfo("UTC")))

    def test_returns_true_when_due_today(self):
        user = make_user(tz="UTC")
        routine = make_routine(user, interval_hours=1)
        make_entry(routine, offset_hours=-2)  # 2h ago → due 1h ago
        now_local = timezone.now()
        self.assertTrue(_is_due_today(routine, now_local, ZoneInfo("UTC")))

    def test_returns_false_when_due_in_future(self):
        user = make_user(tz="UTC")
        routine = make_routine(user, interval_hours=100)
        make_entry(routine)  # just now → not due for 100h
        now_local = timezone.now()
        self.assertFalse(_is_due_today(routine, now_local, ZoneInfo("UTC")))

    def test_uses_recipient_timezone_not_owner(self):
        """Owner in UTC, recipient in Auckland (+13). Same moment in time
        yields different 'due today' results depending on recipient timezone."""
        owner = make_user(username="owner_tz", tz="UTC")
        routine = make_routine(owner, interval_hours=24)
        # Entry at Jan 14 10:00 UTC → next_due = Jan 15 10:00 UTC
        entry = make_entry(routine)
        entry_time = datetime(2025, 1, 14, 10, 0, tzinfo=ZoneInfo("UTC"))
        RoutineEntry.objects.filter(pk=entry.pk).update(created_at=entry_time)
        # Re-fetch routine to clear any cached last_entry
        routine = Routine.objects.get(pk=routine.pk)

        # Now at Jan 14 23:00 UTC.
        # UTC perspective: today is Jan 14, due date is Jan 15 → NOT due today.
        # Auckland (+13): today is Jan 15, due date in Auckland is Jan 15 → due today.
        now_utc = datetime(2025, 1, 14, 23, 0, tzinfo=ZoneInfo("UTC"))
        now_auckland = now_utc.astimezone(ZoneInfo("Pacific/Auckland"))

        self.assertFalse(_is_due_today(routine, now_utc, ZoneInfo("UTC")))
        self.assertTrue(_is_due_today(routine, now_auckland, ZoneInfo("Pacific/Auckland")))

    def test_owner_timezone_ignored(self):
        """Changing owner timezone should not affect result when user_tz differs."""
        owner = make_user(username="owner_ig", tz="US/Eastern")
        routine = make_routine(owner, interval_hours=24)
        entry = make_entry(routine)
        entry_time = datetime(2025, 1, 14, 10, 0, tzinfo=ZoneInfo("UTC"))
        RoutineEntry.objects.filter(pk=entry.pk).update(created_at=entry_time)
        routine = Routine.objects.get(pk=routine.pk)

        now_utc = datetime(2025, 1, 14, 23, 0, tzinfo=ZoneInfo("UTC"))
        now_local = now_utc.astimezone(ZoneInfo("Pacific/Auckland"))
        result = _is_due_today(routine, now_local, ZoneInfo("Pacific/Auckland"))
        # Owner is US/Eastern but we pass Auckland — owner tz is irrelevant
        self.assertTrue(result)


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
            _check_daily_heads_up(self.user, now, now, ZoneInfo("UTC"))
            mock_notify.assert_not_called()

    def test_does_not_send_when_no_due_routines(self):
        # Routine not due (logged very recently)
        routine = make_routine(self.user, interval_hours=100)
        make_entry(routine)
        now = self._now_at(8, 30)
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(self.user, now, now, ZoneInfo("UTC"))
            mock_notify.assert_not_called()

    def test_sends_when_at_configured_time_with_due_routines(self):
        make_routine(self.user, interval_hours=1)  # never logged → due
        now = self._now_at(8, 30)
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(self.user, now, now, ZoneInfo("UTC"))
            mock_notify.assert_called_once()

    def test_does_not_repeat_if_already_sent_today(self):
        routine = make_routine(self.user, interval_hours=1)
        now = self._now_at(8, 30)
        NotificationState.objects.create(
            routine=routine,
            last_daily_notification=now.date(),
        )
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(self.user, now, now, ZoneInfo("UTC"))
            mock_notify.assert_not_called()

    def test_marks_all_due_routines_as_notified(self):
        r1 = make_routine(self.user, name="R1", interval_hours=1)
        r2 = make_routine(self.user, name="R2", interval_hours=1)
        now = self._now_at(8, 30)
        expected_date = now.date()
        with patch("apps.notifications.tasks.notify_daily_heads_up"):
            _check_daily_heads_up(self.user, now, now, ZoneInfo("UTC"))
        for routine in [r1, r2]:
            state = NotificationState.objects.get(routine=routine)
            self.assertEqual(state.last_daily_notification, expected_date)

    def test_window_tolerance_at_minus_5_minutes(self):
        """8:25 should still trigger (within ±5 min of 8:30)."""
        make_routine(self.user, interval_hours=1)
        now = self._now_at(8, 25)
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(self.user, now, now, ZoneInfo("UTC"))
            mock_notify.assert_called_once()

    def test_window_tolerance_at_plus_5_minutes(self):
        """8:35 should still trigger."""
        make_routine(self.user, interval_hours=1)
        now = self._now_at(8, 35)
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(self.user, now, now, ZoneInfo("UTC"))
            mock_notify.assert_called_once()

    def test_outside_window_does_not_trigger(self):
        """8:36 should not trigger (outside ±5 min)."""
        make_routine(self.user, interval_hours=1)
        now = self._now_at(8, 36)
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(self.user, now, now, ZoneInfo("UTC"))
            mock_notify.assert_not_called()

    def test_window_cross_hour_boundary(self):
        """Target 08:58, now 09:01 — 3 min apart, should trigger."""
        user = make_user(username="cross_hr", tz="UTC", daily_time="08:58")
        make_routine(user, interval_hours=1)
        now = self._now_at(9, 1)
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(user, now, now, ZoneInfo("UTC"))
            mock_notify.assert_called_once()

    def test_window_cross_hour_boundary_outside(self):
        """Target 08:50, now 09:01 — 11 min apart, should NOT trigger."""
        user = make_user(username="cross_hr_out", tz="UTC", daily_time="08:50")
        make_routine(user, interval_hours=1)
        now = self._now_at(9, 1)
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(user, now, now, ZoneInfo("UTC"))
            mock_notify.assert_not_called()

    def test_does_not_send_twice_when_new_routine_enters_due_state(self):
        """
        Regression test for Fix 5: if a second Celery run fires within the window
        and a new routine became due, the daily notification must NOT be sent again.

        Scenario: first run sent for r1 (marked today). Second run finds r1 + r2 due.
        Because r1 is already marked today (any() is True), no second send occurs.
        """
        r1 = make_routine(self.user, name="R1", interval_hours=1)
        make_routine(self.user, name="R2", interval_hours=1)
        now = self._now_at(8, 30)
        # r1 was already notified in the first run
        NotificationState.objects.create(routine=r1, last_daily_notification=now.date())
        # r2 has no state yet (new)

        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(self.user, now, now, ZoneInfo("UTC"))
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
            mock_notify.assert_called_once_with(routine, target_user=self.user)

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

    def test_hours_overdue_positive_for_never_logged_routine(self):
        """Never-logged routine should report hours > 0, not 0."""
        routine = make_routine(self.user, interval_hours=1)
        # No entries — routine was never logged
        due_sent_at = timezone.now() - timedelta(hours=9)
        NotificationState.objects.create(
            routine=routine,
            last_due_notification=due_sent_at,
        )
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_reminder") as mock_notify:
            _check_reminder(routine, now)
            _, kwargs = mock_notify.call_args
            self.assertGreater(kwargs["hours_overdue"], 0)


# ── check_notifications Celery task ──────────────────────────────────────────


class CheckNotificationsTaskTest(TestCase):
    """Integration-style test for the main Celery task."""

    def test_invalid_timezone_skips_user_without_error(self):
        user = make_user(username="badtz")
        # Force invalid timezone bypassing model validation
        User.objects.filter(pk=user.pk).update(timezone="Not/Valid")
        # Should not raise
        check_notifications()

    def test_processes_active_users(self):
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
        user = make_user(username="inactive")
        User.objects.filter(pk=user.pk).update(is_active=False)
        make_routine(user, interval_hours=1)
        with patch("apps.notifications.tasks.notify_due") as mock_due:
            check_notifications()
            mock_due.assert_not_called()

    def test_skips_users_with_no_push_subscriptions(self):
        """Users without push subscriptions should be excluded from processing."""
        user = make_user(username="no_sub")
        make_routine(user, interval_hours=1)  # overdue → would trigger notify_due
        # No subscription created for this user
        with patch("apps.notifications.tasks.notify_due") as mock_due:
            check_notifications()
            mock_due.assert_not_called()

    def test_processes_users_with_push_subscriptions(self):
        """Users with push subscriptions should be processed."""
        user = make_user(username="with_sub")
        make_routine(user, interval_hours=1)  # never logged → overdue
        make_subscription(user)
        with (
            patch("apps.notifications.tasks.notify_due") as mock_due,
            patch("apps.notifications.tasks.notify_daily_heads_up"),
            patch("apps.notifications.tasks.notify_reminder"),
        ):
            check_notifications()
            mock_due.assert_called_once()


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
            notify_daily_heads_up(user, due_count=1, names=["Oil change"])
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "1 task today")
        self.assertEqual(kwargs["body"], "Oil change")

    def test_daily_english_plural(self):
        user = self._user("en", username="user_en2")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(user, due_count=3, names=["Oil change", "Water plants", "Check filter"])
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "3 tasks today")
        self.assertEqual(kwargs["body"], "Oil change, Water plants, Check filter")

    def test_daily_spanish_singular(self):
        user = self._user("es")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(user, due_count=1, names=["Cambiar filtro"])
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "1 tarea hoy")
        self.assertEqual(kwargs["body"], "Cambiar filtro")

    def test_daily_spanish_plural(self):
        user = self._user("es", username="user_es2")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(user, due_count=4, names=["A", "B", "C", "D"])
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "4 tareas hoy")
        self.assertEqual(kwargs["body"], "A, B, C, D")

    def test_daily_galician_singular(self):
        user = self._user("gl")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(user, due_count=1, names=["Revisar aceite"])
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "1 tarefa hoxe")
        self.assertEqual(kwargs["body"], "Revisar aceite")

    def test_daily_galician_plural(self):
        user = self._user("gl", username="user_gl2")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_daily_heads_up(user, due_count=2, names=["Revisar aceite", "Cambiar filtro"])
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "2 tarefas hoxe")
        self.assertEqual(kwargs["body"], "Revisar aceite, Cambiar filtro")

    # ── due notification ──────────────────────────────────────────────────────

    def _logged_routine(self, user, **kwargs):
        """Create a routine with one entry so next_due_at() returns a real datetime."""
        routine = make_routine(user, **kwargs)
        RoutineEntry.objects.create(
            routine=routine,
            created_at=timezone.now() - timedelta(hours=routine.interval_hours),
        )
        return routine

    def test_due_english(self):
        user = self._user("en")
        routine = self._logged_routine(user, name="Oil change", interval_hours=720)
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_due(routine)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "Oil change")
        self.assertRegex(kwargs["body"], r"^Due at \d{2}:\d{2}$")

    def test_due_spanish(self):
        user = self._user("es")
        routine = self._logged_routine(user, name="Cambiar filtro", interval_hours=24)
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_due(routine)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "Cambiar filtro")
        self.assertRegex(kwargs["body"], r"^Desde las \d{2}:\d{2}$")

    def test_due_galician(self):
        user = self._user("gl")
        routine = self._logged_routine(user, name="Revisar aceite", interval_hours=24)
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_due(routine)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "Revisar aceite")
        self.assertRegex(kwargs["body"], r"^Dende as \d{2}:\d{2}$")

    def test_due_never_logged_has_empty_body(self):
        """Routines never logged have no next_due_at — body should be empty."""
        user = self._user("en", username="user_en_never")
        routine = make_routine(user, name="Never done")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_due(routine)
        self.assertEqual(mock_send.call_args[1]["body"], "")

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
        self.assertEqual(kwargs["title"], "Check engine")
        self.assertEqual(kwargs["body"], "5h overdue")

    def test_reminder_spanish(self):
        user = self._user("es")
        routine = make_routine(user, name="Revisar motor")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_reminder(routine, hours_overdue=3)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "Revisar motor")
        self.assertEqual(kwargs["body"], "3h de retraso")

    def test_reminder_galician(self):
        user = self._user("gl")
        routine = make_routine(user, name="Revisar motor")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_reminder(routine, hours_overdue=3)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "Revisar motor")
        self.assertEqual(kwargs["body"], "3h de atraso")

    # ── test notification ───────────────────────────────────────────────────

    def test_test_english(self):
        user = self._user("en")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_test(user)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "Push test")
        self.assertEqual(kwargs["body"], "It works!")

    def test_test_spanish(self):
        user = self._user("es")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_test(user)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "Prueba push")
        self.assertEqual(kwargs["body"], "¡Funciona!")

    def test_test_galician(self):
        user = self._user("gl")
        with patch("apps.notifications.push.send_push_notification") as mock_send:
            notify_test(user)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs["title"], "Proba push")
        self.assertEqual(kwargs["body"], "Funciona!")

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
        self.assertEqual(mock_send.call_args[1]["title"], "Test")


# ── DST / timezone edge cases ───────────────────────────────────────────────


class DSTDailyHeadsUpTest(TestCase):
    """
    Verify that daily heads-up works correctly with real timezones,
    including around DST transitions.
    """

    def test_daily_heads_up_europe_madrid_summer(self):
        """In CEST (UTC+2), 08:30 local = 06:30 UTC."""
        user = make_user(username="madrid", tz="Europe/Madrid", daily_time="08:30")
        make_routine(user, interval_hours=1)  # never logged → due

        # July 15 at 06:30 UTC = 08:30 CEST
        now_utc = datetime(2025, 7, 15, 6, 30, tzinfo=ZoneInfo("UTC"))
        user_tz = ZoneInfo("Europe/Madrid")
        now_local = now_utc.astimezone(user_tz)

        self.assertEqual(now_local.hour, 8)
        self.assertEqual(now_local.minute, 30)

        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(user, now_utc, now_local, user_tz)
            mock_notify.assert_called_once()

    def test_daily_heads_up_europe_madrid_winter(self):
        """In CET (UTC+1), 08:30 local = 07:30 UTC."""
        user = make_user(username="madrid_w", tz="Europe/Madrid", daily_time="08:30")
        make_routine(user, interval_hours=1)  # never logged → due

        # January 15 at 07:30 UTC = 08:30 CET
        now_utc = datetime(2025, 1, 15, 7, 30, tzinfo=ZoneInfo("UTC"))
        user_tz = ZoneInfo("Europe/Madrid")
        now_local = now_utc.astimezone(user_tz)

        self.assertEqual(now_local.hour, 8)
        self.assertEqual(now_local.minute, 30)

        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(user, now_utc, now_local, user_tz)
            mock_notify.assert_called_once()

    def test_wrong_utc_offset_does_not_trigger(self):
        """06:30 UTC is NOT 08:30 in Madrid during winter (CET, UTC+1)."""
        user = make_user(username="madrid_no", tz="Europe/Madrid", daily_time="08:30")
        make_routine(user, interval_hours=1)

        # January 15 at 06:30 UTC = 07:30 CET (not 08:30)
        now_utc = datetime(2025, 1, 15, 6, 30, tzinfo=ZoneInfo("UTC"))
        user_tz = ZoneInfo("Europe/Madrid")
        now_local = now_utc.astimezone(user_tz)

        self.assertEqual(now_local.hour, 7)  # too early

        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(user, now_utc, now_local, user_tz)
            mock_notify.assert_not_called()

    def test_is_due_today_across_timezone(self):
        """A routine due at 23:00 UTC on Jan 14 is due on Jan 15 in Madrid (00:00 CET)."""
        user = make_user(username="madrid_due", tz="Europe/Madrid")
        routine = make_routine(user, interval_hours=24)

        # Create entry at Jan 13 22:30 UTC → next_due = Jan 14 22:30 UTC
        entry = make_entry(routine)
        entry_time = datetime(2025, 1, 13, 22, 30, tzinfo=ZoneInfo("UTC"))
        RoutineEntry.objects.filter(pk=entry.pk).update(created_at=entry_time)
        routine = Routine.objects.get(pk=routine.pk)  # clear last_entry cache

        # Jan 14 at 23:30 UTC = Jan 15 at 00:30 CET
        now_utc = datetime(2025, 1, 14, 23, 30, tzinfo=ZoneInfo("UTC"))
        now_local = now_utc.astimezone(ZoneInfo("Europe/Madrid"))

        # In Madrid it's already Jan 15 — routine should be due today
        self.assertEqual(now_local.date().day, 15)
        self.assertTrue(_is_due_today(routine, now_local, ZoneInfo("Europe/Madrid")))


# ── Shared Routine Notifications ─────────────────────────────────────────────


@override_settings(
    VAPID_PRIVATE_KEY="fake-private-key",
    VAPID_PUBLIC_KEY="fake-public-key",
    VAPID_CLAIMS_EMAIL="test@example.com",
)
class SharedRoutineNotificationTest(TestCase):
    def setUp(self):
        self.owner = make_user(username="owner")
        self.shared_user = make_user(username="shared_user")
        make_subscription(self.owner, endpoint="https://example.com/push/owner")
        make_subscription(self.shared_user, endpoint="https://example.com/push/shared")
        self.routine = make_routine(self.owner, interval_hours=1)
        self.routine.shared_with.add(self.shared_user)
        # Make routine overdue (entry 2h ago)
        make_entry(self.routine, offset_hours=-2)

    @patch("apps.notifications.push.webpush")
    def test_due_notification_sends_to_all_members(self, mock_webpush):
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_due") as mock_notify:
            _check_due_notification(self.routine, now)
            self.assertEqual(mock_notify.call_count, 2)
            called_users = {c.kwargs["target_user"] for c in mock_notify.call_args_list}
            self.assertEqual(called_users, {self.owner, self.shared_user})

    @patch("apps.notifications.push.webpush")
    def test_due_notification_only_fires_once(self, mock_webpush):
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_due") as mock_notify:
            _check_due_notification(self.routine, now)
            self.assertEqual(mock_notify.call_count, 2)
        # Second call should skip (already notified this cycle)
        with patch("apps.notifications.tasks.notify_due") as mock_notify:
            _check_due_notification(self.routine, now + timedelta(minutes=1))
            mock_notify.assert_not_called()

    @patch("apps.notifications.push.webpush")
    def test_reminder_sends_to_all_members(self, mock_webpush):
        now = timezone.now()
        # First set up due notification state
        NotificationState.objects.create(
            routine=self.routine,
            last_due_notification=now - timedelta(hours=3),
        )
        with patch("apps.notifications.tasks.notify_reminder") as mock_notify:
            _check_reminder(self.routine, now)
            self.assertEqual(mock_notify.call_count, 2)
            called_users = {c.kwargs["target_user"] for c in mock_notify.call_args_list}
            self.assertEqual(called_users, {self.owner, self.shared_user})

    @patch("apps.notifications.push.webpush")
    def test_completion_stops_notifications_for_all(self, mock_webpush):
        now = timezone.now()
        # Send due notification first
        with patch("apps.notifications.tasks.notify_due"):
            _check_due_notification(self.routine, now)
        # Owner completes the routine
        RoutineEntry.objects.create(routine=self.routine, completed_by=self.owner)
        # Reset notification state (as done in log view)
        state = NotificationState.objects.get(routine=self.routine)
        state.last_due_notification = None
        state.last_reminder = None
        state.save()
        # Refresh routine to clear cached last_entry
        self.routine.refresh_from_db()
        if hasattr(self.routine, "_last_entry_cache"):
            del self.routine._last_entry_cache
        # Routine is no longer overdue, so no notifications should be sent
        self.assertFalse(self.routine.is_overdue())
        with patch("apps.notifications.tasks.notify_due") as mock_notify:
            _check_due_notification(self.routine, now + timedelta(minutes=1))
            mock_notify.assert_not_called()

    @patch("apps.notifications.push.webpush")
    def test_daily_heads_up_includes_shared_routines(self, mock_webpush):
        # Create a routine owned by owner but shared with shared_user
        routine = make_routine(self.owner, name="Shared daily", interval_hours=24)
        routine.shared_with.add(self.shared_user)
        # Make routine overdue (never logged)

        now = timezone.now()
        # Set shared_user's notification time to now
        self.shared_user.daily_notification_time = now.time()
        self.shared_user.save()

        # Include routine in all_routines
        all_routines = [routine]
        with patch("apps.notifications.tasks.notify_daily_heads_up") as mock_notify:
            _check_daily_heads_up(self.shared_user, now, now, ZoneInfo("UTC"), all_routines)
            mock_notify.assert_called_once()
            call_args = mock_notify.call_args
            self.assertEqual(call_args.kwargs["due_count"], 1)
            self.assertIn("Shared daily", call_args.kwargs["names"])

    @patch("apps.notifications.push.webpush")
    def test_no_duplicate_processing(self, mock_webpush):
        """Shared routine is not processed twice via processed_routines set."""
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_due") as mock_notify:
            # Simulate the dedup logic from check_notifications
            processed_routines = set()
            # First processing (as owner)
            if self.routine.id not in processed_routines:
                processed_routines.add(self.routine.id)
                _check_due_notification(self.routine, now)
            # Second processing (as shared_user) — should be skipped
            if self.routine.id not in processed_routines:
                _check_due_notification(self.routine, now)
            # Only called once (2 members), not twice (4 calls)
            self.assertEqual(mock_notify.call_count, 2)

    @patch("apps.notifications.push.webpush")
    def test_shared_user_without_subscription_not_notified(self, mock_webpush):
        # Remove shared_user's subscription
        PushSubscription.objects.filter(user=self.shared_user).delete()
        now = timezone.now()
        # notify_due sends to all members, but send_push_notification
        # for shared_user will be a no-op (no subscriptions)
        _check_due_notification(self.routine, now)
        # webpush is only called for owner's subscription
        self.assertEqual(mock_webpush.call_count, 1)

    @patch("apps.notifications.push.webpush")
    def test_unsharing_stops_notifications(self, mock_webpush):
        # Remove shared_user from shared_with
        self.routine.shared_with.remove(self.shared_user)
        now = timezone.now()
        with patch("apps.notifications.tasks.notify_due") as mock_notify:
            _check_due_notification(self.routine, now)
            # Only owner should be notified
            mock_notify.assert_called_once_with(self.routine, target_user=self.owner)
