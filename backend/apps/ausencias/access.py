"""Quién ve y quién gestiona las ausencias, y cómo se protegen los datos de
salud (LOPDP).

En Nexo solo el superusuario veía y registraba permisos y estados
especiales; en el KPI, quien no era el titular ni el superusuario veía el
detalle reducido a «ausencia justificada» (`redact_sensitive_workload_detail`,
Art. 26 LOPDP). Aquí se conserva esa regla y el «superusuario» se reparte en
permisos explícitos del catálogo (`ausencias.*`), asignados por
`ausencias/0002`:

- `ausencias.ver`: las ausencias de su equipo según el organigrama.
- `ausencias.gestionar`: registrar permisos personales y vacaciones de
  cualquiera de la empresa y ver todas las ausencias.
- `ausencias.medicas_ver`: ver el tipo y la observación de cada ausencia
  (incluido el permiso MÉDICO).
- `ausencias.medicas_gestionar`: registrar permisos MÉDICOS y eliminar
  cualquier ausencia.
- `ausencias.estados_gestionar`: los estados especiales (maternidad,
  lactancia), que también son datos de salud.

**Enmascarado.** Quien no es el titular ni tiene `ausencias.medicas_ver` ve
cada ausencia como «AUSENCIA», con su fecha y sus horas, sin tipo ni
observación. Se enmascaran los tres tipos, no solo el médico (como en Nexo):
si las vacaciones o los permisos personales se vieran con su nombre, toda
«ausencia» sería, por descarte, médica. Por la misma razón, sin
`ausencias.medicas_ver` no se puede filtrar por tipo, y quien solo gestiona
puede eliminar únicamente las ausencias que registró (que nunca son médicas):
un «no puede» distinto según el tipo también lo revelaría.
"""

from apps.permissions.authorization import user_has_permission
from apps.tasks import jerarquia

VER = "ausencias.ver"
GESTIONAR = "ausencias.gestionar"
MEDICAS_VER = "ausencias.medicas_ver"
MEDICAS_GESTIONAR = "ausencias.medicas_gestionar"
ESTADOS_GESTIONAR = "ausencias.estados_gestionar"

ALL_CODENAMES = (VER, GESTIONAR, MEDICAS_VER, MEDICAS_GESTIONAR, ESTADOS_GESTIONAR)

#: Lo que ve quien no puede ver el tipo.
MASKED_TYPE = "AUSENCIA"


def can(user, codename: str) -> bool:
    return user_has_permission(user, codename)


def effective_codenames(user) -> list[str]:
    return [codename for codename in ALL_CODENAMES if can(user, codename)]


def sees_whole_company(user) -> bool:
    return can(user, GESTIONAR) or can(user, MEDICAS_VER) or can(user, MEDICAS_GESTIONAR)


def visible_user_ids(user) -> set[int] | None:
    """De quién ve ausencias: `None` = de toda la empresa; si no, ella misma
    y, con `ausencias.ver`, su equipo según el organigrama."""
    if sees_whole_company(user):
        return None
    ids = {user.pk}
    if can(user, VER):
        ids |= jerarquia.equipo_ids(user)
    return ids


def can_see_leave_detail(viewer, subject_id: int) -> bool:
    """Si ve el tipo y la observación de una ausencia de `subject_id`: el
    titular, o quien tiene `ausencias.medicas_ver`."""
    if viewer is None:
        return False
    return viewer.pk == subject_id or can(viewer, MEDICAS_VER)


def can_see_special_status(viewer, subject_id: int) -> bool:
    """Si ve el tipo de un estado especial de `subject_id` (para el KPI): el
    titular, quien gestiona los estados especiales o quien ve lo médico."""
    if viewer is None:
        return False
    return viewer.pk == subject_id or can(viewer, ESTADOS_GESTIONAR) or can(viewer, MEDICAS_VER)


def can_create(user, leave_type: str) -> bool:
    from .models import LeaveRecord

    if leave_type == LeaveRecord.Type.MEDICO:
        return can(user, MEDICAS_GESTIONAR)
    return can(user, GESTIONAR) or can(user, MEDICAS_GESTIONAR)


def can_delete(user, record) -> bool:
    from .models import LeaveRecord

    if can(user, MEDICAS_GESTIONAR):
        return True
    return (
        can(user, GESTIONAR)
        and record.created_by_id == user.pk
        and record.type != LeaveRecord.Type.MEDICO
    )
