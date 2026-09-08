from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView

from apps.branding.views import CurrentThemeView
from apps.core.version_views import version_info

urlpatterns = [
    path("health/", include("apps.core.health.urls")),
    path("version/", version_info, name="version-info"),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "schema/swagger-ui/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="schema-swagger-ui",
    ),
    path("schema/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="schema-redoc"),
    # --- Autenticación (login, refresh, sesiones, restablecimiento propio) ---
    path("auth/", include("apps.authentication.urls")),
    # --- Administración de usuarios ---
    path("admin/users/", include("apps.users.urls")),
    # --- Administración de roles ---
    path("admin/roles/", include("apps.roles.urls")),
    # --- Catálogo de permisos (solo lectura) ---
    path("admin/permissions/", include("apps.permissions.urls")),
    # --- Auditoría (solo lectura) ---
    path("admin/audit-logs/", include("apps.core.audit_urls")),
    # --- Identidad institucional / tema ---
    path("admin/theme/", include("apps.branding.urls")),
    path("theme/current/", CurrentThemeView.as_view(), name="current-theme"),
]
