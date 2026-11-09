"""Los permisos de Nova (catálogo: bloque `nova`, `permissions/0055` y
`permissions/0056`).

Uno por función, para poder dar o quitar cada una a un rol:

- `nova.analisis_kpi`: el «Análisis de Nova» en los KPI (los propios y los de
  quien el organigrama le deja ver). Exige además `kpi.acceder`.
- `nova.mensaje_inicio`: la frase de Nova en el inicio de Gestión Humana.
- `nova.narrativa_informes`: la narrativa con IA al generar un informe
  ejecutivo. Sin él, el informe sale con la narrativa sin IA.
- `nova.chat`: conversar con Nova en los modos General y Mis tareas.
- `nova.chat_equipo`: el modo Equipo del chat. Además del permiso, hace falta
  tener equipo a cargo en el organigrama o permiso de ver el equipo
  (`equipo.ver` o `kpi.equipo`): ver `puede_chat_equipo`.
- `nova.conocimiento_ver`: ver la lista de documentos de la base de
  conocimiento y abrirlos en el visor. Sus fragmentos no se listan: solo los
  usa el chat en el servidor.
- `nova.conocimiento_gestionar`: subir y eliminar documentos (y revisar el
  texto extraído).
"""

from apps.permissions.authorization import user_has_permission

ANALISIS_KPI = "nova.analisis_kpi"
MENSAJE_INICIO = "nova.mensaje_inicio"
NARRATIVA_INFORMES = "nova.narrativa_informes"
CHAT = "nova.chat"
CHAT_EQUIPO = "nova.chat_equipo"
CONOCIMIENTO_VER = "nova.conocimiento_ver"
CONOCIMIENTO_GESTIONAR = "nova.conocimiento_gestionar"

TODOS = (
    ANALISIS_KPI,
    MENSAJE_INICIO,
    NARRATIVA_INFORMES,
    CHAT,
    CHAT_EQUIPO,
    CONOCIMIENTO_VER,
    CONOCIMIENTO_GESTIONAR,
)

#: Los permisos que ya dan ver al equipo (Tareas › Equipo y KPI del equipo).
VER_EQUIPO = ("equipo.ver", "kpi.equipo")


def puede_chat_equipo(usuario) -> bool:
    """El modo Equipo del chat: el permiso y, además, equipo a cargo en el
    organigrama o permiso de ver el equipo. Qué personas entran lo decide
    siempre el organigrama (`apps.tasks.jerarquia.equipo_de`)."""
    from apps.tasks import jerarquia

    if not user_has_permission(usuario, CHAT_EQUIPO):
        return False
    if any(user_has_permission(usuario, c) for c in VER_EQUIPO):
        return True
    return bool(jerarquia.equipo_ids(usuario))
