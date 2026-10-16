"""Descarga del archivo que alimenta un dashboard, tal como vino de su origen.

Responde una pregunta que el dashboard no contesta: "¿y las filas?". Las secciones muestran
agregados —totales por tramo, top de clientes, cumplimiento de metas— y la consulta por cliente
muestra las filas de UNO. Esto entrega el conjunto completo, con todas sus columnas, para
revisarlo aparte o cruzarlo con otra cosa.

Lo que se descarga es la CARGA VIGENTE, no una ejecución nueva del procedimiento: es exactamente
el mismo conjunto de datos que el dashboard está mostrando en ese momento. Volver a ejecutar el
origen daría un archivo que podría no coincidir con las cifras de la pantalla —y encima golpearía
la base productiva con cada descarga—, así que las dos cosas serían peores.

Se regenera el .xlsx en vez de servir el archivo guardado tal cual, por el saneo anti-inyección
de fórmulas (`export_service`): un valor que empiece con `=` o `+` viene de una base que este
proyecto no controla, y abierto en Excel se ejecutaría como fórmula.
"""

import datetime

import pandas as pd

from ..exceptions import CarteraError
from ..models import CargaArchivo, Dashboard
from . import carga_archivos, db_source, export_service

HOJA = 'Datos'


def _carga_vigente(dashboard_id):
    carga = (
        CargaArchivo.objects
        .filter(dashboard_id=dashboard_id, estado=CargaArchivo.Estado.PROCESADO)
        .order_by('-fecha_carga')
        .first()
    )
    if carga is None:
        raise CarteraError(
            'Este dashboard todavía no tiene datos cargados para descargar.',
            codigo='SIN_DATOS_PARA_DESCARGAR',
        )
    return carga


def _valor_para_excel(valor):
    """Las fechas se escriben como fecha; el resto, tal cual.

    `openpyxl` no sabe escribir un `Timestamp` de pandas ni un `NaT`, y un `NaN` aparecería como
    "nan" en la celda en vez de quedar vacía.
    """
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return ''
    if isinstance(valor, pd.Timestamp):
        return '' if pd.isna(valor) else valor.to_pydatetime()
    if isinstance(valor, (datetime.datetime, datetime.date)):
        return valor
    if hasattr(valor, 'item'):  # numpy int64/float64/bool_
        return valor.item()
    return valor


def excel_de_la_carga_vigente(dashboard_id):
    """`(buffer, nombre_archivo)` con todas las filas y columnas del origen.

    El nombre lleva el dashboard y la fecha de corte para que dos descargas de cortes distintos
    no se pisen en la carpeta de descargas.
    """
    carga = _carga_vigente(dashboard_id)
    _ruta, df = carga_archivos.leer_archivo_de_carga(carga)

    dashboard = Dashboard.objects.filter(dashboard_id=dashboard_id).first()
    if dashboard is not None and dashboard.fuente_bd_ultimo_aliases:
        # Con los nombres de columna que se ven en el dashboard, no los del origen: quien descarga
        # está mirando la pantalla, y una columna que ahí se llama "Saldo Total" no debería
        # aparecer en el archivo con otro nombre.
        df = db_source.aplicar_alias_columnas(df, dashboard.fuente_bd_ultimo_aliases)

    columnas = [(str(c), str(c)) for c in df.columns]
    filas = [
        {str(columna): _valor_para_excel(valor) for columna, valor in registro.items()}
        for registro in df.to_dict(orient='records')
    ]
    buffer = export_service.generar_excel(filas, columnas, nombre_hoja=HOJA)

    nombre_dashboard = (dashboard.name if dashboard else dashboard_id).strip()
    corte = carga.fecha_corte.isoformat() if carga.fecha_corte else 'sin-corte'
    return buffer, f'{nombre_dashboard} - datos {corte}.xlsx'
