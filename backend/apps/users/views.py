from django.conf import settings
from django.contrib.auth import login as django_login
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.http import HttpResponseForbidden, HttpResponseRedirect
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from apps.core.mixins import parse_http_date
from apps.notifications.push import notify_contact_added
from apps.routines.models import Routine, Stock

from .email_validation import is_disposable_email
from .models import User
from .serializers import (
    ContactSerializer,
    LoginStartSerializer,
    LoginVerifySerializer,
    UserSerializer,
    UserUpdateSerializer,
)
from .services import create_signup_user, issue_otp, resolve_lang, verify_otp
from .throttles import EmailDestThrottle, LoginStartThrottle, LoginVerifyThrottle


@api_view(["GET"])
@permission_classes([AllowAny])
def auth_config(request):
    """Public, unauthenticated. Exposes server-side feature flags the
    /login page needs to render the right copy (e.g. "Sign in" vs
    "Sign in or register"). Kept intentionally small — only knobs the
    pre-login UI must know about belong here.
    """
    return Response({"allow_self_signup": settings.ALLOW_SELF_SIGNUP})


@csrf_exempt
def admin_access(request):
    """Validate a JWT token and create a Django session, then redirect to /admin/."""
    if request.method != "POST":
        return HttpResponseForbidden("Method not allowed.")
    token_str = request.POST.get("token", "")
    try:
        token = AccessToken(token_str)
        user = User.objects.get(id=token["user_id"])
    except (TokenError, InvalidToken, User.DoesNotExist, KeyError):
        return HttpResponseForbidden("Invalid or expired token.")

    if not user.is_staff:
        return HttpResponseForbidden("Staff access required.")

    django_login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return HttpResponseRedirect("/admin/")


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([LoginStartThrottle, EmailDestThrottle])
def login_start(request):
    """Step 1 of the email-OTP flow. The frontend posts the email; we
    decide what the second step should be (`otp` or `password`) and,
    when OTP is in play, fire off the email via Celery.

    Response shape: ``{"method": "otp" | "password"}`` (200) or
    ``{"error": "user_not_found"}`` (404) when self-signup is disabled.
    """
    serializer = LoginStartSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    email = serializer.validated_data["email"]

    user = User.objects.filter(email__iexact=email).first()

    if user is None:
        if not settings.ALLOW_SELF_SIGNUP:
            return Response({"error": "user_not_found"}, status=status.HTTP_404_NOT_FOUND)
        # Reject self-signup from throwaway / disposable mailbox services.
        # Only applied to NEW signups — existing users with such an email
        # are not blocked retroactively. Gated by BLOCK_DISPOSABLE_EMAIL
        # (default ON in production, OFF in dev).
        if settings.BLOCK_DISPOSABLE_EMAIL and is_disposable_email(email):
            return Response({"error": "disposable_email"}, status=status.HTTP_400_BAD_REQUEST)
        lang = resolve_lang(request)
        user = create_signup_user(email)
        issue_otp(user, is_signup=True, lang=lang)
        return Response({"method": "otp"})

    if user.auth_method == "password":
        return Response({"method": "password"})

    # OTP user: prefer the stored language; fall back to Accept-Language.
    lang = user.language or resolve_lang(request)
    issue_otp(user, is_signup=False, lang=lang)
    return Response({"method": "otp"})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([LoginVerifyThrottle])
def login_verify(request):
    """Step 2 of the email-OTP flow. Accepts ``{email, code}`` for OTP
    users or ``{email, password}`` for password users, and on success
    issues an access + refresh JWT pair plus an ``is_new`` flag the
    frontend uses to decide whether to ask for first/last name.
    """
    serializer = LoginVerifySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    email = serializer.validated_data["email"]
    code = serializer.validated_data.get("code")
    password = serializer.validated_data.get("password")

    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        return Response({"error": "invalid"}, status=status.HTTP_400_BAD_REQUEST)

    if code is not None:
        if user.auth_method != "otp":
            return Response({"error": "method_mismatch"}, status=status.HTTP_400_BAD_REQUEST)
        if not verify_otp(user, code):
            return Response({"error": "invalid"}, status=status.HTTP_400_BAD_REQUEST)
        if not user.is_active:
            user.is_active = True
            user.save(update_fields=["is_active"])
    else:
        if user.auth_method != "password":
            return Response({"error": "method_mismatch"}, status=status.HTTP_400_BAD_REQUEST)
        if not user.check_password(password):
            return Response({"error": "invalid"}, status=status.HTTP_400_BAD_REQUEST)

    refresh = RefreshToken.for_user(user)
    is_new = not (user.first_name or user.last_name)
    return Response(
        {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "is_new": is_new,
        }
    )


@api_view(["POST"])
def change_password(request):
    current = request.data.get("current_password", "")
    new = request.data.get("new_password", "")
    if not request.user.check_password(current):
        return Response({"detail": "Incorrect current password."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        validate_password(new, request.user)
    except ValidationError as e:
        return Response({"detail": e.messages[0]}, status=status.HTTP_400_BAD_REQUEST)
    request.user.set_password(new)
    request.user.save(update_fields=["password"])
    return Response({"detail": "Password changed."})


@api_view(["GET", "PATCH"])
def me(request):
    if request.method == "GET":
        serializer = UserSerializer(request.user, context={"request": request})
        return Response(serializer.data)

    # Optimistic concurrency: If-Unmodified-Since is compared against the
    # user's `settings_updated_at` field (bumped only on settings changes by
    # UserUpdateSerializer).
    header = request.headers.get("If-Unmodified-Since")
    if header:
        since = parse_http_date(header)
        if since is None:
            return Response(
                {"error": "Invalid If-Unmodified-Since header"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        server_value = request.user.settings_updated_at
        if server_value.replace(microsecond=0) > since.replace(microsecond=0):
            return Response(
                {
                    "error": "conflict",
                    "current": UserSerializer(request.user, context={"request": request}).data,
                },
                status=status.HTTP_412_PRECONDITION_FAILED,
            )

    serializer = UserUpdateSerializer(request.user, data=request.data, partial=True)
    if serializer.is_valid():
        serializer.save()
        return Response(UserSerializer(request.user, context={"request": request}).data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET", "POST"])
def contact_list_create(request):
    if request.method == "GET":
        contacts = request.user.contacts.all().order_by("first_name", "last_name", "email")
        return Response(ContactSerializer(contacts, many=True).data)

    email = (request.data.get("email") or "").strip().lower()
    if not email:
        return Response({"detail": "Email is required."}, status=status.HTTP_400_BAD_REQUEST)

    target = User.objects.filter(email__iexact=email, is_active=True).first()
    if not target:
        return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)

    if target == request.user:
        return Response({"detail": "You cannot add yourself as a contact."}, status=status.HTTP_400_BAD_REQUEST)

    if request.user.contacts.filter(pk=target.pk).exists():
        return Response({"detail": "Already a contact."}, status=status.HTTP_400_BAD_REQUEST)

    request.user.contacts.add(target)
    notify_contact_added(request.user, target)
    return Response(ContactSerializer(target).data, status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
def contact_delete(request, pk):
    target = request.user.contacts.filter(pk=pk).first()
    if not target:
        return Response({"detail": "Contact not found."}, status=status.HTTP_404_NOT_FOUND)

    request.user.contacts.remove(target)

    # Cascade: remove sharing between both users
    for routine in Routine.objects.filter(user=request.user, shared_with=target):
        routine.shared_with.remove(target)
    for stock in Stock.objects.filter(user=request.user, shared_with=target):
        stock.shared_with.remove(target)
    for routine in Routine.objects.filter(user=target, shared_with=request.user):
        routine.shared_with.remove(request.user)
    for stock in Stock.objects.filter(user=target, shared_with=request.user):
        stock.shared_with.remove(request.user)

    return Response(status=status.HTTP_204_NO_CONTENT)
