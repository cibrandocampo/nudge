import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def _flush_deferred_constraints(schema_editor):
    """PostgreSQL refuses to ALTER a table with pending FK trigger events."""
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute("SET CONSTRAINTS ALL IMMEDIATE")


def to_assignments(apps, schema_editor):
    """Make `UserStockGroup` the single record of who filed what where.

    Each owner's `Stock.group` becomes a row. Rows without a group go. A
    recipient with no row gets none: the owner's category is not theirs.
    """
    Stock = apps.get_model("routines", "Stock")
    UserStockGroup = apps.get_model("routines", "UserStockGroup")

    UserStockGroup.objects.filter(group__isnull=True).delete()
    existing = set(UserStockGroup.objects.values_list("user_id", "stock_id", "group_id"))
    owned = Stock.objects.filter(group__isnull=False, group__user_id=models.F("user_id")).values_list(
        "user_id", "id", "group_id"
    )
    UserStockGroup.objects.bulk_create(
        [
            UserStockGroup(user_id=user_id, stock_id=stock_id, group_id=group_id)
            for user_id, stock_id, group_id in owned
            if (user_id, stock_id, group_id) not in existing
        ],
        batch_size=500,
    )
    _flush_deferred_constraints(schema_editor)


def to_single_category(apps, schema_editor):
    """Back to one category per person: each keeps their first, by list order."""
    Stock = apps.get_model("routines", "Stock")
    UserStockGroup = apps.get_model("routines", "UserStockGroup")

    seen = set()
    rows = UserStockGroup.objects.select_related("stock").order_by(
        "user_id", "stock_id", "group__display_order", "group__name", "id"
    )
    for row in rows:
        key = (row.user_id, row.stock_id)
        first = key not in seen
        seen.add(key)
        if row.user_id == row.stock.user_id:
            if first and row.stock.group_id is None:
                Stock.objects.filter(pk=row.stock_id).update(group_id=row.group_id)
            row.delete()
        elif not first:
            row.delete()
    _flush_deferred_constraints(schema_editor)


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("routines", "0018_stock_name_offer_pending_stock_national_code_and_more"),
    ]

    operations = [
        migrations.AlterUniqueTogether(name="userstockgroup", unique_together=set()),
        migrations.RunPython(to_assignments, to_single_category),
        migrations.AlterField(
            model_name="userstockgroup",
            name="group",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="stock_overrides",
                to="routines.stockgroup",
            ),
        ),
        migrations.AddConstraint(
            model_name="userstockgroup",
            constraint=models.UniqueConstraint(
                fields=("user", "stock", "group"),
                name="unique_stock_group_assignment",
            ),
        ),
    ]
