"""El Directorio arriba de todo el organigrama (19/11/2026).

Pedido del usuario: toda la parte del Directorio va en la parte superior del
organigrama, centrada, no arriba a la derecha. Su nivel de unidad pasa a ser
el primero (encima del de la Gerencia General), sin línea de supervisión
entre ellos. Ver `apps.organizacion.directorio_2026`. Repetirlo no cambia
nada."""

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
    dependencies = [("organizacion", "0055_nivel_cargo_directorio")]

    operations = [
        migrations.RunPython(si_el_esquema_esta_al_dia(aplicar), migrations.RunPython.noop)
    ]
