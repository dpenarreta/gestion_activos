"""Recálculo del contenido de dashboards ya existentes, sin tocar nada más.

`DashboardComponent.content` es un campo **almacenado**: se calcula una vez, al aplicar el mapeo, y
se sirve tal cual en cada lectura. Esa decisión es correcta (evita recalcular pandas en cada
petición), pero tiene una consecuencia: cuando se corrige un error en el núcleo de cálculo, los
dashboards que ya existen siguen mostrando los valores viejos indefinidamente. Nadie los recalcula
solo.

Este módulo es el puente para esos casos: recalcula el contenido a partir de la MISMA fuente de
datos y la MISMA fecha de corte que se usó la última vez, de modo que cualquier diferencia que
aparezca viene del cambio de código y de nada más.

Alcanza a TODO componente que tenga un mapeo, no solo a las 13 posiciones fijas. Un dashboard puede
tener casi todo su contenido en la Zona Personal —el Dashboard Directorio tiene ahí sus 8 secciones
reales—, y recorrer únicamente `PLANTILLA_SLOTS` dejaba justo esos fuera: el comando informaba
cambios en posiciones de fábrica ocultas y no tocaba nada de lo que se ve en pantalla.

Lo que se recalcula son los DATOS. El título no: lo escribió una persona y `calcular_datos_mapeo` lo
rearma desde `PLANTILLA_SLOTS` ("KPI 1", "Gráfico 3"), así que sin conservarlo un reproceso masivo
revertiría en silencio todos los renombres del proyecto.

No usa `plantilla.aplicar_mapeo` aunque esa función ya no pise la personalización (desde que
reconstruye sobre `slots_vigentes`, no sobre `PLANTILLA_SLOTS`): para un reproceso masivo sigue
siendo demasiado. Borra y recrea los 13 componentes, sube la versión del layout —lo que hace que a
cualquiera con el editor abierto le aparezca el conflicto 409— y registra un evento de auditoría de
"plantilla aplicada" que no describe lo que pasó. Acá se actualiza únicamente `content` con
`update_fields`, y todo lo demás queda intacto.
"""

from ..models import CargaArchivo, DashboardLayout
from . import carga_archivos, db_source, plantilla


def _mapeo_del_layout(layout):
    """Reconstruye el mapeo del dashboard a partir de los componentes.

    El mapeo se guarda por componente (`DashboardComponent.mapeo`, escrito por
    `plantilla._construir_componente`) y no a nivel de layout, así que la forma que espera
    `calcular_datos_mapeo` — `{slot_id: propuesta}` — se arma acá. `component_id` **es** el id del
    slot, por construcción.
    """
    return {
        componente.component_id: componente.mapeo
        for componente in layout.components.all()
        if componente.mapeo
    }


def _con_titulo_vigente(contenido, componente):
    """El contenido recalculado, pero con el título que el componente tiene hoy."""
    titulo = (componente.content or {}).get('titulo')
    return {**contenido, 'titulo': titulo} if titulo else contenido


def _ultima_carga(dashboard_id):
    return (
        CargaArchivo.objects
        .filter(dashboard_id=dashboard_id, estado=CargaArchivo.Estado.PROCESADO)
        .order_by('-fecha_carga')
        .first()
    )


def _dashboard_de(dashboard_id):
    from ..models import Dashboard
    return Dashboard.objects.filter(dashboard_id=dashboard_id).first()


def analizar_dashboard(dashboard_id):
    """Calcula el contenido nuevo y lo compara con el vigente, **sin escribir nada**.

    Devuelve un dict con `ok`, `motivo` (cuando no se puede), y la lista `cambios` de
    `{component_id, antes, despues}` para los componentes cuyo contenido cambiaría.
    """
    layout = DashboardLayout.objects.filter(dashboard_id=dashboard_id).first()
    if layout is None:
        return {'ok': False, 'motivo': 'No tiene layout.', 'cambios': []}

    mapeo = _mapeo_del_layout(layout)
    if not mapeo:
        return {
            'ok': False,
            'motivo': 'Ningún componente tiene mapeo — nunca se le aplicó una plantilla con datos reales.',
            'cambios': [],
        }
    # `_mapeo_del_layout` trae el mapeo de TODOS los componentes; `calcular_datos_mapeo` solo sabe
    # leer el de las 13 posiciones fijas y las de Zona Personal se resuelven aparte, una por una.

    carga = _ultima_carga(dashboard_id)
    if carga is None:
        return {'ok': False, 'motivo': 'No tiene ninguna carga procesada de la que releer los datos.', 'cambios': []}

    try:
        _ruta, df = carga_archivos.leer_archivo_de_carga(carga)
    except Exception as exc:  # noqa: BLE001 - cualquier fallo de lectura deja el dashboard sin reprocesar
        return {'ok': False, 'motivo': f'No se pudo leer el archivo de la carga {carga.id}: {exc}', 'cambios': []}

    # Los alias de columnas ya están aplicados en la copia permanente (se escribe después de
    # renombrar), pero no en el temporal. Reaplicarlos es idempotente, así que se hace siempre.
    dashboard = _dashboard_de(dashboard_id)
    if dashboard is not None and dashboard.fuente_bd_ultimo_aliases:
        df = db_source.aplicar_alias_columnas(df, dashboard.fuente_bd_ultimo_aliases)

    contenidos = {
        **plantilla.calcular_datos_mapeo(df, mapeo, dashboard_id, carga.fecha_corte),
        **plantilla.recalcular_zona_personal(layout, df, dashboard_id, carga.fecha_corte),
    }

    cambios = []
    for componente in layout.components.all():
        nuevo = contenidos.get(componente.component_id)
        if nuevo is None:
            continue
        nuevo = _con_titulo_vigente(nuevo, componente)
        contenidos[componente.component_id] = nuevo
        if nuevo == componente.content:
            continue
        cambios.append({
            'component_id': componente.component_id, 'antes': componente.content, 'despues': nuevo,
            'visible': componente.is_visible,
        })

    return {
        'ok': True,
        'motivo': '',
        'cambios': cambios,
        'carga_id': str(carga.id),
        'fecha_corte': carga.fecha_corte,
        'filas': len(df),
        'contenidos': contenidos,
        'layout': layout,
    }


def aplicar_dashboard(dashboard_id):
    """Analiza y, si hay cambios, los escribe — solo el campo `content` de cada componente.

    Sube `layout.version` cuando escribe: un editor con la pantalla abierta tiene que recibir el
    409 de siempre y recargar, en vez de guardar encima con el contenido viejo.
    """
    resultado = analizar_dashboard(dashboard_id)
    if not resultado['ok'] or not resultado['cambios']:
        return resultado

    contenidos = resultado['contenidos']
    layout = resultado['layout']
    afectados = {cambio['component_id'] for cambio in resultado['cambios']}

    for componente in layout.components.all():
        if componente.component_id not in afectados:
            continue
        componente.content = contenidos[componente.component_id]
        componente.save(update_fields=['content'])

    layout.version += 1
    layout.save(update_fields=['version', 'actualizado_en'])
    return resultado


def dashboards_con_layout():
    """Ids de todos los dashboards que tienen layout, en orden estable."""
    return list(
        DashboardLayout.objects.order_by('dashboard_id').values_list('dashboard_id', flat=True)
    )
