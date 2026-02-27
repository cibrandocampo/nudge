import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("routines", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="NotificationState",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("last_due_notification", models.DateTimeField(blank=True, null=True)),
                ("last_reminder", models.DateTimeField(blank=True, null=True)),
                ("last_daily_notification", models.DateField(blank=True, null=True)),
                (
                    "routine",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="notification_state",
                        to="routines.routine",
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="PushSubscription",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("endpoint", models.CharField(max_length=1000, unique=True)),
                ("p256dh", models.CharField(max_length=200)),
                ("auth", models.CharField(max_length=200)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("last_used", models.DateTimeField(blank=True, null=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="push_subscriptions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
    ]
