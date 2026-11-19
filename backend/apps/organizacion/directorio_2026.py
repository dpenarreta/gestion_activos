"""El Directorio, horizontal a la Gerencia General (19/11/2026).

Decisión del usuario: el Directorio es un área aparte de la Gerencia
General. El Gerente General no es jefe del Directorio ni el Directorio es
jefe del Gerente General: las dos son raíces del organigrama, relacionadas
pero sin línea de supervisión entre ellas. El Directorio se dibuja arriba
de todo el organigrama, centrado sobre la Gerencia General (su nivel de
unidad va primero).

Quiénes son el Directorio (una sola área):

- el **Presidente del Directorio**, arriba;
- el **Director Ejecutivo** y el **Director Financiero**, al mismo nivel,
  reportando al Presidente;
- el **Comité Ejecutivo**, que informa a los dos Directores sin ser línea de
  supervisión directa (línea punteada, `Cargo.jefes_secundarios`, ver
  `reportes.py`): el Gerente de Procesos y Proyectos y el Jefe
  Administrativo Financiero Corporativo, dentro del Directorio y sin jefe
  directo, y el Gerente General, que sigue encabezando su área con todos sus
  equipos.

Además, el Jefe Financiero Administrativo (con todo su equipo) reporta
directo al Jefe Administrativo Financiero Corporativo y, en línea punteada,
al Gerente General; el Jefe de Procesos y Mejora Continua sigue reportando
al Gerente de Procesos y Proyectos.

En cada empresa, solo si existe el Gerente General. Las personas no van
aquí: se asignan a su cargo desde el organigrama.

Todos los del Directorio (Presidente, Directores, Gerente de Procesos y
Proyectos y Jefe Administrativo Financiero Corporativo) van en el nivel de
cargo «Directorio»; el Gerente General sigue en el suyo.

Lo aplican las migraciones 0052, 0053 (el nivel propio), 0054 (Presidente,
Directores y Comité Ejecutivo) 0055 (el nivel de cargo Directorio) y 0056 (arriba de todo), y deja el cambio en la bitácora del
organigrama. Repetirlo no cambia nada.
"""

from . import departamentos_del_organigrama, reportes, roles_de_cargo, versiones
from .models import Cargo, NivelCargo, NivelJerarquico, UnidadOrganizacional
from .permisos_por_cargo import normalizar as _normal

UNIDAD = "Directorio"
GERENTE_GENERAL = "Gerente General"
GERENTE_PROCESOS = "Gerente de Procesos y Proyectos"
FINANZAS = "Jefe Administrativo Financiero Corporativo"
#: Cómo se llamó al crearlo la 0052.
FINANZAS_ANTES = ("Jefe de Finanzas y Administración",)
PRESIDENTE = "Presidente del Directorio"
DIRECTORES = ("Director Ejecutivo", "Director Financiero")
JEFE_FINANCIERO = "Jefe Financiero Administrativo"

MOTIVO = (
    "Decisión del usuario: el Directorio, área aparte a la altura de la Gerencia "
    "General (ninguno es jefe del otro). Presidente; Director Ejecutivo y Director "
    "Financiero, al mismo nivel; y el Comité Ejecutivo (Gerente de Procesos y "
    "Proyectos, Jefe Administrativo Financiero Corporativo y Gerente General), que "
    "informa a los dos Directores en línea punteada. El Jefe Financiero "
    "Administrativo reporta al Jefe Administrativo Financiero Corporativo y, en "
    "línea punteada, al Gerente General."
)


def aplicar() -> list[str]:
    """Lo deja así en la empresa activa y lo anota en la bitácora. Devuelve lo
    que cambió (vacío si ya estaba así)."""
    with versiones.sin_peticion(MOTIVO) as resultado:
        cambiar()
    return resultado["lineas"]


def _cargo(nombre, cargos):
    return next(
        (c for c in sorted(cargos, key=lambda c: c.id) if _normal(c.nombre) == _normal(nombre)),
        None,
    )


def _nivel_del_directorio(raiz):
    """El nivel propio «Directorio», el primero de todos: el organigrama lo
    dibuja arriba de todo, sobre la Gerencia General (pedido del usuario,
    19/11/2026), sin línea de supervisión entre ellos.

    Propio y no el de la Gerencia General (corrección del usuario, 19/11/2026):
    cada unidad muestra su nivel encima de su nombre, y «Gerencia General ·
    Directorio» se leía como si el Directorio estuviera bajo el Gerente
    General. Son áreas aparte: se relacionan, pero no hay supervisión."""
    nivel = next(
        (n for n in NivelJerarquico.objects.all() if _normal(n.nombre) == _normal(UNIDAD)),
        None,
    )
    if raiz.nivel.orden == 0 and (nivel is None or nivel.pk != raiz.nivel_id):
        # Sin lugar encima: se corren los demás niveles uno hacia abajo.
        otros = NivelJerarquico.objects.exclude(pk=nivel.pk if nivel else None)
        for otro in otros.order_by("-orden"):
            otro.orden += 1
            otro.save(update_fields=["orden", "updated_at"])
        raiz.nivel.refresh_from_db()
    arriba = raiz.nivel.orden - 1
    if nivel is None:
        return NivelJerarquico.objects.create(nombre=UNIDAD, orden=arriba)
    if nivel.orden != arriba:
        nivel.orden = arriba
        nivel.save(update_fields=["orden", "updated_at"])
    return nivel


def _unidad_del_directorio(gerente_general):
    """La unidad del Directorio; si no existe, se crea como raíz en su nivel
    propio, a la altura de la unidad del Gerente General."""
    unidad = next(
        (u for u in UnidadOrganizacional.objects.all() if _normal(u.nombre) == _normal(UNIDAD)),
        None,
    )
    raiz = gerente_general.unidad
    nivel = _nivel_del_directorio(raiz)
    if unidad is None:
        unidad = UnidadOrganizacional.objects.create(
            nombre=UNIDAD, nivel=nivel, padre=None, orden=raiz.orden + 1
        )
        departamentos_del_organigrama.sincronizar(unidad)
    elif unidad.padre_id is not None or unidad.nivel_id != nivel.id or not unidad.activa:
        unidad.padre = None
        unidad.nivel = nivel
        unidad.activa = True
        unidad.save(update_fields=["padre", "nivel", "activa", "updated_at"])
    # Si la Gerencia General colgaba del Directorio, también queda como raíz:
    # ninguno es superior del otro.
    if raiz.padre_id == unidad.id:
        raiz.padre = None
        raiz.save(update_fields=["padre", "updated_at"])
    return unidad


def _en_directorio(unidad, nombre, *, jefe=None, antes=()):
    """El cargo del Directorio (por su nombre o el de antes); si no existe, se
    crea. Queda activo, en el Directorio, en el nivel Directorio y con ese
    jefe directo."""
    nivel = NivelCargo.DIRECTORIO
    buscados = {_normal(n) for n in (nombre, *antes)}
    cargo = next(
        (
            c
            for c in Cargo.objects.filter(unidad=unidad).order_by("id")
            if _normal(c.nombre) in buscados
        ),
        None,
    )
    if cargo is None:
        return Cargo.objects.create(nombre=nombre, unidad=unidad, plazas=1, nivel=nivel, jefe=jefe)
    jefe_id = jefe.pk if jefe else None
    if (
        cargo.nombre != nombre
        or not cargo.activo
        or cargo.jefe_id != jefe_id
        or cargo.nivel != nivel
    ):
        cargo.nombre = nombre
        cargo.activo = True
        cargo.jefe = jefe
        cargo.nivel = nivel
        cargo.save(update_fields=["nombre", "activo", "jefe", "nivel", "updated_at"])
    return cargo


def _punteada(cargo, jefes) -> None:
    """`cargo` también reporta a cada uno de `jefes`, sin ser su jefe directo
    y sin cerrar círculos (`reportes.validar`)."""
    debajo = reportes.debajo(cargo.pk, cargo.empresa_id)
    actuales = set(cargo.jefes_secundarios.values_list("pk", flat=True))
    for jefe in jefes:
        if jefe.pk in actuales or jefe.pk in (cargo.pk, cargo.jefe_id) or jefe.pk in debajo:
            continue
        cargo.jefes_secundarios.add(jefe)


def cambiar() -> None:
    """Los cambios, sin anotarlos: los anota quien llama (`aplicar` o la
    migración)."""
    cargos = list(Cargo.objects.filter(activo=True).select_related("unidad__nivel"))
    gerente_general = _cargo(GERENTE_GENERAL, cargos)
    if gerente_general is None or gerente_general.unidad_id is None:
        return
    unidad = _unidad_del_directorio(gerente_general)

    presidente = _en_directorio(unidad, PRESIDENTE)
    directores = [_en_directorio(unidad, nombre, jefe=presidente) for nombre in DIRECTORES]

    # El Comité Ejecutivo: informa a los dos Directores, sin jefe directo en
    # el Directorio.
    procesos = _cargo(GERENTE_PROCESOS, cargos)
    if procesos is not None:
        # Primero se trae al Directorio (con su rol, su perfil y quien lo
        # ocupa); luego queda como los demás del Directorio.
        if procesos.unidad_id != unidad.id:
            procesos.unidad = unidad
            procesos.jefe = None
            procesos.save(update_fields=["unidad", "jefe", "updated_at"])
        procesos = _en_directorio(unidad, GERENTE_PROCESOS)
    finanzas = _en_directorio(unidad, FINANZAS, antes=FINANZAS_ANTES)
    for miembro in (procesos, finanzas, gerente_general):
        if miembro is not None:
            _punteada(miembro, directores)

    financiero = _cargo(JEFE_FINANCIERO, cargos)
    if financiero is not None and financiero.pk != finanzas.pk:
        if financiero.jefe_id != finanzas.pk:
            financiero.jefe = finanzas
            financiero.save(update_fields=["jefe", "updated_at"])
        # Su jefe inmediato no es además su jefe secundario (`reportes.validar`).
        financiero.jefes_secundarios.remove(finanzas)
        _punteada(financiero, [gerente_general])

    for cargo in Cargo.objects.filter(unidad=unidad).select_related("rol", "unidad", "empresa"):
        roles_de_cargo.asegurar_rol(cargo)
