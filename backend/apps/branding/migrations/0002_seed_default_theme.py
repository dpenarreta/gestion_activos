from django.db import migrations

from apps.branding.catalog import DEFAULT_THEME


def seed_default_theme(apps, schema_editor):
    SiteTheme = apps.get_model("branding", "SiteTheme")
    if not SiteTheme.objects.exists():
        SiteTheme.objects.create(**DEFAULT_THEME)


def noop_reverse(apps, schema_editor):
    # Intencionalmente no borra la fila al revertir: es configuración, no
    # un dato transaccional — revertir el esquema no debería destruir la
    # identidad institucional configurada.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("branding", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_default_theme, noop_reverse),
    ]
