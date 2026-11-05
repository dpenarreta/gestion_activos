"""La solicitud guarda su clasificación (auditoría UX/UI, 05/11/2026).

1. `unidad`, `descuento` y `tipo_ausencia` en `SolicitudPermiso`: desde ahora
   se copian del tipo al crear la solicitud, para que reclasificar un tipo no
   reinterprete las solicitudes ya hechas. Las existentes se rellenan con el
   valor actual de su tipo: es el único dato que hay, y como la clasificación
   se agregó hoy (`0004`), coincide con la que tenían al aprobarse.
2. «Vacaciones» como tipo de ausencia solo con descuento de vacaciones: un
   tipo con `tipo_ausencia=VACACIONES` y otro descuento pasa a PERSONAL.
   `0004` no puede dejar ese estado (solo puso VACACIONES donde había
   `descuenta_vacaciones`), pero hasta hoy la API lo admitía al editar un
   tipo; la corrección es por si alguien lo guardó así. Se hace antes de
   rellenar las solicitudes, para que hereden el valor corregido.

Al revertir los campos se quitan; la corrección del punto 2 no se deshace
(el estado anterior era incoherente).
"""

from django.db import migrations, models


def corregir_vacaciones_sin_descuento(apps, schema_editor):
    Flujo = apps.get_model("licencias", "FlujoPermiso")
    Flujo._base_manager.filter(tipo_ausencia="VACACIONES").exclude(
        descuento="vacaciones"
    ).update(tipo_ausencia="PERSONAL")


def rellenar_solicitudes(apps, schema_editor):
    Flujo = apps.get_model("licencias", "FlujoPermiso")
    Solicitud = apps.get_model("licencias", "SolicitudPermiso")
    for flujo in Flujo._base_manager.all().only("unidad", "descuento", "tipo_ausencia"):
        Solicitud._base_manager.filter(flujo_id=flujo.pk).update(
            unidad=flujo.unidad, descuento=flujo.descuento, tipo_ausencia=flujo.tipo_ausencia
        )


class Migration(migrations.Migration):

    dependencies = [
        ('licencias', '0004_clasificacion_de_tipos_y_horas'),
    ]

    operations = [
        migrations.AddField(
            model_name='solicitudpermiso',
            name='descuento',
            field=models.CharField(choices=[('sueldo', 'Con descuento de sueldo'), ('vacaciones', 'Se descuenta de las vacaciones'), ('ninguno', 'Con goce de sueldo (sin descuento)')], default='ninguno', max_length=10),
        ),
        migrations.AddField(
            model_name='solicitudpermiso',
            name='tipo_ausencia',
            field=models.CharField(choices=[('MEDICO', 'Médico'), ('PERSONAL', 'Personal'), ('VACACIONES', 'Vacaciones')], default='PERSONAL', max_length=15),
        ),
        migrations.AddField(
            model_name='solicitudpermiso',
            name='unidad',
            field=models.CharField(choices=[('dias', 'Por días'), ('horas', 'Por horas')], default='dias', max_length=5),
        ),
        migrations.RunPython(corregir_vacaciones_sin_descuento, migrations.RunPython.noop),
        migrations.RunPython(rellenar_solicitudes, migrations.RunPython.noop),
    ]
