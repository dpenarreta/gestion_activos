"""Lo que un atacante intentaría contra el módulo de solicitudes.

Cobertura de tests/qa/features/hallazgos-de-seguridad.feature (AC-SEC-SOL-001 a
AC-SEC-SOL-010).

No repiten lo que ya comprueban las pruebas funcionales: allí se describe lo que
el sistema hace cuando se usa bien, y aquí lo que contesta cuando se usa mal.
Una solicitud lleva quién pidió qué, para quién y con qué justificación —datos
de personas y de compras— y su bandeja es una lista de tareas ajena: leerla o
moverla sin ser quien corresponde es la forma natural de abusar de este módulo.

El criterio de qué respuesta es la correcta sale de `docs/security-review.md`:
lo que no es de uno **no existe** (404), y lo que uno no puede hacer sobre lo
suyo está **prohibido** (403). Distinguirlos al revés filtra información: un 403
sobre una solicitud ajena confirma que existe.
"""

import pytest

from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.solicitudes.models import MovimientoSolicitud, Solicitud

from .conftest import RUTA, _alta, _cliente, _crear, _cuenta, _rol

pytestmark = pytest.mark.django_db


# --- Sin credenciales --------------------------------------------------------


def test_sin_autenticar_no_se_ve_nada(db):
    """La primera puerta: ningún endpoint del módulo responde sin sesión."""
    from rest_framework.test import APIClient

    anonimo = APIClient()

    for metodo, url in (
        ("get", RUTA),
        ("get", f"{RUTA}1/"),
        ("post", RUTA),
        ("get", f"{RUTA}catalogo/"),
        ("get", f"{RUTA}encargados/"),
        ("post", f"{RUTA}1/cambiar-estado/"),
    ):
        respuesta = getattr(anonimo, metodo)(url, {}, format="json")
        assert respuesta.status_code in {401, 403}, f"{metodo.upper()} {url}"


def test_sin_el_permiso_de_ver_no_se_entra(empresa, compra):
    """Un usuario válido del sistema, sin este módulo concedido."""
    ajeno = _cuenta("ajenototal", empresa, "activos.ver")

    respuesta = _cliente(ajeno, empresa).get(RUTA)

    assert respuesta.status_code == 403


# --- Ver lo ajeno ------------------------------------------------------------


def test_la_solicitud_ajena_responde_que_no_existe(pide, compra, empresa):
    """404 y no 403: un «no puede» confirmaría que esa solicitud existe, y con
    ella que alguien pidió algo."""
    ajena = _crear(pide, compra, empresa)
    tercero = _cuenta("mirona", empresa, "solicitudes.ver", "solicitudes.crear")

    respuesta = _cliente(tercero, empresa).get(f"{RUTA}{ajena}/")

    assert respuesta.status_code == 404
    assert "justificacion" not in str(respuesta.data)


def test_el_listado_no_filtra_por_id_lo_ajeno(pide, compra, empresa):
    """Ni siquiera enumerando: el ámbito se aplica al queryset, no al final."""
    _crear(pide, compra, empresa)
    tercero = _cuenta("enumerador", empresa, "solicitudes.ver", "solicitudes.crear")

    respuesta = _cliente(tercero, empresa).get(RUTA)

    assert respuesta.data["count"] == 0


def test_el_recorrido_ajeno_tampoco_se_lee(pide, compra, empresa):
    """La bitácora va dentro de la ficha: si la ficha no se ve, el recorrido
    —con quién rechazó qué y por qué— tampoco."""
    ajena = _crear(pide, compra, empresa)
    assert MovimientoSolicitud.objects.todas().filter(solicitud_id=ajena).exists()
    tercero = _cuenta("curiosa", empresa, "solicitudes.ver", "solicitudes.crear")

    respuesta = _cliente(tercero, empresa).get(f"{RUTA}{ajena}/")

    assert respuesta.status_code == 404


# --- Mover lo ajeno ----------------------------------------------------------


def test_no_se_mueve_una_solicitud_que_no_se_tiene_asignada(pide, compra, otro_comprador, empresa):
    """Tener el permiso de gestionar no es tenerlo sobre todas: si no, la
    bandeja sería un sitio donde cualquiera cierra el pedido de otro."""
    ajena = _crear(pide, compra, empresa)

    respuesta = _cliente(otro_comprador, empresa).post(
        f"{RUTA}{ajena}/cambiar-estado/", {"estado": "entregada"}, format="json"
    )

    assert respuesta.status_code in {403, 404}
    assert Solicitud.objects.todas().get().estado == Solicitud.Estado.PENDIENTE


def test_quien_pide_no_se_aprueba_lo_suyo(pide, compra, empresa):
    """La separación entre pedir y autorizar es el control de este módulo."""
    propia = _crear(pide, compra, empresa)

    for estado in ("en_gestion", "comprada", "entregada"):
        respuesta = _cliente(pide, empresa).post(
            f"{RUTA}{propia}/cambiar-estado/", {"estado": estado}, format="json"
        )
        assert respuesta.status_code == 403, estado

    assert Solicitud.objects.todas().get().estado == Solicitud.Estado.PENDIENTE


def test_no_se_corrige_lo_que_pidio_otro(pide, compra, jefe, empresa):
    """Ni siquiera quien administra compras: corregir el pedido de otro cambia
    lo que esa persona declaró necesitar."""
    ajena = _crear(pide, compra, empresa)

    respuesta = _cliente(jefe, empresa).patch(
        f"{RUTA}{ajena}/", {"justificacion": "otra cosa"}, format="json"
    )

    assert respuesta.status_code == 403
    assert Solicitud.objects.todas().get().solicitante_id == pide.id


# --- Suplantación y campos que no deberían viajar ---------------------------


def test_no_se_pide_en_nombre_de_otro(pide, compra, jefe, empresa):
    """`solicitante` no está entre los campos de escritura: lo pone el servidor
    con quien está autenticado."""
    _cliente(pide, empresa).post(RUTA, _alta(compra, solicitante=jefe.id), format="json")

    assert Solicitud.objects.todas().get().solicitante_id == pide.id


def test_no_se_nace_ya_aprobada(pide, compra, empresa):
    """Mandar `estado` en el alta se ignora: el recorrido empieza en pendiente
    y cada paso deja constancia de quién lo dio."""
    respuesta = _cliente(pide, empresa).post(RUTA, _alta(compra, estado="entregada"), format="json")

    assert respuesta.status_code == 201
    assert Solicitud.objects.todas().get().estado == Solicitud.Estado.PENDIENTE


def test_no_se_elige_la_empresa_desde_el_cliente(pide, compra, empresa):
    """`empresa` la pone el modelo con la activa de la petición; mandarla sería
    escribir en el ámbito de otra."""
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")

    _cliente(pide, empresa).post(RUTA, _alta(compra, empresa=otra.id), format="json")

    assert Solicitud.objects.todas().get().empresa_id == empresa.id


def test_no_se_asigna_a_quien_no_puede_atenderla(pide, empresa):
    """El desplegable se filtra en el cliente, pero la lista de destinos válidos
    la impone el servidor: si no, se podría dirigir el aviso a cualquier cuenta
    del sistema."""
    cualquiera = _cuenta("cualquiera", empresa, "solicitudes.ver")

    respuesta = _cliente(pide, empresa).post(RUTA, _alta(cualquiera), format="json")

    assert respuesta.status_code == 400
    assert not Solicitud.objects.todas().exists()


# --- Aislamiento entre empresas ---------------------------------------------


def test_la_cabecera_de_otra_empresa_no_abre_nada(pide, compra, empresa):
    """Pedir una empresa a la que no se pertenece no devuelve otra cosa:
    devuelve nada."""
    from apps.empresas.contexto import usando_empresa

    _crear(pide, compra, empresa)
    ajena = Empresa.objects.create(nombre="Ajena", codigo="AJ")

    with usando_empresa(ajena):
        respuesta = _cliente(pide, ajena).get(RUTA)

    assert respuesta.status_code in {200, 403}
    if respuesta.status_code == 200:
        assert respuesta.data["count"] == 0


def test_lo_de_otra_empresa_no_se_gestiona_desde_la_propia(pide, compra, empresa):
    """Aunque la cuenta trabaje en las dos, lo de una no se mueve desde la otra."""
    from apps.empresas.contexto import usando_empresa

    otra = Empresa.objects.create(nombre="Otra", codigo="OT")
    MembresiaEmpresa.objects.create(usuario=compra, empresa=otra).roles.set(
        [_rol("rol_otra_empresa", "solicitudes.ver", "solicitudes.gestionar")]
    )
    propia = _crear(pide, compra, empresa)

    with usando_empresa(otra):
        respuesta = _cliente(compra, otra).post(
            f"{RUTA}{propia}/cambiar-estado/", {"estado": "en_gestion"}, format="json"
        )

    assert respuesta.status_code == 404
    assert Solicitud.objects.todas().get().estado == Solicitud.Estado.PENDIENTE


# --- Entradas hostiles -------------------------------------------------------


def test_la_busqueda_no_se_rompe_con_caracteres_de_inyeccion(pide, compra, empresa):
    """El ORM parametriza, pero la prueba fija que nadie lo sustituya por una
    consulta compuesta a mano."""
    _crear(pide, compra, empresa)

    for termino in ("'; DROP TABLE solicitudes_solicitud; --", "%", "_", "' OR '1'='1"):
        respuesta = _cliente(pide, empresa).get(RUTA, {"q": termino})
        assert respuesta.status_code == 200, termino

    assert Solicitud.objects.todas().count() == 1


def test_un_estado_inventado_no_pasa(pide, compra, empresa):
    propia = _crear(pide, compra, empresa)

    respuesta = _cliente(compra, empresa).post(
        f"{RUTA}{propia}/cambiar-estado/", {"estado": "aprobada_por_mi"}, format="json"
    )

    assert respuesta.status_code == 400
    assert Solicitud.objects.todas().get().estado == Solicitud.Estado.PENDIENTE


def test_el_texto_hostil_se_guarda_tal_cual_y_no_se_interpreta(pide, compra, empresa):
    """No se escapa al guardar: se escapa al pintar, y de eso se encarga React.

    Guardar HTML escapado dejaría «&lt;script&gt;» escrito en la pantalla y en
    el correo, que es un fallo distinto y más difícil de ver.
    """
    guion = "<script>alert('x')</script>"

    solicitud = _crear(pide, compra, empresa, justificacion=guion)
    respuesta = _cliente(pide, empresa).get(f"{RUTA}{solicitud}/")

    assert respuesta.data["justificacion"] == guion


# --- Rastro ------------------------------------------------------------------


def test_cada_paso_deja_rastro_en_la_auditoria(pide, compra, empresa):
    """Un módulo que mueve compras sin dejar quién lo hizo no se puede revisar
    después de un incidente."""
    from apps.core.models import AuditLog

    solicitud = _crear(pide, compra, empresa)
    _cliente(compra, empresa).post(
        f"{RUTA}{solicitud}/cambiar-estado/", {"estado": "en_gestion"}, format="json"
    )

    acciones = set(
        AuditLog.objects.filter(action__startswith="solicitud").values_list("action", flat=True)
    )
    assert {"solicitud.created", "solicitud.estado_changed"} <= acciones


def test_el_intento_no_autorizado_queda_registrado(empresa, compra):
    """Es lo que permite notar que alguien está probando puertas."""
    from apps.core.models import AuditLog

    ajeno = _cuenta("sondeador", empresa, "activos.ver")

    _cliente(ajeno, empresa).get(RUTA)

    assert AuditLog.objects.filter(action="access_denied", actor=ajeno).exists()


def test_la_lista_de_encargados_no_reparte_correos(pide, compra, empresa):
    """El desplegable solo necesita el nombre.

    Devolver el correo entregaba la dirección de todo el personal de compras a
    cualquiera que pueda ver solicitudes —incluido el rol «Usuario final», que
    existe para no ver nada más que lo suyo—.
    """
    respuesta = _cliente(pide, empresa).get(f"{RUTA}encargados/")

    assert respuesta.status_code == 200
    assert respuesta.data, "la prueba no vale si la lista llega vacía"
    for fila in respuesta.data:
        assert set(fila) == {"id", "nombre"}
    assert compra.email not in str(respuesta.data)
