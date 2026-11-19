"""Borra lo que dejó en la base la app Reuniones (19/11/2026).

Decisión del usuario: la app Reuniones de Gestión Humana se quita del
proyecto por completo (en producción no tenía ninguna reunión ni invitado).
Al salir de `INSTALLED_APPS` sus migraciones ya no corren, así que nada
borraría sus tablas; lo hace esta migración, en una app que sigue instalada:

1. Las tablas `reuniones_meetinginvitee` (primero: apunta a la otra) y
   `reuniones_meeting`, si existen.
2. Los tipos de contenido de `reuniones`, con sus `auth.Permission`
   (`add_meeting`…) y las entradas del admin que los citen.
3. Las filas de `django_migrations` de `reuniones`.

En una base nueva no encuentra nada y no hace nada. Revertirla tampoco: las
tablas no se recrean. Los permisos del catálogo `reuniones.*` los borra
`roles/0059`.
"""

from django.conf import settings
from django.db import migrations
from django.db.migrations.recorder import MigrationRecorder

APP = "reuniones"
#: En orden: la de invitados tiene la FK a la de reuniones.
TABLAS = ("reuniones_meetinginvitee", "reuniones_meeting")


def borrar(apps, schema_editor):
    conexion = schema_editor.connection
    existentes = set(conexion.introspection.table_names())
    for tabla in TABLAS:
        if tabla in existentes:
            schema_editor.execute(f"DROP TABLE {schema_editor.quote_name(tabla)}")

    ContentType = apps.get_model("contenttypes", "ContentType")
    Permission = apps.get_model("auth", "Permission")
    LogEntry = apps.get_model("admin", "LogEntry")
    tipos = ContentType.objects.filter(app_label=APP)
    LogEntry.objects.filter(content_type__in=tipos).delete()
    Permission.objects.filter(content_type__in=tipos).delete()
    tipos.delete()

    MigrationRecorder(conexion).migration_qs.filter(app=APP).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0008_auditlog_migrado_de_nexo"),
        ("contenttypes", "0002_remove_content_type_name"),
        ("auth", "0012_alter_user_first_name_max_length"),
        ("admin", "0003_logentry_add_action_flag_choices"),
        # Borrar los permisos quita sus filas en los roles y en las cuentas.
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [migrations.RunPython(borrar, migrations.RunPython.noop)]
