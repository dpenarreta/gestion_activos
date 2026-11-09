"""`manage.py importar_nexo_privacidad`: las «Solicitudes LOPD» de Nexo.

Sin base de Nexo: el comando recibe un lector en memoria con los mismos métodos
que `LectorNexoPrivacidadSQL`. Los ids de Nexo son altos a propósito, para que
un id copiado sin traducir se note. Los correos son ficticios.
"""

import copy
from datetime import UTC, datetime, timedelta
from io import StringIO

import pytest
from django.core.management import CommandError, call_command
from django.utils import timezone

from apps.empresas.contexto import empresa_actual
from apps.notificaciones.models import Notificacion
from apps.novedades.nexo.comun import ErrorDeNexo
from apps.privacidad.models import MovimientoSolicitud, SolicitudDerechos
from apps.privacidad.nexo.lector import TABLAS, LectorNexoPrivacidadSQL
from apps.users.models import User

pytestmark = pytest.mark.django_db

ADMIN, ANA, NINO, PRUEBAS = 9120, 9121, 9122, 9150
USUARIOS_NEXO = [
    {"id": ADMIN, "username": "admin", "email": "Admin.GH@Example.com"},
    {"id": ANA, "username": "ana", "email": "ana.nunez@example.com"},
    {"id": NINO, "username": "nino", "email": "nino.noboa@example.com"},
    {"id": PRUEBAS, "username": "pruebas", "email": "pruebas@example.com"},
]


def t(mes, dia, hora=15):
    return datetime(2026, mes, dia, hora, tzinfo=UTC)


def _fila(pk, usuario, tipo, status, *, por=None, resuelta=None, descripcion=None, dia=1):
    return {
        "id": pk,
        "created_at": t(9, dia),
        "updated_at": t(9, dia + 2),
        "user_id": usuario,
        "type": tipo,
        "description": descripcion,
        "status": status,
        "resolved_by_id": por,
        "resolved_at": resuelta,
    }


def datos_nexo() -> dict[str, list[dict]]:
    return {
        "solicitud": [
            _fila(8001, ANA, "RECTIFICACION", "PENDIENTE", descripcion="Mi cargo está mal escrito"),
            _fila(8002, NINO, "ELIMINACION", "EN_PROCESO", descripcion="Ya no trabajo aquí", dia=3),
            _fila(8003, ANA, "RECTIFICACION", "RESUELTA", por=ADMIN, resuelta=t(9, 10), dia=5),
            # Una descarga de «mis datos» en Nexo: ACCESO resuelta sin resolutor.
            _fila(8004, NINO, "ACCESO", "RESUELTA", resuelta=t(9, 7), dia=7),
            _fila(8005, PRUEBAS, "ACCESO", "RESUELTA", resuelta=t(9, 8), dia=8),
        ]
    }


class LectorEnMemoria:
    def __init__(self, datos=None):
        self.datos = datos if datos is not None else datos_nexo()

    def filas(self, tabla):
        return copy.deepcopy(sorted(self.datos[tabla], key=lambda f: f["id"]))

    def usuarios(self, ids):
        ids = set(ids)
        return [dict(u) for u in USUARIOS_NEXO if u["id"] in ids]

    def conteos(self):
        return {tabla: len(filas) for tabla, filas in self.datos.items()}


@pytest.fixture
def cuentas():
    """Las cuentas de la intranet (mismo correo que en Nexo, con otra
    capitalización a propósito)."""
    return {
        ADMIN: User.objects.create_user(username="admingh", email="admin.gh@example.com"),
        ANA: User.objects.create_user(username="anunez", email="ana.nunez@example.com"),
        NINO: User.objects.create_user(username="nnoboa", email="nino.noboa@example.com"),
        PRUEBAS: User.objects.create_user(username="pruebas", email="pruebas@example.com"),
    }


def importar(*args, lector=None):
    salida = StringIO()
    call_command(
        "importar_nexo_privacidad",
        "--empresa",
        str(empresa_actual().pk),
        *args,
        lector=lector or LectorEnMemoria(),
        stdout=salida,
    )
    return salida.getvalue()


def test_el_lector_lee_las_columnas_de_la_migracion_de_nexo():
    tabla = TABLAS["solicitud"]
    assert tabla.nombre == "data_requests_datasubjectrequest"
    assert "legacy_postgres_id" not in tabla.columnas
    assert set(tabla.usuarios) == {"user_id", "resolved_by_id"}


def test_sin_base_de_nexo_falla_claro(settings):
    with pytest.raises(ErrorDeNexo):
        LectorNexoPrivacidadSQL(alias="no_existe")


def test_simulacro_no_deja_nada(cuentas):
    salida = importar()
    assert "SIMULACRO" in salida and "todo cuadra" in salida
    assert not SolicitudDerechos.objects.exists()
    assert not MovimientoSolicitud.objects.todas().exists()


def test_aplicar_copia_las_solicitudes_con_su_historial(cuentas, settings):
    settings.PRIVACIDAD_PLAZO_DIAS = 15
    salida = importar("--aplicar")
    assert "Importación confirmada." in salida
    assert "descargar «mis datos» en Nexo: 2" in salida

    assert SolicitudDerechos.objects.count() == 5
    pendiente = SolicitudDerechos.objects.get(id_nexo=8001)
    assert pendiente.empresa == empresa_actual()
    assert pendiente.titular == cuentas[ANA]
    assert pendiente.descripcion == "Mi cargo está mal escrito"
    assert pendiente.created_at == t(9, 1) and pendiente.updated_at == t(9, 3)
    assert pendiente.plazo_dias == 15
    assert pendiente.fecha_limite == timezone.localdate(t(9, 1)) + timedelta(days=15)
    assert pendiente.resuelta_por is None
    assert [m.estado_nuevo for m in pendiente.movimientos.all()] == ["PENDIENTE"]

    resuelta = SolicitudDerechos.objects.get(id_nexo=8003)
    assert resuelta.estado == "RESUELTA"
    assert resuelta.resuelta_por == cuentas[ADMIN]
    assert resuelta.resuelta_en == t(9, 10)
    movimientos = list(resuelta.movimientos.all())
    assert [(m.estado_anterior, m.estado_nuevo) for m in movimientos] == [
        ("", "PENDIENTE"),
        ("PENDIENTE", "RESUELTA"),
    ]
    assert movimientos[0].actor == cuentas[ANA] and movimientos[1].actor == cuentas[ADMIN]
    assert movimientos[1].created_at == t(9, 10)

    en_proceso = SolicitudDerechos.objects.get(id_nexo=8002)
    assert en_proceso.estado == "EN_PROCESO" and en_proceso.resuelta_en is None
    # Importar no avisa a nadie: no son solicitudes nuevas.
    assert not Notificacion.objects.filter(tipo__startswith="privacidad.").exists()


def test_es_repetible_y_trae_solo_las_nuevas(cuentas):
    importar("--aplicar")
    datos = datos_nexo()
    datos["solicitud"].append(_fila(8006, ANA, "ELIMINACION", "PENDIENTE", dia=12))
    salida = importar("--aplicar", lector=LectorEnMemoria(datos))
    assert "Ya importadas antes (se saltan): 5" in salida
    assert SolicitudDerechos.objects.count() == 6
    assert MovimientoSolicitud.objects.filter(solicitud__id_nexo=8006).count() == 1


def test_sin_la_cuenta_en_la_intranet_aborta_sin_crear_nada(cuentas):
    cuentas[NINO].delete()
    with pytest.raises(CommandError) as error:
        importar("--aplicar")
    assert "nino.noboa@example.com" in str(error.value)
    assert not SolicitudDerechos.objects.exists()


def test_excluir_un_usuario_salta_sus_solicitudes(cuentas):
    salida = importar("--aplicar", "--excluir-usuario", "pruebas@example.com")
    assert "solicitudes excluidas: 1" in salida
    assert not SolicitudDerechos.objects.filter(titular=cuentas[PRUEBAS]).exists()
    assert SolicitudDerechos.objects.count() == 4


def test_no_se_excluye_a_quien_resolvio_solicitudes_ajenas(cuentas):
    with pytest.raises(CommandError) as error:
        importar("--aplicar", "--excluir-usuario", "admin.gh@example.com")
    assert "resolvió 1 solicitudes" in str(error.value)
    assert not SolicitudDerechos.objects.exists()


def test_el_informe_no_puede_quedar_en_el_repositorio(cuentas, settings):
    from pathlib import Path

    dentro = Path(settings.BASE_DIR) / "informe-privacidad.csv"
    with pytest.raises(CommandError):
        importar("--informe", str(dentro))


def test_el_informe_csv_fuera_del_repositorio(cuentas, tmp_path):
    ruta = tmp_path / "informe.csv"
    importar("--informe", str(ruta))
    contenido = ruta.read_text(encoding="utf-8-sig")
    assert "verificacion" in contenido and "NO CUADRA" not in contenido
