"""El ciclo del Escritorio de Gestión Humana.

    python manage.py ciclo_escritorio [--simular]

En todas las empresas:

- avisa en la campana cada recordatorio pendiente ya vencido del que no se
  avisó (una vez por vencimiento); en Nexo esto solo pasaba cuando la persona
  abría su escritorio;
- purga las notas archivadas hace más de 15 días y las que su remitente mandó
  a la papelera hace más de 48 horas (las dos retenciones de Nexo), con su
  adjunto y su entrada en la bitácora.

Corre cada cinco minutos en `scripts/tarea_respaldo.py`: sin nada que hacer
son tres consultas y no escribe nada en el registro.

`--simular` dice cuántas notas purgaría, sin avisar ni borrar.
"""

from django.core.management.base import BaseCommand

from apps.escritorio.services import ciclo, purgar


class Command(BaseCommand):
    help = (
        "Avisa los recordatorios vencidos del Escritorio y purga el archivo y la papelera "
        "de notas vencidos."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--simular",
            action="store_true",
            help="Solo cuenta las notas que se purgarían; no avisa ni borra.",
        )

    def handle(self, *args, **opciones):
        if opciones["simular"]:
            resumen = purgar(simular=True)
            self.stdout.write(
                f"Se purgarían {resumen['archived']} notas archivadas y "
                f"{resumen['trashed']} de la papelera."
            )
            return
        resumen = ciclo()
        if resumen["notified"]:
            self.stdout.write(f"Escritorio: {resumen['notified']} recordatorios vencidos avisados.")
        if resumen["archived"] or resumen["trashed"]:
            self.stdout.write(
                f"Escritorio: {resumen['archived']} notas archivadas y {resumen['trashed']} "
                "de la papelera purgadas."
            )
