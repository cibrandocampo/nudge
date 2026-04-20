import hashlib
import json
import logging

from django.db import IntegrityError, transaction
from django.http import JsonResponse
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

from .models import IdempotencyRecord

logger = logging.getLogger(__name__)

MUTATION_METHODS = frozenset({"POST", "PATCH", "PUT", "DELETE"})
API_PREFIX = "/api/"
HEADER_NAME = "Idempotency-Key"
MAX_KEY_LENGTH = 64


class IdempotencyMiddleware:
    """
    Deduplicates mutations under /api/ based on the Idempotency-Key header.

    First request with a given (user, key): processes normally and stores the
    response. Any later request with the same (user, key, body_hash) returns
    the cached response without re-executing the view. A reused key with a
    different body returns 422.

    Requests without the header, non-mutations, non-/api/ paths and
    unauthenticated requests pass through untouched.

    The API uses JWT authentication, which runs at the DRF view level (after
    Django middleware). So this middleware authenticates the request itself
    using the same JWT authenticator, instead of relying on request.user.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.jwt_authenticator = JWTAuthentication()

    def __call__(self, request):
        if not self._is_candidate(request):
            return self.get_response(request)

        key = request.headers.get(HEADER_NAME)
        if not key:
            logger.warning(
                "Mutation without Idempotency-Key: %s %s",
                request.method,
                request.path,
            )
            return self.get_response(request)

        if len(key) > MAX_KEY_LENGTH:
            return self.get_response(request)

        user = self._resolve_user(request)
        if user is None or not user.is_authenticated:
            return self.get_response(request)

        body_hash = hashlib.sha256(request.body or b"").hexdigest()

        try:
            existing = IdempotencyRecord.objects.get(user=user, key=key)
        except IdempotencyRecord.DoesNotExist:
            existing = None

        if existing is not None:
            if existing.body_hash != body_hash:
                return JsonResponse(
                    {"error": "Idempotency-Key reused with a different body"},
                    status=422,
                )
            return JsonResponse(
                existing.response_body,
                status=existing.response_status,
                safe=False,
            )

        response = self.get_response(request)

        if 200 <= response.status_code < 500:
            self._store(user, request, key, body_hash, response)

        return response

    @staticmethod
    def _is_candidate(request):
        if request.method not in MUTATION_METHODS:
            return False
        if not request.path.startswith(API_PREFIX):
            return False
        return True

    def _resolve_user(self, request):
        """
        Resolve the authenticated user.

        Tries JWT first (production path, matches DRF's authentication class).
        Falls back to request.user which may already be set by Django's
        session middleware or by APIClient.force_login in tests.
        """
        try:
            user_token = self.jwt_authenticator.authenticate(request)
        except (InvalidToken, TokenError):
            user_token = None
        if user_token is not None:
            user, _ = user_token
            return user

        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            return user
        return None

    @staticmethod
    def _store(user, request, key, body_hash, response):
        response_body = IdempotencyMiddleware._parse_response_body(response)
        try:
            with transaction.atomic():
                IdempotencyRecord.objects.create(
                    user=user,
                    key=key,
                    endpoint=request.path[:255],
                    method=request.method,
                    body_hash=body_hash,
                    response_status=response.status_code,
                    response_body=response_body,
                )
        except IntegrityError:
            # Concurrent request with the same (user, key) already stored a
            # record — fine, the response is idempotent by construction.
            logger.debug("IdempotencyRecord race for user=%s key=%s", user.pk, key)

    @staticmethod
    def _parse_response_body(response):
        content = getattr(response, "content", b"")
        if not content:
            return None
        try:
            return json.loads(content.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None
