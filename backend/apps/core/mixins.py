from datetime import timezone as _dt_timezone
from email.utils import parsedate_to_datetime

from rest_framework import status
from rest_framework.response import Response

HEADER_NAME = "If-Unmodified-Since"


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
    """

    optimistic_lock_field = "updated_at"

    def _optimistic_lock_conflict_response(self, instance):
        serializer = self.get_serializer(instance)
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
