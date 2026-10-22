"""Los roles del sistema que salen de los cargos del organigrama (21/10/2026).

Antes había un rol por nivel jerárquico («LaarCourier · Área»); ahora cada
**cargo** del organigrama es un rol: «Jefe TI», «Coordinador de Soporte
Técnico», «Analista Programador»… Quienes ocupan el mismo cargo (las plazas de
«Analista Programador» bajo un mismo jefe) comparten el rol y sus permisos. Un
cargo que se llama igual en otra unidad o empresa tiene su propio rol, con
permisos independientes: se distingue con la unidad y, si hace falta, con la
empresa («Asistente · Comercial», «Jefe TI · Tecnología · LaarSeguridad»); si en
la misma unidad hay dos con el mismo nombre bajo jefes distintos, también con
su jefe («Asistente de Sistemas · Tecnología · Coordinador TI»).

Cada rol nace con los permisos de todo empleado (`PERMISOS_BASE`) y el resto
se le marca en Configuración → Roles como a cualquier otro. Se crea, se
renombra y se borra junto con su cargo. Quien ocupa un cargo recibe su rol en
la membresía de esa empresa; si cambia de cargo, cambia de rol solo. Los roles
personalizados se siguen asignando a mano y se suman a este.
"""

from django.contrib.auth.models import Group, Permission
from django.db import transaction

from apps.empresas.models import MembresiaEmpresa

from .models import Cargo, DatosDeContacto

#: Lo que puede hacer toda persona de la empresa por ocupar un cargo. Antes
#: bastaba con tener sesión; ahora es un permiso, y se puede quitar.
PERMISOS_BASE = (
    "licencias.solicitar",
    "sugerencias.reportar",
    "institucional.ver_area",
)
# Consultar el propio rol de pagos tampoco: va persona por persona, por la
# lista de habilitados (22/10/2026). Los permisos que da cada cargo en
# particular están en `permisos_por_cargo`.
# El chat y Soporte TI no están aquí a propósito: son de todo usuario, tenga el
# rol que tenga (decisión del 21/10/2026).

LARGO = 150


def _dar_permisos_base(rol) -> None:
    rol.permissions.add(
        *Permission.objects.filter(
            content_type__app_label="permissions", codename__in=PERMISOS_BASE
        )
    )


def _ocupado(nombre: str, rol_propio_id) -> bool:
    return Group.objects.filter(name__iexact=nombre).exclude(pk=rol_propio_id).exists()


def nombre_del_rol(cargo) -> str:
    """El nombre del cargo; si otro cargo se llama igual, con su unidad; si en
    la misma unidad hay otro igual (bajo otro jefe), también con su jefe; y si
    aun así se repite, con la empresa. En último caso, con un número."""
    nombre = cargo.nombre.strip()
    iguales = Cargo.objects.todas().filter(nombre__iexact=nombre).exclude(pk=cargo.pk)
    unidad = cargo.unidad.nombre if cargo.unidad_id else ""
    jefe = cargo.jefe.nombre if cargo.jefe_id else ""
    en_su_unidad = iguales.filter(unidad_id=cargo.unidad_id, empresa_id=cargo.empresa_id)
    partes = [nombre]
    candidatos = []
    if not iguales.exists():
        candidatos.append(nombre)
    if unidad:
        partes.append(unidad)
        if not en_su_unidad.exists():
            candidatos.append(" · ".join(partes))
    if jefe:
        partes.append(jefe)
        candidatos.append(" · ".join(partes))
    candidatos.append(" · ".join(partes + [cargo.empresa.nombre]))
    for candidato in candidatos:
        candidato = candidato[:LARGO]
        if not _ocupado(candidato, cargo.rol_id):
            return candidato
    base, n = candidatos[-1][: LARGO - 5], 2
    while _ocupado(f"{base} ({n})", cargo.rol_id):
        n += 1
    return f"{base} ({n})"


@transaction.atomic
def asegurar_rol(cargo, *, con_homonimos=True) -> Group:
    """Crea el rol del cargo, o lo renombra si cambió su nombre o su unidad.
    Con `con_homonimos`, también ajusta el de los cargos que se llaman igual
    (al aparecer un «Asistente» en otra unidad, el primero pasa a «Asistente ·
    TI» para que los dos se distingan)."""
    from .permisos_por_cargo import sincronizar_rol

    nombre = nombre_del_rol(cargo)
    if cargo.rol_id is None:
        rol = Group.objects.create(name=nombre)
        _dar_permisos_base(rol)
        Cargo.objects.todas().filter(pk=cargo.pk).update(rol=rol)
        cargo.rol = rol
    else:
        rol = cargo.rol
        if rol.name != nombre:
            rol.name = nombre
            rol.save(update_fields=["name"])
    # Lo que da este cargo en particular (Gestión Humana, TI…).
    sincronizar_rol(rol, cargo.nombre)
    if con_homonimos:
        for otro in (
            Cargo.objects.todas()
            .filter(nombre__iexact=cargo.nombre.strip())
            .exclude(pk=cargo.pk)
            .select_related("rol", "unidad", "empresa", "jefe")
        ):
            asegurar_rol(otro, con_homonimos=False)
    return rol


def borrar_rol(cargo) -> None:
    if cargo.rol_id:
        Group.objects.filter(pk=cargo.rol_id).delete()


def roles_de_cargo(empresa) -> set[int]:
    return set(
        Cargo.objects.todas()
        .filter(empresa=empresa, rol__isnull=False)
        .values_list("rol_id", flat=True)
    )


def rol_que_corresponde(usuario, empresa):
    """El rol del cargo de la persona en esa empresa, o None."""
    perfil = (
        DatosDeContacto.objects.todas()
        .filter(empresa=empresa, usuario=usuario, cargo__isnull=False)
        .select_related("cargo")
        .first()
    )
    return perfil.cargo.rol_id if perfil and perfil.cargo.rol_id else None


def ajustar_membresia(membresia) -> None:
    """Deja en la membresía solo el rol de cargo que le corresponde (los demás
    roles, los personalizados, no se tocan)."""
    de_cargo = roles_de_cargo(membresia.empresa)
    actuales = set(membresia.roles.filter(pk__in=de_cargo).values_list("pk", flat=True))
    debido = rol_que_corresponde(membresia.usuario, membresia.empresa)
    sobran = actuales - {debido}
    if sobran:
        membresia.roles.remove(*sobran)
    if debido and debido not in actuales:
        membresia.roles.add(debido)


def sincronizar(empresa, usuarios=None) -> None:
    """Recalcula el rol de cargo de las personas de la empresa (o solo de
    `usuarios`)."""
    if empresa is None:
        return
    membresias = MembresiaEmpresa.objects.filter(empresa=empresa).select_related(
        "usuario", "empresa"
    )
    if usuarios is not None:
        membresias = membresias.filter(usuario__in=usuarios)
    for membresia in membresias:
        ajustar_membresia(membresia)
