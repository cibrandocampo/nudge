from django.db import migrations


def tidy_stored_leaflets(apps, schema_editor):
    """Apply the sanitiser's new layout rules (no spacer paragraphs, real lists)
    to the leaflets already stored.

    The daily sync would only redo them once they age out; this fixes them now.
    """
    from apps.regulatory.sanitize import tidy_leaflet_html

    MedicineLeaflet = apps.get_model("regulatory", "MedicineLeaflet")
    for leaflet in MedicineLeaflet.objects.only("pk", "sections"):
        sections = [{**section, "html": tidy_leaflet_html(section["html"])} for section in leaflet.sections or []]
        if sections != leaflet.sections:
            leaflet.sections = sections
            leaflet.save(update_fields=["sections"])


class Migration(migrations.Migration):
    dependencies = [
        ("regulatory", "0004_medicine_driving_and_leaflet_pdf"),
    ]

    operations = [
        migrations.RunPython(tidy_stored_leaflets, migrations.RunPython.noop),
    ]
