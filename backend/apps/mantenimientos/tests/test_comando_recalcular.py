"""El comando que mantiene vivas las sugerencias de renovación (RF-07).

Es la pieza que corre por cron, y por eso importa que esté probada: **si falla,
falla en silencio**. Nadie abre una pantalla que diga «el recálculo de anoche no
corrió»; lo que se ve es un listado de sugerencias que sigue contestando lo
mismo que ayer, que es exactamente lo que un listado correcto también hace.

Lo que el comando resuelve es un caso que ningún evento del sistema dispara: el
criterio de longevidad del §11 se cumple **por el paso del tiempo**. Un equipo
que nadie tocó cruza sus cuarenta y ocho meses sin que nada lo guarde, y la
caché que alimenta los filtros y el orden del listado se queda vieja. Las
respuestas de la API lo calculan en vivo, así que el síntoma no es una ficha
equivocada: es que ese equipo no sale al filtrar por «requiere renovación».
"""

import datetime

import pytest
from django.core.management import call_command

from apps.activos.models import Activo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.organizacion.models import Departamento
from apps.politicas.models import NivelRenovacion, PoliticaObsolescencia
from apps.politicas.services import restar_meses
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_cron", email="admin_cron@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def tipo(db):
    return TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")


@pytest.fixture
def politica(tipo):
    """Los umbrales tal como los enuncia el §11."""
    return PoliticaObsolescencia.objects.create(
        nombre="Laptops corporativas",
        tipo_dispositivo=tipo,
        vida_util_meses=48,
        vida_util_critica_meses=60,
        max_mantenimientos=3,
        ventana_mantenimientos_meses=12,
    )


@pytest.fixture
def crear_activo(admin, tipo):
    area = Departamento.objects.create(nombre="Sistemas", codigo="SIS")
    contador = {"n": 0}

    def _crear(meses_de_antiguedad=0):
        from django.utils import timezone

        contador["n"] += 1
        return ActivoService.crear_activo(
            actor=admin,
            tipo=tipo,
            nombre=f"Equipo {contador['n']}",
            marca="Lenovo",
            modelo="ThinkPad",
            numero_serie=f"SN-CRON-{contador['n']}",
            departamento=area,
            fecha_adquisicion=restar_meses(timezone.localdate(), meses_de_antiguedad),
        )

    return _crear


def _envejecer_la_cache(activo):
    """Deja la caché como la dejó el día en que el equipo era nuevo.

    Se escribe con `update` para no pasar por el servicio: lo que se quiere
    montar es justamente el estado que nadie recalculó.
    """
    Activo.objects.filter(pk=activo.pk).update(
        requiere_renovacion=False, nivel_renovacion=NivelRenovacion.NINGUNO
    )


# --- Para lo que existe -----------------------------------------------------


def test_enciende_la_sugerencia_que_el_tiempo_encendio_solo(crear_activo, politica):
    """El caso que ningún evento dispara, y la razón de que el comando exista."""
    activo = crear_activo(meses_de_antiguedad=60)
    _envejecer_la_cache(activo)

    call_command("recalcular_indicadores")

    activo.refresh_from_db()
    assert activo.requiere_renovacion is True
    assert activo.nivel_renovacion == NivelRenovacion.RECOMENDADO


def test_tambien_la_apaga_cuando_deja_de_corresponder(crear_activo, politica):
    """Un umbral que se alarga —o una política que se ajusta— tiene que poder
    devolver un equipo a la normalidad. Un recálculo que solo enciende
    convierte la sugerencia en una marca permanente."""
    activo = crear_activo(meses_de_antiguedad=60)
    call_command("recalcular_indicadores")
    assert Activo.objects.get(pk=activo.pk).requiere_renovacion is True

    politica.vida_util_meses = 96
    politica.vida_util_critica_meses = 120
    politica.save(update_fields=["vida_util_meses", "vida_util_critica_meses"])

    call_command("recalcular_indicadores")

    activo.refresh_from_db()
    assert activo.requiere_renovacion is False
    assert activo.nivel_renovacion == NivelRenovacion.NINGUNO


def test_correrlo_dos_veces_deja_el_mismo_estado(crear_activo, politica):
    """Es idempotente, y su docstring lo promete: el cron puede repetirse tras
    un fallo sin que nadie tenga que comprobar si ya había corrido."""
    activo = crear_activo(meses_de_antiguedad=50)

    call_command("recalcular_indicadores")
    activo.refresh_from_db()
    primera = (activo.requiere_renovacion, activo.nivel_renovacion, activo.updated_at)

    call_command("recalcular_indicadores")
    activo.refresh_from_db()

    assert (activo.requiere_renovacion, activo.nivel_renovacion) == primera[:2]


def test_dice_cuantos_evaluo_y_cuantos_quedaron_con_sugerencia(crear_activo, politica, capsys):
    """La salida es lo único que queda de una corrida por cron: sin ella, el
    registro del sistema solo puede decir que el proceso terminó."""
    crear_activo(meses_de_antiguedad=60)
    crear_activo(meses_de_antiguedad=50)
    crear_activo(meses_de_antiguedad=2)

    call_command("recalcular_indicadores")

    salida = capsys.readouterr().out
    assert "3 activo(s) evaluados" in salida
    assert "2 con sugerencia" in salida
    assert "1 con reemplazo recomendado" in salida


# --- Qué entra y qué no -----------------------------------------------------


def test_omite_lo_que_salio_del_parque(crear_activo, politica, admin):
    """Un equipo robado compitiendo por el presupuesto de reposición es ruido:
    la sugerencia dice «reemplácelo» sobre algo que ya no está."""
    activo = crear_activo(meses_de_antiguedad=60)
    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.ROBADO, motivo="Denuncia"
    )
    _envejecer_la_cache(activo)

    call_command("recalcular_indicadores")

    assert Activo.objects.get(pk=activo.pk).requiere_renovacion is False


def test_con_incluir_bajas_limpia_la_sugerencia_que_arrastraba(
    crear_activo, politica, admin, capsys
):
    """La bandera los hace pasar por el recálculo, no les enciende la sugerencia.

    Un equipo viejo que se roban arrastra su «reemplazo recomendado» encendido
    de cuando estaba en uso, y sin la bandera nadie vuelve a mirarlo: el
    recorrido normal lo omite justamente porque ya no está. Con ella, la
    política contesta lo que corresponde —no se sugiere renovar lo que salió
    del parque— y la caché se queda limpia.
    """
    activo = crear_activo(meses_de_antiguedad=60)
    call_command("recalcular_indicadores")
    assert Activo.objects.get(pk=activo.pk).requiere_renovacion is True

    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.ROBADO, motivo="Denuncia"
    )
    capsys.readouterr()

    call_command("recalcular_indicadores", "--incluir-bajas")

    assert "1 activo(s) evaluados" in capsys.readouterr().out
    assert Activo.objects.get(pk=activo.pk).requiere_renovacion is False


def test_sin_la_bandera_ese_equipo_ni_se_mira(crear_activo, politica, admin, capsys):
    """Es la contraparte: el recorrido de cada noche no gasta tiempo en lo que
    ya no está, y por eso la limpieza necesita pedirse."""
    activo = crear_activo(meses_de_antiguedad=60)
    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.ROBADO, motivo="Denuncia"
    )
    capsys.readouterr()

    call_command("recalcular_indicadores")

    assert "0 activo(s) evaluados" in capsys.readouterr().out


# --- La empresa, que es donde un cron se equivoca en silencio ---------------


def test_recorre_el_sistema_entero_y_no_una_sola_empresa(crear_activo, politica, admin):
    """Fuera de una petición no hay empresa activa y los gestores no filtran.

    Es la decisión documentada en `apps.empresas.contexto`, y aquí es donde se
    nota: un cron que se quedara con la empresa por defecto dejaría a las demás
    con las sugerencias congeladas para siempre, sin que nada lo dijera. La
    prueba sale a propósito del `usando_empresa` de la configuración global.
    """
    from apps.empresas.contexto import _empresa_explicita, usando_empresa
    from apps.empresas.models import Empresa

    otra = Empresa.objects.create(codigo="OTRA", nombre="La otra empresa")
    with usando_empresa(otra):
        ajeno = crear_activo(meses_de_antiguedad=60)
        PoliticaObsolescencia.objects.create(
            nombre="Laptops de la otra",
            tipo_dispositivo=TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP"),
            vida_util_meses=48,
            vida_util_critica_meses=60,
            max_mantenimientos=3,
            ventana_mantenimientos_meses=12,
        )
        _envejecer_la_cache(ajeno)

    propio = crear_activo(meses_de_antiguedad=60)
    _envejecer_la_cache(propio)
    # Sin esto la prueba pasaría aunque los dos equipos hubieran quedado en la
    # misma empresa, que es justo lo que no se está probando.
    assert propio.empresa_id != ajeno.empresa_id

    # Como lo lanzaría el cron: sin empresa activa.
    testigo = _empresa_explicita.set(None)
    try:
        call_command("recalcular_indicadores")
    finally:
        _empresa_explicita.reset(testigo)

    assert Activo.objects.todas().get(pk=propio.pk).requiere_renovacion is True
    assert Activo.objects.todas().get(pk=ajeno.pk).requiere_renovacion is True


def test_un_parque_vacio_no_es_un_error(db):
    """La primera corrida de un sistema recién instalado pasa por aquí."""
    call_command("recalcular_indicadores")


def test_sin_politica_configurada_no_sugiere_nada(crear_activo):
    """Sin umbrales no hay criterio: inventarse uno haría aparecer sugerencias
    que nadie configuró."""
    activo = crear_activo(meses_de_antiguedad=120)

    call_command("recalcular_indicadores")

    assert Activo.objects.get(pk=activo.pk).requiere_renovacion is False


def test_la_fecha_de_la_ficha_no_se_toca(crear_activo, politica):
    """El recálculo es mantenimiento interno de una caché, no una edición.

    Si moviera `updated_at`, el panel contaría cada activo del parque como
    «actualizado hoy» todas las mañanas y el indicador de equipos sin tocar en
    noventa días no volvería a encenderse nunca.
    """
    activo = crear_activo(meses_de_antiguedad=60)
    antes = Activo.objects.get(pk=activo.pk).updated_at

    call_command("recalcular_indicadores")

    assert Activo.objects.get(pk=activo.pk).updated_at == antes


def test_no_deja_rastro_en_la_bitacora(crear_activo, politica):
    """Nadie cambió nada: apuntarlo llenaría el historial del equipo de líneas
    que no cuentan ningún hecho."""
    activo = crear_activo(meses_de_antiguedad=60)
    movimientos = activo.movimientos.count()

    call_command("recalcular_indicadores")

    assert activo.movimientos.count() == movimientos


def test_la_ventana_movil_se_resuelve_sin_una_consulta_por_activo(
    crear_activo, politica, django_assert_max_num_queries
):
    """El comando corre sobre el parque entero: resolver la ventana equipo por
    equipo eran dos viajes a la base por renglón, y con diez mil equipos eso es
    la diferencia entre un minuto y una hora."""
    for meses in (60, 55, 50, 49, 20, 3):
        crear_activo(meses_de_antiguedad=meses)

    # Holgado a propósito: lo que se fija es que no crezca **con el parque**,
    # no un número exacto que cambiaría con cualquier refactor.
    with django_assert_max_num_queries(30):
        call_command("recalcular_indicadores")


def test_las_fechas_se_cuentan_en_meses_de_calendario(crear_activo, politica):
    """Cuarenta y siete meses todavía no son cuarenta y ocho: el umbral del
    §11 se cruza el día del mes, no a los 47 × 30 días."""
    activo = crear_activo(meses_de_antiguedad=47)

    call_command("recalcular_indicadores")

    assert Activo.objects.get(pk=activo.pk).requiere_renovacion is False


def test_el_dia_exacto_del_umbral_ya_cuenta(crear_activo, politica):
    activo = crear_activo(meses_de_antiguedad=48)

    call_command("recalcular_indicadores")

    activo.refresh_from_db()
    assert activo.requiere_renovacion is True
    assert activo.nivel_renovacion == NivelRenovacion.EVALUAR


def test_la_antiguedad_se_mide_desde_la_compra(crear_activo, politica):
    """Y no desde el ingreso al inventario: el equipo envejece desde que se
    fabricó y se compró, no desde que alguien lo registró."""
    activo = crear_activo(meses_de_antiguedad=60)
    activo.fecha_ingreso = datetime.date.today()
    activo.save(update_fields=["fecha_ingreso"])

    call_command("recalcular_indicadores")

    assert Activo.objects.get(pk=activo.pk).requiere_renovacion is True
