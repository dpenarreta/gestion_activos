"""Quién propone, quién vota, quién ve qué ideas y quién las mueve de etapa.

Dos ejes, como el resto de Gestión Humana, resueltos en el servidor en cada
petición:

1. **Permisos del catálogo** (`mejora_continua.*`, asignados por
   `mejora_continua/0002`). En Nexo había uno solo, `mejora_continua.revisar`
   (mover ideas y su avance), y proponer y votar no pedían nada: cualquier
   cuenta de Nexo era del departamento. En la intranet hay cuentas de toda la
   empresa, así que entrar también es un permiso:

   - `mejora_continua.acceder`: proponer ideas, ver las propias y las de su
     equipo y votar por las que ve.
   - `mejora_continua.ver_todas`: ver (y votar) todas las ideas de la empresa.
     Es la excepción de Nexo para el Jefe Nacional y el Coordinador Nacional,
     que veían todas las ideas aunque el resto de Gestión Humana siguiera la
     jerarquía.
   - `mejora_continua.gestionar`: lo que en Nexo era `revisar`. Incluye ver
     todas: en Nexo el cambio de etapa no miraba la jerarquía, y no se puede
     revisar lo que no se ve.

2. **Ámbito de datos**, que no es un permiso: el organigrama
   (`apps.tasks.jerarquia`). En Nexo, la tabla rol → rol (`get_visible_groups`)
   y el nivel 1 solo se veía a sí mismo; aquí, cada quien ve sus ideas y las de
   las personas cuyo cargo depende del suyo. Sin cargo, solo las suyas.

Todo vale dentro de la empresa activa: el gestor de `ImprovementIdea` ya acota
cada consulta a ella.
"""

from django.db.models import Q

from apps.permissions.authorization import user_has_permission
from apps.tasks import jerarquia

from .models import ImprovementIdea

ACCEDER = "mejora_continua.acceder"
VER_TODAS = "mejora_continua.ver_todas"
GESTIONAR = "mejora_continua.gestionar"

ALL_CODENAMES = (ACCEDER, VER_TODAS, GESTIONAR)


def can(user, codename: str) -> bool:
    return user_has_permission(user, codename)


def effective_codenames(user) -> list[str]:
    return [codename for codename in ALL_CODENAMES if can(user, codename)]


def puede_proponer(user) -> bool:
    return can(user, ACCEDER)


def puede_votar(user) -> bool:
    return can(user, ACCEDER)


def puede_gestionar(user) -> bool:
    return can(user, GESTIONAR)


def ve_todas(user) -> bool:
    """Toda la empresa: `ver_todas` o `gestionar`."""
    return can(user, VER_TODAS) or can(user, GESTIONAR)


def ideas_visibles(user):
    """Las ideas que `user` ve en la empresa activa: todas, o las suyas y las
    de su equipo según el organigrama."""
    ideas = ImprovementIdea.objects.all()
    if ve_todas(user):
        return ideas
    # El equipo va como subconsulta y no como lista de ids: el de una jefatura
    # alta puede pasar de los 2100 parámetros que admite SQL Server.
    equipo = jerarquia.equipo_de(user, solo_activos=False).values("pk")
    return ideas.filter(Q(author_id=user.pk) | Q(author_id__in=equipo))


def puede_ver(user, idea: ImprovementIdea) -> bool:
    if ve_todas(user) or idea.author_id == user.pk:
        return True
    return jerarquia.equipo_de(user, solo_activos=False).filter(pk=idea.author_id).exists()
