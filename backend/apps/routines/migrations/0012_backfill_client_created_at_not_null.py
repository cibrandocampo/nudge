# Generated for docs/plans/client-time-as-source-of-truth.md
#
# Promotes `client_created_at` from a nullable opt-in field to the
# functional source of truth for both `RoutineEntry` and `StockConsumption`.
# Backfills NULL rows with their `created_at` (the only inference we can
# safely make for legacy / admin / pre-T021 rows), then alters the column
# to `NOT NULL DEFAULT now()` so future writes that don't send the field
# (admin, direct-API, scripts) still get a sane value.

from django.db import migrations, models
from django.db.models import F
from django.utils import timezone


def backfill(apps, schema_editor):
    RoutineEntry = apps.get_model("routines", "RoutineEntry")
    StockConsumption = apps.get_model("routines", "StockConsumption")
    RoutineEntry.objects.filter(client_created_at__isnull=True).update(client_created_at=F("created_at"))
    StockConsumption.objects.filter(client_created_at__isnull=True).update(client_created_at=F("created_at"))


class Migration(migrations.Migration):
    dependencies = [
        ("routines", "0011_add_userstockgroup"),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="routineentry",
            name="client_created_at",
            field=models.DateTimeField(default=timezone.now),
        ),
        migrations.AlterField(
            model_name="stockconsumption",
            name="client_created_at",
            field=models.DateTimeField(default=timezone.now),
        ),
    ]
