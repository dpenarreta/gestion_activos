"""Dashboard Directorio — réplica de la pestaña "6. Cartera" de un informe financiero mensual.

Este dashboard es la excepción del proyecto en PRESENTACIÓN, no en datos. Sus secciones se dibujan
con renderers propios (`frontend/src/components/dashboard-directorio/`, activados por
`config.render == 'directorio'`) porque los genéricos no saben mostrar etiquetas sobre las barras,
una meta al lado del valor con ✓/✗ ni tarjetas resumen dentro de una sección.

Pero el CONTENIDO se calcula igual que en cualquier otro dashboard: cada componente guarda su
`mapeo` (`calculo` + columnas + parámetros) y el contenido sale de
`plantilla.calcular_contenido_por_calculo`. Esto es lo que hace que las secciones sean
parametrizables: "Configurar componente → Datos" sabe editar los cinco cálculos que usa (`kpi`,
`tramos_antiguedad`, `cumplimiento_metas`, `concentracion` y `antiguedad_por_deudor`, este último
agregado para esta sección), la vista previa recalcula por el endpoint de siempre y el resultado
sigue siendo la forma genérica que los renderers consumen.

Una versión anterior de este módulo guardaba una forma de contenido propia (`content['bloque']`) y
`mapeo` vacío. Se veía igual, pero dejaba todo quemado: cambiar la columna de saldo, las metas o el
Top-N exigía editar código, y guardar desde la interfaz habría devuelto contenido genérico que el
renderer propio no sabía dibujar. Qué sección es cada una vive ahora en `config['bloque']`, que el
editor conserva, en vez de en el contenido, que se recalcula.

El "Anexo — evolución del saldo" del mockup no está: necesita el saldo del cliente al cierre de
cada mes y un corte de cobranza es una foto única (el propio mockup dice que esos números salen de
otro informe).
"""

from . import dashboard_layout, plantilla
from ..models import DashboardComponent, DashboardLayout

IDS_FABRICA = [
    'kpi-1', 'kpi-2', 'kpi-3', 'kpi-4',
    'grafico-1', 'grafico-2', 'grafico-3', 'grafico-4', 'grafico-5', 'grafico-6',
    'tabla-1', 'tabla-2', 'tabla-3',
]

# Valores por defecto: son los nombres del corte de cobranza que alimenta este informe, pero NADA
# depende de ellos — el comando los recibe por parámetro y quedan guardados en el `mapeo` de cada
# componente, editable después desde "Configurar componente".
COLUMNA_VALOR = 'Saldo'
COLUMNA_FECHA = 'Fecha de Vencimiento'
COLUMNA_CLIENTE = 'Cliente'
TOP_N = 16
# Cuántos deudores muestra la sección de antigüedad por deudor. Dos es lo que trae el informe; el
# tope real (6) lo fija `generic_charts.LIMITE_DEUDORES`.
DEUDORES = 2

DORADO, VERDE, AZUL = '#D4AF37', '#2E7D32', '#1E88E5'
ROJO, GRANATE, CORAL, ROSA = '#C62828', '#8B1E1E', '#EF9A9A', '#F48FB1'

TRAMOS = ['Anticipada', '30 días', '60 días', '90 días', '120 días', '+120 días']
# De "sano" a "preocupante", alineado posicionalmente con `TRAMOS`.
COLORES_TRAMOS = dict(zip(TRAMOS, [VERDE, AZUL, DORADO, CORAL, ROSA, ROJO]))

# Metas del informe: las cinco primeras filas son acumuladas y se exigen crecientes; la última es
# la cola >120 días, que se acota por arriba. Son el punto de partida, no una constante: quedan en
# `mapeo['metas']` y se editan desde la interfaz como las de cualquier otro cumplimiento.
METAS = [
    {'meta_min': 50}, {'meta_min': 70}, {'meta_min': 80},
    {'meta_min': 90}, {'meta_min': 95}, {'meta_max': 5},
]

# El tope del último tramo ("más de 120 días"), que el informe también señala bajo el KPI. Se lee
# de METAS en vez de repetirse: son el mismo número y tienen que moverse juntos.
META_MAXIMA_MAS_120 = METAS[-1]['meta_max']

ANCHO_KPI, ALTO_KPI = 3, 170
ANCHO_PANEL, ALTO_PANEL = 6, 560
COLUMNA_RUC = 'Ruc Cliente'
# Qué columnas muestra el detalle de la consulta por cliente. Son las que hacen falta para
# reconocer un documento; las otras 20+ del archivo se agregan desde la configuración del
# componente. Si alguna no existe en el archivo cargado, se ignora sola.
COLUMNAS_DETALLE_DEUDOR = [
    'Número de Documento', 'Fecha de Emisión', 'Fecha de Vencimiento', 'Saldo',
    'Tipo de Venta', 'Causal', 'Observaciones',
]
ALTO_CONSULTA_DEUDOR = 620

ALTO_CONCENTRACION = 900
ALTO_DEUDORES = 520


def columnas_requeridas(columna_valor=COLUMNA_VALOR, columna_fecha=COLUMNA_FECHA, columna_cliente=COLUMNA_CLIENTE):
    return [columna_valor, columna_fecha, columna_cliente]


def columnas_faltantes(df, **columnas):
    return [c for c in columnas_requeridas(**columnas) if c not in df.columns]


def especificacion(columna_valor=COLUMNA_VALOR, columna_fecha=COLUMNA_FECHA,
                   columna_cliente=COLUMNA_CLIENTE, top_n=TOP_N, deudores=DEUDORES,
                   columna_ruc=COLUMNA_RUC):
    """Las secciones del informe, con su `mapeo` ya armado a partir de las columnas elegidas.

    `config['bloque']` le dice al renderer qué sección es. Va en `config` y no en el contenido
    porque el editor conserva `config` entre recálculos y reemplaza el contenido entero: si el
    bloque viviera ahí, la primera edición desde la interfaz dejaría la sección sin identidad.
    """
    filtro_base = {'columna_filtro': columna_fecha, 'tipo_filtro': 'dias_vencidos'}
    # Las columnas del detalle siguen a las columnas ELEGIDAS, no a los nombres por defecto: la
    # vista de producción llama "Saldo Total" a lo que el Excel llamaba "Saldo", y con la lista
    # literal el detalle de la consulta se abría sin la columna del saldo — justo el dato por el
    # que se busca a un cliente. Las que no existan en el archivo se ignoran solas más adelante.
    renombres = {COLUMNA_VALOR: columna_valor, COLUMNA_FECHA: columna_fecha}
    columnas_detalle = list(dict.fromkeys(renombres.get(c, c) for c in COLUMNAS_DETALLE_DEUDOR))
    kpis = [
        ('cartera-total', 'CARTERA TOTAL (CORTE COBRANZA)', DORADO, 'neutro', None, True),
        ('al-corriente', 'AL CORRIENTE (ANTICIPADA)', VERDE, 'neutro',
         {**filtro_base, 'operador_filtro': 'menor_igual', 'dias_filtro': 0}, False),
        ('vencida-total', 'VENCIDA TOTAL', ROJO, 'alerta',
         {**filtro_base, 'operador_filtro': 'mayor', 'dias_filtro': 0}, False),
        ('vencida-mas-120-dias', 'VENCIDA +120 DÍAS', GRANATE, 'alerta',
         {**filtro_base, 'operador_filtro': 'mayor', 'dias_filtro': 120}, False),
    ]

    secciones = []
    for component_id, titulo, color, tono, filtro, es_base in kpis:
        mapeo = {'disponible': True, 'calculo': 'kpi', 'columna_valor': columna_valor, 'formato': 'moneda'}
        if filtro:
            mapeo.update(filtro)
        # `es_base_porcentaje` marca contra qué KPI se calcula el "% del portafolio" que el
        # informe muestra bajo los otros tres. Se resuelve en el frontend, con los valores ya
        # calculados, para que siga siendo correcto después de cambiar cualquier mapeo.
        config = {'bloque': 'kpi', 'tono': tono, 'es_base_porcentaje': es_base}
        if component_id == 'vencida-mas-120-dias':
            # El informe no muestra este KPI como un porcentaje más: lo señala contra su meta de
            # control ("excede meta máx. 5%"), porque es el único tramo con un tope. El tope sale
            # de la misma lista de METAS que alimenta la tabla de cumplimiento, así que cambiarlo
            # ahí lo cambia en los dos lugares y no pueden quedar diciendo cosas distintas.
            config['meta_maxima_porcentaje'] = META_MAXIMA_MAS_120
        secciones.append({
            'component_id': component_id, 'titulo': titulo, 'calculo': 'kpi',
            'type': 'kpi', 'chart_type': '', 'width': ANCHO_KPI, 'height': ALTO_KPI,
            'styles': {'colorPrincipal': color},
            'config': config,
            'mapeo': mapeo,
        })

    secciones.append({
        'component_id': 'antiguedad-de-cartera',
        # `{corte}` lo reemplaza el renderer por el mes del corte vigente, igual que `{n}`
        # en el título de concentración: con el mes ya escrito, el título quedaría
        # anunciando el corte anterior en cuanto se cargue un archivo nuevo.
        'titulo': 'ANTIGÜEDAD DE CARTERA — {corte}',
        'calculo': 'tramos_antiguedad', 'type': 'chart', 'chart_type': 'barras_verticales',
        'width': ANCHO_PANEL, 'height': ALTO_PANEL,
        'styles': {'coloresPorCategoria': dict(COLORES_TRAMOS)},
        'config': {'bloque': 'antiguedad'},
        'mapeo': {
            'disponible': True, 'calculo': 'tramos_antiguedad',
            'columna_fecha': columna_fecha, 'columna_valor': columna_valor,
        },
    })
    secciones.append({
        'component_id': 'cumplimiento-metas-antiguedad',
        'titulo': 'CUMPLIMIENTO DE METAS DE ANTIGÜEDAD (ACUMULADO)',
        'calculo': 'cumplimiento_metas', 'type': 'chart', 'chart_type': 'tabla',
        'width': ANCHO_PANEL, 'height': ALTO_PANEL, 'styles': {},
        'config': {'bloque': 'cumplimiento'},
        'mapeo': {
            'disponible': True, 'calculo': 'cumplimiento_metas',
            'columna_fecha': columna_fecha, 'columna_valor': columna_valor,
            'metas': [dict(meta) for meta in METAS],
        },
    })
    secciones.append({
        'component_id': 'concentracion-de-cartera',
        # `{n}` lo reemplaza el renderer por el `top_n` vigente (ver `DirectorioSeccion.jsx`). Va
        # como marcador y no interpolado acá porque el título es texto editable por el usuario y se
        # guarda una sola vez: si llevara el número ya escrito, cambiar el Top-N desde "Configurar
        # componente" actualizaría las tarjetas y la tabla pero dejaría el título diciendo otra
        # cifra. Quien edite el título puede quitar el marcador; entonces manda su texto y no hay
        # nada que pueda quedar desfasado.
        'titulo': 'CONCENTRACIÓN DE CARTERA — TOP {n} CLIENTES VS. RESTO DE LA CARTERA',
        'calculo': 'concentracion', 'type': 'chart', 'chart_type': 'tabla',
        'width': 12, 'height': ALTO_CONCENTRACION, 'styles': {},
        'config': {'bloque': 'concentracion'},
        'mapeo': {
            'disponible': True, 'calculo': 'concentracion',
            'columna_id': columna_cliente, 'columna_valor': columna_valor, 'top_n': top_n,
        },
    })
    secciones.append({
        'component_id': 'mayores-deudores',
        # `{n}` (cantidad de deudores) y `{corte}` (mes del corte) los reemplaza el renderer,
        # por el mismo motivo que en las otras dos secciones con marcador.
        'titulo': 'ANTIGÜEDAD DE CARTERA — {n} MAYORES DEUDORES ({corte})',
        'calculo': 'antiguedad_por_deudor', 'type': 'chart', 'chart_type': 'tabla',
        'width': 12, 'height': ALTO_DEUDORES, 'styles': {},
        'config': {'bloque': 'deudores'},
        'mapeo': {
            'disponible': True, 'calculo': 'antiguedad_por_deudor',
            'columna_id': columna_cliente, 'columna_fecha': columna_fecha,
            'columna_valor': columna_valor, 'cuantos': deudores,
        },
    })
    secciones.append({
        'component_id': 'consulta-deudor',
        'titulo': 'CONSULTA POR CLIENTE — ANTIGÜEDAD Y DOCUMENTOS',
        # Va AL FINAL del dashboard, después de la última sección del informe. Las de arriba son
        # la réplica de la pestaña impresa y se leen en ese orden; esta es una herramienta de
        # consulta que se usa a demanda, así que no se interpone entre ellas — y menos entre el
        # gráfico de antigüedad y la tabla de cumplimiento, que ocupan media página cada uno y van
        # lado a lado: una sección de ancho completo en el medio parte esa fila.
        #
        # No tiene `calculo`: su contenido no se precalcula, se consulta en vivo contra el archivo
        # (`services/consulta_deudor.py`). El contenido guardado es solo el título, para que el
        # editor lo trate como cualquier otra sección (moverla, ocultarla, renombrarla).
        'calculo': None, 'type': 'chart', 'chart_type': 'tabla',
        'width': 12, 'height': ALTO_CONSULTA_DEUDOR, 'styles': {},
        'config': {
            'bloque': 'consulta-deudor',
            'columnas_detalle': columnas_detalle,
        },
        # Sin `calculo` y con `disponible: False` a propósito: no hay contenido que calcular ni
        # que reprocesar. El mapeo existe igual porque la consulta SÍ necesita saber qué columnas
        # usar, y así la sección sigue siendo reconfigurable como las demás.
        'mapeo': {
            'disponible': False,
            'columna_id': columna_cliente, 'columna_ruc': columna_ruc,
            'columna_fecha': columna_fecha, 'columna_valor': columna_valor,
        },
    })
    return secciones


def calcular_contenidos(df, fecha_corte, **columnas):
    """`[(spec, contenido)]` sin tocar la base. El contenido es la forma GENÉRICA de siempre."""
    piezas = []
    for spec in especificacion(**columnas):
        contenido = plantilla.calcular_contenido_por_calculo(
            df, spec['calculo'], spec['titulo'], spec['mapeo'], fecha_referencia=fecha_corte,
        )
        # La fecha del corte viaja en el CONTENIDO del KPI total, no en su `config`: el contenido
        # se recalcula con cada archivo nuevo y la fecha cambia con él, mientras que `config` se
        # conserva entre recálculos y quedaría anunciando el corte anterior.
        if spec['config'].get('es_base_porcentaje') and fecha_corte:
            contenido['fecha_corte'] = (
                fecha_corte.isoformat() if hasattr(fecha_corte, 'isoformat') else str(fecha_corte)
            )
        piezas.append((spec, contenido))
    return piezas


def _componentes_de_fabrica_ocultos(layout, orden_desde):
    """Las 13 posiciones de la plantilla, ocultas, conservando todo lo demás.

    Se conservan en vez de borrarse para no perder su mapeo: volver al dashboard genérico es solo
    volver a mostrarlas.
    """
    componentes = []
    for i, componente in enumerate(layout.components.filter(component_id__in=IDS_FABRICA).order_by('order')):
        componentes.append({
            'component_id': componente.component_id, 'type': componente.type,
            'chart_type': componente.chart_type, 'row': 1, 'order': orden_desde + i,
            'width': componente.width, 'height': componente.height, 'is_visible': False,
            'content': componente.content or {}, 'styles': componente.styles or {},
            'config': componente.config or {}, 'mapeo': componente.mapeo or {},
        })
    return componentes


def construir(dashboard_id, df, fecha_corte, **columnas):
    """Calcula todas las secciones contra `df` y reescribe el layout. Devuelve `[(id, ok)]`."""
    layout = dashboard_layout.obtener_o_crear_layout(dashboard_id)
    piezas = calcular_contenidos(df, fecha_corte, **columnas)

    componentes = []
    resultados = []
    for orden, (spec, contenido) in enumerate(piezas, start=1):
        resultados.append((spec['component_id'], contenido is not None))
        componentes.append({
            'component_id': spec['component_id'], 'type': spec['type'],
            'chart_type': spec['chart_type'], 'row': 1, 'order': orden,
            'width': spec['width'], 'height': spec['height'], 'is_visible': True,
            'content': contenido or {'titulo': spec['titulo']}, 'styles': spec['styles'],
            # Sin `bloqueado`: este dashboard es del usuario, que tiene que poder mover, redimensionar
            # y sobre todo reconfigurar cada sección. `zona: personal` lo trata como componente propio
            # y `render: directorio` elige sus renderers.
            'config': {'zona': 'personal', 'render': 'directorio', **spec['config']},
            'mapeo': spec['mapeo'],
        })

    componentes.extend(_componentes_de_fabrica_ocultos(layout, len(componentes) + 1))

    dashboard_layout._escribir_componentes(layout, componentes)
    layout.version += 1
    layout.save(update_fields=['version', 'actualizado_en'])
    return resultados


def esta_sembrado(dashboard_id):
    layout = DashboardLayout.objects.filter(dashboard_id=dashboard_id).first()
    if layout is None:
        return False
    return DashboardComponent.objects.filter(layout=layout, component_id='cartera-total').exists()
