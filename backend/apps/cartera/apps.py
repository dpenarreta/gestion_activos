from django.apps import AppConfig


class CarteraConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.cartera'
    label = 'cartera'
    verbose_name = 'Dashboards'

    def ready(self):
        # Registra la limpieza de archivos en disco al eliminar una `CargaArchivo`
        # (`signals.borrar_archivos_de_carga`). El import va acá y no arriba porque los modelos
        # todavía no están cargados al importar el módulo de configuración de la app.
        from . import signals  # noqa: F401
