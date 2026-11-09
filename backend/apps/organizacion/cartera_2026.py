"""El organigrama del área de Cartera (09/11/2026).

Lo pasó el área en una imagen:

    Jefe de Cartera · jefe: Gerente General
    ├ Coordinador de Cartera
    │ ├ Asistente de Cartera
    │ ├ Telecobrador
    │ └ Recaudador
    ├ Asistente de Cartera (3)
    ├ Asistente de Tesorería
    ├ Telecobrador (2)
    └ Recaudador

Cartera es un área propia bajo la Gerencia General, con su Jefatura
reportando al Gerente General (decisión del usuario, 09/11/2026), como TI o
LaarBox, que tampoco tienen Gerencia de Área. En local vivía dentro de
Financiero Administrativo: `cambiar` la pasa bajo la Gerencia General. Los
nombres «Jennifer Bailón» y «Belén Cuichán» se leían mal en la imagen; así los
confirmó el usuario. Repetirlo no cambia nada.
"""

from . import departamentos_del_organigrama, versiones
from .levantamientos import _unidad, levantar
from .models import UnidadOrganizacional
from .permisos_por_cargo import normalizar as _normal

UNIDAD = "Cartera"
PADRE = "Gerencia General"

MOTIVO = (
    "Organigrama del área de Cartera enviado por el área: unidad propia bajo la "
    "Gerencia General, con su Jefatura, Coordinación, asistentes, tesorería, "
    "telecobradores y recaudadores, y las personas de cada cargo."
)

#: clave → nombre, jefe (otra clave, o el nombre de un cargo de otra unidad),
#: plazas, cómo se llamaba antes (nombre, nombre de su jefe) y quiénes lo ocupan.
CARGOS = {
    "jefe": {
        "nombre": "Jefe de Cartera",
        "jefe": "Gerente General",
        "plazas": 1,
        "antes": [("Jefe de Cartera", "Jefe Financiero Administrativo")],
        "personas": [("Sara Fernanda", "Marroquín García")],
    },
    "coordinador": {
        "nombre": "Coordinador de Cartera",
        "jefe": "jefe",
        "plazas": 1,
        "antes": [],
        "personas": [("Margarita Cecilia", "Vélez Caicedo")],
    },
    "asistente_coordinacion": {
        "nombre": "Asistente de Cartera",
        "jefe": "coordinador",
        "plazas": 1,
        "antes": [],
        "personas": [("Irene Yesenia", "Sarcos Maruri")],
    },
    "telecobrador_coordinacion": {
        "nombre": "Telecobrador",
        "jefe": "coordinador",
        "plazas": 1,
        "antes": [],
        "personas": [("Cindy Carolina", "Valdez Muñoz")],
    },
    "recaudador_coordinacion": {
        "nombre": "Recaudador",
        "jefe": "coordinador",
        "plazas": 1,
        "antes": [],
        "personas": [("Miguel Ángel", "Pincay Arroyo")],
    },
    "asistente": {
        "nombre": "Asistente de Cartera",
        "jefe": "jefe",
        "plazas": 3,
        "antes": [],
        "personas": [
            ("Lorena Elizabeth", "Espinosa Tituaña"),
            ("Jennifer", "Bailón"),
            ("Lizbeth Rocío", "Gualotuña Haro"),
        ],
    },
    "tesoreria": {
        "nombre": "Asistente de Tesorería",
        "jefe": "jefe",
        "plazas": 1,
        "antes": [],
        "personas": [("Daniela Lorena", "Marroquín García")],
    },
    "telecobrador": {
        "nombre": "Telecobrador",
        "jefe": "jefe",
        "plazas": 2,
        "antes": [],
        "personas": [("Cindy Violeta", "Acosta Gualpa"), ("Belén", "Cuichán")],
    },
    "recaudador": {
        "nombre": "Recaudador",
        "jefe": "jefe",
        "plazas": 1,
        "antes": [],
        "personas": [("Willian Estuardo", "Sánchez Murillo")],
    },
}


def aplicar() -> list[str]:
    """Deja el área como dice el organigrama en la empresa activa y lo anota en
    la bitácora. Devuelve lo que cambió (vacío si ya estaba así)."""
    with versiones.sin_peticion(MOTIVO) as resultado:
        cambiar()
    return resultado["lineas"]


def _bajo_la_gerencia_general(unidad) -> None:
    """Si la unidad colgaba de otra (Financiero Administrativo, en local), la
    pasa bajo la Gerencia General, en el nivel de las otras áreas de ahí."""
    gerencia = next(
        (
            u
            for u in UnidadOrganizacional.objects.select_related("nivel")
            if _normal(u.nombre) == _normal(PADRE)
        ),
        None,
    )
    if gerencia is None or unidad.padre_id == gerencia.id:
        return
    hermana = (
        gerencia.hijas.exclude(id=unidad.id).select_related("nivel").order_by("orden", "id").first()
    )
    unidad.padre = gerencia
    if hermana is not None:
        unidad.nivel = hermana.nivel
    unidad.orden = gerencia.hijas.count()
    unidad.save(update_fields=["padre", "nivel", "orden", "updated_at"])
    departamentos_del_organigrama.sincronizar(unidad)


def cambiar() -> None:
    """Los cambios, sin anotarlos: los anota quien llama (`aplicar` o la
    migración)."""
    unidad = _unidad(UNIDAD, (), PADRE)
    if unidad is None:
        return
    _bajo_la_gerencia_general(unidad)
    levantar(UNIDAD, CARGOS, padre=PADRE)
