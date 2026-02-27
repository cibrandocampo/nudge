from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import PushSubscription
from .push import notify_test
from .serializers import PushSubscriptionSerializer


@api_view(["POST"])
def subscribe(request):
    """Register a Web Push subscription for the authenticated user."""
    serializer = PushSubscriptionSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    data = serializer.validated_data
    PushSubscription.objects.update_or_create(
        endpoint=data["endpoint"],
        defaults={
            "user": request.user,
            "p256dh": data["keys"]["p256dh"],
            "auth": data["keys"]["auth"],
        },
    )
    return Response(status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
def unsubscribe(request):
    """Remove the Web Push subscription matching the given endpoint."""
    endpoint = request.data.get("endpoint")
    if not endpoint:
        return Response(
            {"detail": "endpoint is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
def test_push(request):
    """Send a test push notification to the authenticated user's devices."""
    if not PushSubscription.objects.filter(user=request.user).exists():
        return Response(
            {"detail": "No push subscriptions found."},
            status=status.HTTP_404_NOT_FOUND,
        )
    notify_test(request.user)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
@permission_classes([AllowAny])
def vapid_public_key(request):
    """Return the VAPID public key. No auth required — needed before login."""
    return Response({"public_key": settings.VAPID_PUBLIC_KEY})
