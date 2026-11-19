"""Sin los permisos de Reuniones (19/11/2026).

Decisión del usuario: «en el módulo de Gestión Humana, que las secciones y
temas de reuniones se quiten del proyecto», confirmada como quitar la app por
completo. El catálogo ya no tiene el grupo `reuniones` (`permissions/0073`),
pero los `auth.Permission` `reuniones.acceder`, `reuniones.crear` y
`reuniones.administrar` seguirían en la base y en los roles que los tenían
(Administrador de Gestión Humana, COORDINADOR_NACIONAL, COORDINADOR_ZS,
JEFE_NACIONAL, Superusuario y TRABAJO_SOCIAL). Se borran: con eso salen de
todos los roles y de las cuentas que los tuvieran sueltos.

Idempotente. Revertirla no hace nada: la app ya no existe y el catálogo no
los volvería a crear.
"""

from django.conf import settings
from django.db import migrations

PREFIJO = "reuniones."


def borrar(apps, schema_editor):
    Permission = apps.get_model("auth", "Permission")
    # Sin regex: SQL Server no la admite en una consulta.
    Permission.objects.filter(
        content_type__app_label="permissions", codename__startswith=PREFIJO
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0058_permiso_solicitar_proyectos"),
        ("permissions", "0073_quitar_reuniones"),
        # Borrar un permiso quita también sus filas en los roles y en las
        # cuentas: el modelo de usuario tiene que estar en el estado.
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [migrations.RunPython(borrar, migrations.RunPython.noop)]
