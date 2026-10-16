"""Un solo catálogo de roles para todo el sistema.

Hasta aquí la Matriz tenía sus propios roles —«Matriz · Administrador»,
«Matriz · Auditor»…— junto a los del inventario, y la misma persona necesitaba
dos para administrar las dos cosas. Los roles pasan a ser **generales**: cada
uno junta los permisos de todos los módulos que le corresponden.

- «Matriz · Administrador» se funde en **Administrador**, que gana todos los
  permisos de la Matriz y de sus catálogos.
- «Matriz · Auditor» se funde en **Consulta / Auditoría**, que gana ver todo,
  exportar y la auditoría de la Matriz, y ver sus catálogos.
- «Matriz · Responsable» pasa a llamarse **Responsable de cumplimiento**.
- «Matriz · Supervisor/Aprobador» pasa a llamarse **Supervisor de
  cumplimiento**.

Quien tuviera uno de los roles fundidos —en una membresía o como rol global—
recibe el rol general correspondiente antes de que el fundido se borre: nadie
pierde nada. Es idempotente y no quita permisos a nadie.
"""

from django.db import migrations

MATRIZ_TODOS = [
    "matriz.ver_todas",
    "matriz.crear",
    "matriz.editar",
    "matriz.cambiar_fecha",
    "matriz.cargar",
    "matriz.enviar",
    "matriz.validar",
    "matriz.recordar",
    "matriz.exportar",
    "matriz.ver_auditoria",
    "matriz.configurar",
    "matriz.gestionar_miembros",
]

CONSULTA_INVENTARIO = [
    "activos.ver",
    "activos.ver_asignados",
    "organizacion.ver",
    "mantenimientos.ver",
    "politicas.ver",
    "adjuntos.ver",
    "alertas.ver",
    "reportes.ver",
    "reportes.exportar",
    "auditoria.ver",
    "auditoria.ver_detalle",
    "auditoria.exportar",
]
CONSULTA_MATRIZ = ["matriz.ver_todas", "matriz.exportar", "matriz.ver_auditoria", "catalogos.ver"]

#: Rol de la Matriz → (rol general que lo absorbe, lo que el general gana si ya
#: existía, todo lo que tiene que tener si se crea ahora). `None` = el catálogo
#: completo, como define `crear_roles_iniciales` al Administrador.
FUSIONES = {
    "Matriz · Administrador": (
        "Administrador",
        MATRIZ_TODOS + ["catalogos.ver", "catalogos.editar"],
        None,
    ),
    "Matriz · Auditor": ("Consulta / Auditoría", CONSULTA_MATRIZ, CONSULTA_INVENTARIO + CONSULTA_MATRIZ),
}

RENOMBRES = {
    "Matriz · Responsable": "Responsable de cumplimiento",
    "Matriz · Supervisor/Aprobador": "Supervisor de cumplimiento",
}


def unificar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    MembresiaEmpresa = apps.get_model("empresas", "MembresiaEmpresa")
    User = apps.get_model("users", "User")
    del_catalogo = Permission.objects.filter(content_type__app_label="permissions")

    for fundido_nombre, (general_nombre, suma, completo) in FUSIONES.items():
        fundido = Group.objects.filter(name=fundido_nombre).first()
        general = Group.objects.filter(name=general_nombre).first()

        if general is None:
            # Instalación sin los roles del inventario (`crear_roles_iniciales`
            # no se corrió): el de la Matriz pasa a ser el general, con todo
            # lo que el general tiene que tener. Quien lo tuviera, lo conserva.
            if fundido is None:
                general = Group.objects.create(name=general_nombre)
            else:
                fundido.name = general_nombre
                fundido.save(update_fields=["name"])
                general, fundido = fundido, None
            general.permissions.add(
                *(del_catalogo if completo is None else del_catalogo.filter(codename__in=completo))
            )
            continue

        general.permissions.add(*del_catalogo.filter(codename__in=suma))
        if fundido is None:
            continue
        # Lo que se le hubiera ajustado a mano al rol fundido, también pasa.
        general.permissions.add(*fundido.permissions.all())
        for membresia in MembresiaEmpresa.objects.filter(roles=fundido):
            membresia.roles.add(general)
        for usuario in User.objects.filter(groups=fundido):
            usuario.groups.add(general)
        fundido.delete()

    for viejo, nuevo in RENOMBRES.items():
        rol = Group.objects.filter(name=viejo).first()
        if rol is not None and not Group.objects.filter(name=nuevo).exists():
            rol.name = nuevo
            rol.save(update_fields=["name"])


def noop_reverse(apps, schema_editor):
    # No se vuelven a separar: no hay forma de saber qué permisos de los
    # roles generales venían de los fundidos y cuáles se ajustaron después.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0006_roles_de_la_matriz"),
        ("empresas", "0005_crear_para_otros"),
        ("users", "0002_ultima_conexion_desde_los_intentos"),
    ]

    operations = [
        migrations.RunPython(unificar, noop_reverse),
    ]
