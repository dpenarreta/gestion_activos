"""Layout configurable del dashboard (secciones 8, 17, 19, 23 del prompt de personalización).

Cada dashboard nace sin componentes: no hay un layout fijo predefinido por `dashboard_id`. Los
componentes (KPIs y gráficas) se agregan de a uno, cuando el usuario confirma una recomendación
generada a partir de un archivo cargado (`services/generic_charts.py` +
`agregar_componente_generado`, único punto que puede introducir componentes nuevos). La edición
manual del grid (`aplicar_layout`, vía el editor visual) solo puede reordenar/redimensionar/ocultar
/retitular los componentes que YA existen — se valida contra ellos mismos, no contra un catálogo
fijo. Los 16 campos de filtro individuales del pipeline de cartera original quedaron huérfanos
junto con el resto de ese pipeline fijo (ver `docs/integracion/migration_report.md`).
"""

import re

from django.utils.text import slugify

from apps.cartera.compat import AuditEvent
from apps.cartera.compat import log_event

from ..constants import PAGE_SIZE_POR_DEFECTO, PAGE_SIZES_PERMITIDOS
from ..exceptions import CarteraError
from ..models import DashboardComponent, DashboardLayout
from . import desbloqueo, estructura
from .generic_charts import (
    ETIQUETAS_TRAMOS_ACUMULADOS, LIMITE_DEUDORES, TIPOS_VISUALIZACION, evaluar_meta,
)

_CHART_TYPES_VALIDOS = {t['id'] for t in TIPOS_VISUALIZACION} | {''}

# Vocabulario de tipos de cambio (antes `DashboardAuditLog.TipoCambio`, hoy valores de `action`
# en `AuditEvent` — Módulo A de "trabajo futuro post-integración": auditoría unificada). Se
# mantienen los mismos literales para que la futura migración de datos históricos
# (docs/audit/unified_audit.md) pueda mapear 1:1 las filas legacy de `DashboardAuditLog`.
class CambioLayout:
    ORDEN = 'CAMBIO_DE_ORDEN'
    TAMANO = 'CAMBIO_DE_TAMANO'
    COLOR = 'CAMBIO_DE_COLOR'
    TEXTO = 'CAMBIO_DE_TEXTO'
    CONFIG = 'CAMBIO_DE_CONFIGURACION'
    OCULTADO = 'COMPONENTE_OCULTADO'
    ELIMINADO = 'COMPONENTE_ELIMINADO'
    RESTABLECIDO = 'DISENO_RESTABLECIDO'

ANCHO_MIN, ANCHO_MAX = 1, 12
ALTO_MIN, ALTO_MAX = 60, 1200
LONGITUD_MAXIMA_TITULO = 200
LONGITUD_MAXIMA_DESCRIPCION = 500

KPI_ANCHO, KPI_ALTO = 3, 180
CHART_ANCHO, CHART_ALTO = 6, 420
TABLA_ALTO = 380

_HEX_RE = re.compile(r'^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
_RGBA_RE = re.compile(
    r'^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$'
)


def componentes_validos(dashboard_id):
    """Los componentes válidos para editar un dashboard son los que YA existen en su layout —
    no hay un catálogo fijo: solo se puede reordenar/redimensionar/ocultar/retitular lo que ya
    fue generado (`establecer_componentes_generados`)."""
    existentes = DashboardComponent.objects.filter(layout__dashboard_id=dashboard_id)
    return {
        c.component_id: {
            'component_id': c.component_id,
            'type': c.type,
            'chart_type': c.chart_type,
            'row': c.row,
            'order': c.order,
            'width': c.width,
            'height': c.height,
            # `is_visible` no estaba, y su ausencia se notaba en dos lugares: al agregar un
            # componente nuevo, `_escribir_componentes` reescribía TODOS los existentes con su
            # default `True` y sacaba de golpe a la luz los que estaban ocultos (en el Dashboard
            # Directorio, las 13 posiciones de fábrica); y `validar_componentes` comparaba la
            # visibilidad entrante contra ese mismo `True` supuesto, así que en un componente
            # bloqueado el cambio "de oculto a visible" no se detectaba como cambio.
            'is_visible': c.is_visible,
            'content': c.content,
            'styles': c.styles,
            'config': c.config,
            'mapeo': c.mapeo,
        }
        for c in existentes
    }


def obtener_o_crear_layout(dashboard_id):
    layout, _creado = DashboardLayout.objects.get_or_create(dashboard_id=dashboard_id)
    return layout


def _escribir_componentes(layout, componentes):
    """Reescribe los componentes del layout. ÚNICO punto de escritura: por acá pasan el editor,
    la aplicación de un mapeo, el borrado de datos, el restablecimiento y la siembra.

    Que sea único es lo que permite reponer la estructura fijada en un solo lugar
    (`services/estructura.py`): un dashboard bloqueado conserva sus tipos, orden y dimensiones
    venga la escritura de donde venga, sin tener que acordarse de cubrir cada camino por separado.
    """
    actuales = list(DashboardComponent.objects.filter(layout=layout))
    componentes = estructura.aplicar(layout.dashboard_id, componentes, actuales=actuales)
    DashboardComponent.objects.filter(layout=layout).delete()
    objetos = [
        DashboardComponent(
            layout=layout,
            component_id=c['component_id'],
            type=c['type'],
            chart_type=c.get('chart_type', ''),
            row=c['row'],
            order=c['order'],
            width=c['width'],
            height=c['height'],
            is_visible=c.get('is_visible', True),
            content=c.get('content') or {},
            styles=c.get('styles') or {},
            config=c.get('config') or {},
            mapeo=c.get('mapeo') or {},
        )
        for c in componentes
    ]
    DashboardComponent.objects.bulk_create(objetos)


def serializar_layout(layout):
    return {
        'dashboard_id': layout.dashboard_id,
        'version': layout.version,
        'scope': layout.scope,
        'theme': layout.theme,
        # Lo necesita el editor para deshabilitar los controles de estructura y avisar por qué,
        # en vez de dejar que la persona reacomode todo y recién al guardar se entere de que no
        # se podía. La comprobación real sigue estando en el backend.
        'estructura_bloqueada': desbloqueo.esta_bloqueado(layout.dashboard_id),
        'components': [
            {
                'component_id': c.component_id,
                'type': c.type,
                'chart_type': c.chart_type,
                'row': c.row,
                'order': c.order,
                'width': c.width,
                'height': c.height,
                'is_visible': c.is_visible,
                'content': c.content,
                'styles': c.styles,
                'config': c.config,
                'mapeo': c.mapeo,
            }
            for c in layout.components.all()
        ],
    }


def _validar_color(valor, campo):
    if not valor:
        return
    if not isinstance(valor, str) or not (_HEX_RE.match(valor) or _RGBA_RE.match(valor)):
        raise CarteraError(f'Color inválido en "{campo}": {valor}', codigo='COLOR_INVALIDO')


# Campos de `styles` que son un mapa {nombre_de_categoria_o_serie: color}, no un color suelto —
# "cada categoría/serie debe tener su propio color editable" (una gráfica de barras/pastel puede
# tener hasta 16 categorías, una agrupada/apilada hasta `MAX_SERIES_EN_GRAFICA` series, así que no
# hay una cantidad fija de campos: el frontend arma un color por cada nombre que trae `content`).
CAMPOS_COLOR_POR_NOMBRE = {'coloresPorCategoria', 'coloresPorSerie'}


def _validar_estilos(styles):
    resultado = {}
    for campo, valor in styles.items():
        if campo in CAMPOS_COLOR_POR_NOMBRE:
            if not isinstance(valor, dict):
                raise CarteraError(f'El campo "{campo}" debe ser un objeto de colores.', codigo='COLOR_INVALIDO')
            mapa = {}
            for nombre, color in valor.items():
                _validar_color(color, f'{campo}.{nombre}')
                if color:
                    mapa[nombre] = color
            resultado[campo] = mapa
        else:
            _validar_color(valor, campo)
            resultado[campo] = valor
    return resultado


_ETIQUETA_HTML_RE = re.compile(r'<[^>]*>')


def _sanitizar_texto(valor, longitud_maxima, campo):
    """Quita únicamente patrones tipo etiqueta HTML (`<script>`, `<img ...>`), no cualquier
    aparición suelta de `<`/`>` — un título legítimo como "Cartera > 120 días" debe sobrevivir."""
    if valor is None:
        return valor
    if not isinstance(valor, str):
        raise CarteraError(f'El campo "{campo}" debe ser texto.', codigo='TEXTO_INVALIDO')
    limpio = _ETIQUETA_HTML_RE.sub('', valor).strip()
    if len(limpio) > longitud_maxima:
        raise CarteraError(f'El campo "{campo}" supera la longitud máxima ({longitud_maxima}).', codigo='TEXTO_DEMASIADO_LARGO')
    return limpio


def _sanitizar_config_paginacion(config):
    """Nunca lanza error: si `allowedPageSizes`/`defaultPageSize` no son válidos, cae al
    valor por defecto (sección 4/5 de la especificación de paginación configurable)."""
    permitidos = [p for p in (config.get('allowedPageSizes') or []) if p in PAGE_SIZES_PERMITIDOS]
    if not permitidos:
        permitidos = sorted(PAGE_SIZES_PERMITIDOS)
    config['allowedPageSizes'] = permitidos

    default_page_size = config.get('defaultPageSize')
    if default_page_size not in permitidos:
        default_page_size = PAGE_SIZE_POR_DEFECTO if PAGE_SIZE_POR_DEFECTO in permitidos else permitidos[0]
    config['defaultPageSize'] = default_page_size

    return config


_TIPOS_CELDA_VALIDOS = (int, float, str, type(None))


def _validar_contenido_tabla(component_id, content, contenido_original, mapeo_cambio=False):
    """Editar valores de celda (panel de propiedades, `TableCellsEditor.jsx`) solo puede cambiar
    el VALOR de una celda que ya existe — nunca agregar/quitar filas ni columnas, ni renombrarlas.
    Ocultar los botones de agregar/quitar en el frontend no alcanza (`@.claude/rules/security.md`):
    esto es lo que realmente lo impide. Solo aplica a tablas "multi-columna"
    (`content.columnas`/`content.filas` en forma de lista — lo que arma
    `generic_charts.generar_datos_tabla`); la forma simple categorías/valores de 2 columnas no la
    usa `agregar_componente_generado` para tablas y queda fuera de este chequeo.

    `mapeo_cambio=True` cuando la fuente de datos del componente cambió en este mismo guardado
    (reconfigurar "Datos" en el panel de propiedades, plantilla fija o Zona Personal — ver
    `views.PrevisualizarMapeoPlantillaView`/`PrevisualizarMapeoComponenteView`): ahí una cantidad
    distinta de filas/columnas es exactamente lo esperado (nueva agrupación), así que no se exige
    la misma forma que antes — solo se sigue validando que cada celda tenga un tipo válido, como
    defensa básica contra un payload manipulado."""
    columnas_originales = contenido_original.get('columnas')
    filas_originales = contenido_original.get('filas')
    if not isinstance(columnas_originales, list) or not isinstance(filas_originales, list):
        return

    columnas = content.get('columnas')
    if not isinstance(columnas, list):
        raise CarteraError(f'La tabla "{component_id}" no tiene columnas válidas.', codigo='TABLA_COLUMNAS_INVALIDAS')
    if not mapeo_cambio and columnas != columnas_originales:
        raise CarteraError(
            f'No se pueden agregar, quitar ni renombrar las columnas de la tabla "{component_id}".',
            codigo='TABLA_COLUMNAS_INVALIDAS',
        )

    def _validar_fila(fila, nombre_fila):
        if not isinstance(fila, list) or len(fila) != len(columnas):
            raise CarteraError(
                f'La fila "{nombre_fila}" de la tabla "{component_id}" no tiene la cantidad de columnas esperada.',
                codigo='TABLA_FILAS_INVALIDAS',
            )
        for valor in fila:
            if not isinstance(valor, _TIPOS_CELDA_VALIDOS):
                raise CarteraError(
                    f'Valor de celda inválido en la fila "{nombre_fila}" de la tabla "{component_id}".',
                    codigo='TABLA_CELDA_INVALIDA',
                )

    filas = content.get('filas')
    if not isinstance(filas, list):
        raise CarteraError(f'La tabla "{component_id}" no tiene filas válidas.', codigo='TABLA_FILAS_INVALIDAS')
    if not mapeo_cambio and len(filas) != len(filas_originales):
        raise CarteraError(
            f'No se pueden agregar ni quitar filas de la tabla "{component_id}".', codigo='TABLA_FILAS_INVALIDAS',
        )
    for i, fila in enumerate(filas):
        _validar_fila(fila, f'fila {i + 1}')

    total_original = contenido_original.get('total')
    total = content.get('total')
    if mapeo_cambio:
        if total is not None:
            _validar_fila(total, 'total')
    elif total_original is not None:
        _validar_fila(total, 'total')


def _validar_numero_meta(valor, campo, component_id):
    """`None`/`''` (sin meta) pasan tal cual y quedan como `None`. Cualquier otra cosa debe ser un
    número real — `bool` se rechaza a propósito (en Python es subclase de `int`; un checkbox mal
    serializado no debe colarse como meta `0`/`1`)."""
    if valor in (None, ''):
        return None
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        raise CarteraError(f'Meta inválida en "{component_id}": {valor!r}.', codigo='META_INVALIDA')
    return float(valor)


TOP_N_MIN, TOP_N_MAX = 1, 100
FORMATOS_KPI_VALIDOS = {'numero', 'moneda', 'porcentaje'}


def _validar_formato_kpi(valor, component_id):
    """`None`/`''` (sin elegir) cae al valor por defecto histórico `'numero'` — así un KPI creado
    antes de que existiera este campo se sigue mostrando igual que siempre. Cualquier otro valor
    debe ser uno de `FORMATOS_KPI_VALIDOS` (mismas 3 opciones que ya interpretaba
    `GenericKpiCard.jsx::formatearValor`, ahora elegibles desde "Configurar componente → Datos")."""
    if valor in (None, ''):
        return 'numero'
    if valor not in FORMATOS_KPI_VALIDOS:
        raise CarteraError(f'Formato inválido en "{component_id}": {valor!r}.', codigo='FORMATO_INVALIDO')
    return valor


def _validar_mapeo_calculo(component_id, tipo, chart_type, mapeo):
    """Valida (y sanitiza) los campos de meta/top-N/formato/histórico de `mapeo` que hoy no valida
    nada más — metas de KPI (`meta_min`/`meta_max`, cualquier componente de tipo KPI, sea una de
    las 4 posiciones fijas o uno de Zona Personal), su `formato` de presentación (`'numero'`/
    `'moneda'`/`'porcentaje'`), cantidad top-N de "Concentración" (`mapeo['calculo'] ==
    'concentracion'`), metas por tramo de "Cumplimiento de metas" (`mapeo['calculo'] ==
    'cumplimiento_metas'`) y `usa_historico` de KPI/Gráfico/Tabla (`calculo in ('kpi', 'chart',
    'multivalor', 'multiserie', 'tabla')` — dispersión, tramos de antigüedad, cumplimiento de
    metas y concentración quedan fuera, su cálculo no se traduce a "una carga = un punto"). Muta
    `mapeo` in-place con los valores ya normalizados (`float`/`None`/`str`/`bool`). A diferencia
    del filtro `dias_vencidos` (permisivo, nunca debe romper una vista previa en vivo — ver
    `plantilla.py::_aplicar_filtro_dias_vencidos`), esto se rechaza de plano: es el punto de
    "Guardar cambios" del editor, mismo criterio que `_validar_color`.

    `calculo` se resuelve con `mapeo.get('calculo')` si está (Zona Personal siempre lo guarda
    explícito) o, si no, por descarte de `chart_type`: las 13 posiciones fijas nunca guardan
    `calculo` dentro del propio mapeo (sale de `PLANTILLA_SLOTS`/estructuralmente del `chart_type`
    ya persistido en el componente, ver `ComponentDataSection.jsx::conCalculo`) — `'tabla'`/
    `'dispersion'` identifican su propio `chart_type` sin ambigüedad; cualquier otro `chart_type`
    de una posición fija corresponde a `'chart'`/`'multivalor'`/`'multiserie'`, que comparten la
    misma validación acá (no hace falta distinguir cuál es cuál para esto)."""
    if tipo == DashboardComponent.Tipo.KPI:
        mapeo['meta_min'] = _validar_numero_meta(mapeo.get('meta_min'), 'meta_min', component_id)
        mapeo['meta_max'] = _validar_numero_meta(mapeo.get('meta_max'), 'meta_max', component_id)
        mapeo['formato'] = _validar_formato_kpi(mapeo.get('formato'), component_id)
        mapeo['usa_historico'] = bool(mapeo.get('usa_historico'))
        return

    calculo = mapeo.get('calculo')
    if calculo is None:
        if chart_type == 'dispersion':
            calculo = 'dispersion'
        elif chart_type == 'tabla':
            calculo = 'tabla'
        else:
            calculo = 'chart'

    if calculo in ('tabla', 'chart', 'multivalor', 'multiserie'):
        mapeo['usa_historico'] = bool(mapeo.get('usa_historico'))
    elif calculo == 'concentracion':
        top_n = mapeo.get('top_n')
        if top_n not in (None, ''):
            if isinstance(top_n, bool) or not isinstance(top_n, int) or not (TOP_N_MIN <= top_n <= TOP_N_MAX):
                raise CarteraError(f'Cantidad (top-N) inválida en "{component_id}": {top_n!r}.', codigo='TOP_N_INVALIDO')
    elif calculo == 'antiguedad_por_deudor':
        cuantos = mapeo.get('cuantos')
        if cuantos not in (None, ''):
            if isinstance(cuantos, bool) or not isinstance(cuantos, int) or not (1 <= cuantos <= LIMITE_DEUDORES):
                raise CarteraError(
                    f'Cantidad de deudores inválida en "{component_id}": {cuantos!r}. '
                    f'Debe estar entre 1 y {LIMITE_DEUDORES}.',
                    codigo='CANTIDAD_DEUDORES_INVALIDA',
                )
    elif calculo == 'cumplimiento_metas':
        metas = mapeo.get('metas')
        if metas is not None:
            if not isinstance(metas, list) or len(metas) > len(ETIQUETAS_TRAMOS_ACUMULADOS):
                raise CarteraError(f'Metas inválidas en "{component_id}".', codigo='METAS_INVALIDAS')
            nuevas_metas = []
            for entrada in metas:
                if entrada is None:
                    nuevas_metas.append(None)
                    continue
                if not isinstance(entrada, dict):
                    raise CarteraError(f'Metas inválidas en "{component_id}".', codigo='METAS_INVALIDAS')
                nuevas_metas.append({
                    'meta_min': _validar_numero_meta(entrada.get('meta_min'), 'meta_min', component_id),
                    'meta_max': _validar_numero_meta(entrada.get('meta_max'), 'meta_max', component_id),
                })
            mapeo['metas'] = nuevas_metas


def validar_componentes(dashboard_id, componentes, es_superusuario=False, desbloqueo_confirmado=False):
    """Valida y sanitiza la lista de componentes entrante. Lanza CarteraError si algo no es
    válido. Devuelve la lista ya sanitizada, lista para persistir. Una lista vacía es válida: el
    editor visual permite borrar componentes (sección "editor del dashboard"), y borrarlos todos
    deja el dashboard vacío — el mismo estado en el que nace cualquier dashboard nuevo.

    Hay DOS bloqueos, con alcance distinto, y los dos rechazan el cambio con
    `CarteraError(codigo='COMPONENTE_BLOQUEADO')`. En ambos casos lo que se congela es la
    ESTRUCTURA (posición relativa, ancho, alto, visibilidad, eliminación): el mapeo y el contenido
    de datos nunca se bloquean, porque son justo lo que hay que poder ajustar cuando cambia el
    origen de los datos.

    - **Por componente** (`config.bloqueado=True`, plantilla base sembrada por migración): lo
      exime `es_superusuario=True`, igual que siempre.
    - **Por dashboard** (`Dashboard.estructura_bloqueada`): alcanza a TODOS sus componentes y no
      lo exime ser superusuario — solo `desbloqueo_confirmado=True`, que la vista obtiene
      verificando la contraseña de quien hace el cambio (`services/desbloqueo.py`).
    """
    validos = componentes_validos(dashboard_id)
    # Los que llevan el flag en su propio `config`: se distingue del conjunto de abajo porque es
    # el único que hay que volver a escribir en `config` al guardar. El bloqueo por dashboard no
    # se copia a cada componente a propósito — tener el mismo hecho en dos lugares es lo que hace
    # que después se contradigan.
    ids_con_flag_propio = {
        component_id for component_id, definicion in validos.items()
        if (definicion.get('config') or {}).get('bloqueado')
    }
    ids_bloqueados = set() if es_superusuario else set(ids_con_flag_propio)
    bloqueo_del_dashboard = desbloqueo.esta_bloqueado(dashboard_id) and not desbloqueo_confirmado
    if bloqueo_del_dashboard:
        ids_bloqueados |= set(validos)

    def _error_bloqueo(mensaje):
        """El código distingue los dos bloqueos, porque el editor reacciona distinto a cada uno.

        Al bloqueo del dashboard se le puede responder confirmando la contraseña, así que la
        interfaz abre el cuadro para hacerlo; al de componente no, y ahí solo queda avisar. Sin
        esta distinción el editor tendría que deducirla, y le ofrecería el cuadro a quien no
        puede usarlo.
        """
        if bloqueo_del_dashboard:
            return CarteraError(
                mensaje, codigo=desbloqueo.CODIGO_BLOQUEADO,
                detalles={'puede_confirmar': bool(es_superusuario)},
            )
        return CarteraError(mensaje, codigo='COMPONENTE_BLOQUEADO')

    if not isinstance(componentes, list):
        raise CarteraError('La configuración debe ser una lista de componentes.', codigo='LAYOUT_INVALIDO')

    ids_vistos = set()
    resultado = []
    for comp in componentes:
        component_id = comp.get('component_id')
        if component_id not in validos:
            raise CarteraError(f'Componente desconocido: "{component_id}".', codigo='COMPONENTE_NO_PERMITIDO')
        if component_id in ids_vistos:
            raise CarteraError(f'Componente duplicado: "{component_id}".', codigo='COMPONENTE_DUPLICADO')
        ids_vistos.add(component_id)

        definicion = validos[component_id]
        bloqueado = component_id in ids_bloqueados

        width = comp.get('width', definicion['width'])
        if not isinstance(width, int) or not (ANCHO_MIN <= width <= ANCHO_MAX):
            raise CarteraError(f'Ancho inválido para "{component_id}": {width}.', codigo='ANCHO_INVALIDO')

        height = comp.get('height', definicion['height'])
        if not isinstance(height, int) or not (ALTO_MIN <= height <= ALTO_MAX):
            raise CarteraError(f'Alto inválido para "{component_id}": {height}.', codigo='ALTO_INVALIDO')

        is_visible = bool(comp.get('is_visible', True))
        if bloqueado and (
            width != definicion['width'] or height != definicion['height']
            or is_visible != bool(definicion.get('is_visible', True))
        ):
            raise _error_bloqueo(
                f'El componente "{component_id}" está bloqueado: no se puede mover, redimensionar '
                'ni ocultar.'
            )

        content = dict(comp.get('content') or {})
        if 'titulo' in content:
            content['titulo'] = _sanitizar_texto(content['titulo'], LONGITUD_MAXIMA_TITULO, 'titulo')
        if 'descripcion' in content:
            content['descripcion'] = _sanitizar_texto(content['descripcion'], LONGITUD_MAXIMA_DESCRIPCION, 'descripcion')
        mapeo_cambio = (comp.get('mapeo') or {}) != (definicion.get('mapeo') or {})
        _validar_contenido_tabla(component_id, content, definicion.get('content') or {}, mapeo_cambio=mapeo_cambio)

        styles = _validar_estilos(dict(comp.get('styles') or {}))

        config = dict(comp.get('config') if comp.get('config') is not None else definicion.get('config', {}))
        if definicion['type'] == DashboardComponent.Tipo.TABLE:
            config = _sanitizar_config_paginacion(config)
        if component_id in ids_con_flag_propio:
            # Reafirma el bloqueo pase lo que pase en el `config` entrante — el mapeo/paginación
            # de arriba sí se puede tocar libremente, pero el flag estructural nunca se pierde
            # (evita que un payload que mande `config: {}` desbloquee el componente sin querer).
            config['bloqueado'] = True

        # A diferencia del resto de campos (siempre se puede editar libremente desde el editor),
        # `chart_type` sí se valida contra el catálogo — un valor arbitrario rompería
        # `GenericChartRenderer` en el frontend (cae al tipo ya guardado, en vez de fallar, si el
        # valor entrante no es uno de los reconocidos).
        chart_type = comp.get('chart_type', definicion.get('chart_type', ''))
        if chart_type not in _CHART_TYPES_VALIDOS:
            chart_type = definicion.get('chart_type', '')

        mapeo = comp.get('mapeo') if comp.get('mapeo') is not None else definicion.get('mapeo', {})
        if not isinstance(mapeo, dict):
            raise CarteraError(f'El campo "mapeo" de "{component_id}" debe ser un objeto.', codigo='MAPEO_INVALIDO')
        mapeo = dict(mapeo)
        _validar_mapeo_calculo(component_id, definicion['type'], chart_type, mapeo)

        resultado.append({
            'component_id': component_id,
            'type': definicion['type'],
            'chart_type': chart_type,
            'row': int(comp.get('row', definicion['row'])),
            'order': int(comp.get('order', definicion['order'])),
            'width': width,
            'height': height,
            'is_visible': is_visible,
            'content': content,
            'styles': styles,
            'config': config,
            'mapeo': mapeo,
        })

    if ids_bloqueados:
        faltantes = ids_bloqueados - ids_vistos
        if faltantes:
            raise _error_bloqueo(
                f'El componente "{sorted(faltantes)[0]}" está bloqueado: no se puede eliminar.'
            )
        # Posición relativa entre sí: comparar la sub-secuencia de ids bloqueados en el orden en
        # que aparecían (guardado) contra la sub-secuencia de esos mismos ids en el orden nuevo —
        # deben coincidir exactamente. El `order`/`row` ABSOLUTO de cada uno puede cambiar como
        # efecto secundario de que se agregue/quite/reordene cualquier OTRO componente (Zona
        # Personal libre alrededor del bloque bloqueado), eso no cuenta como "tocar" el bloqueo.
        secuencia_anterior = [
            component_id for component_id, _ in sorted(validos.items(), key=lambda kv: kv[1]['order'])
            if component_id in ids_bloqueados
        ]
        secuencia_nueva = [
            comp['component_id'] for comp in sorted(resultado, key=lambda c: c['order'])
            if comp['component_id'] in ids_bloqueados
        ]
        if secuencia_nueva != secuencia_anterior:
            raise _error_bloqueo(
                'No se puede cambiar el orden relativo de los componentes bloqueados entre sí.'
            )

    return resultado


def _clasificar_cambio(anterior, nuevo):
    cambios = []
    if anterior is None:
        return cambios
    if (anterior['row'], anterior['order']) != (nuevo['row'], nuevo['order']):
        cambios.append(CambioLayout.ORDEN)
    if (anterior['width'], anterior['height']) != (nuevo['width'], nuevo['height']):
        cambios.append(CambioLayout.TAMANO)
    if anterior['styles'] != nuevo['styles']:
        cambios.append(CambioLayout.COLOR)
    if anterior['content'] != nuevo['content']:
        cambios.append(CambioLayout.TEXTO)
    if anterior.get('config') != nuevo.get('config'):
        cambios.append(CambioLayout.CONFIG)
    if anterior.get('chart_type') != nuevo.get('chart_type') or anterior.get('mapeo') != nuevo.get('mapeo'):
        cambios.append(CambioLayout.CONFIG)
    if anterior['is_visible'] and not nuevo['is_visible']:
        cambios.append(CambioLayout.OCULTADO)
    return cambios


def aplicar_layout(dashboard_id, componentes_nuevos, changed_by, actor=None, request=None):
    """Persiste el layout validado en una sola operación (sección 9) y registra auditoría por
    cada tipo de cambio detectado por componente (sección 19) vía el servicio unificado
    `apps.audit.services.log_event` (Módulo A). Un componente existente que no venga incluido en
    `componentes_nuevos` se interpreta como una eliminación (el editor visual borra componentes
    quitándolos del borrador antes de guardar, no hay un endpoint aparte)."""
    layout = obtener_o_crear_layout(dashboard_id)
    anteriores = {c['component_id']: c for c in serializar_layout(layout)['components']}

    nueva_version = layout.version + 1
    ids_nuevos = {nuevo['component_id'] for nuevo in componentes_nuevos}
    cambios_detectados = []
    for nuevo in componentes_nuevos:
        anterior = anteriores.get(nuevo['component_id'])
        for tipo_cambio in _clasificar_cambio(anterior, nuevo):
            cambios_detectados.append((tipo_cambio, nuevo['component_id'], anterior, nuevo))

    for component_id, anterior in anteriores.items():
        if component_id not in ids_nuevos:
            cambios_detectados.append((CambioLayout.ELIMINADO, component_id, anterior, {}))

    _escribir_componentes(layout, componentes_nuevos)
    layout.version = nueva_version
    layout.save(update_fields=['version', 'actualizado_en'])

    for tipo_cambio, component_id, anterior, nuevo in cambios_detectados:
        log_event(
            domain=AuditEvent.Domain.DASHBOARD_LAYOUT, action=tipo_cambio, actor=actor,
            dashboard_id=dashboard_id, component_id=component_id,
            previous_values=anterior or {}, new_values=nuevo,
            metadata={'version': nueva_version, 'changed_by_label': changed_by or 'Anónimo'},
            request=request,
        )

    return layout


def restablecer_layout(dashboard_id, changed_by, actor=None, request=None):
    """"Restablecer" ya no regenera un layout fijo (no existe uno): vuelve a mostrar cualquier
    componente que se haya ocultado, sin alterar su posición/tamaño/título. Para regenerar las
    gráficas desde cero hay que cargar un archivo nuevo (`establecer_componentes_generados`)."""
    layout = obtener_o_crear_layout(dashboard_id)
    componentes = list(componentes_validos(dashboard_id).values())
    for componente in componentes:
        componente['is_visible'] = True

    layout.version += 1
    _escribir_componentes(layout, componentes)
    layout.save(update_fields=['version', 'actualizado_en'])

    log_event(
        domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action=CambioLayout.RESTABLECIDO, actor=actor,
        dashboard_id=dashboard_id, metadata={'version': layout.version, 'changed_by_label': changed_by or 'Anónimo'},
        request=request,
    )
    return layout


# Tipos de visualización que dibujan una leyenda (varias series o porciones) — los únicos donde
# tiene sentido ofrecer "posición de la leyenda" en el panel de propiedades. Las gráficas de una
# sola serie (barras simples, líneas) no tienen nada que distinguir en una leyenda.
TIPOS_CON_LEYENDA = {'barras_agrupadas', 'barras_apiladas', 'area_apilada', 'lineas_multiples', 'pastel', 'dona'}
LEYENDA_POSICION_POR_DEFECTO = 'abajo'


def _generar_component_id_unico(titulo, usados):
    base = slugify(titulo)[:80] or 'grafica'
    candidato = base
    sufijo = 2
    while candidato in usados:
        candidato = f'{base}-{sufijo}'
        sufijo += 1
    usados.add(candidato)
    return candidato


def agregar_componente_generado(dashboard_id, especificacion, reemplazar_existentes=False, actor=None, request=None):
    """Agrega UNA gráfica/KPI/tabla generado a partir de una recomendación confirmada por el
    usuario (`generic_charts.py::generar_recomendaciones` + `generar_datos_grafica`) o de un
    componente armado a mano para la Zona Personal (`views.py::AgregarGraficaView`) — único punto
    que puede introducir componentes nuevos (su `component_id` se deriva del título, no de un
    catálogo fijo). Por defecto se suma al resto de componentes ya existentes (el usuario va
    agregando gráficas de a una desde la lista de recomendaciones); `reemplazar_existentes=True`
    empieza de cero primero (se usa en la primera gráfica que se agrega tras cargar un archivo
    nuevo, para no mezclar datos de dos archivos distintos en el mismo dashboard).

    `especificacion` es `{'titulo', 'descripcion', 'calculo', 'columna_valor', 'columna_categoria',
    'columna_serie', 'columna_valor_y', 'columna_id', 'columnas_valor', 'tipo_agregacion',
    'tipo_visualizacion', 'ancho_columnas', 'zona', 'datos', 'instruccion_ia', 'columna_contexto_ia',
    'contexto_ia_datos', 'meta_min', 'meta_max', 'formato', 'columna_fecha', 'metas', 'top_n'}` —
    estos últimos 6 solo aplican a `calculo in ('kpi', 'tramos_antiguedad', 'cumplimiento_metas',
    'concentracion')` (`formato` solo a `'kpi'`), ver el bloque que arma `mapeo` más abajo. `calculo` (una de
    'kpi'/'chart'/'multivalor'/'multiserie'/'dispersion'/'tabla'/'tramos_antiguedad'/
    'cumplimiento_metas'/'concentracion', mandada por `AgregarGraficaView` cuando viene de la Zona
    Personal) queda persistida tal
    cual en `DashboardComponent.mapeo` junto con las columnas elegidas — es lo único que permite
    reconfigurar después la fuente de datos de este componente desde "Configurar componente" →
    "Datos" (`ComponentDataSection.jsx`), igual que ya pueden hacer las 13 posiciones fijas de la
    plantilla. Sin `calculo` (flujo legado de recomendaciones automáticas), el componente queda sin
    `mapeo`, como antes de esto. `datos` ya viene calculado por
    `generic_charts.generar_datos_grafica`/`generar_datos_multiserie`/`generar_datos_multivalor`/
    `generar_datos_dispersion`/`generar_datos_tabla` — su forma (`datos['tipo']` =
    'kpi'/'chart'/'multiserie'/'dispersion'/'tabla_multi') decide qué se guarda en `content`;
    `tipo_visualizacion` (una de `generic_charts.TIPOS_VISUALIZACION`, p. ej. 'barras_verticales',
    'lineas', 'pastel', 'dona', 'barras_agrupadas', 'barras_apiladas') solo decide CÓMO se dibuja
    esa misma información — el frontend la usa para elegir el componente de renderizado.
    `ancho_columnas` (1, 2 o 4 — cantidad de columnas del grid de 12 que ocupa cada componente, no
    de `columnas_valor`) traduce a `width = 12 // ancho_columnas`; si no viene, se mantiene el
    ancho por defecto histórico (`KPI_ANCHO`/`CHART_ANCHO`), usado por el flujo legado de
    recomendaciones automáticas. `zona`, si viene, se guarda en `config['zona']` — así lo
    reconocen `EditableGrid.jsx` (agrupación visual en modo edición) y `plantilla._escribir_plantilla`
    (preservación al reaplicar el mapeo de las 15 posiciones fijas). Todo componente generado trae
    una descripción de partida (editable después desde el panel de propiedades, igual que el
    título) y, si su tipo dibuja una leyenda, una posición por defecto también editable ahí.

    `instruccion_ia` (texto libre) y `columna_contexto_ia`/`contexto_ia_datos` (una columna del
    archivo distinta de las que arman el gráfico, ya agregada por `views.AgregarGraficaView` con
    `generic_charts.generar_datos_grafica`) son opcionales — vienen del campo "Instrucción para la
    IA" de `AgregarComponentePersonalModal.jsx`, pensado para pedirle a la IA que interprete este
    componente puntual en términos de algo que el gráfico en sí no muestra (p. ej. "explicá los
    totales por la Causal de gestión"). Se guardan tal cual en `config['instruccion_ia']`/
    `config['contexto_ia']` — nunca afectan `content` ni cómo se dibuja el componente, solo los lee
    `services/dashboard_interpretation.py::_bloque_instruccion_ia` al generar "Hallazgos clave" o
    la "Interpretación completa"."""
    layout = obtener_o_crear_layout(dashboard_id)

    existentes = [] if reemplazar_existentes else list(componentes_validos(dashboard_id).values())
    usados = {c['component_id'] for c in existentes}

    titulo = especificacion['titulo']
    descripcion = especificacion.get('descripcion') or ''
    datos = especificacion['datos']
    component_id = _generar_component_id_unico(titulo, usados)
    orden = len(existentes) + 1
    ancho_elegido = especificacion.get('ancho_columnas')
    kpi_ancho = (12 // ancho_elegido) if ancho_elegido else KPI_ANCHO
    chart_ancho = (12 // ancho_elegido) if ancho_elegido else CHART_ANCHO
    config = {
        'columna_valor': especificacion.get('columna_valor'),
        'columna_categoria': especificacion.get('columna_categoria') or None,
        'columna_serie': especificacion.get('columna_serie') or None,
    }
    zona = especificacion.get('zona')
    if zona:
        config['zona'] = zona
    # `bloqueado`, si viene, se guarda en `config['bloqueado']` — usado por
    # `validar_componentes` para rechazar cambios de posición/tamaño/visibilidad/eliminación de
    # usuarios normales (superusuario exceptuado). Ningún flujo de UI lo manda hoy (ni
    # `AgregarGraficaView` ni `AgregarComponentePersonalModal.jsx` exponen esta opción) — solo lo
    # usa la migración de datos que siembra Dashboard Directorio.
    if especificacion.get('bloqueado'):
        config['bloqueado'] = True
    instruccion_ia = (especificacion.get('instruccion_ia') or '').strip()
    if instruccion_ia:
        config['instruccion_ia'] = instruccion_ia
    contexto_ia_datos = especificacion.get('contexto_ia_datos')
    if contexto_ia_datos and contexto_ia_datos.get('categorias'):
        config['contexto_ia'] = {
            'columna': especificacion.get('columna_contexto_ia'),
            'categorias': contexto_ia_datos['categorias'],
            'valores': contexto_ia_datos['valores'],
        }

    # `mapeo` (a diferencia de `config`, arriba): misma forma por `calculo` que usa
    # `plantilla.py::_calcular_contenido_slot`, más la clave `'calculo'` (que los 13 slots fijos no
    # necesitan guardar porque sale de `PLANTILLA_SLOTS`, pero Zona Personal no tiene ese catálogo
    # externo). Es lo que permite reconfigurar después la fuente de datos de este componente desde
    # "Configurar componente" → "Datos" (`ComponentDataSection.jsx`) — sin esto, `config` guarda las
    # mismas columnas pero nadie las vuelve a leer. Solo se arma si el llamador mandó `calculo`
    # explícito (`AgregarGraficaView`, Zona Personal); el flujo legado de recomendaciones
    # automáticas no lo manda y queda sin `mapeo`, igual que antes de este cambio.
    calculo = especificacion.get('calculo')
    mapeo = {}
    if calculo:
        mapeo = {'disponible': True, 'calculo': calculo}
        if calculo == 'kpi':
            mapeo['columna_valor'] = especificacion.get('columna_valor')
            if especificacion.get('tipo_agregacion'):
                mapeo['tipo_agregacion'] = especificacion['tipo_agregacion']
            if especificacion.get('meta_min') is not None:
                mapeo['meta_min'] = especificacion['meta_min']
            if especificacion.get('meta_max') is not None:
                mapeo['meta_max'] = especificacion['meta_max']
            if especificacion.get('formato'):
                mapeo['formato'] = especificacion['formato']
            if especificacion.get('usa_historico'):
                mapeo['usa_historico'] = True
        elif calculo == 'multivalor':
            mapeo['columna_categoria'] = especificacion.get('columna_categoria')
            mapeo['columnas_valor'] = especificacion.get('columnas_valor')
            if especificacion.get('usa_historico'):
                mapeo['usa_historico'] = True
        elif calculo == 'multiserie':
            mapeo['columna_categoria'] = especificacion.get('columna_categoria')
            mapeo['columna_serie'] = especificacion.get('columna_serie')
            mapeo['columna_valor'] = especificacion.get('columna_valor')
            if especificacion.get('usa_historico'):
                mapeo['usa_historico'] = True
        elif calculo == 'dispersion':
            mapeo['columna_valor'] = especificacion.get('columna_valor')
            mapeo['columna_valor_y'] = especificacion.get('columna_valor_y')
        elif calculo == 'tabla':
            mapeo['columna_id'] = especificacion.get('columna_id')
            mapeo['columnas_valor'] = especificacion.get('columnas_valor')
            if especificacion.get('usa_historico'):
                mapeo['usa_historico'] = True
        elif calculo == 'tramos_antiguedad':
            mapeo['columna_fecha'] = especificacion.get('columna_fecha')
            mapeo['columna_valor'] = especificacion.get('columna_valor')
        elif calculo == 'cumplimiento_metas':
            mapeo['columna_fecha'] = especificacion.get('columna_fecha')
            mapeo['columna_valor'] = especificacion.get('columna_valor')
            mapeo['metas'] = especificacion.get('metas')
        elif calculo == 'concentracion':
            mapeo['columna_id'] = especificacion.get('columna_id')
            mapeo['columna_valor'] = especificacion.get('columna_valor')
            mapeo['top_n'] = especificacion.get('top_n')
        elif calculo == 'antiguedad_por_deudor':
            mapeo['columna_id'] = especificacion.get('columna_id')
            mapeo['columna_fecha'] = especificacion.get('columna_fecha')
            mapeo['columna_valor'] = especificacion.get('columna_valor')
            mapeo['cuantos'] = especificacion.get('cuantos')
        else:
            mapeo['columna_valor'] = especificacion.get('columna_valor')
            mapeo['columna_categoria'] = especificacion.get('columna_categoria')
            if especificacion.get('usa_historico'):
                mapeo['usa_historico'] = True

    if datos['tipo'] == 'dispersion':
        config['columna_valor_y'] = especificacion.get('columna_valor_y')
        nuevo = {
            'component_id': component_id, 'type': DashboardComponent.Tipo.CHART, 'chart_type': 'dispersion',
            'row': orden, 'order': orden, 'width': chart_ancho, 'height': CHART_ALTO, 'is_visible': True,
            'content': {'titulo': titulo, 'descripcion': descripcion, 'puntos': datos['puntos']},
            'styles': {}, 'config': config, 'mapeo': mapeo,
        }
    elif datos['tipo'] == 'kpi':
        content_kpi = {
            'titulo': titulo, 'descripcion': descripcion, 'valor': datos['valor'],
            'formato': especificacion.get('formato') or 'numero',
        }
        meta = evaluar_meta(datos['valor'], especificacion.get('meta_min'), especificacion.get('meta_max'))
        if meta is not None:
            content_kpi['meta'] = meta
        nuevo = {
            'component_id': component_id, 'type': DashboardComponent.Tipo.KPI, 'chart_type': '',
            'row': orden, 'order': orden, 'width': kpi_ancho, 'height': KPI_ALTO, 'is_visible': True,
            'content': content_kpi,
            'styles': {}, 'config': config, 'mapeo': mapeo,
        }
    elif datos['tipo'] == 'tabla_multi':
        config['columna_id'] = especificacion.get('columna_id')
        config['columnas_valor'] = especificacion.get('columnas_valor')
        nuevo = {
            'component_id': component_id, 'type': DashboardComponent.Tipo.CHART, 'chart_type': 'tabla',
            'row': orden, 'order': orden, 'width': chart_ancho, 'height': TABLA_ALTO, 'is_visible': True,
            'content': {
                'titulo': titulo, 'descripcion': descripcion,
                'columnas': datos['columnas'], 'filas': datos['filas'], 'total': datos['total'],
            },
            'styles': {}, 'config': config, 'mapeo': mapeo,
        }
    elif datos['tipo'] == 'multiserie':
        if especificacion.get('columnas_valor'):
            config['columnas_valor'] = especificacion['columnas_valor']
        chart_type = especificacion.get('tipo_visualizacion') or 'barras_agrupadas'
        if chart_type in TIPOS_CON_LEYENDA:
            config['leyenda_posicion'] = LEYENDA_POSICION_POR_DEFECTO
        nuevo = {
            'component_id': component_id, 'type': DashboardComponent.Tipo.CHART, 'chart_type': chart_type,
            'row': orden, 'order': orden, 'width': chart_ancho, 'height': CHART_ALTO, 'is_visible': True,
            'content': {'titulo': titulo, 'descripcion': descripcion, 'categorias': datos['categorias'], 'series': datos['series']},
            'styles': {}, 'config': config, 'mapeo': mapeo,
        }
    else:
        chart_type = especificacion.get('tipo_visualizacion') or 'barras_horizontales'
        if chart_type in TIPOS_CON_LEYENDA:
            config['leyenda_posicion'] = LEYENDA_POSICION_POR_DEFECTO
        nuevo = {
            'component_id': component_id, 'type': DashboardComponent.Tipo.CHART, 'chart_type': chart_type,
            'row': orden, 'order': orden, 'width': chart_ancho, 'height': CHART_ALTO, 'is_visible': True,
            'content': {'titulo': titulo, 'descripcion': descripcion, 'categorias': datos['categorias'], 'valores': datos['valores']},
            'styles': {}, 'config': config, 'mapeo': mapeo,
        }

    _escribir_componentes(layout, existentes + [nuevo])
    layout.version += 1
    layout.save(update_fields=['version', 'actualizado_en'])

    log_event(
        domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_CHART_ADDED', actor=actor,
        dashboard_id=dashboard_id, component_id=component_id, new_values=nuevo,
        metadata={'version': layout.version, 'reemplazo_existentes': reemplazar_existentes},
        request=request,
    )
    return layout


PRESENTACIONAL_ALTO = {DashboardComponent.Tipo.TITLE: 70, DashboardComponent.Tipo.TEXT: 40}
PRESENTACIONAL_ANCHO_DEFECTO = 12
_TITULOS_BASE_PRESENTACIONAL = {DashboardComponent.Tipo.TITLE: 'Nuevo título', DashboardComponent.Tipo.TEXT: 'Separador'}


def agregar_componente_presentacional(dashboard_id, tipo, ancho_columnas=None, zona=None, actor=None, request=None):
    """Agrega un componente puramente presentacional (título o separador, panel lateral de
    componentes del editor de dashboard) — a diferencia de `agregar_componente_generado`, no
    depende de ningún archivo/carga ni calcula nada a partir de columnas: nace con un valor por
    defecto en `content.titulo` (vacío para el separador, un texto de partida para el título),
    editable después desde el panel de propiedades — ya genérico para cualquier componente
    (`content.titulo`/`descripcion`), sin necesitar ningún caso especial ahí. `zona`, si viene, se
    guarda en `config['zona']` (p. ej. `'personal'`, para que `EditableGrid.jsx` lo agrupe junto
    al resto de la Zona Personal, igual que ya hace `agregar_componente_generado`)."""
    if tipo not in PRESENTACIONAL_ALTO:
        raise CarteraError(f'Tipo de componente presentacional inválido: "{tipo}".', codigo='TIPO_INVALIDO')

    layout = obtener_o_crear_layout(dashboard_id)
    existentes = list(componentes_validos(dashboard_id).values())
    usados = {c['component_id'] for c in existentes}

    titulo_base = _TITULOS_BASE_PRESENTACIONAL[tipo]
    component_id = _generar_component_id_unico(titulo_base, usados)
    orden = len(existentes) + 1
    ancho = (12 // ancho_columnas) if ancho_columnas else PRESENTACIONAL_ANCHO_DEFECTO
    config = {'zona': zona} if zona else {}
    nuevo = {
        'component_id': component_id, 'type': tipo, 'chart_type': '',
        'row': orden, 'order': orden, 'width': ancho, 'height': PRESENTACIONAL_ALTO[tipo], 'is_visible': True,
        'content': {'titulo': titulo_base if tipo == DashboardComponent.Tipo.TITLE else ''},
        'styles': {}, 'config': config,
    }

    _escribir_componentes(layout, existentes + [nuevo])
    layout.version += 1
    layout.save(update_fields=['version', 'actualizado_en'])

    log_event(
        domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_CHART_ADDED', actor=actor,
        dashboard_id=dashboard_id, component_id=component_id, new_values=nuevo,
        metadata={'version': layout.version}, request=request,
    )
    return layout
