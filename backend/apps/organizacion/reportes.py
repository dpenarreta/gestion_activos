"""El reporte secundario de los cargos: la «línea punteada» (09/11/2026).

Un cargo reporta a un jefe inmediato (`Cargo.jefe`, la línea directa) y puede
reportar **también** a otros cargos (`Cargo.jefes_secundarios`). Lo pidió el
usuario para la Jefa de Cartera y la Gerente de Gestión Humana: su jefe
directo es el Gerente General y, además, reportan al Jefe Financiero
Administrativo (`reporte_secundario_2026`, migración 0046).

Qué cuenta y qué no (regla adoptada):

- **Cuenta para ver y para el equipo.** Quien ocupa un cargo que es jefe
  secundario de otro ve a quien lo ocupa y a todo su equipo, igual que su jefe
  directo: «Mi equipo», el KPI y los informes del equipo, Nova en modo equipo,
  las tareas, proyectos e ideas del equipo, las ausencias del equipo y el
  organigrama de su área (`institucional.ver_area`). Todo eso sale de
  `apps.tasks.jerarquia.equipo_ids` / `equipo_de`, que recorren el
  organigrama con `debajo`; así lo heredan sin repetir la regla. El recorrido
  sigue las dos líneas: lo que cuelga de un reporte secundario también lo ve
  el jefe del jefe secundario, como pasa con la línea directa.
- **No cuenta para aprobar ni para avisar.** Las aprobaciones que van «al
  jefe inmediato» (solicitudes de permiso y de proyectos, `licencias.services.
  jefes_de`) y los avisos al jefe (comentarios y alertas de tareas, alertas de
  desempeño: `jerarquia.jefe_inmediato`) siguen la línea directa y no se
  duplican; tampoco «sus jefes» de Nova (`jerarquia.jefes_de`). Lo que no es un
  envío a una persona sino un permiso sobre el equipo (validar o borrar una
  tarea del equipo con `tareas.validar`) sí lo tiene, como cualquier superior
  de la línea.
- **Sin regla de niveles.** El nivel de un cargo no limita a quién reporta en
  línea punteada (la Gerente de Gestión Humana, una Gerencia de Área, reporta
  también a una Jefatura): `niveles_cargo.validar_jefe` es solo para el jefe
  inmediato.

Lo que se protege (`validar`): un cargo no es jefe secundario de sí mismo, su
jefe inmediato no es además su jefe secundario, es de la misma empresa, y no
se cierran círculos entre las dos líneas (no puede reportar a un cargo que
depende de él por ninguna de ellas).
"""

from collections import defaultdict

from rest_framework.exceptions import ValidationError

from .models import Cargo


def _hijos(empresa_id) -> dict[int, list[int]]:
    """Cargo → los cargos que le reportan, por la línea directa o la punteada."""
    hijos: dict[int, list[int]] = defaultdict(list)
    for cargo_id, jefe_id in (
        Cargo.objects.todas().filter(empresa_id=empresa_id).values_list("id", "jefe_id")
    ):
        if jefe_id is not None:
            hijos[jefe_id].append(cargo_id)
    secundarios = Cargo.jefes_secundarios.through.objects.filter(
        from_cargo__empresa_id=empresa_id, to_cargo__empresa_id=empresa_id
    ).values_list("from_cargo_id", "to_cargo_id")
    for cargo_id, jefe_id in secundarios:
        hijos[jefe_id].append(cargo_id)
    return hijos


def debajo(cargo_id, empresa_id) -> set[int]:
    """Los cargos que dependen de `cargo_id`, directa o indirectamente y por
    cualquiera de las dos líneas (sin él). El organigrama no debería tener
    círculos, pero el recorrido no se fía: nunca da dos vueltas."""
    hijos = _hijos(empresa_id)
    vistos: set[int] = {cargo_id}
    pendientes = list(hijos.get(cargo_id, []))
    while pendientes:
        actual = pendientes.pop()
        if actual in vistos:
            continue
        vistos.add(actual)
        pendientes.extend(hijos.get(actual, []))
    vistos.discard(cargo_id)
    return vistos


def validar(cargo, jefe, secundarios) -> None:
    """Que los jefes secundarios elegidos para `cargo` (None si es nuevo) sean
    válidos con ese `jefe` inmediato."""
    if not secundarios:
        return
    dependen = debajo(cargo.pk, cargo.empresa_id) if cargo is not None and cargo.pk else set()
    for otro in secundarios:
        if cargo is not None and otro.pk == cargo.pk:
            raise ValidationError(
                {"jefes_secundarios": "Un cargo no puede reportar también a sí mismo."}
            )
        if jefe is not None and otro.pk == jefe.pk:
            raise ValidationError(
                {
                    "jefes_secundarios": (
                        f"«{otro.nombre}» ya es su jefe inmediato: quítelo de «Reporta "
                        "también a»."
                    )
                }
            )
        empresa_id = cargo.empresa_id if cargo is not None else getattr(jefe, "empresa_id", None)
        if empresa_id is not None and otro.empresa_id != empresa_id:
            raise ValidationError({"jefes_secundarios": f"«{otro.nombre}» es de otra empresa."})
        if otro.pk in dependen:
            raise ValidationError(
                {
                    "jefes_secundarios": (
                        f"«{otro.nombre}» depende de este cargo: no puede reportarle "
                        "también, cerraría un círculo."
                    )
                }
            )


def validar_jefe(cargo, jefe) -> None:
    """Que el jefe inmediato no cierre un círculo a través de un reporte
    secundario (el de la línea directa lo cuida `organigrama.validar_jefe`)."""
    if jefe is None or cargo is None or not cargo.pk:
        return
    if jefe.pk in debajo(cargo.pk, cargo.empresa_id):
        raise ValidationError({"jefe": "Un cargo no puede reportar a uno que depende de él."})
