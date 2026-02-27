import django.core.validators
import django.db.models.deletion
import django.db.models.expressions
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Stock",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="stocks",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["name"],
            },
        ),
        migrations.CreateModel(
            name="StockLot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "quantity",
                    models.IntegerField(
                        default=0,
                        validators=[django.core.validators.MinValueValidator(0)],
                    ),
                ),
                ("expiry_date", models.DateField(blank=True, null=True)),
                ("lot_number", models.CharField(blank=True, max_length=100)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "stock",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="lots",
                        to="routines.stock",
                    ),
                ),
            ],
            options={
                "ordering": [
                    django.db.models.expressions.OrderBy(
                        django.db.models.expressions.F("expiry_date"),
                        nulls_last=True,
                    ),
                    "created_at",
                ],
                "constraints": [
                    models.CheckConstraint(condition=models.Q(quantity__gte=0), name="stocklot_qty_gte_0"),
                ],
            },
        ),
        migrations.CreateModel(
            name="Routine",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200)),
                ("description", models.CharField(max_length=1000, blank=True)),
                (
                    "interval_hours",
                    models.PositiveIntegerField(
                        help_text="Number of hours between entries (minimum 1)",
                        validators=[django.core.validators.MinValueValidator(1)],
                    ),
                ),
                (
                    "stock_usage",
                    models.PositiveIntegerField(default=1, help_text="Units deducted from stock per entry"),
                ),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="routines",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "stock",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="routines",
                        to="routines.stock",
                        help_text="Optional stock item consumed on each entry",
                    ),
                ),
            ],
            options={
                "ordering": ["name"],
            },
        ),
        migrations.CreateModel(
            name="RoutineEntry",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("notes", models.CharField(max_length=1000, blank=True)),
                (
                    "routine",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="entries",
                        to="routines.routine",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
                "verbose_name_plural": "routine entries",
            },
        ),
    ]
