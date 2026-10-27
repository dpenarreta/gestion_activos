"""El organigrama del área de Procesos y Proyectos (27/10/2026).

    Gerencia de Procesos y Proyectos: la lleva el Gerente General
    └ Jefe de Procesos y Mejora Continua · jefe: Gerente General
      ├ Analista de Procesos y Mejora Continua
      ├ Asistente de Procesos y Mejora Continua
      ├ Auditor de Procesos Zona Norte
      └ Auditor de Procesos Zona Sur

El Gerente de Procesos y Proyectos es siempre el Gerente General: como una
persona ocupa un solo cargo, el Jefe de Procesos le reporta directamente y el
cargo aparte «Gerente de Procesos y Proyectos» se desactiva (si nadie lo
ocupa). Ver `levantamientos.levantar`.
"""

from . import versiones
from .levantamientos import levantar

UNIDAD = "Procesos y Proyectos"

MOTIVO = (
    "Organigrama del área de Procesos y Proyectos: la gerencia la lleva el "
    "Gerente General, a quien reporta el Jefe de Procesos y Mejora Continua; "
    "entran los auditores de procesos de las zonas norte y sur."
)

CARGOS = {
    "jefe": {
        "nombre": "Jefe de Procesos y Mejora Continua",
        "jefe": "Gerente General",
        "plazas": 1,
        "antes": [("Jefe de Procesos y Mejora Continua", "Gerente de Procesos y Proyectos")],
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
