"""Histórico de archivos cargados (sección 28): persiste, de cada archivo aplicado a la plantilla
(`AplicarMapeoPlantillaView`), únicamente las columnas que el usuario marcó como "históricas" en el
paso "Renombrar columnas" (`ColumnaHistorica`, configuración persistente por dashboard — se
reconocen solas en la próxima carga) — para poder armar tablas históricas comparando varias cargas
del mismo dashboard a través del tiempo, sin depender de que el archivo físico original siga
existiendo en disco. A diferencia del dominio clásico de cartera (`RegistroCartera`, esquema fijo),
este módulo no asume ninguna columna en particular: trabaja sobre el mismo `DataFrame` genérico que
ya usa `services/plantilla.py`. Además de qué COLUMNAS comparar (`ColumnaHistorica`), cada carga
puede habilitarse/deshabilitarse individualmente para el cálculo (`CargaArchivo.incluir_en_historico`,
`establecer_carga_incluida_en_historico`) — ambos flags son independientes: uno decide qué columnas
se persisten y comparan, el otro qué cargas cuentan.
"""

import pandas as pd
from django.conf import settings

from ..models import CargaArchivo, ColumnaHistorica, FilaArchivoHistorico
from . import generic_charts


def guardar_filas_historicas(carga, df, columnas_historicas):
    """Reemplaza las filas históricas de `carga` por las de `df`, pero **solo para las columnas en
    `columnas_historicas`** (nombres ya renombrados por alias, ver `ColumnaHistorica`) — de acá en
    adelante ya no se persiste la fila completa, sino únicamente lo que el usuario marcó como
    histórico en el paso "Renombrar columnas". Una columna marcada que ya no existe en `df` se
    ignora sin romper; si no queda ninguna columna válida, no se crea ninguna fila (pero sí se
    borran las anteriores de esta carga — mismo criterio idempotente que
    `services/ingest.py::procesar_dataframe` para `RegistroCartera`: reaplicar el mismo mapeo sobre
    la misma carga no duplica ni deja basura vieja). Convierte cada celda a JSON-seguro con el
    mismo criterio ya usado en `services/ingest.py::_valor_crudo` (NaN/NaT/None → `None`) —
    `DataFrame.where(...)` no sirve para esto: en una columna float, pandas puede dejar el NaN sin
    reemplazar en vez de escribir `None`, lo que después rompe la restricción CHECK de JSON válido
    en SQL Server."""
    FilaArchivoHistorico.objects.filter(carga=carga).delete()

    columnas_presentes = [c for c in columnas_historicas if c in df.columns]
    if not columnas_presentes:
        return

    registros = df[columnas_presentes].to_dict(orient='records')
    objetos = [
        FilaArchivoHistorico(
            carga=carga, orden=indice,
            datos={columna: (None if pd.isna(valor) else valor) for columna, valor in fila.items()},
        )
        for indice, fila in enumerate(registros)
    ]
    FilaArchivoHistorico.objects.bulk_create(objetos, batch_size=settings.CARTERA_BULK_BATCH_SIZE)


def columnas_historicas_configuradas(dashboard_id):
    """Las columnas que el usuario ya marcó como históricas para este dashboard en una carga
    anterior (`ColumnaHistorica`) — se usa para reconocerlas solas (pre-tildadas) en la próxima
    carga, y para que Tabla 3 sepa qué comparar sin que el usuario tenga que elegir nada
    en el paso de Mapeo."""
    return list(ColumnaHistorica.objects.filter(dashboard_id=dashboard_id).values_list('columna', flat=True))


def establecer_columnas_historicas(dashboard_id, columnas):
    """Reemplaza por completo la configuración de columnas históricas de este dashboard — lo que
    se manda ahora ES la nueva configuración (no se acumula), así desmarcar una columna la saca de
    verdad. Se llama junto con `guardar_filas_historicas` al aplicar el mapeo
    (`AplicarMapeoPlantillaView`)."""
    ColumnaHistorica.objects.filter(dashboard_id=dashboard_id).delete()
    nombres = list(dict.fromkeys(str(c).strip() for c in (columnas or []) if str(c or '').strip()))
    empresa_id = ColumnaHistorica.empresa_de(dashboard_id)
    ColumnaHistorica.objects.bulk_create([
        ColumnaHistorica(dashboard_id=dashboard_id, columna=nombre, empresa_id=empresa_id) for nombre in nombres
    ])


def listar_cargas_historicas(dashboard_id):
    """Las cargas de `dashboard_id` que sí tienen filas históricas (las que llegaron a aplicarse a
    la plantilla), de más antigua a más nueva, junto con las columnas disponibles para comparar.
    `columnas_disponibles` son las columnas marcadas como históricas para este dashboard
    (`columnas_historicas_configuradas`) — no lo que efectivamente haya guardado cada carga: las
    cargas de antes de esta configuración persisten la fila completa (ver `guardar_filas_historicas`)
    y esas columnas extra no le sirven al usuario para comparar, solo las que marcó a propósito.
    Incluye `incluir_en_historico` por carga (ver `CargaArchivo.incluir_en_historico`) para que el
    frontend refleje el estado real del checkbox de "Histórico de cargas", tanto las habilitadas
    como las deshabilitadas — a diferencia de `calcular_tabla_historica`, que sin `carga_ids`
    excluye directamente las deshabilitadas."""
    cargas = list(
        CargaArchivo.objects.filter(dashboard_id=dashboard_id, filas_historicas__isnull=False)
        .distinct().order_by('fecha_carga'),
    )

    return {
        'cargas': [
            {
                'carga_id': str(carga.id),
                'nombre_original': carga.nombre_original,
                'fecha_carga': carga.fecha_carga.isoformat(),
                'fecha_corte': carga.fecha_corte.isoformat() if carga.fecha_corte else None,
                'total_filas': FilaArchivoHistorico.objects.filter(carga=carga).count(),
                'incluir_en_historico': carga.incluir_en_historico,
            }
            for carga in cargas
        ],
        'columnas_disponibles': columnas_historicas_configuradas(dashboard_id),
    }


def establecer_carga_incluida_en_historico(carga, incluida):
    """Marca/desmarca una carga puntual para que cuente (o no) en `calcular_tabla_historica` de su
    dashboard — Tabla 3 dentro del dashboard y "Histórico de cargas" respetan este mismo flag, así
    que desmarcar una carga acá la excluye de ambos lugares por igual. No borra
    `FilaArchivoHistorico`: los datos siguen guardados, solo se excluyen del cálculo mientras esté
    deshabilitada, así se puede volver a habilitar sin perder nada."""
    carga.incluir_en_historico = bool(incluida)
    carga.save(update_fields=['incluir_en_historico'])
    return carga


def obtener_filas_archivo(carga):
    """Todas las columnas y filas guardadas de UNA carga puntual, tal como se persistieron al
    aplicar el mapeo (sección 29) — a diferencia de `calcular_tabla_historica`, sin agregar nada:
    cada fila del archivo original tal cual, para poder ver el archivo completo (todas las
    columnas, todas las filas) sin necesitar el archivo físico ni descargarlo. Misma forma
    `{columnas, filas}` que ya entiende `GenericDataTable` en el frontend."""
    filas_historicas = list(FilaArchivoHistorico.objects.filter(carga=carga).order_by('orden'))
    if not filas_historicas:
        return {'columnas': [], 'filas': []}

    columnas = list(filas_historicas[0].datos.keys())
    filas = [[fila.datos.get(columna) for columna in columnas] for fila in filas_historicas]
    return {'columnas': columnas, 'filas': filas}


def calcular_tabla_historica(dashboard_id, columnas_valor, carga_ids=None):
    """Una fila por carga (ordenadas de más antigua a más nueva), con el valor de cada columna
    pedida agregado con el tipo de cálculo elegido para ESA columna (suma/promedio/conteo de
    valores únicos/valor de celda — mismo criterio y misma función, `generic_charts.valor_agregado`,
    que ya usa `generar_datos_tabla` dentro de un solo archivo, ahora aplicada a través de varias
    cargas). Devuelve directamente la forma `{columnas, filas}` que ya entiende `GenericDataTable`
    en el frontend (identidad = archivo/usuario que lo subió/fecha de carga/fecha de corte, luego
    una columna por cada entrada de `columnas_valor`) — "Archivo" va primero porque siempre tiene un
    valor (a diferencia de "Fecha de corte", opcional): es la columna que el frontend usa como
    identidad de la fila para el párrafo de "Hallazgos clave" ("X tiene el mayor valor de..."),
    así que no puede quedar vacía. Sin fila de `total`: sumar un "promedio por carga" entre cargas
    sería engañoso.

    Sin `carga_ids`, solo entran las cargas con `incluir_en_historico=True` — es el caso de Tabla 3
    dentro del dashboard (`TablaHistoricaAutomatica.jsx`, nunca manda `carga_ids`) y de "Generar
    tabla histórica" en "Histórico de cargas", que ya no arma esa lista a mano: el checkbox por
    carga de esa pantalla persiste el mismo flag (`establecer_carga_incluida_en_historico`) en vez
    de armar una selección efímera. Pasar `carga_ids` explícito sigue siendo una selección puntual
    que puede incluir una carga deshabilitada — la usan los tests y queda disponible para casos
    futuros que necesiten esa precisión."""
    # Las entradas sin columna elegida (el usuario agregó la fila en la UI y todavía no eligió
    # cuál) se descartan por completo, encabezado Y celda. Antes se filtraban solo del encabezado
    # pero igual aportaban un `None` por fila, así que `columnas` y `filas` quedaban con distinto
    # largo (4 encabezados contra 5 celdas) y la tabla se renderizaba desalineada.
    entradas = [
        e for e in (generic_charts.normalizar_columna_valor_tabla(c) for c in (columnas_valor or []))
        if e['columna']
    ]
    nombres_columna = [e['columna'] for e in entradas]

    cargas_qs = (
        CargaArchivo.objects.filter(dashboard_id=dashboard_id, filas_historicas__isnull=False)
        .distinct().select_related('subido_por')
    )
    if carga_ids:
        cargas_qs = cargas_qs.filter(id__in=carga_ids)
    else:
        cargas_qs = cargas_qs.filter(incluir_en_historico=True)
    cargas = list(cargas_qs.order_by('fecha_carga'))

    # Una sola consulta para TODAS las cargas, agrupada en memoria por `carga_id`: antes se hacía
    # una consulta por carga dentro del bucle, así que el costo crecía con el histórico (un
    # dashboard con dos años de cargas mensuales eran 24 consultas para armar una tabla).
    filas_por_carga = {}
    for carga_id, datos in (
        FilaArchivoHistorico.objects
        .filter(carga__in=cargas)
        .order_by('carga_id', 'orden')
        .values_list('carga_id', 'datos')
    ):
        filas_por_carga.setdefault(carga_id, []).append(datos)

    columnas = ['Archivo', 'Usuario', 'Fecha de carga', 'Fecha de corte'] + nombres_columna
    filas = []
    for carga in cargas:
        valores_por_fila = filas_por_carga.get(carga.id, [])
        fila = [
            carga.nombre_original,
            carga.subido_por.username if carga.subido_por else 'Desconocido',
            carga.fecha_carga.date().isoformat(),
            carga.fecha_corte.isoformat() if carga.fecha_corte else '',
        ]
        for entrada in entradas:
            serie = pd.Series([datos.get(entrada['columna']) for datos in valores_por_fila])
            valor = generic_charts.valor_agregado(serie, entrada['tipo_agregacion'])
            if not pd.notna(valor):
                fila.append(None)
            elif entrada['tipo_agregacion'] == 'valor_celda':
                fila.append(valor)
            else:
                fila.append(round(float(valor), 2))
        filas.append(fila)

    return {'columnas': columnas, 'filas': filas}


def calcular_kpi_historico(dashboard_id, columna_valor, tipo_agregacion='suma', carga_ids=None):
    """Valor de `columna_valor` agregado (mismo `tipo_agregacion` que un KPI normal) sobre la
    carga histórica MÁS RECIENTE incluida — no todas: a diferencia de una Tabla histórica (una
    fila por carga, cada una comparable por separado), un KPI es un único número, y sumar/
    promediar entre cargas sería engañoso (cada carga es una foto completa del archivo en ese
    momento, no un período aparte que se puede acumular con el siguiente). Reusa
    `calcular_tabla_historica` con una sola columna y toma su última fila (ya viene ordenada de
    más antigua a más nueva). `None` si no hay ninguna carga histórica con esa columna."""
    tabla = calcular_tabla_historica(dashboard_id, [{'columna': columna_valor, 'tipo_agregacion': tipo_agregacion}], carga_ids)
    if not tabla['filas']:
        return None
    return tabla['filas'][-1][-1]


def calcular_categorico_historico(dashboard_id, columna_valor, tipo_agregacion='suma', carga_ids=None):
    """`{categorias, valores}` — una categoría por carga incluida (su nombre de archivo), con
    `columna_valor` agregada dentro de esa carga. Mismo cálculo que `calcular_tabla_historica`
    con una sola columna, solo que reacomodado a la forma que espera un Gráfico de una columna
    (`GenericChartRenderer`) en vez de una tabla. `None` si no hay ninguna carga histórica con esa
    columna."""
    tabla = calcular_tabla_historica(dashboard_id, [{'columna': columna_valor, 'tipo_agregacion': tipo_agregacion}], carga_ids)
    if not tabla['filas']:
        return None
    return {
        'categorias': [fila[0] for fila in tabla['filas']],
        'valores': [fila[-1] for fila in tabla['filas']],
    }


def calcular_multivalor_historico(dashboard_id, columnas_valor, carga_ids=None):
    """`{categorias, series}` — igual concepto que `calcular_tabla_historica` (una categoría por
    carga incluida) pero pivotado a series: una serie por cada columna de `columnas_valor`
    (siempre agregada con "suma", mismo criterio que un `multivalor` normal —
    `generic_charts.generar_datos_multivalor` tampoco deja elegir otro tipo de cálculo por
    columna), en vez de una columna de tabla por cada una. `None` si `columnas_valor` no trae
    ninguna columna elegida, o si no hay ninguna carga histórica."""
    entradas = [generic_charts.normalizar_columna_valor_tabla(c) for c in (columnas_valor or [])]
    nombres = [e['columna'] for e in entradas if e['columna']]
    if not nombres:
        return None
    tabla = calcular_tabla_historica(dashboard_id, [{'columna': n, 'tipo_agregacion': 'suma'} for n in nombres], carga_ids)
    if not tabla['filas']:
        return None
    categorias = [fila[0] for fila in tabla['filas']]
    series = [
        {'nombre': nombre, 'valores': [fila[4 + i] for fila in tabla['filas']]}
        for i, nombre in enumerate(nombres)
    ]
    return {'categorias': categorias, 'series': series}


def calcular_multiserie_historico(dashboard_id, columna_valor, columna_serie, tipo_agregacion='suma', carga_ids=None):
    """`{categorias, series}` — a diferencia de `calcular_multivalor_historico` (una serie por
    COLUMNA elegida), acá hay una sola columna de valor pero se abre en una serie por cada valor
    DISTINTO de `columna_serie` dentro de cada carga (mismo concepto que un `multiserie` normal:
    categoría + serie + valor, salvo que la "categoría" pasa a ser la propia carga). Ambas columnas
    deben estar marcadas como históricas — si `columna_serie` no lo está, ninguna carga tiene datos
    para agrupar y el resultado queda vacío. A diferencia del resto de funciones de este módulo, acá
    hace falta leer la fila completa de cada carga (`FilaArchivoHistorico`, no solo una columna) para
    poder agrupar por `columna_serie` — no hay forma de resolverlo reusando `calcular_tabla_historica`.
    `None` si no hay ninguna carga histórica con ambas columnas."""
    cargas_qs = (
        CargaArchivo.objects.filter(dashboard_id=dashboard_id, filas_historicas__isnull=False).distinct()
    )
    if carga_ids:
        cargas_qs = cargas_qs.filter(id__in=carga_ids)
    else:
        cargas_qs = cargas_qs.filter(incluir_en_historico=True)
    cargas = list(cargas_qs.order_by('fecha_carga'))
    if not cargas:
        return None

    # Un gráfico dibuja números: `valor_celda` devuelve el texto de la celda, que no se puede
    # graficar y hacía reventar el `float(...)` de más abajo con
    # `ValueError: could not convert string to float`, propagado como un 500 al aplicar el mapeo.
    # Se cae a "suma", que es además lo que hace SIEMPRE el multiserie no histórico
    # (`generic_charts.generar_datos_multiserie` ni siquiera acepta un tipo de agregación) — mismo
    # criterio de "valor inválido cae al de por defecto" que ya usan el operador de filtro por días
    # y el `tipo_agregacion` ausente de un KPI.
    if tipo_agregacion == 'valor_celda':
        tipo_agregacion = 'suma'

    categorias = []
    valores_por_carga = []
    nombres_serie = []
    for carga in cargas:
        registros = list(FilaArchivoHistorico.objects.filter(carga=carga).order_by('orden').values_list('datos', flat=True))
        df = pd.DataFrame(registros)
        if columna_valor not in df.columns or columna_serie not in df.columns:
            continue
        categorias.append(carga.nombre_original)
        agregados = {}
        for valor_serie, grupo in df.groupby(columna_serie, dropna=False):
            valor = generic_charts.valor_agregado(grupo[columna_valor], tipo_agregacion)
            nombre = str(valor_serie) if pd.notna(valor_serie) else 'Sin dato'
            agregados[nombre] = None if not pd.notna(valor) else round(float(valor), 2)
            if nombre not in nombres_serie:
                nombres_serie.append(nombre)
        valores_por_carga.append(agregados)

    if not categorias:
        return None

    # Mismo tope de series que el multiserie no histórico (`MAX_SERIES_EN_GRAFICA`), con el resto
    # colapsado en 'Otras'. Sin tope, una columna de serie de alta cardinalidad devolvía una serie
    # por cada valor distinto — 40 en el sondeo — con la leyenda inutilizable y una respuesta
    # pesada, mientras el gráfico equivalente sobre el archivo actual cortaba en 6.
    totales = {
        nombre: sum(a.get(nombre) or 0 for a in valores_por_carga)
        for nombre in nombres_serie
    }
    principales = sorted(nombres_serie, key=lambda n: totales[n], reverse=True)[:generic_charts.MAX_SERIES_EN_GRAFICA]
    # Se respeta el orden de aparición original entre las que sobreviven, no el orden por total.
    incluidas = [n for n in nombres_serie if n in set(principales)]
    resto = [n for n in nombres_serie if n not in set(principales)]

    series = [
        {'nombre': nombre, 'valores': [agregados.get(nombre) for agregados in valores_por_carga]}
        for nombre in incluidas
    ]
    if resto:
        series.append({
            'nombre': 'Otras',
            'valores': [
                round(sum(agregados.get(n) or 0 for n in resto), 2)
                for agregados in valores_por_carga
            ],
        })
    return {'categorias': categorias, 'series': series}
