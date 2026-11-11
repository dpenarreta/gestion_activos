"""«Editar textos de protección de datos» para quien ya los editaba (US-004,
11/11/2026).

Desde US-004 todos los textos sobre datos personales se editan en un solo
lugar, Protección de datos, con `privacidad.textos`. Hasta hoy cada uno tenía
su propio permiso: el aviso general, `privacidad.atender`; la autorización del
teléfono, `configuracion.textos_legales`; los términos del rol de pagos y el
consentimiento del correo, `roles_pago.configurar`; el acuerdo de
confidencialidad, `codigos.acuerdo`.

Para que nadie pierda la edición el día del cambio, se concede **a los roles
que tienen cualquiera de esos cuatro** (CA-9). Los permisos de antes no se
quitan: siguen sirviendo para lo demás de sus pantallas. Superusuario lo trae
del «todo el catálogo» de `crear_roles_iniciales`.

**También al rol «Administrador» (TI)**, por decisión del usuario del
11/11/2026: ya editaba la autorización del teléfono y el acuerdo, y los sigue
editando. Solo lleva `privacidad.textos`: la decisión del 09/11/2026
(`privacidad/0003`) se mantiene para las solicitudes de derechos, así que
sigue sin `privacidad.ver` ni `privacidad.atender`. `crear_roles_iniciales`
se ajusta para no quitárselo.

Solo suma y es idempotente. Revertirla lo quita de los roles (como
`0044`): si después se concedió a mano, también se quita.
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations

NUEVO = "privacidad.textos"
BASES = (
    "privacidad.atender",
    "configuracion.textos_legales",
    "roles_pago.configurar",
    "codigos.acuerdo",
)


def _permisos(apps, codenames):
    Permission = apps.get_model("auth", "Permission")
    return list(
        Permission.objects.filter(content_type__app_label="permissions", codename__in=codenames)
    )


def _crear_permisos(apps):
    """Los `auth.Permission` del catálogo los crea `post_migrate`, que corre
    después: se crean aquí si aún no existen (como `0044`)."""
    configuracion = apps.get_app_config("permissions")
    antes = getattr(configuracion, "models_module", None)
    configuracion.models_module = True
    try:
        create_permissions(configuracion, apps=apps, verbosity=0)
    finally:
        configuracion.models_module = antes


def conceder(apps, schema_editor):
    _crear_permisos(apps)
    nuevo = next(iter(_permisos(apps, [NUEVO])), None)
    bases = _permisos(apps, BASES)
    if nuevo is None or not bases:
        return
    Group = apps.get_model("auth", "Group")
    roles = Group.objects.filter(permissions__in=bases).exclude(permissions=nuevo).distinct()
    for rol in roles:
        rol.permissions.add(nuevo)


def retirar(apps, schema_editor):
    nuevo = next(iter(_permisos(apps, [NUEVO])), None)
    if nuevo is None:
        return
    Group = apps.get_model("auth", "Group")
    for rol in Group.objects.filter(permissions=nuevo):
        rol.permissions.remove(nuevo)


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0044_permiso_mi_horario"),
        ("permissions", "0059_permiso_textos_de_privacidad"),
    ]

    operations = [migrations.RunPython(conceder, retirar)]
