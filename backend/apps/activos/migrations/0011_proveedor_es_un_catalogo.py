"""El proveedor del activo pasa de texto libre a una referencia al catálogo.

Como texto, «Tecnomega», «TECNOMEGA» y «Tecno Mega» son la misma empresa para
una persona y tres para una consulta: preguntar cuánto se le lleva comprado a
un proveedor devolvía un tercio de lo que hay sin que nadie notara lo que
faltaba.

Se hace en cuatro pasos —renombrar, crear la columna nueva, copiar, borrar la
vieja— en lugar de dejar que Django altere el tipo de la columna: un `ALTER` de
`varchar` a `int` sobre datos existentes falla en SQL Server. Es el mismo
camino que siguió la ubicación en la migración 0008.
"""

import django.db.models.deletion
from django.db import migrations, models


def texto_a_catalogo(apps, schema_editor):
    """Cada nombre distinto se convierte en una ficha de proveedor."""
    Activo = apps.get_model("activos", "Activo")
    Proveedor = apps.get_model("organizacion", "Proveedor")

    for activo in Activo.objects.exclude(proveedor_texto="").exclude(proveedor_texto=None):
        nombre = (activo.proveedor_texto or "").strip()[:150]
        if not nombre:
            continue
        proveedor, _ = Proveedor.objects.get_or_create(nombre=nombre)
        Activo.objects.filter(pk=activo.pk).update(proveedor_id=proveedor.pk)


def catalogo_a_texto(apps, schema_editor):
    Activo = apps.get_model("activos", "Activo")
    for activo in Activo.objects.select_related("proveedor").exclude(proveedor=None):
        Activo.objects.filter(pk=activo.pk).update(proveedor_texto=activo.proveedor.nombre)


class Migration(migrations.Migration):
    dependencies = [
        ("activos", "0010_sede_reemplaza_a_ubicacion"),
        ("organizacion", "0006_proveedores"),
    ]

    operations = [
        migrations.RenameField(
            model_name="activo",
            old_name="proveedor",
            new_name="proveedor_texto",
        ),
        migrations.AddField(
            model_name="activo",
            name="proveedor",
            field=models.ForeignKey(
                blank=True,
                help_text="A quién se le compró. Se elige del catálogo de proveedores.",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="activos",
                to="organizacion.proveedor",
            ),
        ),
        migrations.RunPython(texto_a_catalogo, catalogo_a_texto),
        migrations.RemoveField(model_name="activo", name="proveedor_texto"),
    ]
