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


class E2ESeedView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        if not (settings.DEBUG or os.environ.get("E2E_SEED_ALLOWED", "").lower() == "true"):
            return Response(status=403)
        call_command("seed_e2e")
        return Response(status=204)
