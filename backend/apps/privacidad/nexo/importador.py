"""Importación única de las «Solicitudes LOPD» de Nexo a una empresa de la
intranet.

Mismo recorrido que las demás importaciones de Gestión Humana
(`apps.mejora_continua.nexo`, `apps.novedades.nexo`):

1. Lee de Nexo las filas y los conteos antes de abrir ninguna transacción.
2. Comprueba, sin escribir, que cada usuario de Nexo que hace falta exista en
   la intranet (por correo). Si no, aborta con la lista de lo que falta. No
   crea cuentas.
3. Dentro de UNA transacción crea todo, conservando las fechas de Nexo, y
   verifica. En simulacro, o si la verificación no cuadra, lo deshace.

Decisiones propias de esta importación (salen en el informe):

- **Repetible.** Cada solicitud guarda su id de Nexo (`id_nexo`, único por
  empresa): las que ya se importaron se saltan y se cuentan aparte. Volver a
  correrla trae solo las nuevas.
- **Historial.** Nexo no guardaba movimientos: se crea el de recepción
  (PENDIENTE, del titular, en la fecha de la solicitud) y, si ya no estaba
  pendiente, el del estado que tenía (de quien la resolvió, en `resolved_at` o,
  si falta, en la última actualización). Sin respuesta: Nexo no la guardaba.
- **Fecha límite.** Nexo no tenía: se calcula con el plazo vigente desde la
  fecha de la solicitud. Las abiertas viejas pueden entrar ya vencidas; es lo
  que corresponde.
- **ACCESO resueltas al instante.** Cada descarga de «mis datos» en Nexo dejaba
  una solicitud ACCESO resuelta, sin quien la resolviera. Se importan (son la
  constancia de que la persona ejerció su derecho) y se cuentan en el informe.
- **Sin avisos.** Importar no notifica a nadie: no son solicitudes nuevas.
- **`--excluir-usuario`.** Se saltan las solicitudes de esa persona. Si
  resolvió solicitudes de otras, aborta: excluirla las dejaría sin quién las
  resolvió.
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

from ..models import MovimientoSolicitud, SolicitudDerechos
from ..services import fecha_limite_desde, plazo_dias
from .lector import TABLAS, LectorNexoPrivacidad

MODELOS = {"solicitud": SolicitudDerechos, "movimiento": MovimientoSolicitud}

Estado = SolicitudDerechos.Estado

NO_SE_MIGRA = {
    "User.dataConsentAccepted": (
        "el consentimiento de Nexo es otro mecanismo y no se portó con las solicitudes"
    ),
}


@dataclass
class InformePrivacidad(InformeBase):
    usuarios_excluidos: list[str] = field(default_factory=list)
    excluidas_por_usuario: int = 0
    #: Las que ya estaban en la intranet (por `id_nexo`).
    ya_importadas: int = 0
    #: ACCESO resueltas sin resolutor: las descargas de «mis datos» en Nexo.
    descargas_de_nexo: int = 0


class ImportadorNexoPrivacidad(ImportadorBase):
    modelos = MODELOS
    tablas = TABLAS
    informe_class = InformePrivacidad

    def __init__(
        self, lector: LectorNexoPrivacidad, empresa, *, aplicar: bool = False, excluir_usuarios=()
    ):
        super().__init__(lector, empresa, aplicar=aplicar)
        self.excluir = sorted({c.strip().lower() for c in excluir_usuarios if c.strip()})
        self.informe.usuarios_excluidos = list(self.excluir)
        self.plazo = plazo_dias()

    # 1. Lectura ---------------------------------------------------------------

    def _correo(self, fila: dict | None) -> str:
        return str((fila or {}).get("email") or "").strip().lower()

    def _leer(self):
        self.datos = {tabla: self.lector.filas(tabla) for tabla in TABLAS}
        self.informe.leidos = {tabla: len(filas) for tabla, filas in self.datos.items()}
        self.conteos_nexo = self.lector.conteos()
        self.usuarios_necesarios = self._usuarios_de_las_filas()
        self.usuarios_nexo = {u["id"]: u for u in self.lector.usuarios(self.usuarios_necesarios)}
        if self.excluir:
            self._excluir_usuarios()
            self.usuarios_necesarios = self._usuarios_de_las_filas()

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
        ajenas = [
            f"solicitud #{f['id']}: la resolvió"
            for f in self.datos["solicitud"]
            if f["resolved_by_id"] in excluidos and f["user_id"] not in excluidos
        ]
        if ajenas:
            raise ImportacionAbortada(
                f"Un usuario excluido resolvió {len(ajenas)} solicitudes de otras personas; "
                "excluirlo las dejaría sin quién las resolvió. No lo excluya. No se creó ni se "
                "cambió nada.",
                ajenas,
                codigo="usuario_excluido_referenciado",
            )
        antes = len(self.datos["solicitud"])
        self.datos["solicitud"] = [
            f for f in self.datos["solicitud"] if f["user_id"] not in excluidos
        ]
        self.informe.excluidas_por_usuario = antes - len(self.datos["solicitud"])

    # 2. Escritura ---------------------------------------------------------------

    def _crear(self):
        ya = set(
            ambito(SolicitudDerechos, self.empresa)
            .filter(id_nexo__isnull=False)
            .values_list("id_nexo", flat=True)
        )
        self.nuevas = [f for f in self.datos["solicitud"] if f["id"] not in ya]
        self.informe.ya_importadas = len(self.datos["solicitud"]) - len(self.nuevas)
        u = self._u
        pares = []
        for f in self.nuevas:
            estado = f["status"]
            resuelta = estado == Estado.RESUELTA
            if resuelta and f["type"] == "ACCESO" and f["resolved_by_id"] is None:
                self.informe.descargas_de_nexo += 1
            pares.append(
                (
                    f["id"],
                    SolicitudDerechos(
                        empresa=self.empresa,
                        titular_id=u(f["user_id"]),
                        tipo=f["type"],
                        descripcion=(f["description"] or "").strip(),
                        estado=estado,
                        fecha_limite=fecha_limite_desde(f["created_at"], self.plazo),
                        plazo_dias=self.plazo,
                        resuelta_por_id=u(f["resolved_by_id"]) if resuelta else None,
                        resuelta_en=f["resolved_at"] if resuelta else None,
                        id_nexo=f["id"],
                        created_at=f["created_at"],
                        updated_at=f["updated_at"],
                    ),
                )
            )
        self._insertar("solicitud", pares, clave=("id_nexo",))

        movimientos = []
        for f in self.nuevas:
            solicitud_id = self._id("solicitud", f["id"], contexto=f"solicitud #{f['id']}")
            if solicitud_id is None:
                continue
            movimientos.append(
                (
                    f["id"],
                    MovimientoSolicitud(
                        solicitud_id=solicitud_id,
                        estado_anterior="",
                        estado_nuevo=Estado.PENDIENTE,
                        actor_id=u(f["user_id"]),
                        created_at=f["created_at"],
                        updated_at=f["created_at"],
                    ),
                )
            )
            if f["status"] != Estado.PENDIENTE:
                momento = f["resolved_at"] or f["updated_at"]
                movimientos.append(
                    (
                        f["id"],
                        MovimientoSolicitud(
                            solicitud_id=solicitud_id,
                            estado_anterior=Estado.PENDIENTE,
                            estado_nuevo=f["status"],
                            actor_id=u(f["resolved_by_id"]),
                            created_at=momento,
                            updated_at=momento,
                        ),
                    )
                )
        self._insertar("movimiento", movimientos)

    # 3. Verificación -------------------------------------------------------------

    def _verificar(self):
        anotar = self.informe.anotar
        importadas = list(
            ambito(SolicitudDerechos, self.empresa).filter(
                id_nexo__in=[f["id"] for f in self.nuevas] or [0]
            )
        )
        anotar(
            "solicitud: filas en Nexo / leídas",
            self.conteos_nexo.get("solicitud"),
            self.informe.leidos.get("solicitud"),
        )
        anotar("solicitud: nuevas / en la intranet", len(self.nuevas), len(importadas))
        esperados_mov = sum(2 if f["status"] != Estado.PENDIENTE else 1 for f in self.nuevas)
        anotar(
            "movimientos: esperados / en la intranet",
            esperados_mov,
            ambito(MovimientoSolicitud, self.empresa)
            .filter(solicitud__in=[s.pk for s in importadas] or [0])
            .count(),
        )
        anotar(
            "Solicitudes por (tipo, estado)",
            sorted(Counter((f["type"], f["status"]) for f in self.nuevas).items()),
            sorted(Counter((s.tipo, s.estado) for s in importadas).items()),
        )
        anotar(
            "Titular de cada solicitud",
            sorted((f["id"], self.usuarios.get(f["user_id"])) for f in self.nuevas),
            sorted((s.id_nexo, s.titular_id) for s in importadas),
        )

    def ejecutar(self) -> InformePrivacidad:
        self._leer()
        with usando_empresa(self.empresa):
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


__all__ = ["NO_SE_MIGRA", "ImportadorNexoPrivacidad", "InformePrivacidad"]
