"""Construcción compartida de filtros globales (sección 12) y de drill-down para los GET.

Los filtros que corresponden a columnas reales se empujan al queryset de SQL Server. Los que
dependen de la fecha de corte (estado de cartera, rango de mora, días vencidos) se aplican
después, sobre el DataFrame ya anotado por `calculator.anotar_estado_y_mora`.

Un valor con comas (`ciudad=QUITO,CUENCA,LOJA`) se interpreta como "cualquiera de estos" —
usado por el drill-down de la categoría "OTRAS CIUDADES"/"OTRAS" del gráfico de pastel y de
causales, donde el usuario abre el detalle de varias categorías agrupadas a la vez.
"""

from ..utils.dates import parse_fecha

FILTROS_DB_TEXTO = {
    'ciudad': 'ciudad',
    'zona': 'zona',
    'sucursal': 'sucursal',
    'recuperador': 'recuperador',
    'causal': 'causal',
    'producto': 'producto',
    'articulo': 'articulo',
    'tipo_venta': 'tipo_venta',
    'estado_cliente': 'estado_cliente',
}

# Rango de fechas aplicado directamente sobre columnas reales de la base (sección 12: filtro
# de fecha desde/hasta que afecta a todos los KPIs, gráficos, matriz y tabla de detalle).
FILTROS_DB_RANGO_FECHA = {
    'fecha_vencimiento': ('fecha_vencimiento_desde', 'fecha_vencimiento_hasta'),
    'fecha_emision': ('fecha_emision_desde', 'fecha_emision_hasta'),
}


def aplicar_filtros_queryset(queryset, params):
    for parametro, campo in FILTROS_DB_TEXTO.items():
        valor = params.get(parametro)
        if not valor:
            continue
        if ',' in valor:
            valores = [v.strip() for v in valor.split(',') if v.strip()]
            queryset = queryset.filter(**{f'{campo}__in': valores})
        else:
            queryset = queryset.filter(**{f'{campo}__iexact': valor})

    cliente = params.get('cliente')
    if cliente:
        from django.db.models import Q
        queryset = queryset.filter(Q(cliente__icontains=cliente) | Q(ruc_cliente__icontains=cliente))

    for campo, (parametro_desde, parametro_hasta) in FILTROS_DB_RANGO_FECHA.items():
        desde = parse_fecha(params.get(parametro_desde))
        if desde:
            queryset = queryset.filter(**{f'{campo}__gte': desde})
        hasta = parse_fecha(params.get(parametro_hasta))
        if hasta:
            queryset = queryset.filter(**{f'{campo}__lte': hasta})

    return queryset


def aplicar_filtros_dataframe(df, params):
    estado_cartera = params.get('estado_cartera')
    if estado_cartera and not df.empty:
        df = df[df['estado_calculado'].str.upper() == estado_cartera.upper()]

    rango_mora = params.get('rango_mora')
    if rango_mora and not df.empty:
        df = df[df['rango_mora'].str.upper() == rango_mora.upper()]

    dias_min = params.get('dias_vencidos_min')
    if dias_min not in (None, '') and not df.empty:
        df = df[df['dias_vencidos'] >= float(dias_min)]

    dias_max = params.get('dias_vencidos_max')
    if dias_max not in (None, '') and not df.empty:
        df = df[df['dias_vencidos'] <= float(dias_max)]

    return df
