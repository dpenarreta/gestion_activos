"""Sustituye la cédula del empleado por un código interno.

El sistema solo necesita un identificador único y estable para saber quién
custodia cada equipo. La cédula, además de no aportar nada a esa finalidad,
obligaba a protegerla en la bitácora de auditoría —que es append-only, así que
lo que entra ahí no se puede borrar después— y viajaba dentro de la plantilla
de carga masiva, un archivo que se descarga y circula por correo.

**Los valores actuales no se conservan.** La columna nueva se llena con
códigos correlativos y la vieja se elimina, así que las cédulas ya capturadas
desaparecen de la base. Es el efecto buscado, no un daño colateral: migrarlas
al campo nuevo dejaría el mismo dato personal con otro nombre.

Por eso la migración no es reversible en sentido estricto: revertirla devuelve
la columna, pero vacía. No hay forma de recuperar un dato que se eliminó a
propósito.
"""

from django.db import migrations, models


def poblar_codigos(apps, schema_editor):
    Empleado = apps.get_model("organizacion", "Empleado")
    for numero, empleado in enumerate(Empleado.objects.order_by("id"), start=1):
        empleado.codigo_empleado = f"EMP-{numero:04d}"
        empleado.save(update_fields=["codigo_empleado"])


def vaciar_codigos(apps, schema_editor):
    # Al revertir no se restauran las cédulas: se eliminaron a propósito.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("organizacion", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="empleado",
            name="codigo_empleado",
            field=models.CharField(
                default="",
                max_length=30,
                help_text=(
                    "Identificador interno del empleado (ej. EMP-0001). "
                    "Se genera solo si se deja vacío."
                ),
            ),
            preserve_default=False,
        ),
        migrations.RunPython(poblar_codigos, vaciar_codigos),
        migrations.AlterField(
            model_name="empleado",
            name="codigo_empleado",
            field=models.CharField(
                max_length=30,
                unique=True,
                help_text=(
                    "Identificador interno del empleado (ej. EMP-0001). "
                    "Se genera solo si se deja vacío."
                ),
            ),
        ),
        migrations.RemoveField(
            model_name="empleado",
            name="documento_identidad",
        ),
    ]
