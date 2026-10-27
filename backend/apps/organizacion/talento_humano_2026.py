"""El organigrama «Gestión de Talento Humano LCE 2026» (27/10/2026).

Gestión Humana pasó su organigrama estructural:

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

Donde el área ya existía (organigrama GGHH 2026) los cargos se renombran y
conservan su rol, sus permisos, su perfil y quienes los ocupan; donde no
existía (producción) se crea bajo la Gerencia General. La unidad se llama
«Gestión de Talento Humano». El Pasante de GGHH, que no está en el
organigrama, queda inactivo si nadie lo ocupa. Ver `levantamientos.levantar`.
"""

from . import versiones
from .levantamientos import levantar

UNIDAD = "Gestión de Talento Humano"
UNIDAD_ANTES = ("Gestión Humana y Seguridad Ocupacional",)

MOTIVO = (
    "Organigrama estructural «Gestión de Talento Humano LCE 2026» enviado por "
    "Gestión Humana: cargos con sus nombres nuevos, el Gerente General como "
    "jefe del Gerente Gestión Humana y las personas de cada cargo."
)


def _cargo(nombre, jefe, plazas, antes=(), personas=()):
    return {
        "nombre": nombre,
        "jefe": jefe,
        "plazas": plazas,
        "antes": list(antes),
        "personas": list(personas),
    }


#: Ver `laarbox_2026.CARGOS`. Los «antes» son los nombres del organigrama
#: GGHH 2026 (nombre del cargo, nombre de su jefe).
CARGOS = {
    "gerente": _cargo(
        "Gerente Gestión Humana",
        "Gerente General",
        1,
        [("Gerenta de GGHH", "Gerente General")],
        [("Cristina", "Granda")],
    ),
    "jefe": _cargo(
        "Jefe Nacional de Talento Humano y SSO",
        "gerente",
        1,
        [("Jefe de GGH y SSO", "Gerenta de GGHH")],
        [("Marco Vinicio", "Caguana Jácome")],
    ),
    "salud": _cargo(
        "Salud Ocupacional",
        "jefe",
        2,
        [("Salud Ocupacional", "Jefe de GGH y SSO")],
        [("María del Mar", "(Zona Sur)"), ("Martha", "Quintana (Zona Norte)")],
    ),
    "coordinador": _cargo(
        "Coordinador Nacional de GGHH",
        "jefe",
        1,
        [("Coordinador Nacional de GGHH", "Jefe de GGH y SSO")],
        [("Antonhy", "Jácome")],
    ),
    "seleccion": _cargo(
        "Analista de Selección",
        "coordinador",
        1,
        [("Reclutamiento y Selección", "Coordinador Nacional de GGHH")],
        [("Silvia Nataly", "Reino Sánchez")],
    ),
    "clima": _cargo(
        "Analista Clima y Cultura",
        "coordinador",
        1,
        [("Desarrollo y Capacitación de Personal", "Coordinador Nacional de GGHH")],
        [("Tamara", "Maldonado")],
    ),
    "social": _cargo(
        "Trabajo Social",
        "coordinador",
        1,
        [],
        [("Verónica Edith", "Salazar Fernández")],
    ),
    "zona_sur": _cargo(
        "Coordinador Gestión Humana Zona Sur",
        "coordinador",
        1,
        [("Coordinador Zona Sur", "Coordinador Nacional de GGHH")],
        [("Fernando Leonardo", "Peralta Ramírez")],
    ),
    "nomina": _cargo(
        "Jefe de Nómina",
        "coordinador",
        1,
        [],
        [("Elsi", "Maldonado")],
    ),
    "asistente": _cargo(
        "Asistente de GGHH",
        "seleccion",
        2,
        [("Asistente de GGHH", "Reclutamiento y Selección")],
        [("Melanie Andrea", "Bermello Marcillo"), ("Farid", "Maldonado")],
    ),
    "asistente_seleccion": _cargo(
        "Asistente de Selección",
        "seleccion",
        1,
        [("Asistente de Selección", "Reclutamiento y Selección")],
        [("Stalin Alejandro", "Caiza Suquillo")],
    ),
    "asistente_sur": _cargo(
        "Asistente Gestión Humana Zona Sur",
        "zona_sur",
        1,
        [("Asistente Zona Sur", "Coordinador Zona Sur")],
        [("Johanna", "Peralta")],
    ),
    "asistente_nomina": _cargo(
        "Asistente de Nómina",
        "nomina",
        1,
        [],
        [("Madelyn Cristina", "Hurtado Montalvo")],
    ),
}


def aplicar() -> list[str]:
    """Deja el área como dice el organigrama en la empresa activa y lo anota
    en la bitácora. Devuelve lo que cambió (vacío si ya estaba así)."""
    with versiones.sin_peticion(MOTIVO) as resultado:
        cambiar()
    return resultado["lineas"]


def cambiar() -> None:
    """Los cambios, sin anotarlos (ver `laarbox_2026.cambiar`)."""
    levantar(UNIDAD, CARGOS, nombres_anteriores=UNIDAD_ANTES)
