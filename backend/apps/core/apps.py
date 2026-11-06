from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    verbose_name = "Núcleo compartido"

    def ready(self):
        # Registra el lookup `__sin_tildes` en los campos de texto (ver
        # `apps.core.busqueda`) aunque ningún módulo lo haya importado aún.
        from . import busqueda  # noqa: F401
