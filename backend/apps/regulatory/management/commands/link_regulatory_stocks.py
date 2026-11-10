"""Link existing stocks to the regulatory catalogue — run once after deploying.

Stocks created before regulatory data existed may already carry a Spanish
GTIN (an NTIN, with the CN inside). This gives them their national code, links
them and schedules their first fetch, exactly as saving the stock would now.

It writes with ``QuerySet.update()`` and never bumps ``Stock.updated_at``, so
edits queued offline on any device are not rejected afterwards. It never
notifies: the first fetch of a presentation is a baseline, not a change.
"""

from django.core.management.base import BaseCommand

from apps.regulatory import services
from apps.routines.models import Stock


class Command(BaseCommand):
    help = "Give stocks with a Spanish GTIN their national code and link them to the regulatory catalogue."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="List what would be linked, change nothing.")

    def handle(self, *args, dry_run=False, **options):
        linked = skipped = 0
        to_fetch = set()
        for stock in Stock.objects.exclude(gtin="").filter(national_code="").order_by("pk"):
            derived = services.derive_national_code(stock.gtin, "")
            if derived is None:
                # A manufacturer GTIN: its CN is only in the scan's AI 712, so
                # it links the next time a lot of it is scanned.
                skipped += 1
                continue
            code, source = derived
            if dry_run:
                self.stdout.write(f"Would link stock {stock.pk} ({stock.name}) to {source}:{code}")
                linked += 1
                continue
            Stock.objects.filter(pk=stock.pk).update(national_code=code, national_code_source=source)
            stock.national_code, stock.national_code_source = code, source
            # Enqueued once per presentation below: several stocks may share one.
            presentation = services.link_stock(stock, offer_name=True, touch_updated_at=False, enqueue=False)
            if presentation.fetched_at is None:
                to_fetch.add(presentation.pk)
            linked += 1
        for presentation_id in sorted(to_fetch):
            services.enqueue_fetch(presentation_id)

        verb = "Would link" if dry_run else "Linked"
        self.stdout.write(
            self.style.SUCCESS(
                f"{verb} {linked} stock(s); skipped {skipped} without a Spanish NTIN; "
                f"{len(to_fetch)} fetch(es) scheduled."
            )
        )
