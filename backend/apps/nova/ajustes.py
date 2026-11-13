"""Ajustes de Nova por empresa (09/11/2026).

Viven en `novedades.SettingHistory`, la tabla de ajustes con vigencia de
Gestión Humana (por empresa, con quién y cuándo los cambió): no hace falta un
modelo propio.

- `nova_solo_fuentes` («Responder solo con las fuentes»), **desactivado
  por defecto desde el 13/11/2026** (decisión del usuario: Nova tiene dos
  fuentes, los documentos y, si no responden, el conocimiento general de la
  IA con un aviso visible; ver `chat.py`). Activado, Nova responde solo con los documentos de la base de conocimiento
  y, en los modos Mis tareas y Mi equipo, con los datos que se le entregan;
  nunca con conocimiento general. En el modo General, si la búsqueda no
  encuentra fragmentos, ni siquiera se llama a la IA (`chat.conversar`). Lo
  cambia quien tiene `nova.conocimiento_gestionar` y queda en la auditoría
  (`nova.configuracion.cambiada`).
"""

from apps.novedades.configuracion import current_record, set_config_value

CLAVE_SOLO_FUENTES = "nova_solo_fuentes"
#: Desactivado mientras nadie lo cambie (dos fuentes, 13/11/2026).
SOLO_FUENTES_POR_DEFECTO = False


def solo_fuentes() -> bool:
    """El ajuste vigente en la empresa activa."""
    registro = current_record(CLAVE_SOLO_FUENTES)
    if registro is None:
        return SOLO_FUENTES_POR_DEFECTO
    return registro.value != "0"


def cambiar_solo_fuentes(valor: bool, actor) -> None:
    set_config_value(CLAVE_SOLO_FUENTES, "1" if valor else "0", actor)
