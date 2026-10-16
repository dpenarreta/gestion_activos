"""Plantilla base personalizable desde "Configuración" (sección `configuracion.*`, ya usada por
`apps.branding` para el tema visual): las mismas 13 posiciones fijas de todo dashboard
(`services/plantilla.py::PLANTILLA_SLOTS`), pero editables — arrastrar/redimensionar/reordenar/
recolorear/renombrar/cambiar tipo de gráfico, igual que un dashboard real, reutilizando el mismo
`DashboardLayout`/`DashboardComponent` bajo el `dashboard_id` reservado
`plantilla.DASHBOARD_ID_PLANTILLA_BASE` (nunca corresponde a un `Dashboard` real). Lo que se
guarde acá es lo que hereda todo dashboard **nuevo** de ahí en adelante
(`plantilla.sembrar_plantilla_desde_base`, llamado por `services.dashboards.crear_dashboard`) —
nunca afecta retroactivamente a los ya existentes.

Gateada por `configuracion.ver`/`configuracion.editar`, no por los permisos `dashboard.*`: es una
configuración del sistema, no un dashboard puntual — cualquiera con permiso para editar dashboards
propios NO debería poder cambiar lo que ve todo el mundo de ahí en adelante.
"""

from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cartera.compat import require_permission

from .dashboard_views import _etiqueta_actor
from .exceptions import CarteraError
from .services import dashboard_layout as dl
from .services import plantilla


def _bootstrap_si_hace_falta():
    layout = dl.obtener_o_crear_layout(plantilla.DASHBOARD_ID_PLANTILLA_BASE)
    if not layout.components.exists():
        layout = plantilla.sembrar_plantilla(plantilla.DASHBOARD_ID_PLANTILLA_BASE)
    return layout


class PlantillaBaseLayoutView(APIView):
    def get_permissions(self):
        if self.request.method == 'PUT':
            return [require_permission('configuracion.editar')()]
        return [require_permission('configuracion.ver')()]

    def get(self, request):
        layout = _bootstrap_si_hace_falta()
        return Response(dl.serializar_layout(layout))

    def put(self, request):
        version_recibida = request.data.get('version')
        if version_recibida is None:
            raise CarteraError('Se requiere la versión de la plantilla base que se está editando.', codigo='VERSION_REQUERIDA')

        layout_actual = _bootstrap_si_hace_falta()
        if int(version_recibida) != layout_actual.version:
            return Response({
                'error': 'CONFLICTO_DE_VERSION',
                'mensaje': 'Existe una versión más reciente de la plantilla base. Recargue antes de guardar.',
                **dl.serializar_layout(layout_actual),
            }, status=409)

        componentes = dl.validar_componentes(plantilla.DASHBOARD_ID_PLANTILLA_BASE, request.data.get('components') or [])
        # Igual que en `dashboard_views`: la etiqueta del historial se deriva del usuario
        # autenticado, nunca del cuerpo de la petición (ver `_etiqueta_actor`).
        changed_by = _etiqueta_actor(request)
        layout = dl.aplicar_layout(plantilla.DASHBOARD_ID_PLANTILLA_BASE, componentes, changed_by, actor=request.user, request=request)

        return Response(dl.serializar_layout(layout))


class PlantillaBaseResetView(APIView):
    permission_classes = [require_permission('configuracion.editar')]

    def post(self, request):
        # A diferencia de `DashboardLayoutResetView`/`restablecer_layout` (solo revierte
        # visibilidad de lo que ya existe), acá "restablecer" significa volver a los valores de
        # fábrica del patrón Z — se vuelve a sembrar desde `PLANTILLA_SLOTS`, no desde la
        # personalización vigente.
        layout = plantilla.sembrar_plantilla(plantilla.DASHBOARD_ID_PLANTILLA_BASE)
        return Response(dl.serializar_layout(layout))
