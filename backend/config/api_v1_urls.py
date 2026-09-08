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
    # --- Inventario de activos (RF-01, RF-02, RF-03, RF-08) ---
    path("activos/", include("apps.activos.urls")),
    # --- Catálogos organizacionales: departamentos y empleados ---
    path("organizacion/", include("apps.organizacion.urls")),
    # --- Bitácora de mantenimientos (RF-04, RF-05) ---
    path("mantenimientos/", include("apps.mantenimientos.urls")),
    # --- Políticas de renovación y motor de sugerencias (RF-06, RF-07) ---
    path("politicas/", include("apps.politicas.urls")),
    # --- Identidad institucional / tema ---
    path("admin/theme/", include("apps.branding.urls")),
    path("theme/current/", CurrentThemeView.as_view(), name="current-theme"),
]
