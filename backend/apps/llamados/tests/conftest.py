"""El escenario de los llamados de atención (US-013).

Organigrama de «Empresa de pruebas»:

    Gerente General (Gerardo)
    ├── Jefa de Cartera (Julia, `solicitar`)
    │   └── Analista de Cartera (Ana Peñafiel, ana@grupolaar.com)
    └── Jefe de Operaciones (Óscar, `solicitar`)
        └── Operador (Olga)

Fuera del organigrama: Carolina (Gestión Humana: ver, emitir y configurar),
Víctor (solo `ver`) y Nadia (sin permisos de llamados).

Una causa «Atrasos reiterados» con tres niveles (verbal sin correo, escrito con
correo y sanción económica con 25 USD sugeridos) y un plazo de 12 meses.
"""

from datetime import timedelta

import pytest

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.licencias.tests.test_licencias import _persona
from apps.llamados import services
from apps.llamados.models import CausaLlamado, NivelLlamado
from apps.organizacion.models import Cargo, NivelJerarquico, UnidadOrganizacional

BASE = "/api/v1/llamados/"
CAUSAS = f"{BASE}causas/"
LLAMADOS = f"{BASE}llamados/"
PROPUESTA = f"{BASE}propuesta/"
PERSONAS = f"{BASE}personas/"
MIOS = f"{BASE}mios/"
VARIABLES = f"{BASE}variables/"
VISTA_PREVIA = f"{BASE}vista-previa/"

GH = ("llamados.ver", "llamados.emitir", "llamados.configurar")


def crear_causa(nombre="Atrasos reiterados", meses=12):
    causa = CausaLlamado.objects.create(nombre=nombre, meses_reincidencia=meses)
    niveles = [
        NivelLlamado.objects.create(
            causa=causa,
            orden=1,
            nombre="Primer llamado (verbal)",
            tipo="verbal",
            envia_correo=False,
        ),
        NivelLlamado.objects.create(
            causa=causa,
            orden=2,
            nombre="Segundo llamado (escrito)",
            tipo="escrito",
            envia_correo=True,
            asunto="Llamado de atención: {causa}",
            cuerpo=(
                "Estimado(a) {{nombre_completo}}:\n\nPor la causa {causa}, el "
                "{fecha_hecho}.\nDetalle: {descripcion}\n\nAtentamente,\n{emitido_por}"
            ),
        ),
        NivelLlamado.objects.create(
            causa=causa,
            orden=3,
            nombre="Sanción económica",
            tipo="sancion_economica",
            envia_correo=True,
            asunto="Sanción económica: {causa}",
            cuerpo="{nombre}: se aplica una sanción de USD {monto}.",
            monto_sugerido="25.00",
        ),
    ]
    return causa, niveles


@pytest.fixture
def e(db, django_capture_on_commit_callbacks):
    with usando_empresa(empresa_actual()):
        nivel = NivelJerarquico.objects.create(nombre="Gerencia", orden=1)
        unidad = UnidadOrganizacional.objects.create(nombre="Cartera", nivel=nivel)
        gg = Cargo.objects.create(nombre="Gerente General", unidad=unidad)
        jefa = Cargo.objects.create(nombre="Jefa de Cartera", unidad=unidad, jefe=gg)
        analista = Cargo.objects.create(nombre="Analista de Cartera", unidad=unidad, jefe=jefa)
        jefe_op = Cargo.objects.create(nombre="Jefe de Operaciones", unidad=unidad, jefe=gg)
        operador = Cargo.objects.create(nombre="Operador", unidad=unidad, jefe=jefe_op)
    datos = {
        "gerardo": _persona("gerardo", "llamados.solicitar", cargo=gg),
        "julia": _persona("julia", "llamados.solicitar", cargo=jefa),
        "ana": _persona("ana", cargo=analista),
        "oscar": _persona("oscar", "llamados.solicitar", cargo=jefe_op),
        "olga": _persona("olga", cargo=operador),
        "carolina": _persona("carolina", *GH),
        "victor": _persona("victor", "llamados.ver"),
        "nadia": _persona("nadia"),
    }
    ana = datos["ana"][0]
    ana.first_name, ana.last_name = "Ana María", "Peñafiel"
    ana.save(update_fields=["first_name", "last_name"])
    causa, niveles = crear_causa()
    datos.update(
        {
            "causa": causa,
            "niveles": niveles,
            "cargos": {"jefa": jefa, "gg": gg},
            # El correo sale tras el commit (`transaction.on_commit`); en las
            # pruebas, la transacción no se confirma: esto corre lo programado.
            "tras_commit": django_capture_on_commit_callbacks,
        }
    )
    return datos


def cliente(e, nombre):
    return e[nombre][1]


def usuario(e, nombre):
    return e[nombre][0]


def hace(dias=0):
    """La fecha de hace `dias` días, en ISO."""
    return (services.hoy() - timedelta(days=dias)).isoformat()


def emitir(e, quien="carolina", persona="ana", formato="json", **extra):
    """POST llamados/ con lo mínimo; `extra` agrega o reemplaza campos."""
    datos = {
        "persona": usuario(e, persona).pk,
        "causa": e["causa"].pk,
        "fecha_hecho": hace(7),
        "descripcion": "Llegó tarde tres veces en la semana.",
        **extra,
    }
    with e["tras_commit"](execute=True):
        return cliente(e, quien).post(LLAMADOS, datos, format=formato)


def accion(e, quien, llamado_id, nombre_accion, datos=None):
    """POST llamados/<id>/<accion>/, corriendo lo programado tras el commit."""
    with e["tras_commit"](execute=True):
        return cliente(e, quien).post(
            f"{LLAMADOS}{llamado_id}/{nombre_accion}/", datos or {}, format="json"
        )


def releer(e, llamado_id, quien="carolina"):
    """El detalle de nuevo: en las pruebas el correo sale al cerrar la captura
    de `on_commit`, después de armada la respuesta del POST."""
    respuesta = cliente(e, quien).get(f"{LLAMADOS}{llamado_id}/")
    assert respuesta.status_code == 200, respuesta.content
    return respuesta.json()


def codigo(respuesta):
    return respuesta.json()["error"]["code"]


def detalles(respuesta):
    return respuesta.json()["error"].get("details") or {}
