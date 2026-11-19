"""El Directorio completo (19/11/2026).

Quiénes son el Directorio, según el usuario: el Presidente; el Director
Ejecutivo y el Director Financiero, al mismo nivel; y el Comité Ejecutivo
(Gerente de Procesos y Proyectos, Jefe Administrativo Financiero Corporativo
—antes «Jefe de Finanzas y Administración»— y Gerente General), que informa
a los dos Directores en línea punteada, sin supervisión directa. Ver
`apps.organizacion.directorio_2026`. Repetirlo no cambia nada."""

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
    dependencies = [("organizacion", "0053_directorio_nivel_propio")]

    operations = [
        migrations.RunPython(si_el_esquema_esta_al_dia(aplicar), migrations.RunPython.noop)
    ]
