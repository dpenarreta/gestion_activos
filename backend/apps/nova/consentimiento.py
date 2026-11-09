"""El ÚNICO punto donde Nova pregunta si la persona aceptó el aviso de
tratamiento de datos vigente.

Dónde se conecta: el registro de aceptaciones vive en
`apps/privacidad/consentimiento.py` (aviso por empresa, con versión). Se usa su
`acepto_aviso_vigente(usuario)` si existe, o `acepto(usuario)` (la que expone
hoy: True si la empresa activa no tiene aviso o si la persona aceptó la
versión vigente). Si cambia de nombre, se ajusta `_FUNCIONES` aquí. Nada más
en Nova consulta el consentimiento: todo pasa por `acepto_aviso_vigente` de
este archivo, que el núcleo llama antes de cada envío.

Tolerante a propósito, mientras el registro no exista:
- Si el módulo o la función no existen todavía, **permite** (decisión del
  09/11/2026).
- Si existen y fallan, **no permite** (la función degrada a la versión sin IA):
  ante la duda no se envían datos.
"""

import importlib
import logging

logger = logging.getLogger(__name__)

_MODULO = "apps.privacidad.consentimiento"
_FUNCIONES = ("acepto_aviso_vigente", "acepto")


def acepto_aviso_vigente(usuario) -> bool:
    try:
        modulo = importlib.import_module(_MODULO)
    except ImportError:
        return True
    funcion = next(
        (getattr(modulo, n) for n in _FUNCIONES if callable(getattr(modulo, n, None))), None
    )
    if funcion is None:
        return True
    try:
        return bool(funcion(usuario))
    except Exception:  # noqa: BLE001 — ante la duda no se envían datos
        logger.exception("[nova] no se pudo consultar el consentimiento")
        return False
