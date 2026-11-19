"""El nivel de cargo «Directorio» (19/11/2026).

Pedido del usuario: el Presidente del Directorio, los Directores Ejecutivo y
Financiero, el Gerente de Procesos y Proyectos y el Jefe Administrativo
Financiero Corporativo van en el nivel «Directorio», encima de Gerencia
General. Se agrega el nivel y se aplica `directorio_2026` en cada empresa.
Repetirlo no cambia nada."""

from django.db import migrations, models

from apps.core.migraciones import si_el_esquema_esta_al_dia


def aplicar(apps, schema_editor):
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa
    from apps.organizacion import directorio_2026, versiones

    for empresa in Empresa.objects.order_by("id"):
        with usando_empresa(empresa), versiones.sin_peticion(directorio_2026.MOTIVO):
            directorio_2026.cambiar()


class Migration(migrations.Migration):
    dependencies = [("organizacion", "0054_directorio_presidente_y_comite")]

    operations = [
        migrations.AlterField(
            model_name="cargo",
            name="nivel",
            field=models.CharField(
                choices=[
                    ("directorio", "Directorio"),
                    ("gerencia_general", "Gerencia General"),
                    ("gerencia_area", "Gerencia de Área"),
                    ("jefatura", "Jefatura"),
                    ("coordinacion", "Coordinación"),
                    ("operativo", "Operativo de área"),
                    ("asistente", "Asistente de área"),
                ],
                default="operativo",
                max_length=20,
            ),
        ),
        migrations.RunPython(si_el_esquema_esta_al_dia(aplicar), migrations.RunPython.noop),
    ]
