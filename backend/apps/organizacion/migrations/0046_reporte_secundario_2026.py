"""El reporte secundario de Cartera y Gestión Humana (09/11/2026).

La Jefatura de Cartera y la Gerencia de Gestión Humana reportan al Gerente
General y también, en línea punteada, al Jefe Financiero Administrativo
(`apps.organizacion.reporte_secundario_2026`). En cada empresa, solo si los
cargos existen. Repetirlo no cambia nada."""

from django.db import migrations

from apps.core.migraciones import si_el_esquema_esta_al_dia


def aplicar(apps, schema_editor):
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa
    from apps.organizacion import reporte_secundario_2026, versiones

    for empresa in Empresa.objects.order_by("id"):
        with usando_empresa(empresa), versiones.sin_peticion(reporte_secundario_2026.MOTIVO):
            reporte_secundario_2026.cambiar()


class Migration(migrations.Migration):
    dependencies = [("organizacion", "0045_reporte_secundario")]

    operations = [
        migrations.RunPython(si_el_esquema_esta_al_dia(aplicar), migrations.RunPython.noop)
    ]
