"""Orquesta la construcción de registros de cartera a partir del DataFrame y el mapeo confirmado.

Aplica limpieza/normalización (sección 6), calcula advertencias por fila y descarta únicamente
las filas completamente vacías o con saldo no convertible a número (sección 14).
"""

import pandas as pd

from ..utils.dates import parse_fecha
from ..utils.normalization import (
    normalize_causal,
    normalize_ciudad,
    normalize_cliente_key,
    normalize_recuperador,
    normalize_text,
)
from . import validators

CAMPOS_FECHA = {'fecha_emision', 'fecha_vencimiento', 'fecha_compromiso_pago'}
CAMPOS_ENTERO = {'dias_credito'}


def _valor_crudo(row, mapeo, campo):
    columna = mapeo.get(campo)
    if not columna:
        return None
    valor = row.get(columna)
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return None
    return valor


def _texto_desde_celda(valor):
    if valor is None:
        return ''
    if isinstance(valor, float):
        if pd.isna(valor):
            return ''
        if valor.is_integer():
            return str(int(valor))
        return repr(valor)
    if isinstance(valor, int):
        return str(valor)
    return normalize_text(valor)


def procesar_dataframe(df, mapeo, fecha_corte):
    registros = []
    descartados = []
    advertencias_totales = []
    filas_con_advertencia = 0

    columnas_mapeadas = [c for c in mapeo.values() if c]

    for idx, row in df.iterrows():
        numero_fila_excel = idx + 2  # +1 por índice base 0, +1 por la fila de encabezado

        valores_para_vacio = [row.get(c) for c in columnas_mapeadas]
        if validators.fila_esta_vacia(valores_para_vacio):
            descartados.append({'fila': numero_fila_excel, 'motivo': 'Fila completamente vacía.'})
            continue

        saldo_crudo = _valor_crudo(row, mapeo, 'saldo')
        saldo = validators.parsear_saldo(saldo_crudo)
        if saldo is None:
            descartados.append({
                'fila': numero_fila_excel,
                'motivo': f'Saldo no numérico: "{saldo_crudo}".',
            })
            continue

        fecha_vencimiento_cruda = _valor_crudo(row, mapeo, 'fecha_vencimiento')
        fecha_emision_cruda = _valor_crudo(row, mapeo, 'fecha_emision')
        fecha_compromiso_cruda = _valor_crudo(row, mapeo, 'fecha_compromiso_pago')

        fecha_vencimiento = parse_fecha(fecha_vencimiento_cruda)
        fecha_emision = parse_fecha(fecha_emision_cruda)
        fecha_compromiso_pago = parse_fecha(fecha_compromiso_cruda)

        advertencias = validators.advertencias_de_fila(
            fecha_emision=fecha_emision,
            fecha_vencimiento=fecha_vencimiento,
            fecha_compromiso_pago=fecha_compromiso_pago,
            saldo=saldo,
            fecha_corte=fecha_corte,
            fecha_vencimiento_bruta_invalida=bool(fecha_vencimiento_cruda) and fecha_vencimiento is None,
            fecha_emision_bruta_invalida=bool(fecha_emision_cruda) and fecha_emision is None,
        )
        if advertencias:
            filas_con_advertencia += 1
            for codigo in advertencias:
                advertencias_totales.append({'fila': numero_fila_excel, 'codigo': codigo,
                                              'mensaje': validators.MENSAJES_ADVERTENCIA.get(codigo, codigo)})

        cliente = _texto_desde_celda(_valor_crudo(row, mapeo, 'cliente'))
        ruc_cliente = _texto_desde_celda(_valor_crudo(row, mapeo, 'ruc_cliente'))
        codigo_cliente = _texto_desde_celda(_valor_crudo(row, mapeo, 'codigo_cliente'))

        if ruc_cliente:
            identificador_cliente = f'RUC:{ruc_cliente}'
        elif codigo_cliente:
            identificador_cliente = f'COD:{codigo_cliente}'
        else:
            identificador_cliente = f'NOMBRE:{normalize_cliente_key(cliente)}'

        dias_credito_crudo = _valor_crudo(row, mapeo, 'dias_credito')
        dias_credito = None
        if dias_credito_crudo is not None:
            try:
                dias_credito = int(float(dias_credito_crudo))
            except (ValueError, TypeError):
                dias_credito = None

        registro = {
            'cliente': cliente,
            'ruc_cliente': ruc_cliente,
            'codigo_cliente': codigo_cliente,
            'identificador_cliente': identificador_cliente,
            'sucursal': _texto_desde_celda(_valor_crudo(row, mapeo, 'sucursal')),
            'ciudad': normalize_ciudad(_valor_crudo(row, mapeo, 'ciudad')),
            'zona': _texto_desde_celda(_valor_crudo(row, mapeo, 'zona')),
            'vendedor_ejecutivo': _texto_desde_celda(_valor_crudo(row, mapeo, 'vendedor_ejecutivo')),
            'estado_cliente': _texto_desde_celda(_valor_crudo(row, mapeo, 'estado_cliente')),
            'telefono': _texto_desde_celda(_valor_crudo(row, mapeo, 'telefono')),
            'direccion': _texto_desde_celda(_valor_crudo(row, mapeo, 'direccion')),
            'numero_documento': _texto_desde_celda(_valor_crudo(row, mapeo, 'numero_documento')),
            'fecha_emision': fecha_emision,
            'fecha_vencimiento': fecha_vencimiento,
            'saldo': saldo,
            'articulo': _texto_desde_celda(_valor_crudo(row, mapeo, 'articulo')),
            'vence_original': _texto_desde_celda(_valor_crudo(row, mapeo, 'vence_original')),
            'observacion': _texto_desde_celda(_valor_crudo(row, mapeo, 'observacion')),
            'mes': _texto_desde_celda(_valor_crudo(row, mapeo, 'mes')),
            'tipo_venta': _texto_desde_celda(_valor_crudo(row, mapeo, 'tipo_venta')),
            'causal': normalize_causal(_valor_crudo(row, mapeo, 'causal')),
            'producto': _texto_desde_celda(_valor_crudo(row, mapeo, 'producto')),
            'fecha_compromiso_pago': fecha_compromiso_pago,
            'observaciones': _texto_desde_celda(_valor_crudo(row, mapeo, 'observaciones')),
            'tipo_cartera': _texto_desde_celda(_valor_crudo(row, mapeo, 'tipo_cartera')),
            'recuperador': normalize_recuperador(_valor_crudo(row, mapeo, 'recuperador')),
            'dias_credito': dias_credito,
        }
        registros.append(registro)

    advertencias_dataset = (
        validators.detectar_ruc_con_nombres_distintos(registros)
        + validators.detectar_documentos_duplicados(registros)
    )

    resumen = {
        'filas_leidas': len(df),
        'filas_validas': len(registros),
        'filas_con_advertencia': filas_con_advertencia,
        'filas_descartadas': len(descartados),
        'descartados': descartados,
        'advertencias_por_fila': advertencias_totales,
        'advertencias_generales': advertencias_dataset,
    }

    return registros, resumen
