"""DRF exception handler: DRF's own handling, plus the routines domain errors.

The domain raises framework-free exceptions (`apps.routines.exceptions`);
this is the single place that decides what each one looks like over HTTP.
"""

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler
from rest_framework.views import set_rollback

from apps.routines.exceptions import InsufficientStock, InvalidLotSelection, LotUnavailable


def exception_handler(exc, context):
    if isinstance(exc, InsufficientStock):
        # Same body as the pre-check in `RoutineViewSet.log`, so the frontend
        # reads both the same way.
        body = {
            "detail": "Insufficient stock.",
            "code": "insufficient_stock",
            "required": exc.requested,
            "available": exc.available,
        }
        response_status = status.HTTP_422_UNPROCESSABLE_ENTITY
    elif isinstance(exc, InvalidLotSelection):
        # DRF's standard field-error shape: a list of messages per field, as a
        # serializer reports it. (The DRF ValidationError the model raised
        # before T056 rendered a bare string here; no client read it.)
        body = {"lot_selections": [exc.reason]}
        response_status = status.HTTP_400_BAD_REQUEST
    elif isinstance(exc, LotUnavailable):
        # 422 like insufficient stock: the request was well formed, the stock
        # changed under it. Not 409: the offline queue is to retry those (T064).
        body = {
            "detail": "Lot no longer available.",
            "code": "lot_unavailable",
            "lot_ids": exc.lot_ids,
        }
        response_status = status.HTTP_422_UNPROCESSABLE_ENTITY
    else:
        return drf_exception_handler(exc, context)

    # Like DRF does for its own errors: an atomic request must not commit
    # the work done before the failure.
    set_rollback()
    return Response(body, status=response_status)
