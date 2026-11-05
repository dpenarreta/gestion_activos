"""Permisos médicos con motivo y documento obligatorio (05/11/2026).

Decisión del usuario: un tipo de permiso cuyo `tipo_ausencia` es MÉDICO pide
siempre el motivo y el documento de respaldo (`adjunto = "obligatorio"`), y
los dos se conservan con la solicitud. Desde ahora la API rechaza otra
configuración (`FlujoSerializer`); aquí se corrigen los tipos que ya existían.

Solo cambia la configuración del tipo: las solicitudes ya hechas no se tocan.
Al revertir no se vuelve atrás (no se sabe cómo estaba cada tipo y dejar uno
médico sin documento es justo lo que se quiere evitar).
"""

from django.db import migrations


def corregir_medicos(apps, schema_editor):
    Flujo = apps.get_model("licencias", "FlujoPermiso")
    Flujo._base_manager.filter(tipo_ausencia="MEDICO").update(
        pide_motivo=True, adjunto="obligatorio"
    )


class Migration(migrations.Migration):
    dependencies = [
        ("licencias", "0005_clasificacion_en_la_solicitud"),
    ]

    operations = [migrations.RunPython(corregir_medicos, migrations.RunPython.noop)]
