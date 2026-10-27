"""El organigrama del área Comercial, con la División UPS (27/10/2026).

Lo pasó el área en dos imágenes. La estructura del área:

    Gerente Comercial (Stalin Vera) · jefe: Gerente General
    ├ Jefe Comercial Quito (Saida Rodríguez)
    │ ├ Asesor Comercial (5)
    │ └ Gestora Comercial (1)
    ├ Jefe Comercial Guayaquil (Enrique Pillasagua)
    │ ├ Asesor Comercial (5)
    │ └ Gestora Comercial (2)
    ├ Jefe Comercial Cuenca (Patricia Delgado)
    │ ├ Asesor Comercial (5, con Santo Domingo)
    │ └ Gestora Comercial (1)
    ├ Internacional UPS, reporte directo a la Gerencia:
    │ Asesor Comercial UPS Quito (3), Asesor Comercial UPS Guayaquil (1)
    │ y Asistente Comercial UPS Guayaquil (1)
    └ Televentas, reporte directo: Asesora de Televentas (2, Quito y Cuenca)

Y la División UPS, que coordina el servicio:

    Coordinador Servicio UPS · jefe: Gerente Comercial
    ├ Supervisor Operaciones UPS Quito (División OPE)
    │ ├ Courier UPS (3)
    │ └ Auxiliar Operativo UPS Quito (2)
    ├ Supervisor Administrativo UPS Quito (División ADM)
    ├ Supervisor Operaciones UPS Guayaquil (División OPE)
    │ └ Auxiliar Operativo UPS Guayaquil (3)
    ├ Asesora de Servicio al Cliente UPS (5, SAC)
    └ Asistente de Facturación y Cartera UPS (3, Financiero)

Los equipos de antes se reconocen por su nombre y el de su jefe: el
Coordinador Comercial pasa a Jefe Comercial Quito, el Jefe de Ventas a Jefe
Comercial Guayaquil y el Asesor Comercial que encabezaba un equipo a Jefe
Comercial Cuenca; sus asistentes pasan a Gestora Comercial. Los que ya no
están (Courier Motorizado, Asistente de Operaciones, un Televendedor) se
desactivan si nadie los ocupa.

Lo aplica la migración 0040 y deja el cambio en la bitácora del organigrama,
con su respaldo para revertirlo. Repetirlo no cambia nada.
"""

from . import versiones
from .levantamientos import levantar

UNIDAD = "Comercial"

MOTIVO = (
    "Organigrama del área Comercial enviado por el área: jefes comerciales de "
    "Quito, Guayaquil y Cuenca, Internacional UPS y Televentas con reporte "
    "directo a la Gerencia, y la División UPS bajo su Coordinador; se "
    "desactivan los cargos que ya no están y nadie ocupa."
)

#: clave → nombre, jefe (otra clave, o el nombre de un cargo de otra unidad),
#: plazas, cómo se llamaba antes (nombre, nombre de su jefe) y quiénes lo ocupan.
CARGOS = {
    "gerente": {
        "nombre": "Gerente Comercial",
        "jefe": "Gerente General",
        "plazas": 1,
        "antes": [],
        "personas": [("Stalin", "Vera")],
    },
    # Quito
    "jefe_uio": {
        "nombre": "Jefe Comercial Quito",
        "jefe": "gerente",
        "plazas": 1,
        "antes": [("Coordinador Comercial", "Gerente Comercial")],
        "personas": [("Saida", "Rodríguez")],
    },
    "asesor_uio": {
        "nombre": "Asesor Comercial",
        "jefe": "jefe_uio",
        "plazas": 5,
        "antes": [("Asesor Comercial", "Coordinador Comercial")],
        "personas": [],
    },
    "gestora_uio": {
        "nombre": "Gestora Comercial",
        "jefe": "jefe_uio",
        "plazas": 1,
        "antes": [("Asistente Comercial", "Coordinador Comercial")],
        "personas": [],
    },
    # Guayaquil
    "jefe_gye": {
        "nombre": "Jefe Comercial Guayaquil",
        "jefe": "gerente",
        "plazas": 1,
        "antes": [("Jefe de Ventas", "Gerente Comercial")],
        "personas": [("Enrique", "Pillasagua")],
    },
    "asesor_gye": {
        "nombre": "Asesor Comercial",
        "jefe": "jefe_gye",
        "plazas": 5,
        "antes": [("Asesor Comercial", "Jefe de Ventas")],
        "personas": [],
    },
    "gestora_gye": {
        "nombre": "Gestora Comercial",
        "jefe": "jefe_gye",
        "plazas": 2,
        "antes": [("Asistente Comercial", "Jefe de Ventas")],
        "personas": [],
    },
    # Cuenca (sus asesores incluyen Santo Domingo)
    "jefe_cue": {
        "nombre": "Jefe Comercial Cuenca",
        "jefe": "gerente",
        "plazas": 1,
        "antes": [("Asesor Comercial", "Gerente Comercial")],
        "personas": [("Patricia", "Delgado")],
    },
    "asesor_cue": {
        "nombre": "Asesor Comercial",
        "jefe": "jefe_cue",
        "plazas": 5,
        "antes": [("Asesor Comercial", "Asesor Comercial")],
        "personas": [],
    },
    "gestora_cue": {
        "nombre": "Gestora Comercial",
        "jefe": "jefe_cue",
        "plazas": 1,
        "antes": [("Asistente Comercial", "Asesor Comercial")],
        "personas": [],
    },
    # Internacional UPS: reporte directo a la Gerencia
    "asesor_ups_uio": {
        "nombre": "Asesor Comercial UPS Quito",
        "jefe": "gerente",
        "plazas": 3,
        "antes": [("Asesor Comercial UPS", "Gerente Comercial")],
        "personas": [],
    },
    "asesor_ups_gye": {
        "nombre": "Asesor Comercial UPS Guayaquil",
        "jefe": "gerente",
        "plazas": 1,
        "antes": [("Asesor Comercial UPS (GYE)", "Gerente Comercial")],
        "personas": [],
    },
    "asistente_ups_gye": {
        "nombre": "Asistente Comercial UPS Guayaquil",
        "jefe": "gerente",
        "plazas": 1,
        "antes": [],
        "personas": [],
    },
    # Televentas: nueva estructura, reporte directo
    "televentas": {
        "nombre": "Asesora de Televentas",
        "jefe": "gerente",
        "plazas": 2,
        "antes": [("Televendedor", "Coordinador Comercial")],
        "personas": [],
    },
    # División UPS
    "coordinador_ups": {
        "nombre": "Coordinador Servicio UPS",
        "jefe": "gerente",
        "plazas": 1,
        "antes": [("Coordinador de Servicio UPS", "Gerente Comercial")],
        "personas": [],
    },
    "supervisor_ope_uio": {
        "nombre": "Supervisor Operaciones UPS Quito",
        "jefe": "coordinador_ups",
        "plazas": 1,
        "antes": [("Supervisor de Operaciones UPS", "Coordinador de Servicio UPS")],
        "personas": [],
    },
    "courier": {
        "nombre": "Courier UPS",
        "jefe": "supervisor_ope_uio",
        "plazas": 3,
        "antes": [("Courier UPS", "Supervisor de Operaciones UPS")],
        "personas": [],
    },
    "auxiliar_uio": {
        "nombre": "Auxiliar Operativo UPS Quito",
        "jefe": "supervisor_ope_uio",
        "plazas": 2,
        "antes": [("Auxiliar Operativo", "Coordinador de Servicio UPS")],
        "personas": [],
    },
    "supervisor_adm_uio": {
        "nombre": "Supervisor Administrativo UPS Quito",
        "jefe": "coordinador_ups",
        "plazas": 1,
        "antes": [],
        "personas": [],
    },
    "supervisor_ope_gye": {
        "nombre": "Supervisor Operaciones UPS Guayaquil",
        "jefe": "coordinador_ups",
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
        "jefe": "coordinador_ups",
        "plazas": 5,
        "antes": [("Asistente Servicio al Cliente", "Coordinador de Servicio UPS")],
        "personas": [],
    },
    "facturacion": {
        "nombre": "Asistente de Facturación y Cartera UPS",
        "jefe": "coordinador_ups",
        "plazas": 3,
        "antes": [("Asistente de Facturación UPS", "Supervisor de Operaciones UPS")],
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
    """Los cambios, sin anotarlos: los anota quien llama (`aplicar` o la
    migración)."""
    levantar(UNIDAD, CARGOS)
