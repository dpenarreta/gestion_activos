from django.apps import AppConfig


class NovedadesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.novedades"
    verbose_name = "Control Operativo de Novedades"

    def ready(self):
        from django.db.backends.signals import connection_created

        from config.db_routers import proteger_conexion_nexo

        # La base de Nexo (importación `importar_nexo`) solo acepta SELECT.
        connection_created.connect(
            proteger_conexion_nexo, dispatch_uid="novedades_nexo_solo_lectura"
        )
