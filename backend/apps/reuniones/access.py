"""Quién entra a Reuniones, quién las crea, quién ve cada una y quién la cambia.

En Nexo había un solo permiso, `reuniones.crear` (de ADMINISTRADOR,
JEFE_NACIONAL, COORDINADOR_NACIONAL y COORDINADOR_ZS); ver las propias no
pedía nada porque toda cuenta de Nexo era del departamento. En la intranet hay
cuentas de toda la empresa, así que entrar también es un permiso
(asignados por `reuniones/0002`):

- `reuniones.acceder`: ver las reuniones que organiza o a las que lo invitaron
  y poder ser invitado.
- `reuniones.crear`: lo de Nexo, programar reuniones e invitar.
- `reuniones.administrar`: nuevo. Ver todas las reuniones de la empresa y
  editarlas o eliminarlas aunque no sea el anfitrión. En Nexo nadie podía
  tocar la reunión de otro (ni el superusuario): si el anfitrión se iba, la
  reunión quedaba huérfana. Es solo del Administrador de Gestión Humana (y del
  Superusuario).

Ver una reunión no sigue el organigrama, como en Nexo: la ve quien la organiza
y quien está invitado. Todo vale dentro de la empresa activa (el gestor de
`Meeting` ya acota cada consulta a ella).
"""

from django.db.models import Q

from apps.permissions.authorization import user_has_permission

from .models import Meeting, MeetingInvitee

ACCEDER = "reuniones.acceder"
CREAR = "reuniones.crear"
ADMINISTRAR = "reuniones.administrar"

ALL_CODENAMES = (ACCEDER, CREAR, ADMINISTRAR)


def can(user, codename: str) -> bool:
    return user_has_permission(user, codename)


def effective_codenames(user) -> list[str]:
    return [codename for codename in ALL_CODENAMES if can(user, codename)]


def puede_crear(user) -> bool:
    return can(user, CREAR)


def administra(user) -> bool:
    return can(user, ADMINISTRAR)


def puede_invitar(user) -> bool:
    """Quien arma la lista de invitados: quien crea reuniones o las administra."""
    return puede_crear(user) or administra(user)


def vigentes():
    """Las reuniones no eliminadas de la empresa activa."""
    return Meeting.objects.filter(deleted_at__isnull=True)


def reuniones_visibles(user, *, todas: bool = False):
    """Las que organiza o a las que está invitado; con `todas` y
    `reuniones.administrar`, todas las de la empresa.

    Los invitados van como subconsulta y no con un `JOIN` + `DISTINCT`: así
    SQL Server no tiene que comparar los textos largos de cada reunión."""
    reuniones = vigentes()
    if todas and administra(user):
        return reuniones
    invitado = MeetingInvitee.objects.filter(user_id=user.pk).values("meeting_id")
    return reuniones.filter(Q(host_id=user.pk) | Q(pk__in=invitado))


def puede_ver(user, meeting: Meeting) -> bool:
    if meeting.host_id == user.pk or administra(user):
        return True
    return meeting.invitees.filter(user_id=user.pk).exists()


def puede_editar(user, meeting: Meeting) -> bool:
    """Editar, eliminar y marcar la asistencia: el anfitrión (como en Nexo) o
    quien administra el módulo."""
    return meeting.host_id == user.pk or administra(user)
