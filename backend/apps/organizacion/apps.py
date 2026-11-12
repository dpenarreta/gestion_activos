from django.apps import AppConfig


class OrganizacionConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.organizacion"
    verbose_name = "Organización"

    def ready(self):
        # Enlaza a quien figuraba sin cuenta cuando entra a la empresa; y
        # `llamados.solicitar` (lo que da tener a alguien a cargo) sigue al
        # organigrama (US-013, 12/11/2026).
        from . import carga_personas, senales_equipo  # noqa: F401
