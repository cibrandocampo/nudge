from django.contrib.auth import login as django_login
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.http import HttpResponseForbidden, HttpResponseRedirect
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken

from .models import User
from .serializers import ContactSerializer, UserSerializer, UserUpdateSerializer


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
        serializer = UserSerializer(request.user)
        return Response(serializer.data)

    serializer = UserUpdateSerializer(request.user, data=request.data, partial=True)
    if serializer.is_valid():
        serializer.save()
        return Response(UserSerializer(request.user).data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET", "POST"])
def contact_list_create(request):
    if request.method == "GET":
        contacts = request.user.contacts.all().order_by("username")
        return Response(ContactSerializer(contacts, many=True).data)

    username = request.data.get("username", "").strip()
    if not username:
        return Response({"detail": "Username is required."}, status=status.HTTP_400_BAD_REQUEST)

    target = User.objects.filter(username__iexact=username, is_active=True).first()
    if not target:
        return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)

    if target == request.user:
        return Response({"detail": "You cannot add yourself as a contact."}, status=status.HTTP_400_BAD_REQUEST)

    if request.user.contacts.filter(pk=target.pk).exists():
        return Response({"detail": "Already a contact."}, status=status.HTTP_400_BAD_REQUEST)

    request.user.contacts.add(target)
    return Response(ContactSerializer(target).data, status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
def contact_delete(request, pk):
    target = request.user.contacts.filter(pk=pk).first()
    if not target:
        return Response({"detail": "Contact not found."}, status=status.HTTP_404_NOT_FOUND)

    request.user.contacts.remove(target)
    # TODO TASK-08: cascade cleanup shared_with on contact removal
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def contact_search(request):
    q = request.query_params.get("q", "").strip()
    if not q:
        return Response([])

    results = (
        User.objects.filter(username__istartswith=q, is_active=True)
        .exclude(pk=request.user.pk)
        .exclude(pk__in=request.user.contacts.values_list("pk", flat=True))
        .order_by("username")[:10]
    )
    return Response(ContactSerializer(results, many=True).data)
