"""Vuelve a aplicar el organigrama de Financiero Administrativo y su reporte
secundario (10/11/2026).

En producción, 0044 corrió antes que 0045 (la tabla de `jefes_secundarios`):
la bitácora del organigrama consulta esa tabla en cada cambio, la consulta
falló y `si_el_esquema_esta_al_dia` saltó la carga en silencio. 0046 tampoco
encontró al Jefe Financiero Administrativo. Con el esquema ya completo se
repiten las dos; las dos son idempotentes, así que donde ya se aplicaron
(desarrollo) no cambian nada."""

from django.db import migrations

from apps.core.migraciones import si_el_esquema_esta_al_dia


def aplicar(apps, schema_editor):
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa
    from apps.organizacion import financiero_2026, reporte_secundario_2026, versiones

    for empresa in Empresa.objects.order_by("id"):
        with usando_empresa(empresa), versiones.sin_peticion(financiero_2026.MOTIVO):
            financiero_2026.cambiar()
        with usando_empresa(empresa), versiones.sin_peticion(reporte_secundario_2026.MOTIVO):
            reporte_secundario_2026.cambiar()


class Migration(migrations.Migration):
    dependencies = [("organizacion", "0046_reporte_secundario_2026")]

    operations = [
        migrations.RunPython(si_el_esquema_esta_al_dia(aplicar), migrations.RunPython.noop)
    ]
