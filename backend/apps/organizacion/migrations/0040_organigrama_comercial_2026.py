"""El organigrama del área Comercial, con la División UPS (27/10/2026).

Ver `comercial_2026`: jefes comerciales de Quito, Guayaquil y Cuenca,
Internacional UPS y Televentas con reporte directo a la Gerencia, y la
División UPS bajo su Coordinador. Donde el área no existe se crea bajo la
Gerencia General. Repetirlo no cambia nada."""

from django.db import migrations

from apps.core.migraciones import si_el_esquema_esta_al_dia


def aplicar(apps, schema_editor):
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa
    from apps.organizacion import comercial_2026, versiones

    for empresa in Empresa.objects.order_by("id"):
        with usando_empresa(empresa), versiones.sin_peticion(comercial_2026.MOTIVO):
            comercial_2026.cambiar()


class Migration(migrations.Migration):
    dependencies = [("organizacion", "0039_texto_alternativo_noticia")]

    operations = [
        migrations.RunPython(si_el_esquema_esta_al_dia(aplicar), migrations.RunPython.noop)
    ]
