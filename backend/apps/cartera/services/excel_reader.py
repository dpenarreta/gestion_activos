"""Lectura y validación estructural del archivo Excel (secciones 3 y 14)."""

import io
import os
import zipfile

import pandas as pd

from ..exceptions import CarteraError

EXTENSIONES_PERMITIDAS = {'.xlsx', '.xls'}
FIRMA_ZIP = b'PK\x03\x04'
FIRMA_OLE2 = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'


def validar_extension_y_firma(nombre_archivo, contenido):
    _, extension = os.path.splitext(nombre_archivo.lower())
    if extension not in EXTENSIONES_PERMITIDAS:
        raise CarteraError(
            f'Extensión "{extension}" no permitida. Solo se aceptan archivos .xlsx y .xls.',
            codigo='EXTENSION_NO_PERMITIDA',
        )

    cabecera = contenido[:8]
    if extension == '.xlsx':
        if cabecera[:4] != FIRMA_ZIP:
            if cabecera == FIRMA_OLE2:
                raise CarteraError(
                    'El archivo parece estar protegido con contraseña o dañado '
                    '(no se pudo leer su contenido como .xlsx válido).',
                    codigo='ARCHIVO_PROTEGIDO_O_CORRUPTO',
                )
            raise CarteraError('El archivo está corrupto o no es un Excel .xlsx válido.', codigo='ARCHIVO_CORRUPTO')
        _rechazar_macros(contenido)
    elif extension == '.xls':
        if cabecera != FIRMA_OLE2:
            raise CarteraError('El archivo está corrupto o no es un Excel .xls válido.', codigo='ARCHIVO_CORRUPTO')


def _rechazar_macros(contenido):
    try:
        with zipfile.ZipFile(io.BytesIO(contenido)) as z:
            nombres = z.namelist()
    except zipfile.BadZipFile:
        raise CarteraError('El archivo está corrupto o no es un Excel .xlsx válido.', codigo='ARCHIVO_CORRUPTO')

    if any('vbaproject' in n.lower() for n in nombres):
        raise CarteraError(
            'El archivo contiene macros (VBA). Por seguridad no se procesan archivos con macros.',
            codigo='MACRO_NO_PERMITIDA',
        )


def _engine_para(path):
    return 'openpyxl' if path.lower().endswith('.xlsx') else 'xlrd'


def listar_hojas(path):
    try:
        libro = pd.ExcelFile(path, engine=_engine_para(path))
    except Exception as exc:  # noqa: BLE001 - cualquier fallo de parseo es un archivo inválido
        raise CarteraError(f'No se pudo abrir el archivo: {exc}', codigo='ARCHIVO_CORRUPTO')
    hojas = list(libro.sheet_names)
    if not hojas:
        raise CarteraError('El archivo no contiene hojas.', codigo='ARCHIVO_SIN_HOJAS')
    return hojas


def leer_hoja(path, hoja):
    """Lee la hoja completa como DataFrame, con encabezados normalizados (strip)."""
    try:
        df = pd.read_excel(path, sheet_name=hoja, engine=_engine_para(path), dtype=object)
    except ValueError as exc:
        raise CarteraError(f'No se pudo leer la hoja "{hoja}": {exc}', codigo='HOJA_INVALIDA')

    if df.shape[1] == 0:
        raise CarteraError(f'La hoja "{hoja}" está vacía.', codigo='HOJA_VACIA')

    columnas_originales = list(df.columns)
    columnas_limpias = [str(c).strip() for c in columnas_originales]

    duplicados = {c for c in columnas_limpias if columnas_limpias.count(c) > 1}
    if duplicados:
        raise CarteraError(
            f'El archivo tiene encabezados duplicados: {", ".join(sorted(duplicados))}.',
            codigo='ENCABEZADOS_DUPLICADOS',
        )

    df.columns = columnas_limpias
    if df.dropna(how='all').shape[0] == 0:
        raise CarteraError(f'La hoja "{hoja}" no contiene datos.', codigo='HOJA_VACIA')

    return df


def preview_hoja(df, filas=20):
    preview = df.head(filas).where(pd.notna(df.head(filas)), None)
    return preview.to_dict(orient='records')
