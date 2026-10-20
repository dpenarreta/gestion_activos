from django.apps import AppConfig


class CapacitacionConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.capacitacion"
    verbose_name = "Onboarding y capacitación"

    def ready(self):
        # Asigna el onboarding a quien entra a una empresa.
        from . import services  # noqa: F401
