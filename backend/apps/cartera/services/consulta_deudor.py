"""Consulta puntual de un deudor: su antigüedad de cartera y sus documentos.

Responde una pregunta que las secciones del Directorio no contestan: las de concentración y
mayores deudores muestran a los más grandes, pero nadie puede preguntar por UN cliente en
particular ("¿cómo está la cartera de Transexpress?"). Acá se busca por nombre o identificador y
se devuelve su antigüedad por tramos más las filas del archivo donde aparece.

Lee el archivo de la carga vigente en vez de una tabla: los dashboards genéricos —el Directorio
entre ellos— no insertan sus filas en `RegistroCartera` (eso es del dashboard legado de cartera),
así que el Excel guardado es la única fuente.

Ese archivo se cachea en memoria (`_df_de`). Cuando esto se escribió eran ~2.700 filas y una
lectura por consulta no pesaba; hoy el archivo de producción trae 10.374 y cada lectura cuesta
~1,4 s, con el buscador pidiendo sugerencias a medida que se escribe. Sin caché, escribir el
nombre de un cliente disparaba varios segundos de CPU releyendo el mismo archivo.

La antigüedad se calcula con `generic_charts.generar_datos_tramos_antiguedad`, la MISMA función que
alimenta el gráfico del dashboard: si se calculara aparte, el total de un cliente podría no cuadrar
con el tramo al que el gráfico lo asigna. Esa función ya devuelve los seis tramos siempre, con 0 en
los que no tienen filas.
"""

import datetime
import threading
import unicodedata
from collections import OrderedDict

import pandas as pd

from . import carga_archivos, generic_charts
from ..exceptions import CarteraError
from ..models import CargaArchivo

# Cuántas coincidencias devuelve la búsqueda. El buscador es para elegir un cliente, no para
# navegar el padrón entero: con más de esto, lo que hace falta es afinar el texto.
LIMITE_COINCIDENCIAS = 25


def _texto(serie):
    """Serie de texto sin vacíos, sin el `fillna('')` que pandas 2.2 marca como obsoleto sobre
    columnas de tipo objeto (avisa que va a cambiar el tipo resultante en una versión futura)."""
    return serie.where(serie.notna(), '').astype(str)


def _normalizar(texto):
    """Sin acentos, sin espacios de sobra y en minúsculas — para que "PEÑA" encuentre "peña" y
    "Peña" encuentre "PENA", que es como se escriben los nombres en la práctica."""
    crudo = str(texto or '').strip().lower()
    return ''.join(c for c in unicodedata.normalize('NFD', crudo)
                   if unicodedata.category(c) != 'Mn')


def _carga_vigente(dashboard_id):
    carga = (
        CargaArchivo.objects
        .filter(dashboard_id=dashboard_id, estado=CargaArchivo.Estado.PROCESADO)
        .order_by('-fecha_carga')
        .first()
    )
    if not carga:
        raise CarteraError(
            'Este dashboard todavía no tiene un archivo cargado para consultar.',
            codigo='SIN_CARGA_PARA_CONSULTAR',
        )
    return carga


# Archivos ya leídos, por id de carga. La clave es la carga y no el dashboard: al procesar una
# carga nueva cambia el id, así que la entrada vieja deja de usarse sola y no hay que invalidar
# nada a mano. Se guardan pocas entradas porque cada una es el archivo entero en memoria
# (~10.000 filas × 21 columnas, unas decenas de MB).
_CACHE_MAXIMO = 2
_cache_archivos = OrderedDict()
_candado_cache = threading.Lock()


def _df_de(dashboard_id):
    """El archivo de la carga vigente, leído del disco una vez y reutilizado después.

    Devuelve una COPIA. Los cálculos que reciben este dataframe (`generic_charts`) son libres de
    agregarle columnas derivadas, algo que hasta ahora era inofensivo porque cada consulta leía su
    propio archivo; con el original compartido en memoria, esa mutación se filtraría a la consulta
    siguiente. Copiar cuesta milisegundos contra el segundo y medio que cuesta releer el .xlsx.
    """
    carga = _carga_vigente(dashboard_id)
    clave = str(carga.id)

    with _candado_cache:
        cacheado = _cache_archivos.get(clave)
        if cacheado is not None:
            _cache_archivos.move_to_end(clave)
            return cacheado.copy(), carga

    # La lectura queda FUERA del candado: es lo lento, y bloquear acá dejaría a todas las
    # peticiones esperando a la primera. Dos lecturas simultáneas del mismo archivo la primera vez
    # son trabajo repetido, no un error: la segunda simplemente pisa la entrada con lo mismo.
    _, df = carga_archivos.leer_archivo_de_carga(carga)

    with _candado_cache:
        _cache_archivos[clave] = df
        _cache_archivos.move_to_end(clave)
        while len(_cache_archivos) > _CACHE_MAXIMO:
            _cache_archivos.popitem(last=False)
    return df.copy(), carga


def limpiar_cache():
    """Vacía la caché de archivos. Para las pruebas, que crean cargas nuevas con el mismo id de
    dashboard y necesitan que la lectura vuelva a ir al disco."""
    with _candado_cache:
        _cache_archivos.clear()


def _validar_columnas(df, columnas):
    faltantes = [c for c in columnas if c and c not in df.columns]
    if faltantes:
        raise CarteraError(
            'El archivo cargado ya no tiene estas columnas: ' + ', '.join(faltantes) + '.',
            codigo='COLUMNAS_NO_DISPONIBLES',
            detalles={'columnas': faltantes},
        )


def _identidad(df, columna_nombre, columna_ruc):
    """Clave de agrupación: el identificador si lo hay, el nombre si no.

    Misma regla que el resto del proyecto (identificador → nombre): dos filas del mismo RUC son el
    mismo cliente aunque el nombre venga escrito distinto, que pasa seguido con sufijos como
    "S.A." o "CIA. LTDA.".
    """
    nombres = _texto(df[columna_nombre]).str.strip()
    if not columna_ruc or columna_ruc not in df.columns:
        return nombres.replace('', 'Sin dato')
    rucs = _texto(df[columna_ruc]).str.strip()
    return rucs.where(rucs != '', nombres).replace('', 'Sin dato')


def columnas_disponibles(dashboard_id):
    """Las columnas del archivo vigente, para que el panel de configuración ofrezca cuáles mostrar.

    Se resuelve acá y no en el frontend porque las columnas son del ARCHIVO, no del layout: cambian
    cuando se carga uno nuevo, y una lista guardada en la configuración envejecería sin aviso.
    """
    df, carga = _df_de(dashboard_id)
    return {
        'columnas': [str(c) for c in df.columns],
        'archivo': carga.nombre_original,
        'fecha_corte': carga.fecha_corte.isoformat() if carga.fecha_corte else None,
    }


def _discrepancias_de_identidad(df, columna_nombre, columna_ruc):
    """Nombres que aparecen con más de un identificador, e identificadores con más de un nombre.

    Las dos son señales de un padrón sucio y ninguna la detecta el resto del informe, que agrupa
    por identidad y sigue de largo:

    - **Un nombre con varios identificadores**: o son dos empresas que se llaman parecido, o el
      mismo cliente cargado dos veces. Hasta ahora las dos salían en la lista como filas
      idénticas —mismo nombre, sin nada que las distinga— y elegir una era adivinar.
    - **Un identificador con varios nombres**: el saldo se suma bien (la identidad es el RUC),
      pero el nombre que se muestra es el de la primera fila, así que el mismo cliente puede
      aparecer con una razón social distinta según el archivo.

    Devuelve `({nombre: [identificadores]}, {identificador: [nombres]})`, solo con los casos que
    tienen más de uno. Sin columna de identificador no hay nada que comparar —la identidad ES el
    nombre— y ambos salen vacíos.
    """
    if not columna_ruc or columna_ruc not in df.columns:
        return {}, {}

    nombres = _texto(df[columna_nombre]).str.strip()
    identidades = _identidad(df, columna_nombre, columna_ruc).astype(str)
    pares = pd.DataFrame({'nombre': nombres, 'identidad': identidades})
    # Una fila sin nombre no es una discrepancia, es un dato faltante: mezclarlas haría que todos
    # los vacíos parecieran el mismo cliente con veinte identificadores.
    pares = pares[(pares['nombre'] != '') & (pares['identidad'] != '')]

    por_nombre = pares.groupby('nombre')['identidad'].unique()
    por_identidad = pares.groupby('identidad')['nombre'].unique()
    return (
        {n: sorted(map(str, v)) for n, v in por_nombre.items() if len(v) > 1},
        {i: sorted(map(str, v)) for i, v in por_identidad.items() if len(v) > 1},
    )


def buscar(dashboard_id, texto, columna_nombre, columna_valor, columna_ruc=None):
    """Clientes cuyo nombre o identificador contiene `texto`, con su saldo y cuántas filas tienen.

    Devuelve coincidencias para que la interfaz deje ELEGIR una, en vez de sumar a ciegas todo lo
    que coincida: "transex" puede tocar a dos razones sociales distintas, y sumarlas daría un total
    que no le corresponde a ninguna.
    """
    texto_normalizado = _normalizar(texto)
    if len(texto_normalizado) < 2:
        raise CarteraError('Escribí al menos dos caracteres para buscar.', codigo='BUSQUEDA_MUY_CORTA')

    df, _ = _df_de(dashboard_id)
    _validar_columnas(df, [columna_nombre, columna_valor])

    nombres = _texto(df[columna_nombre])
    rucs = _texto(df[columna_ruc]) if columna_ruc and columna_ruc in df.columns else None

    coincide = nombres.map(lambda v: texto_normalizado in _normalizar(v))
    if rucs is not None:
        coincide = coincide | rucs.map(lambda v: texto_normalizado in _normalizar(v))

    encontrados = df[coincide]
    if encontrados.empty:
        return {'coincidencias': [], 'total': 0}

    identidad = _identidad(encontrados, columna_nombre, columna_ruc)
    valores = pd.to_numeric(encontrados[columna_valor], errors='coerce').fillna(0)

    agrupado = (
        pd.DataFrame({
            'identidad': identidad,
            'nombre': _texto(encontrados[columna_nombre]),
            'valor': valores,
        })
        .groupby('identidad', as_index=False)
        .agg(nombre=('nombre', 'first'), saldo=('valor', 'sum'), filas=('valor', 'size'))
        .sort_values('saldo', ascending=False)
    )

    # Se calculan sobre el archivo ENTERO, no sobre lo encontrado: un nombre repartido en dos
    # identificadores puede tener solo uno de los dos coincidiendo con lo que se escribió, y aun
    # así hay que avisar.
    nombres_repetidos, identidades_repetidas = _discrepancias_de_identidad(df, columna_nombre, columna_ruc)

    coincidencias = [
        {
            'identidad': str(fila.identidad),
            'nombre': str(fila.nombre),
            'saldo': round(float(fila.saldo), 2),
            'filas': int(fila.filas),
            # Qué mirar en cada una: el nombre está repartido en varios identificadores, o este
            # identificador viene con varios nombres.
            'otros_identificadores': [
                i for i in nombres_repetidos.get(str(fila.nombre).strip(), [])
                if i != str(fila.identidad)
            ],
            'otros_nombres': [
                n for n in identidades_repetidas.get(str(fila.identidad), [])
                if n != str(fila.nombre).strip()
            ],
        }
        for fila in agrupado.head(LIMITE_COINCIDENCIAS).itertuples()
    ]
    return {'coincidencias': coincidencias, 'total': int(len(agrupado))}


def detalle(dashboard_id, identidad, columna_nombre, columna_fecha, columna_valor,
            columna_ruc=None, columnas_detalle=None):
    """Antigüedad por tramos y filas del archivo para un cliente puntual.

    `columnas_detalle` acota qué columnas devuelve el detalle; sin eso viajarían las 28 del archivo
    en cada consulta. Las que no existan en el archivo se ignoran en vez de fallar: el mapeo de
    columnas se puede haber guardado con un archivo anterior.
    """
    df, carga = _df_de(dashboard_id)
    _validar_columnas(df, [columna_nombre, columna_fecha, columna_valor])

    identidades = _identidad(df, columna_nombre, columna_ruc)
    del_deudor = df[identidades.astype(str) == str(identidad)]
    if del_deudor.empty:
        raise CarteraError(
            'No se encontraron filas para ese cliente en el archivo vigente.',
            codigo='DEUDOR_SIN_FILAS',
        )

    tramos = generic_charts.generar_datos_tramos_antiguedad(
        del_deudor, columna_fecha, columna_valor, fecha_referencia=carga.fecha_corte,
    )

    valores = pd.to_numeric(del_deudor[columna_valor], errors='coerce').fillna(0)
    total = float(valores.sum())

    disponibles = [str(c) for c in df.columns]
    elegidas = [c for c in (columnas_detalle or disponibles) if c in df.columns]
    if not elegidas:
        elegidas = disponibles

    # `where(notna)` deja los vacíos como None: sin eso viajan como el texto "nan" y la tabla los
    # muestra tal cual.
    filas = del_deudor[elegidas].astype(object).where(pd.notna(del_deudor[elegidas]), None)

    nombres_repetidos, identidades_repetidas = _discrepancias_de_identidad(df, columna_nombre, columna_ruc)
    nombre = str(_texto(del_deudor[columna_nombre]).iloc[0]).strip()

    return {
        'identidad': str(identidad),
        'nombre': nombre,
        # Las mismas dos señales que marca la búsqueda, ya resueltas para este cliente: con qué
        # otros identificadores aparece su nombre, y con qué otros nombres aparece su
        # identificador. Vacías cuando no hay nada que advertir.
        'otros_identificadores': [i for i in nombres_repetidos.get(nombre, []) if i != str(identidad)],
        'otros_nombres': [n for n in identidades_repetidas.get(str(identidad), []) if n != nombre],
        'total': round(total, 2),
        'cantidad_filas': int(len(del_deudor)),
        'fecha_corte': carga.fecha_corte.isoformat() if carga.fecha_corte else None,
        'tramos': {
            'categorias': tramos['categorias'] if tramos else [],
            'valores': tramos['valores'] if tramos else [],
        },
        'columnas_disponibles': disponibles,
        'columnas': elegidas,
        'filas': [
            [_valor_serializable(v) for v in fila]
            for fila in filas.itertuples(index=False, name=None)
        ],
    }


def _valor_serializable(valor):
    """Fechas a ISO y numpy a tipos nativos — el resto, tal cual. Lo que va por JSON tiene que ser
    JSON, y del Excel salen `Timestamp`, `datetime` y `int64`, que el serializador no convierte.

    `datetime` se comprueba además de `Timestamp` porque el lector devuelve uno u otro según cómo
    venga la columna en el archivo; con solo `Timestamp`, las fechas de algunas columnas llegaban
    al frontend como el `repr` de Python.
    """
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return None
    if isinstance(valor, (pd.Timestamp, datetime.datetime, datetime.date)):
        return valor.date().isoformat() if hasattr(valor, 'date') else valor.isoformat()
    if hasattr(valor, 'item'):  # numpy
        return valor.item()
    return valor
