# Generated for T191 — email-OTP auth series.
#
# 1. Adds `auth_method` to User (default 'otp').
# 2. Backfills existing users: staff → 'password', and fails fast if any
#    user has email='' (which would break the upcoming unique constraint).
# 3. Tightens `email` to unique=True.
# 4. Creates LoginCode model.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def backfill_admin_and_check_emails(apps, schema_editor):
    User = apps.get_model("users", "User")

    blank_email_users = User.objects.filter(email="").values_list("username", flat=True)
    if blank_email_users.exists():
        raise RuntimeError(
            "Cannot apply migration users.0005 — the following user(s) have "
            f"an empty email: {list(blank_email_users)}. Email is now a required "
            "unique field. Set ADMIN_EMAIL in the environment, then re-run "
            "ensure_admin (or fix the DB directly) before re-running migrate."
        )

    User.objects.filter(is_staff=True).update(auth_method="password")


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0004_quiet_hours"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="auth_method",
            field=models.CharField(
                choices=[("otp", "OTP"), ("password", "Password")],
                default="otp",
                max_length=10,
            ),
        ),
        migrations.RunPython(backfill_admin_and_check_emails, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="user",
            name="email",
            field=models.EmailField(max_length=254, unique=True),
        ),
        migrations.CreateModel(
            name="LoginCode",
            fields=[
                (
                    "id",
                    models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID"),
                ),
                ("code_hash", models.CharField(max_length=64)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField()),
                ("attempts", models.PositiveIntegerField(default=0)),
                ("consumed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="login_codes",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "indexes": [
                    models.Index(
                        fields=["user", "consumed_at", "expires_at"],
                        name="users_login_user_id_175e92_idx",
                    )
                ],
            },
        ),
    ]
