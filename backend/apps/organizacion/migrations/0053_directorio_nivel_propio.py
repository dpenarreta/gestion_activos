"""El Directorio con su nivel propio (19/11/2026).

La 0052 lo dejó en el nivel de la Gerencia General, y cada unidad muestra su
nivel encima de su nombre: «Gerencia General · Directorio» se leía como si
el Directorio estuviera bajo el Gerente General. Corrección del usuario: son
áreas aparte, relacionadas pero sin supervisión. Ahora tiene el nivel
«Directorio», a la misma altura. Ver `apps.organizacion.directorio_2026`.
Repetirlo no cambia nada."""

from django.db import migrations

from apps.core.migraciones import si_el_esquema_esta_al_dia


def aplicar(apps, schema_editor):
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa
    from apps.organizacion import directorio_2026, versiones

    for empresa in Empresa.objects.order_by("id"):
        with usando_empresa(empresa), versiones.sin_peticion(directorio_2026.MOTIVO):
            directorio_2026.cambiar()


class Migration(migrations.Migration):
    dependencies = [("organizacion", "0052_directorio_2026")]

    operations = [
        migrations.RunPython(si_el_esquema_esta_al_dia(aplicar), migrations.RunPython.noop)
    ]
