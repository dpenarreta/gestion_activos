"""API de la interacción con la plataforma (18/11/2026).

- `POST /interaccion/latido/`  ← la web, como mucho una vez por minuto,
  cuando la persona hace algo: `{titulo}` de la pantalla. Cualquiera con
  sesión (es su propia actividad).
- `GET  /interaccion/resumen/?dias=1|7|30|90` → los indicadores del
  dashboard. Solo quien tiene acceso al dashboard «Interacción de la
  plataforma» (su dueño, el superusuario y los roles con «Ver» o
  «Editar»), con la misma regla de todos los dashboards.
"""

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cartera import permisos

from . import services


class LatidoView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        services.registrar_latido(request.user, request.data.get("titulo", ""))
        return Response(status=status.HTTP_204_NO_CONTENT)


class ResumenView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not permisos.tiene_acceso_dashboard(
            request, services.DASHBOARD_ID, permiso_global=permisos.DASHBOARD_VIEW
        ):
            return Response(
                {"detail": "No tiene acceso a este dashboard."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            dias = int(request.query_params.get("dias", 7))
        except (TypeError, ValueError):
            dias = 7
        return Response(services.resumen(dias))
