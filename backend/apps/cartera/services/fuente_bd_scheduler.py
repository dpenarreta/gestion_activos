"""Actualización automática de "Conectar vista de base de datos", sin ningún programador de
tareas propio de la app — no hay Celery/cron configurado en este proyecto (ver
`docs/integracion/decisions.md`, no existía ninguna infraestructura de este tipo antes de este
módulo). El único disparador es `manage.py actualizar_fuentes_bd` (mismo patrón que
`clean_temp_uploads`), pensado para que un programador EXTERNO al sistema operativo (Windows Task
Scheduler en desarrollo, cron en producción) lo invoque una vez al día — este módulo decide, cada
vez que lo llaman, cuáles de los dashboards con una frecuencia configurada quedaron PENDIENTES, y
ejecuta esa actualización.

Pendiente, no "hoy es el día": el disparador es externo y puede no correr (servidor apagado, tarea
deshabilitada, máquina dormida). Con la pregunta "¿hoy es domingo?", un solo domingo perdido
costaba el período entero —el dashboard seguía mostrando datos de dos semanas atrás y nadie se
enteraba, porque no había ni reintento ni error—. Con "¿pasó una fecha prevista desde la última
actualización?", la corrida siguiente lo pone al día cualquier día de la semana.

Reglas de negocio (confirmadas explícitamente, no asumidas):
- Solo dos frecuencias: "semanal" (siempre domingo) y "mensual" (mismo día-del-mes que cuando se
  configuró la frecuencia, sin ajustar a fin de semana — así se pidió explícitamente).
- Sin intervención humana: no se puede mostrar el asistente de columnas a nadie. Se reaplica el
  ÚLTIMO mapeo/aliases que un humano confirmó a mano para ese dashboard
  (`Dashboard.fuente_bd_ultimo_mapeo`/`fuente_bd_ultimo_aliases`, escritos por
  `views.AplicarMapeoPlantillaView`). Si nunca hubo una confirmación manual, no hay nada que
  reaplicar — esa actualización se salta (no es un error del dashboard, simplemente todavía no
  tiene un mapeo de referencia).
- El parámetro `FechaCorte` (si el procedimiento lo usa) avanza solo, un período por fecha prevista
  (7 días para semanal, 1 mes para mensual) — si no avanzara, cada actualización automática
  traería exactamente los mismos datos que la anterior. Una corrida de recuperación lo avanza
  tantos períodos como se perdieron: avanzando uno solo, el dashboard se pondría al día en la
  ejecución pero nunca en los datos, y quedaría atrasado para siempre.
- Cualquier falla (conexión, columnas incompatibles con el mapeo guardado, etc.) se captura y se
  informa — nunca interrumpe la actualización del resto de los dashboards ni dispara ninguna
  excepción sin capturar hacia el comando.
"""

from contextlib import nullcontext
from datetime import date, timedelta

from dateutil.relativedelta import relativedelta
from django.conf import settings

from apps.empresas.contexto import usando_empresa

from ..exceptions import CarteraError
from ..models import CargaArchivo, Dashboard
from ..utils.archivos import asegurar_directorio
from . import db_source, historico, plantilla


def _dia_objetivo_del_mes(dia_ancla, anio, mes):
    """El día-del-mes ancla, recortado al último día real de ESE mes (ej. ancla=31 en un febrero
    de 28 días corre el 28) — necesario porque no todos los meses tienen la misma cantidad de
    días; no se pidió explícitamente qué hacer en ese caso, así que se toma el criterio más
    predecible (nunca "salta" al mes siguiente ni corre dos veces el mismo mes)."""
    ultimo_dia_del_mes = (date(anio, mes % 12 + 1, 1) - relativedelta(days=1)).day if mes < 12 else 31
    return min(dia_ancla, ultimo_dia_del_mes)


def _fecha_prevista_mas_reciente(dashboard, hoy):
    """La fecha más reciente, menor o igual a `hoy`, en la que le tocaba actualizarse.

    Es el corazón de la recuperación de corridas perdidas: preguntar "¿hoy es el día?" hacía que un
    domingo sin ejecutar (servidor apagado, tarea que no corrió) se saltara el período ENTERO, sin
    reintento y sin ninguna señal. Preguntando en cambio "¿pasó una fecha prevista desde la última
    vez?", el comando se pone al día en su siguiente ejecución, cualquier día que sea.

    `None` si la frecuencia no permite calcularla (mensual sin fecha de configuración).
    """
    frecuencia = dashboard.fuente_bd_frecuencia_actualizacion

    if frecuencia == Dashboard.FuenteBDFrecuencia.SEMANAL:
        # Domingo más reciente (hoy mismo si hoy es domingo). Python: lunes=0 .. domingo=6.
        return hoy - timedelta(days=(hoy.weekday() + 1) % 7)

    if frecuencia == Dashboard.FuenteBDFrecuencia.MENSUAL:
        ancla = dashboard.fuente_bd_fecha_configuracion
        if not ancla:
            return None
        objetivo_de_este_mes = date(hoy.year, hoy.month, _dia_objetivo_del_mes(ancla.day, hoy.year, hoy.month))
        if objetivo_de_este_mes <= hoy:
            return objetivo_de_este_mes
        anio, mes = (hoy.year, hoy.month - 1) if hoy.month > 1 else (hoy.year - 1, 12)
        return date(anio, mes, _dia_objetivo_del_mes(ancla.day, anio, mes))

    return None


def _referencia(dashboard):
    """Desde cuándo se mide el atraso: la última actualización automática o, si nunca hubo una, la
    fecha en que se configuró la frecuencia.

    Sin este respaldo, un dashboard recién configurado se actualizaría en la primera ejecución del
    comando en vez de esperar a su primera fecha prevista.
    """
    return dashboard.fuente_bd_ultima_actualizacion_automatica or dashboard.fuente_bd_fecha_configuracion


def periodos_pendientes(dashboard, hoy=None):
    """Cuántas fechas previstas pasaron sin ejecutarse. `0` si está al día.

    Importa además de decidir SI correr: el parámetro de fecha de corte avanza un período por
    ejecución, así que una corrida de recuperación tiene que avanzarlo tantos períodos como se
    perdieron. Avanzando uno solo, el dashboard quedaría atrasado para siempre — se pondría al día
    en la ejecución pero nunca en los datos.
    """
    hoy = hoy or date.today()
    if not dashboard.fuente_bd_nombre or not dashboard.fuente_bd_frecuencia_actualizacion:
        return 0
    prevista = _fecha_prevista_mas_reciente(dashboard, hoy)
    referencia = _referencia(dashboard)
    if prevista is None or referencia is None or referencia >= prevista:
        return 0

    if dashboard.fuente_bd_frecuencia_actualizacion == Dashboard.FuenteBDFrecuencia.SEMANAL:
        return (prevista - referencia).days // 7 + (1 if (prevista - referencia).days % 7 else 0)
    meses = (prevista.year - referencia.year) * 12 + (prevista.month - referencia.month)
    return max(1, meses)


def debe_actualizarse_hoy(dashboard, hoy=None):
    """`True` si a `dashboard` le toca una actualización automática — hoy o porque quedó atrasado.

    El nombre se conserva por compatibilidad con sus llamadores, pero la pregunta que responde ya no
    es "¿hoy es el día?" sino "¿pasó una fecha prevista desde la última actualización?". Ver
    `_fecha_prevista_mas_reciente` para por qué.
    """
    return periodos_pendientes(dashboard, hoy) > 0


def proxima_actualizacion(dashboard, hoy=None):
    """Próxima fecha (>= hoy) en la que le tocaría una actualización automática a `dashboard`, o
    `None` si no tiene fuente/frecuencia configurada — pura consulta, no ejecuta nada. La usa
    `DashboardAreaPage.jsx` (vía `services/dashboards.py::obtener_fuente_bd`) para mostrar "Próxima
    actualización automática: ...". Si quedó atrasado devuelve HOY, para no contradecir a
    `debe_actualizarse_hoy`, que ya lo va a actualizar en la próxima corrida del comando."""
    hoy = hoy or date.today()
    if not dashboard.fuente_bd_nombre or not dashboard.fuente_bd_frecuencia_actualizacion:
        return None
    # Atrasado: la próxima corrida del comando lo pone al día, así que la próxima fecha es hoy. Sin
    # esto la pantalla mostraría el domingo que viene mientras el comando ya piensa actualizarlo
    # esta misma noche — dos respuestas distintas a la misma pregunta.
    if periodos_pendientes(dashboard, hoy):
        return hoy
    ya_corrio_hoy = dashboard.fuente_bd_ultima_actualizacion_automatica == hoy

    if dashboard.fuente_bd_frecuencia_actualizacion == Dashboard.FuenteBDFrecuencia.SEMANAL:
        dias_hasta_domingo = (6 - hoy.weekday()) % 7  # 0 si hoy ya es domingo
        candidato = hoy + timedelta(days=dias_hasta_domingo)
        if candidato == hoy and ya_corrio_hoy:
            candidato += timedelta(days=7)
        return candidato

    if dashboard.fuente_bd_frecuencia_actualizacion == Dashboard.FuenteBDFrecuencia.MENSUAL:
        ancla = dashboard.fuente_bd_fecha_configuracion
        if not ancla:
            return None
        candidato = date(hoy.year, hoy.month, _dia_objetivo_del_mes(ancla.day, hoy.year, hoy.month))
        if candidato < hoy or (candidato == hoy and ya_corrio_hoy):
            anio_siguiente, mes_siguiente = (hoy.year, hoy.month + 1) if hoy.month < 12 else (hoy.year + 1, 1)
            candidato = date(anio_siguiente, mes_siguiente, _dia_objetivo_del_mes(ancla.day, anio_siguiente, mes_siguiente))
        return candidato

    return None


def avanzar_fecha_corte(parametros, frecuencia, periodos=1):
    """Devuelve una copia de `parametros` con su (único) parámetro de fecha de corte — si existe y
    es una fecha ISO válida — avanzada un período según `frecuencia`: 7 días para semanal, 1 mes
    calendario para mensual. El NOMBRE de ese parámetro es configurable (`ConectarFuenteBDModal.jsx`,
    "Nombre del parámetro", guardado como la única clave de `Dashboard.fuente_bd_parametros`) —
    esta función no asume "FechaCorte" a propósito, toma la primera (y hoy única) entrada del
    dict, sea cual sea su nombre. Cualquier valor no parseable como fecha ISO queda sin tocar (de
    mejor esfuerzo: un valor no-fecha no debe romper la actualización entera)."""
    if not parametros:
        return dict(parametros or {})
    nombre_parametro, valor = next(iter(parametros.items()))
    if not valor:
        return dict(parametros)
    try:
        fecha = date.fromisoformat(str(valor).strip())
    except ValueError:
        return dict(parametros)

    periodos = max(1, int(periodos or 1))
    if frecuencia == Dashboard.FuenteBDFrecuencia.SEMANAL:
        nueva_fecha = fecha + relativedelta(days=7 * periodos)
    elif frecuencia == Dashboard.FuenteBDFrecuencia.MENSUAL:
        nueva_fecha = fecha + relativedelta(months=periodos)
    else:
        return dict(parametros)

    return {**parametros, nombre_parametro: nueva_fecha.isoformat()}


def fijar_fecha_corte(parametros, fecha):
    """Copia de `parametros` con su (único) parámetro de fecha de corte reemplazado por `fecha`.

    Es la contraparte manual de `avanzar_fecha_corte`: "Actualizar ahora" solo se ofrece en
    dashboards SIN frecuencia, y sin frecuencia no hay período que avanzar — el procedimiento se
    volvía a ejecutar con la misma fecha de la vez anterior y devolvía los mismos datos, así que la
    fecha la elige quien pulsa el botón. Sin parámetros (una vista) no hay nada que reemplazar.
    """
    if not parametros:
        return dict(parametros or {})
    nombre_parametro = next(iter(parametros))
    return {**parametros, nombre_parametro: fecha.isoformat()}


def actualizar_dashboard(dashboard, hoy=None, fecha_corte=None):
    """Ejecuta UNA actualización automática para `dashboard` — asume que ya se determinó que
    corresponde hoy (`debe_actualizarse_hoy`), no lo vuelve a chequear. Nunca lanza: siempre
    devuelve `{'ok': bool, 'mensaje': str}` para que `manage.py actualizar_fuentes_bd` pueda seguir
    con el resto de los dashboards aunque este falle.

    `fecha_corte` (una `date`) la pasa "Actualizar ahora": reemplaza el parámetro de fecha en vez
    de avanzarlo por frecuencia (ver `fijar_fecha_corte`)."""
    hoy = hoy or date.today()

    if not dashboard.fuente_bd_ultimo_mapeo:
        return {
            'ok': False,
            'mensaje': 'Este dashboard nunca tuvo un mapeo confirmado manualmente '
                       '("Conectar vista de base de datos" al menos una vez) — no hay nada que reaplicar.',
        }

    # Avanza tantos períodos como se perdieron: una corrida de recuperación tiene que traer los
    # datos del período actual, no los del que quedó pendiente hace semanas.
    if fecha_corte is not None:
        parametros_nuevos = fijar_fecha_corte(dashboard.fuente_bd_parametros, fecha_corte)
    else:
        parametros_nuevos = avanzar_fecha_corte(
            dashboard.fuente_bd_parametros, dashboard.fuente_bd_frecuencia_actualizacion,
            periodos=max(1, periodos_pendientes(dashboard, hoy)),
        )

    try:
        df = db_source.leer_fuente(
            dashboard.fuente_bd_tipo, dashboard.fuente_bd_nombre, parametros_nuevos,
            fecha_formato=dashboard.fuente_bd_fecha_formato,
        )
        carga = db_source.crear_carga_temporal(
            dashboard.dashboard_id, df, f'{dashboard.fuente_bd_nombre} (actualización automática)',
            fecha_corte=db_source.fecha_corte_de_parametros(parametros_nuevos),
        )
        df = db_source.aplicar_alias_columnas(df, dashboard.fuente_bd_ultimo_aliases)

        plantilla.aplicar_mapeo(
            dashboard.dashboard_id, df, dashboard.fuente_bd_ultimo_mapeo,
            fecha_referencia=carga.fecha_corte,
        )

        nombre_permanente = f'{carga.id}.xlsx'
        ruta_permanente = asegurar_directorio(settings.CARTERA_ARCHIVOS_DIR) / nombre_permanente
        df.to_excel(ruta_permanente, index=False, sheet_name=db_source.HOJA_TEMPORAL)
        carga.archivo_permanente_nombre = nombre_permanente

        columnas_historicas = historico.columnas_historicas_configuradas(dashboard.dashboard_id)
        historico.guardar_filas_historicas(carga, df, columnas_historicas)

        carga.estado = CargaArchivo.Estado.PROCESADO
        carga.save(update_fields=['archivo_permanente_nombre', 'estado'])

        dashboard.fuente_bd_parametros = parametros_nuevos
        dashboard.fuente_bd_ultima_actualizacion_automatica = hoy
        dashboard.save(update_fields=['fuente_bd_parametros', 'fuente_bd_ultima_actualizacion_automatica'])

        return {'ok': True, 'mensaje': f'Actualizado con {len(df)} fila(s).'}
    except CarteraError as exc:
        return {'ok': False, 'mensaje': exc.message}
    except Exception as exc:  # noqa: BLE001 - cualquier falla inesperada no debe tumbar el comando completo
        return {'ok': False, 'mensaje': f'Error inesperado: {exc}'}


def actualizar_todos(hoy=None):
    """Recorre todos los dashboards con una frecuencia configurada y actualiza los que
    correspondan hoy — usado por `manage.py actualizar_fuentes_bd`. Devuelve la lista de
    resultados (uno por dashboard actualizado, con su `dashboard_id` incluido) para que el comando
    los reporte."""
    hoy = hoy or date.today()
    resultados = []
    # Sin petición no hay empresa activa y esto recorre las de todas. Cada dashboard se actualiza
    # dentro de la suya, para que lo que se crea y lo que se audita quede donde corresponde.
    dashboards = Dashboard.objects.todas().exclude(fuente_bd_frecuencia_actualizacion='').select_related('empresa')
    for dashboard in dashboards:
        if not debe_actualizarse_hoy(dashboard, hoy):
            continue
        with usando_empresa(dashboard.empresa) if dashboard.empresa_id else nullcontext():
            resultado = actualizar_dashboard(dashboard, hoy)
        resultados.append({'dashboard_id': dashboard.dashboard_id, **resultado})
    return resultados
