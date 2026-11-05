"""Quién ve a quién en Tareas y Equipo: el organigrama de la intranet.

En Nexo la jerarquía era una tabla rol → rol (`hierarchy.RoleVisibility` y
`RoleNotificationTarget`): un Coordinador Nacional veía a todos los analistas
del país por el solo hecho de serlo. Aquí sale del organigrama institucional
(decisión del usuario, 04/11/2026):

- Cada persona ocupa un cargo en la empresa (`DatosDeContacto.cargo`, lo que
  dice «Mi perfil») y cada cargo reporta a otro (`Cargo.jefe`).
- **El equipo de alguien** son las personas con cuenta en la empresa cuyo
  cargo depende del suyo, directa o indirectamente. No incluye a quien ocupa
  su mismo cargo ni a ella misma.
- **Sus jefes** son quienes ocupan los cargos de su línea de reporte hacia
  arriba, del más cercano al más lejano.
- Sin cargo en el organigrama, la persona solo se ve a sí misma.

Todo se resuelve dentro de la empresa activa (o la que se indique): el cargo
que alguien tenga en otra empresa no cuenta. El organigrama no debería tener
ciclos (`organigrama.validar_jefe` los impide), pero el recorrido no se fía:
lleva la cuenta de lo visitado y nunca da dos vueltas.
"""

from collections import defaultdict

from django.contrib.auth import get_user_model

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.organizacion.models import Cargo, DatosDeContacto


def _empresa(empresa=None):
    """La empresa en la que se mira el organigrama, o None si no hay ninguna
    (fuera de una petición y sin indicarla, no hay organigrama que mirar)."""
    if empresa is None:
        empresa = empresa_actual()
    if empresa is None or empresa is SIN_EMPRESA:
        return None
    return empresa


def cargo_de(usuario, empresa=None):
    """El cargo de la persona en la empresa, o None."""
    empresa = _empresa(empresa)
    if empresa is None or usuario is None or usuario.pk is None:
        return None
    perfil = (
        DatosDeContacto.objects.todas()
        .filter(empresa=empresa, usuario=usuario, cargo__isnull=False)
        .select_related("cargo")
        .first()
    )
    return perfil.cargo if perfil else None


def _cargos_debajo(cargo, empresa) -> set[int]:
    """Los cargos que dependen de `cargo`, directa o indirectamente (sin él)."""
    hijos: dict[int, list[int]] = defaultdict(list)
    for cargo_id, jefe_id in (
        Cargo.objects.todas().filter(empresa=empresa).values_list("id", "jefe_id")
    ):
        if jefe_id is not None:
            hijos[jefe_id].append(cargo_id)
    vistos: set[int] = {cargo.pk}
    pendientes = list(hijos.get(cargo.pk, []))
    while pendientes:
        actual = pendientes.pop()
        if actual in vistos:
            continue
        vistos.add(actual)
        pendientes.extend(hijos.get(actual, []))
    vistos.discard(cargo.pk)
    return vistos


def _cargos_arriba(cargo) -> list:
    """La línea de reporte de `cargo`, del jefe directo hacia arriba."""
    cadena, vistos, actual = [], {cargo.pk}, cargo.jefe
    while actual is not None and actual.pk not in vistos:
        if actual.empresa_id != cargo.empresa_id:
            break  # un cargo de otra empresa no es su línea de reporte aquí
        vistos.add(actual.pk)
        cadena.append(actual)
        actual = actual.jefe
    return cadena


def _personas_en(cargo_ids, empresa, *, solo_activos: bool):
    """Las cuentas de la empresa que ocupan alguno de esos cargos."""
    User = get_user_model()
    if not cargo_ids:
        return User.objects.none()
    personas = User.objects.filter(
        datos_de_contacto__empresa=empresa,
        datos_de_contacto__cargo_id__in=list(cargo_ids),
        membresias__empresa=empresa,
    )
    if solo_activos:
        personas = personas.filter(is_active=True)
    return personas.distinct()


def equipo_ids(usuario, empresa=None) -> set[int]:
    """Los ids de su equipo (activos o no: una tarea de alguien desactivado la
    sigue viendo su jefe)."""
    empresa = _empresa(empresa)
    cargo = cargo_de(usuario, empresa)
    if cargo is None:
        return set()
    debajo = _cargos_debajo(cargo, empresa)
    ids = set(_personas_en(debajo, empresa, solo_activos=False).values_list("pk", flat=True))
    ids.discard(usuario.pk)
    return ids


def equipo_de(usuario, empresa=None, *, solo_activos: bool = True):
    """Su equipo: las personas con cuenta cuyo cargo depende del suyo."""
    User = get_user_model()
    empresa = _empresa(empresa)
    cargo = cargo_de(usuario, empresa)
    if cargo is None:
        return User.objects.none()
    debajo = _cargos_debajo(cargo, empresa)
    return _personas_en(debajo, empresa, solo_activos=solo_activos).exclude(pk=usuario.pk)


def jefes_de(usuario, empresa=None) -> list:
    """Quienes ocupan los cargos de su línea de reporte, del más cercano al
    más lejano (activos). Sin cargo, ninguno."""
    empresa = _empresa(empresa)
    cargo = cargo_de(usuario, empresa)
    if cargo is None:
        return []
    jefes, vistos = [], {usuario.pk}
    for superior in _cargos_arriba(cargo):
        for persona in _personas_en([superior.pk], empresa, solo_activos=True).order_by("pk"):
            if persona.pk not in vistos:
                vistos.add(persona.pk)
                jefes.append(persona)
    return jefes


def jefe_inmediato(usuario, empresa=None) -> list:
    """Quienes ocupan el cargo ocupado más cercano hacia arriba: si el cargo
    del jefe directo está vacante, sube al siguiente. Es a quien se avisa
    «hacia arriba» (en Nexo, `RoleNotificationTarget`)."""
    empresa = _empresa(empresa)
    cargo = cargo_de(usuario, empresa)
    if cargo is None:
        return []
    for superior in _cargos_arriba(cargo):
        personas = [
            p
            for p in _personas_en([superior.pk], empresa, solo_activos=True).order_by("pk")
            if p.pk != usuario.pk
        ]
        if personas:
            return personas
    return []


def puede_ver(usuario, otro, empresa=None) -> bool:
    """Si `usuario` ve a `otro` (y sus tareas): es él mismo o es de su equipo."""
    if usuario is None or otro is None:
        return False
    if usuario.pk == otro.pk:
        return True
    return otro.pk in equipo_ids(usuario, empresa)
