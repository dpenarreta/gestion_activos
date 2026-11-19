"""El Directorio, horizontal a la Gerencia General (19/11/2026).

Se crea la unidad Directorio a la altura de la Gerencia General; pasan a ella
el Gerente de Procesos y Proyectos y el nuevo Jefe de Finanzas y
Administración, a quien reporta el Jefe Financiero Administrativo (que
también reporta, en línea punteada, al Gerente General). Ver
`apps.organizacion.directorio_2026`. En cada empresa, solo si los cargos
existen. Repetirlo no cambia nada."""

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
    dependencies = [("organizacion", "0051_perfil_confirmado")]

    operations = [
        migrations.RunPython(si_el_esquema_esta_al_dia(aplicar), migrations.RunPython.noop)
    ]
