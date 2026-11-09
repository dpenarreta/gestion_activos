"""`manage.py importar_nexo_consentimiento`: los consentimientos dados en Nexo.

Sin base de Nexo: el comando recibe un lector en memoria con los mismos métodos
que `LectorNexoConsentimientoSQL`. Los correos son ficticios.
"""

import copy
from datetime import UTC, datetime
from io import StringIO

import pytest
from django.core.management import CommandError, call_command

from apps.empresas.contexto import empresa_actual
from apps.novedades.nexo.comun import ErrorDeNexo
from apps.privacidad import consentimiento
from apps.privacidad.models import AceptacionAviso, AvisoPrivacidad
from apps.privacidad.nexo.importador import NO_SE_MIGRA
from apps.privacidad.nexo.lector_consentimiento import TABLAS, LectorNexoConsentimientoSQL
from apps.users.models import User

pytestmark = pytest.mark.django_db

ANA, NINO, PRUEBAS, SIN_FECHA = 9121, 9122, 9150, 9160
USUARIOS_NEXO = [
    {"id": ANA, "username": "ana", "email": "Ana.Nunez@Example.com"},
    {"id": NINO, "username": "nino", "email": "nino.noboa@example.com"},
    {"id": PRUEBAS, "username": "pruebas", "email": "pruebas@example.com"},
    {"id": SIN_FECHA, "username": "sinfecha", "email": "sin.fecha@example.com"},
]


def t(mes, dia, hora=15):
    return datetime(2026, mes, dia, hora, tzinfo=UTC)


def _aceptacion(uid, momento):
    u = next(u for u in USUARIOS_NEXO if u["id"] == uid)
    return {**u, "data_consent_accepted_at": momento}


def datos_nexo():
    return {
        "aceptacion": [
            _aceptacion(ANA, t(8, 20)),
            _aceptacion(NINO, t(9, 5)),
            _aceptacion(PRUEBAS, t(9, 6)),
            _aceptacion(SIN_FECHA, None),
        ],
        "texto": [
            # Desde el 02/09 el texto se editó en Nexo.
            {
                "id": 1,
                "value": "Texto editado en Nexo.",
                "valid_from": t(9, 2),
                "valid_until": None,
            },
        ],
    }


class LectorEnMemoria:
    def __init__(self, datos=None):
        self.datos = datos if datos is not None else datos_nexo()

    def filas(self, tabla):
        return copy.deepcopy(sorted(self.datos[tabla], key=lambda f: f["id"]))

    def usuarios(self, ids):
        ids = set(ids)
        return [
            {k: u[k] for k in ("id", "username", "email")} for u in USUARIOS_NEXO if u["id"] in ids
        ]

    def conteos(self):
        return {tabla: len(filas) for tabla, filas in self.datos.items()}


@pytest.fixture
def cuentas():
    return {
        ANA: User.objects.create_user(username="anunez", email="ana.nunez@example.com"),
        NINO: User.objects.create_user(username="nnoboa", email="nino.noboa@example.com"),
        PRUEBAS: User.objects.create_user(username="pruebas", email="pruebas@example.com"),
    }


def importar(*args, lector=None):
    salida = StringIO()
    call_command(
        "importar_nexo_consentimiento",
        "--empresa",
        str(empresa_actual().pk),
        *args,
        lector=lector or LectorEnMemoria(),
        stdout=salida,
    )
    return salida.getvalue()


def test_el_lector_lee_las_columnas_de_nexo():
    assert TABLAS["aceptacion"].nombre == "users_user"
    assert "data_consent_accepted_at" in TABLAS["aceptacion"].columnas
    assert TABLAS["aceptacion"].parametros == (True,)
    assert TABLAS["texto"].parametros == ("consent_text",)


def test_sin_base_de_nexo_falla_claro():
    with pytest.raises(ErrorDeNexo):
        LectorNexoConsentimientoSQL(alias="no_existe")


def test_el_importador_de_solicitudes_remite_a_este_comando():
    assert "importar_nexo_consentimiento" in NO_SE_MIGRA["User.dataConsentAccepted"]


def test_simulacro_no_deja_nada(cuentas):
    salida = importar()
    assert "SIMULACRO" in salida and "todo cuadra" in salida
    assert not AceptacionAviso.objects.exists()


def test_aplicar_registra_la_version_nexo_con_su_fecha_y_su_texto(cuentas):
    salida = importar("--aplicar")
    assert "Importación confirmada." in salida
    assert "Sin fecha (no se importan): 1" in salida
    assert "regía el de por defecto): 1" in salida

    assert AceptacionAviso.objects.count() == 3
    ana = AceptacionAviso.objects.get(usuario=cuentas[ANA])
    assert ana.empresa == empresa_actual()
    assert ana.version == "Nexo" and ana.origen == "NEXO"
    assert ana.aceptado_en == t(8, 20)
    assert ana.ip is None and ana.id_nexo == ANA
    # Antes del 02/09 regía el texto por defecto de Nexo: no se conoce.
    assert ana.texto == ""
    assert AceptacionAviso.objects.get(usuario=cuentas[NINO]).texto == "Texto editado en Nexo."


def test_lo_importado_no_cuenta_como_aceptacion_del_aviso_vigente(cuentas):
    if not AvisoPrivacidad.objects.exists():
        AvisoPrivacidad.objects.create(texto="Aviso.", version=1, version_desde=t(11, 1))
    importar("--aplicar")
    assert consentimiento.acepto(cuentas[ANA]) is False


def test_es_repetible(cuentas):
    importar("--aplicar")
    datos = datos_nexo()
    # Nino volvió a aceptar en Nexo después de un restablecimiento.
    datos["aceptacion"][1]["data_consent_accepted_at"] = t(10, 1)
    salida = importar("--aplicar", lector=LectorEnMemoria(datos))
    assert "Ya importadas antes (se saltan): 2" in salida
    assert AceptacionAviso.objects.filter(usuario=cuentas[NINO]).count() == 2


def test_sin_la_cuenta_en_la_intranet_aborta_sin_crear_nada(cuentas):
    cuentas[NINO].delete()
    with pytest.raises(CommandError) as error:
        importar("--aplicar")
    assert "nino.noboa@example.com" in str(error.value)
    assert not AceptacionAviso.objects.exists()


def test_excluir_un_usuario(cuentas):
    salida = importar("--aplicar", "--excluir-usuario", "pruebas@example.com")
    assert "aceptaciones excluidas: 1" in salida
    assert not AceptacionAviso.objects.filter(usuario=cuentas[PRUEBAS]).exists()
    assert AceptacionAviso.objects.count() == 2


def test_el_informe_no_puede_quedar_en_el_repositorio(cuentas, settings):
    from pathlib import Path

    with pytest.raises(CommandError):
        importar("--informe", str(Path(settings.BASE_DIR) / "informe-consentimiento.csv"))


def test_el_informe_csv_fuera_del_repositorio(cuentas, tmp_path):
    ruta = tmp_path / "informe.csv"
    importar("--informe", str(ruta))
    contenido = ruta.read_text(encoding="utf-8-sig")
    assert "sin_fecha" in contenido and "verificacion" in contenido
