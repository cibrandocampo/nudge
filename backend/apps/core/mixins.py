from datetime import timezone as _dt_timezone
from email.utils import parsedate_to_datetime

from rest_flex_fields import WILDCARD_ALL
from rest_flex_fields.serializers import FlexFieldsSerializerMixin
from rest_framework import serializers, status
from rest_framework.response import Response

HEADER_NAME = "If-Unmodified-Since"

# Sentinel passed to FlexFieldsModelSerializer's `omit` kwarg to neutralise
# any ``?omit=...`` query string. The value never matches a real field, so
# ``apply_flex_fields`` removes nothing; the kwarg is non-empty, so the
# request-driven `_rep_only["omit"]` is short-circuited to []. Pairs with
# ``fields=[WILDCARD_ALL]`` to neutralise ``?fields=`` the same way.
_FLEX_OMIT_NEUTRAL = "__optimistic_lock_no_omit__"


def parse_http_date(value):
    """Parse an HTTP-date header, returning a timezone-aware datetime or None."""
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if dt is None:
        return None
    # email.utils usually returns aware datetimes for HTTP-dates (they include
    # a timezone). If we get a naive one, assume UTC so the comparison below
    # doesn't raise TypeError.
    # pragma note: parsedate_to_datetime (stdlib) returns aware datetimes
    # for every HTTP-date shape the tests throw at it. Reaching the naive
    # branch would require monkey-patching stdlib, and the test would not
    # validate anything real — mark the branch uncovered on purpose.
    if dt.tzinfo is None:  # pragma: no cover
        dt = dt.replace(tzinfo=_dt_timezone.utc)
    return dt


class OptimisticLockingMixin:
    """
    DRF ViewSet mixin that enforces If-Unmodified-Since on PATCH/PUT/DELETE.

    The target model must expose a field whose name matches
    ``optimistic_lock_field`` (defaults to ``updated_at``). HTTP-date is the
    expected format on the wire — resolution is 1 second, so the comparison
    truncates microseconds on both sides.

    On mismatch the mixin returns 412 Precondition Failed with
    ``{"error": "conflict", "current": <serialized resource>}`` so the client
    has the latest state to surface in a conflict modal.

    **Interaction with drf-flex-fields**: when the serializer is a
    ``FlexFieldsSerializerMixin`` subclass, this mixin **neutralises** any
    ``?fields=`` / ``?omit=`` query string for the conflict payload. A 412
    must hand the client the full resource so it can render every field of
    the diff in the conflict modal — partial responses would force the
    client to issue a follow-up GET to reconstruct what changed. Sparse
    filtering still applies to 2xx responses.
    """

    optimistic_lock_field = "updated_at"

    def _optimistic_lock_conflict_response(self, instance):
        serializer_class = self.get_serializer_class()
        kwargs = {"context": self.get_serializer_context()}
        if isinstance(serializer_class, type) and issubclass(serializer_class, FlexFieldsSerializerMixin):
            kwargs["fields"] = [WILDCARD_ALL]
            kwargs["omit"] = [_FLEX_OMIT_NEUTRAL]
        serializer = serializer_class(instance, **kwargs)
        return Response(
            {"error": "conflict", "current": serializer.data},
            status=status.HTTP_412_PRECONDITION_FAILED,
        )

    def _check_precondition(self, request, instance):
        header = request.headers.get(HEADER_NAME)
        if not header:
            return None
        since = parse_http_date(header)
        if since is None:
            return Response(
                {"error": "Invalid If-Unmodified-Since header"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        server_value = getattr(instance, self.optimistic_lock_field, None)
        if server_value is None:
            return None
        if server_value.replace(microsecond=0) > since.replace(microsecond=0):
            return self._optimistic_lock_conflict_response(instance)
        return None

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        precondition = self._check_precondition(request, instance)
        if precondition is not None:
            return precondition
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        precondition = self._check_precondition(request, instance)
        if precondition is not None:
            return precondition
        return super().destroy(request, *args, **kwargs)


class SharedWithMixin:
    """For DRF serializers whose model has `user` (owner) and
    `shared_with` (M2M to User) fields. Provides:

      - ``validate_shared_with(value)``: ensures every target user is in
        ``request.user.contacts``. Raises ValidationError otherwise.
      - ``get_shared_with_details(obj)``: serializes the M2M as a list
        of ``{id, username, first_name, last_name}`` dicts.

    Both ``Stock`` and ``Routine`` use this; consolidates ~30 LoC.
    """

    def validate_shared_with(self, value):
        request = self.context.get("request")
        if not request:
            return value
        contact_ids = set(request.user.contacts.values_list("pk", flat=True))
        for user in value:
            if user.pk not in contact_ids:
                raise serializers.ValidationError(f"User {user.pk} is not in your contacts.")
        return value

    def get_shared_with_details(self, obj):
        return [
            {
                "id": u.pk,
                "username": u.username,
                "first_name": u.first_name,
                "last_name": u.last_name,
            }
            for u in obj.shared_with.all()
        ]
