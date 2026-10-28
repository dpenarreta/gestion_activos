"""El organigrama de la División UPS (28/10/2026).

Lo pasó el área en una imagen:

    Coordinador Servicio UPS · jefe: Gerente General
    ├ Supervisor Operaciones UPS Quito (División OPE)
    │ ├ Courier UPS (3)
    │ └ Auxiliar Operativo UPS Quito (2)
    ├ Supervisor Administrativo UPS Quito (División ADM)
    ├ Supervisor Operaciones UPS Guayaquil (División OPE)
    │ └ Auxiliar Operativo UPS Guayaquil (3)
    ├ Asesora de Servicio al Cliente UPS (5, SAC)
    └ Asistente de Facturación y Cartera UPS (3, Financiero)

El equipo comercial de UPS (ejecutivos de negocios y su asistente) no va
aquí: es Internacional UPS del área Comercial (`comercial_2026`), que
reporta directo al Gerente Comercial; en la imagen, el Gerente Comercial
queda aparte, con línea punteada solo hacia ellos.

La división vivía dentro del área Comercial (el usuario la quiso fuera el
28/10/2026: el área Comercial es solo lo de su imagen). `cambiar` crea la
unidad bajo la Gerencia General, le pasa los cargos del Coordinador para
abajo (con su rol, su perfil y quienes los ocupan) y la deja como dice el
organigrama. Repetirlo no cambia nada.
"""

from . import versiones
from .levantamientos import _unidad, levantar
from .models import Cargo
from .permisos_por_cargo import normalizar as _normal

UNIDAD = "División UPS"

#: Los cargos que estaban en el área Comercial y son de la división: el
#: Coordinador, con todo lo que le reporta.
DE_COMERCIAL = ("Coordinador Servicio UPS",)

MOTIVO = (
    "Organigrama de la División UPS enviado por el área: se separa del área "
    "Comercial como unidad propia bajo la Gerencia General, con su "
    "Coordinador, operaciones de Quito y Guayaquil, SAC y facturación y "
    "cartera."
)

#: clave → nombre, jefe (otra clave, o el nombre de un cargo de otra unidad),
#: plazas, cómo se llamaba antes (nombre, nombre de su jefe) y quiénes lo ocupan.
CARGOS = {
    "coordinador": {
        "nombre": "Coordinador Servicio UPS",
        "jefe": "Gerente General",
        "plazas": 1,
        "antes": [("Coordinador Servicio UPS", "Gerente Comercial")],
        "personas": [],
    },
    "supervisor_ope_uio": {
        "nombre": "Supervisor Operaciones UPS Quito",
        "jefe": "coordinador",
        "plazas": 1,
        "antes": [],
        "personas": [],
    },
    "courier": {
        "nombre": "Courier UPS",
        "jefe": "supervisor_ope_uio",
        "plazas": 3,
        "antes": [],
        "personas": [],
    },
    "auxiliar_uio": {
        "nombre": "Auxiliar Operativo UPS Quito",
        "jefe": "supervisor_ope_uio",
        "plazas": 2,
        "antes": [],
        "personas": [],
    },
    "supervisor_adm_uio": {
        "nombre": "Supervisor Administrativo UPS Quito",
        "jefe": "coordinador",
        "plazas": 1,
        "antes": [],
        "personas": [],
    },
    "supervisor_ope_gye": {
        "nombre": "Supervisor Operaciones UPS Guayaquil",
        "jefe": "coordinador",
        "plazas": 1,
        "antes": [],
        "personas": [],
    },
    "auxiliar_gye": {
        "nombre": "Auxiliar Operativo UPS Guayaquil",
        "jefe": "supervisor_ope_gye",
        "plazas": 3,
        "antes": [],
        "personas": [],
    },
    "sac": {
        "nombre": "Asesora de Servicio al Cliente UPS",
        "jefe": "coordinador",
        "plazas": 5,
        "antes": [],
        "personas": [],
    },
    "facturacion": {
        "nombre": "Asistente de Facturación y Cartera UPS",
        "jefe": "coordinador",
        "plazas": 3,
        "antes": [],
        "personas": [],
    },
}


def aplicar() -> list[str]:
    """Deja la división como dice el organigrama en la empresa activa y lo
    anota en la bitácora. Devuelve lo que cambió (vacío si ya estaba así)."""
    with versiones.sin_peticion(MOTIVO) as resultado:
        cambiar()
    return resultado["lineas"]


def _traer_de_comercial(unidad) -> None:
    """Pasa a la división los cargos que estaban en el área Comercial: el
    Coordinador con todo lo que le reporta."""
    buscados = {_normal(n) for n in DE_COMERCIAL}
    pendientes = [
        c
        for c in Cargo.objects.filter(unidad__nombre__iexact="Comercial")
        if _normal(c.nombre) in buscados
    ]
    while pendientes:
        cargo = pendientes.pop()
        if cargo.unidad_id != unidad.id:
            cargo.unidad = unidad
            cargo.save(update_fields=["unidad", "updated_at"])
        pendientes.extend(cargo.subordinados.exclude(unidad=unidad))


def cambiar() -> None:
    """Los cambios, sin anotarlos: los anota quien llama (`aplicar` o la
    migración)."""
    unidad = _unidad(UNIDAD, (), "Gerencia General")
    if unidad is None:
        return
    _traer_de_comercial(unidad)
    levantar(UNIDAD, CARGOS)
