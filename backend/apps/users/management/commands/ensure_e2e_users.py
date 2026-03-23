import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Creates secondary users required by e2e tests. Idempotent."

    def handle(self, *args, **kwargs):
        users = [
            {
                "username": os.environ.get("E2E_USER2_USERNAME", "e2e-user2"),
                "password": os.environ.get("E2E_USER2_PASSWORD", "e2e-pass2"),
            },
        ]
        User = get_user_model()
        for spec in users:
            user, created = User.objects.get_or_create(username=spec["username"], defaults={"is_active": True})
            user.set_password(spec["password"])
            user.save(update_fields=["password"])
            status = "created" if created else "updated"
            self.stdout.write(self.style.SUCCESS(f'E2E user "{user.username}" {status}.'))
