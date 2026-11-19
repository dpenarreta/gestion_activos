"""El Directorio, horizontal a la Gerencia General (19/11/2026).

Decisión del usuario: el Directorio es un área de apoyo al Gerente General a
su misma altura. El Gerente General no es jefe del Directorio y el Directorio
no es jefe del Gerente General: las dos son raíces del organigrama, dibujadas
una al lado de la otra. Hay jefaturas que reportan a las dos.

En cada empresa, solo si existen los cargos:

- se crea la unidad «Directorio» sin padre, en el nivel de la Gerencia
  General (con su Área, como toda unidad);
- el «Gerente de Procesos y Proyectos» pasa al Directorio y deja de tener
  jefe; el Jefe de Procesos y Mejora Continua le sigue reportando;
- se crea en el Directorio el cargo «Jefe de Finanzas y Administración», sin
  jefe;
- el «Jefe Financiero Administrativo» (con todo su equipo) pasa a reportar
  directo al Jefe de Finanzas y Administración y, además, al Gerente General
  en línea punteada (`Cargo.jefes_secundarios`, ver `reportes.py`).

Las personas no van aquí: se asignan a su cargo desde el organigrama.

Lo aplica la migración 0052 y deja el cambio en la bitácora del organigrama.
Repetirlo no cambia nada.
"""

from . import departamentos_del_organigrama, niveles_cargo, reportes, roles_de_cargo, versiones
from .models import Cargo, UnidadOrganizacional
from .permisos_por_cargo import normalizar as _normal

UNIDAD = "Directorio"
GERENTE_GENERAL = "Gerente General"
GERENTE_PROCESOS = "Gerente de Procesos y Proyectos"
FINANZAS = "Jefe de Finanzas y Administración"
JEFE_FINANCIERO = "Jefe Financiero Administrativo"

MOTIVO = (
    "Decisión del usuario: el Directorio, horizontal a la Gerencia General (ninguno "
    "es jefe del otro). Pasan a él el Gerente de Procesos y Proyectos y el nuevo "
    "Jefe de Finanzas y Administración; el Jefe Financiero Administrativo le "
    "reporta y también, en línea punteada, al Gerente General."
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


def _unidad_del_directorio(gerente_general):
    """La unidad del Directorio; si no existe, se crea como raíz en el nivel
    de la unidad del Gerente General."""
    unidad = next(
        (u for u in UnidadOrganizacional.objects.all() if _normal(u.nombre) == _normal(UNIDAD)),
        None,
    )
    raiz = gerente_general.unidad
    if unidad is None:
        unidad = UnidadOrganizacional.objects.create(
            nombre=UNIDAD, nivel=raiz.nivel, padre=None, orden=raiz.orden + 1
        )
        departamentos_del_organigrama.sincronizar(unidad)
    elif unidad.padre_id is not None or unidad.nivel_id != raiz.nivel_id or not unidad.activa:
        unidad.padre = None
        unidad.nivel = raiz.nivel
        unidad.activa = True
        unidad.save(update_fields=["padre", "nivel", "activa", "updated_at"])
    # Si la Gerencia General colgaba del Directorio, también queda como raíz:
    # ninguno es superior del otro.
    if raiz.padre_id == unidad.id:
        raiz.padre = None
        raiz.save(update_fields=["padre", "updated_at"])
    return unidad


def cambiar() -> None:
    """Los cambios, sin anotarlos: los anota quien llama (`aplicar` o la
    migración)."""
    cargos = list(Cargo.objects.filter(activo=True).select_related("unidad__nivel"))
    gerente_general = _cargo(GERENTE_GENERAL, cargos)
    if gerente_general is None or gerente_general.unidad_id is None:
        return
    unidad = _unidad_del_directorio(gerente_general)

    procesos = _cargo(GERENTE_PROCESOS, cargos)
    if procesos is not None and (procesos.unidad_id != unidad.id or procesos.jefe_id):
        procesos.unidad = unidad
        procesos.jefe = None
        procesos.save(update_fields=["unidad", "jefe", "updated_at"])

    finanzas = next(
        (c for c in Cargo.objects.filter(unidad=unidad) if _normal(c.nombre) == _normal(FINANZAS)),
        None,
    )
    if finanzas is None:
        finanzas = Cargo.objects.create(
            nombre=FINANZAS,
            unidad=unidad,
            plazas=1,
            nivel=niveles_cargo.sugerido(FINANZAS),
        )
    elif not finanzas.activo or finanzas.jefe_id:
        finanzas.activo = True
        finanzas.jefe = None
        finanzas.save(update_fields=["activo", "jefe", "updated_at"])

    financiero = _cargo(JEFE_FINANCIERO, cargos)
    if financiero is not None and financiero.pk != finanzas.pk:
        if financiero.jefe_id != finanzas.pk:
            financiero.jefe = finanzas
            financiero.save(update_fields=["jefe", "updated_at"])
        # Su jefe inmediato no es además su jefe secundario (`reportes.validar`).
        financiero.jefes_secundarios.remove(finanzas)
        if not financiero.jefes_secundarios.filter(pk=gerente_general.pk).exists() and (
            gerente_general.pk not in reportes.debajo(financiero.pk, financiero.empresa_id)
        ):
            financiero.jefes_secundarios.add(gerente_general)

    for cargo in Cargo.objects.filter(unidad=unidad).select_related("rol", "unidad", "empresa"):
        roles_de_cargo.asegurar_rol(cargo)
