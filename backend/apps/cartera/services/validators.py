"""Validaciones estructurales y de fila (sección 14 de la especificación)."""

import re
from decimal import Decimal, InvalidOperation

from ..utils.normalization import is_blank

FECHA_VENCIMIENTO_FUTURA_DIAS = 365 * 5
FECHA_COMPROMISO_MAX_DIAS = 365 * 2

MENSAJES_ADVERTENCIA = {
    'FECHA_EMISION_POSTERIOR_A_VENCIMIENTO': 'La fecha de emisión es posterior a la fecha de vencimiento.',
    'FECHA_VENCIMIENTO_EXTREMADAMENTE_FUTURA': 'La fecha de vencimiento es extremadamente futura (más de 5 años).',
    'FECHA_COMPROMISO_SUPERA_DOS_ANIOS': 'La fecha de compromiso de pago supera los dos años desde la fecha de corte.',
    'SALDO_NEGATIVO': 'El saldo es negativo (saldo a favor).',
    'SALDO_CERO': 'El saldo es cero.',
    'SIN_FECHA_VENCIMIENTO': 'El documento no tiene fecha de vencimiento.',
    'FECHA_VENCIMIENTO_INVALIDA': 'La fecha de vencimiento no se pudo interpretar como fecha válida.',
    'FECHA_EMISION_INVALIDA': 'La fecha de emisión no se pudo interpretar como fecha válida.',
}


def parsear_saldo(valor):
    """Convierte un valor de celda a Decimal, limpiando símbolos monetarios y separadores.

    Devuelve None si el valor no puede convertirse a número (la fila se descarta de los
    cálculos monetarios, según la sección 6, regla 9).
    """
    if valor is None:
        return None
    if isinstance(valor, (int, float)):
        try:
            return Decimal(str(valor)).quantize(Decimal('0.01'))
        except (InvalidOperation, ValueError):
            return None

    texto = str(valor).strip()
    if not texto:
        return None

    texto = re.sub(r'[^\d.,\-]', '', texto)
    if not texto:
        return None

    negativo = texto.startswith('-')
    texto = texto.lstrip('-')

    if ',' in texto and '.' in texto:
        if texto.rfind(',') > texto.rfind('.'):
            texto = texto.replace('.', '').replace(',', '.')
        else:
            texto = texto.replace(',', '')
    elif ',' in texto:
        partes = texto.split(',')
        if len(partes[-1]) == 2:
            texto = texto.replace(',', '.')
        else:
            texto = texto.replace(',', '')

    if negativo:
        texto = '-' + texto

    try:
        return Decimal(texto).quantize(Decimal('0.01'))
    except (InvalidOperation, ValueError):
        return None


def fila_esta_vacia(valores_mapeados):
    return all(is_blank(v) for v in valores_mapeados)


def advertencias_de_fila(*, fecha_emision, fecha_vencimiento, fecha_compromiso_pago, saldo, fecha_corte,
                          fecha_vencimiento_bruta_invalida=False, fecha_emision_bruta_invalida=False):
    advertencias = []

    if fecha_vencimiento_bruta_invalida:
        advertencias.append('FECHA_VENCIMIENTO_INVALIDA')
    if fecha_emision_bruta_invalida:
        advertencias.append('FECHA_EMISION_INVALIDA')

    if fecha_emision and fecha_vencimiento and fecha_emision > fecha_vencimiento:
        advertencias.append('FECHA_EMISION_POSTERIOR_A_VENCIMIENTO')

    if fecha_vencimiento and (fecha_vencimiento - fecha_corte).days > FECHA_VENCIMIENTO_FUTURA_DIAS:
        advertencias.append('FECHA_VENCIMIENTO_EXTREMADAMENTE_FUTURA')

    if fecha_compromiso_pago and (fecha_compromiso_pago - fecha_corte).days > FECHA_COMPROMISO_MAX_DIAS:
        advertencias.append('FECHA_COMPROMISO_SUPERA_DOS_ANIOS')

    if saldo is not None:
        if saldo < 0:
            advertencias.append('SALDO_NEGATIVO')
        elif saldo == 0:
            advertencias.append('SALDO_CERO')

    if fecha_vencimiento is None:
        advertencias.append('SIN_FECHA_VENCIMIENTO')

    return advertencias


def detectar_ruc_con_nombres_distintos(registros):
    """registros: lista de dicts con 'ruc_cliente' y 'cliente'. Devuelve advertencias informativas."""
    por_ruc = {}
    for r in registros:
        ruc = (r.get('ruc_cliente') or '').strip()
        if not ruc:
            continue
        por_ruc.setdefault(ruc, set()).add((r.get('cliente') or '').strip().upper())

    advertencias = []
    for ruc, nombres in por_ruc.items():
        if len(nombres) > 1:
            advertencias.append(f'El RUC {ruc} aparece con {len(nombres)} nombres de cliente distintos: {", ".join(sorted(nombres))}.')
    return advertencias


def detectar_documentos_duplicados(registros):
    conteo = {}
    for r in registros:
        doc = (r.get('numero_documento') or '').strip()
        if not doc:
            continue
        conteo[doc] = conteo.get(doc, 0) + 1

    duplicados = {doc: n for doc, n in conteo.items() if n > 1}
    if not duplicados:
        return []
    return [f'Se encontraron {len(duplicados)} números de documento repetidos (ej: {next(iter(duplicados))} x{duplicados[next(iter(duplicados))]}).']
