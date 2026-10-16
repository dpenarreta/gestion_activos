"""Detección y validación del mapeo de columnas (secciones 4 y 5 de la especificación).

Reconoce encabezados sin importar mayúsculas/minúsculas, tildes, espacios extra o
guiones bajos, y nunca sugiere `Vendedor / Ejecutivo Ventas` como recuperador de cartera.
"""

import difflib

from ..utils.normalization import normalize_header

UMBRAL_SIMILITUD = 0.84

CAMPOS_OBLIGATORIOS = [
    {'campo': 'cliente', 'etiqueta': 'Cliente', 'columna_defecto': 'Cliente', 'alias': ['Cliente']},
    {'campo': 'ruc_cliente', 'etiqueta': 'Identificador', 'columna_defecto': 'Ruc Cliente',
     'alias': ['Ruc Cliente', 'RUC Cliente', 'Ruc']},
    {'campo': 'numero_documento', 'etiqueta': 'Documento', 'columna_defecto': 'Número de Documento',
     'alias': ['Número de Documento', 'Numero de Documento', 'No Documento', 'No. Documento', 'Documento']},
    {'campo': 'fecha_vencimiento', 'etiqueta': 'Fecha de vencimiento', 'columna_defecto': 'Fecha de Vencimiento',
     'alias': ['Fecha de Vencimiento', 'Fecha Vencimiento']},
    {'campo': 'fecha_emision', 'etiqueta': 'Fecha de emisión', 'columna_defecto': 'Fecha de Emisión',
     'alias': ['Fecha de Emisión', 'Fecha Emision', 'Fecha de Emision']},
    {'campo': 'saldo', 'etiqueta': 'Saldo', 'columna_defecto': 'Saldo', 'alias': ['Saldo']},
    {'campo': 'ciudad', 'etiqueta': 'Ciudad', 'columna_defecto': 'Lugar Geográfico',
     'alias': ['Lugar Geográfico', 'Lugar Geografico', 'Ciudad']},
    {'campo': 'recuperador', 'etiqueta': 'Recuperador', 'columna_defecto': 'Vendedor 3',
     'alias': ['Vendedor 3', 'Recuperador', 'Recuperador de Cartera']},
    {'campo': 'causal', 'etiqueta': 'Causal', 'columna_defecto': 'Causal', 'alias': ['Causal']},
]

CAMPOS_OPCIONALES = [
    {'campo': 'sucursal', 'etiqueta': 'Sucursal', 'alias': ['Sucursal']},
    {'campo': 'zona', 'etiqueta': 'Zona', 'alias': ['Zona']},
    {'campo': 'estado_cliente', 'etiqueta': 'Estado del cliente', 'alias': ['Estado Cliente']},
    {'campo': 'articulo', 'etiqueta': 'Artículo', 'alias': ['Articulo', 'Artículo']},
    {'campo': 'producto', 'etiqueta': 'Producto', 'alias': ['Producto']},
    {'campo': 'tipo_venta', 'etiqueta': 'Tipo de venta', 'alias': ['Tipo de Venta']},
    {'campo': 'tipo_cartera', 'etiqueta': 'Tipo de cartera', 'alias': ['Tipo Cartera']},
    {'campo': 'fecha_compromiso_pago', 'etiqueta': 'Fecha compromiso de pago',
     'alias': ['Fecha compromiso pago', 'Fecha Compromiso de Pago', 'Fecha Compromiso Pago']},
    {'campo': 'observaciones', 'etiqueta': 'Observaciones', 'alias': ['Observaciones']},
    {'campo': 'dias_credito', 'etiqueta': 'Días de crédito', 'alias': ['Dias credito', 'Días crédito', 'Dias Credito']},
    {'campo': 'codigo_cliente', 'etiqueta': 'Código de cliente', 'alias': ['Código cle', 'Codigo cle']},
    {'campo': 'vendedor_ejecutivo', 'etiqueta': 'Vendedor / Ejecutivo de ventas',
     'alias': ['Vendedor / Ejecutivo Ventas', 'Vendedor/Ejecutivo Ventas']},
    {'campo': 'telefono', 'etiqueta': 'Teléfono', 'alias': ['Telefono', 'Teléfono']},
    {'campo': 'direccion', 'etiqueta': 'Dirección', 'alias': ['Dirección', 'Direccion']},
    {'campo': 'vence_original', 'etiqueta': 'Vence (original)', 'alias': ['VENCE']},
    {'campo': 'observacion', 'etiqueta': 'Observación', 'alias': ['OBSERVACION', 'Observación']},
    {'campo': 'mes', 'etiqueta': 'Mes', 'alias': ['Mes']},
]

TODOS_LOS_CAMPOS = CAMPOS_OBLIGATORIOS + CAMPOS_OPCIONALES

# Encabezados que jamás deben sugerirse automáticamente para 'recuperador',
# aunque tengan palabras en común (sección 4.1: no confundir con el ejecutivo comercial).
EXCLUSIONES_POR_CAMPO = {
    'recuperador': {
        normalize_header('Vendedor / Ejecutivo Ventas'),
        normalize_header('Vendedor/Ejecutivo Ventas'),
        normalize_header('Ejecutivo Ventas'),
        normalize_header('Vendedor'),
    },
}


def _buscar_columna(headers_normalizados, alias_list, excluidos):
    for alias in alias_list:
        clave = normalize_header(alias)
        if clave in excluidos:
            continue
        if clave in headers_normalizados:
            return headers_normalizados[clave]
    return None


def _buscar_columna_difusa(headers, alias_list, excluidos):
    mejor_columna = None
    mejor_score = 0.0
    for header in headers:
        clave_header = normalize_header(header)
        if clave_header in excluidos:
            continue
        for alias in alias_list:
            score = difflib.SequenceMatcher(None, clave_header, normalize_header(alias)).ratio()
            if score > mejor_score:
                mejor_score = score
                mejor_columna = header
    if mejor_score >= UMBRAL_SIMILITUD:
        return mejor_columna
    return None


def detectar_mapeo(headers):
    """Devuelve la sugerencia de mapeo para todos los campos, obligatorios y opcionales."""
    headers = [h for h in headers if h is not None]
    headers_normalizados = {}
    for h in headers:
        clave = normalize_header(h)
        if clave not in headers_normalizados:
            headers_normalizados[clave] = h

    def resolver(campo_def):
        excluidos = EXCLUSIONES_POR_CAMPO.get(campo_def['campo'], set())
        columna = _buscar_columna(headers_normalizados, campo_def['alias'], excluidos)
        if columna is None:
            columna = _buscar_columna_difusa(headers, campo_def['alias'], excluidos)
        return {
            'campo': campo_def['campo'],
            'etiqueta': campo_def['etiqueta'],
            'columna_detectada': columna,
            'estado': 'ENCONTRADA' if columna else 'NO_ENCONTRADA',
        }

    return {
        'obligatorios': [resolver(c) for c in CAMPOS_OBLIGATORIOS],
        'opcionales': [resolver(c) for c in CAMPOS_OPCIONALES],
        'columnas_disponibles': headers,
    }


def campos_obligatorios_faltantes(mapeo_confirmado):
    """mapeo_confirmado: dict campo -> nombre_columna_excel (o None/''). Devuelve lista de etiquetas faltantes."""
    faltantes = []
    for campo_def in CAMPOS_OBLIGATORIOS:
        valor = mapeo_confirmado.get(campo_def['campo'])
        if not valor:
            faltantes.append(campo_def['etiqueta'])
    return faltantes


def validar_mapeo_contra_headers(mapeo_confirmado, headers):
    """Verifica que cada columna mapeada exista realmente entre los encabezados del archivo."""
    headers_set = set(headers)
    errores = []
    for campo, columna in mapeo_confirmado.items():
        if columna and columna not in headers_set:
            errores.append(f'La columna "{columna}" asignada a "{campo}" no existe en el archivo.')
    return errores
