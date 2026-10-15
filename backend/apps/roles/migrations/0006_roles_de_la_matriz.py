"""Los permisos de la Matriz de obligaciones: al rol "Superusuario" y a los
cuatro roles que la especificación siembra (§7).

Como `0002` a `0005`: se añaden los permisos que falten sin quitar ninguno, y
es idempotente.

Los cuatro roles son **roles editables** del sistema, no lógica fija: después se
pueden renombrar, cambiar o borrar desde Configuración → Roles. Llevan el
prefijo «Matriz ·» porque ya existe un «Administrador» del inventario, y dos
roles con el mismo nombre en la ficha de un usuario no se distinguirían. Sus
permisos `matriz.*` solo valen en las empresas donde el rol se asigna en la
membresía (ver `apps.permissions.authorization.SOLO_POR_EMPRESA`).
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

NOMBRE_SUPERUSUARIO = "Superusuario"

TODOS = [
    "ver_todas",
    "crear",
    "editar",
    "cambiar_fecha",
    "cargar",
    "enviar",
    "validar",
    "recordar",
    "exportar",
    "ver_auditoria",
    "configurar",
    "gestionar_miembros",
]

#: La tabla de la sección 7 de la especificación.
ROLES = {
    "Matriz · Administrador": TODOS,
    # Ve y actúa solo sobre lo suyo; crea en sus áreas.
    "Matriz · Responsable": ["crear", "editar", "cargar", "enviar", "recordar"],
    # Ve todo, valida, devuelve, rechaza y cambia fechas.
    "Matriz · Supervisor/Aprobador": [
        "ver_todas",
        "cambiar_fecha",
        "validar",
        "recordar",
        "exportar",
        "ver_auditoria",
    ],
    # Solo lectura, exportación y auditoría: útil para externos en varias
    # empresas.
    "Matriz · Auditor": ["ver_todas", "exportar", "ver_auditoria"],
}


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")

    content_type, _ = ContentType.objects.get_or_create(
        app_label="permissions", model="modulepermission"
    )
    for codename, name in as_django_permission_tuples():
        Permission.objects.get_or_create(
            content_type=content_type, codename=codename, defaults={"name": name}
        )

    superusuario = Group.objects.filter(name=NOMBRE_SUPERUSUARIO).first()
    if superusuario is not None:
        faltantes = Permission.objects.filter(content_type=content_type).exclude(
            id__in=superusuario.permissions.values_list("id", flat=True)
        )
        if faltantes.exists():
            superusuario.permissions.add(*faltantes)

    for nombre, acciones in ROLES.items():
        rol, creado = Group.objects.get_or_create(name=nombre)
        if not creado:
            # Ya existía: alguien pudo ajustarlo a mano, y no se le pisa.
            continue
        rol.permissions.add(
            *Permission.objects.filter(
                content_type=content_type,
                codename__in=[f"matriz.{accion}" for accion in acciones],
            )
        )


def noop_reverse(apps, schema_editor):
    # No se borran roles ni se revocan permisos al revertir: no hay forma de
    # distinguir lo que sembró esta migración de lo que se ajustó después.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0005_sumar_permisos_adjuntos"),
        ("permissions", "0011_permisos_de_la_matriz"),
    ]

    operations = [
        migrations.RunPython(sembrar, noop_reverse),
    ]
