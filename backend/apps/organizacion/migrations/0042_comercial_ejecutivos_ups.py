"""Internacional UPS del área Comercial, corregido por el usuario (28/10/2026).

«Asesor Comercial UPS Quito» es Ejecutivo de Negocios UPS Quito, «Asesor
Comercial UPS Guayaquil» es Asistente Comercial UPS Guayaquil y faltaba la
Ejecutiva de Negocios UPS Guayaquil; todos reportan al Gerente Comercial.
La Asistente Comercial UPS Guayaquil que la 0041 había puesto en la División
UPS sale de ahí (se desactiva si nadie la ocupa). Repetirlo no cambia nada."""

from django.db import migrations

from apps.core.migraciones import si_el_esquema_esta_al_dia

MOTIVO = (
    "Internacional UPS del área Comercial corregido: Ejecutivo de Negocios "
    "UPS Quito, Ejecutiva de Negocios UPS Guayaquil y Asistente Comercial UPS "
    "Guayaquil, con reporte al Gerente Comercial; la asistente sale de la "
    "División UPS."
)


def aplicar(apps, schema_editor):
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa
    from apps.organizacion import comercial_2026, ups_2026, versiones

    for empresa in Empresa.objects.order_by("id"):
        with usando_empresa(empresa), versiones.sin_peticion(MOTIVO):
            ups_2026.cambiar()
            comercial_2026.cambiar()


class Migration(migrations.Migration):
    dependencies = [("organizacion", "0041_division_ups_fuera_de_comercial")]

    operations = [
        migrations.RunPython(si_el_esquema_esta_al_dia(aplicar), migrations.RunPython.noop)
    ]
