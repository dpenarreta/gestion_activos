"""Solicitudes de compra: lo que falta, quién lo pide y quién lo gestiona.

Cobertura de tests/qa/features/solicitudes-de-compra.feature (AC-SOL-001 a
AC-SOL-024).

El inventario responde qué hay; esto responde qué falta. Hasta ahora una laptop
pedida por correo no estaba en ninguna parte: nadie podía decir cuántas se
pidieron, quién las pidió ni en qué punto estaban.

Las cuentas y los ayudantes viven en `conftest.py`: los comparte con las
pruebas de seguridad, que atacan este mismo escenario.
"""

import datetime

import pytest

from apps.activos.models_caracteristicas import CaracteristicaTipo
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.mantenimientos.models import CatalogoComponente
from apps.solicitudes.models import Solicitud

from .conftest import RUTA, _alta, _cliente, _crear, _cuenta, _rol

pytestmark = pytest.mark.django_db


# --- Realizar una solicitud --------------------------------------------------


def test_se_pide_y_queda_asignada_a_quien_comprara(pide, compra, empresa):
    """Nace con encargado: es lo que hace que «Solicitudes recibidas» sea una
    lista de tareas y no una bandeja que todos suponen que mira otro."""
    respuesta = _cliente(pide, empresa).post(RUTA, _alta(compra), format="json")

    assert respuesta.status_code == 201, respuesta.data
    solicitud = Solicitud.objects.todas().get()
    assert solicitud.solicitante_id == pide.id
    assert solicitud.encargado_id == compra.id
    assert solicitud.estado == Solicitud.Estado.PENDIENTE


def test_el_solicitante_es_quien_esta_autenticado(pide, compra, jefe, empresa):
    """Mandarlo desde el cliente dejaría pedir en nombre de otro, y «Mis
    solicitudes» dejaría de querer decir lo que dice."""
    _cliente(pide, empresa).post(RUTA, _alta(compra, solicitante=jefe.id), format="json")

    assert Solicitud.objects.todas().get().solicitante_id == pide.id


def test_se_puede_pedir_del_catalogo(pide, compra, laptop, empresa):
    respuesta = _cliente(pide, empresa).post(
        RUTA, _alta(compra, tipo_dispositivo=laptop.id, detalle="con 32 GB"), format="json"
    )

    assert respuesta.status_code == 201, respuesta.data
    assert respuesta.data["lo_que_se_pide"] == "Laptop — con 32 GB"


def test_se_puede_pedir_lo_que_el_catalogo_no_tiene(pide, compra, empresa):
    """Exigir el catálogo obligaría a dar de alta un tipo para poder pedirlo, y
    lo que se pide muchas veces es justo lo que aún no existe."""
    respuesta = _cliente(pide, empresa).post(
        RUTA, _alta(compra, detalle="Impresora de etiquetas Zebra ZD421"), format="json"
    )

    assert respuesta.status_code == 201
    assert respuesta.data["lo_que_se_pide"] == "Impresora de etiquetas Zebra ZD421"


def test_una_solicitud_sin_objeto_se_rechaza(pide, compra, empresa):
    """Hay que devolverla preguntando qué era."""
    respuesta = _cliente(pide, empresa).post(RUTA, _alta(compra, detalle=""), format="json")

    assert respuesta.status_code == 400
    assert "describa" in str(respuesta.data)


def test_no_se_piden_un_dispositivo_y_un_componente_a_la_vez(pide, compra, laptop, empresa):
    """No se sabría si es una compra o dos, y cada una se compra y se entrega
    por su cuenta."""
    disco = CatalogoComponente.objects.create(nombre="Disco SSD", codigo="SSD480", empresa=empresa)

    respuesta = _cliente(pide, empresa).post(
        RUTA,
        _alta(compra, tipo_dispositivo=laptop.id, componente=disco.id),
        format="json",
    )

    assert respuesta.status_code == 400
    assert not Solicitud.objects.todas().exists()


def test_solo_se_asigna_a_quien_puede_gestionarlas(pide, empresa):
    """Asignarle una solicitud a quien no tiene cómo atenderla es dejarla en un
    buzón que nadie abre."""
    ajeno = _cuenta("ajeno", empresa, "solicitudes.ver", "solicitudes.crear")

    respuesta = _cliente(pide, empresa).post(RUTA, _alta(ajeno), format="json")

    assert respuesta.status_code == 400
    assert "encargado" in respuesta.data["error"]["details"]


def test_los_encargados_posibles_son_los_que_pueden_atenderla(pide, compra, empresa):
    respuesta = _cliente(pide, empresa).get(f"{RUTA}encargados/")

    assert respuesta.status_code == 200
    nombres = {fila["id"] for fila in respuesta.data}
    assert compra.id in nombres
    assert pide.id not in nombres


def test_sin_permiso_de_crear_no_se_pide(compra, empresa):
    solo_mira = _cuenta("mira", empresa, "solicitudes.ver")

    respuesta = _cliente(solo_mira, empresa).post(RUTA, _alta(compra), format="json")

    assert respuesta.status_code == 403


# --- Mis solicitudes y solicitudes recibidas ---------------------------------


def test_mis_solicitudes_son_las_que_yo_pedi(pide, compra, jefe, empresa):
    mia = _crear(pide, compra, empresa)
    _crear(jefe, compra, empresa, detalle="Monitor para sala de juntas")

    respuesta = _cliente(pide, empresa).get(RUTA, {"ambito": "mias"})

    assert [fila["id"] for fila in respuesta.data["results"]] == [mia]


def test_las_recibidas_son_las_que_me_asignaron(pide, compra, otro_comprador, empresa):
    mia = _crear(pide, compra, empresa)
    _crear(pide, otro_comprador, empresa, detalle="Teclado")

    respuesta = _cliente(compra, empresa).get(RUTA, {"ambito": "recibidas"})

    assert [fila["id"] for fila in respuesta.data["results"]] == [mia]


def test_quien_administra_ve_las_de_todos(pide, compra, otro_comprador, jefe, empresa):
    """Es lo que permite ver la que nadie ha tocado en tres semanas."""
    _crear(pide, compra, empresa)
    _crear(pide, otro_comprador, empresa, detalle="Teclado")

    respuesta = _cliente(jefe, empresa).get(RUTA, {"ambito": "recibidas"})

    assert respuesta.data["count"] == 2


def test_la_solicitud_de_otro_no_se_ve_ni_existe(pide, compra, empresa):
    """404 y no 403: quien no participa no tiene por qué enterarse de que
    existe."""
    ajena = _crear(pide, compra, empresa)
    tercero = _cuenta("tercero", empresa, "solicitudes.ver", "solicitudes.crear")

    respuesta = _cliente(tercero, empresa).get(f"{RUTA}{ajena}/")

    assert respuesta.status_code == 404


def test_las_solicitudes_no_cruzan_empresas(pide, compra, empresa):
    """Lo pedido en una empresa no se ve desde otra, aunque sea la misma
    persona la que pregunta."""
    from apps.empresas.contexto import usando_empresa

    _crear(pide, compra, empresa)
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    MembresiaEmpresa.objects.create(usuario=pide, empresa=otra)
    otra.membresias.filter(usuario=pide).first().roles.set(
        [_rol("rol_otra", "solicitudes.ver", "solicitudes.crear")]
    )

    with usando_empresa(otra):
        respuesta = _cliente(pide, otra).get(RUTA, {"ambito": "mias"})

    assert respuesta.data["count"] == 0


# --- El recorrido ------------------------------------------------------------


def test_el_encargado_la_toma_la_compra_y_la_entrega(pide, compra, empresa):
    solicitud = _crear(pide, compra, empresa)
    cliente = _cliente(compra, empresa)

    for estado in ("en_gestion", "comprada", "entregada"):
        respuesta = cliente.post(
            f"{RUTA}{solicitud}/cambiar-estado/", {"estado": estado}, format="json"
        )
        assert respuesta.status_code == 200, respuesta.data

    assert Solicitud.objects.todas().get().estado == Solicitud.Estado.ENTREGADA


def test_cada_paso_queda_escrito_con_quien_lo_dio(pide, compra, empresa):
    """Un recorrido que se puede reescribir no sirve para explicar por qué un
    área lleva tres meses sin su equipo."""
    solicitud = _crear(pide, compra, empresa)
    _cliente(compra, empresa).post(
        f"{RUTA}{solicitud}/cambiar-estado/",
        {"estado": "en_gestion", "nota": "Pedida a Tecnomega"},
        format="json",
    )

    respuesta = _cliente(pide, empresa).get(f"{RUTA}{solicitud}/")

    movimientos = respuesta.data["movimientos"]
    assert [m["estado_nuevo"] for m in movimientos] == ["pendiente", "en_gestion"]
    assert movimientos[1]["actor_nombre"] == "Compra Pérez"
    assert movimientos[1]["nota"] == "Pedida a Tecnomega"


def test_una_solicitud_ajena_no_la_mueve_quien_no_la_tiene(pide, compra, otro_comprador, empresa):
    """Tener el permiso de gestionar habilita a mover las propias, no las de
    los demás."""
    solicitud = _crear(pide, compra, empresa)

    respuesta = _cliente(otro_comprador, empresa).post(
        f"{RUTA}{solicitud}/cambiar-estado/", {"estado": "en_gestion"}, format="json"
    )

    assert respuesta.status_code in {403, 404}
    assert Solicitud.objects.todas().get().estado == Solicitud.Estado.PENDIENTE


def test_quien_pide_no_aprueba_lo_suyo(pide, compra, empresa):
    solicitud = _crear(pide, compra, empresa)

    respuesta = _cliente(pide, empresa).post(
        f"{RUTA}{solicitud}/cambiar-estado/", {"estado": "comprada"}, format="json"
    )

    assert respuesta.status_code == 403


def test_quien_pide_si_cancela_lo_suyo(pide, compra, empresa):
    """Quien pidió algo que ya no hace falta debe poder retirarlo sin pedirle
    permiso a nadie: dejarlo abierto le hace perder el tiempo a quien compra."""
    solicitud = _crear(pide, compra, empresa)

    respuesta = _cliente(pide, empresa).post(
        f"{RUTA}{solicitud}/cambiar-estado/", {"estado": "cancelada"}, format="json"
    )

    assert respuesta.status_code == 200
    assert Solicitud.objects.todas().get().estado == Solicitud.Estado.CANCELADA


def test_un_rechazo_lleva_motivo(pide, compra, empresa):
    """Es lo único que le llega a quien pidió como explicación de por qué no."""
    solicitud = _crear(pide, compra, empresa)

    respuesta = _cliente(compra, empresa).post(
        f"{RUTA}{solicitud}/cambiar-estado/", {"estado": "rechazada"}, format="json"
    )

    assert respuesta.status_code == 400
    assert "motivo" in str(respuesta.data)


def test_una_entregada_ya_no_se_mueve(pide, compra, empresa):
    solicitud = _crear(pide, compra, empresa)
    cliente = _cliente(compra, empresa)
    for estado in ("en_gestion", "comprada", "entregada"):
        cliente.post(f"{RUTA}{solicitud}/cambiar-estado/", {"estado": estado}, format="json")

    respuesta = cliente.post(
        f"{RUTA}{solicitud}/cambiar-estado/", {"estado": "en_gestion"}, format="json"
    )

    assert respuesta.status_code == 400
    assert "no se reabre" in str(respuesta.data)


def test_no_se_salta_pasos(pide, compra, empresa):
    """Comprada ya costó dinero: no se llega ahí sin haberla tomado."""
    solicitud = _crear(pide, compra, empresa)

    respuesta = _cliente(compra, empresa).post(
        f"{RUTA}{solicitud}/cambiar-estado/", {"estado": "entregada"}, format="json"
    )

    assert respuesta.status_code == 400


def test_una_solicitud_no_se_borra(pide, compra, empresa):
    """Borrarla haría desaparecer de los conteos lo que un área llegó a
    necesitar."""
    solicitud = _crear(pide, compra, empresa)

    respuesta = _cliente(compra, empresa).delete(f"{RUTA}{solicitud}/")

    assert respuesta.status_code == 405


# --- Corregir lo que se pidió ------------------------------------------------


def test_se_corrige_mientras_nadie_la_haya_tomado(pide, compra, empresa):
    solicitud = _crear(pide, compra, empresa)

    respuesta = _cliente(pide, empresa).patch(f"{RUTA}{solicitud}/", {"cantidad": 3}, format="json")

    assert respuesta.status_code == 200
    assert Solicitud.objects.todas().get().cantidad == 3


def test_ya_tomada_no_se_cambia_lo_que_se_pide(pide, compra, empresa):
    """Cambiar qué se pide después de que alguien fue a cotizarlo le hace
    perder el trabajo hecho."""
    solicitud = _crear(pide, compra, empresa)
    _cliente(compra, empresa).post(
        f"{RUTA}{solicitud}/cambiar-estado/", {"estado": "en_gestion"}, format="json"
    )

    respuesta = _cliente(pide, empresa).patch(f"{RUTA}{solicitud}/", {"cantidad": 3}, format="json")

    assert respuesta.status_code == 400
    assert "cancélela" in str(respuesta.data)


def test_la_solicitud_de_otro_no_se_corrige(pide, compra, jefe, empresa):
    solicitud = _crear(pide, compra, empresa)

    respuesta = _cliente(jefe, empresa).patch(f"{RUTA}{solicitud}/", {"cantidad": 9}, format="json")

    assert respuesta.status_code == 403


# --- Los avisos --------------------------------------------------------------


def test_al_encargado_se_le_avisa_de_lo_que_le_asignaron(
    pide, compra, empresa, mailoutbox, al_confirmar
):
    """Una bandeja sin aviso es una bandeja que se mira cuando alguien se
    acuerda."""
    with al_confirmar():
        respuesta = _cliente(pide, empresa).post(RUTA, _alta(compra), format="json")

    assert respuesta.data["aviso"]["enviado_a"] == 1
    assert len(mailoutbox) == 1
    assert str(respuesta.data["id"]) in mailoutbox[0].subject
    assert mailoutbox[0].bcc == [compra.email]


def test_si_el_encargado_no_tiene_correo_se_dice_en_el_acto(pide, empresa, mailoutbox):
    """Quien pide debe saberlo ahora, no cuando pregunte por qué nadie atendió
    su solicitud."""
    sin_correo = _cuenta(
        "sincorreo", empresa, "solicitudes.ver", "solicitudes.gestionar", correo=""
    )

    respuesta = _cliente(pide, empresa).post(RUTA, _alta(sin_correo), format="json")

    assert respuesta.data["aviso"]["enviado_a"] == 0
    assert respuesta.data["aviso"]["sin_correo"] == ["Sincorreo Pérez"]
    assert mailoutbox == []


def test_a_quien_pidio_se_le_avisa_de_cada_paso(pide, compra, empresa, mailoutbox, al_confirmar):
    solicitud = _crear(pide, compra, empresa)
    mailoutbox.clear()

    with al_confirmar():
        _cliente(compra, empresa).post(
            f"{RUTA}{solicitud}/cambiar-estado/", {"estado": "en_gestion"}, format="json"
        )

    assert len(mailoutbox) == 1
    assert mailoutbox[0].bcc == [pide.email]


def test_cancelar_lo_propio_no_se_avisa_a_uno_mismo(
    pide, compra, empresa, mailoutbox, al_confirmar
):
    """Sería contarle lo que acaba de hacer."""
    solicitud = _crear(pide, compra, empresa)
    mailoutbox.clear()

    with al_confirmar():
        _cliente(pide, empresa).post(
            f"{RUTA}{solicitud}/cambiar-estado/", {"estado": "cancelada"}, format="json"
        )

    assert mailoutbox == []


# --- Filtros de la bandeja ---------------------------------------------------


def test_se_puede_ver_solo_lo_que_sigue_vivo(pide, compra, empresa):
    """Una bandeja que arrastra lo entregado hace seis meses deja de leerse."""
    abierta = _crear(pide, compra, empresa)
    cerrada = _crear(pide, compra, empresa, detalle="Mouse")
    _cliente(pide, empresa).post(
        f"{RUTA}{cerrada}/cambiar-estado/", {"estado": "cancelada"}, format="json"
    )

    respuesta = _cliente(pide, empresa).get(RUTA, {"ambito": "mias", "abiertas": "true"})

    assert [fila["id"] for fila in respuesta.data["results"]] == [abierta]


def test_se_busca_por_lo_que_se_pidio(pide, compra, empresa):
    _crear(pide, compra, empresa, detalle="Impresora de etiquetas")
    _crear(pide, compra, empresa, detalle="Monitor curvo")

    respuesta = _cliente(pide, empresa).get(RUTA, {"q": "etiquetas"})

    assert respuesta.data["count"] == 1


def test_la_fecha_en_que_se_necesita_viaja(pide, compra, empresa):
    respuesta = _cliente(pide, empresa).post(
        RUTA, _alta(compra, fecha_necesaria="2026-10-01"), format="json"
    )

    assert respuesta.data["fecha_necesaria"] == "2026-10-01"
    assert Solicitud.objects.todas().get().fecha_necesaria == datetime.date(2026, 10, 1)


# --- Con qué características se pide -----------------------------------------


@pytest.fixture
def laptop_descrita(laptop):
    """Un tipo que declara lo que se describe de sus equipos."""
    CaracteristicaTipo.objects.create(
        tipo=laptop, nombre="RAM", dato="entero", unidad="GB", obligatoria=True, orden=1
    )
    CaracteristicaTipo.objects.create(
        tipo=laptop,
        nombre="Tipo de disco",
        dato="lista",
        opciones=["HDD", "SSD", "NVMe"],
        obligatoria=True,
        orden=2,
    )
    CaracteristicaTipo.objects.create(tipo=laptop, nombre="Procesador", dato="texto", orden=3)
    return laptop


def test_el_catalogo_trae_las_caracteristicas_de_cada_tipo(pide, empresa, laptop_descrita):
    """El formulario las necesita al cambiar el desplegable, y quien pide no
    puede consultarlas por el inventario: no tiene permiso para verlo."""
    respuesta = _cliente(pide, empresa).get(f"{RUTA}catalogo/")

    assert respuesta.status_code == 200
    tipo = next(
        fila for fila in respuesta.data["tipos_dispositivo"] if fila["id"] == laptop_descrita.id
    )
    assert [c["nombre"] for c in tipo["caracteristicas"]] == [
        "RAM",
        "Tipo de disco",
        "Procesador",
    ]
    assert tipo["caracteristicas"][1]["opciones"] == ["HDD", "SSD", "NVMe"]


def test_se_pide_con_las_caracteristicas_del_tipo(pide, compra, empresa, laptop_descrita):
    """«Una laptop» y «una laptop con 32 GB y disco NVMe» son dos compras
    distintas, y la diferencia se perdía en la justificación escrita a mano."""
    respuesta = _cliente(pide, empresa).post(
        RUTA,
        _alta(
            compra,
            tipo_dispositivo=laptop_descrita.id,
            especificaciones={"RAM": "32", "Tipo de disco": "NVMe"},
        ),
        format="json",
    )

    assert respuesta.status_code == 201, respuesta.data
    # Normalizadas al tipo declarado: un «32» de texto no se compara con 32.
    assert respuesta.data["especificaciones"] == {"RAM": 32, "Tipo de disco": "NVMe"}


def test_una_caracteristica_que_el_tipo_no_declara_se_rechaza(
    pide, compra, empresa, laptop_descrita
):
    """Es lo que impide que vuelva la dispersión de «RAM», «Ram» y «Memoria
    RAM», también en lo que se pide."""
    respuesta = _cliente(pide, empresa).post(
        RUTA,
        _alta(
            compra,
            tipo_dispositivo=laptop_descrita.id,
            especificaciones={"RAM": "32", "Tipo de disco": "SSD", "Memoria RAM": "32"},
        ),
        format="json",
    )

    assert respuesta.status_code == 400
    assert "no describe" in str(respuesta.data)


def test_el_valor_se_comprueba_contra_el_dato_declarado(pide, compra, empresa, laptop_descrita):
    """Sin esto no se podría comparar lo pedido con lo que se acabó comprando."""
    respuesta = _cliente(pide, empresa).post(
        RUTA,
        _alta(
            compra,
            tipo_dispositivo=laptop_descrita.id,
            especificaciones={"RAM": "32", "Tipo de disco": "Cinta"},
        ),
        format="json",
    )

    assert respuesta.status_code == 400
    assert "admite" in str(respuesta.data)


def test_pedir_exige_las_obligatorias_del_tipo(pide, compra, empresa, laptop_descrita):
    """Lo que el tipo marca obligatorio se exige también al pedir.

    Si se declaró que de una laptop siempre se dice la RAM, una solicitud que no
    la diga es una que habrá que devolver preguntando. Lo que no deba exigirse
    al pedir se desmarca en la característica, y entonces no se exige en ningún
    sitio.
    """
    respuesta = _cliente(pide, empresa).post(
        RUTA, _alta(compra, tipo_dispositivo=laptop_descrita.id), format="json"
    )

    assert respuesta.status_code == 400
    faltan = respuesta.data["error"]["details"]["especificaciones"]
    assert set(faltan) == {"RAM", "Tipo de disco"}
    assert "obligatoria" in str(faltan)


def test_lo_que_no_es_obligatorio_se_puede_dejar_en_blanco(pide, compra, empresa, laptop_descrita):
    """«Procesador» no está marcada: no se pide que se lo invente."""
    respuesta = _cliente(pide, empresa).post(
        RUTA,
        _alta(
            compra,
            tipo_dispositivo=laptop_descrita.id,
            especificaciones={"RAM": "32", "Tipo de disco": "NVMe"},
        ),
        format="json",
    )

    assert respuesta.status_code == 201, respuesta.data
    assert respuesta.data["especificaciones"] == {"RAM": 32, "Tipo de disco": "NVMe"}


def test_una_solicitud_escrita_a_mano_no_lleva_caracteristicas(pide, compra, empresa):
    """Sin tipo del catálogo no hay contra qué comprobarlas."""
    respuesta = _cliente(pide, empresa).post(
        RUTA,
        _alta(compra, detalle="Impresora de etiquetas", especificaciones={"RAM": "8"}),
        format="json",
    )

    assert respuesta.status_code == 201
    assert respuesta.data["especificaciones"] == {}


def test_lo_pedido_se_corrige_como_el_resto(pide, compra, empresa, laptop_descrita):
    solicitud = _crear(
        pide,
        compra,
        empresa,
        tipo_dispositivo=laptop_descrita.id,
        especificaciones={"RAM": "16", "Tipo de disco": "SSD"},
    )

    respuesta = _cliente(pide, empresa).patch(
        f"{RUTA}{solicitud}/",
        {"especificaciones": {"RAM": "32", "Tipo de disco": "NVMe"}},
        format="json",
    )

    assert respuesta.status_code == 200, respuesta.data
    assert Solicitud.objects.todas().get().especificaciones == {
        "RAM": 32,
        "Tipo de disco": "NVMe",
    }
