"""Conexión externa de solo lectura hacia una base productiva de origen ("Conectar vista de base
de datos", ver `views.ConectarFuenteBDView`). Un único servidor "por defecto" para toda la app
(`EXTERNAL_DB_*` en `settings.py`, separado de `DATABASES`); cada dashboard/pestaña elige aparte
QUÉ vista o stored procedure de esa base consultar (`Dashboard.fuente_bd_tipo`/`fuente_bd_nombre`).

Se usa pyodbc directo (no una segunda entrada de `DATABASES`/el ORM) porque esto es siempre una
única lectura de un objeto ya definido en la base de origen — nunca una migración ni un query
armado por el ORM contra esa base. Nunca se ejecuta más que `SELECT * FROM <objeto>` o
`EXEC <objeto>` sobre el nombre ya validado; no hay ningún camino que escriba en la base externa.
"""

import decimal
import logging
import os
import re
import uuid
from datetime import date

import pandas as pd
import pyodbc
from django.conf import settings

from ..exceptions import CarteraError
from ..models import CargaArchivo
from ..utils.archivos import asegurar_directorio

logger = logging.getLogger(__name__)

# Nombre de hoja fijo para archivos que la app misma escribe (nunca subidos a mano) — mismo
# criterio que `views._HOJA_ARCHIVO_PERMANENTE` (la copia permanente post-mapeo de CUALQUIER
# carga, con o sin origen en base de datos, usa el mismo nombre fijo).
HOJA_TEMPORAL = 'Datos'

# Identificador SQL válido (`objeto` o `esquema.objeto`) — letras/dígitos/guion bajo, sin espacios
# ni comillas ni punto y coma. Como el nombre se interpola directo en el SQL (no se puede
# parametrizar un identificador/objeto de un EXEC), esta validación es la única barrera contra
# inyección: se aplica tanto al guardar la configuración del dashboard (`services/dashboards.py`)
# como, de nuevo, acá mismo antes de ejecutar cualquier consulta (defensa en profundidad).
_IDENTIFICADOR = r'[A-Za-z_][A-Za-z0-9_]*'
_PATRON_NOMBRE_FUENTE = re.compile(rf'^{_IDENTIFICADOR}(\.{_IDENTIFICADOR})?$')


def validar_nombre_fuente(nombre):
    if not _PATRON_NOMBRE_FUENTE.match(nombre or ''):
        raise CarteraError(
            'El nombre de la vista/procedimiento solo puede tener letras, números, guion bajo y '
            'un punto opcional para el esquema (ej. "dbo.mi_vista").',
            codigo='FUENTE_BD_NOMBRE_INVALIDO',
        )


_PATRON_NOMBRE_PARAMETRO = re.compile(rf'^{_IDENTIFICADOR}$')


def validar_nombre_parametro(nombre):
    if not _PATRON_NOMBRE_PARAMETRO.match(nombre or ''):
        raise CarteraError(
            f'El nombre de parámetro "{nombre}" no es válido — solo letras, números y guion bajo, '
            'sin el "@" (se agrega solo).',
            codigo='FUENTE_BD_PARAMETRO_INVALIDO',
        )


def _conectar():
    if not settings.EXTERNAL_DB_HOST:
        raise CarteraError(
            'La conexión a la base de datos externa no está configurada en este entorno.',
            codigo='FUENTE_BD_NO_CONFIGURADA_APP',
        )
    conn_str = (
        # Mismo driver que la base propia (`settings.DB_ODBC_DRIVER`): `pyodbc` lo busca por
        # su nombre exacto y la versión instalada cambia según la máquina — desarrollo tiene
        # el 17, el servidor de aplicaciones el 18. Tenerlo fijo acá hacía que la conexión
        # externa fallara en un servidor donde la base propia sí conectaba.
        f'DRIVER={{{settings.DB_ODBC_DRIVER}}};'
        f'SERVER={settings.EXTERNAL_DB_HOST},{settings.EXTERNAL_DB_PORT};'
        f'DATABASE={settings.EXTERNAL_DB_NAME};'
        f'UID={settings.EXTERNAL_DB_USER};PWD={settings.EXTERNAL_DB_PASSWORD};'
        f'Encrypt={settings.EXTERNAL_DB_ENCRYPT};'
        f'TrustServerCertificate={settings.EXTERNAL_DB_TRUST_SERVER_CERTIFICATE};'
    )
    try:
        return pyodbc.connect(conn_str, timeout=15)
    except pyodbc.Error:
        # Nunca se expone el detalle del driver (podría filtrar host/usuario) en la respuesta al
        # frontend — queda solo en el log del servidor para diagnóstico.
        logger.exception('No se pudo conectar a la base externa (host=%s)', settings.EXTERNAL_DB_HOST)
        raise CarteraError(
            'No se pudo conectar con la base de datos externa. Verifique que el servidor esté '
            'disponible y que las credenciales configuradas sigan siendo válidas.',
            codigo='FUENTE_BD_CONEXION_FALLIDA',
        )


# Formatos de texto en los que se puede enviar el VALOR de `FechaCorte` a un procedimiento —
# mismos strings que `models.Dashboard.FuenteBDFechaFormato` (comparados como literal, no
# importando el modelo, mismo criterio que `tipo` un poco más abajo: este módulo es agnóstico de
# cómo se persiste la elección). El valor GUARDADO en `fuente_bd_parametros` siempre sigue siendo
# ISO (`YYYY-MM-DD`, lo único que entrega el `<input type="date">` del frontend) — este catálogo
# solo decide cómo se reescribe recién acá, al armar la consulta; nunca toca lo guardado, así
# `services/fuente_bd_scheduler.py::avanzar_fecha_corte` (que asume ISO al leer el valor guardado)
# sigue funcionando sin cambios sea cual sea el formato elegido.
_FORMATOS_FECHA_CORTE = {
    'YYYY-MM-DD': lambda fecha: fecha.strftime('%Y-%m-%d'),
    'DD/MM/YYYY': lambda fecha: fecha.strftime('%d/%m/%Y'),
    'MM/DD/YYYY': lambda fecha: fecha.strftime('%m/%d/%Y'),
    'YYYY-MM-DD HH:mm:ss': lambda fecha: fecha.strftime('%Y-%m-%d 00:00:00'),
}


def formatear_valor_fecha_corte(valor_iso, formato):
    """Reescribe `valor_iso` (siempre `YYYY-MM-DD`, tal como lo guarda
    `Dashboard.fuente_bd_parametros`) al formato de texto elegido para el envío
    (`Dashboard.FuenteBDFechaFormato`) — de mejor esfuerzo: si `valor_iso` no es una fecha ISO
    válida, o `formato` no está en el catálogo (incluye `None`/`''`, el caso más común: ISO por
    defecto), se devuelve `valor_iso` tal cual sin tocar — nunca rompe la conexión por un
    valor/formato inesperado."""
    if not valor_iso or formato not in _FORMATOS_FECHA_CORTE:
        return valor_iso
    try:
        fecha = date.fromisoformat(str(valor_iso).strip())
    except ValueError:
        return valor_iso
    return _FORMATOS_FECHA_CORTE[formato](fecha)


def leer_fuente(tipo, nombre, parametros=None, fecha_formato=None):
    """Ejecuta la vista o el stored procedure indicado (ya validado) contra la conexión externa
    "por defecto" y devuelve el resultado como DataFrame — misma forma que
    `excel_reader.leer_hoja`, para que `views.ConectarFuenteBDView` pueda tratar el resultado como
    si fuera un archivo recién subido.

    `parametros` (`{nombre_sin_arroba: valor}`) solo aplica a `tipo='procedimiento'` — una vista se
    consulta siempre sin parámetros. Los NOMBRES se validan por regex porque van armados en el
    texto de la consulta (`@nombre = ?`, un identificador no se puede parametrizar); los VALORES en
    cambio se bindean como parámetro real de pyodbc (`?`), nunca interpolados en el SQL — es la
    única parte de este módulo donde un dato no controlado por un administrador (el valor de un
    parámetro) llega a tocar la consulta, así que nunca se arma con f-string.

    `fecha_formato` (uno de `Dashboard.FuenteBDFechaFormato`, o `None`/`''` = ISO) reescribe el
    VALOR de cada parámetro con `formatear_valor_fecha_corte` antes de bindearlo — de mejor
    esfuerzo, así que un valor que no sea una fecha ISO válida (ej. un futuro parámetro no-fecha)
    sale sin tocar. Aplica a TODOS los parámetros en vez de buscar uno con nombre "FechaCorte": el
    nombre del parámetro de fecha es configurable (`ConectarFuenteBDModal.jsx`, "Nombre del
    parámetro"), así que este módulo no puede (ni necesita) asumir un nombre fijo — hoy la UI solo
    ofrece un único parámetro por dashboard, sea cual sea su nombre."""
    validar_nombre_fuente(nombre)
    parametros = parametros or {}
    # `tipo` es uno de `Dashboard.FuenteBDTipo` ('vista'/'procedimiento') — se compara contra el
    # string literal en vez de importar el modelo acá para no acoplar este servicio (agnóstico de
    # cómo se persiste la elección) al esquema de `Dashboard`.
    if tipo == 'procedimiento' and parametros:
        for nombre_parametro in parametros:
            validar_nombre_parametro(nombre_parametro)
        asignaciones = ', '.join(f'@{p} = ?' for p in parametros)
        consulta = f'EXEC {nombre} {asignaciones}'
        valores = [formatear_valor_fecha_corte(valor, fecha_formato) for valor in parametros.values()]
    elif tipo == 'procedimiento':
        consulta = f'EXEC {nombre}'
        valores = []
    else:
        consulta = f'SELECT * FROM {nombre}'
        valores = []

    conn = _conectar()
    try:
        try:
            df = pd.read_sql(consulta, conn, params=valores)
        except Exception:  # noqa: BLE001 - cualquier fallo de SQL (objeto inexistente, parámetros, permisos, etc.)
            logger.exception('Falló la consulta a la base externa (objeto=%s, tipo=%s)', nombre, tipo)
            raise CarteraError(
                f'No se pudo leer "{nombre}" desde la base de datos externa. Verifique que el '
                'nombre y los parámetros sean correctos y que el usuario configurado tenga '
                'permiso de lectura.',
                codigo='FUENTE_BD_CONSULTA_FALLIDA',
            )
    finally:
        conn.close()

    if df.shape[1] == 0:
        raise CarteraError(f'"{nombre}" no devolvió ninguna columna.', codigo='FUENTE_BD_SIN_COLUMNAS')

    df.columns = [str(c).strip() for c in df.columns]
    return _convertir_decimales_a_float(df)


def aplicar_alias_columnas(df, aliases):
    """Renombra las columnas del archivo según el alias que haya elegido el usuario en el paso
    "renombrar columnas" (nombre original -> nuevo nombre); a partir de acá todo el resto del
    flujo (análisis, mapeo, cálculo de datos, títulos/descripciones generados) usa el nombre
    nuevo como si fuera el original. Una columna sin alias (o con alias igual al original) no se
    toca. Dos columnas que terminen con el mismo nombre son un error del usuario, no un caso a
    resolver en silencio: con nombres duplicados, `df[nombre]` deja de devolver una única serie.

    Vive acá (no en `views.py`) porque `services/fuente_bd_scheduler.py` necesita la MISMA lógica
    para reaplicar `Dashboard.fuente_bd_ultimo_aliases` en cada actualización automática, sin
    duplicarla — `views.py` la reexporta como `_aplicar_alias_columnas` para no tocar sus otros
    call sites."""
    if not aliases:
        return df
    mapa = {
        original: str(nuevo).strip()
        for original, nuevo in aliases.items()
        if original in df.columns and str(nuevo or '').strip() and str(nuevo).strip() != original
    }
    if not mapa:
        return df
    resultado = [mapa.get(c, c) for c in df.columns]
    if len(set(resultado)) != len(resultado):
        raise CarteraError('Dos o más columnas quedarían con el mismo nombre después de renombrar.', codigo='ALIAS_DUPLICADO')
    return df.rename(columns=mapa)


def fecha_corte_de_parametros(parametros):
    """La fecha con la que se leyó la fuente, tomada de su (único) parámetro de fecha.

    Una fuente de base no trae la fecha de corte como columna: es el parámetro con el que se
    ejecuta la vista o el procedimiento (`FechaCorte` en el caso de cartera, pero el nombre lo
    elige quien configura la conexión, así que se toma la primera entrada del dict — el mismo
    criterio que `fuente_bd_scheduler.avanzar_fecha_corte`).

    Sin esto la carga quedaba con `fecha_corte` vacía y todo lo que depende de ella —la antigüedad
    por tramos, el cumplimiento de metas, el "Corte <mes>" del Dashboard Directorio— se calculaba
    contra la fecha de HOY, que no es la fecha de los datos. Un valor que no sea una fecha ISO
    devuelve `None`: la fecha es informativa para el cálculo, no puede romper la lectura.
    """
    if not parametros:
        return None
    _nombre, valor = next(iter(parametros.items()))
    if not valor:
        return None
    try:
        return date.fromisoformat(str(valor).strip())
    except (TypeError, ValueError):
        return None


def crear_carga_temporal(dashboard_id, df, nombre_original, subido_por=None, fecha_corte=None):
    """Escribe `df` a un .xlsx temporal (mismo directorio y mecanismo `archivo_temp_nombre` que un
    archivo subido a mano) y arma la `CargaArchivo` correspondiente — punto compartido entre
    `views.ConectarFuenteBDView` (conexión manual, con un usuario esperando la respuesta) y
    `services/fuente_bd_scheduler.py` (actualización automática, sin nadie presente), para no
    duplicar esta lógica en los dos lugares. De ahí en más, el resto del pipeline (mapeo,
    histórico, etc.) no distingue el origen de los datos."""
    nombre_temp = f'{uuid.uuid4().hex}.xlsx'
    ruta_temp = asegurar_directorio(settings.CARTERA_TEMP_UPLOADS_DIR) / nombre_temp
    df.to_excel(ruta_temp, index=False, sheet_name=HOJA_TEMPORAL)
    return CargaArchivo.objects.create(
        dashboard_id=dashboard_id, subido_por=subido_por, nombre_original=nombre_original,
        nombre_hoja=HOJA_TEMPORAL, tamano_bytes=os.path.getsize(ruta_temp),
        estado=CargaArchivo.Estado.VALIDADO, total_filas_excel=len(df), archivo_temp_nombre=nombre_temp,
        fecha_corte=fecha_corte,
    )


def _convertir_decimales_a_float(df):
    """pyodbc devuelve las columnas NUMERIC/DECIMAL/MONEY de SQL Server como `decimal.Decimal` —
    `views.ConectarFuenteBDView` escribe este DataFrame a un .xlsx temporal (mismo mecanismo que un
    archivo subido) y el resto del pipeline (`generic_charts.py`, siempre vía `pd.to_numeric`)
    espera columnas numéricas comunes, no `Decimal`. Se convierte acá, una sola vez, en el único
    punto de entrada de datos externos."""
    for columna in df.columns:
        if df[columna].map(lambda v: isinstance(v, decimal.Decimal)).any():
            # `errors='coerce'` para no romper si la columna mezcla `Decimal` con `None` (NULL en
            # SQL Server) — un `None` se vuelve `NaN`, no una excepción.
            df[columna] = pd.to_numeric(df[columna], errors='coerce')
    return df
