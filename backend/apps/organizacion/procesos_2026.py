"""El organigrama del área de Procesos y Proyectos (27/10/2026).

    Gerente de Procesos y Proyectos · jefe: Gerente General
    └ Jefe de Procesos y Mejora Continua
      ├ Analista de Procesos y Mejora Continua
      ├ Asistente de Procesos y Mejora Continua
      ├ Auditor de Procesos Zona Norte
      └ Auditor de Procesos Zona Sur

Ver `levantamientos.levantar`.
"""

from . import versiones
from .levantamientos import levantar

UNIDAD = "Procesos y Proyectos"

MOTIVO = (
    "Organigrama del área de Procesos y Proyectos: el Gerente de Procesos y "
    "Proyectos reporta al Gerente General y el Jefe de Procesos y Mejora "
    "Continua, a él; entran los auditores de procesos de las zonas norte y sur."
)

CARGOS = {
    "gerente": {
        "nombre": "Gerente de Procesos y Proyectos",
        "jefe": "Gerente General",
        "plazas": 1,
        "antes": [],
        "personas": [],
    },
    "jefe": {
        "nombre": "Jefe de Procesos y Mejora Continua",
        "jefe": "gerente",
        "plazas": 1,
        # Una versión anterior de este levantamiento lo colgó del Gerente General.
        "antes": [("Jefe de Procesos y Mejora Continua", "Gerente General")],
        "personas": [],
    },
    "analista": {
        "nombre": "Analista de Procesos y Mejora Continua",
        "jefe": "jefe",
        "plazas": 1,
        "antes": [("Analista de Procesos y Mejora", "Jefe de Procesos y Mejora Continua")],
        "personas": [],
    },
    "asistente": {
        "nombre": "Asistente de Procesos y Mejora Continua",
        "jefe": "jefe",
        "plazas": 1,
        "antes": [("Asistente de Procesos", "Jefe de Procesos y Mejora Continua")],
        "personas": [],
    },
    "auditor_norte": {
        "nombre": "Auditor de Procesos Zona Norte",
        "jefe": "jefe",
        "plazas": 1,
        "antes": [],
        "personas": [],
    },
    "auditor_sur": {
        "nombre": "Auditor de Procesos Zona Sur",
        "jefe": "jefe",
        "plazas": 1,
        "antes": [],
        "personas": [],
    },
}


def aplicar() -> list[str]:
    """Deja el área como dice el organigrama en la empresa activa y lo anota
    en la bitácora. Devuelve lo que cambió (vacío si ya estaba así)."""
    with versiones.sin_peticion(MOTIVO) as resultado:
        cambiar()
    return resultado["lineas"]


def cambiar() -> None:
    """Los cambios, sin anotarlos (ver `laarbox_2026.cambiar`)."""
    levantar(UNIDAD, CARGOS)
