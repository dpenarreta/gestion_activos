"""Estructura fijada de un dashboard: la que sobrevive a cualquier reescritura del layout.

`Dashboard.estructura_bloqueada` impide los cambios que pasan por la interfaz
(`services/desbloqueo.py`). Esto es lo otro: qué hacer cuando el layout se reescribe igual, por
un camino que no es "editar el diseño".

Hay varios, y no son hipotéticos:

- **"Borrar datos"** elimina los componentes de la Zona Personal —que en el Dashboard Directorio
  son el informe entero— y resiembra las 13 posiciones de ejemplo.
- **Aplicar un mapeo** (cargar un archivo, conectar la fuente, la actualización automática)
  reconstruye las 13 posiciones y reordena lo demás detrás.
- **"Restablecer diseño"** vuelve a mostrar todo lo que estuviera oculto.

Los tres son operaciones de DATOS legítimas que no se deben bloquear: sin ellas el dashboard no
se puede actualizar. Lo que no puede pasar es que se lleven puesta la estructura. Así que en vez
de prohibirlas, se repone: cada vez que algo escribe componentes, los tipos, el orden, las
dimensiones y la visibilidad vuelven a ser los de la foto, y los componentes que falten se
recrean.

Lo que NO se repone es el contenido: los datos son justamente lo que esas operaciones vienen a
cambiar. Un componente que se repone después de un borrado aparece vacío hasta que se vuelvan a
calcular los datos, con su tamaño y su lugar intactos.
"""

from ..models import Dashboard

# Lo que define la ESTRUCTURA. El resto de los campos de un componente (contenido, mapeo,
# estilos, configuración) son datos o preferencias y no se tocan.
CAMPOS_ESTRUCTURALES = ('type', 'chart_type', 'row', 'order', 'width', 'height', 'is_visible')


def _foto_de(componente):
    return {
        'component_id': componente.component_id,
        'type': componente.type,
        'chart_type': componente.chart_type,
        'row': componente.row,
        'order': componente.order,
        'width': componente.width,
        'height': componente.height,
        'is_visible': componente.is_visible,
        # `config` y `mapeo` viajan como RESPALDO, no como parte de la estructura: nunca pisan
        # los vigentes. Solo se usan cuando hay que recrear un componente que ya no existe, y
        # son la diferencia entre reponer una sección que se puede recalcular
        # (`reprocesar_dashboards` necesita su mapeo) y reponer un cascarón vacío.
        'config': componente.config or {},
        'mapeo': componente.mapeo or {},
    }


def fijar(dashboard_id):
    """Guarda la estructura actual del dashboard como la que hay que conservar.

    Se llama al bloquear y cada vez que el dashboard se vuelve a sembrar: sembrar es la única
    operación que define legítimamente una estructura nueva, así que después de ella la foto
    tiene que ser la nueva, no la anterior.
    """
    from ..models import DashboardComponent

    dashboard = Dashboard.objects.filter(dashboard_id=dashboard_id).first()
    if dashboard is None:
        return []
    componentes = DashboardComponent.objects.filter(layout__dashboard_id=dashboard_id).order_by('order')
    foto = [_foto_de(c) for c in componentes]
    dashboard.estructura_fijada = foto
    dashboard.save(update_fields=['estructura_fijada'])
    return foto


def limpiar(dashboard_id):
    Dashboard.objects.filter(dashboard_id=dashboard_id).update(estructura_fijada=[])


def fijada_de(dashboard_id):
    dashboard = Dashboard.objects.filter(dashboard_id=dashboard_id).first()
    if dashboard is None or not dashboard.estructura_bloqueada:
        return []
    return dashboard.estructura_fijada or []


def aplicar(dashboard_id, componentes, actuales=None):
    """Los `componentes` que se iban a escribir, con la estructura fijada repuesta encima.

    Tres cosas, en este orden:

    1. Los componentes de la foto que la escritura traiga, conservan su contenido pero recuperan
       tipo, orden, tamaño y visibilidad.
    2. Los que la escritura NO traiga se reponen, con el contenido que tuvieran guardado
       (`actuales`) o vacíos si tampoco existen ya.
    3. Los que no estén en la foto se descartan: en un dashboard bloqueado no se agregan
       componentes, y dejarlos pasar acá sería la puerta de atrás de esa regla.

    Sin estructura fijada devuelve `componentes` tal cual, que es el caso de todos los demás
    dashboards.
    """
    foto = fijada_de(dashboard_id)
    if not foto:
        return componentes

    entrantes = {c.get('component_id'): c for c in componentes}
    previos = {c.component_id: c for c in (actuales or [])}

    repuestos = []
    for spec in foto:
        component_id = spec['component_id']
        base = entrantes.get(component_id)
        if base is None:
            anterior = previos.get(component_id)
            base = {
                'component_id': component_id,
                'content': (anterior.content if anterior else {}) or {},
                'styles': (anterior.styles if anterior else {}) or {},
                # Del componente que existía si existe; del respaldo de la foto si no. Sin esto,
                # una sección repuesta después de "Borrar datos" volvería sin mapeo y ya no
                # habría forma de recalcularla: estaría, pero vacía para siempre.
                'config': (anterior.config if anterior else None) or spec.get('config') or {},
                'mapeo': (anterior.mapeo if anterior else None) or spec.get('mapeo') or {},
            }
        repuestos.append({**base, **{campo: spec[campo] for campo in CAMPOS_ESTRUCTURALES}})
    return repuestos
