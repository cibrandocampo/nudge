"""Regulatory catalogue: the official data of the medicines Nudge's stocks hold.

The model is agency-neutral on purpose: no table or column names CIMA, every
row carries the ``source`` it came from, and an agency's own codes sit beside
the normalised values the rest of the app relies on. Only
``clients/aemps.py`` knows CIMA; these tables just store what a client returns.

Two rules shape what is stored:

* **Columns for what the code uses, ``raw`` for the rest.** A column exists
  only when something queries, diffs or shows it. Everything else the agency
  returns stays in ``raw``, so a later iteration that wants the holder or the
  driving warning reads it from there instead of fetching again.
* **Only what Nudge uses.** The catalogue holds the presentations some stock is
  linked to, and their medicines — never a mirror of the agency. The daily
  sync deletes what no stock references any more.
"""

from django.db import models
from django.db.models import Q


class Severity(models.TextChoices):
    """Normalised severity of a supply problem, whatever the agency's codes."""

    WARNING = "warning", "Warning"
    DANGER = "danger", "Danger"


class Medicine(models.Model):
    """An authorised medicine. Several presentations (packs) share one."""

    class Status(models.TextChoices):
        AUTHORISED = "authorised", "Authorised"
        SUSPENDED = "suspended", "Suspended"
        REVOKED = "revoked", "Revoked"

    source = models.CharField(max_length=16)
    code = models.CharField(max_length=32, help_text="The agency's authorisation number.")
    name = models.CharField(max_length=500)
    authorized_on = models.DateField(null=True, blank=True)
    suspended_on = models.DateField(null=True, blank=True)
    revoked_on = models.DateField(null=True, blank=True)
    agency_url = models.URLField(max_length=500, blank=True)
    raw = models.JSONField(default=dict, blank=True)
    fetched_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["source", "code"], name="unique_medicine_per_source"),
        ]

    def __str__(self):
        return f"{self.name} ({self.source}:{self.code})"

    @property
    def status(self):
        """Current authorisation status.

        Agencies expose the current state, not a history: a lifted suspension
        clears ``suspended_on`` (verified on CIMA, T109). So the dates alone
        decide, revocation first.
        """
        if self.revoked_on is not None:
            return self.Status.REVOKED
        if self.suspended_on is not None:
            return self.Status.SUSPENDED
        return self.Status.AUTHORISED


class Presentation(models.Model):
    """A concrete pack — the unit a stock is linked to.

    ``fetched_at`` doubles as the baseline marker: while it is null the
    presentation has never been fetched, and its first fetch is a baseline,
    not a change (change detection relies on it).
    """

    class FetchStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        OK = "ok", "OK"
        NOT_FOUND = "not_found", "Not found"
        ERROR = "error", "Error"

    source = models.CharField(max_length=16)
    code = models.CharField(max_length=32, help_text="The agency's pack code (CIMA: the national code).")
    medicine = models.ForeignKey(
        Medicine,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="presentations",
        help_text="Unknown until the first successful fetch.",
    )
    name = models.CharField(max_length=500, blank=True)
    marketed = models.BooleanField(null=True, blank=True)
    # Severity of the active supply problem, copied here so the stock list can
    # show it through a join instead of one query per row.
    supply_severity = models.CharField(max_length=16, choices=Severity.choices, null=True, blank=True)
    fetch_status = models.CharField(max_length=16, choices=FetchStatus.choices, default=FetchStatus.PENDING)
    last_error = models.TextField(blank=True)
    fetched_at = models.DateTimeField(null=True, blank=True, help_text="Last successful fetch; null = no baseline.")
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    raw = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["source", "code"], name="unique_presentation_per_source"),
        ]

    def __str__(self):
        return f"{self.name or self.code} ({self.source}:{self.code})"


class SupplyProblem(models.Model):
    """A supply problem of a presentation, current or past.

    Agencies give problems no identity: "the same problem" is the active one.
    A change of type or expected end updates that row; the end is not reported
    either, so ``resolved_at`` is when Nudge stopped seeing it.
    """

    presentation = models.ForeignKey(Presentation, on_delete=models.CASCADE, related_name="supply_problems")
    native_type = models.CharField(max_length=16, help_text="The agency's own problem code, verbatim.")
    severity = models.CharField(max_length=16, choices=Severity.choices)
    note = models.TextField(blank=True)
    started_on = models.DateField(null=True, blank=True)
    expected_end_on = models.DateField(null=True, blank=True)
    first_seen_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True, help_text="Null while the problem is active.")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["presentation"],
                condition=Q(resolved_at__isnull=True),
                name="one_active_supply_problem",
            ),
        ]

    def __str__(self):
        state = "active" if self.resolved_at is None else "resolved"
        return f"{self.presentation} — {self.native_type} ({state})"


class SafetyNotice(models.Model):
    """A safety notice an agency published; one notice may cover several medicines."""

    source = models.CharField(max_length=16)
    reference = models.CharField(max_length=200)
    native_kind = models.CharField(max_length=16, blank=True)
    title = models.TextField(blank=True)
    url = models.URLField(max_length=500, blank=True)
    published_on = models.DateField(null=True, blank=True)
    medicines = models.ManyToManyField(Medicine, related_name="safety_notices", blank=True)
    first_seen_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["source", "reference"], name="unique_safety_notice_per_source"),
        ]

    def __str__(self):
        return f"{self.reference} ({self.source})"
