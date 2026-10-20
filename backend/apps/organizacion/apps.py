from django.apps import AppConfig


class OrganizacionConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.organizacion"
    verbose_name = "Organización"

    def ready(self):
        # Enlaza a quien figuraba sin cuenta cuando entra a la empresa.
        from . import carga_personas  # noqa: F401
