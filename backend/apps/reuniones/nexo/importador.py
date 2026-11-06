"""Importación única de las Reuniones de Nexo: las reuniones y sus invitados.

Mismo recorrido que las demás importaciones de Gestión Humana
(`apps.mejora_continua.nexo`, `apps.projects.nexo`):

1. Lee de Nexo las filas y los conteos antes de abrir ninguna transacción.
2. Comprueba, sin escribir, que la empresa no tenga reuniones y que cada
   usuario de Nexo que hace falta exista en la intranet (por correo). Si no,
   aborta con la lista de lo que falta. No crea cuentas.
3. Revisa los enlaces (también fuera de la transacción): el de Zoom pasa a ser
   el enlace manual (`join_url`) y su clave, la clave manual
   (`join_password`), si cumplen lo que exige la intranet.
4. Dentro de UNA transacción crea todo, conservando las fechas de Nexo, y
   verifica. En simulacro, o si la verificación no cuadra, lo deshace.

Decisiones propias de esta importación (salen en el informe):

- **Enlaces simulados.** Cuando Zoom fallaba, Nexo inventaba un enlace
  `https://zoom.us/j/<id al azar>` con una clave al azar, que no llevaba a
  ninguna reunión. Se reconocen porque el enlace es exactamente ese con el
  `zoom_meeting_id` de la fila (los de Zoom de verdad llevan el servidor de la
  cuenta, `usNNweb.zoom.us`, y `?pwd=`). No se importan: la reunión entra sin
  enlace ni clave, y se cuentan en el informe.
- **Enlaces que no son https** (o con espacios, o demasiado largos), sea el de
  la reunión o el de la transcripción: no se importan (la intranet no los
  aceptaría) y quedan en el informe con su motivo.
- **`zoom_meeting_id`** no se migra: era el id interno de Zoom.
- **Destino.** Solo una empresa sin reuniones (ni eliminadas): no hay clave
  natural con la que no duplicar al repetir.
- **`--excluir-usuario`.** Se quitan las reuniones que organizó (con sus
  invitados) y sus invitaciones a reuniones ajenas.
"""

from collections import Counter
from dataclasses import dataclass, field

from django.db import transaction

from apps.empresas.contexto import usando_empresa
from apps.novedades.nexo.comun import (
    ImportacionAbortada,
    ImportadorBase,
    InformeBase,
    ambito,
    fechas_tal_cual,
)

from ..models import Meeting, MeetingInvitee
from ..services import ReunionesError, validar_enlace
from .lector import TABLAS, LectorNexoReuniones

MODELOS = {"meeting": Meeting, "invitee": MeetingInvitee}

NO_SE_MIGRA = {
    "Meeting.zoom_meeting_id": "era el id interno de Zoom; la intranet no se integra con Zoom",
}

#: Columna que es el SUJETO de cada fila (`--excluir-usuario`).
SUJETO_POR_TABLA = {"meeting": "host_id", "invitee": "user_id"}


def es_enlace_simulado(fila: dict) -> bool:
    """El enlace que Nexo inventaba cuando Zoom fallaba (ver el docstring)."""
    reunion = str(fila.get("zoom_meeting_id") or "").strip()
    enlace = str(fila.get("zoom_join_url") or "").strip()
    return bool(reunion) and enlace == f"https://zoom.us/j/{reunion}"


def _diferencias(nexo: Counter, intranet: Counter) -> int:
    return sum(((nexo - intranet) + (intranet - nexo)).values())


@dataclass
class InformeReuniones(InformeBase):
    usuarios_excluidos: list[str] = field(default_factory=list)
    excluidas_por_usuario: dict[str, int] = field(default_factory=dict)
    #: Enlaces que no se importaron (la reunión sí), con el motivo.
    enlaces_descartados: list[dict] = field(default_factory=list)
    enlaces_simulados: int = 0


class ImportadorNexoReuniones(ImportadorBase):
    modelos = MODELOS
    tablas = TABLAS
    informe_class = InformeReuniones

    def __init__(
        self, lector: LectorNexoReuniones, empresa, *, aplicar: bool = False, excluir_usuarios=()
    ):
        super().__init__(lector, empresa, aplicar=aplicar)
        self.excluir = sorted({c.strip().lower() for c in excluir_usuarios if c.strip()})
        self.informe.usuarios_excluidos = list(self.excluir)
        self.esperados: dict[str, int] = {}
        #: id de la reunión en Nexo → (join_url, join_password, otter_transcript_url).
        self.enlaces: dict[int, tuple] = {}

    # 1. Lectura ---------------------------------------------------------------

    def _leer(self):
        self.datos = {tabla: self.lector.filas(tabla) for tabla in TABLAS}
        self.informe.leidos = {tabla: len(filas) for tabla, filas in self.datos.items()}
        self.conteos_nexo = self.lector.conteos()
        self.usuarios_necesarios = self._usuarios_de_las_filas()
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
        fuera = {f["id"] for f in self.datos["meeting"] if f["host_id"] in excluidos}
        quitadas: dict[str, int] = {}
        for tabla, columna in SUJETO_POR_TABLA.items():
            antes = len(self.datos[tabla])
            reunion = "id" if tabla == "meeting" else "meeting_id"
            self.datos[tabla] = [
                f
                for f in self.datos[tabla]
                if f.get(columna) not in excluidos and f[reunion] not in fuera
            ]
            if len(self.datos[tabla]) != antes:
                quitadas[tabla] = antes - len(self.datos[tabla])
                self.esperados[tabla] = len(self.datos[tabla])
        self.informe.excluidas_por_usuario = quitadas

    # 2. Comprobaciones previas -------------------------------------------------

    def _comprobar_destino_vacio(self):
        if ambito(Meeting, self.empresa).exists():
            raise ImportacionAbortada(
                f"La empresa «{self.empresa}» ya tiene reuniones; la importación solo se hace "
                "sobre una empresa sin reuniones (no mezcla ni reemplaza).",
                ["Con datos: Meeting"],
                codigo="destino_con_datos",
            )

    # 3. Enlaces (fuera de la transacción) -----------------------------------------

    def _descartar(self, fila: dict, campo: str, valor: str, motivo: str):
        self.informe.enlaces_descartados.append(
            {
                "id_nexo": fila["id"],
                "reunion": fila["title"],
                "campo": campo,
                "valor": valor[:200],
                "motivo": motivo,
            }
        )

    def _enlace(self, fila: dict, campo: str, valor) -> str | None:
        texto = str(valor or "").strip()
        if not texto:
            return None
        try:
            return validar_enlace(texto, campo)
        except ReunionesError as exc:
            self._descartar(fila, campo, texto, exc.message)
            return None

    def _preparar_enlaces(self):
        for fila in self.datos["meeting"]:
            clave = str(fila.get("zoom_password") or "").strip() or None
            if es_enlace_simulado(fila):
                self.informe.enlaces_simulados += 1
                enlace, clave = None, None
            else:
                enlace = self._enlace(fila, "join_url", fila.get("zoom_join_url"))
                if enlace is None:
                    # Sin enlace válido, la clave sola no sirve de nada.
                    clave = None
            transcripcion = self._enlace(
                fila, "otter_transcript_url", fila.get("otter_transcript_url")
            )
            self.enlaces[fila["id"]] = (enlace, clave, transcripcion)
        if self.informe.enlaces_simulados:
            self.informe.avisos.append(
                f"{self.informe.enlaces_simulados} reuniones tenían el enlace simulado que Nexo "
                "inventaba cuando Zoom fallaba: entran sin enlace ni clave."
            )
        if self.informe.enlaces_descartados:
            self.informe.avisos.append(
                f"{len(self.informe.enlaces_descartados)} enlaces no se importaron (la reunión "
                "sí); el detalle va en el informe."
            )

    # 4. Escritura ---------------------------------------------------------------

    def _crear(self):
        u = self._u
        creadas = 0
        for f in self.datos["meeting"]:
            enlace, clave, transcripcion = self.enlaces[f["id"]]
            reunion = Meeting(
                empresa=self.empresa,
                title=(f["title"] or "")[:255],
                description=f["description"],
                host_id=u(f["host_id"]),
                meeting_date=f["meeting_date"],
                duration=f["duration"],
                join_url=enlace,
                join_password=clave,
                status=f["status"],
                otter_invited=bool(f["otter_invited"]),
                otter_summary=f["otter_summary"],
                otter_transcript_url=transcripcion,
                created_at=f["created_at"],
                updated_at=f["updated_at"],
            )
            # Una por una: el backend de SQL Server no devuelve los ids de un
            # `bulk_create`, y los invitados los necesitan.
            reunion.save(force_insert=True)
            self.mapas["meeting"][f["id"]] = reunion.pk
            creadas += 1
        self.informe.creados["meeting"] = creadas
        self._insertar(
            "invitee",
            [
                (
                    f["id"],
                    MeetingInvitee(
                        meeting_id=self._id(
                            "meeting", f["meeting_id"], contexto=f"invitee #{f['id']}"
                        ),
                        user_id=u(f["user_id"]),
                        attended=bool(f["attended"]),
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
                for f in self.datos["invitee"]
            ],
        )

    # 5. Verificación -------------------------------------------------------------

    def _verificar(self):
        anotar = self.informe.anotar
        reuniones = list(ambito(Meeting, self.empresa))
        invitados = list(ambito(MeetingInvitee, self.empresa))
        destino = {"meeting": reuniones, "invitee": invitados}
        for tabla in MODELOS:
            leidos = self.informe.leidos[tabla]
            anotar(f"{tabla}: filas en Nexo / leídas", self.conteos_nexo.get(tabla), leidos)
            anotar(
                f"{tabla}: esperadas / en la intranet",
                self.esperados.get(tabla, leidos),
                len(destino[tabla]),
            )
        estados_nexo = Counter(f["status"] for f in self.datos["meeting"])
        estados = Counter(r.status for r in reuniones)
        for estado in sorted(set(estados_nexo) | set(estados)):
            anotar(f"Reuniones en {estado}", estados_nexo[estado], estados[estado])
        anotar(
            "Reuniones: suma de la duración (min)",
            sum(f["duration"] or 0 for f in self.datos["meeting"]),
            sum(r.duration for r in reuniones),
        )
        reunion_de = self.mapas["meeting"]
        anotar(
            "Reuniones distintas de las de Nexo (anfitrión, fecha, título)",
            0,
            _diferencias(
                Counter(
                    (self.usuarios.get(f["host_id"]), f["meeting_date"], (f["title"] or "")[:255])
                    for f in self.datos["meeting"]
                ),
                Counter((r.host_id, r.meeting_date, r.title) for r in reuniones),
            ),
        )
        anotar(
            "Invitaciones distintas de las de Nexo (reunión, persona, asistió)",
            0,
            _diferencias(
                Counter(
                    (
                        reunion_de.get(f["meeting_id"]),
                        self.usuarios.get(f["user_id"]),
                        bool(f["attended"]),
                    )
                    for f in self.datos["invitee"]
                ),
                Counter((i.meeting_id, i.user_id, i.attended) for i in invitados),
            ),
        )
        anotar(
            "Enlaces aceptados / guardados",
            sum(1 for e in self.enlaces.values() if e[0]),
            sum(1 for r in reuniones if r.join_url),
        )
        anotar(
            "Resúmenes en Nexo / en la intranet",
            sum(1 for f in self.datos["meeting"] if f["otter_summary"]),
            sum(1 for r in reuniones if r.otter_summary),
        )

    # Orquestación ---------------------------------------------------------------

    def ejecutar(self) -> InformeReuniones:
        self._leer()
        with usando_empresa(self.empresa):
            self._comprobar_destino_vacio()
            self._cruzar_usuarios()
            self._preparar_enlaces()
            confirmar = False
            with transaction.atomic(), fechas_tal_cual(MODELOS.values()):
                self._crear()
                self._verificar()
                confirmar = self.aplicar and self.informe.cuadra
                if not confirmar:
                    transaction.set_rollback(True)
            self.informe.confirmado = confirmar
        return self.informe
