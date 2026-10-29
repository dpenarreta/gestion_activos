"""El aviso del rol de pagos al iniciar sesión (aviso del rol de pagos,
29/10/2026, pedido de la administración).

Desde el primer día hábil de cada mes, a quien está habilitado para ver su rol
en línea le sale, en cada inicio de sesión, un aviso que lo lleva a su rol del
mes anterior. Sale hasta que lo **acepta**: abrirlo no basta. Pasados los días
hábiles permitidos (`aviso_dias_habiles`, 3 por defecto), el mensaje cambia y
le advierte que puede ser sancionado por exceder el plazo; sigue saliendo hasta
que lo acepte. Los textos se administran en «Textos de la consulta».

- **Aceptado** es que exista su `RolAceptado` del período (`aceptado.py`): se
  crea al responder «Estuvo de acuerdo» o al cerrar el visor sin responder
  («Aceptó al cerrar sin responder»), y la aceptación es definitiva.
- **Con observación** (dijo que algo no está bien) no se le sigue presionando
  con la sanción: ya respondió y el siguiente paso es de Talento Humano. Si
  Talento Humano lo corrige, la pantalla del rol le pide confirmarlo
  («Correcciones por confirmar»); este aviso no vuelve a salir por ese mes.
"""

import datetime

from django.utils import timezone

from . import aceptado, dias_habiles, services
from .models import ConsultaRolPagos

MESES = (
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
)


def mes_anterior(hoy: datetime.date) -> tuple[int, int]:
    return (hoy.year - 1, 12) if hoy.month == 1 else (hoy.year, hoy.month - 1)


def rellenar(texto: str, *, anio: int, mes: int, dias: int) -> str:
    """Reemplaza `{mes}`, `{anio}` y `{dias}` en un texto que escribió la
    administración. Con reemplazos simples y no con `str.format`: unas llaves
    sueltas o un `{0.__class__}` en el texto no rompen ni exponen nada."""
    return (
        (texto or "")
        .replace("{mes}", MESES[mes - 1])
        .replace("{anio}", str(anio))
        .replace("{dias}", str(dias))
    )


def _respondido(codigo: str, anio: int, mes: int) -> bool:
    if aceptado.de_periodo(codigo, anio, mes) is not None:
        return True
    # Dejó una observación: no aceptó, pero ya respondió (ver arriba).
    return ConsultaRolPagos.objects.filter(
        codigo_empleado=codigo,
        anio=anio,
        mes=mes,
        conformidad=ConsultaRolPagos.Conformidad.OBSERVACION,
    ).exists()


def aviso_del_mes(usuario, hoy: datetime.date | None = None) -> dict | None:
    """El aviso que le toca hoy, o `None` si no le corresponde."""
    config = services.configuracion()
    if not config.aviso_activo:
        return None
    codigo = services.codigo_de(usuario)
    if not codigo or not services.habilitado(usuario):
        return None
    # La fecha de Ecuador (TIME_ZONE), no la del servidor ni la UTC.
    hoy = hoy or timezone.localdate()
    primero = dias_habiles.primer_dia_habil(hoy.year, hoy.month)
    if primero is None or hoy < primero:
        return None
    anio, mes = mes_anterior(hoy)
    if _respondido(codigo, anio, mes):
        return None
    dias = config.aviso_dias_habiles
    # Los días hábiles 1..N del mes, el mensaje normal; desde el N+1, el de
    # plazo vencido (un fin de semana cuenta los hábiles ya transcurridos).
    vencido = dias_habiles.numero_de_dia_habil(hoy) > dias
    titulo, mensaje = (
        (config.aviso_titulo_vencido, config.aviso_mensaje_vencido)
        if vencido
        else (config.aviso_titulo, config.aviso_mensaje)
    )
    return {
        "anio": anio,
        "mes": mes,
        "vencido": vencido,
        "titulo": rellenar(titulo, anio=anio, mes=mes, dias=dias),
        "mensaje": rellenar(mensaje, anio=anio, mes=mes, dias=dias),
        "dias_habiles": dias,
        "enlace": f"/admin/institucional/rol-pagos?anio={anio}&mes={mes}",
    }
