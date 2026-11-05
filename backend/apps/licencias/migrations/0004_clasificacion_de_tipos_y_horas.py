"""Clasificación de cada tipo de permiso y permisos por horas (05/11/2026).

- `descuento` (sueldo, vacaciones o ninguno), `unidad` (días u horas) y
  `tipo_ausencia` (el `LeaveRecord` que genera al aprobarse).
- Los tipos con `descuenta_vacaciones=True` pasan a `descuento="vacaciones"`
  y `tipo_ausencia="VACACIONES"`: la lógica de descuento de vacaciones no
  cambia (sigue leyendo `descuenta_vacaciones`, que queda como espejo).
- Los demás quedan «ninguno» y PERSONAL, salvo los que se llaman «… médico…»,
  que generan ausencias MÉDICAS: así su ausencia queda protegida como dato de
  salud desde el primer día (se puede cambiar en Configurar flujos).
- `hora_desde`/`hora_hasta` de la solicitud, solo para los tipos por horas.

Al revertir no hay nada que deshacer en los datos: los campos se quitan.
"""

import unicodedata

from django.db import migrations, models


def _sin_tildes(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn"
    ).lower()


def clasificar(apps, schema_editor):
    Flujo = apps.get_model("licencias", "FlujoPermiso")
    Flujo._base_manager.filter(descuenta_vacaciones=True).update(
        descuento="vacaciones", tipo_ausencia="VACACIONES", unidad="dias"
    )
    medicos = [
        flujo.pk
        for flujo in Flujo._base_manager.filter(descuenta_vacaciones=False).only("nombre")
        if "medic" in _sin_tildes(flujo.nombre)
    ]
    if medicos:
        Flujo._base_manager.filter(pk__in=medicos).update(tipo_ausencia="MEDICO")


class Migration(migrations.Migration):

    dependencies = [
        ('licencias', '0003_vacaciones_sin_motivo'),
    ]

    operations = [
        migrations.AddField(
            model_name='flujopermiso',
            name='descuento',
            field=models.CharField(choices=[('sueldo', 'Con descuento de sueldo'), ('vacaciones', 'Se descuenta de las vacaciones'), ('ninguno', 'Con goce de sueldo (sin descuento)')], default='ninguno', max_length=10),
        ),
        migrations.AddField(
            model_name='flujopermiso',
            name='tipo_ausencia',
            field=models.CharField(choices=[('MEDICO', 'Médico'), ('PERSONAL', 'Personal'), ('VACACIONES', 'Vacaciones')], default='PERSONAL', max_length=15),
        ),
        migrations.AddField(
            model_name='flujopermiso',
            name='unidad',
            field=models.CharField(choices=[('dias', 'Por días'), ('horas', 'Por horas')], default='dias', max_length=5),
        ),
        migrations.AddField(
            model_name='solicitudpermiso',
            name='hora_desde',
            field=models.TimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='solicitudpermiso',
            name='hora_hasta',
            field=models.TimeField(blank=True, null=True),
        ),
        migrations.RunPython(clasificar, migrations.RunPython.noop),
    ]
