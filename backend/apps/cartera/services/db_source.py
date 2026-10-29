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
# como, de nuevo, acá mismo antes de ejecutar cualquier consulta (defensa en profundidad), y otra
# vez en la actualización automática (`services/fuente_bd_scheduler.py`) por si quedó guardado un
# nombre de antes de estas reglas. 128 es el largo máximo de un identificador en SQL Server.
_IDENTIFICADOR = r'[A-Za-z_][A-Za-z0-9_]{0,127}'
_PATRON_NOMBRE_FUENTE = re.compile(rf'{_IDENTIFICADOR}(\.{_IDENTIFICADOR})?')

# Auditoría de seguridad, 29/10/2026: la regex sola dejaba ejecutar CUALQUIER objeto que se
# llamara como un identificador — `sp_executesql` (SQL arbitrario en el valor del parámetro),
# `xp_cmdshell`, `sys.sql_logins`… con los permisos del usuario de la base externa. Ahora:
#  - nunca un objeto del sistema: esquemas `sys`/`INFORMATION_SCHEMA`, las bases del sistema
#    usadas como esquema (`master.x`, …) y los prefijos de objetos del sistema (`xp_`, `dt_`, `fn_`);
#  - `sp_` es el prefijo de los procedimientos del sistema, pero también el de procedimientos
#    propios de la base de origen (el Dashboard Directorio usa `dbo.sp_Reporte_Seguimiento_Cartera`),
#    así que se acepta SOLO si figura con su nombre en `EXTERNAL_DB_OBJETOS_PERMITIDOS`;
#  - los procedimientos del sistema que ejecutan SQL o tocan la seguridad del servidor no se
#    aceptan ni aunque alguien los ponga en esa lista;
#  - los nombres de tres partes (`base.esquema.objeto`) ya los rechaza la regex.
_ESQUEMAS_PROHIBIDOS = {'sys', 'information_schema', 'master', 'msdb', 'tempdb', 'model'}
_PREFIJOS_PROHIBIDOS = ('xp_', 'dt_', 'fn_')
_PREFIJO_PROCEDIMIENTO_DE_SISTEMA = 'sp_'
_PROCEDIMIENTOS_DE_SISTEMA_PROHIBIDOS = {
    'sp_executesql', 'sp_execute', 'sp_prepexec', 'sp_prepare', 'sp_sqlexec', 'sp_configure',
    'sp_addlogin', 'sp_addsrvrolemember', 'sp_addrolemember', 'sp_adduser', 'sp_grantlogin',
    'sp_password', 'sp_droplogin', 'sp_dropuser', 'sp_addlinkedserver', 'sp_addlinkedsrvlogin',
    'sp_addextendedproc', 'sp_makewebtask', 'sp_send_dbmail', 'sp_start_job', 'sp_add_job',
    'sp_rename', 'sp_msforeachtable', 'sp_msforeachdb', 'sp_readerrorlog', 'sp_helptext',
    'sp_who', 'sp_who2', 'sp_oacreate', 'sp_oamethod', 'sp_oasetproperty', 'sp_oagetproperty',
}
_MENSAJE_OBJETO_DE_SISTEMA = (
    '"{nombre}" es un objeto del sistema de SQL Server y no se puede consultar desde aquí. '
    'Use una vista o un procedimiento propio de la base de origen.'
)


def _normalizar_objeto(nombre):
    """`dbo.Vista` y `vista` son el mismo objeto para la lista blanca: sin mayúsculas y sin el
    esquema `dbo` por defecto (cualquier otro esquema sí se conserva)."""
    nombre = str(nombre or '').strip().lower()
    return nombre[4:] if nombre.startswith('dbo.') else nombre


def objetos_permitidos():
    """La lista blanca de `settings.EXTERNAL_DB_OBJETOS_PERMITIDOS`, ya normalizada. Vacía = no
    hay lista blanca y se aplican solo las reglas fijas de `validar_nombre_fuente`."""
    configurados = getattr(settings, 'EXTERNAL_DB_OBJETOS_PERMITIDOS', None) or []
    if isinstance(configurados, str):
        configurados = configurados.split(',')
    return {_normalizar_objeto(o) for o in configurados if str(o).strip()}


def validar_nombre_fuente(nombre):
    # `fullmatch`: con `match` y `$` pasaba un salto de línea al final del nombre.
    if not isinstance(nombre, str) or not _PATRON_NOMBRE_FUENTE.fullmatch(nombre):
        raise CarteraError(
            'El nombre de la vista/procedimiento solo puede tener letras, números, guion bajo y '
            'un punto opcional para el esquema (ej. "dbo.mi_vista"). No se aceptan nombres con '
            'la base de datos delante ("base.esquema.objeto").',
            codigo='FUENTE_BD_NOMBRE_INVALIDO',
        )
    partes = nombre.lower().split('.')
    esquema, objeto = (partes[0], partes[1]) if len(partes) == 2 else ('', partes[0])
    if (
        esquema in _ESQUEMAS_PROHIBIDOS
        or objeto in _ESQUEMAS_PROHIBIDOS
        or objeto.startswith(_PREFIJOS_PROHIBIDOS)
        or objeto in _PROCEDIMIENTOS_DE_SISTEMA_PROHIBIDOS
    ):
        raise CarteraError(_MENSAJE_OBJETO_DE_SISTEMA.format(nombre=nombre), codigo='FUENTE_BD_OBJETO_DE_SISTEMA')

    permitidos = objetos_permitidos()
    en_lista_blanca = _normalizar_objeto(nombre) in permitidos
    if permitidos and not en_lista_blanca:
        raise CarteraError(
            f'"{nombre}" no está entre las vistas y procedimientos habilitados para consultar en '
            'la base de datos externa. Pida al administrador del sistema que lo agregue a la '
            'lista de objetos permitidos (EXTERNAL_DB_OBJETOS_PERMITIDOS).',
            codigo='FUENTE_BD_OBJETO_NO_PERMITIDO',
        )
    if objeto.startswith(_PREFIJO_PROCEDIMIENTO_DE_SISTEMA) and not en_lista_blanca:
        raise CarteraError(
            f'"{nombre}" empieza por "sp_", el prefijo de los procedimientos del sistema de SQL '
            'Server. Solo se acepta si el administrador del sistema lo agregó a la lista de '
            'objetos permitidos de la base externa (EXTERNAL_DB_OBJETOS_PERMITIDOS).',
            codigo='FUENTE_BD_OBJETO_NO_PERMITIDO',
        )


_PATRON_NOMBRE_PARAMETRO = re.compile(_IDENTIFICADOR)


def validar_nombre_parametro(nombre):
    # `fullmatch` y no `match` con `$`: este último acepta un salto de línea final («Fecha\n»), y
    # el nombre va pegado al SQL detrás de la «@» (auditoría de seguridad, 29/10/2026).
    if not isinstance(nombre, str) or not _PATRON_NOMBRE_PARAMETRO.fullmatch(nombre):
        raise CarteraError(
            f'El nombre de parámetro "{nombre}" no es válido — solo letras, números y guion bajo, '
            'sin el "@" (se agrega solo).',
            codigo='FUENTE_BD_PARAMETRO_INVALIDO',
        )


def _valor_odbc(valor):
    """Un valor de la cadena de conexión ODBC, entre llaves y con `}` escrita como `}}`.

    Auditoría de seguridad, 29/10/2026: los valores iban pegados con f-string, así que una
    contraseña o un nombre de base con `;` partía la cadena y podía agregar atributos de conexión
    (`…;Trusted_Connection=yes`). Entre llaves el driver toma todo literal hasta la llave de
    cierre, y una `}` propia se escribe doble."""
    return '{' + str(valor).replace('}', '}}') + '}'


def cadena_de_conexion():
    """La cadena de conexión a la base externa, armada desde `settings.EXTERNAL_DB_*`."""
    servidor = f'{settings.EXTERNAL_DB_HOST},{settings.EXTERNAL_DB_PORT}'
    return (
        # Mismo driver que la base propia (`settings.DB_ODBC_DRIVER`): `pyodbc` lo busca por
        # su nombre exacto y la versión instalada cambia según la máquina — desarrollo tiene
        # el 17, el servidor de aplicaciones el 18. Tenerlo fijo acá hacía que la conexión
        # externa fallara en un servidor donde la base propia sí conectaba.
        f'DRIVER={_valor_odbc(settings.DB_ODBC_DRIVER)};'
        f'SERVER={_valor_odbc(servidor)};'
        f'DATABASE={_valor_odbc(settings.EXTERNAL_DB_NAME)};'
        f'UID={_valor_odbc(settings.EXTERNAL_DB_USER)};'
        f'PWD={_valor_odbc(settings.EXTERNAL_DB_PASSWORD)};'
        f'Encrypt={_valor_odbc(settings.EXTERNAL_DB_ENCRYPT)};'
        f'TrustServerCertificate={_valor_odbc(settings.EXTERNAL_DB_TRUST_SERVER_CERTIFICATE)};'
    )


def _conectar():
    if not settings.EXTERNAL_DB_HOST:
        raise CarteraError(
            'La conexión a la base de datos externa no está configurada en este entorno.',
            codigo='FUENTE_BD_NO_CONFIGURADA_APP',
        )
    conn_str = cadena_de_conexion()
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
