"""Informes ejecutivos de Gestión Humana (fase 2c, 06/11/2026), portados de
`apps.reports` de Nexo.

Tres modelos, los tres de Nexo con sus mismos nombres y campos:

- `ExecutiveReportSnapshot`: el informe ya generado, **inmutable**. Cada
  generación crea una fila nueva y ninguna se modifica jamás: un informe
  emitido es un documento, no una consulta. `data` es el documento completo
  (la estructura `ExecutiveReportSnapshotData` de Nexo, en camelCase) y nunca
  se recalcula al leerlo.
- `ExecutiveReportAuditLog`: quién generó, abrió o exportó cada informe.
  Append-only; `report_id` va suelto, sin FK, para sobrevivir al informe.
- `ExecutiveReportIntegrityIncident`: las diferencias que la validación de
  integridad encontró entre el informe y el KPI del equipo al generarlo.

Lo que cambia al llegar a la intranet:

- Multiempresa: los tres heredan de `ModeloDeEmpresa`. La bitácora y los
  incidentes llevan su propia empresa porque el `report_id` suelto no da de
  quién heredarla (mismo criterio que `tasks.ActivityAuditLog`).
- `MonthlyReport` (el informe «legacy» de Nexo) no se porta: en Nexo estaba
  vacío y solo se leía para la variación del Índice Ejecutivo contra el mes
  anterior; aquí esa variación sale del informe MENSUAL anterior (ver
  `snapshot.variacion_del_indice`).
- `collaborator_ids` guarda ids de cuentas de la INTRANET (en los importados
  de Nexo, ya traducidos): es lo que decide quién puede abrir el informe
  (`access.puede_ver_informe`). El documento `data` conserva tal cual los ids
  con que se generó.
- `nova`/`nova_degraded` se conservan para la fase de IA. Hoy `nova` lleva la
  narrativa DETERMINISTA (los textos de respaldo de Nexo) y `nova_degraded`
  queda en False: «degradado» significa «se esperaba la IA y falló», y en esta
  fase no se espera.
"""

from django.conf import settings
from django.db import models

from apps.empresas.models import ModeloDeEmpresa


class InformeInmutable(Exception):
    """Se intentó modificar un informe ya emitido."""


class ExecutiveReportSnapshot(ModeloDeEmpresa):
    """Un informe ejecutivo emitido. Nunca se edita: `save()` solo inserta."""

    class Type(models.TextChoices):
        MENSUAL = "MENSUAL", "Mensual"
        RANGO_MESES = "RANGO_MESES", "Rango de meses"
        RANGO_PERSONALIZADO = "RANGO_PERSONALIZADO", "Rango personalizado"

    class Scope(models.TextChoices):
        #: Generado con alcance completo (toda la empresa). En Nexo, el del
        #: Jefe Nacional y el ADMINISTRADOR.
        JEFE = "JEFE", "Jefatura (alcance completo)"
        #: Generado sobre el equipo de quien lo pidió, según el organigrama.
        #: En Nexo, el del Coordinador Nacional.
        COORDINADOR = "COORDINADOR", "Coordinación (su equipo)"

    class PeriodStatus(models.TextChoices):
        EN_CURSO = "EN_CURSO", "En curso"
        CERRADO = "CERRADO", "Cerrado"
        HISTORICO = "HISTORICO", "Histórico"

    class Origin(models.TextChoices):
        GENERATED = "GENERATED", "Generado"
        LEGACY_MIGRATION = "LEGACY_MIGRATION", "Migrado del informe mensual antiguo"

    class Integrity(models.TextChoices):
        FULL = "FULL", "Completo"
        PARTIAL = "PARTIAL", "Parcial"

    #: NXR-YYYYMMDD-HHMMSS-XXXX (o NXR-LEGACY-YYYYMMDD-XXXX en los migrados del
    #: informe mensual antiguo de Nexo). Único en todo el sistema: identifica
    #: un documento, se imprime en su portada y no se reutiliza.
    report_id = models.CharField(max_length=40, unique=True)
    type = models.CharField(max_length=25, choices=Type.choices)
    scope = models.CharField(max_length=15, choices=Scope.choices)
    origin = models.CharField(max_length=20, choices=Origin.choices, default=Origin.GENERATED)
    integrity_flag = models.CharField(
        max_length=10, choices=Integrity.choices, default=Integrity.FULL
    )
    #: Referencia suelta al `MonthlyReport` de Nexo que esta fila reemplazó
    #: (solo en los LEGACY_MIGRATION importados).
    legacy_monthly_report_id = models.CharField(max_length=40, null=True, blank=True)
    migrated_at = models.DateTimeField(null=True, blank=True)
    generated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT
    )
    generated_at = models.DateTimeField()
    period_label = models.CharField(max_length=255)
    period_start = models.DateTimeField()
    period_end = models.DateTimeField()
    fecha_corte = models.DateTimeField()
    period_status = models.CharField(max_length=15, choices=PeriodStatus.choices)
    #: Los filtros con que se pidió (tipo, período, fecha de corte, roles,
    #: áreas y colaboradores), tal como se validaron.
    filters = models.JSONField()
    #: Ids de cuentas de la intranet incluidas. Un id de Nexo sin cuenta en la
    #: intranet se guarda como texto «nexo:<id>», que nunca coincide con una
    #: cuenta: así el informe no queda visible para quien solo ve a una parte.
    collaborator_ids = models.JSONField(default=list, blank=True)
    collaborator_count = models.PositiveIntegerField(default=0)
    analytics_engine_version = models.CharField(max_length=20)
    formula_set_version = models.CharField(max_length=20)
    reporting_engine_version = models.CharField(max_length=20)
    #: En Nexo, la versión de Nexo; aquí, la de la intranet (`APP_VERSION`).
    nexo_version = models.CharField(max_length=20)
    data = models.JSONField()
    nova = models.JSONField(null=True, blank=True)
    nova_degraded = models.BooleanField(default=False)
    data_quality = models.JSONField()
    generation_ms = models.PositiveIntegerField()

    class Meta:
        ordering = ["-generated_at"]
        indexes = [
            models.Index(fields=["empresa", "generated_at"]),
            models.Index(fields=["generated_by", "created_at"]),
            models.Index(fields=["type", "period_start", "period_end"]),
            models.Index(fields=["origin"]),
        ]

    def __str__(self) -> str:
        return self.report_id

    def save(self, *args, **kwargs):
        # Un informe emitido no cambia jamás (principio de inmutabilidad de
        # Nexo): solo se inserta. Corregir algo es generar uno nuevo.
        if not self._state.adding:
            raise InformeInmutable("Un informe ejecutivo ya emitido no se puede modificar.")
        return super().save(*args, **kwargs)


class ExecutiveReportAuditLog(ModeloDeEmpresa):
    """Bitácora de los informes: generado, fallido, abierto, exportado,
    migrado. Append-only; `report_id` suelto (sobrevive al informe)."""

    class Action(models.TextChoices):
        GENERATED = "generated", "Generado"
        GENERATION_FAILED = "generation_failed", "Falló la generación"
        NOVA_DEGRADED = "nova_degraded", "Narrativa degradada"
        VIEWED = "viewed", "Abierto"
        EXPORTED_PDF = "exported_pdf", "Exportado a PDF"
        EXPORTED_EXCEL = "exported_excel", "Exportado a Excel"
        LEGACY_MIGRATED = "legacy_migrated", "Migrado"

    report_id = models.CharField(max_length=40)
    action = models.CharField(max_length=20, choices=Action.choices)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    step = models.CharField(max_length=255, null=True, blank=True)
    message = models.TextField(null=True, blank=True)
    period = models.CharField(max_length=255, null=True, blank=True)
    fecha_corte = models.DateTimeField(null=True, blank=True)
    filters_applied = models.JSONField(null=True, blank=True)
    collaborator_count = models.PositiveIntegerField(null=True, blank=True)
    generation_ms = models.PositiveIntegerField(null=True, blank=True)
    analytics_engine_version = models.CharField(max_length=20, null=True, blank=True)
    formula_set_version = models.CharField(max_length=20, null=True, blank=True)
    nexo_version = models.CharField(max_length=20, null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["report_id"]),
            models.Index(fields=["user", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.report_id}:{self.action}"


class ExecutiveReportIntegrityIncident(ModeloDeEmpresa):
    """Una diferencia entre el informe y el KPI del equipo (`kpis/team/`) para
    el mismo instante, detectada al generarlo (en Nexo, Sprint R). Solo se
    valida el informe MENSUAL del mes en curso sin fecha de corte explícita:
    es el único caso en que las dos fuentes miran el mismo momento. `user_id`
    suelto, sin FK."""

    class Source(models.TextChoices):
        KPIS_TEAM = "kpis_team", "KPI del equipo"

    report_id = models.CharField(max_length=40)
    field_path = models.CharField(max_length=255)
    expected_value = models.FloatField()
    actual_value = models.FloatField()
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.KPIS_TEAM)
    user_id = models.PositiveIntegerField(null=True, blank=True)
    detected_at = models.DateTimeField()

    class Meta:
        ordering = ["-detected_at"]
        indexes = [
            models.Index(fields=["report_id"]),
            models.Index(fields=["detected_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.report_id}:{self.field_path}"
