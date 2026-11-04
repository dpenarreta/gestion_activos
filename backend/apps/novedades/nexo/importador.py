"""Importación única de Nexo a una empresa de la intranet.

Recorrido (`ImportadorNexo.ejecutar`):

1. Lee TODO de Nexo antes de abrir ninguna transacción (nada de transacciones
   abiertas mientras se espera a otra base): filas, conteos, sumas de control
   y, si se piden, los roles operativos.
2. Comprueba, sin escribir, que la empresa no tenga datos del módulo y que
   cada usuario de Nexo que hace falta exista en la intranet (por correo, sin
   distinguir mayúsculas). Si no, aborta con la lista de lo que falta.
3. Dentro de UNA transacción crea todo con `bulk_create`, conservando las
   fechas originales, remapea los ids (también las referencias sueltas) y
   enmascara las cédulas del historial; luego verifica conteos y sumas.
4. En simulacro, o si la verificación no cuadra, deshace la transacción. Con
   `aplicar=True` y todo en orden, confirma.

Ids: el backend de SQL Server no devuelve los ids de un `bulk_create`. Por eso,
lo que otros registros referencian se recupera después por su clave natural
(la cédula en la empresa, el colaborador y la fecha, etc.); si una clave se
repite en Nexo, esas filas se insertan una a una para conocer su id.
"""

import re
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Iterable
from contextlib import contextmanager
from dataclasses import dataclass, field
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import transaction
from django.db.models import Count, Sum
from django.db.models.functions import Lower
from django.utils import timezone

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import MembresiaEmpresa
from apps.organizacion.models import Empleado

from ..models import (
    ClosedPeriodCorrection,
    Collaborator,
    CollaboratorAssignment,
    CollaboratorEntryNotification,
    CollaboratorExitNotification,
    CollaboratorNotificationRecipient,
    CollaboratorStatusChange,
    DepuratedOvertime,
    DepurationChange,
    NovedadEvent,
    OperationalPeriod,
    OvertimeDepuration,
    OvertimeMonthClose,
    OvertimeRecord,
    PermissionOverride,
    SettingHistory,
    SupervisorPeriod,
    WorkedDay,
    mask_cedula,
)
from .lector import TABLAS, LectorNexo

#: Tabla lógica de Nexo → modelo de la intranet donde termina.
MODELOS = {
    "collaborator": Collaborator,
    "collaboratorassignment": CollaboratorAssignment,
    "collaboratorstatuschange": CollaboratorStatusChange,
    "operationalperiod": OperationalPeriod,
    "supervisorperiod": SupervisorPeriod,
    "overtimemonthclose": OvertimeMonthClose,
    "workedday": WorkedDay,
    "overtimerecord": OvertimeRecord,
    "closedperiodcorrection": ClosedPeriodCorrection,
    "permissionoverride": PermissionOverride,
    "overtimedepuration": OvertimeDepuration,
    "depuratedovertime": DepuratedOvertime,
    "depurationchange": DepurationChange,
    "collaboratornotificationrecipient": CollaboratorNotificationRecipient,
    "collaboratorexitnotification": CollaboratorExitNotification,
    "collaboratorentrynotification": CollaboratorEntryNotification,
    "novedadevent": NovedadEvent,
    "systemconfighistory": SettingHistory,
}

#: Lo que NO se migra, con su razón (sale en el informe).
NO_SE_MIGRA = {
    "ImportBatch": "vistas previas de importaciones de Excel: trabajo en curso, no historia",
    "PendingNotification": "bandeja de avisos de la campana de Nexo",
}

#: `NovedadEvent.target_type` cuyo `target_id` es el id de un registro migrado.
TIPOS_CON_ID = {
    "collaborator": "collaborator",
    "worked_day": "workedday",
    "overtime": "overtimerecord",
    "supervisor_period": "supervisorperiod",
    "overtime_month": "overtimemonthclose",
    "overtime_depuration": "overtimedepuration",
    "depurated_overtime": "depuratedovertime",
    "notification_recipient": "collaboratornotificationrecipient",
    "user": "usuario",
}

#: `ClosedPeriodCorrection.target` → tabla del registro corregido.
OBJETIVOS_DE_CORRECCION = {
    ClosedPeriodCorrection.Target.WORKED_DAY: "workedday",
    ClosedPeriodCorrection.Target.OVERTIME: "overtimerecord",
}


class ImportacionAbortada(Exception):
    """La importación no puede empezar: nada se escribió."""

    def __init__(self, mensaje: str, detalle: Iterable[str] = (), codigo: str = "abortada"):
        super().__init__(mensaje)
        self.mensaje = mensaje
        self.detalle = list(detalle)
        self.codigo = codigo


@dataclass
class Informe:
    aplicar: bool
    leidos: dict[str, int] = field(default_factory=dict)
    creados: dict[str, int] = field(default_factory=dict)
    #: Colaboradores enlazados por nombre: cédula enmascarada, nombre, código.
    enlazados: list[dict] = field(default_factory=list)
    #: Colaboradores sin Empleado: cédula enmascarada, nombre y motivo.
    sin_enlace: list[dict] = field(default_factory=list)
    usuarios_faltantes: list[str] = field(default_factory=list)
    roles: list[dict] = field(default_factory=list)
    verificacion: list[dict] = field(default_factory=list)
    #: Referencias que no se pudieron remapear (hacen fallar la verificación).
    problemas: list[str] = field(default_factory=list)
    #: Avisos que no invalidan la importación.
    avisos: list[str] = field(default_factory=list)
    confirmado: bool = False

    @property
    def cuadra(self) -> bool:
        return not self.problemas and all(v["ok"] for v in self.verificacion)


# ── Utilidades ────────────────────────────────────────────────────────────────


def normalizar_nombre(texto: str) -> tuple[str, ...]:
    """Palabras del nombre sin tildes, en mayúsculas y sin signos, ordenadas:
    «Pérez  Ana-María» y «ANA MARIA PEREZ» dan lo mismo. Se compara la
    colección de palabras (con repeticiones), no su orden."""
    sin_tildes = "".join(
        c for c in unicodedata.normalize("NFKD", str(texto or "")) if not unicodedata.combining(c)
    )
    palabras = re.sub(r"[^0-9A-Za-z]+", " ", sin_tildes).upper().split()
    return tuple(sorted(palabras))


_TOKEN = re.compile(r"[0-9A-Za-z]+")


class Enmascarador:
    """Reemplaza en un texto cada cédula conocida por su versión enmascarada
    (`mask_cedula`: puntos y los últimos 4). Compara palabras completas, así
    que un número que solo contiene una cédula no se toca."""

    def __init__(self, cedulas: Iterable[str]):
        self.cedulas = {str(c).strip() for c in cedulas if c and str(c).strip()}

    def texto(self, valor):
        if not isinstance(valor, str) or not valor:
            return valor
        return _TOKEN.sub(
            lambda m: mask_cedula(m.group()) if m.group() in self.cedulas else m.group(), valor
        )

    def json(self, valor):
        if isinstance(valor, dict):
            return {k: self.json(v) for k, v in valor.items()}
        if isinstance(valor, list):
            return [self.json(v) for v in valor]
        return self.texto(valor)


@contextmanager
def fechas_tal_cual(modelos):
    """Desactiva `auto_now`/`auto_now_add` de esos modelos mientras dura el
    bloque, para que `bulk_create` guarde las fechas de Nexo en vez de la hora
    actual. Los campos de un modelo abstracto se copian en cada modelo
    concreto, así que solo se tocan los de estos. Se restauran siempre."""
    cambiados = []
    for modelo in modelos:
        for campo in modelo._meta.concrete_fields:
            if getattr(campo, "auto_now", False) or getattr(campo, "auto_now_add", False):
                cambiados.append((campo, campo.auto_now, campo.auto_now_add))
                campo.auto_now = campo.auto_now_add = False
    try:
        yield
    finally:
        for campo, auto_now, auto_now_add in cambiados:
            campo.auto_now, campo.auto_now_add = auto_now, auto_now_add


def _ambito(modelo, empresa):
    """Filtro de lo que pertenece a la empresa, sea raíz o cuelgue de otro."""
    return modelo.objects.todas().filter(**{modelo.objects.ruta_de_empresa: empresa})


# ── Importador ────────────────────────────────────────────────────────────────


class ImportadorNexo:
    def __init__(
        self, lector: LectorNexo, empresa, *, aplicar: bool = False, asignar_roles: bool = False
    ):
        self.lector = lector
        self.empresa = empresa
        self.aplicar = aplicar
        self.asignar_roles = asignar_roles
        self.informe = Informe(aplicar=aplicar)
        #: tabla → {id de Nexo: id en la intranet}
        self.mapas: dict[str, dict[int, int]] = defaultdict(dict)

    # 1. Lectura ---------------------------------------------------------------

    def _leer(self):
        self.datos = {tabla: self.lector.filas(tabla) for tabla in TABLAS}
        self.informe.leidos = {tabla: len(filas) for tabla, filas in self.datos.items()}
        self.conteos_nexo = self.lector.conteos()
        self.totales_nexo = self.lector.totales()
        self.roles_nexo = self.lector.roles_operativos() if self.asignar_roles else []

        necesarios = set()
        for tabla, filas in self.datos.items():
            columnas = TABLAS[tabla].usuarios
            for fila in filas:
                necesarios |= {fila[c] for c in columnas if fila.get(c) is not None}
        opcionales = {r["user_id"] for r in self.roles_nexo}
        for evento in self.datos["novedadevent"]:
            if evento["target_type"] == "user" and str(evento["target_id"]).isdigit():
                opcionales.add(int(evento["target_id"]))
        self.usuarios_necesarios = necesarios
        self.usuarios_nexo = {u["id"]: u for u in self.lector.usuarios(necesarios | opcionales)}

    # 2. Comprobaciones previas -------------------------------------------------

    def _periodos_vacios(self) -> list[int]:
        """Los períodos sin ningún registro que cuelgue de ellos. La pantalla
        crea el del mes en curso con solo abrirla: no son datos, y se
        eliminan dentro de la misma transacción de la importación."""
        relaciones = [r for r in OperationalPeriod._meta.related_objects if r.field.many_to_one]
        vacios = []
        for periodo in _ambito(OperationalPeriod, self.empresa):
            if not any(
                r.related_model._base_manager.filter(**{r.field.name: periodo}).exists()
                for r in relaciones
            ):
                vacios.append(periodo.pk)
        return vacios

    def _comprobar_destino_vacio(self):
        con_datos = []
        self.periodos_vacios = []
        for modelo in dict.fromkeys(MODELOS.values()):
            if not _ambito(modelo, self.empresa).exists():
                continue
            if modelo is OperationalPeriod:
                vacios = self._periodos_vacios()
                if len(vacios) == _ambito(OperationalPeriod, self.empresa).count():
                    self.periodos_vacios = vacios
                    continue
            con_datos.append(modelo.__name__)
        if con_datos:
            raise ImportacionAbortada(
                f"La empresa «{self.empresa}» ya tiene datos de Novedades; la importación "
                "solo se hace sobre una empresa sin datos del módulo (no mezcla ni reemplaza).",
                [f"Con datos: {nombre}" for nombre in con_datos],
                codigo="destino_con_datos",
            )

    def _cruzar_usuarios(self):
        """Usuario de Nexo → usuario de la intranet, por correo. Aborta si
        falta alguno de los que referencia un registro."""
        correos = {
            uid: str(u.get("email") or "").strip().lower() for uid, u in self.usuarios_nexo.items()
        }
        por_correo = defaultdict(list)
        intranet = (
            get_user_model()
            .objects.annotate(correo=Lower("email"))
            .filter(correo__in={c for c in correos.values() if c})
            .values_list("correo", "id")
        )
        for correo, uid in intranet:
            por_correo[correo].append(uid)

        self.usuarios = {}
        faltantes = set()
        for uid in sorted(self.usuarios_necesarios | set(self.usuarios_nexo)):
            fila = self.usuarios_nexo.get(uid)
            correo = correos.get(uid, "")
            coincidencias = por_correo.get(correo, []) if correo else []
            if len(coincidencias) == 1:
                self.usuarios[uid] = coincidencias[0]
                continue
            if uid not in self.usuarios_necesarios:
                continue
            if fila is None:
                faltantes.add(f"(usuario #{uid} de Nexo: no existe en Nexo)")
            elif not correo:
                faltantes.add(f"(usuario «{fila.get('username')}» de Nexo: sin correo)")
            elif coincidencias:
                faltantes.add(f"{correo} (varias cuentas de la intranet con ese correo)")
            else:
                faltantes.add(correo)
        if faltantes:
            self.informe.usuarios_faltantes = sorted(faltantes)
            raise ImportacionAbortada(
                f"Faltan {len(faltantes)} usuarios en la intranet. Créelos (con el mismo correo "
                "que en Nexo) y vuelva a ejecutar; no se creó ni se cambió nada.",
                sorted(faltantes),
                codigo="usuarios_faltantes",
            )

    def _u(self, uid):
        return None if uid is None else self.usuarios[uid]

    # 3. Escritura ---------------------------------------------------------------

    def _insertar(
        self,
        tabla: str,
        pares: list[tuple[int, object]],
        clave: tuple[str, ...] | None = None,
    ):
        """Inserta por lotes y, si se da `clave` (atributos de la clave natural
        en la intranet), recupera el id nuevo de cada fila de Nexo."""
        modelo = MODELOS[tabla]
        self.informe.creados[tabla] = self.informe.creados.get(tabla, 0) + len(pares)
        if not pares:
            return
        if clave is None:
            modelo.objects.bulk_create([obj for _, obj in pares])
            return

        def clave_de(obj):
            return tuple(getattr(obj, a) for a in clave)

        repeticiones = Counter(clave_de(obj) for _, obj in pares)
        en_lote = [(i, o) for i, o in pares if repeticiones[clave_de(o)] == 1]
        sueltos = [(i, o) for i, o in pares if repeticiones[clave_de(o)] > 1]
        modelo.objects.bulk_create([obj for _, obj in en_lote])
        for id_nexo, obj in sueltos:
            # Clave repetida: una a una, que sí devuelve el id.
            obj.save(force_insert=True)
            self.mapas[tabla][id_nexo] = obj.pk

        buscadas = {clave_de(o): i for i, o in en_lote}
        for fila in _ambito(modelo, self.empresa).values_list("pk", *clave):
            id_nexo = buscadas.get(tuple(fila[1:]))
            if id_nexo is not None:
                self.mapas[tabla][id_nexo] = fila[0]
        perdidos = len(pares) - len(self.mapas[tabla])
        if perdidos:
            self.informe.problemas.append(
                f"{tabla}: {perdidos} filas creadas sin poder recuperar su id."
            )

    def _id(self, tabla: str, id_nexo, *, requerido=True, contexto=""):
        if id_nexo is None:
            return None
        nuevo = self.mapas[tabla].get(id_nexo)
        if nuevo is None and requerido:
            self.informe.problemas.append(
                f"{contexto or tabla}: referencia a {tabla} #{id_nexo} de Nexo sin registro migrado."
            )
        return nuevo

    def _enlazar_empleados(self, colaboradores: list[dict]) -> dict[int, Empleado | None]:
        """Empleado de la empresa cuyo nombre completo coincide (normalizado)
        con el del colaborador. Solo si hay exactamente uno, y ese Empleado no
        coincide con otro colaborador."""
        por_nombre = defaultdict(list)
        for empleado in Empleado.objects.todas().filter(empresa=self.empresa):
            por_nombre[normalizar_nombre(f"{empleado.nombres} {empleado.apellidos}")].append(
                empleado
            )
        candidato = {}
        for fila in colaboradores:
            candidatos = por_nombre.get(normalizar_nombre(fila["full_name"]), [])
            candidato[fila["id"]] = candidatos
        usos = Counter(c[0].pk for c in candidato.values() if len(c) == 1)

        enlace = {}
        for fila in colaboradores:
            candidatos = candidato[fila["id"]]
            datos = {"cedula": mask_cedula(fila["cedula"]), "nombre": fila["full_name"]}
            if len(candidatos) == 1 and usos[candidatos[0].pk] == 1:
                empleado = candidatos[0]
                enlace[fila["id"]] = empleado
                self.informe.enlazados.append(
                    {
                        **datos,
                        "codigo_empleado": empleado.codigo_empleado,
                        "empleado": f"{empleado.nombres} {empleado.apellidos}",
                    }
                )
                continue
            enlace[fila["id"]] = None
            if not candidatos:
                motivo = "sin coincidencia de nombre"
            elif len(candidatos) > 1:
                motivo = f"{len(candidatos)} empleados con ese nombre"
            else:
                motivo = "el empleado coincide con más de un colaborador"
            self.informe.sin_enlace.append({**datos, "motivo": motivo})
        return enlace

    def _crear(self):
        e = self.empresa
        u = self._u
        d = self.datos
        ahora = timezone.now()

        # Cédulas conocidas: las de hoy, las copiadas a la base depurada y las
        # que aparecen en cambios de cédula del historial.
        cedulas = {f["cedula"] for f in d["collaborator"]}
        cedulas |= {f["cedula"] for f in d["depuratedovertime"]}
        for ev in d["novedadevent"]:
            if ev["field"] == "cedula":
                cedulas |= {ev["old_value"], ev["new_value"]}
        mascara = Enmascarador(cedulas)

        # Colaboradores
        enlace = self._enlazar_empleados(d["collaborator"])
        pares = []
        for f in d["collaborator"]:
            empleado = enlace[f["id"]]
            pares.append(
                (
                    f["id"],
                    Collaborator(
                        empresa=e,
                        cedula=f["cedula"],
                        full_name=f["full_name"],
                        codigo_empleado=empleado.codigo_empleado if empleado else "",
                        empleado=empleado,
                        regional=f["regional"],
                        area=f["area"],
                        cargo=f["cargo"],
                        status=f["status"],
                        current_supervisor_id=u(f["current_supervisor_id"]),
                        created_by_id=u(f["created_by_id"]),
                        worked_days_removed_at=f["worked_days_removed_at"],
                        worked_days_removed_by_id=u(f["worked_days_removed_by_id"]),
                        worked_days_removed_reason=f["worked_days_removed_reason"],
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
            )
        self._insertar("collaborator", pares, ("cedula",))

        def col(id_nexo, contexto):
            return self._id("collaborator", id_nexo, contexto=contexto)

        self._insertar(
            "collaboratorassignment",
            [
                (
                    f["id"],
                    CollaboratorAssignment(
                        collaborator_id=col(f["collaborator_id"], "collaboratorassignment"),
                        supervisor_id=u(f["supervisor_id"]),
                        started_at=f["started_at"],
                        ended_at=f["ended_at"],
                        assigned_by_id=u(f["assigned_by_id"]),
                        reason=f["reason"],
                    ),
                )
                for f in d["collaboratorassignment"]
            ],
        )
        self._insertar(
            "collaboratorstatuschange",
            [
                (
                    f["id"],
                    CollaboratorStatusChange(
                        collaborator_id=col(f["collaborator_id"], "collaboratorstatuschange"),
                        previous_status=f["previous_status"],
                        new_status=f["new_status"],
                        changed_by_id=u(f["changed_by_id"]),
                        reason=f["reason"],
                        created_at=f["created_at"],
                    ),
                )
                for f in d["collaboratorstatuschange"]
            ],
            ("collaborator_id", "created_at", "previous_status", "new_status"),
        )

        # Períodos y cierres (Nexo no guarda created_at/updated_at en estos).
        self._insertar(
            "operationalperiod",
            [
                (
                    f["id"],
                    OperationalPeriod(
                        empresa=e,
                        year=f["year"],
                        month=f["month"],
                        start_date=f["start_date"],
                        end_date=f["end_date"],
                        created_at=ahora,
                        updated_at=ahora,
                    ),
                )
                for f in d["operationalperiod"]
            ],
            ("year", "month"),
        )

        def per(id_nexo, contexto, requerido=True):
            return self._id("operationalperiod", id_nexo, requerido=requerido, contexto=contexto)

        self._insertar(
            "supervisorperiod",
            [
                (
                    f["id"],
                    SupervisorPeriod(
                        period_id=per(f["period_id"], "supervisorperiod"),
                        supervisor_id=u(f["supervisor_id"]),
                        status=f["status"],
                        opened_at=f["opened_at"],
                        closed_at=f["closed_at"],
                        closed_by_id=u(f["closed_by_id"]),
                        summary=f["summary"] if f["summary"] is not None else {},
                    ),
                )
                for f in d["supervisorperiod"]
            ],
            ("period_id", "supervisor_id"),
        )
        self._insertar(
            "overtimemonthclose",
            [
                (
                    f["id"],
                    OvertimeMonthClose(
                        empresa=e,
                        supervisor_id=u(f["supervisor_id"]),
                        year=f["year"],
                        month=f["month"],
                        closed_at=f["closed_at"],
                        closed_by_id=u(f["closed_by_id"]),
                        summary=f["summary"] if f["summary"] is not None else {},
                        created_at=f["closed_at"],
                        updated_at=f["closed_at"],
                    ),
                )
                for f in d["overtimemonthclose"]
            ],
            ("supervisor_id", "year", "month"),
        )

        # Novedades
        self._insertar(
            "workedday",
            [
                (
                    f["id"],
                    WorkedDay(
                        collaborator_id=col(f["collaborator_id"], "workedday"),
                        period_id=per(f["period_id"], "workedday"),
                        supervisor_id=u(f["supervisor_id"]),
                        date=f["date"],
                        hours=f["hours"],
                        version=f["version"],
                        updated_by_id=u(f["updated_by_id"]),
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in d["workedday"]
            ],
            ("collaborator_id", "date"),
        )
        self._insertar(
            "overtimerecord",
            [
                (
                    f["id"],
                    OvertimeRecord(
                        collaborator_id=col(f["collaborator_id"], "overtimerecord"),
                        period_id=per(f["period_id"], "overtimerecord"),
                        supervisor_id=u(f["supervisor_id"]),
                        date=f["date"],
                        overtime_hours=f["overtime_hours"],
                        saturday_hours=f["saturday_hours"],
                        is_saturday=f["is_saturday"],
                        is_sunday=f["is_sunday"],
                        is_holiday=f["is_holiday"],
                        work_done=f["work_done"],
                        observations=f["observations"],
                        version=f["version"],
                        created_by_id=u(f["created_by_id"]),
                        updated_by_id=u(f["updated_by_id"]),
                        deleted_at=f["deleted_at"],
                        deleted_by_id=u(f["deleted_by_id"]),
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in d["overtimerecord"]
            ],
            ("collaborator_id", "date", "deleted_at"),
        )

        pares = []
        for f in d["closedperiodcorrection"]:
            tabla_objetivo = OBJETIVOS_DE_CORRECCION.get(f["target"])
            if tabla_objetivo is None:
                self.informe.problemas.append(
                    f"closedperiodcorrection #{f['id']}: objetivo desconocido «{f['target']}»."
                )
                continue
            objetivo = self._id(
                tabla_objetivo, f["target_id"], contexto=f"closedperiodcorrection #{f['id']}"
            )
            pares.append(
                (
                    f["id"],
                    ClosedPeriodCorrection(
                        target=f["target"],
                        target_id=objetivo or 0,
                        period_id=per(f["period_id"], "closedperiodcorrection"),
                        supervisor_id=u(f["supervisor_id"]),
                        original_values=mascara.json(f["original_values"] or {}),
                        new_values=mascara.json(f["new_values"] or {}),
                        reason=mascara.texto(f["reason"]),
                        corrected_by_id=u(f["corrected_by_id"]),
                        created_at=f["created_at"],
                    ),
                )
            )
        self._insertar("closedperiodcorrection", pares)

        self._insertar(
            "permissionoverride",
            [
                (
                    f["id"],
                    PermissionOverride(
                        empresa=e,
                        user_id=u(f["user_id"]),
                        codename=f["codename"],
                        effect=f["effect"],
                        reason=f["reason"],
                        created_by_id=u(f["created_by_id"]),
                        revoked_at=f["revoked_at"],
                        revoked_by_id=u(f["revoked_by_id"]),
                        revoke_reason=f["revoke_reason"],
                        created_at=f["created_at"],
                        updated_at=f["revoked_at"] or f["created_at"],
                    ),
                )
                for f in d["permissionoverride"]
            ],
        )

        # Horas depuradas
        self._insertar(
            "overtimedepuration",
            [
                (
                    f["id"],
                    OvertimeDepuration(
                        empresa=e,
                        year=f["year"],
                        month=f["month"],
                        created_by_id=u(f["created_by_id"]),
                        source_count=f["source_count"],
                        source_overtime_hours=f["source_overtime_hours"],
                        source_saturday_hours=f["source_saturday_hours"],
                        supervisors_total=f["supervisors_total"],
                        supervisors_closed=f["supervisors_closed"],
                        created_at=f["created_at"],
                        updated_at=f["created_at"],
                    ),
                )
                for f in d["overtimedepuration"]
            ],
            ("year", "month"),
        )
        copiados = (
            "date cedula full_name regional area cargo supervisor_name orig_overtime_hours "
            "orig_saturday_hours orig_is_saturday orig_is_sunday orig_is_holiday orig_work_done "
            "orig_observations overtime_hours saturday_hours is_saturday is_sunday is_holiday "
            "work_done observations excluded version updated_at"
        ).split()
        pares = []
        for f in d["depuratedovertime"]:
            contexto = f"depuratedovertime #{f['id']}"
            pares.append(
                (
                    f["id"],
                    DepuratedOvertime(
                        depuration_id=self._id(
                            "overtimedepuration", f["depuration_id"], contexto=contexto
                        ),
                        source_record_id=self._id(
                            "overtimerecord", f["source_record_id"], contexto=contexto
                        ),
                        source_id=self._id("overtimerecord", f["source_id"], contexto=contexto)
                        or 0,
                        collaborator_id=col(f["collaborator_id"], contexto),
                        supervisor_id=u(f["supervisor_id"]),
                        updated_by_id=u(f["updated_by_id"]),
                        **{c: f[c] for c in copiados},
                    ),
                )
            )
        self._insertar("depuratedovertime", pares, ("depuration_id", "source_id"))
        self._insertar(
            "depurationchange",
            [
                (
                    f["id"],
                    DepurationChange(
                        depuration_id=self._id(
                            "overtimedepuration", f["depuration_id"], contexto="depurationchange"
                        ),
                        row_id=self._id(
                            "depuratedovertime", f["row_id"], contexto="depurationchange"
                        ),
                        field=f["field"],
                        original_value=f["original_value"],
                        old_value=f["old_value"],
                        new_value=f["new_value"],
                        reason=f["reason"],
                        actor_id=u(f["actor_id"]),
                        created_at=f["created_at"],
                    ),
                )
                for f in d["depurationchange"]
            ],
        )

        # Correos de ingreso y salida
        self._insertar(
            "collaboratornotificationrecipient",
            [
                (
                    f["id"],
                    CollaboratorNotificationRecipient(
                        empresa=e,
                        kind=f["kind"],
                        email=f["email"],
                        area=f["area"],
                        is_active=f["is_active"],
                        created_by_id=u(f["created_by_id"]),
                        updated_by_id=u(f["updated_by_id"]),
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in d["collaboratornotificationrecipient"]
            ],
            ("kind", "email"),
        )
        comunes = (
            "snapshot status recipients attempts last_attempt_at last_error sent_at created_at"
        ).split()
        self._insertar(
            "collaboratorexitnotification",
            [
                (
                    f["id"],
                    CollaboratorExitNotification(
                        status_change_id=self._id(
                            "collaboratorstatuschange",
                            f["status_change_id"],
                            contexto="collaboratorexitnotification",
                        ),
                        collaborator_id=col(f["collaborator_id"], "collaboratorexitnotification"),
                        supervisor_id=u(f["supervisor_id"]),
                        changed_by_id=u(f["changed_by_id"]),
                        changed_at=f["changed_at"],
                        previous_status=f["previous_status"],
                        new_status=f["new_status"],
                        period_id=per(f["period_id"], "collaboratorexitnotification"),
                        **{c: f[c] for c in comunes},
                    ),
                )
                for f in d["collaboratorexitnotification"]
            ],
        )
        self._insertar(
            "collaboratorentrynotification",
            [
                (
                    f["id"],
                    CollaboratorEntryNotification(
                        collaborator_id=col(f["collaborator_id"], "collaboratorentrynotification"),
                        created_by_id=u(f["created_by_id"]),
                        first_day=f["first_day"],
                        second_day=f["second_day"],
                        triggered_at=f["triggered_at"],
                        supervisor_id=u(f["supervisor_id"]),
                        period_id=per(f["period_id"], "collaboratorentrynotification"),
                        **{c: f[c] for c in comunes},
                    ),
                )
                for f in d["collaboratorentrynotification"]
            ],
        )

        # Historial del módulo
        self._insertar(
            "novedadevent",
            [
                (
                    f["id"],
                    NovedadEvent(
                        empresa=e,
                        action=f["action"],
                        actor_id=self.usuarios.get(f["actor_id"]),
                        actor_role=f["actor_role"],
                        supervisor_id=self.usuarios.get(f["supervisor_id"]),
                        period_id=per(f["period_id"], "novedadevent", requerido=False),
                        target_type=f["target_type"],
                        target_id=self._objetivo_de_evento(f),
                        target_label=mascara.texto(f["target_label"]),
                        field=f["field"],
                        old_value=self._valor_de_evento(f, "old_value", mascara),
                        new_value=self._valor_de_evento(f, "new_value", mascara),
                        reason=mascara.texto(f["reason"]),
                        source_file=f["source_file"],
                        created_at=f["created_at"],
                        updated_at=f["created_at"],
                    ),
                )
                for f in d["novedadevent"]
            ],
        )

        # Ajustes con vigencia
        pares = []
        for f in d["systemconfighistory"]:
            if len(str(f["value"])) > SettingHistory._meta.get_field("value").max_length:
                self.informe.problemas.append(
                    f"systemconfighistory #{f['id']}: valor de «{f['key']}» demasiado largo."
                )
                continue
            pares.append(
                (
                    f["id"],
                    SettingHistory(
                        empresa=e,
                        key=f["key"],
                        value=str(f["value"]),
                        valid_from=f["valid_from"],
                        valid_until=f["valid_until"],
                        updated_by_id=u(f["updated_by_id"]),
                        created_at=f["created_at"],
                        updated_at=f["created_at"],
                    ),
                )
            )
        self._insertar("systemconfighistory", pares)

    def _objetivo_de_evento(self, evento: dict) -> str:
        """`target_id` remapeado si apunta a un registro migrado; si apunta a
        uno que no se migró, queda como `nexo:<id>` para no confundirlo con un
        id de la intranet. Claves de texto (ajustes, roles, períodos) quedan."""
        original = str(evento["target_id"] or "")
        tabla = TIPOS_CON_ID.get(evento["target_type"])
        if tabla is None or not original.isdigit():
            return original
        if tabla == "usuario":
            nuevo = self.usuarios.get(int(original))
        else:
            nuevo = self.mapas[tabla].get(int(original))
        if nuevo is None:
            self.informe.avisos.append(
                f"Evento #{evento['id']}: {evento['target_type']} #{original} sin equivalente; "
                f"queda como «nexo:{original}»."
            )
            return f"nexo:{original}"
        return str(nuevo)

    @staticmethod
    def _valor_de_evento(evento: dict, campo: str, mascara: Enmascarador) -> str:
        valor = evento[campo] or ""
        if evento["field"] == "cedula" and valor:
            return mask_cedula(valor)
        return mascara.texto(valor)

    def _asignar_roles(self):
        grupos = {
            g.name: g for g in Group.objects.filter(name__in={r["rol"] for r in self.roles_nexo})
        }
        for fila in self.roles_nexo:
            nexo = self.usuarios_nexo.get(fila["user_id"]) or {}
            correo = str(nexo.get("email") or "").strip().lower() or f"(usuario #{fila['user_id']})"
            resultado = {"correo": correo, "rol": fila["rol"]}
            uid = self.usuarios.get(fila["user_id"])
            grupo = grupos.get(fila["rol"])
            membresia = (
                MembresiaEmpresa.objects.filter(usuario_id=uid, empresa=self.empresa).first()
                if uid
                else None
            )
            if uid is None:
                resultado["resultado"] = "sin cuenta en la intranet"
            elif grupo is None:
                resultado["resultado"] = "el rol no existe en la intranet"
            elif membresia is None:
                resultado["resultado"] = "sin membresía en la empresa (no se creó)"
            elif membresia.roles.filter(pk=grupo.pk).exists():
                resultado["resultado"] = "ya lo tenía"
            else:
                membresia.roles.add(grupo)
                resultado["resultado"] = "asignado"
            self.informe.roles.append(resultado)

    # 4. Verificación -----------------------------------------------------------

    def _verificar(self):
        v = self.informe.verificacion

        def anotar(concepto, nexo, intranet):
            v.append(
                {"concepto": concepto, "nexo": nexo, "intranet": intranet, "ok": nexo == intranet}
            )

        for tabla, modelo in MODELOS.items():
            leidos = self.informe.leidos[tabla]
            anotar(f"{tabla}: filas en Nexo / leídas", self.conteos_nexo.get(tabla), leidos)
            anotar(
                f"{tabla}: leídas / en la intranet", leidos, _ambito(modelo, self.empresa).count()
            )

        def por_mes(qs, anio, mes, **sumas):
            return {
                (f[anio], f[mes]): {k: f[k] for k in ["registros", *sumas]}
                for f in qs.values(anio, mes).annotate(**sumas).order_by()
            }

        dias = por_mes(
            _ambito(WorkedDay, self.empresa),
            "period__year",
            "period__month",
            registros=Count("hours"),
            horas=Sum("hours"),
        )
        extras = por_mes(
            _ambito(OvertimeRecord, self.empresa).filter(deleted_at__isnull=True),
            "period__year",
            "period__month",
            registros=Count("id"),
            horas_extra=Sum("overtime_hours"),
            horas_sabado=Sum("saturday_hours"),
        )
        depuradas = por_mes(
            _ambito(DepuratedOvertime, self.empresa).filter(excluded=False),
            "depuration__year",
            "depuration__month",
            registros=Count("id"),
            horas_extra=Sum("overtime_hours"),
            horas_sabado=Sum("saturday_hours"),
        )
        for nombre, intranet, etiqueta in (
            ("dias", dias, "Días laborados"),
            ("extras", extras, "Horas extras activas"),
            ("depuradas", depuradas, "Horas depuradas"),
        ):
            nexo = self.totales_nexo.get(nombre, {})
            for anio, mes in sorted(set(nexo) | set(intranet)):
                a, b = nexo.get((anio, mes), {}), intranet.get((anio, mes), {})
                for medida in sorted(set(a) | set(b)):
                    anotar(
                        f"{etiqueta} {mes:02d}/{anio}: {medida}",
                        _normal(a.get(medida)),
                        _normal(b.get(medida)),
                    )

    # Orquestación ---------------------------------------------------------------

    def ejecutar(self) -> Informe:
        self._leer()
        with usando_empresa(self.empresa):
            self._comprobar_destino_vacio()
            self._cruzar_usuarios()
            with transaction.atomic(), fechas_tal_cual(dict.fromkeys(MODELOS.values())):
                if self.periodos_vacios:
                    OperationalPeriod.objects.todas().filter(pk__in=self.periodos_vacios).delete()
                self._crear()
                if self.asignar_roles:
                    self._asignar_roles()
                self._verificar()
                if self.aplicar and self.informe.cuadra:
                    self.informe.confirmado = True
                else:
                    transaction.set_rollback(True)
        return self.informe


def _normal(valor):
    """Sumas comparables: `None` y 0 son lo mismo; los decimales, a 2 cifras."""
    if valor is None:
        return Decimal("0.00")
    if isinstance(valor, int):
        return Decimal(valor)
    if isinstance(valor, Decimal):
        return valor.quantize(Decimal("0.01"))
    return valor
