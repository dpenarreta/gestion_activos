"""Importación única de Tareas desde Nexo a una empresa de la intranet.

Mismo recorrido que la de Novedades (`apps.novedades.nexo.importador`):

1. Lee TODO de Nexo antes de abrir ninguna transacción: filas, conteos y
   sumas de control.
2. Comprueba, sin escribir, que la empresa no tenga datos de Tareas y que cada
   usuario de Nexo que hace falta exista en la intranet (por correo). Si no,
   aborta con la lista de lo que falta. No crea cuentas.
3. Dentro de UNA transacción crea todo con `bulk_create`, conservando las
   fechas originales y remapeando los ids (también los sueltos de las
   bitácoras y los de `MonthClosure.corrections`); luego verifica conteos y
   sumas.
4. En simulacro, o si la verificación no cuadra, deshace la transacción.

Lo propio de Tareas:

- Motivos (`ActivityReason`): los que la empresa ya tiene (sembrados con
  `seed_activity_reasons`) no cuentan como «datos» y no se duplican: se cruzan
  por `key` y se conservan como están en la intranet; si difieren de Nexo, se
  avisa. `TaskActivity.reason` guarda la `key` (sin FK), así que no cambia.
- Roles: el ADMINISTRADOR de Nexo es aquí el «Administrador de Gestión
  Humana» (`roles.ADMIN_GH`). Se renombra en `ActivityReason.assigned_roles`,
  en `user_role` de las bitácoras y en los roles de las reglas de aviso.
- Ajustes: van a `novedades.SettingHistory`, como en Novedades. Las horas y la
  ventana retroactiva conservan su clave; las reglas de aviso de Nexo (una
  clave con JSON) se parten en las dos claves de la intranet
  (`configuracion.CONFIG_KEY_FIRST_COMMENT_ROLE` y
  `CONFIG_KEY_RETROACTIVE_NOTIFY_ROLES`), con la misma vigencia.
  `comment_targets` no se migra: en la intranet avisa el organigrama.
"""

import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Sum

from apps.empresas.contexto import usando_empresa
from apps.novedades.models import SettingHistory
from apps.novedades.nexo.comun import (
    ImportacionAbortada,
    ImportadorBase,
    InformeBase,
    ambito,
    fechas_tal_cual,
    normal,
)

from ..configuracion import (
    CONFIG_KEY_FIRST_COMMENT_ROLE,
    CONFIG_KEY_HORAS_EFECTIVAS,
    CONFIG_KEY_HORAS_ESPERADAS_MES,
    CONFIG_KEY_RETROACTIVE_NOTIFY_ROLES,
    CONFIG_KEY_RETROACTIVE_WINDOW_DAYS,
    DEFAULT_RETROACTIVE_NOTIFY_ROLES,
)
from ..models import (
    ActivityAuditLog,
    ActivityComment,
    ActivityReason,
    Comment,
    EndDateAuditLog,
    MonthClosure,
    TargetTimeAuditLog,
    Task,
    TaskActivity,
    TaskCommentView,
)
from ..roles import ADMIN_GH, ALL_ROLES
from .lector import CLAVE_REGLAS_DE_AVISO, TABLAS, LectorNexoTareas

#: Tabla lógica de Nexo → modelo de la intranet donde termina.
MODELOS = {
    "activityreason": ActivityReason,
    "task": Task,
    "comment": Comment,
    "taskcommentview": TaskCommentView,
    "taskactivity": TaskActivity,
    "activitycomment": ActivityComment,
    "activityauditlog": ActivityAuditLog,
    "targettimeauditlog": TargetTimeAuditLog,
    "enddateauditlog": EndDateAuditLog,
    "monthclosure": MonthClosure,
    "systemconfighistory": SettingHistory,
}

#: Lo que NO se migra, con su razón (sale en el informe).
NO_SE_MIGRA = {
    "notification_rules.comment_targets": (
        "avisos de comentarios por rol: en la intranet avisa el organigrama"
    ),
    "LeaveRecord / SpecialStatus": "solo los usan Carga laboral y KPI, que no son de esta fase",
    "Holiday": "la intranet usa su calendario institucional (`apps.nomina`)",
}

#: El rol de Nexo que cambia de nombre en la intranet.
ROL_ADMINISTRADOR_NEXO = "ADMINISTRADOR"

#: Claves de `SettingHistory` que escribe esta importación (y que tienen que
#: estar vacías en la empresa).
CLAVES_DESTINO = (
    CONFIG_KEY_HORAS_EFECTIVAS,
    CONFIG_KEY_HORAS_ESPERADAS_MES,
    CONFIG_KEY_RETROACTIVE_WINDOW_DAYS,
    CONFIG_KEY_FIRST_COMMENT_ROLE,
    CONFIG_KEY_RETROACTIVE_NOTIFY_ROLES,
)

#: Ajustes que pasan con la misma clave y el mismo valor.
CLAVES_TAL_CUAL = (
    CONFIG_KEY_HORAS_EFECTIVAS,
    CONFIG_KEY_HORAS_ESPERADAS_MES,
    CONFIG_KEY_RETROACTIVE_WINDOW_DAYS,
)

#: Lo que no cuenta como «datos» al comprobar que el destino está vacío.
_SIN_COMPROBAR = {"activityreason", "systemconfighistory"}


def renombrar_rol(rol):
    return ADMIN_GH if rol == ROL_ADMINISTRADOR_NEXO else rol


@dataclass
class InformeTareas(InformeBase):
    #: Motivos que ya existían en la empresa: `key`, `label` y en qué difieren.
    motivos_cruzados: list[dict] = field(default_factory=list)
    #: Por tabla, cuántos valores ADMINISTRADOR se renombraron.
    roles_renombrados: dict[str, int] = field(default_factory=dict)


class ImportadorNexoTareas(ImportadorBase):
    modelos = MODELOS
    tablas = TABLAS
    informe_class = InformeTareas

    def __init__(self, lector: LectorNexoTareas, empresa, *, aplicar: bool = False):
        super().__init__(lector, empresa, aplicar=aplicar)
        #: tabla → filas que deben quedar en la intranet (si no, las leídas).
        self.esperados: dict[str, int] = {}

    # 1. Lectura ---------------------------------------------------------------

    def _leer(self):
        self.datos = {tabla: self.lector.filas(tabla) for tabla in TABLAS}
        self.informe.leidos = {tabla: len(filas) for tabla, filas in self.datos.items()}
        self.conteos_nexo = self.lector.conteos()
        self.totales_nexo = self.lector.totales()

        self.usuarios_necesarios = self._usuarios_de_las_filas()
        # Quién corrigió un cierre de mes: va en un JSON; si no se encuentra,
        # queda como «nexo:<id>», no aborta.
        opcionales = set()
        for cierre in self.datos["monthclosure"]:
            for correccion in _correcciones(cierre):
                if isinstance(correccion.get("correctedBy"), int):
                    opcionales.add(correccion["correctedBy"])
        self.usuarios_nexo = {
            u["id"]: u for u in self.lector.usuarios(self.usuarios_necesarios | opcionales)
        }

    # 2. Comprobaciones previas -------------------------------------------------

    def _comprobar_destino_vacio(self):
        con_datos = [
            modelo.__name__
            for tabla, modelo in MODELOS.items()
            if tabla not in _SIN_COMPROBAR and ambito(modelo, self.empresa).exists()
        ]
        claves = sorted(
            set(
                ambito(SettingHistory, self.empresa)
                .filter(key__in=CLAVES_DESTINO)
                .values_list("key", flat=True)
            )
        )
        if claves:
            con_datos.append(f"SettingHistory ({', '.join(claves)})")
        if con_datos:
            raise ImportacionAbortada(
                f"La empresa «{self.empresa}» ya tiene datos de Tareas; la importación solo "
                "se hace sobre una empresa sin datos del módulo (no mezcla ni reemplaza). Los "
                "motivos de actividad ya sembrados no cuentan: se cruzan por su clave.",
                [f"Con datos: {nombre}" for nombre in con_datos],
                codigo="destino_con_datos",
            )

    # 3. Escritura ---------------------------------------------------------------

    def _rol(self, tabla: str, rol):
        nuevo = renombrar_rol(rol)
        if nuevo != rol:
            self.informe.roles_renombrados[tabla] = self.informe.roles_renombrados.get(tabla, 0) + 1
        return nuevo

    def _roles(self, tabla: str, roles, contexto: str):
        if not isinstance(roles, list):
            self.informe.avisos.append(f"{contexto}: los roles no son una lista ({roles!r}).")
            return roles
        nuevos = list(dict.fromkeys(self._rol(tabla, r) for r in roles))
        desconocidos = [r for r in nuevos if r not in ALL_ROLES]
        if desconocidos:
            self.informe.avisos.append(
                f"{contexto}: roles que la intranet no conoce: {', '.join(map(str, desconocidos))}."
            )
        return nuevos

    def _id_suelto(self, tabla: str, id_nexo, contexto: str) -> int:
        """Id suelto (sin FK) de una bitácora. Si apunta a algo que en Nexo ya
        se borró —para eso es suelto—, queda 0: nunca un id de la intranet."""
        nuevo = self.mapas[tabla].get(id_nexo)
        if nuevo is None:
            self.informe.avisos.append(
                f"{contexto}: {tabla} #{id_nexo} ya no existe en Nexo; queda con id 0."
            )
            return 0
        return nuevo

    def _crear_motivos(self):
        existentes = {r.key: r for r in ambito(ActivityReason, self.empresa)}
        etiquetas = {r.label: r.key for r in existentes.values()}
        pares = []
        for f in self.datos["activityreason"]:
            contexto = f"activityreason «{f['key']}»"
            roles = self._roles("activityreason", f["assigned_roles"] or [], contexto)
            propio = existentes.get(f["key"])
            if propio is not None:
                self.mapas["activityreason"][f["id"]] = propio.pk
                diferencias = [
                    nombre
                    for nombre, nexo, intranet in (
                        ("etiqueta", f["label"], propio.label),
                        ("roles", sorted(map(str, roles)), sorted(map(str, propio.assigned_roles))),
                        ("activo", f["is_active"], propio.is_active),
                        ("archivado", f["is_archived"], propio.is_archived),
                    )
                    if nexo != intranet
                ]
                self.informe.motivos_cruzados.append(
                    {"key": f["key"], "label": propio.label, "diferencias": diferencias}
                )
                if diferencias:
                    self.informe.avisos.append(
                        f"{contexto} ya existía en la intranet y se conserva como está; "
                        f"difiere de Nexo en: {', '.join(diferencias)}."
                    )
                continue
            if f["label"] in etiquetas:
                self.informe.avisos.append(
                    f"{contexto}: la intranet ya tiene un motivo «{f['label']}» con otra clave "
                    f"(«{etiquetas[f['label']]}»); quedan los dos."
                )
            pares.append(
                (
                    f["id"],
                    ActivityReason(
                        empresa=self.empresa,
                        key=f["key"],
                        label=f["label"],
                        description=f["description"],
                        is_active=f["is_active"],
                        is_archived=f["is_archived"],
                        archived_at=f["archived_at"],
                        assigned_roles=roles,
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
            )
        # El informe cuenta lo creado; los cruzados se listan aparte.
        self._insertar("activityreason", pares, ("key",))

    def _crear(self):
        e = self.empresa
        u = self._u
        d = self.datos

        self._crear_motivos()

        self._insertar(
            "task",
            [
                (
                    f["id"],
                    Task(
                        empresa=e,
                        title=f["title"],
                        description=f["description"],
                        status=f["status"],
                        priority=f["priority"],
                        frequency=f["frequency"],
                        type=f["type"],
                        start_date=f["start_date"],
                        end_date=f["end_date"],
                        estimated_hours=f["estimated_hours"],
                        real_hours=f["real_hours"],
                        target_time_validated=f["target_time_validated"],
                        target_time_validated_at=f["target_time_validated_at"],
                        target_time_validated_by_id=u(f["target_time_validated_by_id"]),
                        end_date_approval_status=f["end_date_approval_status"],
                        end_date_approved_at=f["end_date_approved_at"],
                        end_date_approved_by_id=u(f["end_date_approved_by_id"]),
                        progress=f["progress"],
                        completed_at=f["completed_at"],
                        color=f["color"],
                        archived_month=f["archived_month"],
                        archived_at=f["archived_at"],
                        successor_created_at=f["successor_created_at"],
                        corrected=f["corrected"],
                        assigned_to_id=u(f["assigned_to_id"]),
                        created_by_id=u(f["created_by_id"]),
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in d["task"]
            ],
            ("assigned_to_id", "created_by_id", "created_at", "title"),
        )

        def tarea(id_nexo, contexto):
            return self._id("task", id_nexo, contexto=contexto)

        self._insertar(
            "comment",
            [
                (
                    f["id"],
                    Comment(
                        task_id=tarea(f["task_id"], f"comment #{f['id']}"),
                        author_id=u(f["author_id"]),
                        text=f["text"],
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in d["comment"]
            ],
        )
        self._insertar(
            "taskcommentview",
            [
                (
                    f["id"],
                    TaskCommentView(
                        task_id=tarea(f["task_id"], f"taskcommentview #{f['id']}"),
                        user_id=u(f["user_id"]),
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in d["taskcommentview"]
            ],
        )

        claves_de_motivo = {f["key"] for f in d["activityreason"]} | set(
            ambito(ActivityReason, e).values_list("key", flat=True)
        )
        sin_motivo = Counter(
            f["reason"] for f in d["taskactivity"] if f["reason"] not in claves_de_motivo
        )
        for clave, veces in sorted(sin_motivo.items()):
            self.informe.avisos.append(
                f"taskactivity: {veces} registros con el motivo «{clave}», que no está en el "
                "catálogo (se conservan tal cual, como en Nexo)."
            )
        self._insertar(
            "taskactivity",
            [
                (
                    f["id"],
                    TaskActivity(
                        task_id=tarea(f["task_id"], f"taskactivity #{f['id']}"),
                        author_id=u(f["author_id"]),
                        reason=f["reason"],
                        start_time=f["start_time"],
                        end_time=f["end_time"],
                        duration=f["duration"],
                        description=f["description"],
                        is_retroactive=f["is_retroactive"],
                        activity_date=f["activity_date"],
                        admin_comment=f["admin_comment"],
                        modified_by_admin=f["modified_by_admin"],
                        modified_at=f["modified_at"],
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in d["taskactivity"]
            ],
            ("task_id", "author_id", "created_at", "duration", "reason"),
        )
        self._insertar(
            "activitycomment",
            [
                (
                    f["id"],
                    ActivityComment(
                        activity_id=self._id(
                            "taskactivity", f["activity_id"], contexto=f"activitycomment #{f['id']}"
                        ),
                        author_id=u(f["author_id"]),
                        text=f["text"],
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in d["activitycomment"]
            ],
        )

        # Bitácoras: ids sueltos y rol del actor en ese momento.
        self._insertar(
            "activityauditlog",
            [
                (
                    f["id"],
                    ActivityAuditLog(
                        empresa=e,
                        activity_id=self._id_suelto(
                            "taskactivity", f["activity_id"], f"activityauditlog #{f['id']}"
                        ),
                        admin_id=u(f["admin_id"]),
                        old_duration=f["old_duration"],
                        new_duration=f["new_duration"],
                        comment=f["comment"],
                        modified_at=f["modified_at"],
                        created_at=f["modified_at"],
                        updated_at=f["modified_at"],
                    ),
                )
                for f in d["activityauditlog"]
            ],
        )
        self._insertar(
            "targettimeauditlog",
            [
                (
                    f["id"],
                    TargetTimeAuditLog(
                        empresa=e,
                        task_id=self._id_suelto(
                            "task", f["task_id"], f"targettimeauditlog #{f['id']}"
                        ),
                        user_id=u(f["user_id"]),
                        user_role=self._rol("targettimeauditlog", f["user_role"]),
                        previous_value=f["previous_value"],
                        new_value=f["new_value"],
                        reason=f["reason"],
                        reason_detail=f["reason_detail"],
                        ip_address=f["ip_address"],
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in d["targettimeauditlog"]
            ],
        )
        self._insertar(
            "enddateauditlog",
            [
                (
                    f["id"],
                    EndDateAuditLog(
                        empresa=e,
                        task_id=self._id_suelto(
                            "task", f["task_id"], f"enddateauditlog #{f['id']}"
                        ),
                        user_id=u(f["user_id"]),
                        user_role=self._rol("enddateauditlog", f["user_role"]),
                        action=f["action"],
                        previous_value=f["previous_value"],
                        new_value=f["new_value"],
                        observaciones=f["observaciones"],
                        ip_address=f["ip_address"],
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in d["enddateauditlog"]
            ],
        )

        self._insertar(
            "monthclosure",
            [
                (
                    f["id"],
                    MonthClosure(
                        empresa=e,
                        month=f["month"],
                        year=f["year"],
                        closed_by_id=u(f["closed_by_id"]),
                        closed_at=f["closed_at"],
                        cutoff_date=f["cutoff_date"],
                        closure_type=f["closure_type"],
                        calendar_days_total=f["calendar_days_total"],
                        calendar_days_considered=f["calendar_days_considered"],
                        working_days_considered=f["working_days_considered"],
                        working_hours_considered=f["working_hours_considered"],
                        total_tasks=f["total_tasks"],
                        completed_tasks=f["completed_tasks"],
                        summary=f["summary"] if f["summary"] is not None else {},
                        corrections=self._remapear_correcciones(f),
                        created_at=f["closed_at"],
                        updated_at=f["closed_at"],
                    ),
                )
                for f in d["monthclosure"]
            ],
        )

        self._crear_ajustes()

    def _remapear_correcciones(self, cierre: dict):
        """`MonthClosure.corrections`: `taskId` y `correctedBy` son ids de
        Nexo dentro de un JSON. Se remapean; si no tienen equivalente quedan
        como «nexo:<id>», para no confundirlos con un id de la intranet."""
        if cierre["corrections"] is None:
            return None
        if not isinstance(cierre["corrections"], list):
            self.informe.avisos.append(
                f"monthclosure #{cierre['id']}: `corrections` no es una lista; queda tal cual."
            )
            return cierre["corrections"]
        resultado = []
        for correccion in cierre["corrections"]:
            if not isinstance(correccion, dict):
                resultado.append(correccion)
                continue
            nueva = dict(correccion)
            for campo, mapa in (("taskId", self.mapas["task"]), ("correctedBy", self.usuarios)):
                original = correccion.get(campo)
                if not isinstance(original, int) or isinstance(original, bool):
                    continue
                if original in mapa:
                    nueva[campo] = mapa[original]
                else:
                    nueva[campo] = f"nexo:{original}"
                    self.informe.avisos.append(
                        f"monthclosure #{cierre['id']}: {campo} {original} sin equivalente; "
                        f"queda como «nexo:{original}»."
                    )
            resultado.append(nueva)
        return resultado

    def _crear_ajustes(self):
        """Ajustes con vigencia. Las reglas de aviso de Nexo (una clave con
        JSON) dan dos registros en la intranet, con la misma vigencia."""
        largo = SettingHistory._meta.get_field("value").max_length
        pares = []
        esperados = 0
        con_destinos_por_rol = False
        for f in self.datos["systemconfighistory"]:
            if f["key"] == CLAVE_REGLAS_DE_AVISO:
                valores, con_destinos = self._partir_reglas_de_aviso(f)
                con_destinos_por_rol |= con_destinos
            else:
                valores = [(f["key"], str(f["value"]))]
            esperados += len(valores)
            for clave, valor in valores:
                if len(valor) > largo:
                    self.informe.problemas.append(
                        f"systemconfighistory #{f['id']}: valor de «{clave}» demasiado largo "
                        f"({len(valor)} > {largo})."
                    )
                    continue
                pares.append(
                    (
                        f["id"],
                        SettingHistory(
                            empresa=self.empresa,
                            key=clave,
                            value=valor,
                            valid_from=f["valid_from"],
                            valid_until=f["valid_until"],
                            updated_by_id=self._u(f["updated_by_id"]),
                            created_at=f["created_at"],
                            updated_at=f["created_at"],
                        ),
                    )
                )
        if con_destinos_por_rol:
            self.informe.avisos.append(
                "notification_rules.comment_targets (a quién avisa un comentario, por rol) no "
                "se migra: en la intranet avisa el organigrama."
            )
        self.esperados["systemconfighistory"] = esperados
        self._insertar("systemconfighistory", pares)

    def _partir_reglas_de_aviso(self, fila: dict) -> tuple[list[tuple[str, str]], bool]:
        """Las dos claves de la intranet a partir del JSON de Nexo, con la
        misma lectura que hacía Nexo (`get_effective_notification_rules`): si
        no es un objeto JSON, rigen los valores por defecto."""
        contexto = f"systemconfighistory #{fila['id']} ({CLAVE_REGLAS_DE_AVISO})"
        try:
            reglas = json.loads(fila["value"])
        except (TypeError, ValueError):
            reglas = None
        if not isinstance(reglas, dict):
            self.informe.avisos.append(
                f"{contexto}: no es un objeto JSON; se guardan los valores por defecto de Nexo."
            )
            reglas = {
                "first_comment_role": None,
                "retroactive_notify_roles": list(DEFAULT_RETROACTIVE_NOTIFY_ROLES),
            }
        primero = reglas.get("first_comment_role")
        primero = self._rol("systemconfighistory", primero) if primero else ""
        if primero and primero not in ALL_ROLES:
            self.informe.avisos.append(f"{contexto}: rol que la intranet no conoce: {primero}.")
        retroactivos = self._roles(
            "systemconfighistory", reglas.get("retroactive_notify_roles") or [], contexto
        )
        return (
            [
                (CONFIG_KEY_FIRST_COMMENT_ROLE, primero),
                (CONFIG_KEY_RETROACTIVE_NOTIFY_ROLES, json.dumps(retroactivos, ensure_ascii=False)),
            ],
            bool(reglas.get("comment_targets")),
        )

    # 4. Verificación -----------------------------------------------------------

    def _destino(self, tabla: str):
        """Lo de la empresa que corresponde a la tabla de Nexo."""
        qs = ambito(MODELOS[tabla], self.empresa)
        if tabla == "activityreason":
            return qs.filter(key__in={f["key"] for f in self.datos["activityreason"]})
        if tabla == "systemconfighistory":
            return qs.filter(key__in=CLAVES_DESTINO)
        return qs

    def _verificar(self):
        anotar = self.informe.anotar
        for tabla in MODELOS:
            leidos = self.informe.leidos[tabla]
            anotar(f"{tabla}: filas en Nexo / leídas", self.conteos_nexo.get(tabla), leidos)
            anotar(
                f"{tabla}: esperadas / en la intranet",
                self.esperados.get(tabla, leidos),
                self._destino(tabla).count(),
            )

        # Tareas por mes de archivo (vacío: vigentes).
        tareas: dict[str, dict] = defaultdict(
            lambda: {"registros": 0, "horas_estimadas": 0.0, "horas_reales": 0.0}
        )
        for fila in (
            ambito(Task, self.empresa)
            .values("archived_month")
            .annotate(
                registros=Count("id"),
                horas_estimadas=Sum("estimated_hours"),
                horas_reales=Sum("real_hours"),
            )
            .order_by()
        ):
            c = tareas[fila["archived_month"] or ""]
            c["registros"] += fila["registros"]
            c["horas_estimadas"] += fila["horas_estimadas"] or 0.0
            c["horas_reales"] += fila["horas_reales"] or 0.0
        self._comparar("Tareas", self.totales_nexo.get("tareas", {}), tareas, _etiqueta_archivo)

        # Registros de horas por mes (UTC), calculado aquí y no con
        # ExtractMonth para no depender de la zona horaria de la conexión.
        actividades: dict[tuple, dict] = defaultdict(lambda: {"registros": 0, "minutos": 0})
        for fecha, creado, minutos in (
            ambito(TaskActivity, self.empresa)
            .values_list("activity_date", "created_at", "duration")
            .iterator(chunk_size=2000)
        ):
            momento = (fecha or creado).astimezone(UTC)
            c = actividades[(momento.year, momento.month)]
            c["registros"] += 1
            c["minutos"] += minutos
        self._comparar(
            "Horas registradas",
            self.totales_nexo.get("actividades", {}),
            actividades,
            lambda k: f"{k[1]:02d}/{k[0]}",
        )

    def _comparar(self, etiqueta, nexo: dict, intranet: dict, nombre):
        totales_nexo: dict[str, Decimal] = defaultdict(Decimal)
        totales_intranet: dict[str, Decimal] = defaultdict(Decimal)
        for clave in sorted(set(nexo) | set(intranet), key=str):
            a, b = nexo.get(clave, {}), intranet.get(clave, {})
            for medida in sorted(set(a) | set(b)):
                va, vb = normal(a.get(medida)), normal(b.get(medida))
                totales_nexo[medida] += va
                totales_intranet[medida] += vb
                self.informe.anotar(f"{etiqueta} {nombre(clave)}: {medida}", va, vb)
        for medida in sorted(set(totales_nexo) | set(totales_intranet)):
            self.informe.anotar(
                f"{etiqueta} (total): {medida}",
                normal(totales_nexo[medida]),
                normal(totales_intranet[medida]),
            )

    # Orquestación ---------------------------------------------------------------

    def ejecutar(self) -> InformeTareas:
        self._leer()
        with usando_empresa(self.empresa):
            self._comprobar_destino_vacio()
            self._cruzar_usuarios()
            with transaction.atomic(), fechas_tal_cual(dict.fromkeys(MODELOS.values())):
                self._crear()
                self._verificar()
                if self.aplicar and self.informe.cuadra:
                    self.informe.confirmado = True
                else:
                    transaction.set_rollback(True)
        return self.informe


def _correcciones(cierre: dict) -> list[dict]:
    valor = cierre.get("corrections")
    if not isinstance(valor, list):
        return []
    return [c for c in valor if isinstance(c, dict)]


def _etiqueta_archivo(mes: str) -> str:
    return f"archivadas {mes}" if mes else "vigentes"
