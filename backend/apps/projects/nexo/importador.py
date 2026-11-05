"""Importación única de la fase 2b de Gestión Humana desde Nexo: Proyectos (con
su papelera), Ausencias y lo que persiste el motor de KPI.

Mismo recorrido que Novedades y Tareas (`apps.novedades.nexo`,
`apps.tasks.nexo`):

1. Lee de Nexo las filas, los conteos y las sumas de control, antes de abrir
   ninguna transacción.
2. Comprueba, sin escribir, que la empresa no tenga datos de estos módulos y
   que cada usuario de Nexo que hace falta exista en la intranet (por correo).
   Si no, aborta con la lista de lo que falta. No crea cuentas.
3. Prepara los documentos (también fuera de la transacción): pide a Nexo el
   base64 de cada uno, lo decodifica, comprueba el tamaño y lo valida como lo
   hace la subida de la intranet. Lo aceptado queda en una carpeta temporal
   del sistema (fuera del repositorio) hasta guardarlo; lo rechazado se lista.
4. Dentro de UNA transacción crea todo, conservando las fechas de Nexo y
   remapeando los ids (también los sueltos: la papelera, las versiones de los
   documentos y los ids dentro del JSON del historial); luego verifica.
5. En simulacro, o si la verificación no cuadra, deshace la transacción y
   borra los archivos que alcanzó a escribir.

Decisiones propias de esta fase (salen en el informe):

- **Documentos rechazados.** Un documento de un tipo que Proyectos ya no
  admite (imagen, .eml, .msg…), cuyo contenido no corresponde a su extensión,
  que pesa más del máximo o cuyo base64 no es válido NO se importa y NO se
  copia a ningún lado: queda en el informe (proyecto, nombre, tamaño, quién y
  cuándo lo subió, motivo y SHA-256) para que Talento Humano decida, y el
  original sigue en Nexo. Es lo más seguro: guardarlo aparte sería poner
  archivos que nadie validó en una carpeta sin el control de acceso de la
  intranet. Si el historial o una versión posterior lo nombra, la referencia
  queda como «nexo:<id>».
- **Permisos médicos vencidos.** Los `LeaveRecord` MÉDICOS anteriores al corte
  de retención (cinco años, `apps.ausencias.services.medical_retention_cutoff`)
  ni se leen: solo se cuentan (cuántos y entre qué fechas, sin personas).
- **Descuento.** Los permisos de Nexo se registraron a mano, no vienen de una
  solicitud: `solicitud` y `descuento` quedan en nulo, que es lo que el modelo
  define para un registro manual. Poner «vacaciones» a las VACACIONES de Nexo
  las haría pasar por descontadas del saldo de la intranet, que nunca las
  descontó; el tipo VACACIONES ya dice lo que fueron.
- **Datos de salud (LOPDP).** Ni el informe ni los avisos llevan el tipo ni la
  observación de una ausencia; un `AnalyticsAuditLog` que llevara un tipo de
  ausencia médica o de estado especial hace fallar la verificación.
- **Roles.** ADMINISTRADOR pasa a «Administrador de Gestión Humana» en el rol
  que guarda la auditoría del Benchmark, en las claves de objetivo y
  compatibilidad por rol y en las listas de roles compatibles.
- **Auditoría del KPI.** `AnalyticsAuditLog` es la memoria del motor (tendencias,
  benchmark, alertas resueltas): se trae. La intranet escribe ahí sola al
  abrir el KPI, así que lo que ya tenga la empresa no cuenta como «datos»; se
  verifica lo creado.
- **Fecha de inicio del KPI.** Si la persona no tiene cuenta en la intranet, se
  omite y se lista (no aborta: sin cuenta no hay a quién medir).
- **Ausencias desde solicitudes.** Las que ya generó la Solicitud de permisos
  de la intranet (`solicitud` no nula) no cuentan como «datos»: son de la
  intranet. Si coinciden en persona y día con una de Nexo, se cuenta en un
  aviso.
"""

import hashlib
import json
import tempfile
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date
from decimal import Decimal
from pathlib import Path, PurePath

from django.core.files import File
from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from django.utils.functional import cached_property
from rest_framework import serializers as drf_serializers

from apps.adjuntos.validators import validar_archivo
from apps.analytics.configuracion import (
    _role_compatibility_config_key,
    _role_target_config_key,
)
from apps.analytics.models import AnalyticsAuditLog, KpiStartDate
from apps.ausencias.models import LeaveRecord, SpecialStatus
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
from apps.tasks.nexo.importador import ROL_ADMINISTRADOR_NEXO, renombrar_rol
from apps.tasks.roles import ADMIN_GH, ALL_ROLES

from ..models import (
    Project,
    ProjectActivity,
    ProjectComment,
    ProjectDocument,
    ProjectHistory,
    ProjectParticipant,
    ProjectPhase,
    RecoveryItem,
)
from ..services import DOCUMENT_FORMATS, ProyectosError, _check_ooxml, load_base64_file
from .lector import (
    CLAVES_EXACTAS,
    CLAVES_EXCLUIDAS,
    ENTIDAD_PROYECTO,
    PREFIJOS_DE_CLAVE,
    TABLAS,
    TIPO_MEDICO,
    LectorNexoGH,
    es_clave_de_gh,
)

#: Tabla lógica de Nexo → modelo de la intranet donde termina.
MODELOS = {
    "project": Project,
    "projectphase": ProjectPhase,
    "projectparticipant": ProjectParticipant,
    "projectactivity": ProjectActivity,
    "projectcomment": ProjectComment,
    "projectdocument": ProjectDocument,
    "projecthistory": ProjectHistory,
    "recoveryitem": RecoveryItem,
    "leaverecord": LeaveRecord,
    "specialstatus": SpecialStatus,
    "analyticsauditlog": AnalyticsAuditLog,
    "kpistartdate": KpiStartDate,
    "systemconfighistory": SettingHistory,
}

#: Lo que NO se migra, con su razón (sale en el informe).
NO_SE_MIGRA = {
    "LeaveRecord MÉDICO de más de 5 años": (
        "regla de retención (LOPDP): no se leen; el informe solo los cuenta"
    ),
    "ProjectDocument de un tipo no admitido": (
        "Proyectos solo admite pdf, doc, docx, xls, xlsx, ppt y pptx; se listan en el "
        "informe y el original queda en Nexo"
    ),
    "RecoveryAuditLog": (
        "la auditoría de la papelera es la común de la intranet; el rastro queda en el "
        "historial del proyecto (ELIMINADO/RESTAURADO) y en la propia papelera"
    ),
    "RecoveryItem de otros módulos": "el Escritorio Digital de Nexo no se porta",
    "analytics_engine_version_seen": "marcador interno del panel de diagnóstico, no un ajuste",
}

#: Tipos de ausencia y de estado especial: datos de salud.
TIPOS_DE_SALUD = frozenset({TIPO_MEDICO, *SpecialStatus.Type.values})

#: Claves dentro del JSON del historial que son ids de Nexo.
_REFERENCIAS_DEL_HISTORIAL = {
    "responsible_id": "usuario",
    "user_id": "usuario",
    "phase_id": "projectphase",
    "document_id": "projectdocument",
}

#: Claves de ajustes cuyo valor es JSON (se guardan compactos).
_PREFIJOS_JSON = ("analytics_curve_", "analytics_role_target_", "analytics_role_compatibility_")
_PREFIJO_OBJETIVO = "analytics_role_target_"
_PREFIJO_COMPATIBILIDAD = "analytics_role_compatibility_"

#: Mime declarado → extensión, solo para nombres de Nexo sin extensión. La
#: firma del contenido se valida igual.
_EXTENSION_POR_MIME = {mime: ext for ext, (mime, _) in DOCUMENT_FORMATS.items()}


def renombrar_clave(clave: str) -> str:
    """Las claves por rol se forman con el nombre del rol en minúsculas: la del
    ADMINISTRADOR de Nexo pasa a la del Administrador de Gestión Humana."""
    sufijo = ROL_ADMINISTRADOR_NEXO.lower()
    if clave == _PREFIJO_OBJETIVO + sufijo:
        return _role_target_config_key(ADMIN_GH)
    if clave == _PREFIJO_COMPATIBILIDAD + sufijo:
        return _role_compatibility_config_key(ADMIN_GH)
    return clave


def tamano_de_base64(texto: str) -> int:
    """Bytes que da un base64 (sin el prefijo de URL de datos ni espacios)."""
    datos = texto.split(",", 1)[1] if texto.startswith("data:") and "," in texto else texto
    datos = "".join(datos.split())
    relleno = len(datos) - len(datos.rstrip("="))
    return len(datos) * 3 // 4 - relleno


def _filtro_de_claves() -> Q:
    filtro = Q(key__in=CLAVES_EXACTAS)
    for prefijo in PREFIJOS_DE_CLAVE:
        filtro |= Q(key__startswith=prefijo)
    return filtro & ~Q(key__in=CLAVES_EXCLUIDAS)


def _lleva_datos_de_salud(valor) -> bool:
    if isinstance(valor, str):
        return valor in TIPOS_DE_SALUD
    if isinstance(valor, dict):
        return any(_lleva_datos_de_salud(v) for v in valor.values())
    if isinstance(valor, list):
        return any(_lleva_datos_de_salud(v) for v in valor)
    return False


@dataclass
class InformeGH(InformeBase):
    #: Por tabla, cuántos valores ADMINISTRADOR se renombraron.
    roles_renombrados: dict[str, int] = field(default_factory=dict)
    #: Documentos que no se importan, con su motivo (ver el docstring).
    documentos_rechazados: list[dict] = field(default_factory=list)
    #: Permisos médicos anteriores al corte: solo el agregado.
    corte_medico: date | None = None
    medicos_vencidos: dict = field(default_factory=dict)
    #: Personas con fecha de inicio del KPI en Nexo y sin cuenta en la intranet.
    kpi_omitidos: list[str] = field(default_factory=list)


class ImportadorNexoGH(ImportadorBase):
    modelos = MODELOS
    tablas = TABLAS
    informe_class = InformeGH

    def __init__(self, lector: LectorNexoGH, empresa, *, aplicar: bool = False):
        super().__init__(lector, empresa, aplicar=aplicar)
        #: tabla → filas que deben quedar en la intranet (si no, las leídas).
        self.esperados: dict[str, int] = {}
        #: Documentos aceptados, ya en la carpeta temporal: id de Nexo → datos.
        self.preparados: dict[int, dict] = {}
        #: Archivos escritos en el almacenamiento (se borran si no se confirma).
        self.archivos_escritos: list[str] = []
        #: Caracteres de base64 leídos de todos los documentos.
        self.caracteres_leidos = 0
        self.auditoria_previa = 0
        self.carpeta: Path | None = None

    # 1. Lectura ---------------------------------------------------------------

    def _leer(self):
        self.datos = {tabla: self.lector.filas(tabla) for tabla in TABLAS}
        self.informe.leidos = {tabla: len(filas) for tabla, filas in self.datos.items()}
        self.conteos_nexo = self.lector.conteos()
        self.totales_nexo = self.lector.totales()
        self.corte = self.lector.corte_medico
        self.informe.corte_medico = self.corte
        self.informe.medicos_vencidos = dict(self.totales_nexo.get("medicos_vencidos") or {})

        self.usuarios_necesarios = self._usuarios_de_las_filas()
        # Los del JSON del historial y los de la fecha de inicio del KPI: si
        # no se encuentran, no abortan.
        opcionales = {f["id"] for f in self.datos["kpistartdate"]}
        for fila in self.datos["projecthistory"]:
            for valor in (fila["previous_value"], fila["new_value"]):
                if not isinstance(valor, dict):
                    continue
                for campo, destino in _REFERENCIAS_DEL_HISTORIAL.items():
                    if destino == "usuario" and _es_id(valor.get(campo)):
                        opcionales.add(valor[campo])
        self.usuarios_nexo = {
            u["id"]: u for u in self.lector.usuarios(self.usuarios_necesarios | opcionales)
        }

    # 2. Comprobaciones previas -------------------------------------------------

    def _comprobar_destino_vacio(self):
        con_datos = []
        for tabla, modelo in MODELOS.items():
            if tabla in ("analyticsauditlog", "systemconfighistory"):
                continue
            if self._destino(tabla).exists():
                con_datos.append(modelo.__name__)
        claves = sorted(
            set(
                ambito(SettingHistory, self.empresa)
                .filter(_filtro_de_claves())
                .values_list("key", flat=True)
            )
        )
        if claves:
            con_datos.append(f"SettingHistory ({', '.join(claves)})")
        if con_datos:
            raise ImportacionAbortada(
                f"La empresa «{self.empresa}» ya tiene datos de Proyectos, Ausencias o KPI; la "
                "importación solo se hace sobre una empresa sin datos de esos módulos (no "
                "mezcla ni reemplaza). No cuentan la auditoría de cálculos del KPI ni las "
                "ausencias generadas por la Solicitud de permisos.",
                [f"Con datos: {nombre}" for nombre in con_datos],
                codigo="destino_con_datos",
            )

    # 3. Documentos (fuera de la transacción) ------------------------------------

    def _rechazar(self, fila: dict, nombre: str, motivo: str, contenido: bytes | None = None):
        proyectos = self._nombres_de_proyecto
        subio = self.usuarios_nexo.get(fila["uploaded_by_id"]) or {}
        self.informe.documentos_rechazados.append(
            {
                "id_nexo": fila["id"],
                "proyecto": proyectos.get(fila["project_id"], f"#{fila['project_id']}"),
                "archivo": nombre,
                "extension": PurePath(nombre).suffix.lower() or "(sin extensión)",
                "mime": fila["mime_type"] or "",
                "bytes": len(contenido) if contenido is not None else 0,
                "subido_por": subio.get("email") or "",
                "fecha": fila["created_at"].isoformat() if fila["created_at"] else "",
                "motivo": motivo,
                "sha256": hashlib.sha256(contenido).hexdigest() if contenido else "",
            }
        )

    def _nombre_del_documento(self, fila: dict) -> str:
        nombre = PurePath((fila["file_name"] or "").strip()).name or f"documento-{fila['id']}"
        if not PurePath(nombre).suffix:
            extension = _EXTENSION_POR_MIME.get((fila["mime_type"] or "").lower())
            if extension:
                self.informe.avisos.append(
                    f"projectdocument #{fila['id']}: el nombre no tenía extensión; se toma "
                    f"{extension} de su tipo ({fila['mime_type']})."
                )
                return nombre + extension
        return nombre

    @cached_property
    def _nombres_de_proyecto(self) -> dict[int, str]:
        return {p["id"]: p["name"] for p in self.datos["project"]}

    def _preparar_documentos(self):
        """Pide el base64 de cada documento, lo decodifica y lo valida como la
        subida de la intranet (`DocumentService.upload_document`: extensión de
        `DOCUMENT_FORMATS`, firma del contenido y, en un OOXML, su índice)."""
        formatos = {ext: firmas for ext, (_, firmas) in DOCUMENT_FORMATS.items()}
        for fila in self.datos["projectdocument"]:
            nombre = self._nombre_del_documento(fila)
            contenido = self.lector.documento(fila["id"])
            if contenido is None:
                self.informe.problemas.append(
                    f"projectdocument #{fila['id']}: desapareció de Nexo mientras se leía."
                )
                continue
            texto = contenido["file_data"] or ""
            self.caracteres_leidos += len(texto)
            if len(texto) != contenido["caracteres"]:
                self.informe.problemas.append(
                    f"projectdocument #{fila['id']}: se leyeron {len(texto)} caracteres de "
                    f"base64 y Nexo tiene {contenido['caracteres']} (lectura truncada)."
                )
                continue
            if not texto.strip():
                self._rechazar(fila, nombre, "Sin contenido en Nexo.")
                continue
            try:
                archivo = load_base64_file(nombre, "".join(texto.split()))
            except ProyectosError as exc:
                self._rechazar(fila, nombre, exc.message)
                continue
            datos = archivo.read()
            archivo.seek(0)
            esperado = tamano_de_base64(texto)
            if len(datos) != esperado:
                self.informe.problemas.append(
                    f"projectdocument #{fila['id']}: el base64 anuncia {esperado} bytes y "
                    f"decodificado da {len(datos)}."
                )
                continue
            try:
                extension = validar_archivo(archivo, formatos=formatos)
                _check_ooxml(archivo, extension)
            except drf_serializers.ValidationError as exc:
                detalle = exc.detail[0] if isinstance(exc.detail, list) else exc.detail
                self._rechazar(fila, nombre, str(detalle), datos)
                continue
            except ProyectosError as exc:
                self._rechazar(fila, nombre, exc.message, datos)
                continue
            ruta = self.carpeta / str(fila["id"])
            ruta.write_bytes(datos)
            self.preparados[fila["id"]] = {
                "ruta": ruta,
                "nombre": nombre,
                "bytes": len(datos),
                "mime": DOCUMENT_FORMATS[extension][0],
            }
        self.esperados["projectdocument"] = len(self.preparados)

    # 4. Escritura ---------------------------------------------------------------

    def _rol(self, tabla: str, rol):
        nuevo = renombrar_rol(rol)
        if nuevo != rol:
            self.informe.roles_renombrados[tabla] = self.informe.roles_renombrados.get(tabla, 0) + 1
        return nuevo

    def _remapear_json(self, valor, contexto: str):
        """Ids de Nexo dentro del JSON del historial. Sin equivalente (una fase
        borrada, un documento rechazado) quedan como «nexo:<id>»."""
        if not isinstance(valor, dict):
            return valor
        nuevo = dict(valor)
        for campo, destino in _REFERENCIAS_DEL_HISTORIAL.items():
            original = valor.get(campo)
            if not _es_id(original):
                continue
            mapa = self.usuarios if destino == "usuario" else self.mapas[destino]
            if original in mapa:
                nuevo[campo] = mapa[original]
            else:
                nuevo[campo] = f"nexo:{original}"
                self.informe.avisos.append(
                    f"{contexto}: {campo} {original} sin equivalente; queda como «nexo:{original}»."
                )
        return nuevo

    def _crear(self):
        e = self.empresa
        u = self._u
        d = self.datos

        self._insertar(
            "project",
            [
                (
                    f["id"],
                    Project(
                        empresa=e,
                        name=f["name"],
                        description=f["description"] or "",
                        status=f["status"],
                        priority=f["priority"],
                        area=f["area"] or "",
                        tags=f["tags"] if f["tags"] is not None else [],
                        observations=f["observations"] or "",
                        start_date=f["start_date"],
                        target_date=f["target_date"],
                        target_time_hours=f["target_time_hours"],
                        real_hours=f["real_hours"],
                        completed_at=f["completed_at"],
                        responsible_id=u(f["responsible_id"]),
                        created_by_id=u(f["created_by_id"]),
                        deleted_at=f["deleted_at"],
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in d["project"]
            ],
            ("created_by_id", "responsible_id", "created_at", "name"),
        )

        def proyecto(id_nexo, contexto):
            return self._id("project", id_nexo, contexto=contexto)

        self._insertar(
            "projectphase",
            [
                (
                    f["id"],
                    ProjectPhase(
                        project_id=proyecto(f["project_id"], f"projectphase #{f['id']}"),
                        name=f["name"],
                        status=f["status"],
                        responsible_id=u(f["responsible_id"]),
                        start_date=f["start_date"],
                        target_date=f["target_date"],
                        progress=f["progress"],
                        notes=f["notes"] or "",
                        target_time_hours=f["target_time_hours"],
                        order=f["order"],
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in d["projectphase"]
            ],
            ("project_id", "order", "created_at", "name"),
        )
        self._insertar(
            "projectparticipant",
            [
                (
                    f["id"],
                    ProjectParticipant(
                        project_id=proyecto(f["project_id"], f"projectparticipant #{f['id']}"),
                        user_id=u(f["user_id"]),
                        added_by_id=u(f["added_by_id"]),
                        added_at=f["added_at"],
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in d["projectparticipant"]
            ],
        )
        self._insertar(
            "projectactivity",
            [
                (
                    f["id"],
                    ProjectActivity(
                        project_id=proyecto(f["project_id"], f"projectactivity #{f['id']}"),
                        phase_id=self._id(
                            "projectphase", f["phase_id"], contexto=f"projectactivity #{f['id']}"
                        ),
                        author_id=u(f["author_id"]),
                        description=f["description"],
                        comments=f["comments"],
                        start_time=f["start_time"],
                        end_time=f["end_time"],
                        duration=f["duration"],
                        is_retroactive=f["is_retroactive"],
                        activity_date=f["activity_date"],
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in d["projectactivity"]
            ],
            ("project_id", "author_id", "created_at", "duration"),
        )
        self._insertar(
            "projectcomment",
            [
                (
                    f["id"],
                    ProjectComment(
                        project_id=proyecto(f["project_id"], f"projectcomment #{f['id']}"),
                        author_id=u(f["author_id"]),
                        text=f["text"],
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in d["projectcomment"]
            ],
        )
        self._crear_documentos()
        self._insertar(
            "projecthistory",
            [
                (
                    f["id"],
                    ProjectHistory(
                        project_id=proyecto(f["project_id"], f"projecthistory #{f['id']}"),
                        actor_id=u(f["actor_id"]),
                        event=f["event"],
                        description=f["description"],
                        previous_value=self._remapear_json(
                            f["previous_value"], f"projecthistory #{f['id']}"
                        ),
                        new_value=self._remapear_json(f["new_value"], f"projecthistory #{f['id']}"),
                        created_at=f["created_at"],
                    ),
                )
                for f in d["projecthistory"]
            ],
        )
        self._crear_papelera()
        self._crear_ausencias()
        self._crear_kpi()
        self._crear_ajustes()

    def _crear_documentos(self):
        """Uno por uno: cada archivo se guarda en el almacenamiento de la
        intranet con la ruta de `ProjectDocument.file` y se comprueba que el
        tamaño guardado sea el decodificado. Sin pasar por
        `DocumentService.upload_document`, que validaría lo mismo (ya validado
        al preparar) pero añadiría un evento DOCUMENTO_AGREGADO al historial
        (ya viene de Nexo), una auditoría «subido ahora» y la fecha de hoy."""
        creados = 0
        for f in self.datos["projectdocument"]:
            preparado = self.preparados.get(f["id"])
            if preparado is None:
                continue
            contexto = f"projectdocument #{f['id']}"
            anterior = f["previous_version_id"]
            anterior_nuevo = None
            if anterior is not None:
                anterior_nuevo = self.mapas["projectdocument"].get(anterior)
                if anterior_nuevo is None:
                    self.informe.avisos.append(
                        f"{contexto}: su versión anterior (#{anterior}) no se importó; queda "
                        "sin versión anterior (conserva su número de versión)."
                    )
            documento = ProjectDocument(
                project_id=self._id("project", f["project_id"], contexto=contexto),
                activity_id=self._id("projectactivity", f["activity_id"], contexto=contexto),
                category=f["category"],
                file_name=preparado["nombre"][:255],
                mime_type=preparado["mime"],
                file_size=preparado["bytes"],
                version=f["version"],
                previous_version_id=anterior_nuevo,
                uploaded_by_id=self._u(f["uploaded_by_id"]),
                created_at=f["created_at"],
                updated_at=f["updated_at"],
            )
            if documento.project_id is None:
                continue
            with preparado["ruta"].open("rb") as origen:
                documento.file.save(preparado["nombre"], File(origen), save=False)
            self.archivos_escritos.append(documento.file.name)
            documento.save(force_insert=True)
            self.mapas["projectdocument"][f["id"]] = documento.pk
            creados += 1
            guardado = documento.file.storage.size(documento.file.name)
            if guardado != preparado["bytes"]:
                self.informe.problemas.append(
                    f"{contexto}: se guardaron {guardado} bytes y el decodificado tiene "
                    f"{preparado['bytes']}."
                )
        self.informe.creados["projectdocument"] = creados

    def _crear_papelera(self):
        """`entity_id` es texto suelto: el id nuevo del proyecto. Si el
        proyecto ya no existe en Nexo (purgado), queda «nexo:<id>»; un ítem
        ACTIVO sin proyecto es una inconsistencia de Nexo y no se importa
        (la purga de la intranet intentaría borrarlo)."""
        ahora = timezone.now()
        vencidos = 0
        pares = []
        for f in self.datos["recoveryitem"]:
            contexto = f"recoveryitem #{f['id']}"
            original = str(f["entity_id"])
            nuevo = self.mapas["project"].get(int(original)) if original.isdigit() else None
            if nuevo is not None:
                entidad = str(nuevo)
            elif f["status"] == RecoveryItem.Status.ACTIVE:
                self.informe.problemas.append(
                    f"{contexto}: está en la papelera pero el proyecto #{original} no existe en "
                    "Nexo."
                )
                continue
            else:
                entidad = f"nexo:{original}"
            if f["status"] == RecoveryItem.Status.ACTIVE and f["expires_at"] <= ahora:
                vencidos += 1
            pares.append(
                (
                    f["id"],
                    RecoveryItem(
                        empresa=self.empresa,
                        entity_type=ENTIDAD_PROYECTO,
                        entity_id=entidad,
                        entity_label=f["entity_label"],
                        module_label=f["module_label"],
                        status=f["status"],
                        deleted_by_id=self._u(f["deleted_by_id"]),
                        deleted_at=f["deleted_at"],
                        retention_hours=f["retention_hours"],
                        expires_at=f["expires_at"],
                        restored_by_id=self._u(f["restored_by_id"]),
                        restored_at=f["restored_at"],
                        purged_by_id=self._u(f["purged_by_id"]),
                        purged_at=f["purged_at"],
                        purge_origin=f["purge_origin"],
                        created_at=f["created_at"],
                        updated_at=f["created_at"],
                    ),
                )
            )
        if vencidos:
            self.informe.avisos.append(
                f"recoveryitem: {vencidos} proyectos en la papelera ya vencieron su plazo; la "
                "intranet los eliminará definitivamente la primera vez que se abra la papelera "
                "(como habría hecho Nexo)."
            )
        self._insertar("recoveryitem", pares)

    def _crear_ausencias(self):
        e = self.empresa
        u = self._u
        excluidos = 0
        pares = []
        for f in self.datos["leaverecord"]:
            # Defensa: el lector ya los excluye en la consulta.
            if f["type"] == TIPO_MEDICO and f["date"] < self.corte:
                excluidos += 1
                continue
            pares.append(
                (
                    f["id"],
                    LeaveRecord(
                        empresa=e,
                        user_id=u(f["user_id"]),
                        type=f["type"],
                        date=f["date"],
                        is_full_day=f["is_full_day"],
                        duration_minutes=f["duration_minutes"],
                        observation=f["observation"],
                        created_by_id=u(f["created_by_id"]),
                        solicitud=None,
                        descuento=None,
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
            )
        if excluidos:
            vencidos = self.informe.medicos_vencidos
            vencidos["registros"] = vencidos.get("registros", 0) + excluidos
            self.informe.avisos.append(
                f"leaverecord: el lector entregó {excluidos} permisos médicos anteriores al "
                "corte; no se importaron."
            )
        self.esperados["leaverecord"] = len(pares)

        desde_solicitudes = set(
            ambito(LeaveRecord, e).filter(solicitud__isnull=False).values_list("user_id", "date")
        )
        coinciden = sum(1 for _, r in pares if (r.user_id, r.date) in desde_solicitudes)
        if coinciden:
            self.informe.avisos.append(
                f"leaverecord: {coinciden} ausencias de Nexo coinciden en persona y día con "
                "ausencias que ya generó la Solicitud de permisos; quedan las dos."
            )
        self._insertar("leaverecord", pares)

        self._insertar(
            "specialstatus",
            [
                (
                    f["id"],
                    SpecialStatus(
                        empresa=e,
                        user_id=u(f["user_id"]),
                        type=f["type"],
                        start_date=f["start_date"],
                        end_date=f["end_date"],
                        is_active=f["is_active"],
                        daily_hours=f["daily_hours"],
                        limit_low=f["limit_low"],
                        limit_base=f["limit_base"],
                        limit_high=f["limit_high"],
                        limit_overload=f["limit_overload"],
                        created_by_id=u(f["created_by_id"]),
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in self.datos["specialstatus"]
            ],
        )

    def _crear_kpi(self):
        e = self.empresa
        self.auditoria_previa = ambito(AnalyticsAuditLog, e).count()
        pares = []
        for f in self.datos["analyticsauditlog"]:
            entradas = f["inputs"] if f["inputs"] is not None else {}
            if isinstance(entradas, dict) and "role" in entradas:
                entradas = {**entradas, "role": self._rol("analyticsauditlog", entradas["role"])}
            resultado = f["result"] if f["result"] is not None else {}
            if _lleva_datos_de_salud(entradas) or _lleva_datos_de_salud(resultado):
                self.informe.problemas.append(
                    f"analyticsauditlog #{f['id']}: lleva un tipo de ausencia o de estado "
                    "especial (dato de salud); revíselo en Nexo antes de importar."
                )
                continue
            pares.append(
                (
                    f["id"],
                    AnalyticsAuditLog(
                        empresa=e,
                        user_id=self._u(f["user_id"]),
                        kind=f["kind"],
                        period=f["period"],
                        inputs=entradas,
                        result=resultado,
                        engine_version=f["engine_version"],
                        created_at=f["created_at"],
                        updated_at=f["created_at"],
                    ),
                )
            )
        self._insertar("analyticsauditlog", pares)

        # Nexo no guarda cuándo se fijó la fecha de inicio: queda la de hoy.
        ahora = timezone.now()
        pares = []
        for f in self.datos["kpistartdate"]:
            usuario = self.usuarios.get(f["id"])
            if usuario is None:
                correo = (f.get("email") or "").strip().lower() or f"(usuario «{f['username']}»)"
                self.informe.kpi_omitidos.append(correo)
                self.informe.avisos.append(
                    f"kpistartdate: {correo} tiene fecha de inicio del KPI en Nexo y no tiene "
                    "cuenta en la intranet; se omite."
                )
                continue
            pares.append(
                (
                    f["id"],
                    KpiStartDate(
                        empresa=e,
                        user_id=usuario,
                        kpi_start_date=f["kpi_start_date"],
                        updated_by=None,
                        created_at=ahora,
                        updated_at=ahora,
                    ),
                )
            )
        self.esperados["kpistartdate"] = len(pares)
        self._insertar("kpistartdate", pares)

    def _valor_de_ajuste(self, clave: str, valor: str, contexto: str) -> str:
        """Los JSON (curvas y ajustes por rol) se guardan compactos —mismo
        contenido, menos caracteres— y con el rol renombrado en las listas de
        roles compatibles. Un JSON inválido queda tal cual: la intranet, como
        Nexo, usa entonces el valor por defecto."""
        if not clave.startswith(_PREFIJOS_JSON):
            return valor
        try:
            dato = json.loads(valor)
        except (TypeError, ValueError):
            self.informe.avisos.append(
                f"{contexto}: «{clave}» no es JSON válido; queda tal cual (rige el valor por "
                "defecto, como en Nexo)."
            )
            return valor
        if clave.startswith(_PREFIJO_COMPATIBILIDAD) and isinstance(dato, list):
            dato = list(dict.fromkeys(self._rol("systemconfighistory", r) for r in dato))
            desconocidos = [r for r in dato if isinstance(r, str) and r not in ALL_ROLES]
            if desconocidos:
                self.informe.avisos.append(
                    f"{contexto}: roles que la intranet no conoce: {', '.join(desconocidos)}."
                )
        return json.dumps(dato, ensure_ascii=False, separators=(",", ":"))

    def _crear_ajustes(self):
        largo = SettingHistory._meta.get_field("value").max_length
        roles_conocidos = {r.lower() for r in ALL_ROLES}
        pares = []
        for f in self.datos["systemconfighistory"]:
            contexto = f"systemconfighistory #{f['id']}"
            if not es_clave_de_gh(f["key"]):
                self.informe.problemas.append(f"{contexto}: clave inesperada «{f['key']}».")
                continue
            clave = renombrar_clave(f["key"])
            if clave != f["key"]:
                self.informe.roles_renombrados["systemconfighistory"] = (
                    self.informe.roles_renombrados.get("systemconfighistory", 0) + 1
                )
            for prefijo in (_PREFIJO_OBJETIVO, _PREFIJO_COMPATIBILIDAD):
                if clave.startswith(prefijo) and clave[len(prefijo) :] not in roles_conocidos:
                    self.informe.avisos.append(
                        f"{contexto}: «{clave}» es de un rol que la intranet no conoce."
                    )
            valor = self._valor_de_ajuste(clave, str(f["value"]), contexto)
            if len(valor) > largo:
                self.informe.problemas.append(
                    f"{contexto}: valor de «{clave}» demasiado largo ({len(valor)} > {largo})."
                )
                continue
            if len(clave) > SettingHistory._meta.get_field("key").max_length:
                self.informe.problemas.append(f"{contexto}: clave «{clave}» demasiado larga.")
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
        self._insertar("systemconfighistory", pares)

    # 5. Verificación -------------------------------------------------------------

    def _destino(self, tabla: str):
        """Lo de la empresa que corresponde a la tabla de Nexo."""
        qs = ambito(MODELOS[tabla], self.empresa)
        if tabla == "leaverecord":
            return qs.filter(solicitud__isnull=True)
        if tabla == "systemconfighistory":
            return qs.filter(_filtro_de_claves())
        return qs

    def _verificar(self):
        anotar = self.informe.anotar
        for tabla in MODELOS:
            leidos = self.informe.leidos[tabla]
            anotar(f"{tabla}: filas en Nexo / leídas", self.conteos_nexo.get(tabla), leidos)
            en_intranet = self._destino(tabla).count()
            if tabla == "analyticsauditlog":
                en_intranet -= self.auditoria_previa
            anotar(
                f"{tabla}: esperadas / en la intranet",
                self.esperados.get(tabla, leidos),
                en_intranet,
            )

        e = self.empresa
        # Proyectos: cuántos y sus horas.
        proyectos = ambito(Project, e).aggregate(
            registros=Count("id"),
            horas_objetivo=Sum("target_time_hours"),
            horas_reales=Sum("real_hours"),
        )
        self._comparar(
            "Proyectos",
            {"todos": self.totales_nexo.get("proyectos", {})},
            {"todos": proyectos},
            lambda _: "",
        )

        # Horas registradas en proyectos por mes (UTC), calculado aquí y no con
        # ExtractMonth para no depender de la zona horaria de la conexión.
        actividades: dict[tuple, dict] = defaultdict(lambda: {"registros": 0, "minutos": 0})
        for fecha, creado, minutos in (
            ambito(ProjectActivity, e)
            .values_list("activity_date", "created_at", "duration")
            .iterator(chunk_size=2000)
        ):
            momento = (fecha or creado).astimezone(UTC)
            c = actividades[(momento.year, momento.month)]
            c["registros"] += 1
            c["minutos"] += minutos
        self._comparar(
            "Horas de proyectos",
            self.totales_nexo.get("actividades", {}),
            actividades,
            _mes,
        )

        # Ausencias por mes de su día.
        ausencias: dict[tuple, dict] = defaultdict(
            lambda: {"registros": 0, "minutos": 0, "dias_completos": 0}
        )
        for dia, completo, minutos in (
            self._destino("leaverecord")
            .values_list("date", "is_full_day", "duration_minutes")
            .iterator(chunk_size=2000)
        ):
            c = ausencias[(dia.year, dia.month)]
            c["registros"] += 1
            c["minutos"] += minutos or 0
            c["dias_completos"] += 1 if completo else 0
        self._comparar("Ausencias", self.totales_nexo.get("ausencias", {}), ausencias, _mes)

        # Retención: ningún permiso médico anterior al corte entre los importados.
        anotar(
            "Ausencias médicas anteriores al corte en la intranet",
            0,
            self._destino("leaverecord").filter(type=TIPO_MEDICO, date__lt=self.corte).count(),
        )

        # Documentos: todo el base64 leído, y lo aceptado guardado entero.
        documentos = self.totales_nexo.get("documentos", {})
        anotar(
            "Documentos: caracteres de base64 en Nexo / leídos",
            documentos.get("caracteres", 0),
            self.caracteres_leidos,
        )
        anotar(
            "Documentos: en Nexo / importados + rechazados",
            documentos.get("registros", 0),
            self.informe.creados.get("projectdocument", 0)
            + len(self.informe.documentos_rechazados),
        )
        anotar(
            "Documentos: bytes decodificados / guardados",
            sum(p["bytes"] for p in self.preparados.values()),
            ambito(ProjectDocument, e).aggregate(total=Sum("file_size"))["total"] or 0,
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
                titulo = f"{etiqueta} {nombre(clave)}".rstrip()
                self.informe.anotar(f"{titulo}: {medida}", va, vb)
        if len(set(nexo) | set(intranet)) > 1:
            for medida in sorted(set(totales_nexo) | set(totales_intranet)):
                self.informe.anotar(
                    f"{etiqueta} (total): {medida}",
                    normal(totales_nexo[medida]),
                    normal(totales_intranet[medida]),
                )

    # Orquestación ---------------------------------------------------------------

    def _borrar_archivos_escritos(self):
        for nombre in self.archivos_escritos:
            try:
                default_storage.delete(nombre)
            except OSError:
                self.informe.avisos.append(
                    f"No se pudo borrar el archivo temporal {nombre} del almacenamiento."
                )
        self.archivos_escritos = []

    def ejecutar(self) -> InformeGH:
        self._leer()
        with tempfile.TemporaryDirectory(prefix="nexo_gh_") as carpeta:
            self.carpeta = Path(carpeta)
            try:
                with usando_empresa(self.empresa):
                    self._comprobar_destino_vacio()
                    self._cruzar_usuarios()
                    self._preparar_documentos()
                    confirmar = False
                    with transaction.atomic(), fechas_tal_cual(dict.fromkeys(MODELOS.values())):
                        self._crear()
                        self._verificar()
                        confirmar = self.aplicar and self.informe.cuadra
                        if not confirmar:
                            transaction.set_rollback(True)
                    # Solo aquí: el bloque terminó sin error y se confirmó.
                    self.informe.confirmado = confirmar
            finally:
                if not self.informe.confirmado:
                    self._borrar_archivos_escritos()
        return self.informe


def _es_id(valor) -> bool:
    return isinstance(valor, int) and not isinstance(valor, bool)


def _mes(clave) -> str:
    return f"{clave[1]:02d}/{clave[0]}"
