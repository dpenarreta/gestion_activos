"""El equipo se ubica por sede; el nivel intermedio de bodega desaparece.

Había dos niveles —sede y, dentro, la bodega u oficina— y en la práctica la
pregunta que se hace de un equipo es «¿dónde está?», que se responde con la
ciudad. Mantener el segundo nivel obligaba a elegir dos veces en cada traslado
y a inventar una bodega para cada sitio donde hubiera un equipo, con lo que el
catálogo se llenaba de entradas como «Piso 1» que no dicen nada.

**Qué se conserva.** Las ubicaciones siguen en la base y los movimientos ya
registrados conservan su origen y destino exactos: `ubicacion_anterior` y
`ubicacion_nueva` quedan como historia congelada, y las nuevas columnas de sede
se rellenan a partir de ellas para que el historial se lea igual de completo
después del cambio.

**Qué se pierde.** El puntero de cada activo a su bodega concreta: pasa a
apuntar a la sede de esa bodega. Es la simplificación pedida, y por eso la
vuelta atrás de esta migración no puede reconstruirlo —una sede tiene varias
bodegas y no hay forma de saber en cuál estaba—; el dato sí sobrevive en el
último traslado del historial del equipo.
"""

import django.db.models.deletion
from django.db import migrations, models


def ubicacion_a_sede(apps, schema_editor):
    Activo = apps.get_model("activos", "Activo")
    Movimiento = apps.get_model("activos", "MovimientoActivo")

    for activo in Activo.objects.select_related("ubicacion").exclude(ubicacion=None):
        Activo.objects.filter(pk=activo.pk).update(sede_id=activo.ubicacion.sede_id)

    for movimiento in Movimiento.objects.select_related(
        "ubicacion_anterior", "ubicacion_nueva"
    ).exclude(ubicacion_anterior=None, ubicacion_nueva=None):
        Movimiento.objects.filter(pk=movimiento.pk).update(
            sede_anterior_id=(
                movimiento.ubicacion_anterior.sede_id
                if movimiento.ubicacion_anterior_id
                else None
            ),
            sede_nueva_id=(
                movimiento.ubicacion_nueva.sede_id if movimiento.ubicacion_nueva_id else None
            ),
        )


def columna_de_plantilla(apps, schema_editor):
    """La columna «Ubicación» de la plantilla de carga pasa a ser «Sede».

    Se reaprovecha la fila en vez de borrarla y crear otra: conserva su orden,
    si estaba activa y si era obligatoria, que es configuración que alguien
    puso a mano.
    """
    Columna = apps.get_model("activos", "ColumnaPlantillaActivos")
    Columna.objects.filter(clave="ubicacion").update(
        clave="sede",
        etiqueta="Sede",
        ayuda="Nombre de la sede tal como aparece en la hoja «Sedes».",
    )


class Migration(migrations.Migration):
    dependencies = [
        ("activos", "0009_movimiento_registra_ubicacion"),
        ("organizacion", "0005_sede_reemplaza_a_ubicacion"),
    ]

    operations = [
        migrations.AddField(
            model_name="activo",
            name="sede",
            field=models.ForeignKey(
                blank=True,
                help_text="Dónde está el equipo. Vacío mientras no se ha inventariado.",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="activos",
                to="organizacion.sede",
            ),
        ),
        migrations.AddField(
            model_name="movimientoactivo",
            name="sede_anterior",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="movimientos_como_origen",
                to="organizacion.sede",
            ),
        ),
        migrations.AddField(
            model_name="movimientoactivo",
            name="sede_nueva",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="movimientos_como_destino",
                to="organizacion.sede",
            ),
        ),
        # Se rellena antes de soltar la columna vieja: después ya no habría de
        # dónde leerlo.
        migrations.RunPython(ubicacion_a_sede, migrations.RunPython.noop),
        migrations.RunPython(columna_de_plantilla, migrations.RunPython.noop),
        migrations.RemoveIndex(
            model_name="activo",
            name="activos_act_ubicaci_1084d3_idx",
        ),
        migrations.RemoveField(
            model_name="activo",
            name="ubicacion",
        ),
        migrations.AddIndex(
            model_name="activo",
            index=models.Index(fields=["sede"], name="activos_act_sede_id_7ad844_idx"),
        ),
    ]
