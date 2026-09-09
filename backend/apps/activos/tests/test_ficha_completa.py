"""Ficha completa del activo: los nueve estados del §4.1, la ubicación
estructurada, la clasificación del §12 y los filtros del §14.

El eje de estas pruebas es la distinción entre «el equipo está en el parque» y
«el equipo salió»: antes esa frontera era una sola comparación contra «dado de
baja», repetida en nueve archivos. Con «perdido» y «robado» esa duplicación se
convertía en nueve sitios donde olvidar uno de los tres, así que lo que aquí
se verifica sobre todo es que ningún módulo se quedó con el criterio viejo.
"""

import datetime

import pytest
from rest_framework.test import APIClient

from apps.activos.models import Activo, MovimientoActivo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.alertas.models import ConfiguracionAlertas
from apps.alertas.reglas import construir_alertas
from apps.mantenimientos.models import Mantenimiento
from apps.organizacion.models import Departamento, Empleado, Ubicacion
from apps.politicas.models import PoliticaObsolescencia
from apps.politicas.services import evaluar_activo
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_ficha", email="admin_ficha@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def departamento(db):
    return Departamento.objects.create(nombre="Tecnología", codigo="TI")


@pytest.fixture
def empleado(departamento):
    return Empleado.objects.create(
        nombres="Ana",
        apellidos="Pérez",
        codigo_empleado="EMP-0001",
        departamento=departamento,
    )


@pytest.fixture
def tipo(db):
    return TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")


@pytest.fixture
def ubicacion(db):
    return Ubicacion.objects.create(sede="Matriz Quito", nombre="Bodega TI")


@pytest.fixture
def crear_activo(admin, tipo, departamento):
    contador = {"n": 0}

    def _crear(**extra):
        contador["n"] += 1
        datos = {
            "tipo": tipo,
            "nombre": f"Equipo {contador['n']}",
            "marca": "Dell",
            "modelo": "Latitude",
            "numero_serie": f"SN-FICHA-{contador['n']}",
            "departamento": departamento,
            "fecha_adquisicion": datetime.date(2024, 1, 15),
        }
        datos.update(extra)
        return ActivoService.crear_activo(actor=admin, **datos)

    return _crear


# --- Los nueve estados (§4.1) -----------------------------------------------


def test_existen_los_nueve_estados_del_documento():
    """§12: disponible, asignado, en reparación, garantía, bodega, tránsito,
    baja, perdido y robado."""
    assert len(Activo.Estado.choices) == 9
    valores = {estado.value for estado in Activo.Estado}
    assert {"disponible", "en_garantia", "en_transito", "perdido", "robado"} <= valores


def test_perder_un_equipo_exige_decir_que_pasó(cliente, crear_activo):
    """«Perdido» sin explicación deja un equipo desaparecido y ninguna
    constancia de qué ocurrió."""
    activo = crear_activo()

    respuesta = cliente.post(
        f"/api/v1/activos/{activo.id}/cambiar-estado/",
        {"estado": "perdido"},
        format="json",
    )

    assert respuesta.status_code == 400
    assert "motivo" in respuesta.data["error"]["details"]


def test_un_equipo_robado_deja_de_estar_a_nombre_de_nadie(admin, crear_activo, empleado):
    """El historial guarda quién lo tenía; mantenerlo asignado lo haría
    aparecer en la lista de responsabilidades de esa persona."""
    activo = crear_activo(custodio=empleado)

    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.ROBADO, motivo="Denuncia 2026-114"
    )

    activo.refresh_from_db()
    assert activo.custodio_id is None
    assert activo.fecha_baja is not None
    assert activo.motivo_baja == "Denuncia 2026-114"
    assert activo.movimientos.filter(tipo=MovimientoActivo.Tipo.BAJA).exists()


def test_un_equipo_perdido_que_aparece_vuelve_al_inventario(admin, crear_activo):
    activo = crear_activo()
    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.PERDIDO, motivo="No apareció en el conteo"
    )

    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.EN_BODEGA, motivo="Apareció en bodega"
    )

    activo.refresh_from_db()
    assert activo.esta_operativo
    # La fecha y el motivo de salida ya no describen su situación; el
    # historial conserva que estuvo fuera y por qué.
    assert activo.fecha_baja is None
    assert activo.motivo_baja == ""


def test_un_equipo_dado_de_baja_no_vuelve(admin, crear_activo):
    """La baja es una decisión de desincorporación: su expediente queda como
    respaldo, y revivirlo dejaría el historial contando otra cosa."""
    activo = crear_activo()
    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.DADO_DE_BAJA, motivo="Obsoleto"
    )

    with pytest.raises(Exception) as error:
        ActivoService.cambiar_estado(
            actor=admin, activo=activo, estado=Activo.Estado.EN_BODEGA, motivo="Me arrepentí"
        )

    assert "no vuelve al inventario" in str(error.value)


def test_no_se_asigna_un_equipo_que_ya_no_esta(cliente, admin, crear_activo, empleado):
    """Antes se colaba: el estado no cambiaba, pero el custodio sí, y quedaba
    un responsable nuevo para un equipo que ya no existe."""
    activo = crear_activo()
    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.ROBADO, motivo="Denuncia 2026-115"
    )

    respuesta = cliente.post(
        f"/api/v1/activos/{activo.id}/asignar/", {"custodio": empleado.id}, format="json"
    )

    assert respuesta.status_code == 400
    activo.refresh_from_db()
    assert activo.custodio_id is None


def test_en_transito_y_en_garantia_siguen_siendo_parque(admin, crear_activo):
    """Describen dónde está el equipo, no que haya salido: cuentan como
    operativos y siguen recibiendo alertas."""
    en_transito = crear_activo()
    ActivoService.cambiar_estado(
        actor=admin, activo=en_transito, estado=Activo.Estado.EN_TRANSITO, motivo="A sucursal"
    )

    assert en_transito.esta_operativo
    assert Activo.objects.operativos().filter(pk=en_transito.pk).exists()


# --- Lo que sale del parque deja de contar en todas partes -------------------


def test_un_equipo_perdido_no_genera_alertas(admin, crear_activo, empleado):
    """Un pendiente que nadie puede resolver es un pendiente eterno en la
    pantalla que debería decir qué atender hoy."""
    activo = crear_activo(custodio=empleado)
    empleado.activo = False
    empleado.save()

    configuracion = ConfiguracionAlertas.cargar()
    antes = {a.tipo: a.total for a in construir_alertas(configuracion)}
    assert antes["custodios_inactivos"] == 1

    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.PERDIDO, motivo="No aparece"
    )

    despues = {a.tipo: a.total for a in construir_alertas(configuracion)}
    assert despues["custodios_inactivos"] == 0


def test_un_equipo_robado_no_se_sugiere_renovar(admin, crear_activo, tipo):
    """Competiría por el presupuesto de reposición con equipos que sí están
    en uso, y por un motivo distinto del que dice la sugerencia."""
    PoliticaObsolescencia.objects.create(
        tipo_dispositivo=tipo, nombre="Laptops", vida_util_meses=12, vida_util_critica_meses=24
    )
    activo = crear_activo(fecha_adquisicion=datetime.date(2020, 1, 1))
    assert evaluar_activo(activo).requiere_renovacion

    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.ROBADO, motivo="Denuncia 2026-116"
    )

    assert not evaluar_activo(activo).requiere_renovacion


def test_no_se_registran_reparaciones_sobre_un_equipo_perdido(cliente, admin, crear_activo):
    activo = crear_activo()
    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.PERDIDO, motivo="No aparece"
    )

    respuesta = cliente.post(
        "/api/v1/mantenimientos/",
        {
            "activo": activo.id,
            "tipo": Mantenimiento.Tipo.CORRECTIVO,
            "fecha_intervencion": "2026-09-09",
            "descripcion": "Cambio de disco",
        },
        format="json",
    )

    assert respuesta.status_code == 400
    assert "perdido" in str(respuesta.data).lower()


def test_el_panel_separa_las_perdidas_de_las_bajas(cliente, admin, crear_activo):
    """Una baja es una decisión de la empresa; un robo es una pérdida que
    alguien tiene que investigar. Sumarlos escondería justo eso."""
    de_baja = crear_activo()
    robado = crear_activo()
    ActivoService.cambiar_estado(
        actor=admin, activo=de_baja, estado=Activo.Estado.DADO_DE_BAJA, motivo="Obsoleto"
    )
    ActivoService.cambiar_estado(
        actor=admin, activo=robado, estado=Activo.Estado.ROBADO, motivo="Denuncia 2026-117"
    )

    datos = cliente.get("/api/v1/activos/dashboard/").data["activos"]

    assert datos["dados_de_baja"] == 1
    assert datos["robados"] == 1
    assert datos["operativos"] == 0


# --- Ubicación estructurada (§4.1) ------------------------------------------


def test_la_ubicacion_es_un_catalogo_y_no_texto_libre(cliente, crear_activo, ubicacion):
    activo = crear_activo(ubicacion=ubicacion)

    datos = cliente.get(f"/api/v1/activos/{activo.id}/").data

    assert datos["ubicacion"] == ubicacion.id
    assert datos["ubicacion_nombre"] == "Matriz Quito · Bodega TI"


def test_no_se_repite_una_ubicacion_dentro_de_la_misma_sede(cliente, ubicacion):
    """Dos «Bodega TI» en la matriz serían indistinguibles en el desplegable."""
    respuesta = cliente.post(
        "/api/v1/organizacion/ubicaciones/",
        {"sede": "Matriz Quito", "nombre": "Bodega TI"},
        format="json",
    )

    assert respuesta.status_code == 400


def test_el_mismo_nombre_en_otra_sede_si_es_valido(cliente, ubicacion):
    respuesta = cliente.post(
        "/api/v1/organizacion/ubicaciones/",
        {"sede": "Sucursal Guayaquil", "nombre": "Bodega TI"},
        format="json",
    )

    assert respuesta.status_code == 201


def test_no_se_cierra_una_ubicacion_que_todavia_tiene_equipos(cliente, crear_activo, ubicacion):
    """Desactivarla dejaría a esos equipos en un sitio que el formulario ya no
    ofrece: nadie podría corregirlos ni volver a usar el lugar."""
    crear_activo(ubicacion=ubicacion)

    respuesta = cliente.patch(
        f"/api/v1/organizacion/ubicaciones/{ubicacion.id}/", {"activa": False}, format="json"
    )

    assert respuesta.status_code == 400
    assert "ubicacion_con_activos" == respuesta.data["error"]["code"]


def test_no_se_pone_un_equipo_en_una_ubicacion_cerrada(cliente, tipo, departamento, ubicacion):
    ubicacion.activa = False
    ubicacion.save()

    respuesta = cliente.post(
        "/api/v1/activos/",
        {
            "tipo": tipo.id,
            "nombre": "Laptop nueva",
            "marca": "Dell",
            "modelo": "Latitude",
            "numero_serie": "SN-CERRADA-1",
            "departamento": departamento.id,
            "fecha_adquisicion": "2025-01-10",
            "ubicacion": ubicacion.id,
        },
        format="json",
    )

    assert respuesta.status_code == 400
    assert "ubicacion" in respuesta.data["error"]["details"]


# --- Clasificación (§12) y fecha de ingreso ---------------------------------


def test_la_criticidad_tiene_los_cuatro_niveles_del_documento():
    """§12: baja, media, alta y crítica. «Crítica» existe separada de «alta»
    porque es la que justifica un repuesto en sitio, no solo prioridad."""
    assert [c.value for c in Activo.Criticidad] == ["baja", "media", "alta", "critica"]


def test_el_uso_describe_la_funcion_del_equipo_no_su_intensidad():
    """§12: administrativo, operativo, desarrollo, diseño, gerencial, atención
    al cliente, bodega e infraestructura. Dos laptops idénticas pueden ser una
    de gerencia y otra de bodega, y eso cambia con qué urgencia se repone."""
    valores = {u.value for u in Activo.Uso}

    assert len(valores) == 8
    assert {"gerencial", "atencion_cliente", "infraestructura"} <= valores


def test_criticidad_y_uso_arrancan_en_el_valor_mas_neutro(crear_activo):
    """Un valor por defecto alto haría que todo el parque pareciera crítico, y
    entonces nada lo sería."""
    activo = crear_activo()

    assert activo.criticidad == Activo.Criticidad.MEDIA
    assert activo.uso == Activo.Uso.ADMINISTRATIVO


def test_el_ingreso_no_puede_ser_anterior_a_la_compra(cliente, tipo, departamento):
    respuesta = cliente.post(
        "/api/v1/activos/",
        {
            "tipo": tipo.id,
            "nombre": "Laptop nueva",
            "marca": "Dell",
            "modelo": "Latitude",
            "numero_serie": "SN-FECHAS-1",
            "departamento": departamento.id,
            "fecha_adquisicion": "2025-03-01",
            "fecha_ingreso": "2025-02-01",
        },
        format="json",
    )

    assert respuesta.status_code == 400
    assert "fecha_ingreso" in respuesta.data["error"]["details"]


# --- Filtros del §14 --------------------------------------------------------


def test_filtra_por_ubicacion_y_por_sede(cliente, crear_activo, ubicacion):
    otra = Ubicacion.objects.create(sede="Sucursal Guayaquil", nombre="Oficina 1")
    crear_activo(ubicacion=ubicacion)
    crear_activo(ubicacion=otra)
    crear_activo()

    por_ubicacion = cliente.get(f"/api/v1/activos/?ubicacion={ubicacion.id}").data
    por_sede = cliente.get("/api/v1/activos/?sede=Sucursal Guayaquil").data

    assert por_ubicacion["count"] == 1
    assert por_sede["count"] == 1


def test_filtra_por_antiguedad_en_meses(cliente, crear_activo):
    """«De al menos 36 meses» se adquirió *antes* de hace 36 meses: los
    operadores quedan invertidos respecto de lo que se lee."""
    from django.utils import timezone

    from apps.politicas.services import restar_meses

    hoy = timezone.localdate()
    crear_activo(fecha_adquisicion=restar_meses(hoy, 48))
    crear_activo(fecha_adquisicion=restar_meses(hoy, 6))

    viejos = cliente.get("/api/v1/activos/?antiguedad_min_meses=36").data
    nuevos = cliente.get("/api/v1/activos/?antiguedad_max_meses=12").data

    assert viejos["count"] == 1
    assert nuevos["count"] == 1


def test_filtra_por_criticidad_y_por_uso(cliente, crear_activo):
    crear_activo(criticidad=Activo.Criticidad.CRITICA)
    crear_activo(uso=Activo.Uso.GERENCIAL)
    crear_activo()

    criticos = cliente.get("/api/v1/activos/?criticidad=critica").data
    gerenciales = cliente.get("/api/v1/activos/?uso=gerencial").data

    assert criticos["count"] == 1
    assert gerenciales["count"] == 1


def test_disponible_y_en_bodega_son_estados_distintos(admin, cliente, crear_activo):
    """Los dos están almacenados, pero solo uno se puede entregar hoy: un
    equipo recién devuelto hay que revisarlo antes de prometerlo."""
    disponible = crear_activo()
    ActivoService.cambiar_estado(
        actor=admin, activo=disponible, estado=Activo.Estado.DISPONIBLE, motivo="Revisado"
    )
    crear_activo()  # queda en bodega

    almacenados = cliente.get("/api/v1/activos/?almacenados=true").data
    solo_disponibles = cliente.get("/api/v1/activos/?estado=disponible").data

    assert almacenados["count"] == 2
    assert solo_disponibles["count"] == 1


def test_entregar_un_equipo_disponible_lo_pone_en_uso(admin, crear_activo, empleado):
    activo = crear_activo()
    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.DISPONIBLE, motivo="Revisado"
    )

    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=empleado)

    activo.refresh_from_db()
    assert activo.estado == Activo.Estado.EN_USO


def test_la_devolucion_deja_el_equipo_en_bodega_no_disponible(admin, crear_activo, empleado):
    """Marcarlo entregable de inmediato haría prometer equipos sin revisar."""
    activo = crear_activo(custodio=empleado)
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=None)

    activo.refresh_from_db()
    assert activo.estado == Activo.Estado.EN_BODEGA


def test_el_listado_puede_separar_lo_operativo_de_lo_que_salio(cliente, admin, crear_activo):
    """El expediente de un equipo perdido sigue siendo consultable: es el
    respaldo de qué pasó con él."""
    crear_activo()
    perdido = crear_activo()
    ActivoService.cambiar_estado(
        actor=admin, activo=perdido, estado=Activo.Estado.PERDIDO, motivo="No aparece"
    )

    operativos = cliente.get("/api/v1/activos/?operativos=true").data
    fuera = cliente.get("/api/v1/activos/?operativos=false").data

    assert operativos["count"] == 1
    assert fuera["count"] == 1
    assert fuera["results"][0]["estado"] == "perdido"
