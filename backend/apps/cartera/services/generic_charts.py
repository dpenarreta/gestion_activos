"""Análisis genérico de columnas de un archivo cargado, recomendación de gráficas a partir de ese
análisis, y cálculo de los datos de cada gráfica confirmada — a diferencia del resto del paquete
`services/` (column_mapper, ingest, calculator, aggregations), este módulo no asume ningún esquema
de negocio fijo (cliente/saldo/causal/...): se aplica a cualquier archivo subido a cualquier
dashboard. Flujo: cargar archivo → analizar columnas (con alias editables en el frontend) →
recomendar gráficas → el usuario agrega, una por una, las que le sirven."""

from datetime import date

import pandas as pd

CARDINALIDAD_MAXIMA_CATEGORIA = 50
LIMITE_CATEGORIAS_EN_GRAFICA = 15
# Tope de seguridad de `generar_datos_tabla` (no una cantidad "a mostrar": el frontend pagina
# sobre lo que llegue, con su propio selector de 5/10/20/25/50 filas por página, sección 24) —
# protege el tamaño de la respuesta cuando la columna de identidad elegida tiene una cardinalidad
# alta, sin impedir "ver toda la tabla" en el caso normal de una identidad de baja/media
# cardinalidad (producto, región, vendedor...).
LIMITE_FILAS_TABLA = 500
# Datos reales de negocio traen valores sueltos inválidos ("no aplica", celdas mal tipeadas) — un
# 80% de valores convertibles alcanza para clasificar la columna como numérica/fecha sin exigir
# que el archivo esté perfectamente limpio.
UMBRAL_RATIO_TIPO = 0.8


def _ratio_convertible(serie_sin_nulos, convertir):
    if len(serie_sin_nulos) == 0:
        return 0.0
    convertida = convertir(serie_sin_nulos)
    return float(convertida.notna().mean())


def _detectar_tipo(serie_sin_nulos):
    if _ratio_convertible(serie_sin_nulos, lambda s: pd.to_numeric(s, errors='coerce')) >= UMBRAL_RATIO_TIPO:
        return 'numerico'
    if _ratio_convertible(serie_sin_nulos, lambda s: pd.to_datetime(s, errors='coerce', format='mixed')) >= UMBRAL_RATIO_TIPO:
        return 'fecha'
    return 'categorico'


def analizar_columnas(df):
    """Para cada columna del archivo, determina su tipo y si es apta para usarse como valor
    (numérica) o como categoría de agrupación (texto/fecha con cardinalidad razonable) en una
    gráfica. `motivo_no_apta` explica por qué una columna no aparece en ninguna de las dos listas
    (para mostrarlo al usuario, no como un error)."""
    total_filas = len(df)
    columnas = []

    for nombre in df.columns:
        serie = df[nombre]
        sin_nulos = serie.dropna()
        valores_no_nulos = int(len(sin_nulos))
        valores_unicos = int(sin_nulos.nunique())

        if valores_no_nulos == 0:
            columnas.append({
                'nombre': str(nombre), 'tipo': 'vacio', 'valores_no_nulos': 0, 'valores_unicos': 0,
                'apta_para_valor': False, 'apta_para_categoria': False,
                'motivo_no_apta': 'La columna está vacía.',
            })
            continue

        tipo = _detectar_tipo(sin_nulos)
        apta_para_valor = tipo == 'numerico'
        apta_para_categoria = False
        motivo_no_apta = ''

        if not apta_para_valor:
            if valores_unicos <= 1:
                motivo_no_apta = 'Todos los valores son iguales.'
            elif total_filas > 1 and valores_unicos >= total_filas:
                motivo_no_apta = 'Todos los valores son distintos (parece un identificador).'
            elif valores_unicos > CARDINALIDAD_MAXIMA_CATEGORIA:
                motivo_no_apta = f'Tiene demasiados valores distintos ({valores_unicos}) para agrupar en una gráfica.'
            else:
                apta_para_categoria = True

        columnas.append({
            'nombre': str(nombre),
            'tipo': tipo,
            'valores_no_nulos': valores_no_nulos,
            'valores_unicos': valores_unicos,
            'apta_para_valor': apta_para_valor,
            'apta_para_categoria': apta_para_categoria,
            'motivo_no_apta': motivo_no_apta,
        })

    return {'total_filas': total_filas, 'columnas': columnas}


# Umbral de la advertencia de "columnas con valores en blanco recurrentes" (frontend,
# `TemplateMappingStep.jsx`) — una celda vacía suelta no amerita avisar; hacen falta al menos
# esta cantidad de filas en blanco en la misma columna.
UMBRAL_BLANCOS_RECURRENTES = 3


def columnas_con_blancos_recurrentes(df, umbral=UMBRAL_BLANCOS_RECURRENTES, cantidad_ejemplos=3):
    """Columnas cuyo valor viene en blanco (NaN) en `umbral` o más filas de `df` — no reporta
    columnas con menos blancos que eso. El tratamiento real de esos blancos (agrupados como "Sin
    dato" si la columna se usa como categoría, ignorados en la suma/promedio si se usa como valor)
    ya lo decide `analizar_columnas`/`generar_datos_*`; esta función solo detecta DÓNDE están, para
    que el frontend arme el aviso combinando ambas cosas.

    Por cada columna con blancos recurrentes, hasta `cantidad_ejemplos` filas de muestra: el
    número de fila tal como se vería en el archivo Excel original (contando la fila de
    encabezado) y los valores de las 2 primeras columnas del archivo (una referencia rápida para
    ubicar la fila sin tener que abrirlo)."""
    columnas_referencia = list(df.columns[:2])
    resultado = []
    for columna in df.columns:
        nulos = df[columna].isna()
        cantidad = int(nulos.sum())
        if cantidad < umbral:
            continue

        filas_ejemplo = []
        for indice in df.index[nulos][:cantidad_ejemplos]:
            fila = df.loc[indice]
            filas_ejemplo.append({
                'numero_fila': int(indice) + 2,  # +1 por índice 0-based, +1 por la fila de encabezado
                'referencia': {c: (None if pd.isna(fila[c]) else fila[c]) for c in columnas_referencia if c != columna},
            })

        resultado.append({'columna': str(columna), 'cantidad_en_blanco': cantidad, 'filas_ejemplo': filas_ejemplo})

    return resultado


def aplicar_seleccion_usuario(columnas, nombres_utilizables):
    """El análisis automático (`analizar_columnas`) es solo una sugerencia — el usuario decide,
    columna por columna, cuáles marcar como utilizables (ninguna se oculta ni se excluye por sí
    sola). Esto anula `apta_para_valor`/`apta_para_categoria` para cada columna: las marcadas
    quedan aptas según su tipo (numérica → valor, cualquier otro tipo → categoría); las no
    marcadas quedan inaptas para ambas, sin importar lo que haya sugerido el análisis."""
    nombres_utilizables = set(nombres_utilizables)
    resultado = []
    for columna in columnas:
        utilizable = columna['nombre'] in nombres_utilizables
        resultado.append({
            **columna,
            'apta_para_valor': utilizable and columna['tipo'] == 'numerico',
            'apta_para_categoria': utilizable and columna['tipo'] != 'numerico',
        })
    return resultado


MAX_CATEGORIAS_POR_VALOR = 3

# Catálogo de tipos de visualización disponibles para cualquier gráfica sugerida (sección
# "los gráficos sugeridos se pueden visualizar de cualquiera de estas formas"). `requiere_serie`
# marca los que necesitan una segunda columna de agrupación (barras agrupadas/apiladas) — solo
# están disponibles cuando la recomendación trae `columna_serie_sugerida`.
TIPOS_VISUALIZACION = [
    {'id': 'kpi', 'etiqueta': 'Tarjeta KPI', 'requiere_categoria': False, 'requiere_serie': False},
    {'id': 'barras_verticales', 'etiqueta': 'Barras verticales', 'requiere_categoria': True, 'requiere_serie': False},
    {'id': 'barras_horizontales', 'etiqueta': 'Barras horizontales', 'requiere_categoria': True, 'requiere_serie': False},
    {'id': 'barras_agrupadas', 'etiqueta': 'Barras agrupadas', 'requiere_categoria': True, 'requiere_serie': True},
    {'id': 'barras_apiladas', 'etiqueta': 'Barras apiladas', 'requiere_categoria': True, 'requiere_serie': True},
    {'id': 'area_apilada', 'etiqueta': 'Área apilada', 'requiere_categoria': True, 'requiere_serie': True},
    {'id': 'lineas', 'etiqueta': 'Líneas', 'requiere_categoria': True, 'requiere_serie': False},
    # Varias columnas de valor sobre un mismo eje de categorías (`generar_datos_multivalor`), no
    # una columna partida por una segunda categoría — usado por la plantilla fija de dashboard
    # ("Gráfico 2": comparar dos métricas, p. ej. ingresos vs. gastos, mes a mes).
    {'id': 'lineas_multiples', 'etiqueta': 'Líneas múltiples', 'requiere_categoria': True, 'requiere_serie': False},
    {'id': 'pastel', 'etiqueta': 'Pastel', 'requiere_categoria': True, 'requiere_serie': False},
    {'id': 'dona', 'etiqueta': 'Dona', 'requiere_categoria': True, 'requiere_serie': False},
    {'id': 'tabla', 'etiqueta': 'Tabla', 'requiere_categoria': True, 'requiere_serie': False},
    # A diferencia del resto, no agrupa por categoría: cada fila del archivo con ambas columnas
    # numéricas presentes es un punto (`generar_datos_dispersion`) — por eso no tiene
    # `requiere_categoria`/`requiere_serie` como los demás, y solo se ofrece a través de su propia
    # recomendación (ver `_mejor_par_columnas_numericas`), no como variante de una con categoría.
    {'id': 'dispersion', 'etiqueta': 'Dispersión', 'requiere_categoria': False, 'requiere_serie': False},
]


def _mejor_par_columnas_numericas(columnas_valor):
    """Elige, de forma determinista, las dos columnas numéricas con más datos (menos nulos) para
    proponer UNA gráfica de dispersión — igual criterio de acotar a una sola propuesta que
    `_mejor_columna_serie` (en vez de la combinación de todos los pares posibles, que crece en
    cuadrado con la cantidad de columnas numéricas). `None` si no hay al menos dos disponibles."""
    if len(columnas_valor) < 2:
        return None
    candidatas = sorted(columnas_valor, key=lambda c: c['valores_no_nulos'], reverse=True)
    return candidatas[0]['nombre'], candidatas[1]['nombre']


def _mejor_columna_serie(columnas, excluir_nombre):
    """Elige la mejor columna de categoría disponible para usar como segunda dimensión (serie) en
    una gráfica agrupada/apilada — la de menor cardinalidad, distinta de la ya usada como
    categoría principal. `None` si no hay ninguna otra disponible (esa recomendación simplemente
    no ofrece barras agrupadas/apiladas)."""
    candidatas = sorted(
        (c for c in columnas if c['apta_para_categoria'] and c['nombre'] != excluir_nombre),
        key=lambda c: c['valores_unicos'],
    )
    return candidatas[0]['nombre'] if candidatas else None


def generar_recomendaciones(columnas):
    """Propone qué gráficas armar a partir de las columnas ya analizadas (`analizar_columnas`):
    un KPI de total por cada columna numérica, y una gráfica por cada combinación razonable de
    columna numérica × columna de categoría (limitada a las `MAX_CATEGORIAS_POR_VALOR` categorías
    de menor cardinalidad, para no proponer decenas de combinaciones poco legibles). Cada
    recomendación con categoría trae además `columna_serie_sugerida` (la mejor segunda columna de
    agrupación disponible, o `None`), para que barras agrupadas/apiladas también sean una opción
    de visualización real. No calcula los datos todavía — eso ocurre recién al confirmar una
    recomendación (`generar_datos_grafica`/`generar_datos_multiserie`), para no procesar
    combinaciones que el usuario nunca va a pedir."""
    columnas_valor = [c for c in columnas if c['apta_para_valor']]
    columnas_categoria_todas = [c for c in columnas if c['apta_para_categoria']]
    columnas_categoria = sorted(columnas_categoria_todas, key=lambda c: c['valores_unicos'])[:MAX_CATEGORIAS_POR_VALOR]

    recomendaciones = []
    for columna_valor in columnas_valor:
        recomendaciones.append({
            'id': f"{columna_valor['nombre']}::total",
            'tipo_grafica': 'kpi',
            'columna_valor': columna_valor['nombre'],
            'columna_categoria': None,
            'categorias_unicas': None,
            'columna_serie_sugerida': None,
        })
        for columna_categoria in columnas_categoria:
            recomendaciones.append({
                'id': f"{columna_valor['nombre']}::{columna_categoria['nombre']}",
                'tipo_grafica': 'chart',
                'columna_valor': columna_valor['nombre'],
                'columna_categoria': columna_categoria['nombre'],
                'categorias_unicas': columna_categoria['valores_unicos'],
                'columna_serie_sugerida': _mejor_columna_serie(columnas_categoria_todas, columna_categoria['nombre']),
            })

    par_dispersion = _mejor_par_columnas_numericas(columnas_valor)
    if par_dispersion:
        columna_x, columna_y = par_dispersion
        recomendaciones.append({
            'id': f'{columna_x}::{columna_y}::dispersion',
            'tipo_grafica': 'dispersion',
            'columna_valor': columna_x,
            'columna_valor_y': columna_y,
            'columna_categoria': None,
            'categorias_unicas': None,
            'columna_serie_sugerida': None,
        })

    return recomendaciones


def calcular_datos_recomendaciones(df, recomendaciones):
    """Calcula los datos de cada recomendación (mismas funciones que se usan al confirmarla de
    verdad) para que el frontend pueda mostrar una vista previa real de cualquiera de sus formas
    de visualización disponibles antes de agregarla — no solo el título y la descripción. `datos`
    (y `datos_multiserie`, si aplica) quedan en `None` si la columna ya no existiera en el archivo
    (no debería pasar en circunstancias normales, pero no es un caso que deba romper la vista
    previa)."""
    resultado = []
    for r in recomendaciones:
        if r['tipo_grafica'] == 'dispersion':
            resultado.append({
                **r,
                'datos': generar_datos_dispersion(df, r['columna_valor'], r['columna_valor_y']),
                'datos_multiserie': None,
            })
            continue
        datos_multiserie = None
        if r.get('columna_serie_sugerida'):
            datos_multiserie = generar_datos_multiserie(df, r['columna_valor'], r['columna_categoria'], r['columna_serie_sugerida'])
        resultado.append({
            **r,
            'datos': generar_datos_grafica(df, r['columna_valor'], r['columna_categoria']),
            'datos_multiserie': datos_multiserie,
        })
    return resultado


def _agrupar_top_n(agrupado, limite=LIMITE_CATEGORIAS_EN_GRAFICA):
    """Conserva las `limite` categorías de mayor valor y colapsa el resto en una única 'Otras'.

    La barra 'Otras' se agrega siempre que haya categorías fuera del top, INCLUSO si su suma da
    exactamente 0 (dos categorías que se cancelan, +50 y −50). Antes un `if resto:` la omitía en
    ese caso y esas categorías desaparecían del gráfico sin ninguna señal de que existían.
    """
    if len(agrupado) <= limite:
        return agrupado
    top = agrupado.iloc[:limite]
    resto = float(agrupado.iloc[limite:].sum())
    return pd.concat([top, pd.Series({'Otras': resto})])


def generar_conteo_valores_unicos(df, columna):
    """Cantidad de valores distintos (no nulos) de una columna — para un KPI de "conteo" en vez
    de "suma" (p. ej. cantidad de clientes o números de documento diferentes). A diferencia de
    `generar_datos_grafica`, no hace falta que la columna sea numérica: cuenta valores únicos de
    cualquier tipo (texto, ID, etc.)."""
    if columna not in df.columns:
        return None
    return {'tipo': 'kpi', 'valor': int(df[columna].dropna().nunique())}


def generar_promedio_columna(df, columna):
    """Promedio (media aritmética) de una columna numérica — para un KPI de "promedio" en vez de
    "suma" (p. ej. saldo promedio o días de crédito promedio).

    `None` SOLO si la columna no existe: eso es lo que los llamadores interpretan como "la columna
    ya no está en el archivo". Si la columna existe pero no queda ningún valor numérico que
    promediar (columna de texto, o un filtro que no dejó filas) devuelve `0.0`, igual que la suma
    (`generar_datos_grafica`) y el conteo de únicos (`generar_conteo_valores_unicos`) sobre esa
    misma columna — antes devolvía `None` también en ese caso y cada llamador lo malinterpretaba a
    su manera: `plantilla.calcular_datos_mapeo` caía al dato ficticio (el KPI mostraba un número
    inventado con la descripción "Dato de ejemplo — se reemplaza al cargar un archivo", con un
    archivo ya cargado y mapeado) y `views.AgregarGraficaView` levantaba
    "La columna elegida ya no existe en el archivo", que no era la causa.
    """
    if columna not in df.columns:
        return None
    valores = pd.to_numeric(df[columna], errors='coerce').dropna()
    if valores.empty:
        return {'tipo': 'kpi', 'valor': 0.0}
    return {'tipo': 'kpi', 'valor': round(float(valores.mean()), 2)}


LIMITE_VALORES_UNICOS_FILTRO = 500


def valores_unicos_de_columna(df, columna, limite=LIMITE_VALORES_UNICOS_FILTRO):
    """Valores distintos (no nulos, como texto, orden alfabético) de una columna — para poblar el
    selector "valor" del filtro opcional de una posición de la plantilla (`columna_filtro`/
    `valor_filtro`). `total` es la cantidad real de valores distintos, por si `limite` recortó la
    lista (columnas de altísima cardinalidad, p. ej. un identificador)."""
    if columna not in df.columns:
        return None
    valores = sorted(str(v) for v in df[columna].dropna().unique())
    return {'valores': valores[:limite], 'total': len(valores)}


def valores_duplicados_de_columna(df, columna, cantidad_ejemplos=3):
    """Valores de una columna que aparecen más de una vez (no nulos), con su cantidad de
    repeticiones — para avisar, al elegir una columna de categoría de un gráfico o de identidad de
    fila de una tabla, que filas distintas van a agruparse bajo el mismo valor (comportamiento
    normal de "agrupar por categoría", pero puede no ser lo que el usuario esperaba). Ordenado por
    cantidad descendente (los ejemplos más repetidos primero) — a diferencia de
    `valores_unicos_de_columna`, que ordena alfabético y no cuenta repeticiones."""
    if columna not in df.columns:
        return None
    conteos = df[columna].dropna().astype(str).value_counts()
    duplicados = conteos[conteos > 1]
    ejemplos = [{'valor': valor, 'cantidad': int(cantidad)} for valor, cantidad in duplicados.head(cantidad_ejemplos).items()]
    return {'cantidad_valores_duplicados': int(len(duplicados)), 'ejemplos': ejemplos}


def generar_datos_grafica(df, columna_valor, columna_categoria=None):
    """Agrega los datos de una gráfica a partir de una columna de valor (numérica, se suma) y,
    opcionalmente, una columna de categoría para agrupar. Sin categoría, el resultado es un único
    total (KPI); con categoría, una serie de barras (suma por categoría, top 15 + "Otras")."""
    if columna_valor not in df.columns:
        return None

    valores = pd.to_numeric(df[columna_valor], errors='coerce')

    if not columna_categoria:
        return {'tipo': 'kpi', 'valor': round(float(valores.sum()), 2)}

    if columna_categoria not in df.columns:
        return None

    categorias = df[columna_categoria].fillna('Sin dato').astype(str)
    agrupado = valores.groupby(categorias).sum().sort_values(ascending=False)
    agrupado = _agrupar_top_n(agrupado)

    return {
        'tipo': 'chart',
        'categorias': [str(c) for c in agrupado.index.tolist()],
        'valores': [round(float(v), 2) for v in agrupado.values.tolist()],
    }


MAX_SERIES_EN_GRAFICA = 6


def generar_datos_multiserie(df, columna_valor, columna_categoria, columna_serie):
    """Agrega los datos de una gráfica de barras agrupadas/apiladas: suma de `columna_valor` por
    cada combinación de `columna_categoria` (eje) × `columna_serie` (una barra/segmento por cada
    valor distinto de esta columna). Limita las categorías igual que `generar_datos_grafica` (top
    15 + "Otras") y las series a las `MAX_SERIES_EN_GRAFICA` de mayor total, para no saturar la
    leyenda con decenas de segmentos apenas visibles."""
    if columna_valor not in df.columns or columna_categoria not in df.columns or columna_serie not in df.columns:
        return None

    valores = pd.to_numeric(df[columna_valor], errors='coerce')
    categorias = df[columna_categoria].fillna('Sin dato').astype(str)
    series = df[columna_serie].fillna('Sin dato').astype(str)

    tabla_completa = valores.groupby([categorias, series]).sum().unstack(fill_value=0.0)

    totales_categoria = tabla_completa.sum(axis=1).sort_values(ascending=False)
    if len(totales_categoria) > LIMITE_CATEGORIAS_EN_GRAFICA:
        categorias_incluidas = totales_categoria.index[:LIMITE_CATEGORIAS_EN_GRAFICA]
        tabla = tabla_completa.loc[categorias_incluidas]
        # Las categorías fuera del top se agrupan en "Otras", sumando cada serie por separado.
        resto = tabla_completa.drop(index=categorias_incluidas)
        if not resto.empty:
            tabla.loc['Otras'] = resto.sum(axis=0)
    else:
        tabla = tabla_completa

    # Las series fuera del top se colapsan en una serie 'Otras' en vez de descartarse. Antes se
    # recortaban a secas, así que los segmentos de una categoría dejaban de sumar su total (en un
    # caso con 8 series el gráfico mostraba 330 de 360) sin ninguna indicación — al revés que las
    # categorías, que sí tenían su barra 'Otras'.
    totales_serie = tabla.sum(axis=0).sort_values(ascending=False)
    series_incluidas = totales_serie.index[:MAX_SERIES_EN_GRAFICA]
    resto_series = tabla.drop(columns=series_incluidas)
    # Se reordena siempre por total descendente (comportamiento de siempre) y, solo si algo quedó
    # afuera, se agrega la serie 'Otras' al final.
    tabla = tabla[series_incluidas].copy()
    if not resto_series.empty:
        tabla['Otras'] = resto_series.sum(axis=1)

    return {
        'tipo': 'multiserie',
        'categorias': [str(c) for c in tabla.index.tolist()],
        'series': [
            {'nombre': str(s), 'valores': [round(float(v), 2) for v in tabla[s].tolist()]}
            for s in tabla.columns
        ],
    }


LIMITE_PUNTOS_DISPERSION = 300


def generar_datos_dispersion(df, columna_x, columna_y):
    """Calcula los puntos (x, y) de una gráfica de dispersión a partir de dos columnas numéricas —
    a diferencia del resto de gráficas, no agrupa por categoría: cada fila del archivo con ambos
    valores presentes es un punto. Se limita a `LIMITE_PUNTOS_DISPERSION` filas (las primeras del
    archivo, muestra determinista) para no saturar el gráfico ni la respuesta con archivos de
    miles de filas."""
    if columna_x not in df.columns or columna_y not in df.columns:
        return None

    x = pd.to_numeric(df[columna_x], errors='coerce')
    y = pd.to_numeric(df[columna_y], errors='coerce')
    validos = pd.DataFrame({'x': x, 'y': y}).dropna()
    if len(validos) > LIMITE_PUNTOS_DISPERSION:
        validos = validos.iloc[:LIMITE_PUNTOS_DISPERSION]

    return {
        'tipo': 'dispersion',
        'puntos': [{'x': round(float(fila.x), 2), 'y': round(float(fila.y), 2)} for fila in validos.itertuples()],
    }


def generar_datos_multivalor(df, columna_categoria, columnas_valor):
    """Agrega los datos de una gráfica que compara varias métricas (columnas de valor distintas)
    sobre un mismo eje de categorías — a diferencia de `generar_datos_multiserie` (una sola
    columna de valor partida por una segunda columna de categoría), aquí cada serie es una
    columna numérica distinta ya existente en el archivo (p. ej. "Ingresos" vs. "Gastos" por
    mes). Mismo shape de salida (`{tipo: 'multiserie', categorias, series}`) que
    `generar_datos_multiserie`, para reutilizar los mismos componentes de renderizado (líneas
    múltiples, barras agrupadas/apiladas, área apilada)."""
    if columna_categoria not in df.columns or not columnas_valor:
        return None
    if any(c not in df.columns for c in columnas_valor):
        return None

    categorias = df[columna_categoria].fillna('Sin dato').astype(str)
    agrupados = {c: pd.to_numeric(df[c], errors='coerce').groupby(categorias).sum() for c in columnas_valor}

    # Qué categorías entran al top se decide por la suma de TODAS las columnas de valor, no por la
    # primera. Rankeando por la primera, en un "Ingresos vs Gastos por mes" con 20 meses donde uno
    # solo tiene gastos altos, ese mes ocupaba el gráfico y los otros diecinueve —los de ingresos
    # altos— se colapsaban en "Otras": el gráfico mostraba justo lo que no interesaba comparar.
    totales_categoria = sum(agrupados.values()).sort_values(ascending=False)
    hay_resto = len(totales_categoria) > LIMITE_CATEGORIAS_EN_GRAFICA
    categorias_incluidas = totales_categoria.index[:LIMITE_CATEGORIAS_EN_GRAFICA] if hay_resto else totales_categoria.index

    series = []
    for columna in columnas_valor:
        agrupado = agrupados[columna]
        incluidos = [round(float(v), 2) for v in agrupado.reindex(categorias_incluidas, fill_value=0.0).tolist()]
        if hay_resto:
            resto = float(agrupado.drop(index=categorias_incluidas, errors='ignore').sum())
            incluidos.append(round(resto, 2))
        series.append({'nombre': str(columna), 'valores': incluidos})

    categorias_finales = [str(c) for c in categorias_incluidas.tolist()]
    if hay_resto:
        categorias_finales.append('Otras')

    return {'tipo': 'multiserie', 'categorias': categorias_finales, 'series': series}


TIPOS_AGREGACION_TABLA = ('suma', 'promedio', 'conteo_unicos', 'valor_celda')


def normalizar_columna_valor_tabla(columna_valor):
    """Cada entrada de `columnas_valor` es `{'columna': str, 'tipo_agregacion': 'suma'|'promedio'|
    'conteo_unicos'|'valor_celda'}` (sección 23) — también acepta el string plano de antes de esa
    sección (tratado como 'suma'), para que una tabla mapeada antes de este cambio se siga pudiendo
    recalcular sin que el usuario tenga que rehacer el mapeo. Público (no `_`): también lo usa
    `services/historico.py` para normalizar las columnas de una tabla histórica (sección 28).

    `{'manual': True, 'titulo': str, 'valores': [...], 'total': valor|None}` (sección 29) es una
    forma distinta, NO una columna real del archivo: sus valores los escribe el usuario a mano, uno
    por fila resultante, alineados por posición (no por identidad de `columna_id`) — se devuelve
    tal cual, sin intentar resolverla contra ninguna columna real."""
    if isinstance(columna_valor, dict) and columna_valor.get('manual'):
        return {
            'manual': True, 'titulo': columna_valor.get('titulo') or '',
            'valores': list(columna_valor.get('valores') or []), 'total': columna_valor.get('total'),
        }
    if columna_valor is None:
        return {'columna': None, 'tipo_agregacion': 'suma'}
    if isinstance(columna_valor, str):
        return {'columna': columna_valor, 'tipo_agregacion': 'suma'}
    tipo = columna_valor.get('tipo_agregacion')
    return {'columna': columna_valor.get('columna'), 'tipo_agregacion': tipo if tipo in TIPOS_AGREGACION_TABLA else 'suma'}


def _valor_celda(serie):
    """Para el tipo de agregación 'valor_celda': en vez de sumar/promediar, muestra el valor real
    de la celda cuando todas las filas del grupo comparten el mismo (columnas que identifican algo
    y no varían entre filas de un mismo grupo, p. ej. "Zona" o "Ciudad" de un cliente) — si
    difieren, no hay un único valor que mostrar, así que devuelve 'Varios' en vez de elegir uno al
    azar. `None` cuando el grupo no tiene ningún valor no nulo."""
    valores = serie.dropna().unique()
    if len(valores) == 0:
        return None
    if len(valores) == 1:
        return valores[0]
    return 'Varios'


def valor_agregado(serie, tipo_agregacion):
    """Aplica el tipo de agregación elegido a una columna de valor: 'suma' (agrega
    montos/cantidades), 'promedio' (media aritmética), 'conteo_unicos' (cuenta valores distintos —
    sirve para columnas no numéricas, p. ej. cuántos clientes o documentos distintos hay) o
    'valor_celda' (el valor real de la celda si es el mismo en toda la serie, ver `_valor_celda`).
    Público (no `_`): también lo usa `services/historico.py` para agregar una columna a través de
    varias cargas (sección 28), no solo dentro de un mismo archivo."""
    if tipo_agregacion == 'conteo_unicos':
        return serie.nunique()
    if tipo_agregacion == 'valor_celda':
        return _valor_celda(serie)
    numerica = pd.to_numeric(serie, errors='coerce')
    return numerica.mean() if tipo_agregacion == 'promedio' else numerica.sum()


def generar_datos_tabla(df, columna_id, columnas_valor, limite=LIMITE_FILAS_TABLA):
    """Arma una tabla con una fila por cada valor de `columna_id` (las `limite` de mayor total en
    la primera columna de valor REAL — un tope de seguridad alto, no la cantidad a mostrar: eso lo
    decide el frontend con su propio paginador, sección 24), una columna por cada entrada de
    `columnas_valor` — cada una agregada con el tipo de cálculo que el usuario haya elegido para
    esa columna (`suma`, `promedio`, `conteo_unicos` o `valor_celda`, sección 23) —, una columna
    final de "% del total" (sobre la primera columna de valor, agregada del mismo modo) y una fila
    de totales: siempre la suma de lo que se ve en cada columna, sin importar su tipo de agregación
    (así "Total" significa lo mismo en toda la tabla: la suma de las filas mostradas). A diferencia
    de una comparación "vs. mes anterior", el % del total siempre se puede calcular sin necesitar
    una dimensión de tiempo en el archivo.

    `valor_celda` es la excepción a "todo es una cantidad": es texto/categoría, no algo que se
    pueda sumar ni rankear numéricamente. Si la PRIMERA columna de valor REAL es `valor_celda`, el
    orden de las filas queda alfabético (no por magnitud) y "% del total" queda en 0 para todas las
    filas (no hay total numérico contra el cual repartir un porcentaje); si cualquier otra columna
    lo es, su celda en la fila de "Total" queda vacía (`None`) en vez de intentar sumar texto.

    Cualquier entrada `{'manual': True, ...}` (sección 29, ver `normalizar_columna_valor_tabla`) es
    una columna cuyos valores el usuario escribe a mano, uno por fila, alineados por POSICIÓN (no
    por identidad de `columna_id`) — nunca decide la cantidad/orden de filas ni participa del "%
    del total" (eso siempre lo deciden las columnas reales; si no hay ninguna, el orden queda
    alfabético por `columna_id` y el "% del total" en 0, igual que el caso `valor_celda` como
    primaria). Si `valores` trae menos elementos que filas resultantes, las filas sin valor quedan
    en `None`; si trae de más, los sobrantes se ignoran acá (ajustar lo persistido es
    responsabilidad de quien arma el mapeo, no de este cálculo)."""
    if columna_id not in df.columns or not columnas_valor:
        return None
    entradas = [normalizar_columna_valor_tabla(c) for c in columnas_valor]
    entradas_reales = [(i, e) for i, e in enumerate(entradas) if not e.get('manual')]
    if any(e['columna'] not in df.columns for _, e in entradas_reales):
        return None

    identidad = df[columna_id].fillna('Sin dato').astype(str)

    def agrupado(entrada):
        nombre_columna, tipo = entrada['columna'], entrada['tipo_agregacion']
        if tipo == 'conteo_unicos':
            return df[nombre_columna].groupby(identidad).nunique()
        if tipo == 'valor_celda':
            return df[nombre_columna].groupby(identidad).agg(_valor_celda)
        numerica = pd.to_numeric(df[nombre_columna], errors='coerce')
        return numerica.groupby(identidad).mean() if tipo == 'promedio' else numerica.groupby(identidad).sum()

    # Diccionario por índice en `entradas` (no una lista posicional 1:1): las entradas manuales no
    # tienen serie agrupada, así que el índice de `entradas_reales` ya no coincide con el índice en
    # `entradas` apenas hay una manual antes de alguna real.
    agrupados_por_indice = {i: agrupado(e) for i, e in entradas_reales}

    if entradas_reales:
        indice_principal, entrada_principal = entradas_reales[0]
        primaria_numerica = entrada_principal['tipo_agregacion'] != 'valor_celda'
        principal = agrupados_por_indice[indice_principal]
        ids_ordenados = list(principal.sort_values(ascending=False).index[:limite])
    else:
        indice_principal = None
        primaria_numerica = False
        principal = None
        ids_ordenados = sorted(identidad.unique())[:limite]

    filas = []
    totales_por_columna = [
        (None if e.get('manual') else (0.0 if e['tipo_agregacion'] != 'valor_celda' else None))
        for e in entradas
    ]
    for fila_idx, nombre_id in enumerate(ids_ordenados):
        fila = [str(nombre_id)]
        for i, entrada in enumerate(entradas):
            if entrada.get('manual'):
                valores = entrada['valores']
                fila.append(valores[fila_idx] if fila_idx < len(valores) else None)
                continue
            valor_bruto = agrupados_por_indice[i].get(nombre_id)
            if entrada['tipo_agregacion'] == 'valor_celda':
                fila.append(valor_bruto if pd.notna(valor_bruto) else None)
            else:
                valor = float(valor_bruto) if pd.notna(valor_bruto) else 0.0
                fila.append(round(valor, 2))
                totales_por_columna[i] += valor
        filas.append(fila)

    # El "% del total" se calcula recién acá, cuando ya se conoce el total de la columna primaria
    # TAL COMO SE MUESTRA en la fila "Total" (la suma de las filas listadas). Antes el denominador
    # era la columna completa reagregada con el mismo tipo de cálculo, lo que solo tiene sentido
    # para 'suma': con 'promedio' dividía la media de cada grupo por la media global y la columna
    # llegaba a mostrar 166% con un total de 333%; con 'conteo_unicos' un mismo valor presente en
    # dos grupos se contaba dos veces arriba y una sola abajo, y los porcentajes cerraban en 125%.
    # Dividir por la fila "Total" es la única regla que queda bien definida para los cuatro tipos
    # de agregación, y hace que el porcentaje coincida con el total que el lector tiene a la vista.
    base_porcentaje = totales_por_columna[indice_principal] if primaria_numerica else None
    for fila in filas:
        # +1 por la columna de identidad que va primero.
        valor_principal = fila[indice_principal + 1] if primaria_numerica else 0.0
        fila.append(round((valor_principal / base_porcentaje * 100) if base_porcentaje else 0.0, 2))

    fila_total = ['Total']
    for i, entrada in enumerate(entradas):
        if entrada.get('manual'):
            fila_total.append(entrada.get('total'))
        else:
            total = totales_por_columna[i]
            fila_total.append(round(total, 2) if total is not None else None)
    # Por construcción da 100% cuando hay una columna primaria numérica con algún valor: es la
    # suma de los porcentajes de las filas, que ahora se reparten sobre ese mismo total.
    fila_total.append(round(100.0 if base_porcentaje else 0.0, 2))

    nombres_columna = [(e.get('titulo') or 'Manual') if e.get('manual') else str(e['columna']) for e in entradas]
    return {
        'tipo': 'tabla_multi',
        'columnas': [str(columna_id)] + nombres_columna + ['% del total'],
        'filas': filas,
        'total': fila_total,
    }


# Tramos de antigüedad (días transcurridos entre una fecha y HOY) — mismos cortes que usa el
# filtro `dias_vencidos` de KPI (`plantilla.py::_aplicar_filtro_dias_vencidos`): 0 días (vence
# hoy) todavía cuenta como "Anticipada", no como vencido. Discretos para el gráfico de
# antigüedad; acumulados (cada tramo incluye los anteriores, EXCEPTO el último) para la tabla de
# cumplimiento de metas — alineados posicionalmente 1 a 1 con `ETIQUETAS_TRAMOS_ANTIGUEDAD`
# (`generar_datos_cumplimiento_tramos` usa el índice para leer el tramo discreto correspondiente
# a cada fila acumulada, ya que sus textos difieren). El último tramo ("Más de 120 días") NO es
# una fila de cierre al 100%: es la cola ">120 días" sola, igual valor que el último tramo
# discreto — ver `generar_datos_cumplimiento_tramos`.
ETIQUETAS_TRAMOS_ANTIGUEDAD = ['Anticipada', '30 días', '60 días', '90 días', '120 días', '+120 días']
ETIQUETAS_TRAMOS_ACUMULADOS = [
    'Corriente', 'Vencido ≤ 30 días (acum.)', 'Vencido ≤ 60 días (acum.)',
    'Vencido ≤ 90 días (acum.)', 'Vencido ≤ 120 días (acum.)', 'Más de 120 días',
]


def dias_transcurridos_desde(serie_fecha, fecha_referencia=None):
    """Días transcurridos entre cada fecha de `serie_fecha` (columna cruda, sin parsear) y
    `fecha_referencia` — positivo si la fecha ya pasó, negativo si todavía no llega, `NaN` si el
    valor no parsea como fecha. Único punto de verdad para este cálculo: lo usa tanto el filtro
    `dias_vencidos` de KPI como los tramos de antigüedad de acá — nunca lo recalcules inline en
    otro lado.

    `fecha_referencia` es la FECHA DE CORTE de la carga (`CargaArchivo.fecha_corte`), no el día en
    que se mira el dashboard. Antes esta función usaba siempre `date.today()`, con dos
    consecuencias: la antigüedad de un archivo de junio seguía envejeciendo en septiembre aunque el
    archivo no hubiera cambiado (los tramos se vaciaban hacia "+120 días" solos y un "Cumple" del
    cumplimiento de metas podía darse vuelta de un día para el otro), y convivían dos nociones de
    "vencido" en la misma pantalla, porque los KPIs de cartera (`calculator.anotar_estado_y_mora`)
    siempre midieron contra la fecha de corte. Se cae a hoy solo si la carga no tiene fecha de
    corte registrada, que es el comportamiento anterior.
    """
    fechas = pd.to_datetime(serie_fecha, errors='coerce', format='mixed')
    return (pd.Timestamp(fecha_referencia or date.today()) - fechas).dt.days


def _tramo_antiguedad(dias):
    """El tramo (uno de `ETIQUETAS_TRAMOS_ANTIGUEDAD`) al que corresponde una cantidad de días
    transcurridos — 0 o menos (fecha hoy o en el futuro) es "Anticipada", igual criterio que
    "mayor que 0 días" = vencido en el filtro de KPI. `None` si `dias` es `NaN` (fecha inválida):
    no cuenta en ningún tramo, ni siquiera en "Anticipada"."""
    if pd.isna(dias):
        return None
    if dias <= 0:
        return 'Anticipada'
    if dias <= 30:
        return '30 días'
    if dias <= 60:
        return '60 días'
    if dias <= 90:
        return '90 días'
    if dias <= 120:
        return '120 días'
    return '+120 días'


def generar_datos_tramos_antiguedad(df, columna_fecha, columna_valor, fecha_referencia=None):
    """Suma `columna_valor` agrupada por tramo de antigüedad (`ETIQUETAS_TRAMOS_ANTIGUEDAD`,
    calculado desde `columna_fecha` vs. HOY) — a diferencia de `generar_datos_grafica`, el eje de
    categorías es siempre esas 6 etiquetas fijas, en ese orden, sin importar cuáles tengan datos
    (un tramo sin ninguna fila aparece con `0`, nunca desaparece del gráfico). Filas cuya fecha no
    parsea quedan fuera de todos los tramos. `None` si falta alguna columna."""
    if columna_fecha not in df.columns or columna_valor not in df.columns:
        return None
    tramos = dias_transcurridos_desde(df[columna_fecha], fecha_referencia).map(_tramo_antiguedad)
    valores = pd.to_numeric(df[columna_valor], errors='coerce')
    sumas_por_tramo = valores.groupby(tramos).sum()
    return {
        'tipo': 'chart',
        'categorias': list(ETIQUETAS_TRAMOS_ANTIGUEDAD),
        'valores': [round(float(sumas_por_tramo.get(etiqueta, 0.0)), 2) for etiqueta in ETIQUETAS_TRAMOS_ANTIGUEDAD],
    }


def evaluar_meta(valor, meta_min, meta_max):
    """Evalúa `valor` contra una meta opcional de mínimo y/o máximo — `None` si ambos vienen
    vacíos (`None`/`''`, "sin meta configurada"). Si no, devuelve `{'meta_min', 'meta_max',
    'cumple': bool, 'motivos': [str, ...]}` (0, 1 o 2 motivos según qué condición se incumpla).
    Agnóstica de unidad: el llamador decide si `valor` es un monto bruto o un porcentaje, acá solo
    se comparan números."""
    tiene_min = meta_min not in (None, '')
    tiene_max = meta_max not in (None, '')
    if not tiene_min and not tiene_max:
        return None
    meta_min_num = float(meta_min) if tiene_min else None
    meta_max_num = float(meta_max) if tiene_max else None
    motivos = []
    if meta_min_num is not None and valor < meta_min_num:
        motivos.append(f'menor al mínimo ({meta_min_num})')
    if meta_max_num is not None and valor > meta_max_num:
        motivos.append(f'mayor al máximo ({meta_max_num})')
    return {'meta_min': meta_min_num, 'meta_max': meta_max_num, 'cumple': not motivos, 'motivos': motivos}


def etiqueta_cumplimiento(meta):
    """Texto corto de una sola celda (compatible con cualquier tabla) para el resultado de
    `evaluar_meta`: `'Sin meta'` si `meta is None`, `'Cumple'` si cumple, o `'No cumple
    (<motivos unidos con "; ">)'` si no."""
    if meta is None:
        return 'Sin meta'
    if meta['cumple']:
        return 'Cumple'
    return f"No cumple ({'; '.join(meta['motivos'])})"


def generar_datos_cumplimiento_tramos(df, columna_fecha, columna_valor, metas=None, fecha_referencia=None):
    """Tabla de cumplimiento de metas por tramo de antigüedad — las primeras 5 filas son
    ACUMULADAS ("Vencido ≤ 30 días (acum.)" incluye "Corriente"+"30 días", "≤ 60 días" incluye
    además "60 días", ...), pero la 6ª fila ("Más de 120 días") NO es una fila de cierre al 100%:
    es la cola ">120 días" SOLA, igual valor que el último tramo del gráfico de antigüedad
    discreto (`generar_datos_tramos_antiguedad`).

    El invariante real es que la 5ª fila (acumulado ≤120) más la 6ª (cola >120) dan 100%; las 6
    filas NO suman 100% entre sí y nunca podrían, porque las primeras 5 se contienen unas a otras
    (Corriente 10% + ≤30 30% + ≤60 50% + ≤90 70% + ≤120 90% + >120 10% = 260%). La versión
    anterior de este docstring afirmaba lo contrario.

    La base del porcentaje es el total de las filas QUE ENTRARON en algún tramo, no el total del
    archivo: una fila cuya fecha no parsea queda fuera de todos los tramos (igual que en
    `generar_datos_tramos_antiguedad`), así que incluirla en el denominador hacía que los
    porcentajes no cerraran —≤120 + >120 daba menos de 100%— sin ninguna señal de por qué. Como
    las metas se evalúan contra estos porcentajes, un archivo con fechas sucias podía reportar
    "No cumple" por filas que en realidad no se estaban clasificando.

    `metas` es una lista de hasta 6
    `{'meta_min', 'meta_max'}` alineada por posición con `ETIQUETAS_TRAMOS_ACUMULADOS` (entrada
    faltante o vacía = sin meta para ese tramo). Cada fila evalúa su meta contra el `%` de esa
    fila (acumulado para las primeras 5, de la cola sola para la última), NO contra el valor
    bruto — así las metas se expresan en porcentaje (ej. "≥ 50%"), coherente con cómo se
    documentan habitualmente los cumplimientos de cartera. `total: None` a propósito: las 6 filas
    ya suman el 100% entre sí, no hace falta una fila de cierre aparte. `None` si falta alguna
    columna."""
    if columna_fecha not in df.columns or columna_valor not in df.columns:
        return None
    tramos = dias_transcurridos_desde(df[columna_fecha], fecha_referencia).map(_tramo_antiguedad)
    valores = pd.to_numeric(df[columna_valor], errors='coerce')
    sumas_por_tramo = valores.groupby(tramos).sum()
    # Base del porcentaje: lo que de verdad quedó clasificado en algún tramo. `groupby` descarta
    # las filas con clave nula, así que las de fecha inválida no están en `sumas_por_tramo`;
    # usar `valores.sum()` (el total del archivo) las metía en el denominador y solo en el
    # denominador — ver el docstring.
    total_general = float(sumas_por_tramo.sum())
    metas = metas or []

    filas = []
    acumulado = 0.0
    ultimo_indice = len(ETIQUETAS_TRAMOS_ANTIGUEDAD) - 1
    for i, etiqueta_discreta in enumerate(ETIQUETAS_TRAMOS_ANTIGUEDAD):
        etiqueta_fila = ETIQUETAS_TRAMOS_ACUMULADOS[i]
        valor_tramo = float(sumas_por_tramo.get(etiqueta_discreta, 0.0))
        if i == ultimo_indice:
            valor_fila = valor_tramo  # cola ">120 días" sola, no acumulada
        else:
            acumulado += valor_tramo
            valor_fila = acumulado
        porcentaje = round((valor_fila / total_general * 100) if total_general else 0.0, 2)
        meta_entrada = metas[i] if i < len(metas) else None
        meta = evaluar_meta(porcentaje, (meta_entrada or {}).get('meta_min'), (meta_entrada or {}).get('meta_max'))
        filas.append([etiqueta_fila, round(valor_fila, 2), porcentaje, etiqueta_cumplimiento(meta)])

    return {
        'tipo': 'tabla_multi',
        'columnas': ['Tramo', str(columna_valor), '% acumulado', 'Resultado'],
        'filas': filas,
        'total': None,
    }


def generar_datos_concentracion(df, columna_id, columna_valor, top_n):
    """Top-N + "Resto" — agrupa por `columna_id`, suma `columna_valor`, ordena descendente,
    conserva las `top_n` filas de mayor valor y colapsa el resto en una fila `'Resto (N)'` (`N` =
    cantidad de identidades agrupadas ahí, ausente si no sobra nada). Generaliza el algoritmo de
    `aggregations.py::pareto_ciudades`/`top_clientes` (mismo criterio de `%`/`% acumulado` vía
    `cumsum`) de forma agnóstica de esquema — cualquier columna identificadora + cualquier columna
    numérica, no solo cliente/ciudad de cartera. `top_n` no numérico o menor a 1 se trata como
    `1` (de mejor esfuerzo: la validación estricta vive en `dashboard_layout.validar_componentes`,
    esta función nunca debe romper una vista previa en vivo). `None` si falta alguna columna."""
    if columna_id not in df.columns or columna_valor not in df.columns:
        return None
    try:
        top_n = max(1, int(top_n)) if top_n not in (None, '') else 1
    except (TypeError, ValueError):
        top_n = 1

    identidad = df[columna_id].fillna('Sin dato').astype(str)
    valores = pd.to_numeric(df[columna_valor], errors='coerce')
    agrupado = valores.groupby(identidad).sum().sort_values(ascending=False)
    total_general = float(agrupado.sum())

    principales = agrupado.iloc[:top_n]
    resto = agrupado.iloc[top_n:]

    filas = []
    acumulado = 0.0
    for nombre, valor in principales.items():
        valor = float(valor)
        acumulado += valor
        porcentaje = round((valor / total_general * 100) if total_general else 0.0, 2)
        porcentaje_acumulado = round((acumulado / total_general * 100) if total_general else 0.0, 2)
        filas.append([nombre, round(valor, 2), porcentaje, porcentaje_acumulado])

    if len(resto) > 0:
        valor_resto = float(resto.sum())
        porcentaje_resto = round((valor_resto / total_general * 100) if total_general else 0.0, 2)
        filas.append([f'Resto ({len(resto)})', round(valor_resto, 2), porcentaje_resto, 100.0])

    return {
        'tipo': 'tabla_multi',
        'columnas': [str(columna_id), str(columna_valor), '% del total', '% acumulado'],
        'filas': filas,
        'total': ['Total', round(total_general, 2), 100.0, 100.0],
    }


LIMITE_DEUDORES = 6


def generar_datos_antiguedad_por_deudor(df, columna_id, columna_fecha, columna_valor,
                                        cuantos=2, fecha_referencia=None):
    """Antigüedad de cartera de los `cuantos` mayores deudores, uno por bloque.

    Responde una pregunta que ni la concentración ni la antigüedad contestan por separado: la
    concentración dice CUÁNTO debe cada cliente, la antigüedad dice CÓMO está repartida la cartera
    entera — pero para decidir qué hacer con un deudor grande hace falta cruzar las dos. Un cliente
    con el 60% de su saldo en "+120 días" es mora crónica (renegociación o vía legal); otro con el
    mismo saldo concentrado en "30 días" es mora reciente (cobranza inmediata antes de que escale).

    Cada deudor trae SIEMPRE los seis tramos, con 0 en los que no tienen documentos. Un tramo
    vacío es información —dice que ese cliente no tiene mora ahí— y, sobre todo, hace que los
    bloques de dos deudores se lean fila por fila: omitiendo los ceros, uno con mora en todos los
    tramos y otro con mora solo en 30 días quedaban con distinta cantidad de filas y no se podían
    comparar de un vistazo.
    `porcentaje` es sobre el saldo de ESE cliente, no sobre la cartera total — es lo que permite
    comparar dos deudores de tamaños distintos.

    `cuantos` se acota a `LIMITE_DEUDORES`: son bloques que se muestran uno al lado del otro, y más
    de media docena deja de ser legible. `None` si falta alguna columna.
    """
    if any(c not in df.columns for c in (columna_id, columna_fecha, columna_valor)):
        return None
    try:
        cuantos = max(1, min(int(cuantos), LIMITE_DEUDORES)) if cuantos not in (None, '') else 2
    except (TypeError, ValueError):
        cuantos = 2

    identidad = df[columna_id].fillna('Sin dato').astype(str)
    valores = pd.to_numeric(df[columna_valor], errors='coerce')
    total_general = float(valores.sum())
    mayores = valores.groupby(identidad).sum().sort_values(ascending=False).iloc[:cuantos]

    deudores = []
    for nombre, saldo_deudor in mayores.items():
        del_deudor = df[identidad == nombre]
        tramos = generar_datos_tramos_antiguedad(del_deudor, columna_fecha, columna_valor, fecha_referencia)
        valores_tramo = [float(v) for v in tramos['valores']] if tramos else []
        suma_clasificada = sum(valores_tramo)
        filas = [
            [categoria, round(valor, 2), round((valor / suma_clasificada * 100) if suma_clasificada else 0.0, 2)]
            for categoria, valor in zip(tramos['categorias'], valores_tramo)
        ] if tramos else []
        # El tramo más pesado es lo que distingue una mora crónica de una reciente, así que se
        # señala explícitamente en vez de dejar que se deduzca leyendo la columna. Se exige que
        # haya algún saldo: con todos los tramos en cero, `max` devolvería el primero y se
        # destacaría un tramo vacío como si fuera el problema.
        peor = max(filas, key=lambda fila: fila[1]) if any(fila[1] for fila in filas) else None
        deudores.append({
            'nombre': nombre,
            'total': round(float(saldo_deudor), 2),
            'porcentaje_cartera': round((float(saldo_deudor) / total_general * 100) if total_general else 0.0, 2),
            'columnas': ['Tramo', str(columna_valor), '%'],
            'filas': filas,
            'tramo_mayor': peor[0] if peor else None,
        })

    return {'tipo': 'antiguedad_por_deudor', 'deudores': deudores}
