"""Ficha completa del activo: §4.1 (estados, fecha de ingreso, ubicación
física) y §12 (criticidad y uso).

La parte delicada es `ubicacion`, que pasa de texto libre a una referencia al
catálogo nuevo. Se hace en cuatro pasos —renombrar, crear la columna nueva,
copiar, borrar la vieja— en lugar de dejar que Django altere el tipo de la
columna: un `ALTER` de `varchar` a `int` sobre datos existentes falla en SQL
Server, y si no fallara convertiría cada ubicación escrita a mano en un valor
nulo sin decir nada. Aquí cada texto distinto se convierte en una ubicación
del catálogo, que después se puede corregir desde la pantalla.
"""

from django.db import migrations, models
import django.db.models.deletion

#: Sede con la que entran las ubicaciones heredadas. Es visible a propósito:
#: el texto libre anterior no decía en qué edificio estaba «Bodega», y
#: inventarle una sede sería peor que dejar la pregunta a la vista.
SEDE_HEREDADA = "Sin especificar"


def texto_a_catalogo(apps, schema_editor):
    """Convierte cada ubicación escrita a mano en una fila del catálogo."""
    Activo = apps.get_model("activos", "Activo")
    Ubicacion = apps.get_model("organizacion", "Ubicacion")

    textos = (
        Activo.objects.exclude(ubicacion_texto="")
        .exclude(ubicacion_texto=None)
        .values_list("ubicacion_texto", flat=True)
        .distinct()
    )
    for texto in textos:
        nombre = texto.strip()[:120]
        if not nombre:
            continue
        ubicacion, _ = Ubicacion.objects.get_or_create(
            sede=SEDE_HEREDADA,
            nombre=nombre,
            defaults={"detalle": "Migrada del texto libre anterior.", "activa": True},
        )
        Activo.objects.filter(ubicacion_texto=texto).update(ubicacion=ubicacion)


def catalogo_a_texto(apps, schema_editor):
    """Vuelta atrás: devuelve el nombre de la ubicación al campo de texto."""
    Activo = apps.get_model("activos", "Activo")
    for activo in Activo.objects.exclude(ubicacion=None).select_related("ubicacion"):
        Activo.objects.filter(pk=activo.pk).update(ubicacion_texto=activo.ubicacion.nombre[:150])


class Migration(migrations.Migration):
    dependencies = [
        ("activos", "0007_activo_nivel_renovacion"),
        ("organizacion", "0003_ubicacion"),
    ]

    operations = [
        migrations.AddField(
            model_name="activo",
            name="criticidad",
            field=models.CharField(
                choices=[
                    ("baja", "Baja"),
                    ("media", "Media"),
                    ("alta", "Alta"),
                    ("critica", "Crítica"),
                ],
                db_index=True,
                default="media",
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="activo",
            name="uso",
            field=models.CharField(
                choices=[
                    ("administrativo", "Administrativo"),
                    ("operativo", "Operativo"),
                    ("desarrollo", "Desarrollo"),
                    ("diseno", "Diseño"),
                    ("gerencial", "Gerencial"),
                    ("atencion_cliente", "Atención al cliente"),
                    ("bodega", "Bodega"),
                    ("infraestructura", "Infraestructura"),
                ],
                db_index=True,
                default="administrativo",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="activo",
            name="fecha_ingreso",
            field=models.DateField(
                blank=True,
                help_text=(
                    "Fecha en que el equipo entró al inventario. Se separa de la de "
                    "adquisición porque un equipo comprado en diciembre puede entrar en "
                    "marzo, y la garantía corre desde una y la custodia desde la otra."
                ),
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name="activo",
            name="estado",
            field=models.CharField(
                choices=[
                    ("disponible", "Disponible"),
                    ("en_uso", "Asignado"),
                    ("en_bodega", "En bodega"),
                    ("en_mantenimiento", "En reparación"),
                    ("en_garantia", "En reclamación de garantía"),
                    ("en_transito", "En tránsito"),
                    ("dado_de_baja", "Dado de baja"),
                    ("perdido", "Perdido"),
                    ("robado", "Robado"),
                ],
                default="en_bodega",
                max_length=20,
            ),
        ),
        # --- Ubicación: de texto libre a catálogo, sin perder lo cargado ---
        migrations.RenameField(
            model_name="activo",
            old_name="ubicacion",
            new_name="ubicacion_texto",
        ),
        migrations.AddField(
            model_name="activo",
            name="ubicacion",
            field=models.ForeignKey(
                blank=True,
                help_text="Dónde está físicamente el equipo. Vacío mientras no se ha inventariado.",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="activos",
                to="organizacion.ubicacion",
            ),
        ),
        migrations.RunPython(texto_a_catalogo, catalogo_a_texto),
        migrations.RemoveField(model_name="activo", name="ubicacion_texto"),
        migrations.AddIndex(
            model_name="activo",
            index=models.Index(fields=["ubicacion"], name="activos_act_ubicaci_1084d3_idx"),
        ),
        migrations.AddIndex(
            model_name="activo",
            index=models.Index(fields=["fecha_adquisicion"], name="activos_act_fecha_a_1ad062_idx"),
        ),
    ]
