"""El organigrama «Gestión de Talento Humano LCE 2026» (27/10/2026).

Gestión Humana pasó su organigrama estructural con nombres nuevos. Los cargos
son los mismos de antes (organigrama GGHH 2026), renombrados, así que cada uno
conserva su rol, sus permisos, su perfil y quienes lo ocupan:

    Gerente Gestión Humana (Cristina Granda) · jefe: Gerente General
    └ Jefe Nacional de Talento Humano y SSO
      ├ Salud Ocupacional (apoyo: María del Mar ZS, Martha Quintana ZN)
      └ Coordinador Nacional de GGHH
        ├ Analista de Selección
        │ ├ Asistente de GGHH (Melanie Bermello y Farid Maldonado)
        │ └ Asistente de Selección
        ├ Analista Clima y Cultura
        ├ Trabajo Social
        ├ Coordinador Gestión Humana Zona Sur
        │ └ Asistente Gestión Humana Zona Sur
        └ Jefe de Nómina (asesor externo en LCE)
          └ Asistente de Nómina

La unidad pasa a llamarse «Gestión de Talento Humano» y el Pasante de GGHH,
que no está en el organigrama nuevo, queda inactivo si nadie lo ocupa.

Lo aplica la migración 0033 en cada empresa que tenga la unidad, y deja el
cambio en la bitácora del organigrama (con su respaldo, para revertirlo). Se
puede repetir: lo que ya está como dice el organigrama no se toca.
"""

from . import departamentos_del_organigrama, roles_de_cargo, versiones
from .models import (
    Cargo,
    DatosDeContacto,
    OcupanteCargo,
    UnidadOrganizacional,
)
from .permisos_por_cargo import normalizar as _normal

UNIDAD = "Gestión de Talento Humano"
UNIDAD_ANTES = ("Gestión Humana y Seguridad Ocupacional",)

MOTIVO = (
    "Organigrama estructural «Gestión de Talento Humano LCE 2026» enviado por "
    "Gestión Humana: cargos con sus nombres nuevos, el Gerente General como "
    "jefe del Gerente Gestión Humana y las personas de cada cargo."
)

#: Nombre nuevo → nombres que tenía.
RENOMBRES = {
    "Gerente Gestión Humana": ("Gerenta de GGHH",),
    "Jefe Nacional de Talento Humano y SSO": ("Jefe de GGH y SSO",),
    "Analista de Selección": ("Reclutamiento y Selección",),
    "Analista Clima y Cultura": ("Desarrollo y Capacitación de Personal",),
    "Coordinador Gestión Humana Zona Sur": ("Coordinador Zona Sur",),
    "Asistente Gestión Humana Zona Sur": ("Asistente Zona Sur",),
}

#: Cargo → (su jefe, plazas mínimas). El Gerente General es de otra unidad.
ESTRUCTURA = {
    "Gerente Gestión Humana": ("Gerente General", 1),
    "Jefe Nacional de Talento Humano y SSO": ("Gerente Gestión Humana", 1),
    "Salud Ocupacional": ("Jefe Nacional de Talento Humano y SSO", 2),
    "Coordinador Nacional de GGHH": ("Jefe Nacional de Talento Humano y SSO", 1),
    "Analista de Selección": ("Coordinador Nacional de GGHH", 1),
    "Analista Clima y Cultura": ("Coordinador Nacional de GGHH", 1),
    "Trabajo Social": ("Coordinador Nacional de GGHH", 1),
    "Coordinador Gestión Humana Zona Sur": ("Coordinador Nacional de GGHH", 1),
    "Jefe de Nómina": ("Coordinador Nacional de GGHH", 1),
    "Asistente de GGHH": ("Analista de Selección", 2),
    "Asistente de Selección": ("Analista de Selección", 1),
    "Asistente Gestión Humana Zona Sur": ("Coordinador Gestión Humana Zona Sur", 1),
    "Asistente de Nómina": ("Jefe de Nómina", 1),
}

#: Quienes aparecen en el organigrama y no estaban: (nombres, apellidos).
PERSONAS = {
    "Gerente Gestión Humana": [("Cristina", "Granda")],
    "Asistente de GGHH": [("Farid", "Maldonado")],
}

#: Los que ya no están en el organigrama: se desactivan si nadie los ocupa.
SE_RETIRAN = ("Pasante de GGHH",)


def _ocupado(cargo) -> bool:
    return (
        cargo.ocupantes_sin_cuenta.exists() or DatosDeContacto.objects.filter(cargo=cargo).exists()
    )


def aplicar() -> list[str]:
    """Deja el área como dice el organigrama en la empresa activa y lo anota
    en la bitácora. Devuelve lo que cambió (vacío si ya estaba así)."""
    with versiones.sin_peticion(MOTIVO) as resultado:
        cambiar()
    return resultado["lineas"]


def cambiar() -> None:
    """Los cambios, sin anotarlos: los anota quien llama (`aplicar` o la
    migración, que junta varias áreas en una sola versión)."""
    nombres_unidad = {_normal(n) for n in (UNIDAD, *UNIDAD_ANTES)}
    unidad = next(
        (u for u in UnidadOrganizacional.objects.all() if _normal(u.nombre) in nombres_unidad),
        None,
    )
    if unidad is None:
        return

    if unidad.nombre != UNIDAD:
        unidad.nombre = UNIDAD
        unidad.save(update_fields=["nombre", "updated_at"])
        departamentos_del_organigrama.sincronizar(unidad)

    cargos = {_normal(c.nombre): c for c in Cargo.objects.filter(unidad=unidad)}
    for nuevo, anteriores in RENOMBRES.items():
        if _normal(nuevo) in cargos:
            continue
        for anterior in anteriores:
            cargo = cargos.pop(_normal(anterior), None)
            if cargo is not None:
                cargo.nombre = nuevo
                cargo.save(update_fields=["nombre", "updated_at"])
                cargos[_normal(nuevo)] = cargo
                break

    for nombre, (jefe, plazas) in ESTRUCTURA.items():
        cargo = cargos.get(_normal(nombre))
        if cargo is None:
            continue
        superior = cargos.get(_normal(jefe)) or (
            Cargo.objects.filter(nombre__iexact=jefe, activo=True).order_by("id").first()
        )
        campos = []
        if superior is not None and cargo.jefe_id != superior.id:
            cargo.jefe = superior
            campos.append("jefe")
        if cargo.plazas < plazas:
            cargo.plazas = plazas
            campos.append("plazas")
        if not cargo.activo:
            cargo.activo = True
            campos.append("activo")
        if campos:
            cargo.save(update_fields=[*campos, "updated_at"])

    for nombre, personas in PERSONAS.items():
        cargo = cargos.get(_normal(nombre))
        if cargo is None:
            continue
        for nombres, apellidos in personas:
            ya = (
                OcupanteCargo.objects.filter(
                    nombres__iexact=nombres, apellidos__iexact=apellidos
                ).exists()
                or DatosDeContacto.objects.filter(
                    usuario__first_name__iexact=nombres, usuario__last_name__iexact=apellidos
                ).exists()
            )
            if not ya:
                OcupanteCargo.objects.create(cargo=cargo, nombres=nombres, apellidos=apellidos)

    for nombre in SE_RETIRAN:
        cargo = cargos.get(_normal(nombre))
        if cargo is not None and cargo.activo and not _ocupado(cargo):
            if not cargo.subordinados.filter(activo=True).exists():
                cargo.activo = False
                cargo.save(update_fields=["activo", "updated_at"])

    # El rol de cada cargo se llama como él y lleva sus permisos.
    for cargo in Cargo.objects.filter(unidad=unidad).select_related("rol", "unidad", "empresa"):
        roles_de_cargo.asegurar_rol(cargo)
