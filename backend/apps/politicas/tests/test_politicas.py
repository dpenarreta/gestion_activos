"""Parametrización de umbrales y motor de sugerencia de renovación
(RF-06, RF-07)."""

import datetime

import pytest
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from apps.activos.models import Activo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.mantenimientos.models import CatalogoComponente, Mantenimiento
from apps.mantenimientos.services import MantenimientoService
from apps.organizacion.models import Departamento
from apps.politicas.models import PoliticaObsolescencia
from apps.politicas.services import evaluar_activo, resolver_politica
from apps.users.models import User


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_pol", email="admin_pol@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def departamento(db):
    return Departamento.objects.create(nombre="Sistemas", codigo="SIS")


@pytest.fixture
def tipo_laptop(db):
    return TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")


@pytest.fixture
def crear_activo(admin, departamento, tipo_laptop):
    contador = {"n": 0}

    def _crear(tipo=None, fecha_adquisicion=datetime.date(2024, 1, 10)):
        contador["n"] += 1
        return ActivoService.crear_activo(
            actor=admin,
            tipo=tipo or tipo_laptop,
            nombre=f"Equipo {contador['n']}",
            marca="Lenovo",
            modelo="ThinkPad",
            numero_serie=f"SN-POL-{contador['n']}",
            departamento=departamento,
            fecha_adquisicion=fecha_adquisicion,
        )

    return _crear


def _registrar_mantenimientos(admin, activo, cantidad, componentes=None):
    for numero in range(cantidad):
        MantenimientoService.registrar(
            actor=admin,
            activo=activo,
            componentes=componentes,
            tipo=Mantenimiento.Tipo.CORRECTIVO,
            fecha_intervencion=datetime.date(2024, 6, 1),
            tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
            responsable="Soporte",
            descripcion=f"Intervención {numero}",
        )


# --- RF-06: resolución de la política aplicable ---------------------------


def test_la_politica_especifica_del_tipo_gana_sobre_la_global(tipo_laptop):
    PoliticaObsolescencia.objects.create(nombre="Global", max_mantenimientos=10)
    especifica = PoliticaObsolescencia.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo_laptop, max_mantenimientos=3
    )

    assert resolver_politica(tipo_laptop) == especifica


def test_un_tipo_sin_politica_propia_cae_en_la_global(db):
    global_ = PoliticaObsolescencia.objects.create(nombre="Global", max_mantenimientos=10)
    impresora = TipoDispositivo.objects.create(nombre="Impresora", codigo="IMP")

    assert resolver_politica(impresora) == global_


def test_una_politica_especifica_desactivada_no_cae_de_vuelta_en_la_global(tipo_laptop):
    """Desactivarla significa 'este tipo no se evalúa', que es distinto de
    'este tipo usa el criterio común'."""
    PoliticaObsolescencia.objects.create(nombre="Global", max_mantenimientos=1)
    PoliticaObsolescencia.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo_laptop, max_mantenimientos=99, activa=False
    )

    assert resolver_politica(tipo_laptop) is None


def test_solo_puede_existir_una_politica_global(db):
    """Con dos globales, "la global" dejaría de ser una referencia unívoca y
    la resolución sería arbitraria."""
    PoliticaObsolescencia.objects.create(nombre="Global", max_mantenimientos=10)

    with pytest.raises(IntegrityError), transaction.atomic():
        PoliticaObsolescencia.objects.create(nombre="Otra global", max_mantenimientos=5)


def test_una_politica_sin_ningun_umbral_es_rechazada(cliente):
    respuesta = cliente.post(
        "/api/v1/politicas/", {"nombre": "Vacía", "activa": True}, format="json"
    )

    assert respuesta.status_code == 400
    assert "al menos un umbral" in str(respuesta.json())


# --- RF-07: motor de sugerencia -------------------------------------------


def test_sin_politica_configurada_ningun_activo_sugiere_renovacion(crear_activo, admin):
    activo = crear_activo()
    _registrar_mantenimientos(admin, activo, 20)
    activo.refresh_from_db()

    resultado = evaluar_activo(activo)

    assert resultado.requiere_renovacion is False
    assert resultado.motivos == []


def test_exceder_el_limite_de_mantenimientos_dispara_la_sugerencia(
    crear_activo, admin, tipo_laptop
):
    PoliticaObsolescencia.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo_laptop, max_mantenimientos=2
    )
    activo = crear_activo()
    _registrar_mantenimientos(admin, activo, 3)
    activo.refresh_from_db()

    resultado = evaluar_activo(activo)

    assert resultado.requiere_renovacion is True
    motivo = next(m for m in resultado.motivos if m["criterio"] == "mantenimientos")
    assert motivo["valor_actual"] == 3
    assert motivo["umbral"] == 2


def test_estar_justo_en_el_limite_de_mantenimientos_no_dispara_la_sugerencia(
    crear_activo, admin, tipo_laptop
):
    """El umbral es 'máximo tolerado': se sugiere al excederlo, no al
    alcanzarlo."""
    PoliticaObsolescencia.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo_laptop, max_mantenimientos=3
    )
    activo = crear_activo()
    _registrar_mantenimientos(admin, activo, 3)
    activo.refresh_from_db()

    assert evaluar_activo(activo).requiere_renovacion is False


def test_exceder_el_limite_de_piezas_criticas_dispara_la_sugerencia(
    crear_activo, admin, tipo_laptop
):
    PoliticaObsolescencia.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo_laptop, max_componentes_criticos=1
    )
    tarjeta_madre = CatalogoComponente.objects.create(
        nombre="Tarjeta madre", codigo="MB", es_critico=True
    )
    activo = crear_activo()
    _registrar_mantenimientos(
        admin, activo, 1, componentes=[{"componente": tarjeta_madre, "cantidad": 2}]
    )
    activo.refresh_from_db()

    resultado = evaluar_activo(activo)

    assert resultado.requiere_renovacion is True
    assert any(m["criterio"] == "componentes_criticos" for m in resultado.motivos)


def test_cumplir_la_vida_util_dispara_la_sugerencia_sin_ninguna_intervencion(
    crear_activo, tipo_laptop
):
    """El criterio de longevidad se cumple por el paso del tiempo: un equipo
    que nadie tocó también debe alertar."""
    PoliticaObsolescencia.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo_laptop, vida_util_meses=36
    )
    from django.utils import timezone

    hoy = timezone.localdate()
    # Cuatro años de calendario exactos, no 365*4 días: entre medias hay un
    # bisiesto y la diferencia de un día cambia el mes cumplido.
    hace_cuatro_anios = hoy.replace(year=hoy.year - 4)
    activo = crear_activo(fecha_adquisicion=hace_cuatro_anios)

    resultado = evaluar_activo(activo)

    assert resultado.requiere_renovacion is True
    motivo = next(m for m in resultado.motivos if m["criterio"] == "longevidad")
    assert motivo["umbral"] == 36
    assert motivo["valor_actual"] == 48


def test_un_umbral_vacio_desactiva_ese_criterio_no_lo_pone_en_cero(
    crear_activo, admin, tipo_laptop
):
    """Dejar `vida_util_meses` vacío significa 'no evaluar longevidad', no
    'cero meses' — que haría alertar a todos los equipos."""
    PoliticaObsolescencia.objects.create(
        nombre="Solo mantenimientos", tipo_dispositivo=tipo_laptop, max_mantenimientos=5
    )
    activo = crear_activo(fecha_adquisicion=datetime.date(2010, 1, 1))

    resultado = evaluar_activo(activo)

    assert resultado.requiere_renovacion is False


def test_los_tres_criterios_se_acumulan_en_motivos_distintos(crear_activo, admin, tipo_laptop):
    PoliticaObsolescencia.objects.create(
        nombre="Estricta",
        tipo_dispositivo=tipo_laptop,
        max_mantenimientos=1,
        max_componentes_criticos=0,
        vida_util_meses=1,
    )
    fuente = CatalogoComponente.objects.create(
        nombre="Fuente de poder", codigo="PSU", es_critico=True
    )
    activo = crear_activo(fecha_adquisicion=datetime.date(2020, 1, 1))
    _registrar_mantenimientos(admin, activo, 2, componentes=[{"componente": fuente}])
    activo.refresh_from_db()

    resultado = evaluar_activo(activo)

    criterios = {m["criterio"] for m in resultado.motivos}
    assert criterios == {"mantenimientos", "componentes_criticos", "longevidad"}


def test_un_activo_dado_de_baja_ya_no_sugiere_renovacion(crear_activo, admin, tipo_laptop):
    PoliticaObsolescencia.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo_laptop, max_mantenimientos=0
    )
    activo = crear_activo()
    _registrar_mantenimientos(admin, activo, 1)
    activo.refresh_from_db()
    assert evaluar_activo(activo).requiere_renovacion is True

    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.DADO_DE_BAJA, motivo="Reemplazado"
    )

    assert evaluar_activo(activo).requiere_renovacion is False


# --- API -------------------------------------------------------------------


def test_el_listado_de_sugerencias_devuelve_los_activos_con_sus_motivos(
    cliente, crear_activo, admin, tipo_laptop
):
    PoliticaObsolescencia.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo_laptop, max_mantenimientos=1
    )
    con_alerta = crear_activo()
    _registrar_mantenimientos(admin, con_alerta, 2)
    crear_activo()  # sano, no debe aparecer

    respuesta = cliente.get("/api/v1/politicas/sugerencias/")

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["total"] == 1
    resultado = cuerpo["resultados"][0]
    assert resultado["codigo_barras"] == con_alerta.codigo_barras
    assert resultado["motivos"][0]["criterio"] == "mantenimientos"


def test_subir_el_umbral_apaga_las_alertas_ya_encendidas(cliente, crear_activo, admin, tipo_laptop):
    """Si la reconfiguración no reevaluara, el cambio parecería no surtir
    efecto hasta la próxima intervención."""
    politica = PoliticaObsolescencia.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo_laptop, max_mantenimientos=1
    )
    activo = crear_activo()
    _registrar_mantenimientos(admin, activo, 2)
    activo.refresh_from_db()
    assert activo.requiere_renovacion is True

    cliente.patch(f"/api/v1/politicas/{politica.id}/", {"max_mantenimientos": 10}, format="json")

    activo.refresh_from_db()
    assert activo.requiere_renovacion is False


def test_la_ficha_del_activo_expone_el_veredicto_de_renovacion(
    cliente, crear_activo, admin, tipo_laptop
):
    PoliticaObsolescencia.objects.create(
        nombre="Laptops", tipo_dispositivo=tipo_laptop, max_mantenimientos=0
    )
    activo = crear_activo()
    _registrar_mantenimientos(admin, activo, 1)

    respuesta = cliente.get(f"/api/v1/activos/{activo.id}/")

    renovacion = respuesta.json()["renovacion"]
    assert renovacion["requiere_renovacion"] is True
    assert renovacion["politica_aplicada"] == "Laptops"


def test_una_segunda_politica_global_se_rechaza_con_un_error_util(cliente):
    """La restricción vive en la base, pero llegar hasta ella devolvía un 500.
    La interfaz deshabilita la opción cuando ya hay una; quien llame a la API
    directamente —o tenga dos pestañas abiertas— merece el mismo «ya existe».
    """
    PoliticaObsolescencia.objects.create(nombre="Global", vida_util_meses=48)

    respuesta = cliente.post(
        "/api/v1/politicas/", {"nombre": "Otra global", "vida_util_meses": 36}, format="json"
    )

    assert respuesta.status_code == 400
    assert "Ya existe una política global" in str(respuesta.data)


def test_editar_la_global_que_ya_existe_no_choca_consigo_misma(cliente):
    """La comprobación se excluye a sí misma: si no, la única global del
    sistema dejaría de poder editarse."""
    politica = PoliticaObsolescencia.objects.create(nombre="Global", vida_util_meses=48)

    respuesta = cliente.patch(
        f"/api/v1/politicas/{politica.id}/", {"vida_util_meses": 60}, format="json"
    )

    assert respuesta.status_code == 200
