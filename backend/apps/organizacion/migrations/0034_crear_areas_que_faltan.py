"""Crea las áreas de los organigramas del 27/10/2026 donde no existían.

La 0033 solo ajustaba las unidades que ya estaban; en producción Gestión
Humana, LaarBox y Procesos y Proyectos todavía no existían y no hizo nada.
Ahora `levantamientos.levantar` las crea bajo la Gerencia General, con sus
cargos, jefes, plazas y personas. Donde ya estaban (y la 0033 las dejó como
dicen los organigramas) no cambia nada."""

from django.db import migrations

from apps.core.migraciones import si_el_esquema_esta_al_dia

MOTIVO = (
    "Se crean en el organigrama las áreas que pasaron el 27/10/2026 y aún no "
    "estaban: Gestión de Talento Humano LCE 2026 (su gerente reporta al "
    "Gerente General), LaarBox y Procesos y Proyectos (su gerente reporta al "
    "Gerente General), con sus cargos, jefes, plazas y personas."
)


def aplicar(apps, schema_editor):
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa
    from apps.organizacion import laarbox_2026, procesos_2026, talento_humano_2026, versiones

    for empresa in Empresa.objects.order_by("id"):
        with usando_empresa(empresa), versiones.sin_peticion(MOTIVO):
            talento_humano_2026.cambiar()
            laarbox_2026.cambiar()
            procesos_2026.cambiar()


class Migration(migrations.Migration):
    dependencies = [("organizacion", "0033_organigrama_talento_humano_2026")]

    operations = [
        migrations.RunPython(si_el_esquema_esta_al_dia(aplicar), migrations.RunPython.noop)
    ]
