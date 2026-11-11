"""Revisión periódica de ausencias (11/11/2026, US-001).

Recorre las empresas activas y, en cada una, pasa a su reemplazo las
aprobaciones pendientes (permisos, proyectos y Mesa de ayuda) de quien está
ausente hoy: vacaciones o permiso aprobado de día completo, o su estado de
chat «De vacaciones» / «Fuera de la oficina». Cubre las ausencias que
empiezan sin que nadie toque nada, como unas vacaciones aprobadas hace semanas.

Lo corre la tarea oculta cada 5 minutos (`scripts/tarea_respaldo.py`). Es
idempotente y barato:

- Sin pendientes es una consulta por flujo y empresa.
- Por cada ausente con pendientes se resuelve primero su reemplazo; si no
  tiene ninguno posible, se pasa al siguiente sin abrir transacciones ni
  bloquear filas.
- Lo que ya pasó al reemplazo deja de estar pendiente del ausente y no se
  vuelve a tocar.
- Resuelve los reemplazos sin la memoria corta de lo que solo se muestra.
"""

from django.core.management.base import BaseCommand

from apps.empresas.models import Empresa
from apps.organizacion import ausencia


class Command(BaseCommand):
    help = (
        "Pasa a su reemplazo las aprobaciones pendientes de quien está ausente hoy (permisos,"
        " proyectos y Mesa de ayuda). Lo corre la tarea oculta cada 5 minutos."
    )

    def handle(self, *args, **options):
        for empresa in Empresa.objects.filter(activa=True).order_by("nombre"):
            try:
                reasignadas = ausencia.revisar_empresa(empresa)
            except Exception as error:  # noqa: BLE001
                # Una empresa con problemas no deja sin revisar a las demás.
                self.stderr.write(f"Ausencias: falló la revisión de {empresa.nombre}: {error}")
                continue
            if reasignadas:
                self.stdout.write(
                    f"Ausencias: {reasignadas} aprobación(es) reasignada(s) en {empresa.nombre}."
                )
