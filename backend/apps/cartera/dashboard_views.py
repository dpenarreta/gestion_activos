from urllib.parse import quote

from django.http import HttpResponse
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.cartera.compat import MODULOS_ANTERIORES, AuditEvent, detalle_de
from apps.cartera.compat import MODULO as MODULO_AUDITORIA
from apps.core.models import AuditLog
from apps.cartera.compat import IsSuperuser, require_permission

from . import dashboard_registry, permisos
from .exceptions import CarteraError
from .services import consulta_deudor, dashboard_interpretation, desbloqueo, descarga_datos
from .services import dashboard_layout as dl
from .services import dashboards as dashboards_service


def _permisos_respuesta(request):
    return permisos.permisos_del_usuario(request)


def _denegado(request, dashboard_id, permiso, mensaje):
    """Respuesta 403 + registro de auditoría, en un solo lugar.

    Antes cada vista de este archivo devolvía su `Response(..., 403)` sin auditar nada, así que
    los rechazos sobre dashboards con ACL no dejaban rastro (ver
    `permisos.registrar_acceso_denegado`).
    """
    permisos.registrar_acceso_denegado(request, dashboard_id, permiso)
    return Response({"error": "PERMISO_DENEGADO", "mensaje": mensaje}, status=403)


def _etiqueta_actor(request):
    """Nombre a mostrar en el historial de versiones del layout.

    Se deriva de `request.user`, nunca del cuerpo de la petición. Antes venía en
    `request.data['changed_by']` y `DashboardVersionsView` lo mostraba ANTES que `actor_username`,
    así que cualquiera que pudiera guardar un layout podía firmarlo con el nombre de otra persona
    y esa era la atribución que veía quien consultaba el historial.
    """
    usuario = getattr(request, "user", None)
    if not usuario or not getattr(usuario, "is_authenticated", False):
        return "Anónimo"
    nombre = (usuario.get_full_name() or "").strip()
    return (nombre or usuario.username)[:150]


class DashboardLayoutView(APIView):
    def get(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request, dashboard_id, permiso_global=permisos.DASHBOARD_VIEW
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_VIEW,
                "No tiene permiso para ver este dashboard.",
            )

        layout = dl.obtener_o_crear_layout(dashboard_id)
        return Response({**dl.serializar_layout(layout), "permisos": _permisos_respuesta(request)})

    def put(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request,
            dashboard_id,
            permiso_global=permisos.DASHBOARD_LAYOUT_EDIT,
            requiere_edicion=True,
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_LAYOUT_EDIT,
                "No tiene permiso para editar el layout.",
            )

        version_recibida = request.data.get("version")
        if version_recibida is None:
            raise CarteraError(
                "Se requiere la versión del layout que se está editando.",
                codigo="VERSION_REQUERIDA",
            )

        layout_actual = dl.obtener_o_crear_layout(dashboard_id)
        if int(version_recibida) != layout_actual.version:
            return Response(
                {
                    "error": "CONFLICTO_DE_VERSION",
                    "mensaje": "Existe una versión más reciente de este dashboard. Recargue antes de guardar.",
                    **dl.serializar_layout(layout_actual),
                },
                status=409,
            )

        # La confirmación se resuelve ANTES de validar, pero no se exige acá: `validar_componentes`
        # es quien sabe si el cambio entrante toca la estructura o solo el título/los datos, y a
        # quien solo renombró una sección no hay que pedirle la contraseña.
        confirmado = desbloqueo.confirmacion_valida(request, dashboard_id, "cambiar el diseño")
        componentes = dl.validar_componentes(
            dashboard_id,
            request.data.get("components") or [],
            es_superusuario=request.user.is_superuser,
            desbloqueo_confirmado=confirmado,
        )
        changed_by = _etiqueta_actor(request)
        layout = dl.aplicar_layout(
            dashboard_id, componentes, changed_by, actor=request.user, request=request
        )

        return Response(dl.serializar_layout(layout))


class DashboardComponentePresentacionalView(APIView):
    """`POST /api/dashboards/<dashboard_id>/componentes-presentacionales` — agrega un componente
    de solo presentación (título o separador, panel lateral de componentes del editor de
    dashboard, sección "Zona Personal") sin necesitar ningún archivo cargado — a diferencia de
    `AgregarGraficaView` (`cartera/views.py`), que sí lo requiere para calcular datos."""

    def post(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request,
            dashboard_id,
            permiso_global=permisos.DASHBOARD_LAYOUT_EDIT,
            requiere_edicion=True,
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_LAYOUT_EDIT,
                "No tiene permiso para editar el layout.",
            )

        desbloqueo.exigir_desbloqueo(request, dashboard_id, "agregar un componente")

        tipo = request.data.get("tipo")
        ancho_columnas = request.data.get("ancho_columnas") or None
        zona = request.data.get("zona") or None
        layout = dl.agregar_componente_presentacional(
            dashboard_id,
            tipo,
            ancho_columnas=ancho_columnas,
            zona=zona,
            actor=request.user,
            request=request,
        )
        return Response(dl.serializar_layout(layout), status=201)


class DashboardLayoutResetView(APIView):
    def post(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request,
            dashboard_id,
            permiso_global=permisos.DASHBOARD_CONFIGURATION_RESET,
            requiere_edicion=True,
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_CONFIGURATION_RESET,
                "No tiene permiso para restablecer el diseño.",
            )

        desbloqueo.exigir_desbloqueo(request, dashboard_id, "restablecer el diseño")

        changed_by = _etiqueta_actor(request)
        layout = dl.restablecer_layout(
            dashboard_id, changed_by, actor=request.user, request=request
        )
        return Response(dl.serializar_layout(layout))


class DashboardsAuthorizedView(APIView):
    """`GET /api/dashboards/authorized` — solo los dashboards que el usuario autenticado puede
    ver (nunca hardcodeado en el frontend, sección 13 de la integración con skelleton_base)."""

    def get(self, request):
        return Response(dashboard_registry.dashboards_autorizados(request))


class DashboardCreateView(APIView):
    """`POST /api/dashboards/` — crea un dashboard nuevo por área (solo el contenedor: nombre,
    área y un `dashboard_id` único generado a partir del nombre; sin procesamiento de datos
    propio, alcance acotado explícitamente por el usuario)."""

    permission_classes = [require_permission(permisos.DASHBOARD_CREAR)]

    def post(self, request):
        dashboard = dashboards_service.crear_dashboard(
            nombre=request.data.get("name"),
            area=request.data.get("area", ""),
            descripcion=request.data.get("description", ""),
            contexto=request.data.get("contexto", ""),
            creado_por=request.user,
            request=request,
        )
        return Response(
            {
                "dashboard_id": dashboard.dashboard_id,
                "name": dashboard.name,
                "area": dashboard.area,
                "description": dashboard.description,
                "contexto": dashboard.contexto,
            },
            status=201,
        )


class DashboardDetailView(APIView):
    """`PATCH`/`DELETE /api/dashboards/<dashboard_id>/` — edición (nombre/área) y eliminación de
    un dashboard por área.

    Ambos métodos combinan el permiso global del catálogo CON el control de acceso por dashboard
    (`tiene_acceso_dashboard(..., requiere_edicion=True)`), igual que el resto de las mutaciones
    de este archivo. Antes consultaban solo `tiene_permiso`, así que eran la única excepción: quien
    tuviera `dashboard.eliminar` global podía borrar un dashboard cuya ACL lo excluía
    explícitamente — el dueño configuraba el acceso para restringirlo y la restricción no aplicaba
    justo a la acción más destructiva.
    """

    def patch(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request,
            dashboard_id,
            permiso_global=permisos.DASHBOARD_EDITAR,
            requiere_edicion=True,
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_EDITAR,
                "No tiene permiso para editar dashboards.",
            )

        dashboard = dashboards_service.actualizar_dashboard(
            dashboard_id,
            nombre=request.data.get("name"),
            area=request.data.get("area", ""),
            contexto=request.data.get("contexto", ""),
            actor=request.user,
            request=request,
        )
        return Response(
            {
                "dashboard_id": dashboard.dashboard_id,
                "name": dashboard.name,
                "area": dashboard.area,
                "contexto": dashboard.contexto,
            }
        )

    def delete(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request,
            dashboard_id,
            permiso_global=permisos.DASHBOARD_ELIMINAR,
            requiere_edicion=True,
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_ELIMINAR,
                "No tiene permiso para eliminar dashboards.",
            )

        dashboards_service.eliminar_dashboard(
            dashboard_id,
            confirmacion_nombre=request.data.get("confirmation_name", ""),
            actor=request.user,
            request=request,
        )
        return Response(status=204)


class DashboardTabsView(APIView):
    """`GET`/`POST /api/dashboards/<dashboard_id>/pestanas` — las pestañas del dashboard indicado
    (siempre incluye al menos la raíz misma, aunque no tenga ninguna pestaña adicional) y la
    creación de una pestaña nueva. Cada pestaña es un `Dashboard` independiente (su propia
    plantilla de 13 posiciones, su propio archivo) — ver `services/dashboards.py::crear_pestana`/
    `listar_pestanas`."""

    def get(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request, dashboard_id, permiso_global=permisos.DASHBOARD_VIEW
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_VIEW,
                "No tiene permiso para ver este dashboard.",
            )
        # La familia completa puede incluir pestañas con su propia ACL más restrictiva que la de
        # esta — no tendría sentido que la barra de pestañas enlace a una a la que el usuario no
        # tiene acceso. Se piden las instancias (no los dicts) y se pasa cada una a
        # `tiene_acceso_dashboard`, para no volver a consultar por pestaña al evaluar la ACL.
        familia = dashboards_service.listar_pestanas_objetos(dashboard_id)
        visibles = [
            dashboards_service.serializar_pestana(d)
            for d in familia
            if permisos.tiene_acceso_dashboard(
                request,
                d.dashboard_id,
                permiso_global=permisos.DASHBOARD_VIEW,
                dashboard=d,
            )
        ]
        return Response(visibles)

    def post(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request, dashboard_id, permiso_global=permisos.DASHBOARD_CREAR, requiere_edicion=True
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_CREAR,
                "No tiene permiso para crear dashboards.",
            )
        dashboard = dashboards_service.crear_pestana(
            dashboard_id,
            nombre=request.data.get("name"),
            actor=request.user,
            request=request,
        )
        return Response(
            {
                "dashboard_id": dashboard.dashboard_id,
                "name": dashboard.name,
                "orden": dashboard.orden,
            },
            status=201,
        )


class DashboardFuenteBDView(APIView):
    """`GET`/`PUT /api/dashboards/<dashboard_id>/fuente-bd` — la vista o stored procedure de la
    conexión externa "por defecto" (`EXTERNAL_DB_*`, ver `services/db_source.py`) que alimenta a
    ESTE dashboard/pestaña puntual, si tiene una configurada — incluye `frecuencia_actualizacion`
    ('', 'semanal' o 'mensual', ver `services/fuente_bd_scheduler.py`) y `fecha_formato` (uno de
    `Dashboard.FuenteBDFechaFormato`, cómo se envía el valor de `FechaCorte` al procedimiento).
    `GET` solo requiere poder
    ver el dashboard (lo usa `DashboardAreaPage.jsx` para decidir si habilitar el botón "Conectar
    vista de base de datos"); `PUT` requiere `dashboard.fuente_bd.configurar` (permiso dedicado,
    separado de `dashboard.editar` porque expone a qué vista/procedimiento de la base productiva
    apunta el dashboard, no solo su nombre/área) y respeta el control de acceso por-dashboard
    (`tiene_acceso_dashboard(..., requiere_edicion=True)`), igual que el resto de las mutaciones
    de datos — antes caía solo a un permiso global ciego al ACL, inconsistente con
    `ConectarFuenteBDView`/`ActualizarFuenteBDAhoraView`."""

    def get(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request, dashboard_id, permiso_global=permisos.DASHBOARD_VIEW
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_VIEW,
                "No tiene permiso para ver este dashboard.",
            )
        return Response(dashboards_service.obtener_fuente_bd(dashboard_id))

    def put(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request,
            dashboard_id,
            permiso_global=permisos.DASHBOARD_FUENTE_BD_CONFIGURAR,
            requiere_edicion=True,
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_FUENTE_BD_CONFIGURAR,
                "No tiene permiso para configurar la fuente de base de datos.",
            )
        return Response(
            dashboards_service.actualizar_fuente_bd(
                dashboard_id,
                tipo=request.data.get("tipo", ""),
                nombre=request.data.get("nombre", ""),
                parametros=request.data.get("parametros"),
                fecha_formato=request.data.get("fecha_formato", ""),
                frecuencia_actualizacion=request.data.get("frecuencia_actualizacion", ""),
                actor=request.user,
                request=request,
            )
        )


class DashboardBorrarDatosView(APIView):
    """`POST /api/dashboards/<dashboard_id>/borrar-datos` — borra TODA la información con datos
    reales de este dashboard/pestaña puntual (cargas de Excel, histórico, conexión a base de
    datos, componentes de "Zona Personal") y vuelve a sembrar las 13 posiciones fijas con datos de
    ejemplo, como un dashboard recién creado (`services/dashboards.py::borrar_datos_dashboard`). El
    `Dashboard` en sí (nombre/área/permisos/pestañas) no se toca. Gatillado desde "Conectar vista
    de base de datos" (`ConectarFuenteBDModal.jsx`) — reusa `dashboard.configuration.reset`, el
    mismo permiso ya dedicado a acciones de "restablecer" destructivas de este dashboard (hoy solo
    usado por "Restablecer diseño"), en vez de introducir uno nuevo. Requiere escribir el nombre
    exacto del dashboard como confirmación (`confirmation_name`), igual que
    `DashboardDetailView.delete` — es más destructivo que "Restablecer diseño" (que solo cambia
    visibilidad), así que un clic accidental no debe alcanzar para dispararlo."""

    def post(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request,
            dashboard_id,
            permiso_global=permisos.DASHBOARD_CONFIGURATION_RESET,
            requiere_edicion=True,
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_CONFIGURATION_RESET,
                "No tiene permiso para borrar los datos de este dashboard.",
            )
        # La puerta más destructiva de todas: además de los datos se lleva los componentes de la
        # Zona Personal —que en el Dashboard Directorio son TODO el informe— y resiembra las 13
        # posiciones de ejemplo. Escribir el nombre del dashboard no alcanza cuando el diseño está
        # bloqueado: ya pasó una vez, y el dashboard quedó convertido en el genérico.
        desbloqueo.exigir_desbloqueo(request, dashboard_id, "borrar los datos de este dashboard")
        dashboards_service.borrar_datos_dashboard(
            dashboard_id,
            confirmacion_nombre=request.data.get("confirmation_name", ""),
            actor=request.user,
            request=request,
        )
        return Response(status=204)


class DashboardAccesoView(APIView):
    """`GET`/`PUT /api/dashboards/<dashboard_id>/acceso` — control de acceso por dashboard: los 2
    grupos de roles (`roles_editores` puede ver y editar, `roles_lectores` solo puede ver) y quién
    es el dueño actual. Editar esta configuración está reservado al dueño o al superusuario
    (`permisos.puede_administrar_acceso`) — a propósito no cae a ningún permiso global del
    catálogo, ni siquiera `dashboard.editar`."""

    def get(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request, dashboard_id, permiso_global=permisos.DASHBOARD_VIEW
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_VIEW,
                "No tiene permiso para ver este dashboard.",
            )
        return Response(dashboards_service.obtener_acceso(dashboard_id))

    def put(self, request, dashboard_id):
        if not permisos.puede_administrar_acceso(request, dashboard_id):
            return _denegado(
                request,
                dashboard_id,
                "dashboard.acceso.administrar",
                "Solo el dueño o un superusuario pueden editar el acceso de este dashboard.",
            )
        return Response(
            dashboards_service.actualizar_acceso(
                dashboard_id,
                roles_editores_ids=request.data.get("roles_editores") or [],
                roles_lectores_ids=request.data.get("roles_lectores") or [],
                actor=request.user,
                request=request,
            )
        )


class DashboardDuenoView(APIView):
    """`PATCH /api/dashboards/<dashboard_id>/dueno` — reasigna el dueño de un dashboard. Reservado
    al superusuario, ni siquiera el dueño actual puede reasignarse a otra persona (mismo criterio
    que conceder superusuario, ver `apps/permissions/permissions.py::IsSuperuser`)."""

    permission_classes = [IsSuperuser]

    def patch(self, request, dashboard_id):
        dashboards_service.reasignar_dueno(
            dashboard_id,
            nuevo_dueno_id=request.data.get("owner_id"),
            actor=request.user,
            request=request,
        )
        return Response(dashboards_service.obtener_acceso(dashboard_id))


class DashboardInterpretacionView(APIView):
    """`POST /api/dashboards/<dashboard_id>/interpretacion` — interpretación completa del
    dashboard generada por IA (Gemini) a partir de los datos ya calculados de sus componentes
    visibles. Operación de solo lectura (no muta el layout): exige primero poder ver el dashboard
    (`tiene_acceso_dashboard`, respeta ACL por-dashboard) y además el permiso global dedicado
    `dashboard.interpretar` — separado de `DASHBOARD_VIEW` a propósito, para poder otorgar/quitar
    el uso de IA sin tocar quién puede ver el dashboard (control de costo del LLM). Ver
    `services/dashboard_interpretation.py`.

    `ScopedRateThrottle` con el scope `ia`: cada llamada cuesta dinero y ocupa un hilo del
    servidor hasta 45 segundos, así que tener el permiso no debería habilitar un uso ilimitado."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "ia"

    def post(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request, dashboard_id, permiso_global=permisos.DASHBOARD_VIEW
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_VIEW,
                "No tiene permiso para ver este dashboard.",
            )
        if not permisos.tiene_permiso(request, permisos.DASHBOARD_INTERPRETAR):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_INTERPRETAR,
                "No tiene permiso para generar interpretaciones con IA.",
            )

        texto = dashboard_interpretation.generar_interpretacion(dashboard_id)
        return Response({"interpretacion": texto})


class DashboardHallazgosIAView(APIView):
    """`POST /api/dashboards/<dashboard_id>/hallazgos-ia` — hallazgo clave por componente
    (KPI/gráfico/tabla) generado por IA en un único llamado batch a Gemini (no uno por
    componente). Mismo patrón en dos pasos que `DashboardInterpretacionView`: acceso al dashboard
    primero, y además el permiso dedicado `dashboard.hallazgos_ia` (distinto de
    `dashboard.interpretar` — esta llamada se dispara automáticamente al abrir/guardar el
    dashboard, no por una acción explícita, así que conviene poder controlarla aparte). Ver
    `services/dashboard_interpretation.py::generar_hallazgos_ia`.

    Mismo tope de tasa (`ia`) que `DashboardInterpretacionView`, y con más razón: esta llamada la
    dispara la propia pantalla al abrirse, no un clic. El servicio además cachea el resultado por
    versión de layout, así que recargar el dashboard ya no repite la llamada externa."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "ia"

    def post(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request, dashboard_id, permiso_global=permisos.DASHBOARD_VIEW
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_VIEW,
                "No tiene permiso para ver este dashboard.",
            )
        if not permisos.tiene_permiso(request, permisos.DASHBOARD_HALLAZGOS_IA):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_HALLAZGOS_IA,
                "No tiene permiso para generar hallazgos con IA.",
            )

        hallazgos = dashboard_interpretation.generar_hallazgos_ia(dashboard_id)
        return Response({"hallazgos": hallazgos})


class DashboardVersionsView(APIView):
    def get(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request, dashboard_id, permiso_global=permisos.DASHBOARD_VIEW
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_VIEW,
                "No tiene permiso para ver este dashboard.",
            )

        # Los eventos viven en la bitácora del sistema (`compat.log_event`): se
        # leen los del dashboard y se quedan los de diseño y configuración.
        dominios = {AuditEvent.Domain.DASHBOARD_LAYOUT, AuditEvent.Domain.DASHBOARD_CONFIGURATION}
        registros = (
            AuditLog.objects.select_related("actor")
            .filter(
                module__in=(MODULO_AUDITORIA, *MODULOS_ANTERIORES),
                target_type="dashboard",
                target_id=dashboard_id,
            )
            .order_by("-created_at", "-id")
        )
        filas = []
        for registro in registros.iterator():
            detalle = detalle_de(registro)
            if detalle.get("dominio") not in dominios:
                continue
            metadata = detalle.get("metadata") or {}
            filas.append(
                {
                    "component_id": detalle.get("component_id", ""),
                    "change_type": registro.action,
                    # El actor real (resuelto por la clave foránea) manda sobre la etiqueta guardada
                    # en `metadata`: esa etiqueta la mandaba antes el cliente en el cuerpo de la
                    # petición, así que las filas históricas pueden traer un nombre elegido por quien
                    # guardó el layout.
                    "changed_by": (registro.actor.username if registro.actor else "")
                    or metadata.get("changed_by_label")
                    or "Anónimo",
                    "changed_at": registro.created_at.isoformat(),
                    "version": metadata.get("version"),
                }
            )
            if len(filas) == 50:
                break
        return Response(filas)


class DashboardDescargarDatosView(APIView):
    """`GET /api/dashboards/<dashboard_id>/descargar-datos` — el archivo que alimenta el
    dashboard, con todas sus filas y columnas, en .xlsx.

    Pide `dashboard.view` y no un permiso propio: es el mismo conjunto de datos que el dashboard
    ya muestra —agregado en sus secciones y fila por fila en la consulta por cliente—, así que no
    expone nada que quien puede abrirlo no pueda ver ya. Mismo criterio que `ExportarView` del
    dashboard legado.
    """

    def get(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request, dashboard_id, permiso_global=permisos.DASHBOARD_VIEW
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_VIEW,
                "No tiene permiso para ver este dashboard.",
            )

        buffer, nombre = descarga_datos.excel_de_la_carga_vigente(dashboard_id)
        respuesta = HttpResponse(
            buffer.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        # El nombre lleva espacios y puede llevar acentos: va entre comillas y además como
        # `filename*` (RFC 5987), que es lo que hace que el navegador conserve los acentos en vez
        # de guardarlo con caracteres rotos.
        respuesta["Content-Disposition"] = (
            f'attachment; filename="{nombre}"; filename*=UTF-8' "{quote(nombre)}"
        )
        return respuesta


class DashboardConsultaDeudorView(APIView):
    """`GET /api/dashboards/<dashboard_id>/deudor` — consulta puntual de un cliente.

    Dos modos sobre el mismo endpoint, porque son dos pasos de la misma pregunta y comparten
    validación y control de acceso:

    - `?buscar=texto` devuelve las coincidencias (nombre, saldo, cuántas filas) para ELEGIR una.
    - `?identidad=X` devuelve la antigüedad por tramos de ese cliente y sus filas del archivo.

    Solo pide `dashboard.view`: es una lectura del archivo que el dashboard ya muestra agregado,
    no expone nada que quien puede abrir el dashboard no pueda ver sumado. Las columnas del detalle
    llegan por parámetro (`columnas`) y las decide el componente, no la petición: ver
    `services/consulta_deudor.py`.
    """

    def get(self, request, dashboard_id):
        if not permisos.tiene_acceso_dashboard(
            request, dashboard_id, permiso_global=permisos.DASHBOARD_VIEW
        ):
            return _denegado(
                request,
                dashboard_id,
                permisos.DASHBOARD_VIEW,
                "No tiene permiso para ver este dashboard.",
            )

        columna_nombre = request.query_params.get("columna_nombre") or "Cliente"
        columna_ruc = request.query_params.get("columna_ruc") or ""
        columna_fecha = request.query_params.get("columna_fecha") or "Fecha de Vencimiento"
        columna_valor = request.query_params.get("columna_valor") or "Saldo"

        texto = request.query_params.get("buscar")
        if texto is not None:
            return Response(
                consulta_deudor.buscar(
                    dashboard_id,
                    texto,
                    columna_nombre=columna_nombre,
                    columna_valor=columna_valor,
                    columna_ruc=columna_ruc,
                )
            )

        identidad = request.query_params.get("identidad")
        if not identidad:
            # Sin parámetros se informan las columnas del archivo: es lo que necesita el panel de
            # configuración para ofrecer cuáles mostrar en el detalle, y evita un endpoint aparte
            # para una sola lista.
            return Response(consulta_deudor.columnas_disponibles(dashboard_id))

        columnas = [c for c in (request.query_params.get("columnas") or "").split("|") if c]
        return Response(
            consulta_deudor.detalle(
                dashboard_id,
                identidad,
                columna_nombre=columna_nombre,
                columna_fecha=columna_fecha,
                columna_valor=columna_valor,
                columna_ruc=columna_ruc,
                columnas_detalle=columnas or None,
            )
        )
