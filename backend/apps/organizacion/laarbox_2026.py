"""El organigrama del área LaarBox (27/10/2026).

Lo pasó el área en una imagen:

    Jefe de Producto Laarbox (Xavier Ullauri) · jefe: Gerente General
    ├ Coordinador de Aduana (Anthony Cabrera)
    │ ├ Supervisor COMEX (Gary Bravo)
    │ │ └ Declarante de Aduana (Shelleny Avellan, Kathy Nicolalde)
    │ │   └ Analista Operativo COMEX (por cubrir)
    │ └ Supervisor COMEX Temu (Marco Rodriguez)
    │   └ Declarante de Aduana (Dorys Torres, Josue Cedeño)
    ├ Supervisor Régimen Consumo (Evelyn Coyago)
    ├ Supervisor de Aduana (Hugo Ledesma)
    │ └ Auxiliar de Aduana (Marcelo Samaniego, Carlos Soto, Alexander Rodriguez)
    ├ Supervisor de Bodega (Diana Gavilanez)
    │ └ Mecanizador (22 plazas)
    └ Supervisor de Almacenaje (Edwin Taticuan)

Los cargos que ya existían se reconocen por su nombre y el de su jefe (hay dos
«Supervisor de Operaciones») y se renombran: conservan su rol, su perfil y
quienes los ocupan. Los que faltan se crean. Los que ya no están en el
organigrama (Auxiliar de Facturas, Auxiliar de Impuestos, Supervisor SAC…) se
desactivan si nadie los ocupa; si alguien los ocupa se quedan como estaban.

Lo aplica la migración 0033 y deja el cambio en la bitácora del organigrama,
con su respaldo para revertirlo. Repetirlo no cambia nada.
"""

from . import versiones
from .levantamientos import levantar

UNIDAD = "Producto Laarbox"

MOTIVO = (
    "Organigrama del área LaarBox enviado por el área: cargos con sus nombres "
    "nuevos, sus jefes y las personas de cada cargo; se desactivan los cargos "
    "que ya no están y nadie ocupa."
)

#: clave → nombre, jefe (otra clave, o el nombre de un cargo de otra unidad),
#: plazas, cómo se llamaba antes (nombre, nombre de su jefe) y quiénes lo ocupan.
CARGOS = {
    "jefe": {
        "nombre": "Jefe de Producto Laarbox",
        "jefe": "Gerente General",
        "plazas": 1,
        "antes": [("Jefe de Producto Laarbox", "Gerente General")],
        "personas": [("Xavier", "Ullauri")],
    },
    "coordinador": {
        "nombre": "Coordinador de Aduana",
        "jefe": "jefe",
        "plazas": 1,
        "antes": [("Coordinador de Aduana", "Jefe de Producto Laarbox")],
        "personas": [("Anthony", "Cabrera")],
    },
    "comex": {
        "nombre": "Supervisor COMEX",
        "jefe": "coordinador",
        "plazas": 1,
        "antes": [("Supervisor de Operaciones", "Coordinador de Aduana")],
        "personas": [("Gary", "Bravo")],
    },
    "declarante": {
        "nombre": "Declarante de Aduana",
        "jefe": "comex",
        "plazas": 2,
        "antes": [("Declarante Laarbox", "Supervisor de Operaciones")],
        "personas": [("Shelleny", "Avellan"), ("Kathy", "Nicolalde")],
    },
    "analista": {
        "nombre": "Analista Operativo COMEX",
        "jefe": "declarante",
        "plazas": 1,
        "antes": [],
        "personas": [],
    },
    "comex_temu": {
        "nombre": "Supervisor COMEX Temu",
        "jefe": "coordinador",
        "plazas": 1,
        "antes": [],
        "personas": [("Marco", "Rodriguez")],
    },
    "declarante_temu": {
        "nombre": "Declarante de Aduana",
        "jefe": "comex_temu",
        "plazas": 2,
        "antes": [("Declarante Temu", "Supervisor de Operaciones")],
        "personas": [("Dorys", "Torres"), ("Josue", "Cedeño")],
    },
    "consumo": {
        "nombre": "Supervisor Régimen Consumo",
        "jefe": "jefe",
        "plazas": 1,
        "antes": [],
        "personas": [("Evelyn", "Coyago")],
    },
    "aduana": {
        "nombre": "Supervisor de Aduana",
        "jefe": "jefe",
        "plazas": 1,
        "antes": [("Supervisor de Aduana", "Jefe de Producto Laarbox")],
        "personas": [("Hugo", "Ledesma")],
    },
    "auxiliar_aduana": {
        "nombre": "Auxiliar de Aduana",
        "jefe": "aduana",
        "plazas": 3,
        "antes": [("Auxiliar de Aduana", "Supervisor de Aduana")],
        "personas": [("Marcelo", "Samaniego"), ("Carlos", "Soto"), ("Alexander", "Rodriguez")],
    },
    "bodega": {
        "nombre": "Supervisor de Bodega",
        "jefe": "jefe",
        "plazas": 1,
        "antes": [("Supervisor de Operaciones", "Jefe de Producto Laarbox")],
        "personas": [("Diana", "Gavilanez")],
    },
    "mecanizador": {
        "nombre": "Mecanizador",
        "jefe": "bodega",
        "plazas": 22,
        "antes": [("Auxiliar de Mecanización", "Auxiliar de Operaciones")],
        "personas": [],
    },
    "almacenaje": {
        "nombre": "Supervisor de Almacenaje",
        "jefe": "jefe",
        "plazas": 1,
        "antes": [],
        "personas": [("Edwin", "Taticuan")],
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
    migración, que junta varias áreas en una sola versión)."""
    levantar(UNIDAD, CARGOS)
