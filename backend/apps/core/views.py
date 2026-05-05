import os
from datetime import datetime, timezone

from django.conf import settings
from django.core.management import call_command
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def health_check(request):
    # Polled by the frontend (reachability module) every 20s while offline
    # to detect when the backend is reachable again. Must stay cheap: no DB,
    # no cache, no Celery.
    return Response(
        {
            "ok": True,
            "status": "ok",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def version_info(request):
    # Public, no auth, no DB. Read-only snapshot of env vars baked into
    # the image at build time. Surfaced for ops/debug — the frontend
    # never polls this; it reads X-App-Version from response headers
    # added by AppVersionHeaderMiddleware.
    return Response(
        {
            "version": settings.APP_VERSION,
            "commit": settings.APP_COMMIT,
            "built_at": settings.APP_BUILT_AT,
        }
    )


class SeedView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        if not (settings.DEBUG or os.environ.get("E2E_SEED_ALLOWED", "").lower() == "true"):
            return Response(status=403)
        call_command("seed")
        return Response(status=204)
