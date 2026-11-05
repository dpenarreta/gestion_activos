"""Retención de las ausencias médicas (LOPDP, decisión del 05/11/2026).

    python manage.py purgar_ausencias_medicas [--simular]

Borra los permisos MÉDICOS (`LeaveRecord` de tipo MEDICO) cuyo día es de hace
más de cinco años, en todas las empresas, y deja en la auditoría de cada una
cuántos registros se borraron y entre qué fechas, sin datos de salud ni de
personas. Corre cada cinco minutos en `scripts/tarea_respaldo.py`: si no hay
nada que borrar es una sola consulta y no escribe nada en el registro.

`--simular` dice cuántos borraría, sin borrar ni auditar.
"""

from django.core.management.base import BaseCommand

from apps.ausencias.services import MEDICAL_RETENTION_YEARS, purge_expired_medical_leaves


class Command(BaseCommand):
    help = (
        f"Borra las ausencias médicas de hace más de {MEDICAL_RETENTION_YEARS} años "
        "(retención LOPDP) y deja constancia agregada en la auditoría."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--simular",
            action="store_true",
            help="Solo cuenta lo que se borraría; no borra ni audita.",
        )

    def handle(self, *args, **opciones):
        simular = opciones["simular"]
        resumen = purge_expired_medical_leaves(simulate=simular)
        if not resumen:
            if simular:
                self.stdout.write("No hay ausencias médicas vencidas.")
            return
        verbo = "Se borrarían" if simular else "Ausencias médicas vencidas borradas"
        for fila in resumen:
            self.stdout.write(
                f"{verbo}: {fila['registros']} (empresa {fila['empresa_id'] or 'sin empresa'}, "
                f"del {fila['desde']} al {fila['hasta']})."
            )
