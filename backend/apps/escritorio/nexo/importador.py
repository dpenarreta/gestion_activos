"""Importación única del Escritorio Digital de Nexo: las notas con sus
respuestas, los recordatorios y la bitácora, con los adjuntos convertidos en
archivos.

Mismo recorrido que las demás importaciones de Gestión Humana
(`apps.mejora_continua.nexo` es la más parecida):

1. Lee de Nexo las filas y los conteos antes de abrir ninguna transacción.
2. Comprueba, sin escribir, que la empresa no tenga nada del Escritorio y que
   cada usuario de Nexo que hace falta exista en la intranet (por correo). Si
   no, aborta con la lista de lo que falta. No crea cuentas.
3. Prepara los adjuntos (también fuera de la transacción): pide a Nexo el
   base64 de cada nota y recordatorio que tiene uno, lo decodifica, comprueba
   el tamaño y lo valida como la subida de la intranet. Lo aceptado queda en
   una carpeta temporal del sistema (fuera del repositorio) hasta guardarlo.
4. Dentro de UNA transacción crea todo, conservando las fechas de Nexo (y
   `notified`: un recordatorio vencido ya avisado en Nexo no vuelve a avisar),
   y verifica. En simulacro, o si la verificación no cuadra, lo deshace y borra
   los archivos que alcanzó a escribir.

Decisiones propias de esta importación (salen en el informe):

- **Notas en la papelera** (`deleted_at` en Nexo): no se importan, ni sus
  respuestas ni su bitácora. Nadie las veía en Nexo y la intranet las borraría
  igual a las 48 horas.
- **Bitácora huérfana**: las entradas de notas o recordatorios que ya no
  existen en Nexo (borrados) no se importan: la intranet muestra la bitácora
  desde su nota o su recordatorio, y no habría desde dónde verlas. Los ids que
  lleva la bitácora en `metadata` (`reminderId`, `convertedFromNoteId`,
  `nextOccurrenceOf`, `taskId`) se traducen a los de la intranet; si no hay a
  qué, quedan en `null`.
- **Recordatorios convertidos en tarea**: la tarea se busca entre las que ya
  importó `importar_nexo_tareas` (misma empresa, responsable, creador, fecha de
  creación y título). Si no está, el recordatorio sigue marcado como
  convertido (`converted_to_task_at`) pero sin el enlace a la tarea, con aviso.
- **Adjuntos rechazados** (base64 inválido, contenido que no corresponde a su
  extensión o más pesado que el máximo): la nota o el recordatorio entra sin
  adjunto y el rechazo queda en el informe (con su SHA-256); el original sigue
  en Nexo.
- **Destino.** Solo una empresa sin nada del Escritorio: no hay clave natural
  con la que no duplicar al repetir.
- **`--excluir-usuario`.** Se quitan las notas que mandó o recibió (con sus
  respuestas), sus recordatorios y lo que hizo en la bitácora.
"""

import hashlib
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path, PurePath

from django.core.files import File
from django.core.files.storage import default_storage
from django.db import transaction

from apps.empresas.contexto import usando_empresa
from apps.mejora_continua.nexo.importador import tamano_de_base64
from apps.novedades.nexo.comun import (
    ImportacionAbortada,
    ImportadorBase,
    InformeBase,
    ambito,
    fechas_tal_cual,
)

from ..models import DeskAuditLog, DeskNote, DeskNoteReply, PersonalReminder
from ..services import EscritorioError, archivo_desde_base64, validar_adjunto
from .lector import TABLAS, LectorNexoEscritorio

MODELOS = {
    "reminder": PersonalReminder,
    "note": DeskNote,
    "reply": DeskNoteReply,
    "log": DeskAuditLog,
}

NO_SE_MIGRA = {
    "DeskNote (en la papelera)": "nadie las veía en Nexo y la intranet las borraría a las 48 h",
    "DeskAuditLog (huérfana)": "entradas de notas o recordatorios que ya no existen en Nexo",
}

#: Ids que lleva la bitácora en `metadata` → tabla de la intranet a la que se
#: traducen.
IDS_DE_METADATA = {
    "reminderId": "reminder",
    "convertedFromNoteId": "note",
    "nextOccurrenceOf": "reminder",
    "taskId": "task",
}

ENTIDAD = {"NOTE": "note", "REMINDER": "reminder"}


def _diferencias(nexo: Counter, intranet: Counter) -> int:
    return sum(((nexo - intranet) + (intranet - nexo)).values())


@dataclass
class InformeEscritorio(InformeBase):
    usuarios_excluidos: list[str] = field(default_factory=list)
    excluidas_por_usuario: dict[str, int] = field(default_factory=dict)
    #: Lo que no se importa por decisión (papelera, bitácora huérfana).
    omitidas: dict[str, int] = field(default_factory=dict)
    #: Adjuntos que no se importaron (la fila sí), con el motivo.
    adjuntos_rechazados: list[dict] = field(default_factory=list)


class ImportadorNexoEscritorio(ImportadorBase):
    modelos = MODELOS
    tablas = TABLAS
    informe_class = InformeEscritorio

    def __init__(
        self, lector: LectorNexoEscritorio, empresa, *, aplicar: bool = False, excluir_usuarios=()
    ):
        super().__init__(lector, empresa, aplicar=aplicar)
        self.excluir = sorted({c.strip().lower() for c in excluir_usuarios if c.strip()})
        self.informe.usuarios_excluidos = list(self.excluir)
        self.esperados: dict[str, int] = {}
        #: (tabla, id en Nexo) → adjunto preparado.
        self.preparados: dict[tuple[str, int], dict] = {}
        self.archivos_escritos: list[str] = []
        #: id de la tarea en Nexo → id en la intranet.
        self.tareas: dict[int, int] = {}
        self.tareas_nexo: list[dict] = []

    # 1. Lectura ---------------------------------------------------------------

    def _leer(self):
        self.datos = {tabla: self.lector.filas(tabla) for tabla in TABLAS}
        self.informe.leidos = {tabla: len(filas) for tabla, filas in self.datos.items()}
        self.conteos_nexo = self.lector.conteos()
        self._omitir_papelera()
        self.usuarios_necesarios = self._usuarios_de_las_filas()
        self.usuarios_nexo = {u["id"]: u for u in self.lector.usuarios(self.usuarios_necesarios)}
        if self.excluir:
            self._excluir_usuarios()
        self._omitir_bitacora_huerfana()
        self.usuarios_necesarios = self._usuarios_de_las_filas()
        self._leer_tareas()

    def _quitar(self, tabla: str, conservar) -> int:
        antes = len(self.datos[tabla])
        self.datos[tabla] = [f for f in self.datos[tabla] if conservar(f)]
        quitadas = antes - len(self.datos[tabla])
        if quitadas:
            self.esperados[tabla] = len(self.datos[tabla])
        return quitadas

    def _omitir_papelera(self):
        en_papelera = {f["id"] for f in self.datos["note"] if f.get("deleted_at")}
        if not en_papelera:
            return
        self.informe.omitidas["note (papelera)"] = self._quitar(
            "note", lambda f: f["id"] not in en_papelera
        )
        respuestas = self._quitar("reply", lambda f: f["note_id"] not in en_papelera)
        if respuestas:
            self.informe.omitidas["reply (de notas en la papelera)"] = respuestas

    def _omitir_bitacora_huerfana(self):
        vivas = {
            "NOTE": {f["id"] for f in self.datos["note"]},
            "REMINDER": {f["id"] for f in self.datos["reminder"]},
        }
        huerfanas = self._quitar(
            "log", lambda f: f["entity_id"] in vivas.get(f["entity_type"], set())
        )
        if huerfanas:
            self.informe.omitidas["log (huérfana o de lo excluido)"] = huerfanas
            self.informe.avisos.append(
                f"{huerfanas} entradas de la bitácora no se importan: son de notas o "
                "recordatorios que ya no existen en Nexo (o que no se importan)."
            )

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
        quitadas: dict[str, int] = {}
        notas_fuera = {
            f["id"]
            for f in self.datos["note"]
            if f["sender_id"] in excluidos or f["recipient_id"] in excluidos
        }
        for tabla, conservar in (
            ("reminder", lambda f: f["user_id"] not in excluidos),
            ("note", lambda f: f["id"] not in notas_fuera),
            (
                "reply",
                lambda f: f["note_id"] not in notas_fuera and f["author_id"] not in excluidos,
            ),
            ("log", lambda f: f["user_id"] not in excluidos),
        ):
            n = self._quitar(tabla, conservar)
            if n:
                quitadas[tabla] = n
        self.informe.excluidas_por_usuario = quitadas

    def _leer_tareas(self):
        """Las tareas de Nexo que salieron de un recordatorio, y las cuentas de
        su responsable y su creador (para encontrarlas en la intranet)."""
        ids = {f["converted_to_task_id"] for f in self.datos["reminder"]}
        ids.discard(None)
        if not ids:
            return
        self.tareas_nexo = self.lector.tareas(ids)
        personas = {t["assigned_to_id"] for t in self.tareas_nexo} | {
            t["created_by_id"] for t in self.tareas_nexo
        }
        faltan = personas - set(self.usuarios_nexo)
        if faltan:
            self.usuarios_nexo.update({u["id"]: u for u in self.lector.usuarios(faltan)})

    # 2. Comprobaciones previas -------------------------------------------------

    def _comprobar_destino_vacio(self):
        con_datos = [
            modelo.__name__ for modelo in MODELOS.values() if ambito(modelo, self.empresa).exists()
        ]
        if con_datos:
            raise ImportacionAbortada(
                f"La empresa «{self.empresa}» ya tiene datos del Escritorio; la importación solo "
                "se hace sobre una empresa sin ellos (no mezcla ni reemplaza).",
                [f"Con datos: {nombre}" for nombre in con_datos],
                codigo="destino_con_datos",
            )

    def _cruzar_tareas(self):
        from apps.tasks.models import Task

        for t in self.tareas_nexo:
            responsable = self.usuarios.get(t["assigned_to_id"])
            creador = self.usuarios.get(t["created_by_id"])
            if responsable is None or creador is None:
                continue
            encontradas = list(
                ambito(Task, self.empresa)
                .filter(
                    assigned_to_id=responsable,
                    created_by_id=creador,
                    created_at=t["created_at"],
                    title=t["title"],
                )
                .values_list("pk", flat=True)[:2]
            )
            if len(encontradas) == 1:
                self.tareas[t["id"]] = encontradas[0]
        sin_tarea = [
            f["id"]
            for f in self.datos["reminder"]
            if f["converted_to_task_id"] is not None
            and f["converted_to_task_id"] not in self.tareas
        ]
        if sin_tarea:
            self.informe.avisos.append(
                f"{len(sin_tarea)} recordatorios convertidos en tarea no encuentran su tarea en "
                "la intranet (¿se importaron las tareas?): quedan marcados como convertidos, sin "
                f"el enlace. Recordatorios de Nexo: {', '.join(f'#{i}' for i in sin_tarea[:20])}"
                + ("…" if len(sin_tarea) > 20 else "")
            )

    # 3. Adjuntos (fuera de la transacción) ----------------------------------------

    def _rechazar(self, tabla, fila, nombre, motivo, contenido=None):
        self.informe.adjuntos_rechazados.append(
            {
                "tabla": tabla,
                "id_nexo": fila["id"],
                "archivo": nombre,
                "bytes": len(contenido) if contenido is not None else 0,
                "motivo": motivo,
                "sha256": hashlib.sha256(contenido).hexdigest() if contenido else "",
            }
        )

    def _preparar_adjuntos(self):
        """Solo las filas que tienen un adjunto (Nexo guardaba nombre y tipo
        junto con el base64): pide el base64, lo decodifica y lo valida."""
        for tabla in ("note", "reminder"):
            for fila in self.datos[tabla]:
                if not (fila.get("attachment_name") or fila.get("attachment_mime")):
                    continue
                contenido = self.lector.adjunto(tabla, fila["id"])
                if contenido is None:
                    self.informe.problemas.append(
                        f"{tabla} #{fila['id']}: desapareció de Nexo mientras se leía."
                    )
                    continue
                texto = contenido["attachment_data"] or ""
                if len(texto) != contenido["caracteres"]:
                    self.informe.problemas.append(
                        f"{tabla} #{fila['id']}: se leyeron {len(texto)} caracteres de base64 "
                        f"del adjunto y Nexo tiene {contenido['caracteres']} (lectura truncada)."
                    )
                    continue
                if not texto.strip():
                    continue
                nombre = (
                    PurePath((fila["attachment_name"] or "").strip()).name
                    or f"adjunto-{fila['id']}"
                )
                try:
                    archivo = archivo_desde_base64(nombre, texto)
                except EscritorioError as exc:
                    self._rechazar(tabla, fila, nombre, exc.message)
                    continue
                datos = archivo.read()
                archivo.seek(0)
                esperado = tamano_de_base64(texto)
                if len(datos) != esperado:
                    self.informe.problemas.append(
                        f"{tabla} #{fila['id']}: el base64 anuncia {esperado} bytes y "
                        f"decodificado da {len(datos)}."
                    )
                    continue
                try:
                    mime = validar_adjunto(archivo)
                except EscritorioError as exc:
                    self._rechazar(tabla, fila, nombre, exc.message, datos)
                    continue
                ruta = self.carpeta / f"{tabla}-{fila['id']}"
                ruta.write_bytes(datos)
                self.preparados[(tabla, fila["id"])] = {
                    "ruta": ruta,
                    "nombre": nombre,
                    "mime": mime,
                    "bytes": len(datos),
                }
        if self.informe.adjuntos_rechazados:
            self.informe.avisos.append(
                f"{len(self.informe.adjuntos_rechazados)} adjuntos no se importaron (la nota o el "
                "recordatorio sí, sin adjunto); el detalle va en el informe y el original sigue "
                "en Nexo."
            )

    # 4. Escritura ---------------------------------------------------------------

    def _poner_adjunto(self, objeto, tabla: str, id_nexo: int):
        preparado = self.preparados.get((tabla, id_nexo))
        if preparado is None:
            return None
        objeto.attachment_name = preparado["nombre"][:255]
        objeto.attachment_mime = preparado["mime"]
        objeto.attachment_size = preparado["bytes"]
        with preparado["ruta"].open("rb") as origen:
            objeto.attachment.save(preparado["nombre"], File(origen), save=False)
        self.archivos_escritos.append(objeto.attachment.name)
        return preparado

    def _comprobar_guardado(self, objeto, tabla, id_nexo, preparado):
        if preparado is None:
            return
        guardado = objeto.attachment.storage.size(objeto.attachment.name)
        if guardado != preparado["bytes"]:
            self.informe.problemas.append(
                f"{tabla} #{id_nexo}: se guardaron {guardado} bytes del adjunto y el "
                f"decodificado tiene {preparado['bytes']}."
            )

    def _crear_recordatorios(self):
        u = self._u
        for f in self.datos["reminder"]:
            r = PersonalReminder(
                empresa=self.empresa,
                user_id=u(f["user_id"]),
                title=(f["title"] or "")[:150],
                description=f["description"],
                due_at=f["due_at"],
                priority=f["priority"],
                status=f["status"],
                repeat=f["repeat"],
                completed_at=f["completed_at"],
                archived=bool(f["archived"]),
                archived_at=f["archived_at"],
                notified=bool(f["notified"]),
                converted_to_task_id=self.tareas.get(f["converted_to_task_id"]),
                converted_to_task_at=f["converted_to_task_at"],
                created_at=f["created_at"],
                updated_at=f["updated_at"],
            )
            preparado = self._poner_adjunto(r, "reminder", f["id"])
            # Uno por uno: el backend de SQL Server no devuelve los ids de un
            # `bulk_create`, y las notas y la bitácora los necesitan.
            r.save(force_insert=True)
            self.mapas["reminder"][f["id"]] = r.pk
            self._comprobar_guardado(r, "reminder", f["id"], preparado)
        self.informe.creados["reminder"] = len(self.datos["reminder"])

    def _crear_notas(self):
        u = self._u
        for f in self.datos["note"]:
            n = DeskNote(
                empresa=self.empresa,
                sender_id=u(f["sender_id"]),
                recipient_id=u(f["recipient_id"]),
                message=(f["message"] or "")[:500],
                priority=f["priority"],
                color=f["color"],
                read=bool(f["read"]),
                read_at=f["read_at"],
                pinned=bool(f["pinned"]),
                archived=bool(f["archived"]),
                archived_at=f["archived_at"],
                converted_to_reminder_id=self._id(
                    "reminder",
                    f["converted_to_reminder_id"],
                    contexto=f"note #{f['id']}",
                ),
                converted_at=f["converted_at"],
                created_at=f["created_at"],
                updated_at=f["updated_at"],
            )
            preparado = self._poner_adjunto(n, "note", f["id"])
            n.save(force_insert=True)
            self.mapas["note"][f["id"]] = n.pk
            self._comprobar_guardado(n, "note", f["id"], preparado)
        self.informe.creados["note"] = len(self.datos["note"])

    def _metadata(self, metadata):
        """Los ids de Nexo que lleva la bitácora, traducidos (o `None`)."""
        if not isinstance(metadata, dict):
            return metadata
        traducida = dict(metadata)
        for clave, tabla in IDS_DE_METADATA.items():
            if clave not in traducida or traducida[clave] is None:
                continue
            try:
                id_nexo = int(traducida[clave])
            except (TypeError, ValueError):
                traducida[clave] = None
                continue
            origen = self.tareas if tabla == "task" else self.mapas[tabla]
            traducida[clave] = origen.get(id_nexo)
        return traducida

    def _crear(self):
        self._crear_recordatorios()
        self._crear_notas()
        u = self._u
        self._insertar(
            "reply",
            [
                (
                    f["id"],
                    DeskNoteReply(
                        note_id=self._id("note", f["note_id"], contexto=f"reply #{f['id']}"),
                        author_id=u(f["author_id"]),
                        message=(f["message"] or "")[:500],
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in self.datos["reply"]
            ],
        )
        self._insertar(
            "log",
            [
                (
                    f["id"],
                    DeskAuditLog(
                        empresa=self.empresa,
                        entity_type=f["entity_type"],
                        entity_id=self._id(
                            ENTIDAD[f["entity_type"]], f["entity_id"], contexto=f"log #{f['id']}"
                        ),
                        user_id=u(f["user_id"]),
                        action=f["action"],
                        metadata=self._metadata(f["metadata"]),
                        created_at=f["created_at"],
                        updated_at=f["created_at"],
                    ),
                )
                for f in self.datos["log"]
            ],
        )

    # 5. Verificación -------------------------------------------------------------

    def _verificar(self):
        anotar = self.informe.anotar
        e = self.empresa
        notas = list(ambito(DeskNote, e))
        respuestas = list(ambito(DeskNoteReply, e))
        recordatorios = list(ambito(PersonalReminder, e))
        bitacora = list(ambito(DeskAuditLog, e))
        destino = {"reminder": recordatorios, "note": notas, "reply": respuestas, "log": bitacora}
        for tabla in MODELOS:
            leidos = self.informe.leidos[tabla]
            anotar(f"{tabla}: filas en Nexo / leídas", self.conteos_nexo.get(tabla), leidos)
            anotar(
                f"{tabla}: esperadas / en la intranet",
                self.esperados.get(tabla, leidos),
                len(destino[tabla]),
            )
        us = self.usuarios
        d = self.datos
        for concepto, nexo, intranet in (
            ("Notas leídas", sum(bool(f["read"]) for f in d["note"]), sum(n.read for n in notas)),
            (
                "Notas fijadas",
                sum(bool(f["pinned"]) for f in d["note"]),
                sum(n.pinned for n in notas),
            ),
            (
                "Notas archivadas",
                sum(bool(f["archived"]) for f in d["note"]),
                sum(n.archived for n in notas),
            ),
            (
                "Notas convertidas en recordatorio",
                sum(1 for f in d["note"] if f["converted_to_reminder_id"]),
                sum(1 for n in notas if n.converted_to_reminder_id),
            ),
            (
                "Recordatorios ya avisados",
                sum(bool(f["notified"]) for f in d["reminder"]),
                sum(r.notified for r in recordatorios),
            ),
            (
                "Recordatorios convertidos en tarea (con fecha)",
                sum(1 for f in d["reminder"] if f["converted_to_task_at"]),
                sum(1 for r in recordatorios if r.converted_to_task_at),
            ),
        ):
            anotar(concepto, nexo, intranet)
        anotar(
            "Notas distintas de las de Nexo (remitente, destinatario, fecha, mensaje)",
            0,
            _diferencias(
                Counter(
                    (us.get(f["sender_id"]), us.get(f["recipient_id"]), f["created_at"])
                    + ((f["message"] or "")[:500],)
                    for f in d["note"]
                ),
                Counter((n.sender_id, n.recipient_id, n.created_at, n.message) for n in notas),
            ),
        )
        nota_de = self.mapas["note"]
        anotar(
            "Respuestas distintas de las de Nexo (nota, autor, mensaje)",
            0,
            _diferencias(
                Counter(
                    (nota_de.get(f["note_id"]), us.get(f["author_id"]), (f["message"] or "")[:500])
                    for f in d["reply"]
                ),
                Counter((r.note_id, r.author_id, r.message) for r in respuestas),
            ),
        )
        anotar(
            "Recordatorios distintos de los de Nexo (dueño, vence, estado, repetición)",
            0,
            _diferencias(
                Counter(
                    (us.get(f["user_id"]), f["due_at"], f["status"], f["repeat"])
                    for f in d["reminder"]
                ),
                Counter((r.user_id, r.due_at, r.status, r.repeat) for r in recordatorios),
            ),
        )
        anotar(
            "Bitácora distinta de la de Nexo (entidad, quién, acción)",
            0,
            _diferencias(
                Counter(
                    (
                        f["entity_type"],
                        self.mapas[ENTIDAD[f["entity_type"]]].get(f["entity_id"]),
                        us.get(f["user_id"]),
                        f["action"],
                    )
                    for f in d["log"]
                ),
                Counter((b.entity_type, b.entity_id, b.user_id, b.action) for b in bitacora),
            ),
        )
        con_adjunto = [x for x in (*notas, *recordatorios) if x.attachment]
        anotar("Adjuntos aceptados / guardados", len(self.preparados), len(con_adjunto))
        anotar(
            "Adjuntos: bytes aceptados / guardados",
            sum(p["bytes"] for p in self.preparados.values()),
            sum(x.attachment_size for x in con_adjunto),
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

    def ejecutar(self) -> InformeEscritorio:
        self._leer()
        with tempfile.TemporaryDirectory(prefix="nexo_escritorio_") as carpeta:
            self.carpeta = Path(carpeta)
            try:
                with usando_empresa(self.empresa):
                    self._comprobar_destino_vacio()
                    self._cruzar_usuarios()
                    self._cruzar_tareas()
                    self._preparar_adjuntos()
                    confirmar = False
                    with transaction.atomic(), fechas_tal_cual(MODELOS.values()):
                        self._crear()
                        self._verificar()
                        confirmar = self.aplicar and self.informe.cuadra
                        if not confirmar:
                            transaction.set_rollback(True)
                    self.informe.confirmado = confirmar
            finally:
                if not self.informe.confirmado:
                    self._borrar_archivos_escritos()
        return self.informe
