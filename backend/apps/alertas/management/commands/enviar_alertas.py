"""Envía el resumen de alertas del parque por correo (§19).

Pensado para correr **todos los días** por cron. Que el envío sea diario o
semanal lo decide la configuración, no la línea del crontab: quien configura
las alertas no tiene acceso al servidor, y cambiar la frecuencia no debería
requerir un administrador de sistemas.

Es seguro repetirlo: dos pasadas el mismo día no producen dos correos.
"""

from django.core.management.base import BaseCommand

from apps.alertas.models import EnvioAlertas
from apps.alertas.services import ejecutar_envio_en_todas_las_empresas


class Command(BaseCommand):
    help = "Envía por correo el resumen de alertas a los destinatarios configurados."

    def add_arguments(self, parser):
        parser.add_argument(
            "--forzar",
            action="store_true",
            help=(
                "Envía aunque las notificaciones estén desactivadas, ya se haya enviado hoy "
                "o la frecuencia diga que hoy no toca. Para verificar la configuración SMTP."
            ),
        )

    def handle(self, *args, **options):
        # Un envío por empresa: cada una con su configuración, sus equipos y sus
        # destinatarios. Un solo correo con el parque de todas cruzaría entre
        # empresas justo lo que la separación promete no cruzar.
        envios = ejecutar_envio_en_todas_las_empresas(forzar=options["forzar"])
        fallos = 0

        for envio in envios:
            empresa = envio.empresa.nombre if envio.empresa_id else "sin empresa"
            if envio.resultado == EnvioAlertas.Resultado.ENVIADO:
                self.stdout.write(
                    self.style.SUCCESS(
                        f"{empresa}: enviado a {len(envio.destinatarios)} destinatario(s), "
                        f"{envio.total_alertas} alerta(s) con {envio.total_elementos} situación(es)."
                    )
                )
            elif envio.resultado == EnvioAlertas.Resultado.OMITIDO:
                self.stdout.write(f"{empresa}: no se envió — {envio.motivo}")
            else:
                fallos += 1
                # Salida de error para que el cron lo reporte: un envío fallido
                # que solo queda en la bitácora del sistema no despierta a nadie.
                self.stderr.write(self.style.ERROR(f"{empresa}: falló — {envio.motivo}"))

        if not envios:
            self.stdout.write("No hay empresas activas a las que enviar.")
        if fallos:
            raise SystemExit(1)
