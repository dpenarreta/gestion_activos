"""Que ningún modelo nuevo se quede fuera del aislamiento sin que nadie lo note.

Cobertura de tests/qa/features/multiempresa.feature (AC-EMP-027, AC-EMP-028).

El resto de las pruebas comprueban que **lo que existe hoy** no cruza empresas.
Esta comprueba otra cosa: que lo que se añada mañana tampoco. Es la única que
falla sola, sin que nadie escriba un caso, el día que alguien cree un modelo de
negocio y se olvide de acotarlo.

No es una precaución teórica. Ya pasó: `Mantenimiento`, `MovimientoActivo`,
`ComponenteUtilizado` y `Adjunto` heredaban de `BaseModel` y usaban el gestor
por defecto de Django, así que la bitácora de una empresa se leía desde la otra.
Se descubrió por casualidad, al sembrar datos en dos empresas para una
demostración —veinte intervenciones donde debían verse tres—, no por una prueba.
Y `Ubicacion` estaba igual hasta que esta prueba se escribió.

La regla que impone: **todo modelo de una app de negocio declara cómo se acota,
o figura aquí abajo con la razón por la que no se acota.** No hay tercera
opción, y añadir una línea a la lista obliga a escribir el porqué, que es
justamente la decisión que se estaba tomando sin pensarla.
"""

import pytest
from django.apps import apps as registro_de_apps
from django.core.exceptions import FieldError

from apps.empresas.managers import ATRIBUTO_RUTA

#: Dónde vive el dominio. Lo transversal —autenticación, permisos, identidad
#: visual— no describe activos de nadie y no entra en el recorrido.
APPS_DE_NEGOCIO = frozenset(
    {"activos", "organizacion", "mantenimientos", "politicas", "alertas", "adjuntos"}
)

#: Lo que **no** se acota, y por qué. Cada línea es una decisión tomada, no un
#: olvido tolerado: si mañana alguien añade una entrada aquí, tiene que escribir
#: la razón al lado, y esa frase es lo que se revisa.
GLOBALES_A_PROPOSITO = {
    "core.AuditLog": (
        "Lleva su propia columna `empresa` y su filtro en la vista, pero no "
        "hereda de ModeloDeEmpresa porque un evento puede legítimamente no "
        "pertenecer a ninguna: iniciar sesión, cambiar el tema, administrar "
        "cuentas. Ver apps.core.audit_views._de_la_empresa_activa."
    ),
    "empresas.Empresa": "Es el ámbito mismo: acotarla por sí misma no significa nada.",
    "empresas.MembresiaEmpresa": (
        "Dice qué empresas ve cada cuenta. Filtrarla por la empresa activa "
        "impediría ver —y cambiar— las demás de una persona."
    ),
    "permissions.ModulePermission": (
        "Modelo ancla sin tabla real: solo cuelga el catálogo de permisos de un "
        "ContentType propio."
    ),
    "authentication.Session": "La sesión es de la persona, no de la empresa en la que entra.",
    "authentication.PasswordResetToken": "Recuperar la contraseña no ocurre dentro de una empresa.",
    "authentication.LoginAttempt": (
        "El bloqueo por fuerza bruta cuenta intentos contra una cuenta, antes de "
        "saber en qué empresa trabaja — y antes de saber si la cuenta existe."
    ),
    "users.User": (
        "La cuenta es una sola persona en todo el despliegue; a qué empresas "
        "entra lo dice su membresía, no una copia de la cuenta por empresa."
    ),
    "branding.SiteTheme": (
        "La identidad visual es global por ahora. Está registrado como decisión "
        "pendiente en docs/multiempresa.md: si cada empresa debe tener la suya, "
        "este modelo pasa a acotarse y esta línea desaparece."
    ),
}


def _modelos_concretos():
    for configuracion in registro_de_apps.get_app_configs():
        if not configuracion.name.startswith("apps."):
            continue
        for modelo in configuracion.get_models():
            if modelo._meta.abstract or modelo._meta.proxy:
                continue
            yield configuracion.label, modelo


def _etiqueta(modelo) -> str:
    return f"{modelo._meta.app_label}.{modelo.__name__}"


MODELOS_DE_NEGOCIO = [
    pytest.param(modelo, id=_etiqueta(modelo))
    for etiqueta, modelo in _modelos_concretos()
    if etiqueta in APPS_DE_NEGOCIO
]


@pytest.mark.parametrize("modelo", MODELOS_DE_NEGOCIO)
def test_todo_modelo_de_negocio_se_acota_por_empresa(modelo):
    """O declara su ruta, o está en la lista con su razón. No hay tercera opción."""
    etiqueta = _etiqueta(modelo)
    if etiqueta in GLOBALES_A_PROPOSITO:
        pytest.skip(f"Global a propósito: {GLOBALES_A_PROPOSITO[etiqueta]}")

    ruta = getattr(type(modelo._default_manager), ATRIBUTO_RUTA, None)

    assert ruta, (
        f"{etiqueta} no se acota por empresa. Hereda de `ModeloDeEmpresa` si la "
        f"empresa es suya, o usa `gestor_de_lo_que_cuelga('<ruta>__empresa')` si "
        f"la hereda de otro modelo. Si de verdad debe ser global, añádelo a "
        f"GLOBALES_A_PROPOSITO con la razón escrita."
    )


@pytest.mark.django_db
@pytest.mark.parametrize("modelo", MODELOS_DE_NEGOCIO)
def test_la_ruta_declarada_llega_de_verdad_hasta_la_empresa(modelo):
    """Una ruta mal escrita filtra por nada y el gestor deja de proteger.

    `activo__empresa` es correcto; `activos__empresa` no existe y la consulta
    reventaría en producción, no aquí — o peor, un `activo__id` colaría sin
    error y filtraría por otra cosa.
    """
    etiqueta = _etiqueta(modelo)
    if etiqueta in GLOBALES_A_PROPOSITO:
        pytest.skip("Global a propósito")

    ruta = getattr(type(modelo._default_manager), ATRIBUTO_RUTA, None)
    if ruta is None:
        # Que falte la marca ya lo dice la prueba de arriba, con el mensaje que
        # explica qué hacer. Aquí solo se ensuciaría con un AttributeError.
        pytest.skip("Sin ruta declarada")

    try:
        modelo._default_manager.todas().filter(**{ruta: None}).exists()
    except FieldError as error:  # pragma: no cover - solo si alguien la rompe
        pytest.fail(f"{etiqueta} declara la ruta {ruta!r}, que no existe: {error}")

    campo_final = ruta.split("__")[-1]
    assert campo_final == "empresa", (
        f"{etiqueta} declara la ruta {ruta!r}, que no termina en `empresa`. "
        f"Filtraría por otra cosa sin dar error."
    )


def test_la_lista_de_excepciones_no_envejece():
    """Un modelo que ya no existe deja una excepción viva que nadie revisa."""
    existentes = {_etiqueta(modelo) for _, modelo in _modelos_concretos()}

    fantasmas = sorted(set(GLOBALES_A_PROPOSITO) - existentes)

    assert not fantasmas, (
        f"Estas excepciones apuntan a modelos que ya no existen: {fantasmas}. "
        f"Quítelas de GLOBALES_A_PROPOSITO."
    )


def test_cada_excepcion_dice_por_que():
    """La lista vale por las razones, no por los nombres."""
    sin_razon = sorted(
        etiqueta for etiqueta, razon in GLOBALES_A_PROPOSITO.items() if len(razon.strip()) < 40
    )

    assert not sin_razon, (
        f"Estas excepciones no explican por qué el modelo es global: {sin_razon}. "
        f"La razón es lo que se revisa; el nombre solo, no."
    )


@pytest.mark.django_db
def test_el_gestor_acotado_no_devuelve_lo_de_otra_empresa(db):
    """La comprobación de fondo, sobre un modelo de cada clase.

    Las de arriba miran la forma; esta mira el comportamiento, para que la marca
    no pueda quedarse puesta sobre un gestor que dejó de filtrar.
    """
    import datetime

    from apps.activos.models import Activo, TipoDispositivo
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa
    from apps.mantenimientos.models import Mantenimiento
    from apps.organizacion.models import Departamento

    propia = Empresa.objects.create(nombre="LaarCourier", codigo="LC")
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    with usando_empresa(otra):
        tipo = TipoDispositivo.objects.create(nombre="Cámara", codigo="CAM")
        area = Departamento.objects.create(nombre="Monitoreo", codigo="MON")
        ajeno = Activo.objects.create(
            tipo=tipo,
            nombre="Cámara ajena",
            marca="Hikvision",
            modelo="DS-2CD",
            numero_serie="SN-AJENO",
            codigo_barras="GA-CAM-AJENO",
            departamento=area,
            fecha_adquisicion=datetime.date(2025, 1, 10),
        )
        Mantenimiento.objects.create(
            activo=ajeno,
            tipo=Mantenimiento.Tipo.CORRECTIVO,
            fecha_intervencion=datetime.date(2026, 1, 15),
            tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
            responsable="Técnico ajeno",
            descripcion="Cambio de lente",
        )

    with usando_empresa(propia):
        # Un modelo que lleva la empresa encima y otro que la hereda de su
        # activo: las dos formas de acotar, comprobadas por su efecto.
        assert not Activo.objects.filter(pk=ajeno.pk).exists()
        assert not Mantenimiento.objects.filter(activo=ajeno).exists()
        # Salir del ámbito sigue siendo posible, pero hay que pedirlo por su
        # nombre, que es lo que lo hace visible en una revisión.
        assert Activo.objects.todas().filter(pk=ajeno.pk).exists()


# --- La otra forma de perder el filtro: congelarlo al importar ---------------


def _vistas_enrutadas():
    """Las clases de vista que el enrutador expone, no las que existen.

    Lo que importa es lo alcanzable: una vista sin URL es código muerto, y una
    ruta olvidada es una puerta.
    """
    from django.urls import get_resolver

    def recorrer(patrones):
        for patron in patrones:
            if hasattr(patron, "url_patterns"):
                yield from recorrer(patron.url_patterns)
                continue
            destino = patron.callback
            clase = getattr(destino, "cls", None) or getattr(destino, "view_class", None)
            if clase is not None:
                yield clase

    return sorted(set(recorrer(get_resolver().url_patterns)), key=lambda c: c.__name__)


VISTAS = [pytest.param(vista, id=vista.__name__) for vista in _vistas_enrutadas()]


def _acotado_por_empresa(modelo) -> bool:
    return bool(getattr(type(modelo._default_manager), ATRIBUTO_RUTA, None))


@pytest.mark.parametrize("vista", VISTAS)
def test_ninguna_vista_congela_su_consulta_al_importar(vista):
    """`queryset = Modelo.objects...` en el cuerpo de la clase pierde el filtro.

    Se evalúa **al importar el módulo**, y el gestor por empresa filtra en ese
    momento: la primera petición que cargue las URLs decide el filtro para todo
    el proceso. Si esa primera es anónima —el sondeo de salud de un balanceador
    es exactamente eso— el gestor devuelve «ninguna empresa» y el endpoint queda
    vacío hasta que alguien reinicie el servidor.

    Ya ocurrió con las columnas de la plantilla de carga masiva, y se descubrió
    de rebote: doce pruebas fallaban solo si se ejecutaba antes una que hiciera
    una petición anónima. Parecía un problema del banco de pruebas y era un
    defecto de producción.

    Los modelos globales —usuarios, roles, empresas, auditoría— sí pueden
    declararlo: no hay filtro que congelar.
    """
    consulta = getattr(vista, "queryset", None)
    if consulta is None:
        return

    assert not _acotado_por_empresa(consulta.model), (
        f"{vista.__name__} declara `queryset` en el cuerpo de la clase sobre "
        f"{consulta.model.__name__}, que se acota por empresa. Muévalo a "
        f"`get_queryset()`: como atributo, el filtro se congela al importar el "
        f"módulo y lo decide la primera petición del proceso."
    )


@pytest.mark.parametrize("vista", VISTAS)
def test_ningun_serializador_congela_su_desplegable(vista):
    """Lo mismo, en los campos de relación de los formularios.

    `PrimaryKeyRelatedField(queryset=Modelo.objects.filter(...))` congela el
    filtro igual que el de la vista, y el desplegable queda con el de aquel
    momento. Para eso está `RelacionDeEmpresa`, que resuelve la consulta en cada
    uso.

    Un **gestor** no cuenta: los campos que DRF construye solo a partir del
    modelo guardan el gestor, no una consulta, y DRF le pide `.all()` al validar
    —o sea, dentro de la petición—, así que el filtro se aplica cuando toca. Lo
    que se busca es la consulta ya construida.
    """
    from django.db.models import QuerySet

    from apps.empresas.campos import RelacionDeEmpresa

    serializador = getattr(vista, "serializer_class", None)
    if serializador is None:
        return

    try:
        campos = serializador().fields
    except Exception:  # pragma: no cover - serializadores que exigen contexto
        pytest.skip("El serializador necesita contexto de petición")

    culpables = [
        nombre
        for nombre, campo in campos.items()
        if isinstance(getattr(campo, "queryset", None), QuerySet)
        and not isinstance(campo, RelacionDeEmpresa)
        and _acotado_por_empresa(campo.queryset.model)
    ]

    assert not culpables, (
        f"{serializador.__name__} declara {culpables} con un `queryset` fijo "
        f"sobre un modelo acotado por empresa. Use `RelacionDeEmpresa`, que "
        f"resuelve la consulta en cada petición."
    )
