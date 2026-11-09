"""El organigrama del área de Cartera (09/11/2026).

Cartera queda como área propia bajo la Gerencia General, con su Jefatura
reportando al Gerente General y las personas de cada cargo
(`apps.organizacion.cartera_2026`). Repetirlo no cambia nada."""

from django.db import migrations

from apps.core.migraciones import si_el_esquema_esta_al_dia


def aplicar(apps, schema_editor):
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa
    from apps.organizacion import cartera_2026, versiones

    for empresa in Empresa.objects.order_by("id"):
        with usando_empresa(empresa), versiones.sin_peticion(cartera_2026.MOTIVO):
            cartera_2026.cambiar()


class Migration(migrations.Migration):
    dependencies = [("organizacion", "0042_comercial_ejecutivos_ups")]

    operations = [
        migrations.RunPython(si_el_esquema_esta_al_dia(aplicar), migrations.RunPython.noop)
    ]
