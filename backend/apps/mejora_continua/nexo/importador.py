"""Importación única de la Mejora continua de Nexo: las ideas, sus votos y su
historial de etapas, con los adjuntos convertidos en archivos.

Mismo recorrido que las demás importaciones de Gestión Humana
(`apps.novedades.nexo`, `apps.projects.nexo`, `apps.informes.nexo`):

1. Lee de Nexo las filas y los conteos antes de abrir ninguna transacción.
2. Comprueba, sin escribir, que la empresa no tenga ideas y que cada usuario de
   Nexo que hace falta exista en la intranet (por correo). Si no, aborta con la
   lista de lo que falta. No crea cuentas.
3. Prepara los adjuntos (también fuera de la transacción): pide a Nexo el base64
   de cada idea, lo decodifica, comprueba el tamaño y lo valida como la subida
   de la intranet (`services.validar_adjunto`). Lo aceptado queda en una carpeta
   temporal del sistema (fuera del repositorio) hasta guardarlo.
4. Dentro de UNA transacción crea todo, conservando las fechas de Nexo, y
   verifica. En simulacro, o si la verificación no cuadra, lo deshace y borra
   los archivos que alcanzó a escribir.

Decisiones propias de esta importación (salen en el informe):

- **Adjuntos rechazados.** Uno cuyo base64 no es válido, cuyo contenido no
  corresponde a su extensión o que pesa más del máximo NO se importa ni se
  copia a ningún lado: la idea entra sin adjunto y el rechazo queda en el
  informe (idea, nombre, tamaño, motivo y SHA-256) para que Talento Humano
  decida; el original sigue en Nexo. Guardarlo aparte sería poner archivos que
  nadie validó en una carpeta sin el control de acceso de la intranet.
- **Adjuntos que Nexo ya borró.** Nexo borraba el adjunto al sacar la idea de
  PROPUESTA: esas ideas llegan sin adjunto, como están en Nexo.
- **Insignia «innovador».** No se copia: la intranet la deriva del historial
  (`services.innovadores`). Se compara con la de Nexo y cada diferencia sale
  como aviso (no invalida: en Nexo pudo quedar de una idea que luego se movió).
- **Destino.** Solo una empresa sin ideas: no hay clave natural con la que no
  duplicar al repetir, así que la importación no mezcla ni reemplaza.
- **`--excluir-usuario`.** Se quitan sus ideas (con sus votos y su historial) y
  sus votos en ideas ajenas. Si cambió la etapa de una idea de otra persona,
  aborta: excluirla cambiaría el historial de esa idea.
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
from apps.novedades.nexo.comun import (
    ImportacionAbortada,
    ImportadorBase,
    InformeBase,
    ambito,
    fechas_tal_cual,
)

from ..models import IdeaStatusHistory, IdeaVote, ImprovementIdea
from ..services import (
    MejoraContinuaError,
    archivo_desde_base64,
    innovadores,
    validar_adjunto,
)
from .lector import TABLAS, LectorNexoIdeas

MODELOS = {"idea": ImprovementIdea, "vote": IdeaVote, "history": IdeaStatusHistory}

NO_SE_MIGRA = {
    "User.badges": (
        "la insignia «innovador» no se copia: la intranet la deriva del historial "
        "(se compara con la de Nexo y las diferencias salen como aviso)"
    ),
}

#: Columna que es el SUJETO de cada fila (`--excluir-usuario`).
SUJETO_POR_TABLA = {"idea": "author_id", "vote": "user_id", "history": "changed_by_id"}


def tamano_de_base64(texto: str) -> int:
    """Bytes que da un base64 (sin el prefijo de URL de datos ni espacios)."""
    datos = texto.split(",", 1)[1] if texto.startswith("data:") and "," in texto else texto
    datos = "".join(datos.split())
    relleno = len(datos) - len(datos.rstrip("="))
    return len(datos) * 3 // 4 - relleno


def _diferencias(nexo: Counter, intranet: Counter) -> int:
    """Cuántas filas sobran o faltan de un lado frente al otro."""
    return sum(((nexo - intranet) + (intranet - nexo)).values())


@dataclass
class InformeIdeas(InformeBase):
    usuarios_excluidos: list[str] = field(default_factory=list)
    excluidas_por_usuario: dict[str, int] = field(default_factory=dict)
    #: Adjuntos que no se importaron (la idea sí), con el motivo.
    adjuntos_rechazados: list[dict] = field(default_factory=list)


class ImportadorNexoIdeas(ImportadorBase):
    modelos = MODELOS
    tablas = TABLAS
    informe_class = InformeIdeas

    def __init__(
        self, lector: LectorNexoIdeas, empresa, *, aplicar: bool = False, excluir_usuarios=()
    ):
        super().__init__(lector, empresa, aplicar=aplicar)
        self.excluir = sorted({c.strip().lower() for c in excluir_usuarios if c.strip()})
        self.informe.usuarios_excluidos = list(self.excluir)
        self.esperados: dict[str, int] = {}
        #: id de la idea en Nexo → adjunto preparado (ruta temporal, nombre, tipo,
        #: bytes y SHA-256).
        self.preparados: dict[int, dict] = {}
        self.archivos_escritos: list[str] = []
        self.caracteres_leidos = 0

    # 1. Lectura ---------------------------------------------------------------

    def _leer(self):
        self.datos = {tabla: self.lector.filas(tabla) for tabla in TABLAS}
        self.informe.leidos = {tabla: len(filas) for tabla, filas in self.datos.items()}
        self.conteos_nexo = self.lector.conteos()
        self.usuarios_necesarios = self._usuarios_de_las_filas()
        self.innovadores_nexo = set(self.lector.innovadores())
        self.usuarios_nexo = {u["id"]: u for u in self.lector.usuarios(self.usuarios_necesarios)}
        if self.excluir:
            self._excluir_usuarios()
            self.usuarios_necesarios = self._usuarios_de_las_filas()

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

        ideas_fuera = {f["id"] for f in self.datos["idea"] if f["author_id"] in excluidos}
        ajenas = [
            f"idea #{f['idea_id']}: cambió su etapa ({f['from_status']} → {f['to_status']})"
            for f in self.datos["history"]
            if f["changed_by_id"] in excluidos and f["idea_id"] not in ideas_fuera
        ]
        if ajenas:
            raise ImportacionAbortada(
                f"Un usuario excluido movió de etapa {len(ajenas)} ideas de otras personas; "
                "excluirlo cambiaría su historial. No lo excluya. No se creó ni se cambió nada.",
                ajenas,
                codigo="usuario_excluido_referenciado",
            )

        quitadas: dict[str, int] = {}
        for tabla, columna in SUJETO_POR_TABLA.items():
            antes = len(self.datos[tabla])
            idea = "id" if tabla == "idea" else "idea_id"
            self.datos[tabla] = [
                f
                for f in self.datos[tabla]
                if f.get(columna) not in excluidos and f[idea] not in ideas_fuera
            ]
            if len(self.datos[tabla]) != antes:
                quitadas[tabla] = antes - len(self.datos[tabla])
                self.esperados[tabla] = len(self.datos[tabla])
        self.informe.excluidas_por_usuario = quitadas

    # 2. Comprobaciones previas -------------------------------------------------

    def _comprobar_destino_vacio(self):
        if ambito(ImprovementIdea, self.empresa).exists():
            raise ImportacionAbortada(
                f"La empresa «{self.empresa}» ya tiene ideas de Mejora continua; la importación "
                "solo se hace sobre una empresa sin ideas (no mezcla ni reemplaza).",
                ["Con datos: ImprovementIdea"],
                codigo="destino_con_datos",
            )

    # 3. Adjuntos (fuera de la transacción) ----------------------------------------

    def _rechazar(self, fila: dict, nombre: str, motivo: str, contenido: bytes | None = None):
        self.informe.adjuntos_rechazados.append(
            {
                "id_nexo": fila["id"],
                "idea": fila["title"],
                "archivo": nombre,
                "bytes": len(contenido) if contenido is not None else 0,
                "motivo": motivo,
                "sha256": hashlib.sha256(contenido).hexdigest() if contenido else "",
            }
        )

    def _preparar_adjuntos(self):
        """Pide el base64 de cada idea, lo decodifica y lo valida como la subida
        de la intranet. Lo aceptado queda en la carpeta temporal."""
        for fila in self.datos["idea"]:
            contenido = self.lector.adjunto(fila["id"])
            if contenido is None:
                self.informe.problemas.append(
                    f"idea #{fila['id']}: desapareció de Nexo mientras se leía."
                )
                continue
            texto = contenido["attachment_data"] or ""
            self.caracteres_leidos += len(texto)
            if len(texto) != contenido["caracteres"]:
                self.informe.problemas.append(
                    f"idea #{fila['id']}: se leyeron {len(texto)} caracteres de base64 del "
                    f"adjunto y Nexo tiene {contenido['caracteres']} (lectura truncada)."
                )
                continue
            if not texto.strip():
                continue
            nombre = (
                PurePath((fila["attachment_name"] or "").strip()).name or f"adjunto-{fila['id']}"
            )
            try:
                archivo = archivo_desde_base64(nombre, texto)
            except MejoraContinuaError as exc:
                self._rechazar(fila, nombre, exc.message)
                continue
            datos = archivo.read()
            archivo.seek(0)
            esperado = tamano_de_base64(texto)
            if len(datos) != esperado:
                self.informe.problemas.append(
                    f"idea #{fila['id']}: el base64 anuncia {esperado} bytes y decodificado "
                    f"da {len(datos)}."
                )
                continue
            try:
                _, mime = validar_adjunto(archivo)
            except MejoraContinuaError as exc:
                self._rechazar(fila, nombre, exc.message, datos)
                continue
            ruta = self.carpeta / str(fila["id"])
            ruta.write_bytes(datos)
            self.preparados[fila["id"]] = {
                "ruta": ruta,
                "nombre": nombre,
                "mime": mime,
                "bytes": len(datos),
                "sha256": hashlib.sha256(datos).hexdigest(),
            }
        if self.informe.adjuntos_rechazados:
            self.informe.avisos.append(
                f"{len(self.informe.adjuntos_rechazados)} adjuntos no se importaron (la idea "
                "sí, sin adjunto); el detalle va en el informe y el original sigue en Nexo."
            )

    # 4. Escritura ---------------------------------------------------------------

    def _crear_ideas(self):
        """Una por una: cada una recupera su id (el backend de SQL Server no los
        devuelve en un `bulk_create`) y guarda su adjunto en el almacenamiento,
        comprobando que el tamaño guardado sea el decodificado."""
        u = self._u
        creadas = 0
        for f in self.datos["idea"]:
            idea = ImprovementIdea(
                empresa=self.empresa,
                title=(f["title"] or "")[:255],
                description=f["description"] or "",
                impact=f["impact"],
                status=f["status"],
                progress=f["progress"] or 0,
                author_id=u(f["author_id"]),
                created_at=f["created_at"],
                updated_at=f["updated_at"],
            )
            preparado = self.preparados.get(f["id"])
            if preparado is not None:
                idea.attachment_name = preparado["nombre"][:255]
                idea.attachment_mime = preparado["mime"]
                idea.attachment_size = preparado["bytes"]
                with preparado["ruta"].open("rb") as origen:
                    idea.attachment.save(preparado["nombre"], File(origen), save=False)
                self.archivos_escritos.append(idea.attachment.name)
            idea.save(force_insert=True)
            self.mapas["idea"][f["id"]] = idea.pk
            creadas += 1
            if preparado is not None:
                guardado = idea.attachment.storage.size(idea.attachment.name)
                if guardado != preparado["bytes"]:
                    self.informe.problemas.append(
                        f"idea #{f['id']}: se guardaron {guardado} bytes del adjunto y el "
                        f"decodificado tiene {preparado['bytes']}."
                    )
        self.informe.creados["idea"] = creadas

    def _crear(self):
        self._crear_ideas()
        u = self._u
        self._insertar(
            "vote",
            [
                (
                    f["id"],
                    IdeaVote(
                        idea_id=self._id("idea", f["idea_id"], contexto=f"vote #{f['id']}"),
                        user_id=u(f["user_id"]),
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in self.datos["vote"]
            ],
        )
        self._insertar(
            "history",
            [
                (
                    f["id"],
                    IdeaStatusHistory(
                        idea_id=self._id("idea", f["idea_id"], contexto=f"history #{f['id']}"),
                        from_status=f["from_status"],
                        to_status=f["to_status"],
                        changed_by_id=u(f["changed_by_id"]),
                        comment=f["comment"],
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in self.datos["history"]
            ],
        )

    # 5. Verificación -------------------------------------------------------------

    def _verificar(self):
        anotar = self.informe.anotar
        e = self.empresa
        ideas = list(ambito(ImprovementIdea, e))
        votos = list(ambito(IdeaVote, e))
        historial = list(ambito(IdeaStatusHistory, e))
        destino = {"idea": ideas, "vote": votos, "history": historial}
        for tabla in MODELOS:
            leidos = self.informe.leidos[tabla]
            anotar(f"{tabla}: filas en Nexo / leídas", self.conteos_nexo.get(tabla), leidos)
            anotar(
                f"{tabla}: esperadas / en la intranet",
                self.esperados.get(tabla, leidos),
                len(destino[tabla]),
            )

        etapas_nexo = Counter(f["status"] for f in self.datos["idea"])
        etapas = Counter(i.status for i in ideas)
        for etapa in sorted(set(etapas_nexo) | set(etapas)):
            anotar(f"Ideas en {etapa}", etapas_nexo[etapa], etapas[etapa])
        anotar(
            "Ideas: suma del avance",
            sum(f["progress"] or 0 for f in self.datos["idea"]),
            sum(i.progress for i in ideas),
        )
        # Cada voto y cada cambio de etapa, en la misma idea (traducida) y de la
        # misma persona.
        idea_de = self.mapas["idea"]
        anotar(
            "Votos distintos de los de Nexo (idea, persona)",
            0,
            _diferencias(
                Counter(
                    (idea_de.get(f["idea_id"]), self.usuarios.get(f["user_id"]))
                    for f in self.datos["vote"]
                ),
                Counter((v.idea_id, v.user_id) for v in votos),
            ),
        )
        anotar(
            "Cambios de etapa distintos de los de Nexo (idea, de, a, quién)",
            0,
            _diferencias(
                Counter(
                    (
                        idea_de.get(f["idea_id"]),
                        f["from_status"],
                        f["to_status"],
                        self.usuarios.get(f["changed_by_id"]),
                    )
                    for f in self.datos["history"]
                ),
                Counter(
                    (h.idea_id, h.from_status, h.to_status, h.changed_by_id) for h in historial
                ),
            ),
        )
        # Los adjuntos: los aceptados, guardados enteros; todo el base64, leído.
        anotar(
            "Adjuntos aceptados / guardados",
            len(self.preparados),
            sum(1 for i in ideas if i.attachment),
        )
        anotar(
            "Adjuntos: bytes aceptados / guardados",
            sum(p["bytes"] for p in self.preparados.values()),
            sum(i.attachment_size for i in ideas if i.attachment),
        )

        # La insignia derivada frente a la de Nexo (solo aviso).
        autores = {f["author_id"] for f in self.datos["idea"]}
        con_insignia_nexo = {
            self.usuarios[uid] for uid in self.innovadores_nexo & autores if uid in self.usuarios
        }
        with usando_empresa(e):
            derivada = innovadores({self.usuarios[a] for a in autores if a in self.usuarios})
        for uid in sorted(con_insignia_nexo - derivada):
            self.informe.avisos.append(
                f"La cuenta #{uid} tenía la insignia «innovador» en Nexo y en la intranet no: "
                "ninguna de sus ideas llegó a IMPLEMENTADA."
            )
        for uid in sorted(derivada - con_insignia_nexo):
            self.informe.avisos.append(
                f"La cuenta #{uid} gana la insignia «innovador» en la intranet (tiene una idea "
                "implementada) y en Nexo no la tenía."
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

    def ejecutar(self) -> InformeIdeas:
        self._leer()
        with tempfile.TemporaryDirectory(prefix="nexo_ideas_") as carpeta:
            self.carpeta = Path(carpeta)
            try:
                with usando_empresa(self.empresa):
                    self._comprobar_destino_vacio()
                    self._cruzar_usuarios()
                    self._preparar_adjuntos()
                    confirmar = False
                    with transaction.atomic(), fechas_tal_cual(MODELOS.values()):
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
