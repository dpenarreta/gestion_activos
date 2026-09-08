from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.request_meta import get_request_context

from .catalog import ALLOWED_BORDER_RADII, FONT_FAMILIES
from .permissions import ConfiguracionPermission
from .serializers import SiteThemeSerializer
from .services import SiteThemeService


class CurrentThemeView(APIView):
    """Lectura pública: el login/registro también deben pintarse con la
    marca configurada, antes de autenticar a nadie."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response(SiteThemeSerializer(SiteThemeService.get_current()).data)


class ThemeAdminView(APIView):
    permission_classes = [IsAuthenticated, ConfiguracionPermission]

    def get(self, request):
        return Response(SiteThemeSerializer(SiteThemeService.get_current()).data)

    def patch(self, request):
        current = SiteThemeService.get_current()
        serializer = SiteThemeSerializer(current, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        theme, warnings = SiteThemeService.update(
            actor=request.user, context=get_request_context(request), **serializer.validated_data
        )
        return Response({**SiteThemeSerializer(theme).data, "warnings": warnings})


class ThemeResetView(APIView):
    permission_classes = [IsAuthenticated, ConfiguracionPermission]

    def post(self, request):
        theme = SiteThemeService.reset_to_defaults(
            actor=request.user, context=get_request_context(request)
        )
        return Response(SiteThemeSerializer(theme).data)


class ThemeOptionsView(APIView):
    """Catálogo de fuentes y radios de borde permitidos, para que el
    frontend nunca tenga una copia hardcodeada que pueda desincronizarse."""

    permission_classes = [IsAuthenticated, ConfiguracionPermission]

    def get(self, request):
        fonts = [{"key": key, **value} for key, value in FONT_FAMILIES.items()]
        return Response({"fonts": fonts, "border_radii": ALLOWED_BORDER_RADII})
