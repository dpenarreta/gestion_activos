"""Importación única de los informes ejecutivos de Nexo: los informes emitidos,
su bitácora y los incidentes de integridad, como DATOS CONGELADOS.

Mismo recorrido que las demás importaciones de Gestión Humana
(`apps.novedades.nexo`, `apps.tasks.nexo`, `apps.projects.nexo`):

1. Lee de Nexo las filas y los conteos antes de abrir ninguna transacción.
2. Comprueba, sin escribir, que no estén ya importados y que cada usuario de
   Nexo que hace falta exista en la intranet (por correo). Si no, aborta con
   la lista de lo que falta. No crea cuentas.
3. Dentro de UNA transacción crea todo, conservando las fechas de Nexo, y
   verifica. En simulacro, o si la verificación no cuadra, lo deshace.

Decisiones propias de esta importación (salen en el informe):

- **Nada se recalcula.** `data`, `nova`, `data_quality`, `filters` y los
  metadatos se copian tal cual; la verificación compara cada documento con el
  de Nexo. Los ids de personas DENTRO del documento siguen siendo los de Nexo
  (es un documento emitido; el visor solo los usa como claves).
- **`collaborator_ids` sí se traduce** a cuentas de la intranet: es lo que
  decide quién puede abrir el informe. Un id que no tiene cuenta (o un id
  antiguo de Postgres, no numérico) queda como «nexo:<id>»: nunca coincide con
  una persona, así que ese informe solo lo abre quien tiene alcance completo o
  quien lo generó. Se cuentan en un aviso.
- **Destino.** Pueden convivir con informes ya emitidos en la intranet: solo
  aborta si alguno de los Report ID de Nexo ya existe aquí (ya se importó).
- **`--excluir-usuario`.** Se quitan los informes que generó esa persona, sus
  eventos de la bitácora y sus incidentes, y todo lo que la bitácora y los
  incidentes digan de esos informes. Si aparece entre los colaboradores de un
  informe de otra persona, aborta: excluirla cambiaría un documento ajeno.
"""

import json
from collections import Counter
from dataclasses import dataclass, field

from django.db import transaction

from apps.empresas.contexto import usando_empresa
from apps.novedades.nexo.comun import (
    MAXIMO_DE_PARAMETROS,
    ImportacionAbortada,
    ImportadorBase,
    InformeBase,
    ambito,
    fechas_tal_cual,
)

from ..models import (
    ExecutiveReportAuditLog,
    ExecutiveReportIntegrityIncident,
    ExecutiveReportSnapshot,
)
from .lector import TABLAS, LectorNexoInformes

MODELOS = {
    "snapshot": ExecutiveReportSnapshot,
    "auditlog": ExecutiveReportAuditLog,
    "incident": ExecutiveReportIntegrityIncident,
}

NO_SE_MIGRA = {
    "MonthlyReport": (
        "el informe mensual antiguo no se porta (en Nexo estaba vacío; la variación del Índice "
        "Ejecutivo sale ahora del informe MENSUAL anterior)"
    ),
}

#: Columna que es el SUJETO de cada fila (`--excluir-usuario`).
SUJETO_POR_TABLA = {"snapshot": "generated_by_id", "auditlog": "user_id", "incident": "user_id"}


def _id_de_nexo(valor) -> int | None:
    """Un id de usuario de Nexo como entero; None si no lo es (un cuid de la
    base anterior de Nexo, por ejemplo)."""
    if isinstance(valor, bool):
        return None
    if isinstance(valor, int):
        return valor
    if isinstance(valor, str) and valor.strip().isdigit():
        return int(valor.strip())
    return None


def _tramos(valores) -> list[list]:
    """De a `MAXIMO_DE_PARAMETROS`: SQL Server admite 2100 parámetros por
    consulta y un `IN (...)` con todos los Report ID podría pasarse."""
    valores = sorted(valores)
    return [
        valores[i : i + MAXIMO_DE_PARAMETROS] for i in range(0, len(valores), MAXIMO_DE_PARAMETROS)
    ]


def _json(valor) -> str:
    """Forma canónica de un JSON para comparar contenidos."""
    return json.dumps(valor, sort_keys=True, ensure_ascii=False, default=str)


@dataclass
class InformeInformes(InformeBase):
    #: Informes con colaboradores sin cuenta en la intranet: Report ID → cuántos.
    colaboradores_sin_cuenta: dict[str, int] = field(default_factory=dict)
    usuarios_excluidos: list[str] = field(default_factory=list)
    excluidas_por_usuario: dict[str, int] = field(default_factory=dict)


class ImportadorNexoInformes(ImportadorBase):
    modelos = MODELOS
    tablas = TABLAS
    informe_class = InformeInformes

    def __init__(
        self, lector: LectorNexoInformes, empresa, *, aplicar: bool = False, excluir_usuarios=()
    ):
        super().__init__(lector, empresa, aplicar=aplicar)
        self.excluir = sorted({c.strip().lower() for c in excluir_usuarios if c.strip()})
        self.informe.usuarios_excluidos = list(self.excluir)
        self.esperados: dict[str, int] = {}

    # 1. Lectura ---------------------------------------------------------------

    def _colaboradores_de_nexo(self) -> set[int]:
        ids = set()
        for fila in self.datos["snapshot"]:
            for valor in fila.get("collaborator_ids") or []:
                uid = _id_de_nexo(valor)
                if uid is not None:
                    ids.add(uid)
        return ids

    def _leer(self):
        self.datos = {tabla: self.lector.filas(tabla) for tabla in TABLAS}
        self.informe.leidos = {tabla: len(filas) for tabla, filas in self.datos.items()}
        self.conteos_nexo = self.lector.conteos()
        self.usuarios_necesarios = self._usuarios_de_las_filas()
        # Colaboradores y el `user_id` suelto de los incidentes: si no tienen
        # cuenta, no abortan.
        opcionales = self._colaboradores_de_nexo() | {
            f["user_id"] for f in self.datos["incident"] if _id_de_nexo(f.get("user_id"))
        }
        self.usuarios_nexo = {
            u["id"]: u for u in self.lector.usuarios(self.usuarios_necesarios | opcionales)
        }
        if self.excluir:
            self._excluir_usuarios()
            self.usuarios_necesarios = self._usuarios_de_las_filas()

    # 1b. Usuarios excluidos -------------------------------------------------------

    def _correo(self, fila: dict | None) -> str:
        return str((fila or {}).get("email") or "").strip().lower()

    def _excluir_usuarios(self):
        excluidos = {
            uid for uid, u in self.usuarios_nexo.items() if self._correo(u) in self.excluir
        }
        encontrados = {self._correo(self.usuarios_nexo[uid]) for uid in excluidos}
        for correo in self.excluir:
            if correo not in encontrados:
                self.informe.avisos.append(
                    f"--excluir-usuario {correo}: no aparece en nada de lo que se importa."
                )
        if not excluidos:
            return

        informes_fuera = {
            f["report_id"] for f in self.datos["snapshot"] if f["generated_by_id"] in excluidos
        }
        quitadas: dict[str, int] = {}
        for tabla, columna in SUJETO_POR_TABLA.items():
            antes = len(self.datos[tabla])
            self.datos[tabla] = [
                f
                for f in self.datos[tabla]
                if f.get(columna) not in excluidos and f["report_id"] not in informes_fuera
            ]
            if len(self.datos[tabla]) != antes:
                quitadas[tabla] = antes - len(self.datos[tabla])
                self.esperados[tabla] = len(self.datos[tabla])

        referencias = []
        for fila in self.datos["snapshot"]:
            if any(_id_de_nexo(v) in excluidos for v in fila.get("collaborator_ids") or []):
                referencias.append(f"informe {fila['report_id']}: entre sus colaboradores")
        if referencias:
            raise ImportacionAbortada(
                f"Un usuario excluido aparece en {len(referencias)} informes de otras personas; "
                "excluirlo cambiaría documentos ajenos. No lo excluya. No se creó ni se cambió "
                "nada.",
                referencias,
                codigo="usuario_excluido_referenciado",
            )
        self.informe.excluidas_por_usuario = quitadas

    # 2. Comprobaciones previas -------------------------------------------------

    def _comprobar_destino(self):
        """Solo aborta si ya se importó: un Report ID de Nexo que ya existe en
        la intranet (son únicos en todo el sistema) o un evento de la bitácora
        con un Report ID de Nexo."""
        ya, con_bitacora = set(), set()
        for tramo in _tramos({f["report_id"] for f in self.datos["snapshot"]}):
            ya |= set(
                ExecutiveReportSnapshot.objects.todas()
                .filter(report_id__in=tramo)
                .values_list("report_id", flat=True)
            )
        for tramo in _tramos({f["report_id"] for f in self.datos["auditlog"]}):
            con_bitacora |= set(
                ambito(ExecutiveReportAuditLog, self.empresa)
                .filter(report_id__in=tramo)
                .values_list("report_id", flat=True)
            )
        ya, con_bitacora = sorted(ya), sorted(con_bitacora)
        if ya or con_bitacora:
            raise ImportacionAbortada(
                "Los informes de Nexo ya se importaron (hay Report ID de Nexo en la intranet); "
                "la importación no mezcla ni reemplaza.",
                [f"Ya existe el informe {r}" for r in ya[:20]]
                + [f"Ya hay bitácora de {r}" for r in con_bitacora[:20]],
                codigo="destino_con_datos",
            )

    # 3. Escritura ---------------------------------------------------------------

    def _colaboradores(self, fila) -> list:
        traducidos, sin_cuenta = [], 0
        for valor in fila.get("collaborator_ids") or []:
            uid = _id_de_nexo(valor)
            intranet = self.usuarios.get(uid) if uid is not None else None
            if intranet is None:
                sin_cuenta += 1
                traducidos.append(f"nexo:{valor}")
            else:
                traducidos.append(intranet)
        if sin_cuenta:
            self.informe.colaboradores_sin_cuenta[fila["report_id"]] = sin_cuenta
        return traducidos

    def _crear(self):
        e = self.empresa
        u = self._u
        snapshots = [
            (
                f["id"],
                ExecutiveReportSnapshot(
                    empresa=e,
                    report_id=f["report_id"],
                    type=f["type"],
                    scope=f["scope"],
                    origin=f["origin"],
                    integrity_flag=f["integrity_flag"],
                    legacy_monthly_report_id=f["legacy_monthly_report_id"],
                    migrated_at=f["migrated_at"],
                    generated_by_id=u(f["generated_by_id"]),
                    generated_at=f["generated_at"],
                    period_label=f["period_label"],
                    period_start=f["period_start"],
                    period_end=f["period_end"],
                    fecha_corte=f["fecha_corte"],
                    period_status=f["period_status"],
                    filters=f["filters"] if f["filters"] is not None else {},
                    collaborator_ids=self._colaboradores(f),
                    collaborator_count=f["collaborator_count"] or 0,
                    analytics_engine_version=f["analytics_engine_version"],
                    formula_set_version=f["formula_set_version"],
                    reporting_engine_version=f["reporting_engine_version"],
                    nexo_version=f["nexo_version"],
                    data=f["data"] if f["data"] is not None else {},
                    nova=f["nova"],
                    nova_degraded=bool(f["nova_degraded"]),
                    data_quality=f["data_quality"] if f["data_quality"] is not None else {},
                    generation_ms=f["generation_ms"] or 0,
                    created_at=f["created_at"],
                    updated_at=f["created_at"],
                ),
            )
            for f in self.datos["snapshot"]
        ]
        self._insertar("snapshot", snapshots)
        if self.informe.colaboradores_sin_cuenta:
            total = sum(self.informe.colaboradores_sin_cuenta.values())
            self.informe.avisos.append(
                f"{len(self.informe.colaboradores_sin_cuenta)} informes incluyen {total} "
                "colaboradores sin cuenta en la intranet: quedan como «nexo:<id>» y esos "
                "informes solo los abre quien tiene alcance completo o quien los generó."
            )

        self._insertar(
            "auditlog",
            [
                (
                    f["id"],
                    ExecutiveReportAuditLog(
                        empresa=e,
                        report_id=f["report_id"],
                        action=f["action"],
                        user_id=u(f["user_id"]),
                        step=f["step"],
                        message=f["message"],
                        period=f["period"],
                        fecha_corte=f["fecha_corte"],
                        filters_applied=f["filters_applied"],
                        collaborator_count=f["collaborator_count"],
                        generation_ms=f["generation_ms"],
                        analytics_engine_version=f["analytics_engine_version"],
                        formula_set_version=f["formula_set_version"],
                        nexo_version=f["nexo_version"],
                        created_at=f["created_at"],
                        updated_at=f["created_at"],
                    ),
                )
                for f in self.datos["auditlog"]
            ],
        )

        incidentes = []
        for f in self.datos["incident"]:
            uid = _id_de_nexo(f.get("user_id"))
            intranet = self.usuarios.get(uid) if uid is not None else None
            if uid is not None and intranet is None:
                self.informe.avisos.append(
                    f"incident #{f['id']}: la persona #{uid} de Nexo no tiene cuenta en la "
                    "intranet; el incidente queda sin persona."
                )
            incidentes.append(
                (
                    f["id"],
                    ExecutiveReportIntegrityIncident(
                        empresa=e,
                        report_id=f["report_id"],
                        field_path=f["field_path"],
                        expected_value=f["expected_value"],
                        actual_value=f["actual_value"],
                        source=f["source"],
                        user_id=intranet,
                        detected_at=f["detected_at"],
                        created_at=f["detected_at"],
                        updated_at=f["detected_at"],
                    ),
                )
            )
        self._insertar("incident", incidentes)

    # 4. Verificación -------------------------------------------------------------

    def _destino(self, tabla: str) -> list:
        """Las filas de la intranet con los Report ID que trae Nexo para esa
        tabla (por tramos)."""
        modelo = MODELOS[tabla]
        filas = []
        for tramo in _tramos({f["report_id"] for f in self.datos[tabla]}):
            filas.extend(ambito(modelo, self.empresa).filter(report_id__in=tramo))
        return filas

    def _verificar(self):
        anotar = self.informe.anotar
        destino = {tabla: self._destino(tabla) for tabla in MODELOS}
        for tabla in MODELOS:
            leidos = self.informe.leidos[tabla]
            anotar(f"{tabla}: filas en Nexo / leídas", self.conteos_nexo.get(tabla), leidos)
            anotar(
                f"{tabla}: esperadas / en la intranet",
                self.esperados.get(tabla, leidos),
                len(destino[tabla]),
            )

        # Cada documento, idéntico al de Nexo (nada se recalculó ni se perdió).
        nexo = {f["report_id"]: f for f in self.datos["snapshot"]}
        vacios = {"data": {}, "data_quality": {}, "filters": {}, "nova": None}
        distintos = []
        for snap in destino["snapshot"]:
            fila = nexo[snap.report_id]
            for campo, vacio in vacios.items():
                original = fila[campo] if fila[campo] is not None else vacio
                if _json(getattr(snap, campo)) != _json(original):
                    distintos.append(f"{snap.report_id}.{campo}")
        anotar("Informes: documentos distintos de los de Nexo", 0, len(distintos))
        for campo in distintos[:20]:
            self.informe.problemas.append(f"{campo}: no coincide con Nexo.")

        anotar(
            "Informes: suma de colaboradores",
            sum(f["collaborator_count"] or 0 for f in self.datos["snapshot"]),
            sum(s.collaborator_count for s in destino["snapshot"]),
        )
        acciones_nexo = Counter(f["action"] for f in self.datos["auditlog"])
        acciones = Counter(e.action for e in destino["auditlog"])
        for accion in sorted(set(acciones_nexo) | set(acciones)):
            anotar(f"Bitácora: {accion}", acciones_nexo[accion], acciones[accion])

    # Orquestación ---------------------------------------------------------------

    def ejecutar(self) -> InformeInformes:
        self._leer()
        with usando_empresa(self.empresa):
            self._comprobar_destino()
            self._cruzar_usuarios()
            confirmar = False
            with transaction.atomic(), fechas_tal_cual(MODELOS.values()):
                self._crear()
                self._verificar()
                confirmar = self.aplicar and self.informe.cuadra
                if not confirmar:
                    transaction.set_rollback(True)
            self.informe.confirmado = confirmar
        return self.informe
