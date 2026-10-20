"""Los roles del sistema que salen de los niveles del organigrama
(20/10/2026).

Cada nivel jerárquico de una empresa tiene su rol («LaarCourier · Gerencia /
Jefatura»), que nace sin permisos: se le marcan en Configuración → Roles
como a cualquier otro. Se crea, se renombra y se borra junto con su nivel.

Quien ocupa un cargo recibe, en su membresía de esa empresa, el rol del nivel
de la unidad de su cargo; si cambia de cargo (o el cargo cambia de unidad, o
la unidad de nivel), cambia de rol solo. Los roles personalizados se siguen
asignando a mano y se suman a este.
"""

from django.contrib.auth.models import Group
from django.db import transaction

from apps.empresas.models import MembresiaEmpresa

from .models import DatosDeContacto, NivelJerarquico


def nombre_del_rol(nivel) -> str:
    return f"{nivel.empresa.nombre} · {nivel.nombre}"[:150]


def _libre(nombre: str, excepto=None) -> str:
    """El nombre, o con un número si otro rol ya lo usa."""
    candidato, n = nombre, 2
    while (
        Group.objects.filter(name__iexact=candidato)
        .exclude(pk=getattr(excepto, "pk", None))
        .exists()
    ):
        candidato = f"{nombre} ({n})"[:150]
        n += 1
    return candidato


@transaction.atomic
def asegurar_rol(nivel) -> Group:
    """Crea el rol del nivel, o lo renombra si el nivel cambió de nombre."""
    nombre = nombre_del_rol(nivel)
    if nivel.rol_id is None:
        rol = Group.objects.create(name=_libre(nombre))
        NivelJerarquico.objects.todas().filter(pk=nivel.pk).update(rol=rol)
        nivel.rol = rol
        return rol
    rol = nivel.rol
    if not rol.name.startswith(nombre):
        rol.name = _libre(nombre, excepto=rol)
        rol.save(update_fields=["name"])
    return rol


def borrar_rol(nivel) -> None:
    if nivel.rol_id:
        Group.objects.filter(pk=nivel.rol_id).delete()


def roles_de_nivel(empresa) -> set[int]:
    return set(
        NivelJerarquico.objects.todas()
        .filter(empresa=empresa, rol__isnull=False)
        .values_list("rol_id", flat=True)
    )


def rol_que_corresponde(usuario, empresa):
    """El rol del nivel del cargo de la persona en esa empresa, o None."""
    perfil = (
        DatosDeContacto.objects.todas()
        .filter(empresa=empresa, usuario=usuario, cargo__isnull=False)
        .select_related("cargo__unidad__nivel")
        .first()
    )
    unidad = perfil.cargo.unidad if perfil and perfil.cargo.unidad_id else None
    return unidad.nivel.rol_id if unidad and unidad.nivel.rol_id else None


def ajustar_membresia(membresia) -> None:
    """Deja en la membresía solo el rol de nivel que le corresponde (los
    demás roles, los personalizados, no se tocan)."""
    de_nivel = roles_de_nivel(membresia.empresa)
    if not de_nivel:
        return
    actuales = set(membresia.roles.filter(pk__in=de_nivel).values_list("pk", flat=True))
    debido = rol_que_corresponde(membresia.usuario, membresia.empresa)
    sobran = actuales - {debido}
    if sobran:
        membresia.roles.remove(*sobran)
    if debido and debido not in actuales:
        membresia.roles.add(debido)


def sincronizar(empresa, usuarios=None) -> None:
    """Recalcula el rol de nivel de las personas de la empresa (o solo de
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
