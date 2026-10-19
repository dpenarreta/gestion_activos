"""Los nombres de estados y prioridades, como los llama cada empresa.

Los valores guardados no cambian («atendido», «critica»); lo que cambia es
cómo se muestran. Una empresa puede decir «Resuelto» en vez de «Atendido» o
«P1» en vez de «P1 · Crítica» (Configuración → Mesa de ayuda → Horario y
metas), y así el reporte a la Gerencia usa su propio vocabulario.
"""

from .models import ConfiguracionMesa, Prioridad, Ticket

#: Lo máximo que puede medir un nombre propio.
LARGO_MAXIMO = 40


def de_la_empresa(empresa_id=None) -> dict:
    """``{"estados": {valor: nombre}, "prioridades": {valor: nombre}}``."""
    if empresa_id:
        configuracion = ConfiguracionMesa.objects.todas().filter(empresa_id=empresa_id).first()
    else:
        configuracion = ConfiguracionMesa.objects.first()
    propias = (configuracion.etiquetas if configuracion else None) or {}
    return {
        "estados": {
            valor: (propias.get("estados") or {}).get(valor) or etiqueta
            for valor, etiqueta in Ticket.Estado.choices
        },
        "prioridades": {
            valor: (propias.get("prioridades") or {}).get(valor) or etiqueta
            for valor, etiqueta in Prioridad.choices
        },
    }


def limpiar(etiquetas) -> dict:
    """Solo los estados y prioridades que existen, con texto corto. Lo vacío
    vuelve al nombre de siempre."""
    if not isinstance(etiquetas, dict):
        return {}
    limpias = {}
    for grupo, validos in (("estados", Ticket.Estado.values), ("prioridades", Prioridad.values)):
        valores = etiquetas.get(grupo) or {}
        if not isinstance(valores, dict):
            continue
        propias = {
            clave: str(texto).strip()[:LARGO_MAXIMO]
            for clave, texto in valores.items()
            if clave in validos and str(texto or "").strip()
        }
        if propias:
            limpias[grupo] = propias
    return limpias
