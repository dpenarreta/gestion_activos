"""Un equipo puede tener varios responsables, si está marcado como compartido.

`custodio` era **un** empleado, y con eso no se podía describir lo que la
operación tiene de verdad: un escáner de andén o una impresora de mostrador de
los que responde el turno entero, sin que ninguno responda más que otro.

El campo se convierte en una relación de muchos a muchos y desaparece como
columna. No se conserva al lado «por compatibilidad»: dos sitios donde vive la
misma respuesta es la forma segura de que un día digan cosas distintas, y la
pregunta de RF-01 —quién responde por este equipo— tiene que tener una sola
fuente.

El traspaso es directo: cada equipo con custodio pasa a tener a esa persona
como su único responsable, que es exactamente lo que significaba. Ninguno queda
marcado como compartido; la marca es una decisión que se toma equipo por
equipo, y darla por supuesta al migrar repartiría responsabilidades que nadie
repartió.

La vuelta atrás también funciona, y se queda con el primero por apellido cuando
hay varios: es lo único que cabe en una columna. Que pierda información es
inevitable —es la información que esta migración existe para poder guardar—, y
el historial de movimientos, que no se toca, conserva a los demás.
"""

from django.db import migrations, models


def custodio_a_responsable(apps, schema_editor):
    Activo = apps.get_model("activos", "Activo")
    Relacion = Activo.responsables.through

    Relacion.objects.bulk_create(
        [
            Relacion(activo_id=activo_id, empleado_id=custodio_id)
            for activo_id, custodio_id in Activo.objects.filter(custodio__isnull=False).values_list(
                "id", "custodio_id"
            )
        ],
        batch_size=500,
    )


def responsable_a_custodio(apps, schema_editor):
    Activo = apps.get_model("activos", "Activo")
    Empleado = apps.get_model("organizacion", "Empleado")
    Relacion = Activo.responsables.through

    # Por apellido y nombre, el mismo criterio con el que la ficha los ordena:
    # así la vuelta atrás es predecible y no depende de qué fila leyó antes la
    # base de datos.
    orden = {
        empleado.id: (empleado.apellidos, empleado.nombres) for empleado in Empleado.objects.all()
    }
    elegido: dict[int, int] = {}
    for activo_id, empleado_id in Relacion.objects.values_list("activo_id", "empleado_id"):
        actual = elegido.get(activo_id)
        if actual is None or orden.get(empleado_id, ()) < orden.get(actual, ()):
            elegido[activo_id] = empleado_id

    for activo_id, empleado_id in elegido.items():
        Activo.objects.filter(id=activo_id).update(custodio_id=empleado_id)


class Migration(migrations.Migration):
    dependencies = [
        ("activos", "0016_activo_concesionario_activo_propiedad"),
        ("organizacion", "0008_concesionario"),
    ]

    operations = [
        migrations.AddField(
            model_name="activo",
            name="compartido",
            field=models.BooleanField(
                db_index=True,
                default=False,
                help_text=(
                    "Varias personas responden por él, en igualdad. Ej.: un escáner de andén."
                ),
            ),
        ),
        # Con un `related_name` provisional: el definitivo lo tiene todavía la
        # columna `custodio`, y dos relaciones no pueden llamarse igual desde
        # el empleado mientras las dos existan.
        migrations.AddField(
            model_name="activo",
            name="responsables",
            field=models.ManyToManyField(
                blank=True,
                help_text="Vacío mientras el equipo está en bodega, sin responsable.",
                related_name="activos_a_cargo",
                to="organizacion.empleado",
            ),
        ),
        migrations.RunPython(custodio_a_responsable, responsable_a_custodio),
        migrations.RemoveField(model_name="activo", name="custodio"),
        migrations.AlterField(
            model_name="activo",
            name="responsables",
            field=models.ManyToManyField(
                blank=True,
                help_text="Vacío mientras el equipo está en bodega, sin responsable.",
                related_name="activos_asignados",
                to="organizacion.empleado",
            ),
        ),
    ]
