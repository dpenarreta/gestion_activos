"""La sede pasa a ser un catálogo y la ubicación declara qué tipo de sitio es.

Las dos cosas iban embebidas en la fila de `Ubicacion`: la sede como texto
libre y el «es una bodega» como una convención de nombre. Ninguna de las dos
sobrevive al primer inventario repartido en varias sedes —«Sede Quito Norte»
escrita de tres formas son tres sedes, y una bodega llamada «Almacén» no era
una bodega para el sistema—, así que ambas se convierten en datos.

La migración de contenido es directa: cada texto de sede distinto se convierte
en una fila del catálogo, y el tipo se deduce del nombre **una sola vez**, que
es exactamente lo que se deja de hacer en adelante.
"""

import django.db.models.deletion
from django.db import migrations, models


def texto_a_catalogo(apps, schema_editor):
    """Crea una sede por cada texto distinto y reapunta las ubicaciones."""
    Sede = apps.get_model("organizacion", "Sede")
    Ubicacion = apps.get_model("organizacion", "Ubicacion")

    for ubicacion in Ubicacion.objects.all():
        # Un nombre vacío dejaría una sede sin nombre en el desplegable, que es
        # peor que decir que no se sabe.
        nombre = (ubicacion.sede or "").strip() or "Sin especificar"
        sede, _ = Sede.objects.get_or_create(nombre=nombre)
        ubicacion.sede_ref = sede
        ubicacion.save(update_fields=["sede_ref"])


def catalogo_a_texto(apps, schema_editor):
    Ubicacion = apps.get_model("organizacion", "Ubicacion")
    for ubicacion in Ubicacion.objects.select_related("sede_ref"):
        ubicacion.sede = ubicacion.sede_ref.nombre if ubicacion.sede_ref_id else ""
        ubicacion.save(update_fields=["sede"])


def deducir_el_tipo(apps, schema_editor):
    """Última vez que el tipo se adivina por el nombre.

    A partir de aquí es un campo que se elige, así que una bodega llamada
    «Almacén» se corrige desde la pantalla en vez de renombrarla para que el
    sistema la entienda.
    """
    Ubicacion = apps.get_model("organizacion", "Ubicacion")
    for ubicacion in Ubicacion.objects.all():
        nombre = (ubicacion.nombre or "").strip().lower()
        if nombre.startswith(("bodega", "almacén", "almacen")):
            tipo = "bodega"
        elif nombre.startswith(("oficina", "of.")):
            tipo = "oficina"
        elif nombre.startswith(("taller", "laboratorio")):
            tipo = "taller"
        else:
            tipo = "otro"
        Ubicacion.objects.filter(pk=ubicacion.pk).update(tipo=tipo)


class Migration(migrations.Migration):
    dependencies = [("organizacion", "0003_ubicacion")]

    operations = [
        # La restricción vieja apunta a la columna de texto: hay que soltarla
        # antes de quitarla, y se vuelve a poner al final sobre la nueva.
        migrations.RemoveConstraint(
            model_name="ubicacion",
            name="ubicacion_unica_por_sede",
        ),
        migrations.CreateModel(
            name="Sede",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "nombre",
                    models.CharField(
                        help_text="Cómo se la nombra internamente. Ej.: «Sede Quito Norte».",
                        max_length=120,
                        unique=True,
                    ),
                ),
                ("ciudad", models.CharField(blank=True, max_length=120)),
                ("direccion", models.CharField(blank=True, max_length=200)),
                ("activa", models.BooleanField(default=True)),
            ],
            options={
                "verbose_name": "sede",
                "verbose_name_plural": "sedes",
                "ordering": ["nombre"],
                "abstract": False,
            },
        ),
        migrations.AddField(
            model_name="ubicacion",
            name="sede_ref",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="ubicaciones",
                to="organizacion.sede",
            ),
        ),
        migrations.RunPython(texto_a_catalogo, catalogo_a_texto),
        migrations.RemoveField(model_name="ubicacion", name="sede"),
        migrations.RenameField(
            model_name="ubicacion",
            old_name="sede_ref",
            new_name="sede",
        ),
        migrations.AlterField(
            model_name="ubicacion",
            name="sede",
            field=models.ForeignKey(
                help_text="Edificio, local o ciudad. Se elige del catálogo de sedes.",
                on_delete=django.db.models.deletion.PROTECT,
                related_name="ubicaciones",
                to="organizacion.sede",
            ),
        ),
        migrations.AddField(
            model_name="ubicacion",
            name="tipo",
            field=models.CharField(
                choices=[
                    ("bodega", "Bodega"),
                    ("oficina", "Oficina"),
                    ("area", "Área operativa"),
                    ("taller", "Taller o laboratorio"),
                    ("otro", "Otro"),
                ],
                default="bodega",
                help_text="En una bodega el equipo está guardado; en un área, en uso.",
                max_length=20,
            ),
        ),
        migrations.RunPython(deducir_el_tipo, migrations.RunPython.noop),
        migrations.AlterModelOptions(
            name="ubicacion",
            options={
                "ordering": ["sede__nombre", "nombre"],
                "verbose_name": "ubicación",
                "verbose_name_plural": "ubicaciones",
            },
        ),
        migrations.AddConstraint(
            model_name="ubicacion",
            constraint=models.UniqueConstraint(
                fields=("sede", "nombre"), name="ubicacion_unica_por_sede"
            ),
        ),
    ]
