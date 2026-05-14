import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Creates a default superuser if none exists. Reads credentials from env vars."

    def handle(self, *args, **kwargs):
        User = get_user_model()

        if User.objects.filter(is_superuser=True).exists():
            self.stdout.write("Superuser already exists — skipping.")
            return

        username = os.environ.get("ADMIN_USERNAME", "admin")
        email = os.environ.get("ADMIN_EMAIL", "")
        password = os.environ.get("ADMIN_PASSWORD")

        if not password:
            self.stdout.write(self.style.WARNING("ADMIN_PASSWORD env var not set — skipping admin creation."))
            return

        # Email is required: it backs the unique email constraint and the
        # OTP/password identity model. Without it the seed admin cannot be
        # created and the migration that adds unique(email) would fail later.
        if not email:
            self.stdout.write(self.style.ERROR("ADMIN_EMAIL env var not set — skipping admin creation."))
            return

        User.objects.create_superuser(
            username=username,
            email=email,
            password=password,
            auth_method="password",
        )
        self.stdout.write(self.style.SUCCESS(f'Superuser "{username}" created.'))
