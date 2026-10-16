"""Plantilla fija de dashboard: 13 posiciones (4 KPI, 6 gráficos, 3 tablas) que todo dashboard
nuevo trae desde su creación (`sembrar_plantilla`, llamado por `services.dashboards.crear_dashboard`),
con datos ficticios mientras no se haya cargado ningún archivo. Al cargar un archivo, se propone
un mapeo automático de columnas a esas mismas 13 posiciones (`sugerir_mapeo`) que el usuario
puede ajustar antes de confirmarlo (`aplicar_mapeo`) — reemplaza al viejo flujo de "recomendar
gráficas sueltas" (`AnalizarColumnasView`/`RecomendarGraficasView`/`AgregarGraficaView`, que se
dejan intactos pero sin consumidor en el frontend nuevo).

De esas 3 tablas, la última (Tabla 3) es especial: en vez de mostrar el detalle del último archivo
cargado (como Tabla 1/2), el frontend (`TablaHistoricaAutomatica.jsx`) la intercepta por
`component_id` para comparar en vivo todas las cargas históricas del dashboard — por eso va al
final de la zona de tablas de apoyo dentro de `PLANTILLA_SLOTS` y lleva una etiqueta fija
"Histórica" junto a su título. Acá, en el backend, no se distingue de Tabla 1/2: tiene el mismo
`calculo='tabla'` y el mismo mapeo columna_id/columnas_valor, así que su contenido ficticio o real
sigue sirviendo de resguardo si el dashboard todavía no tiene ninguna carga histórica.

Cada posición conserva su identidad visual (título, ícono/color de los KPI) sin importar qué
columna la alimente; solo cambian los datos. Una posición sin columnas adecuadas en el archivo
conserva su dato ficticio en vez de bloquear el resto del mapeo — un archivo de cualquier área
(RRHH, TI, inventario...) rara vez tiene las 13 combinaciones de columnas que la plantilla ilustra.
"""

from apps.cartera.compat import AuditEvent
from apps.cartera.compat import log_event

from ..models import ID_PLANTILLA_BASE, DashboardComponent
from . import dashboard_layout, generic_charts, historico

# Operadores de `_aplicar_filtro_dias_vencidos` — solo KPIs (`calculo == 'kpi'`, ver
# `_aplicar_filtro_slot`) pueden usar el filtro por días desde una fecha, a diferencia del filtro
# por igualdad exacta que sirve para cualquier `calculo`. Decisión explícita del usuario: dejar
# gráficos/tablas con el filtro de igualdad únicamente por ahora.
_OPERADORES_DIAS_VENCIDOS = {'mayor', 'mayor_igual', 'menor', 'menor_igual'}

KPI_ANCHO, KPI_ALTO = 3, 180
GRAFICO_MEDIO_ANCHO, GRAFICO_ALTO = 6, 380
GRAFICO_COMPLETO_ANCHO = 12
GRAFICO_TERCIO_ANCHO, GRAFICO_TERCIO_ALTO = 4, 340
TABLA_COMPLETA_ALTO = 380
TABLA_MEDIA_ANCHO, TABLA_MEDIA_ALTO = 6, 340

# `calculo` identifica, para cada posición, qué función de `generic_charts` la calcula y qué
# columnas necesita — ver `_calcular_contenido_slot`. Los `component_id` son fijos (no derivados
# de un título): aplicar el mapeo o restablecer la plantilla siempre actualiza los mismos 13
# componentes, nunca los duplica.
#
# El ORDEN de esta lista es también el `order` con el que cada posición se siembra por defecto
# (`_escribir_plantilla`), y por lo tanto la secuencia visual real del grid (`EditableGrid.jsx`
# acomoda por `order` con flex-wrap de 12 columnas — `row` no se usa para renderizar). Se pensó
# para seguir el patrón de lectura en "Z": franja superior de KPIs (barrido horizontal inicial),
# seguida de inmediato por el único gráfico de ancho completo (grafico-3, "área apilada") como
# ancla visual del barrido diagonal — antes de que dos gráficos de ancho medio le resten
# protagonismo — y recién después el resto de gráficos de apoyo, cerrando con las tablas de
# detalle (barrido horizontal final, terminando en la tabla más específica abajo a la derecha).
PLANTILLA_SLOTS = [
    {'id': 'kpi-1', 'tipo': DashboardComponent.Tipo.KPI, 'chart_type': '', 'ancho': KPI_ANCHO, 'alto': KPI_ALTO,
     'titulo': 'KPI 1', 'calculo': 'kpi', 'color_defecto': '#2a78d6', 'config_fijo': {'icono': 'persona'}},
    {'id': 'kpi-2', 'tipo': DashboardComponent.Tipo.KPI, 'chart_type': '', 'ancho': KPI_ANCHO, 'alto': KPI_ALTO,
     'titulo': 'KPI 2', 'calculo': 'kpi', 'color_defecto': '#1baf7a', 'config_fijo': {'icono': 'dolar'}},
    {'id': 'kpi-3', 'tipo': DashboardComponent.Tipo.KPI, 'chart_type': '', 'ancho': KPI_ANCHO, 'alto': KPI_ALTO,
     'titulo': 'KPI 3', 'calculo': 'kpi', 'color_defecto': '#8b5cf6', 'config_fijo': {'icono': 'carrito'}},
    {'id': 'kpi-4', 'tipo': DashboardComponent.Tipo.KPI, 'chart_type': '', 'ancho': KPI_ANCHO, 'alto': KPI_ALTO,
     'titulo': 'KPI 4', 'calculo': 'kpi', 'color_defecto': '#eda100', 'config_fijo': {'icono': 'grafico'}},
    {'id': 'grafico-3', 'tipo': DashboardComponent.Tipo.CHART, 'chart_type': 'barras_agrupadas',
     'ancho': GRAFICO_COMPLETO_ANCHO, 'alto': GRAFICO_ALTO, 'titulo': 'Gráfico 3', 'calculo': 'multiserie', 'config_fijo': {}},
    {'id': 'grafico-1', 'tipo': DashboardComponent.Tipo.CHART, 'chart_type': 'barras_verticales',
     'ancho': GRAFICO_MEDIO_ANCHO, 'alto': GRAFICO_ALTO, 'titulo': 'Gráfico 1', 'calculo': 'chart', 'config_fijo': {}},
    {'id': 'grafico-2', 'tipo': DashboardComponent.Tipo.CHART, 'chart_type': 'lineas_multiples',
     'ancho': GRAFICO_MEDIO_ANCHO, 'alto': GRAFICO_ALTO, 'titulo': 'Gráfico 2', 'calculo': 'multivalor', 'config_fijo': {}},
    {'id': 'grafico-4', 'tipo': DashboardComponent.Tipo.CHART, 'chart_type': 'dona',
     'ancho': GRAFICO_TERCIO_ANCHO, 'alto': GRAFICO_TERCIO_ALTO, 'titulo': 'Gráfico 4', 'calculo': 'chart',
     'config_fijo': {'mostrar_total': True}},
    {'id': 'grafico-5', 'tipo': DashboardComponent.Tipo.CHART, 'chart_type': 'pastel',
     'ancho': GRAFICO_TERCIO_ANCHO, 'alto': GRAFICO_TERCIO_ALTO, 'titulo': 'Gráfico 5', 'calculo': 'chart', 'config_fijo': {}},
    {'id': 'grafico-6', 'tipo': DashboardComponent.Tipo.CHART, 'chart_type': 'dispersion',
     'ancho': GRAFICO_TERCIO_ANCHO, 'alto': GRAFICO_TERCIO_ALTO, 'titulo': 'Gráfico 6', 'calculo': 'dispersion', 'config_fijo': {}},
    {'id': 'tabla-1', 'tipo': DashboardComponent.Tipo.CHART, 'chart_type': 'tabla',
     'ancho': GRAFICO_COMPLETO_ANCHO, 'alto': TABLA_COMPLETA_ALTO, 'titulo': 'Tabla 1', 'calculo': 'tabla', 'config_fijo': {}},
    {'id': 'tabla-2', 'tipo': DashboardComponent.Tipo.CHART, 'chart_type': 'tabla',
     'ancho': TABLA_MEDIA_ANCHO, 'alto': TABLA_MEDIA_ALTO, 'titulo': 'Tabla 2', 'calculo': 'tabla', 'config_fijo': {}},
    {'id': 'tabla-3', 'tipo': DashboardComponent.Tipo.CHART, 'chart_type': 'tabla',
     'ancho': TABLA_MEDIA_ANCHO, 'alto': TABLA_MEDIA_ALTO, 'titulo': 'Tabla 3', 'calculo': 'tabla', 'config_fijo': {}},
]

_SLOTS_POR_ID = {slot['id']: slot for slot in PLANTILLA_SLOTS}

# `dashboard_id` reservado (nunca corresponde a un `Dashboard` real, ver
# `services/dashboards.py::_generar_dashboard_id_unico`) para la plantilla base personalizable
# desde "Configuración → Plantilla base": usa exactamente `DashboardLayout`/`DashboardComponent`
# como cualquier dashboard (sin modelo/migración aparte), sembrada la primera vez con
# `PLANTILLA_SLOTS` — ver `slots_efectivos`/`sembrar_plantilla_desde_base`.
DASHBOARD_ID_PLANTILLA_BASE = ID_PLANTILLA_BASE  # sin empresa: la ven todas

# Tipos de visualización entre los que se puede cambiar una posición sin cambiar su `calculo`
# (mismos datos calculados, `{categorias, valores}` o `{categorias, series}` — ver
# `_calcular_contenido_slot`), agrupados por lo que el archivo real termina alimentando. KPI,
# dispersión y tabla no aparecen: su `calculo` solo puede dibujarse de una forma.
#
# Catálogo cerrado a propósito: barras horizontales/verticales, pastel, dona, barras agrupadas y
# líneas múltiples — ningún otro tipo debe quedar seleccionable desde acá. "Líneas" (una sola
# serie), "barras apiladas" y "área apilada" se sacaron del catálogo (quedan solo como capacidad
# de renderizado ya existente, para no romper componentes creados antes de este cambio — ver
# `GenericChartRenderer.jsx` en el frontend, que los sigue dibujando si los encuentra, aunque ya
# no se puedan elegir de nuevo).
#
# Barras verticales/horizontales, pastel y dona son el mínimo que SIEMPRE debe estar disponible en
# cualquier posición de gráfico, sea de una sola columna (`chart`) o de 2+ (`multivalor`/
# `multiserie`) — decisión explícita del usuario. El contenido calculado para `multivalor`/
# `multiserie` sigue siendo `{categorias, series}` igual que para el resto de tipos de ese
# `calculo` (este módulo no sabe ni le importa cómo se va a dibujar) — es el frontend
# (`GenericChartRenderer`) el que colapsa las series en una sola porción por categoría cuando el
# tipo elegido es de una sola columna (circular o de barras simples), así el usuario no tiene que
# rehacer el mapeo a una sola columna.
TIPOS_COMPATIBLES = {
    'chart': ('barras_verticales', 'barras_horizontales', 'pastel', 'dona'),
    'multivalor': ('barras_verticales', 'barras_horizontales', 'barras_agrupadas', 'lineas_multiples', 'pastel', 'dona'),
    'multiserie': ('barras_verticales', 'barras_horizontales', 'barras_agrupadas', 'lineas_multiples', 'pastel', 'dona'),
}


def _chart_type_elegido(slot, propuesta):
    """El `chart_type` que el usuario eligió para esta posición, si es compatible con su
    `calculo` — cualquier otro caso (no eligió nada, o el valor no aplica a este `calculo`) usa el
    tipo por defecto de la posición."""
    compatibles = TIPOS_COMPATIBLES.get(slot['calculo'])
    elegido = (propuesta or {}).get('chart_type')
    if compatibles and elegido in compatibles:
        return elegido
    return slot['chart_type']


def datos_ficticios():
    """Contenido de ejemplo para cada posición — la misma información que antes vivía en
    `DashboardPlaceholderTemplate.jsx` (retirado), ahora la única fuente de verdad porque los 13
    componentes se guardan de verdad desde la creación del dashboard."""
    meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun']
    categorias_producto = ['Electrónica', 'Hogar', 'Moda', 'Deportes', 'Belleza']
    valores_producto = [245000, 180000, 135000, 98000, 87000]
    descripcion_kpi = 'Dato de ejemplo — se reemplaza al cargar un archivo.'

    return {
        'kpi-1': {
            'titulo': 'KPI 1', 'descripcion': descripcion_kpi, 'valor': 12458, 'formato': 'numero',
            'tendencia': {'valor': 8.5, 'texto': 'vs. mes anterior'},
        },
        'kpi-2': {
            'titulo': 'KPI 2', 'descripcion': descripcion_kpi, 'valor': 1245300, 'formato': 'moneda',
            'tendencia': {'valor': 12.3, 'texto': 'vs. mes anterior'},
        },
        'kpi-3': {
            'titulo': 'KPI 3', 'descripcion': descripcion_kpi, 'valor': 3682, 'formato': 'numero',
            'tendencia': {'valor': 5.7, 'texto': 'vs. mes anterior'},
        },
        'kpi-4': {
            'titulo': 'KPI 4', 'descripcion': descripcion_kpi, 'valor': 78.6, 'formato': 'porcentaje',
            'tendencia': {'valor': 4.2, 'texto': 'vs. mes anterior'},
        },
        'grafico-1': {
            'titulo': 'Gráfico 1', 'descripcion': 'Ejemplo de ventas mensuales.',
            'categorias': meses, 'valores': [120000, 135000, 150000, 170000, 190000, 220000],
        },
        'grafico-2': {
            'titulo': 'Gráfico 2', 'descripcion': 'Ejemplo: comparación de dos métricas mes a mes.',
            'categorias': meses,
            'series': [
                {'nombre': 'Ingresos (USD)', 'valores': [110000, 130000, 160000, 180000, 210000, 240000]},
                {'nombre': 'Gastos (USD)', 'valores': [70000, 80000, 90000, 110000, 120000, 140000]},
            ],
        },
        'grafico-3': {
            'titulo': 'Gráfico 3', 'descripcion': 'Ejemplo: ventas por producto a lo largo del tiempo.',
            'categorias': meses,
            'series': [
                {'nombre': 'Producto A', 'valores': [60000, 65000, 70000, 75000, 80000, 100000]},
                {'nombre': 'Producto B', 'valores': [50000, 55000, 60000, 60000, 65000, 80000]},
                {'nombre': 'Producto C', 'valores': [40000, 45000, 50000, 45000, 55000, 60000]},
            ],
        },
        'grafico-4': {
            'titulo': 'Gráfico 4', 'descripcion': 'Ejemplo: distribución por categoría.',
            'categorias': categorias_producto, 'valores': valores_producto,
        },
        'grafico-5': {
            'titulo': 'Gráfico 5', 'descripcion': 'Ejemplo: distribución por categoría.',
            'categorias': categorias_producto, 'valores': valores_producto,
        },
        'grafico-6': {
            'titulo': 'Gráfico 6', 'descripcion': 'Ejemplo: relación entre dos métricas.',
            'puntos': [
                {'x': 60000, 'y': 8000}, {'x': 90000, 'y': 15000}, {'x': 110000, 'y': 22000},
                {'x': 135000, 'y': 28000}, {'x': 150000, 'y': 32000}, {'x': 180000, 'y': 45000},
                {'x': 200000, 'y': 52000}, {'x': 220000, 'y': 60000}, {'x': 245000, 'y': 70000},
                {'x': 260000, 'y': 80000},
            ],
        },
        'tabla-1': {
            'titulo': 'Tabla 1', 'descripcion': 'Ejemplo: detalle por producto.',
            'columnas': ['Producto', 'Categoría', 'Ventas (USD)', 'Costo (USD)', 'Ganancia (USD)', 'Margen (%)', 'Unidades', '% del total'],
            'filas': [
                ['Producto A', 'Electrónica', 245000, 150000, 95000, '38.8%', '1,250', 32.9],
                ['Producto B', 'Hogar', 180000, 110000, 70000, '38.9%', '980', 24.2],
                ['Producto C', 'Moda', 135000, 80000, 55000, '40.7%', '760', 18.1],
                ['Producto D', 'Deportes', 98000, 60000, 38000, '38.8%', '540', 13.2],
                ['Producto E', 'Belleza', 87000, 50000, 37000, '42.5%', '430', 11.7],
            ],
            'total': ['Total', '', 745000, 450000, 295000, '39.6%', '3,960', 100.0],
        },
        'tabla-2': {
            'titulo': 'Tabla 2', 'descripcion': 'Ejemplo: detalle por región.',
            'columnas': ['Región', 'Ventas (USD)', '% del total'],
            'filas': [
                ['Norte', 230000, 30.9], ['Centro', 180000, 24.2], ['Sur', 165000, 22.1],
                ['Este', 120000, 16.1], ['Oeste', 50000, 6.7],
            ],
            'total': ['Total', 745000, 100.0],
        },
        'tabla-3': {
            'titulo': 'Tabla 3', 'descripcion': 'Ejemplo: detalle por vendedor.',
            'columnas': ['Vendedor', 'Ventas (USD)', 'Unidades', '% del total'],
            'filas': [
                ['María López', 145000, '780', 25.0],
                ['Juan Pérez', 130000, '650', 22.4],
                ['Ana Torres', 120000, '600', 20.7],
                ['Carlos Ruiz', 100000, '520', 17.2],
                ['Luis García', 85000, '410', 14.7],
            ],
            'total': ['Total', 580000, '2,960', 100.0],
        },
    }


def _rankear_categorias(columnas):
    """Columnas de categoría ordenadas de menor a mayor cardinalidad (las de menor cardinalidad
    agrupan mejor) — mismo criterio que `generic_charts._mejor_columna_serie`."""
    return sorted((c for c in columnas if c['apta_para_categoria']), key=lambda c: c['valores_unicos'])


def _rankear_valores(columnas):
    """Columnas numéricas ordenadas por completitud (menos nulos primero) — mismo criterio que
    `generic_charts._mejor_par_columnas_numericas`."""
    return sorted((c for c in columnas if c['apta_para_valor']), key=lambda c: c['valores_no_nulos'], reverse=True)


def sugerir_mapeo(columnas):
    """Elige, de forma determinista, qué columna(s) usar para cada una de las 13 posiciones —
    reutilizando columnas entre posiciones cuando hay pocas disponibles, evitando repetir la
    misma cuando hay suficientes. Una posición cuyo requisito estructural no se puede cumplir
    (p. ej. Gráfico 3 necesita dos columnas de categoría y el archivo solo trae una) queda con
    `disponible=False`; `calcular_datos_mapeo` conserva el dato ficticio en ese caso."""
    categorias = _rankear_categorias(columnas)
    valores = _rankear_valores(columnas)

    def categoria(i):
        return categorias[i % len(categorias)]['nombre'] if categorias else None

    def valor(i):
        return valores[i % len(valores)]['nombre'] if valores else None

    mapeo = {}

    for i in range(4):
        disponible = bool(valores)
        mapeo[f'kpi-{i + 1}'] = {
            'disponible': disponible, 'columna_valor': valor(i) if disponible else None, 'tipo_agregacion': 'suma',
        }

    disponible_g1 = bool(categorias) and bool(valores)
    mapeo['grafico-1'] = {
        'disponible': disponible_g1,
        'columna_categoria': categoria(0) if disponible_g1 else None,
        'columna_valor': valor(0) if disponible_g1 else None,
        'chart_type': _SLOTS_POR_ID['grafico-1']['chart_type'],
    }

    disponible_g2 = bool(categorias) and len(valores) >= 2
    mapeo['grafico-2'] = {
        'disponible': disponible_g2,
        'columna_categoria': categoria(1) if disponible_g2 else None,
        'columnas_valor': [valor(0), valor(1)] if disponible_g2 else [],
        'chart_type': _SLOTS_POR_ID['grafico-2']['chart_type'],
    }

    disponible_g3 = len(categorias) >= 2 and bool(valores)
    mapeo['grafico-3'] = {
        'disponible': disponible_g3,
        'columna_categoria': categoria(0) if disponible_g3 else None,
        'columna_serie': categoria(1) if disponible_g3 else None,
        'columna_valor': valor(0) if disponible_g3 else None,
        'chart_type': _SLOTS_POR_ID['grafico-3']['chart_type'],
    }

    disponible_g45 = bool(categorias) and bool(valores)
    for slot_id in ('grafico-4', 'grafico-5'):
        mapeo[slot_id] = {
            'disponible': disponible_g45,
            'columna_categoria': categoria(2) if disponible_g45 else None,
            'columna_valor': valor(1) if disponible_g45 else None,
            'chart_type': _SLOTS_POR_ID[slot_id]['chart_type'],
        }

    par_dispersion = generic_charts._mejor_par_columnas_numericas(valores)
    mapeo['grafico-6'] = {
        'disponible': bool(par_dispersion),
        'columna_valor': par_dispersion[0] if par_dispersion else None,
        'columna_valor_y': par_dispersion[1] if par_dispersion else None,
    }

    def columna_valor_tabla(i):
        # Sugerencia automática: siempre arranca en "suma" (mismo criterio que antes de la
        # sección 23) — el usuario puede cambiarlo a "promedio" o "conteo_unicos" por columna.
        return {'columna': valor(i), 'tipo_agregacion': 'suma'}

    disponible_t1 = bool(categorias) and bool(valores)
    mapeo['tabla-1'] = {
        'disponible': disponible_t1,
        'columna_id': categoria(0) if disponible_t1 else None,
        'columnas_valor': [columna_valor_tabla(i) for i in range(min(3, len(valores)))] if disponible_t1 else [],
    }

    disponible_t2 = len(categorias) >= 2 and bool(valores)
    mapeo['tabla-2'] = {
        'disponible': disponible_t2,
        'columna_id': categoria(1) if disponible_t2 else None,
        'columnas_valor': [columna_valor_tabla(0)] if disponible_t2 else [],
    }

    # Tabla 3 es la posición histórica (ver módulo): estructuralmente es una tabla más, mismo
    # requisito y mapeo que cualquier otra — su contenido calculado acá sirve de resguardo cuando
    # el dashboard todavía no tiene ninguna carga histórica con la que comparar.
    disponible_t3 = len(categorias) >= 3 and len(valores) >= 2
    mapeo['tabla-3'] = {
        'disponible': disponible_t3,
        'columna_id': categoria(2) if disponible_t3 else None,
        'columnas_valor': [columna_valor_tabla(0), columna_valor_tabla(1)] if disponible_t3 else [],
    }

    return mapeo


def _aplicar_filtro_dias_vencidos(df, columna_filtro, propuesta, fecha_referencia=None):
    """Filtra a las filas según cuántos días pasaron entre `columna_filtro` (una fecha) y HOY,
    comparados contra `dias_filtro` con uno de los 4 operadores (`mayor`/`mayor_igual`/`menor`/
    `menor_igual`) — ej. "Fecha de Vencimiento" con 30 días y `mayor` deja solo las filas vencidas
    hace más de 30 días; `menor` con 0 días deja las que TODAVÍA no vencieron (fecha en el
    futuro). Un valor de esa columna que no parsea como fecha nunca cuenta como vencido NI como
    no vencido (se excluye siempre, no se incluye "por las dudas" en ningún operador). Sin días
    elegidos todavía, devuelve el archivo tal cual — mismo criterio de "filtro incompleto no
    filtra nada" que el de igualdad. `operador_filtro` ausente/inválido cae a `'mayor'` (mismo
    criterio que `tipo_agregacion` ausente cae a "suma" en un KPI): el selector de la UI ya
    muestra "Mayor que (>)" preseleccionado apenas se elige la columna de fecha, así que el dato
    debe comportarse igual aunque el usuario nunca haya tocado ese selector a mano."""
    dias_filtro = propuesta.get('dias_filtro')
    if dias_filtro in (None, ''):
        return df
    operador = propuesta.get('operador_filtro')
    if operador not in _OPERADORES_DIAS_VENCIDOS:
        operador = 'mayor'
    try:
        dias_filtro = int(dias_filtro)
    except (TypeError, ValueError):
        return df

    dias_transcurridos = generic_charts.dias_transcurridos_desde(df[columna_filtro], fecha_referencia)
    if operador == 'mayor_igual':
        mascara = dias_transcurridos >= dias_filtro
    elif operador == 'menor':
        mascara = dias_transcurridos < dias_filtro
    elif operador == 'menor_igual':
        mascara = dias_transcurridos <= dias_filtro
    else:
        mascara = dias_transcurridos > dias_filtro
    return df[mascara.fillna(False)]


def _aplicar_filtro_slot(df, propuesta, calculo, fecha_referencia=None):
    """Filtra el archivo según el filtro (opcional) elegido para la posición — dos formas
    posibles, distinguidas por `tipo_filtro`:
    - `'igualdad'` (default, retrocompatible con mapeos guardados antes de que existiera
      `tipo_filtro`): `columna_filtro` == `valor_filtro`. Aplica sin importar el `calculo` de la
      posición, así que sirve tanto para un KPI como para cualquier gráfica o tabla.
    - `'dias_vencidos'`: solo para KPI (`calculo == 'kpi'` — decisión explícita del usuario, ver
      `_OPERADORES_DIAS_VENCIDOS`); cualquier otro `calculo` cae al filtro de igualdad como si
      `tipo_filtro` no se hubiera elegido, para no dejar un gráfico/tabla en un estado indefinido
      si el payload trae `tipo_filtro='dias_vencidos'` de todos modos (nunca debería pasar desde
      la UI, que ya restringe la opción, pero el backend no confía solo en eso).

    Sin columna de filtro elegida, devuelve el archivo tal cual. Si la columna elegida ya no
    existe, `None` (la posición cae al dato ficticio, igual que con cualquier otra columna
    inválida). Un filtro que no deja ninguna fila no es un error: el resultado real es
    simplemente vacío/cero."""
    columna_filtro = propuesta.get('columna_filtro')
    if not columna_filtro:
        return df
    if columna_filtro not in df.columns:
        return None

    if propuesta.get('tipo_filtro') == 'dias_vencidos' and calculo == 'kpi':
        return _aplicar_filtro_dias_vencidos(df, columna_filtro, propuesta, fecha_referencia)

    return _aplicar_filtro_por_valores(df, columna_filtro, propuesta)


# Operadores del filtro por valores. `en` incluye las filas cuyo valor está en la lista; `no_en` las
# excluye — es lo que permite "todo el saldo MENOS el anticipado" sin tener que enumerar los demás
# tramos, que además cambiarían si el archivo trae una categoría nueva.
_OPERADORES_VALOR = ('en', 'no_en')


def valores_filtro_de(propuesta):
    """Lista de valores del filtro, normalizada a texto.

    Acepta las dos formas: `valores_filtro` (lista, la actual) y `valor_filtro` (un único valor, la
    que se guardaba antes de que el filtro admitiera varios). La segunda se sigue leyendo para no
    invalidar los mapeos ya guardados — no hay migración de datos que los reescriba.
    """
    valores = propuesta.get('valores_filtro')
    if isinstance(valores, (list, tuple)):
        return [str(v) for v in valores if v not in (None, '')]
    valor = propuesta.get('valor_filtro')
    return [] if valor in (None, '') else [str(valor)]


def _aplicar_filtro_por_valores(df, columna_filtro, propuesta):
    valores = valores_filtro_de(propuesta)
    # Sin valores elegidos no hay filtro, cualquiera sea el operador: "ninguno de nada" excluiría
    # todo el archivo, que nunca es lo que alguien quiso configurar.
    if not valores:
        return df

    operador = propuesta.get('operador_valor')
    if operador not in _OPERADORES_VALOR:
        operador = 'en'

    coincide = df[columna_filtro].astype(str).isin(valores)
    return df[~coincide] if operador == 'no_en' else df[coincide]


def _descripcion_con_filtro(descripcion, propuesta, calculo):
    """Agrega una cláusula "donde ..." al final de una descripción ya armada (que siempre termina
    en '.') cuando la posición tiene un filtro elegido — mismo criterio de forma (igualdad vs.
    días vencidos, y la misma restricción de "días vencidos" solo aplica a KPI) que
    `_aplicar_filtro_slot`."""
    columna_filtro = propuesta.get('columna_filtro')
    if not columna_filtro:
        return descripcion

    if propuesta.get('tipo_filtro') == 'dias_vencidos' and calculo == 'kpi':
        dias_filtro = propuesta.get('dias_filtro')
        if dias_filtro in (None, ''):
            return descripcion
        operador = propuesta.get('operador_filtro')
        if operador not in _OPERADORES_DIAS_VENCIDOS:
            operador = 'mayor'
        simbolo = {'mayor': '>', 'mayor_igual': '≥', 'menor': '<', 'menor_igual': '≤'}[operador]
        return f'{descripcion[:-1]} donde los días transcurridos desde "{columna_filtro}" son {simbolo} {dias_filtro}.'

    valores = valores_filtro_de(propuesta)
    if not valores:
        return descripcion
    operador = propuesta.get('operador_valor')
    # Se redacta distinto según cuántos valores haya: "no es ANTICIPADA" se lee mejor que
    # "no es ninguno de ANTICIPADA", y es el caso más común.
    if len(valores) == 1:
        relacion = 'no es' if operador == 'no_en' else 'es'
        return f'{descripcion[:-1]} donde "{columna_filtro}" {relacion} "{valores[0]}".'
    relacion = 'no es ninguno de' if operador == 'no_en' else 'es uno de'
    listado = ', '.join(f'"{valor}"' for valor in valores)
    return f'{descripcion[:-1]} donde "{columna_filtro}" {relacion} {listado}.'


def _con_meta(resultado, valor, propuesta):
    """Adjunta `meta` a un `content` de KPI ya armado cuando `propuesta` trae `meta_min`/
    `meta_max` — `evaluar_meta` ya devuelve `None` si ninguna de las dos vino, en cuyo caso no se
    agrega la clave `meta` en absoluto (un KPI sin meta configurada queda igual que antes de esta
    función, sin `content['meta']`)."""
    meta = generic_charts.evaluar_meta(valor, propuesta.get('meta_min'), propuesta.get('meta_max'))
    if meta is not None:
        resultado['meta'] = meta
    return resultado


def _contenido_tabla_historica(titulo, propuesta, dashboard_id):
    """Contenido de una Tabla (`calculo == 'tabla'`) cuando `propuesta['usa_historico']` está
    activo: en vez de leer el archivo actualmente cargado, arma una fila por CADA CARGA incluida
    en el histórico del dashboard (`historico.calcular_tabla_historica`, mismo cálculo que ya usa
    "Tabla 3" — sección 28) para las columnas elegidas en `columnas_valor`. No hay "Identidad de
    fila" que elegir (a diferencia del modo normal): la identidad de cada fila es la propia carga
    (columna "Archivo", siempre la primera). `dashboard_id` puede venir `None` en contextos que
    todavía no lo resuelven (ninguno hoy, pero evita un `AttributeError` si algún llamador futuro
    lo omite) — en ese caso se comporta como "sin resultado", igual que una columna faltante."""
    if not dashboard_id:
        return None
    columnas_valor = propuesta.get('columnas_valor') or []
    if not columnas_valor:
        return None
    datos = historico.calcular_tabla_historica(dashboard_id, columnas_valor)
    nombres_valor = datos['columnas'][4:]
    if not nombres_valor:
        return None
    return {
        'titulo': titulo,
        'descripcion': f'Histórico de {" y ".join(nombres_valor)}, una fila por carga incluida en el histórico.',
        'columnas': datos['columnas'], 'filas': datos['filas'], 'total': None,
    }


def _contenido_kpi_historico(titulo, propuesta, dashboard_id):
    """Contenido de un KPI (`calculo == 'kpi'`) cuando `propuesta['usa_historico']` está activo:
    el valor de la columna elegida agregado (mismo `tipo_agregacion` que un KPI normal) SOLO sobre
    la carga histórica más reciente incluida — no todas, ver `historico.calcular_kpi_historico`.
    Meta/formato se reusan tal cual (`_con_meta`) — el semáforo y el formato de presentación no
    dependen de si el valor vino del archivo actual o del histórico."""
    if not dashboard_id:
        return None
    columna_valor = propuesta.get('columna_valor')
    if not columna_valor:
        return None
    tipo_agregacion = propuesta.get('tipo_agregacion') or 'suma'
    valor = historico.calcular_kpi_historico(dashboard_id, columna_valor, tipo_agregacion)
    if valor is None:
        return None
    formato = propuesta.get('formato') or 'numero'
    return _con_meta({
        'titulo': titulo,
        'descripcion': f'"{columna_valor}" en la carga histórica más reciente incluida en el histórico.',
        'valor': valor, 'formato': formato,
    }, valor, propuesta)


def _contenido_chart_historico(titulo, propuesta, dashboard_id):
    """Contenido de un Gráfico de una columna (`calculo == 'chart'`) cuando
    `propuesta['usa_historico']` está activo: una categoría por CADA CARGA incluida en el
    histórico (`historico.calcular_categorico_historico`), no por valor distinto de una columna
    del archivo — no hay "Categoría" que elegir (a diferencia del modo normal), solo la columna de
    valor a agregar por carga."""
    if not dashboard_id:
        return None
    columna_valor = propuesta.get('columna_valor')
    if not columna_valor:
        return None
    tipo_agregacion = propuesta.get('tipo_agregacion') or 'suma'
    datos = historico.calcular_categorico_historico(dashboard_id, columna_valor, tipo_agregacion)
    if not datos:
        return None
    return {
        'titulo': titulo,
        'descripcion': f'Histórico de "{columna_valor}", una categoría por carga incluida en el histórico.',
        'categorias': datos['categorias'], 'valores': datos['valores'],
    }


def _contenido_multivalor_historico(titulo, propuesta, dashboard_id):
    """Contenido de un Gráfico de 2+ columnas comparando métricas (`calculo == 'multivalor'`)
    cuando `propuesta['usa_historico']` está activo: una serie por cada columna de
    `columnas_valor` (`historico.calcular_multivalor_historico`), con la carga como categoría —
    no hay "Categoría" que elegir, igual que en `_contenido_chart_historico`."""
    if not dashboard_id:
        return None
    datos = historico.calcular_multivalor_historico(dashboard_id, propuesta.get('columnas_valor'))
    if not datos:
        return None
    return {
        'titulo': titulo,
        'descripcion': 'Histórico por carga incluida en el histórico.',
        'categorias': datos['categorias'], 'series': datos['series'],
    }


def _contenido_multiserie_historico(titulo, propuesta, dashboard_id):
    """Contenido de un Gráfico de categoría + serie (`calculo == 'multiserie'`) cuando
    `propuesta['usa_historico']` está activo: la carga es la categoría, y la serie sale de los
    valores distintos de `columna_serie` DENTRO de cada carga
    (`historico.calcular_multiserie_historico`) — a diferencia del resto de posiciones históricas,
    acá `columna_serie` también debe estar marcada como histórica (si no, ninguna carga tiene con
    qué agrupar)."""
    if not dashboard_id:
        return None
    columna_valor = propuesta.get('columna_valor')
    columna_serie = propuesta.get('columna_serie')
    if not columna_valor or not columna_serie:
        return None
    tipo_agregacion = propuesta.get('tipo_agregacion') or 'suma'
    datos = historico.calcular_multiserie_historico(dashboard_id, columna_valor, columna_serie, tipo_agregacion)
    if not datos:
        return None
    return {
        'titulo': titulo,
        'descripcion': f'Histórico de "{columna_valor}" por "{columna_serie}", una categoría por carga incluida en el histórico.',
        'categorias': datos['categorias'], 'series': datos['series'],
    }


def _calcular_contenido_slot(df, slot, propuesta, dashboard_id=None, fecha_referencia=None):
    """Calcula el contenido real de una posición a partir de la propuesta de mapeo (ya
    confirmada/ajustada por el usuario). `None` si falta alguna columna requerida o si la
    columna elegida (de cálculo o de filtro) ya no existe en el archivo — en ese caso el llamador
    cae al dato ficticio.

    `propuesta['usa_historico']` activo en KPI/Gráfico de una o más columnas/Tabla
    (`calculo in ('kpi', 'chart', 'multivalor', 'multiserie', 'tabla')`) es la única combinación
    que no lee `df` en absoluto (se resuelve contra el histórico de cargas del dashboard,
    `dashboard_id`) — se resuelve ANTES que `_aplicar_filtro_slot` a propósito: el filtro
    (`columna_filtro`) es un concepto del archivo actual sin sentido acá (la UI ya lo oculta
    cuando `usa_historico` está activo), así que ni conviene ni hace falta aplicarlo contra `df`.
    Dispersión, tramos de antigüedad, cumplimiento de metas y concentración quedan fuera de
    alcance (su cálculo no se traduce naturalmente a "una carga = un punto") — `usa_historico` en
    su `propuesta` simplemente se ignora."""
    calculo = slot['calculo']
    titulo = slot['titulo']

    if propuesta.get('usa_historico') and calculo == 'tabla':
        return _contenido_tabla_historica(titulo, propuesta, dashboard_id)
    if propuesta.get('usa_historico') and calculo == 'kpi':
        return _contenido_kpi_historico(titulo, propuesta, dashboard_id)
    if propuesta.get('usa_historico') and calculo == 'chart':
        return _contenido_chart_historico(titulo, propuesta, dashboard_id)
    if propuesta.get('usa_historico') and calculo == 'multivalor':
        return _contenido_multivalor_historico(titulo, propuesta, dashboard_id)
    if propuesta.get('usa_historico') and calculo == 'multiserie':
        return _contenido_multiserie_historico(titulo, propuesta, dashboard_id)

    df = _aplicar_filtro_slot(df, propuesta, calculo, fecha_referencia)
    if df is None:
        return None

    if calculo == 'kpi':
        columna_valor = propuesta.get('columna_valor')
        if not columna_valor:
            return None
        formato = propuesta.get('formato') or 'numero'
        if propuesta.get('tipo_agregacion') == 'conteo_unicos':
            datos = generic_charts.generar_conteo_valores_unicos(df, columna_valor)
            if not datos:
                return None
            return _con_meta({
                'titulo': titulo,
                'descripcion': _descripcion_con_filtro(f'Cantidad de valores únicos de "{columna_valor}".', propuesta, calculo),
                'valor': datos['valor'], 'formato': formato,
            }, datos['valor'], propuesta)
        if propuesta.get('tipo_agregacion') == 'promedio':
            datos = generic_charts.generar_promedio_columna(df, columna_valor)
            if not datos:
                return None
            return _con_meta({
                'titulo': titulo,
                'descripcion': _descripcion_con_filtro(f'Promedio de "{columna_valor}".', propuesta, calculo),
                'valor': datos['valor'], 'formato': formato,
            }, datos['valor'], propuesta)
        datos = generic_charts.generar_datos_grafica(df, columna_valor, None)
        if not datos:
            return None
        return _con_meta({
            'titulo': titulo, 'descripcion': _descripcion_con_filtro(f'Suma de "{columna_valor}".', propuesta, calculo),
            'valor': datos['valor'], 'formato': formato,
        }, datos['valor'], propuesta)

    if calculo == 'chart':
        columna_categoria = propuesta.get('columna_categoria')
        columna_valor = propuesta.get('columna_valor')
        if not columna_categoria or not columna_valor:
            return None
        datos = generic_charts.generar_datos_grafica(df, columna_valor, columna_categoria)
        if not datos:
            return None
        return {
            'titulo': titulo,
            'descripcion': _descripcion_con_filtro(f'Suma de "{columna_valor}" agrupada por "{columna_categoria}".', propuesta, calculo),
            'categorias': datos['categorias'], 'valores': datos['valores'],
        }

    if calculo == 'multivalor':
        columna_categoria = propuesta.get('columna_categoria')
        columnas_valor = propuesta.get('columnas_valor') or []
        if not columna_categoria or not columnas_valor:
            return None
        datos = generic_charts.generar_datos_multivalor(df, columna_categoria, columnas_valor)
        if not datos:
            return None
        return {
            'titulo': titulo,
            'descripcion': _descripcion_con_filtro(f'Comparación de {" y ".join(columnas_valor)} por "{columna_categoria}".', propuesta, calculo),
            'categorias': datos['categorias'], 'series': datos['series'],
        }

    if calculo == 'multiserie':
        columna_categoria = propuesta.get('columna_categoria')
        columna_serie = propuesta.get('columna_serie')
        columna_valor = propuesta.get('columna_valor')
        if not columna_categoria or not columna_serie or not columna_valor:
            return None
        datos = generic_charts.generar_datos_multiserie(df, columna_valor, columna_categoria, columna_serie)
        if not datos:
            return None
        return {
            'titulo': titulo,
            'descripcion': _descripcion_con_filtro(
                f'Suma de "{columna_valor}" agrupada por "{columna_categoria}" y "{columna_serie}".', propuesta, calculo,
            ),
            'categorias': datos['categorias'], 'series': datos['series'],
        }

    if calculo == 'dispersion':
        columna_valor = propuesta.get('columna_valor')
        columna_valor_y = propuesta.get('columna_valor_y')
        if not columna_valor or not columna_valor_y:
            return None
        datos = generic_charts.generar_datos_dispersion(df, columna_valor, columna_valor_y)
        if not datos:
            return None
        return {
            'titulo': titulo,
            'descripcion': _descripcion_con_filtro(f'Relación entre "{columna_valor}" y "{columna_valor_y}".', propuesta, calculo),
            'puntos': datos['puntos'],
        }

    if calculo == 'tabla':
        columna_id = propuesta.get('columna_id')
        columnas_valor = propuesta.get('columnas_valor') or []
        if not columna_id or not columnas_valor:
            return None
        datos = generic_charts.generar_datos_tabla(df, columna_id, columnas_valor)
        if not datos:
            return None
        # Los nombres de columna de valor ya resueltos (cada entrada de `columnas_valor` puede ser
        # un dict `{columna, tipo_agregacion}` o, por compatibilidad, un string plano) — se leen de
        # `datos['columnas']` en vez de volver a normalizar acá para no duplicar ese criterio.
        nombres_valor = datos['columnas'][1:-1]
        return {
            'titulo': titulo,
            'descripcion': _descripcion_con_filtro(f'Detalle de {" y ".join(nombres_valor)} por "{columna_id}".', propuesta, calculo),
            'columnas': datos['columnas'], 'filas': datos['filas'], 'total': datos['total'],
        }

    if calculo == 'tramos_antiguedad':
        columna_fecha = propuesta.get('columna_fecha')
        columna_valor = propuesta.get('columna_valor')
        if not columna_fecha or not columna_valor:
            return None
        datos = generic_charts.generar_datos_tramos_antiguedad(df, columna_fecha, columna_valor, fecha_referencia)
        if not datos:
            return None
        return {
            'titulo': titulo,
            'descripcion': _descripcion_con_filtro(f'Antigüedad de "{columna_valor}" según "{columna_fecha}".', propuesta, calculo),
            'categorias': datos['categorias'], 'valores': datos['valores'],
        }

    if calculo == 'cumplimiento_metas':
        columna_fecha = propuesta.get('columna_fecha')
        columna_valor = propuesta.get('columna_valor')
        if not columna_fecha or not columna_valor:
            return None
        datos = generic_charts.generar_datos_cumplimiento_tramos(df, columna_fecha, columna_valor, propuesta.get('metas'), fecha_referencia)
        if not datos:
            return None
        return {
            'titulo': titulo,
            'descripcion': _descripcion_con_filtro(
                f'Cumplimiento de metas de antigüedad de "{columna_valor}" según "{columna_fecha}".', propuesta, calculo,
            ),
            'columnas': datos['columnas'], 'filas': datos['filas'], 'total': datos['total'],
        }

    if calculo == 'antiguedad_por_deudor':
        columna_id = propuesta.get('columna_id')
        columna_fecha = propuesta.get('columna_fecha')
        columna_valor = propuesta.get('columna_valor')
        if not columna_id or not columna_fecha or not columna_valor:
            return None
        datos = generic_charts.generar_datos_antiguedad_por_deudor(
            df, columna_id, columna_fecha, columna_valor, propuesta.get('cuantos'), fecha_referencia,
        )
        if not datos or not datos['deudores']:
            return None
        return {
            'titulo': titulo,
            'descripcion': _descripcion_con_filtro(
                f'Antigüedad de "{columna_valor}" de los mayores deudores por "{columna_id}", '
                f'según "{columna_fecha}".', propuesta, calculo,
            ),
            'deudores': datos['deudores'],
        }

    if calculo == 'concentracion':
        columna_id = propuesta.get('columna_id')
        columna_valor = propuesta.get('columna_valor')
        if not columna_id or not columna_valor:
            return None
        datos = generic_charts.generar_datos_concentracion(df, columna_id, columna_valor, propuesta.get('top_n'))
        if not datos:
            return None
        return {
            'titulo': titulo,
            'descripcion': _descripcion_con_filtro(f'Concentración de "{columna_valor}" por "{columna_id}".', propuesta, calculo),
            'columnas': datos['columnas'], 'filas': datos['filas'], 'total': datos['total'],
        }

    return None


def calcular_contenido_por_calculo(df, calculo, titulo, propuesta, dashboard_id=None, fecha_referencia=None):
    """Igual que `_calcular_contenido_slot`, pero para un componente que no es una de las 13
    posiciones fijas de la plantilla (Zona Personal, ver `dashboard_layout.agregar_componente_generado`
    y `ComponentDataSection.jsx`) — arma el "slot sintético" mínimo que esa función necesita
    (solo lee `slot['calculo']`/`slot['titulo']`, nada más). `None` si falta alguna columna
    requerida o si la elegida ya no existe; a diferencia de las posiciones fijas, acá no hay dato
    ficticio de respaldo — el llamador debe conservar el contenido anterior en ese caso.
    `dashboard_id` solo lo necesita `calculo == 'tabla'` con `propuesta['usa_historico']` (ver
    `_contenido_tabla_historica`); el resto de `calculo` lo ignora."""
    return _calcular_contenido_slot(df, {'calculo': calculo, 'titulo': titulo}, propuesta, dashboard_id, fecha_referencia)


def calcular_datos_mapeo(df, mapeo, dashboard_id=None, fecha_referencia=None):
    """Contenido final de las 13 posiciones: el calculado a partir del mapeo cuando la posición
    está `disponible` y sus columnas siguen existiendo, o el dato ficticio en cualquier otro
    caso — nunca deja una posición sin contenido. `dashboard_id` (ver
    `calcular_contenido_por_calculo`) solo lo necesita una posición de tipo `tabla` con
    `usa_historico` activo — el resto de posiciones lo ignora."""
    fijos = datos_ficticios()
    resultado = {}
    for slot in PLANTILLA_SLOTS:
        slot_id = slot['id']
        propuesta = mapeo.get(slot_id) or {}
        contenido = _calcular_contenido_slot(df, slot, propuesta, dashboard_id, fecha_referencia) if propuesta.get('disponible') else None
        resultado[slot_id] = contenido or fijos[slot_id]
    return resultado


def _slots_con_personalizacion(dashboard_id, slots_base, conservar_descripcion):
    """`slots_base` con la personalización vigente de los `DashboardComponent` de `dashboard_id`
    superpuesta: disposición (orden, ancho, alto, visibilidad), tipo de gráfico, colores,
    configuración y título. Devuelve `slots_base` tal cual si ese dashboard todavía no tiene
    componentes.

    `id`/`tipo`/`calculo` nunca se personalizan: son estructurales, deciden qué función de
    `generic_charts` calcula esa posición y no tiene sentido exponerlos como editables.

    `conservar_descripcion` distingue los dos usos. En la plantilla base el contenido es ficticio y
    su descripción la escribió un administrador, así que se conserva. En un dashboard real la
    descripción la CALCULA el mapeo ('Suma de "Saldo".'): conservarla dejaría la posición
    describiendo columnas que ya no usa, así que se deja recalcular — a costa de perder una
    descripción escrita a mano, que es el mal menor entre los dos.
    """
    personalizados = {
        c.component_id: c
        for c in DashboardComponent.objects.filter(layout__dashboard_id=dashboard_id)
    }
    if not personalizados:
        return slots_base

    resultado = []
    for indice, slot in enumerate(slots_base):
        componente = personalizados.get(slot['id'])
        if not componente:
            resultado.append({**slot, '_orden': indice + 1})
            continue

        nuevo = {
            **slot,
            'ancho': componente.width, 'alto': componente.height,
            'chart_type': componente.chart_type or slot['chart_type'],
            'config_fijo': componente.config,
            'is_visible': componente.is_visible,
            '_orden': componente.order,
        }
        if componente.styles:
            # Los colores son varios (principal/vencido/no vencido/sin gestión/texto/fondo): se
            # conserva el diccionario entero, no solo el principal.
            nuevo['styles_personalizados'] = componente.styles
        color_personalizado = (componente.styles or {}).get('colorPrincipal')
        if color_personalizado:
            nuevo['color_defecto'] = color_personalizado
        contenido = componente.content or {}
        if contenido.get('titulo'):
            nuevo['titulo_personalizado'] = contenido['titulo']
        if conservar_descripcion and contenido.get('descripcion'):
            nuevo['descripcion_personalizada'] = contenido['descripcion']
        resultado.append(nuevo)

    resultado.sort(key=lambda s: s['_orden'])
    return resultado


def slots_efectivos():
    """Los 13 slots a usar para sembrar un dashboard NUEVO real: lo que un administrador haya
    personalizado en "Configuración → Plantilla base" (los `DashboardComponent` de
    `DASHBOARD_ID_PLANTILLA_BASE`), si existe — o si no, `PLANTILLA_SLOTS` tal cual (todavía sin
    personalizar, o primer arranque antes de que la plantilla base se haya sembrado siquiera)."""
    return _slots_con_personalizacion(DASHBOARD_ID_PLANTILLA_BASE, PLANTILLA_SLOTS, conservar_descripcion=True)


def slots_vigentes(dashboard_id):
    """Los 13 slots tal como el dashboard se ve AHORA: su propia personalización sobre la de la
    plantilla base. Es la base correcta para recalcular un dashboard que ya existe — reconstruirlo
    desde `PLANTILLA_SLOTS` le devolvería el diseño de fábrica."""
    return _slots_con_personalizacion(dashboard_id, slots_efectivos(), conservar_descripcion=False)


def _construir_componente(slot, orden, contenido, propuesta=None):
    chart_type = _chart_type_elegido(slot, propuesta)
    config = dict(slot.get('config_fijo') or {})
    if chart_type in dashboard_layout.TIPOS_CON_LEYENDA:
        # `setdefault`: si la posición ya tiene una leyenda ubicada a mano, se respeta.
        config.setdefault('leyenda_posicion', dashboard_layout.LEYENDA_POSICION_POR_DEFECTO)
    styles = dict(slot.get('styles_personalizados') or {})
    if slot.get('color_defecto'):
        styles.setdefault('colorPrincipal', slot['color_defecto'])
    contenido = dict(contenido)
    if slot.get('titulo_personalizado'):
        contenido['titulo'] = slot['titulo_personalizado']
    if slot.get('descripcion_personalizada'):
        contenido['descripcion'] = slot['descripcion_personalizada']
    return {
        'component_id': slot['id'], 'type': slot['tipo'], 'chart_type': chart_type,
        'row': 1, 'order': orden, 'width': slot['ancho'], 'height': slot['alto'],
        'is_visible': slot.get('is_visible', True),
        'content': contenido, 'styles': styles, 'config': config, 'mapeo': propuesta or {},
    }


def recalcular_zona_personal(layout, df, dashboard_id=None, fecha_referencia=None):
    """Contenido recalculado de los componentes que NO son una de las 13 posiciones fijas — los
    de la Zona Personal, que guardan su `calculo` dentro del propio `mapeo` porque no tienen un
    catálogo externo del que sacarlo. Devuelve `{component_id: contenido}`.

    La usan los dos caminos que traen datos nuevos: aplicar un mapeo (cargar un archivo, conectar
    la fuente, la actualización automática) y `services/reproceso.py`. Estaba solo en el segundo,
    y por eso el Dashboard Directorio —que tiene TODO su informe en la Zona Personal— se quedaba
    con los números del archivo anterior hasta que alguien corriera el reproceso a mano.

    Dos casos se saltan, conservando el contenido que el componente ya tenía:

    - Sin `calculo` en el mapeo (el flujo legado de recomendaciones automáticas no lo guarda):
      no hay forma de recalcular y adivinar sería peor.
    - Un `None` de `calcular_contenido_por_calculo`, que es una columna mapeada que el archivo
      nuevo ya no trae. Es el resguardo que las 13 posiciones fijas tienen con su dato ficticio
      y que un componente de Zona Personal no tenía: sin esto, cargar un archivo con otras
      columnas dejaría la sección en blanco en vez de mostrar lo último que se pudo calcular.
    """
    ids_de_plantilla = {slot['id'] for slot in PLANTILLA_SLOTS}
    contenidos = {}
    for componente in layout.components.all():
        if componente.component_id in ids_de_plantilla:
            continue
        propuesta = componente.mapeo or {}
        calculo = propuesta.get('calculo')
        if not calculo:
            continue
        anterior = componente.content or {}
        nuevo = calcular_contenido_por_calculo(
            df, calculo, anterior.get('titulo', ''), propuesta, dashboard_id, fecha_referencia,
        )
        if nuevo is None:
            continue
        # La fecha del corte no la produce ningún cálculo: la agrega el Dashboard Directorio al
        # KPI que titula el informe ("Corte junio 2026"). Se decide por la marca del COMPONENTE
        # (`es_base_porcentaje`) y no por si el contenido anterior la traía: un contenido que se
        # perdió es justamente el caso que hay que reparar.
        if (componente.config or {}).get('es_base_porcentaje') and fecha_referencia:
            nuevo['fecha_corte'] = (
                fecha_referencia.isoformat() if hasattr(fecha_referencia, 'isoformat') else str(fecha_referencia)
            )
        contenidos[componente.component_id] = nuevo
    return contenidos


def _componentes_zona_personal(layout, contenidos=None):
    """Los componentes que el usuario agregó a mano a la "Zona Personal" (`config.zona ==
    'personal'`, ver `dashboard_layout.agregar_componente_generado`), con su contenido recalculado
    si se le pasan `contenidos` (`recalcular_zona_personal`).

    Antes se preservaban tal cual, sin recalcular, por miedo a "la columna ya no existe": la
    plantilla fija resuelve ese caso cayendo a datos ficticios y un componente de Zona Personal no
    tenía ese resguardo. Ahora sí lo tiene —`recalcular_zona_personal` conserva el contenido
    anterior cuando el cálculo no se puede hacer—, así que no recalcular solo lograba que un
    dashboard armado sobre la Zona Personal siguiera mostrando los números del archivo viejo.

    Se lee directo de `DashboardComponent` para conservar el estado oculto de cada uno."""
    return [
        {
            'component_id': c.component_id, 'type': c.type, 'chart_type': c.chart_type,
            'row': c.row, 'order': c.order, 'width': c.width, 'height': c.height,
            'is_visible': c.is_visible,
            'content': (contenidos or {}).get(c.component_id, c.content),
            'styles': c.styles, 'config': c.config, 'mapeo': c.mapeo,
        }
        for c in DashboardComponent.objects.filter(layout=layout)
        if (c.config or {}).get('zona') == 'personal'
    ]


def _escribir_plantilla(dashboard_id, contenidos_por_slot, mapeo=None, slots=None,
                        contenidos_personales=None):
    slots = slots if slots is not None else PLANTILLA_SLOTS
    mapeo = mapeo or {}
    layout = dashboard_layout.obtener_o_crear_layout(dashboard_id)
    personales = _componentes_zona_personal(layout, contenidos_personales)
    componentes = [
        _construir_componente(slot, i + 1, contenidos_por_slot[slot['id']], mapeo.get(slot['id']))
        for i, slot in enumerate(slots)
    ] + [{**c, 'order': len(slots) + i + 1} for i, c in enumerate(personales)]
    dashboard_layout._escribir_componentes(layout, componentes)
    layout.version += 1
    layout.save(update_fields=['version', 'actualizado_en'])
    return layout


def sembrar_plantilla(dashboard_id):
    """Crea los 13 componentes de la plantilla con datos ficticios, siempre a partir de los
    valores de fábrica (`PLANTILLA_SLOTS`, patrón Z) — nunca de la personalización. Reservada para
    dos casos: el primer arranque de la propia plantilla base (`DASHBOARD_ID_PLANTILLA_BASE`) y el
    botón "Restablecer al patrón Z" (volver a sembrarla). Un dashboard real nuevo se siembra con
    `sembrar_plantilla_desde_base`, que sí respeta la personalización vigente."""
    return _escribir_plantilla(dashboard_id, datos_ficticios())


def sembrar_plantilla_desde_base(dashboard_id):
    """Como `sembrar_plantilla`, pero usa `slots_efectivos()` — la disposición/tipo de gráfico/
    color/título personalizados en "Configuración → Plantilla base", si los hay. Es la que siembra
    todo dashboard real nuevo (`services.dashboards.crear_dashboard`, incluidas sus pestañas)."""
    return _escribir_plantilla(dashboard_id, datos_ficticios(), slots=slots_efectivos())


def aplicar_mapeo(dashboard_id, df, mapeo, actor=None, request=None, fecha_referencia=None):
    """Recalcula las 13 posiciones a partir de un mapeo ya confirmado por el usuario y
    sobreescribe los mismos 13 componentes (nunca agrega otros) — se puede llamar varias veces
    (p. ej. tras cargar un archivo distinto) sin duplicar nada. El `chart_type` de cada posición
    (`_chart_type_elegido`) también sale del mapeo, así que cambiar cómo se dibuja una gráfica (p.
    ej. de barras a líneas) se aplica junto con el resto de ajustes.

    IMPORTANT: se reconstruye sobre `slots_vigentes(dashboard_id)`, no sobre `PLANTILLA_SLOTS`. Lo
    que se recalcula son los DATOS; el diseño (tamaño, orden, colores, título, visibilidad,
    configuración) es de quien armó el dashboard y tiene que sobrevivir. Reconstruir de fábrica no
    era un caso de borde: lo disparaba cada actualización automática semanal/mensual
    (`fuente_bd_scheduler`), cada archivo nuevo y cada reconfiguración desde la pantalla."""
    contenidos = calcular_datos_mapeo(df, mapeo, dashboard_id, fecha_referencia)
    # La Zona Personal también se recalcula contra el archivo nuevo. Sin esto, un dashboard que
    # tiene ahí su contenido real —el Directorio tiene sus 9 secciones— quedaba con los números
    # del archivo anterior después de cargar datos, y solo se actualizaba si alguien se acordaba
    # de correr `reprocesar_dashboards` a mano.
    layout_actual = dashboard_layout.obtener_o_crear_layout(dashboard_id)
    personales = recalcular_zona_personal(layout_actual, df, dashboard_id, fecha_referencia)
    layout = _escribir_plantilla(
        dashboard_id, contenidos, mapeo, slots=slots_vigentes(dashboard_id),
        contenidos_personales=personales,
    )

    log_event(
        domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_TEMPLATE_APPLIED', actor=actor,
        dashboard_id=dashboard_id, metadata={'version': layout.version}, request=request,
    )
    return layout
