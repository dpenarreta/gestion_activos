"""Creación de dashboards por área. Cada dashboard es un contenedor (nombre/área/descripción) que
aloja el mismo pipeline de carga y cálculo de KPIs de cartera — ya no existe un único dashboard
especial con lógica propia: cualquier dashboard creado aquí puede eliminarse igual que cualquier
otro."""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from apps.cartera.compat import AuditEvent
from apps.cartera.compat import log_event

from ..exceptions import CarteraError
from ..models import CargaArchivo, ColumnaHistorica, Dashboard, DashboardLayout
from . import db_source, fuente_bd_scheduler, plantilla

User = get_user_model()

LONGITUD_MAXIMA_NOMBRE = 150
LONGITUD_MAXIMA_AREA = 100
LONGITUD_MAXIMA_DESCRIPCION = 300
LONGITUD_MAXIMA_CONTEXTO = 3000
# Máximo de pestañas por dashboard (la raíz cuenta como la primera) — sección "pestañas dentro de
# un mismo dashboard".
LIMITE_PESTANAS = 5


def _obtener_dashboard_o_error(dashboard_id):
    try:
        return Dashboard.objects.get(dashboard_id=dashboard_id)
    except Dashboard.DoesNotExist:
        raise CarteraError('El dashboard indicado no existe.', codigo='DASHBOARD_NO_ENCONTRADO')


def _generar_dashboard_id_unico(nombre):
    base = slugify(nombre)[:90] or 'dashboard'
    candidato = base
    sufijo = 2
    # `plantilla.DASHBOARD_ID_PLANTILLA_BASE` está reservado (la plantilla base personalizable de
    # "Configuración") — nunca corresponde a un `Dashboard` real, así que el chequeo de colisión
    # de arriba no lo vería como ocupado por sí solo.
    # El identificador es único en toda la base, no solo en la empresa activa, y
    # tampoco puede coincidir con un layout huérfano de otra empresa.
    while (
        Dashboard.objects.todas().filter(dashboard_id=candidato).exists()
        or DashboardLayout.objects.todas().filter(dashboard_id=candidato).exists()
        or candidato == plantilla.DASHBOARD_ID_PLANTILLA_BASE
    ):
        candidato = f'{base}-{sufijo}'
        sufijo += 1
    return candidato


def crear_dashboard(*, nombre, area='', descripcion='', contexto='', creado_por=None, request=None, parent=None, orden=1):
    nombre = (nombre or '').strip()
    if not nombre:
        raise CarteraError('El nombre del dashboard es obligatorio.', codigo='NOMBRE_REQUERIDO')
    if len(nombre) > LONGITUD_MAXIMA_NOMBRE:
        raise CarteraError(f'El nombre no puede superar los {LONGITUD_MAXIMA_NOMBRE} caracteres.', codigo='NOMBRE_DEMASIADO_LARGO')

    area = (area or '').strip()[:LONGITUD_MAXIMA_AREA]
    descripcion = (descripcion or '').strip()[:LONGITUD_MAXIMA_DESCRIPCION]
    contexto = (contexto or '').strip()[:LONGITUD_MAXIMA_CONTEXTO]

    dashboard_id = _generar_dashboard_id_unico(nombre)
    dashboard = Dashboard.objects.create(
        dashboard_id=dashboard_id, name=nombre, area=area, description=descripcion, contexto=contexto,
        created_by=creado_por, owner=creado_por, parent=parent, orden=orden,
    )
    # Todo dashboard nuevo (sea de nivel superior o una pestaña de otro) nace con las 13
    # posiciones fijas de la plantilla (4 KPI, 6 gráficos, 3 tablas) con datos ficticios — nunca
    # vacío. Al cargar un archivo real, esas mismas 13 posiciones se sobreescriben con datos
    # calculados de sus columnas (`plantilla.aplicar_mapeo`). La disposición/tipo de gráfico/
    # color/título de partida son los personalizados en "Configuración → Plantilla base", si los
    # hay (`sembrar_plantilla_desde_base`), o si no los de fábrica (patrón Z).
    plantilla.sembrar_plantilla_desde_base(dashboard_id)

    log_event(
        domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_CREATED',
        actor=creado_por, entity_type='dashboard', entity_id=dashboard.dashboard_id, entity_name=nombre,
        dashboard_id=dashboard.dashboard_id, new_values={'name': nombre, 'area': area},
        metadata={'parent_dashboard_id': parent.dashboard_id} if parent else {},
        request=request,
    )
    return dashboard


def crear_pestana(dashboard_id, *, nombre, actor=None, request=None):
    """Agrega una pestaña nueva (un `Dashboard` más, completamente independiente) a la familia
    del dashboard indicado — "+" en la barra de pestañas funciona igual sin importar en qué
    pestaña esté parado el usuario, siempre se cuelga de la raíz de la familia."""
    dashboard = _obtener_dashboard_o_error(dashboard_id)
    raiz = dashboard.parent or dashboard

    total_actual = 1 + raiz.pestanas.count()
    if total_actual >= LIMITE_PESTANAS:
        raise CarteraError(
            f'Un dashboard no puede tener más de {LIMITE_PESTANAS} pestañas.', codigo='MAXIMO_PESTANAS_ALCANZADO',
        )

    return crear_dashboard(
        nombre=nombre, area=raiz.area, creado_por=actor, request=request,
        parent=raiz, orden=total_actual + 1,
    )


def listar_pestanas(dashboard_id):
    """Todas las pestañas de la familia del dashboard indicado, la raíz primero — se puede llamar
    desde cualquier pestaña de la familia, no solo desde la raíz. Un dashboard sin pestañas
    adicionales todavía devuelve una lista de un elemento (él mismo): "si no hay ninguna, aparece
    la primera"."""
    return [serializar_pestana(d) for d in listar_pestanas_objetos(dashboard_id)]


def listar_pestanas_objetos(dashboard_id):
    """Igual que `listar_pestanas`, pero devuelve las instancias de `Dashboard` con sus roles ya
    prefetcheados — para que el llamador que además tenga que filtrar por acceso
    (`DashboardTabsView.get`) no dispare una consulta por pestaña al evaluar la ACL."""
    dashboard = _obtener_dashboard_o_error(dashboard_id)
    raiz = dashboard.parent or dashboard
    pestanas = raiz.pestanas.order_by('orden').prefetch_related('roles_editores', 'roles_lectores')
    raiz_con_roles = Dashboard.objects.prefetch_related('roles_editores', 'roles_lectores').get(pk=raiz.pk)
    return [raiz_con_roles, *pestanas]


def serializar_pestana(d):
    # Se incluye `area` (no solo `dashboard_id`/`name`/`orden`) para que renombrar una pestaña
    # (`DashboardTabsBar` → `PATCH /api/dashboards/<id>/`) pueda reenviar su área actual sin
    # borrarla — `actualizar_dashboard` sobreescribe el área con lo que reciba.
    return {'dashboard_id': d.dashboard_id, 'name': d.name, 'orden': d.orden, 'area': d.area}


def actualizar_dashboard(dashboard_id, *, nombre, area='', contexto='', actor=None, request=None):
    dashboard = _obtener_dashboard_o_error(dashboard_id)

    nombre = (nombre or '').strip()
    if not nombre:
        raise CarteraError('El nombre del dashboard es obligatorio.', codigo='NOMBRE_REQUERIDO')
    if len(nombre) > LONGITUD_MAXIMA_NOMBRE:
        raise CarteraError(f'El nombre no puede superar los {LONGITUD_MAXIMA_NOMBRE} caracteres.', codigo='NOMBRE_DEMASIADO_LARGO')

    area = (area or '').strip()[:LONGITUD_MAXIMA_AREA]
    contexto = (contexto or '').strip()[:LONGITUD_MAXIMA_CONTEXTO]

    valores_anteriores = {'name': dashboard.name, 'area': dashboard.area}
    dashboard.name = nombre
    dashboard.area = area
    dashboard.contexto = contexto
    dashboard.save(update_fields=['name', 'area', 'contexto'])

    log_event(
        domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_UPDATED',
        actor=actor, entity_type='dashboard', entity_id=dashboard.dashboard_id, entity_name=nombre,
        dashboard_id=dashboard.dashboard_id,
        previous_values=valores_anteriores, new_values={'name': nombre, 'area': area},
        request=request,
    )
    return dashboard


def obtener_fuente_bd(dashboard_id):
    dashboard = _obtener_dashboard_o_error(dashboard_id)
    ultima_carga = CargaArchivo.objects.filter(
        dashboard_id=dashboard_id, estado=CargaArchivo.Estado.PROCESADO,
    ).order_by('-fecha_carga').first()
    proxima = fuente_bd_scheduler.proxima_actualizacion(dashboard)
    return {
        'tipo': dashboard.fuente_bd_tipo, 'nombre': dashboard.fuente_bd_nombre,
        'parametros': dashboard.fuente_bd_parametros,
        'fecha_formato': dashboard.fuente_bd_fecha_formato,
        'frecuencia_actualizacion': dashboard.fuente_bd_frecuencia_actualizacion,
        # Día-del-mes ya anclado (`fuente_bd_fecha_configuracion.day`) cuando la frecuencia YA
        # es 'mensual' — el frontend lo usa para mostrar el día real en que corre, en vez de
        # asumir "hoy" (que solo es correcto si recién se está activando ahora).
        'dia_configuracion_mensual': (
            dashboard.fuente_bd_fecha_configuracion.day
            if dashboard.fuente_bd_frecuencia_actualizacion == Dashboard.FuenteBDFrecuencia.MENSUAL
            and dashboard.fuente_bd_fecha_configuracion else None
        ),
        # Para el indicador de estado bajo los botones (`DashboardAreaPage.jsx`): cuándo fue la
        # última vez que este dashboard recibió datos reales (de cualquier origen — Excel o base
        # de datos, manual o automático) y, si tiene una frecuencia automática configurada, cuándo
        # le toca la próxima (`services/fuente_bd_scheduler.py::proxima_actualizacion`).
        'ultima_actualizacion': ultima_carga.fecha_carga.date().isoformat() if ultima_carga else None,
        'proxima_actualizacion': proxima.isoformat() if proxima else None,
    }


def actualizar_fuente_bd(
    dashboard_id, *, tipo, nombre, parametros=None, fecha_formato='', frecuencia_actualizacion='', actor=None, request=None,
):
    """Configura (o quita, con `tipo=''`) la vista/procedimiento de la base de datos externa que
    alimenta este dashboard/pestaña puntual — separado de `actualizar_dashboard` (nombre/área/
    contexto) a propósito: se edita desde un lugar distinto de la UI (`DashboardAreaPage.jsx`, no
    el modal de "Editar dashboard" de la lista), así que no conviene que ambos PATCH/PUT tengan
    que reenviar los campos del otro para no pisarlos en blanco.

    `parametros` (`{nombre: valor}`, ambos string) solo tiene sentido con `tipo='procedimiento'`
    (`EXEC dbo.sp_x @nombre = ?`, ver `services/db_source.py::leer_fuente`) — se ignora en
    silencio con `tipo='vista'` (una vista nunca lleva parámetros), no es un error de validación
    porque el frontend simplemente no muestra esos campos para ese tipo.

    `fecha_formato` (uno de `Dashboard.FuenteBDFechaFormato`, o `''` = ISO) decide en qué formato
    de texto se envía el VALOR de `FechaCorte` al ejecutar el procedimiento — no cambia lo que
    queda guardado en `fuente_bd_parametros` (siempre ISO), solo cómo se reescribe recién al armar
    la consulta (`db_source.py::formatear_valor_fecha_corte`). Igual que `parametros`, solo tiene
    sentido con `tipo='procedimiento'`; con `tipo='vista'` se ignora en silencio.

    `frecuencia_actualizacion` ('', 'semanal' o 'mensual') activa la actualización automática sin
    intervención humana (`services/fuente_bd_scheduler.py`, disparada por
    `manage.py actualizar_fuentes_bd`). Al CAMBIAR la frecuencia (no al resimplemente reconfirmar
    la misma) se ancla `fuente_bd_fecha_configuracion` a hoy — "mensual" la usa como el día-del-mes
    que se repite todos los meses; reconectar manualmente sin tocar la frecuencia no mueve esa
    ancla. Sin `tipo`/`nombre` configurados no tiene sentido ninguna frecuencia automática."""
    dashboard = _obtener_dashboard_o_error(dashboard_id)

    tipo = (tipo or '').strip()
    nombre = (nombre or '').strip()
    tipos_validos = {choice.value for choice in Dashboard.FuenteBDTipo}
    if tipo and tipo not in tipos_validos:
        raise CarteraError('El tipo de fuente indicado no es válido.', codigo='FUENTE_BD_TIPO_INVALIDO')
    if bool(tipo) != bool(nombre):
        raise CarteraError(
            'Para configurar una fuente de base de datos hacen falta el tipo y el nombre juntos.',
            codigo='FUENTE_BD_INCOMPLETA',
        )
    if nombre:
        db_source.validar_nombre_fuente(nombre)

    parametros = parametros if tipo == 'procedimiento' and isinstance(parametros, dict) else {}
    parametros = {str(k).strip(): str(v).strip() for k, v in parametros.items() if str(k).strip()}
    for nombre_parametro in parametros:
        db_source.validar_nombre_parametro(nombre_parametro)

    fecha_formato = (fecha_formato or '').strip() if tipo == 'procedimiento' else ''
    formatos_validos = {choice.value for choice in Dashboard.FuenteBDFechaFormato}
    if fecha_formato and fecha_formato not in formatos_validos:
        raise CarteraError('El formato de fecha indicado no es válido.', codigo='FUENTE_BD_FECHA_FORMATO_INVALIDO')
    fecha_formato = fecha_formato or Dashboard.FuenteBDFechaFormato.ISO

    frecuencia_actualizacion = (frecuencia_actualizacion or '').strip()
    frecuencias_validas = {choice.value for choice in Dashboard.FuenteBDFrecuencia}
    if frecuencia_actualizacion and frecuencia_actualizacion not in frecuencias_validas:
        raise CarteraError('La frecuencia de actualización indicada no es válida.', codigo='FUENTE_BD_FRECUENCIA_INVALIDA')
    if frecuencia_actualizacion and not nombre:
        raise CarteraError(
            'Hace falta configurar la vista/procedimiento antes de activar la actualización automática.',
            codigo='FUENTE_BD_FRECUENCIA_SIN_FUENTE',
        )

    valores_anteriores = {
        'fuente_bd_tipo': dashboard.fuente_bd_tipo, 'fuente_bd_nombre': dashboard.fuente_bd_nombre,
        'fuente_bd_parametros': dashboard.fuente_bd_parametros,
        'fuente_bd_fecha_formato': dashboard.fuente_bd_fecha_formato,
        'fuente_bd_frecuencia_actualizacion': dashboard.fuente_bd_frecuencia_actualizacion,
    }
    dashboard.fuente_bd_tipo = tipo
    dashboard.fuente_bd_nombre = nombre
    dashboard.fuente_bd_parametros = parametros
    dashboard.fuente_bd_fecha_formato = fecha_formato
    campos_a_guardar = ['fuente_bd_tipo', 'fuente_bd_nombre', 'fuente_bd_parametros', 'fuente_bd_fecha_formato']
    if frecuencia_actualizacion != dashboard.fuente_bd_frecuencia_actualizacion:
        dashboard.fuente_bd_frecuencia_actualizacion = frecuencia_actualizacion
        dashboard.fuente_bd_fecha_configuracion = timezone.now().date() if frecuencia_actualizacion else None
        campos_a_guardar += ['fuente_bd_frecuencia_actualizacion', 'fuente_bd_fecha_configuracion']
    dashboard.save(update_fields=campos_a_guardar)

    log_event(
        domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_FUENTE_BD_ACTUALIZADA',
        actor=actor, entity_type='dashboard', entity_id=dashboard.dashboard_id, entity_name=dashboard.name,
        dashboard_id=dashboard.dashboard_id, previous_values=valores_anteriores,
        new_values={
            'fuente_bd_tipo': tipo, 'fuente_bd_nombre': nombre, 'fuente_bd_parametros': parametros,
            'fuente_bd_fecha_formato': fecha_formato,
            'fuente_bd_frecuencia_actualizacion': dashboard.fuente_bd_frecuencia_actualizacion,
        },
        request=request,
    )
    return {
        'tipo': dashboard.fuente_bd_tipo, 'nombre': dashboard.fuente_bd_nombre, 'parametros': dashboard.fuente_bd_parametros,
        'fecha_formato': dashboard.fuente_bd_fecha_formato,
        'frecuencia_actualizacion': dashboard.fuente_bd_frecuencia_actualizacion,
    }


def borrar_datos_dashboard(dashboard_id, *, confirmacion_nombre, actor=None, request=None):
    """Borra TODA la información con datos reales de este dashboard/pestaña puntual — cargas de
    Excel (con su histórico y columnas marcadas como históricas), la conexión a base de datos
    configurada (vista/procedimiento/parámetros/frecuencia automática) y los componentes que el
    usuario haya agregado a mano en "Zona Personal" — y vuelve a sembrar las 13 posiciones fijas
    de la plantilla con datos de ejemplo (`plantilla.sembrar_plantilla_desde_base`), como un
    dashboard recién creado. A diferencia de `eliminar_dashboard`, el `Dashboard` en sí (nombre,
    área, permisos, pestañas) NO se toca — solo su contenido.

    Mismo criterio de confirmación que `eliminar_dashboard` (escribir el nombre exacto): es más
    destructivo que "Restablecer diseño" (que solo cambia visibilidad), así que un clic accidental
    no alcanza para dispararlo."""
    dashboard = _obtener_dashboard_o_error(dashboard_id)

    if (confirmacion_nombre or '').strip() != dashboard.name:
        raise CarteraError(
            'El nombre ingresado no coincide con el nombre del dashboard.', codigo='CONFIRMACION_INVALIDA',
        )

    with transaction.atomic():
        CargaArchivo.objects.filter(dashboard_id=dashboard_id).delete()
        ColumnaHistorica.objects.filter(dashboard_id=dashboard_id).delete()
        # Cascada a `DashboardComponent` (incluida cualquier "Zona Personal") — se recrea vacía
        # abajo, sin nada que preservar, a diferencia de `plantilla.sembrar_plantilla_desde_base`
        # cuando se usa para recargar un archivo nuevo.
        DashboardLayout.objects.filter(dashboard_id=dashboard_id).delete()

        dashboard.fuente_bd_tipo = ''
        dashboard.fuente_bd_nombre = ''
        dashboard.fuente_bd_parametros = {}
        dashboard.fuente_bd_fecha_formato = Dashboard.FuenteBDFechaFormato.ISO
        dashboard.fuente_bd_frecuencia_actualizacion = ''
        dashboard.fuente_bd_fecha_configuracion = None
        dashboard.fuente_bd_ultima_actualizacion_automatica = None
        dashboard.fuente_bd_ultimo_mapeo = {}
        dashboard.fuente_bd_ultimo_aliases = {}
        dashboard.save(update_fields=[
            'fuente_bd_tipo', 'fuente_bd_nombre', 'fuente_bd_parametros', 'fuente_bd_fecha_formato',
            'fuente_bd_frecuencia_actualizacion', 'fuente_bd_fecha_configuracion',
            'fuente_bd_ultima_actualizacion_automatica', 'fuente_bd_ultimo_mapeo', 'fuente_bd_ultimo_aliases',
        ])

        plantilla.sembrar_plantilla_desde_base(dashboard_id)

    log_event(
        domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_DATOS_BORRADOS',
        actor=actor, entity_type='dashboard', entity_id=dashboard.dashboard_id, entity_name=dashboard.name,
        dashboard_id=dashboard.dashboard_id, request=request,
    )


def eliminar_dashboard(dashboard_id, *, confirmacion_nombre, actor=None, request=None):
    dashboard = _obtener_dashboard_o_error(dashboard_id)

    if (confirmacion_nombre or '').strip() != dashboard.name:
        raise CarteraError(
            'El nombre ingresado no coincide con el nombre del dashboard.', codigo='CONFIRMACION_INVALIDA',
        )

    nombre, area = dashboard.name, dashboard.area

    log_event(
        domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_DELETED',
        actor=actor, entity_type='dashboard', entity_id=dashboard.dashboard_id, entity_name=nombre,
        dashboard_id=dashboard.dashboard_id, previous_values={'name': nombre, 'area': area},
        request=request,
    )

    with transaction.atomic():
        # Si `dashboard` es una raíz con pestañas, `dashboard.delete()` va a borrar esas filas
        # `Dashboard` hijas también (on_delete=CASCADE), pero no sabe de `CargaArchivo`/
        # `DashboardLayout` (solo se relacionan por el string `dashboard_id`, no por FK) — hay que
        # limpiarlas a mano por cada pestaña, igual que ya se hace para la raíz misma, para no
        # dejar datos huérfanos.
        ids_a_limpiar = [dashboard.dashboard_id, *dashboard.pestanas.values_list('dashboard_id', flat=True)]
        CargaArchivo.objects.filter(dashboard_id__in=ids_a_limpiar).delete()
        DashboardLayout.objects.filter(dashboard_id__in=ids_a_limpiar).delete()
        dashboard.delete()


def obtener_acceso(dashboard_id):
    """Estado actual del control de acceso de un dashboard (control de acceso por dashboard):
    quién es su dueño y qué roles están en cada uno de los 2 grupos (`roles_editores` puede ver Y
    editar, `roles_lectores` solo puede ver). Un dashboard sin ningún rol asignado en ninguno de
    los 2 grupos no tiene ACL activa — se sigue autorizando por el permiso global de siempre (ver
    `cartera/permisos.py::tiene_acceso_dashboard`)."""
    dashboard = _obtener_dashboard_o_error(dashboard_id)
    return {
        'dashboard_id': dashboard.dashboard_id,
        'owner': {'id': dashboard.owner_id, 'username': dashboard.owner.username} if dashboard.owner_id else None,
        'roles_editores': [{'id': g.id, 'name': g.name} for g in dashboard.roles_editores.order_by('name')],
        'roles_lectores': [{'id': g.id, 'name': g.name} for g in dashboard.roles_lectores.order_by('name')],
    }


def actualizar_acceso(dashboard_id, *, roles_editores_ids, roles_lectores_ids, actor=None, request=None):
    """Reemplaza los 2 grupos de roles de un dashboard — reservado al dueño o al superusuario
    (`permisos.puede_administrar_acceso`, verificado por el llamador). Un rol no puede estar en
    los 2 grupos a la vez: `roles_editores` ya incluye la capacidad de ver, así que repetirlo en
    `roles_lectores` es ambiguo, no un caso a resolver en silencio."""
    dashboard = _obtener_dashboard_o_error(dashboard_id)

    try:
        editores_ids = {int(i) for i in (roles_editores_ids or [])}
        lectores_ids = {int(i) for i in (roles_lectores_ids or [])}
    except (TypeError, ValueError):
        raise CarteraError('Los roles indicados no son válidos.', codigo='ROL_INVALIDO')
    solapados = editores_ids & lectores_ids
    if solapados:
        raise CarteraError(
            'Un rol no puede estar en los dos grupos a la vez.', codigo='ROL_DUPLICADO',
        )

    editores = list(Group.objects.filter(pk__in=editores_ids))
    lectores = list(Group.objects.filter(pk__in=lectores_ids))
    if len(editores) != len(editores_ids) or len(lectores) != len(lectores_ids):
        raise CarteraError('Alguno de los roles indicados no existe.', codigo='ROL_NO_ENCONTRADO')

    valores_anteriores = {
        'roles_editores': sorted(dashboard.roles_editores.values_list('id', flat=True)),
        'roles_lectores': sorted(dashboard.roles_lectores.values_list('id', flat=True)),
    }
    dashboard.roles_editores.set(editores)
    dashboard.roles_lectores.set(lectores)

    log_event(
        domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_ACCESO_ACTUALIZADO',
        actor=actor, entity_type='dashboard', entity_id=dashboard.dashboard_id, entity_name=dashboard.name,
        dashboard_id=dashboard.dashboard_id, previous_values=valores_anteriores,
        new_values={'roles_editores': sorted(editores_ids), 'roles_lectores': sorted(lectores_ids)},
        request=request,
    )
    return obtener_acceso(dashboard_id)


def reasignar_dueno(dashboard_id, *, nuevo_dueno_id, actor=None, request=None):
    """Reasigna el dueño de un dashboard — reservado al superusuario (verificado por el llamador,
    `DashboardDuenoView`, gateado con `IsSuperuser`). `nuevo_dueno_id=None` desasigna el dueño."""
    dashboard = _obtener_dashboard_o_error(dashboard_id)

    nuevo_dueno = None
    if nuevo_dueno_id:
        try:
            nuevo_dueno = User.objects.get(pk=nuevo_dueno_id)
        except User.DoesNotExist:
            raise CarteraError('El usuario indicado no existe.', codigo='USUARIO_NO_ENCONTRADO')

    dueno_anterior_id = dashboard.owner_id
    dashboard.owner = nuevo_dueno
    dashboard.save(update_fields=['owner'])

    log_event(
        domain=AuditEvent.Domain.DASHBOARD_CONFIGURATION, action='DASHBOARD_DUENO_REASIGNADO',
        actor=actor, entity_type='dashboard', entity_id=dashboard.dashboard_id, entity_name=dashboard.name,
        dashboard_id=dashboard.dashboard_id, previous_values={'owner_id': dueno_anterior_id},
        new_values={'owner_id': nuevo_dueno.id if nuevo_dueno else None},
        request=request,
    )
    return obtener_acceso(dashboard_id)
