import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Generate a VAPID key pair for Web Push notifications. Run once and copy the output to your .env file."

    def handle(self, *args, **kwargs):
        # Generate EC P-256 private key
        private_key = ec.generate_private_key(ec.SECP256R1())

        # Private key — raw bytes, URL-safe base64 (no padding)
        private_bytes = private_key.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption(),
        )
        private_b64 = base64.urlsafe_b64encode(private_bytes).decode().rstrip("=")

        # Public key — uncompressed point format, URL-safe base64 (no padding)
        public_bytes = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.X962,
            format=serialization.PublicFormat.UncompressedPoint,
        )
        public_b64 = base64.urlsafe_b64encode(public_bytes).decode().rstrip("=")

        self.stdout.write(self.style.SUCCESS("VAPID key pair generated. Add these to your .env:\n"))
        self.stdout.write(f"VAPID_PRIVATE_KEY={private_b64}")
        self.stdout.write(f"VAPID_PUBLIC_KEY={public_b64}")
        self.stdout.write(f"VITE_VAPID_PUBLIC_KEY={public_b64}")
        self.stdout.write(self.style.WARNING("\nNote: VAPID_PUBLIC_KEY and VITE_VAPID_PUBLIC_KEY must be identical."))
