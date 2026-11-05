"""Carga inicial del catálogo de motivos de registro de actividades.

    manage.py seed_activity_reasons --empresa <id> [--dry-run]

Portado de Nexo: sin él, una empresa nueva arranca con el catálogo vacío y el
selector de motivos aparece sin opciones, lo que se lee como un fallo del
filtro por rol y no como una tabla sin filas.

Es **idempotente**: solo crea lo que falta (por etiqueta) y nunca toca un
motivo existente —ni sus roles ni su estado—, porque el catálogo se edita
desde los ajustes del módulo. Los motivos son por empresa: se indica en cuál.
El ADMINISTRADOR de Nexo es aquí el «Administrador de Gestión Humana».
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual, usando_empresa
from apps.empresas.models import Empresa
from apps.tasks.models import ActivityReason
from apps.tasks.roles import (
    ADMIN_GH,
    ANALISTA_CC,
    ANALISTA_SELECCION,
    ASISTENTE_GH,
    ASISTENTE_GH_ZS,
    ASISTENTE_NOMINA,
    ASISTENTE_SELECCION,
    COORDINADOR_NACIONAL,
    COORDINADOR_ZS,
    JEFE_NACIONAL,
    TRABAJO_SOCIAL,
)
from apps.tasks.services import unique_activity_reason_key

TODOS = [
    ADMIN_GH,
    JEFE_NACIONAL,
    COORDINADOR_NACIONAL,
    COORDINADOR_ZS,
    ANALISTA_CC,
    ANALISTA_SELECCION,
    ASISTENTE_SELECCION,
    ASISTENTE_GH,
    ASISTENTE_GH_ZS,
    TRABAJO_SOCIAL,
    ASISTENTE_NOMINA,
]

# Catálogo provisto por Gestión Humana (Nexo, 14/09/2026). El orden es el del
# documento original y se conserva: es el que la gente espera en el selector.
CATALOGO: list[tuple[str, list[str]]] = [
    ("Seguimiento de documentación", TODOS),
    ("Solicitudes internas", TODOS),
    (
        "Reclutamiento y Selección",
        [ANALISTA_SELECCION, ASISTENTE_SELECCION, ASISTENTE_GH_ZS, COORDINADOR_ZS],
    ),
    ("Seguimiento de Ausentismos", [ANALISTA_CC, TRABAJO_SOCIAL, ASISTENTE_GH_ZS, COORDINADOR_ZS]),
    ("Visita Domiciliaria", [TRABAJO_SOCIAL]),
    (
        "Novedades de Pago",
        [
            JEFE_NACIONAL,
            COORDINADOR_NACIONAL,
            COORDINADOR_ZS,
            ANALISTA_SELECCION,
            ASISTENTE_SELECCION,
            ASISTENTE_GH_ZS,
            TRABAJO_SOCIAL,
        ],
    ),
    # «Todos menos Asistente de Nómina»: así está en el documento original.
    ("Facturas", [rol for rol in TODOS if rol != ASISTENTE_NOMINA]),
    ("Consulta de Operaciones", [rol for rol in TODOS if rol != ASISTENTE_NOMINA]),
    ("Aviso de entrada y Salida", [ASISTENTE_NOMINA]),
    ("Legalización de actas", [ASISTENTE_NOMINA]),
    ("Elaboración de actas", [ASISTENTE_NOMINA]),
    ("Seguimiento Liquidaciones", [ASISTENTE_GH]),
    ("Elaboración Paz y Salvo", [ASISTENTE_GH]),
    ("MEMOS-SANCIONES", [ASISTENTE_GH]),
    ("DESCUENTOS", [ASISTENTE_GH]),
    ("Elaboración de vacaciones", [ASISTENTE_GH]),
]


class Command(BaseCommand):
    help = (
        "Crea en una empresa los motivos de actividad que falten, sin modificar los "
        "existentes. Idempotente."
    )

    def add_arguments(self, parser):
        parser.add_argument("--empresa", type=int, help="Id de la empresa destino.")
        parser.add_argument(
            "--dry-run", action="store_true", help="Mostrar qué se crearía, sin escribir."
        )

    def handle(self, *args, **options):
        actual = empresa_actual()
        if options.get("empresa"):
            empresa = Empresa.objects.filter(pk=options["empresa"]).first()
            if empresa is None:
                raise CommandError(f"No existe la empresa con id {options['empresa']}.")
        elif actual is not None and actual is not SIN_EMPRESA:
            empresa = actual
        else:
            raise CommandError("Indique la empresa con --empresa <id>.")

        with usando_empresa(empresa):
            self._sembrar(empresa, options["dry_run"])

    def _sembrar(self, empresa, dry_run: bool):
        existentes = set(ActivityReason.objects.values_list("label", flat=True))
        a_crear = [(label, roles) for label, roles in CATALOGO if label not in existentes]

        if not a_crear:
            self.stdout.write(
                self.style.SUCCESS(
                    f"No hay nada que crear en «{empresa}»: los {len(CATALOGO)} motivos del "
                    "catálogo ya existen."
                )
            )
            return

        for label, roles in a_crear:
            self.stdout.write(f"  + {label}  ({len(roles)} rol/es)")

        if dry_run:
            self.stdout.write(
                self.style.WARNING(f"\n--dry-run: no se creó nada ({len(a_crear)} pendientes).")
            )
            return

        with transaction.atomic():
            for label, roles in a_crear:
                ActivityReason.objects.create(
                    empresa=empresa,
                    key=unique_activity_reason_key(label),
                    label=label,
                    description="",
                    assigned_roles=roles,
                    is_active=True,
                )

        omitidos = len(CATALOGO) - len(a_crear)
        detalle = f"{len(a_crear)} motivo(s) creado(s) en «{empresa}»"
        if omitidos:
            detalle += f", {omitidos} ya existían y no se tocaron"
        self.stdout.write(self.style.SUCCESS(f"\n{detalle}."))
