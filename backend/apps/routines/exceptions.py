"""Domain errors for the routines app.

Framework-free on purpose: the models raise these, so a management command
or a Celery task can call into the domain without dragging in DRF. The HTTP
translation lives in `apps.core.exception_handler`.
"""


class DomainError(Exception):
    """Base for routines-domain errors."""


class InsufficientStock(DomainError):
    """A consumption asked for more units than the stock holds."""

    def __init__(self, requested: int, available: int):
        self.requested = requested
        self.available = available
        super().__init__(f"Insufficient stock: requested {requested}, available {available}.")


class InvalidLotSelection(DomainError):
    """Explicit lot selections that cannot be applied to this stock."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)
