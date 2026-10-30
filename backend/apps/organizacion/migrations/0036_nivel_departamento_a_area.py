"""El nivel jerárquico «Departamento» pasa a llamarse «Área» (27/10/2026): es
la etiqueta que el organigrama muestra sobre cada área (TI, Gestión de
Talento Humano…). Si la empresa ya tiene un nivel «Área», no se toca. Queda
en la bitácora del organigrama."""

from django.db import migrations

from apps.core.migraciones import si_el_esquema_esta_al_dia

ANTES = "Departamento"
AHORA = "Área"
MOTIVO = "Se renombra el nivel jerárquico «Departamento» a «Área»."


def aplicar(apps, schema_editor):
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa
    from apps.organizacion import versiones
    from apps.organizacion.models import NivelJerarquico

    for empresa in Empresa.objects.order_by("id"):
        with usando_empresa(empresa):
            nivel = NivelJerarquico.objects.filter(nombre__iexact=ANTES).first()
            if nivel is None or NivelJerarquico.objects.filter(nombre__iexact=AHORA).exists():
                continue
            with versiones.sin_peticion(MOTIVO):
                nivel.nombre = AHORA
                nivel.save(update_fields=["nombre", "updated_at"])


class Migration(migrations.Migration):
    dependencies = [("organizacion", "0035_renombrar_innovacion_a_ti")]

    operations = [
        migrations.RunPython(si_el_esquema_esta_al_dia(aplicar), migrations.RunPython.noop)
    ]
