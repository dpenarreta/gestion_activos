"""Importación del consentimiento de datos de Nexo a una empresa de la intranet.

Mismo recorrido que las demás importaciones (`importador.py`,
`apps.novedades.nexo`):

1. Lee de Nexo las filas y los conteos antes de abrir ninguna transacción.
2. Cruza cada usuario de Nexo con la intranet por correo (sin distinguir
   mayúsculas), sin escribir. Si falta alguno, aborta con la lista. No crea
   cuentas; `--excluir-usuario` salta a quien no deba venir.
3. Dentro de UNA transacción crea las aceptaciones y verifica. En simulacro, o
   si la verificación no cuadra, lo deshace.

Decisiones propias (salen en el informe):

- **Versión «Nexo», con su fecha original.** Cada usuario con el consentimiento
  dado en Nexo deja una `AceptacionAviso` de origen NEXO, versión «Nexo» y
  `aceptado_en` = `data_consent_accepted_at`. Sin IP: Nexo no la guardaba.
- **No cuenta como aceptación del aviso vigente.** El aviso de la intranet es
  otro texto (otro sistema, y dice que a la IA se envían seudónimos): la
  aceptación de Nexo queda como constancia previa para la prueba legal, y la
  persona acepta una vez el aviso nuevo al entrar (preferencia del usuario,
  09/11/2026).
- **El texto que regía.** Se guarda con cada aceptación el `consent_text` de
  Nexo vigente en esa fecha (`configuration_systemconfighistory`). Si Nexo no
  tenía ninguno guardado entonces, regía su texto por defecto, que estaba en
  el código: queda vacío y se cuenta en el informe.
- **Sin fecha, no se importa.** Un consentimiento marcado sin fecha no sirve de
  prueba: se cuenta y se avisa.
- **Repetible.** Se salta lo ya importado (mismo usuario de Nexo y misma
  fecha). Si en Nexo alguien volvió a aceptar después de un restablecimiento,
  entra como una aceptación más.
"""

from dataclasses import dataclass, field

from django.db import transaction

from apps.empresas.contexto import usando_empresa
from apps.novedades.nexo.comun import ImportadorBase, InformeBase, ambito

from ..models import AceptacionAviso
from .lector_consentimiento import TABLAS, LectorNexoConsentimiento

MODELOS = {"aceptacion": AceptacionAviso}

NO_SE_MIGRA = {
    "Historial de aceptaciones de Nexo": (
        "Nexo guardaba solo el último consentimiento de cada usuario (restablecer lo "
        "borraba); las aceptaciones anteriores no existen allí"
    ),
    "AuditLog user.consent_*": (
        "los eventos de auditoría de Nexo no se convierten en aceptaciones; van con su "
        "propia importación de auditoría"
    ),
    "IP de la aceptación": "Nexo no la guardaba",
}


@dataclass
class InformeConsentimiento(InformeBase):
    usuarios_excluidos: list[str] = field(default_factory=list)
    excluidas_por_usuario: int = 0
    ya_importadas: int = 0
    #: Marcadas como aceptadas en Nexo pero sin fecha: no se importan.
    sin_fecha: int = 0
    #: Sin texto de Nexo vigente en su fecha (regía el texto por defecto).
    sin_texto: int = 0


class ImportadorNexoConsentimiento(ImportadorBase):
    modelos = MODELOS
    tablas = TABLAS
    informe_class = InformeConsentimiento

    def __init__(
        self,
        lector: LectorNexoConsentimiento,
        empresa,
        *,
        aplicar: bool = False,
        excluir_usuarios=(),
    ):
        super().__init__(lector, empresa, aplicar=aplicar)
        self.excluir = sorted({c.strip().lower() for c in excluir_usuarios if c.strip()})
        self.informe.usuarios_excluidos = list(self.excluir)

    # 1. Lectura ---------------------------------------------------------------

    def _leer(self):
        self.datos = {tabla: self.lector.filas(tabla) for tabla in TABLAS}
        self.informe.leidos = {tabla: len(filas) for tabla, filas in self.datos.items()}
        self.conteos_nexo = self.lector.conteos()
        sin_fecha = [f for f in self.datos["aceptacion"] if f["data_consent_accepted_at"] is None]
        if sin_fecha:
            self.informe.sin_fecha = len(sin_fecha)
            self.informe.avisos.append(
                f"{len(sin_fecha)} usuarios de Nexo tienen el consentimiento marcado sin "
                "fecha: no se importan."
            )
        if self.excluir:
            antes = len(self.datos["aceptacion"])
            encontrados = set()
            conservadas = []
            for fila in self.datos["aceptacion"]:
                correo = str(fila.get("email") or "").strip().lower()
                if correo in self.excluir:
                    encontrados.add(correo)
                else:
                    conservadas.append(fila)
            self.datos["aceptacion"] = conservadas
            self.informe.excluidas_por_usuario = antes - len(conservadas)
            for correo in self.excluir:
                if correo not in encontrados:
                    self.informe.avisos.append(
                        f"--excluir-usuario {correo}: no tiene consentimiento en Nexo."
                    )
        self.validas = [
            f for f in self.datos["aceptacion"] if f["data_consent_accepted_at"] is not None
        ]
        self.usuarios_necesarios = {f["id"] for f in self.validas}
        self.usuarios_nexo = {u["id"]: u for u in self.lector.usuarios(self.usuarios_necesarios)}

    def _texto_en(self, momento) -> str:
        """El `consent_text` de Nexo vigente en ese momento, o vacío."""
        vigentes = [
            t
            for t in self.datos["texto"]
            if t["valid_from"] is not None
            and t["valid_from"] <= momento
            and (t["valid_until"] is None or t["valid_until"] > momento)
        ]
        if not vigentes:
            return ""
        return str(max(vigentes, key=lambda t: (t["valid_from"], t["id"]))["value"] or "")

    # 2. Escritura ---------------------------------------------------------------

    def _crear(self):
        ya = set(
            ambito(AceptacionAviso, self.empresa)
            .filter(origen=AceptacionAviso.Origen.NEXO, id_nexo__isnull=False)
            .values_list("id_nexo", "aceptado_en")
        )
        self.nuevas = [
            f for f in self.validas if (f["id"], f["data_consent_accepted_at"]) not in ya
        ]
        self.informe.ya_importadas = len(self.validas) - len(self.nuevas)
        pares = []
        for f in self.nuevas:
            texto = self._texto_en(f["data_consent_accepted_at"])
            if not texto:
                self.informe.sin_texto += 1
            pares.append(
                (
                    f["id"],
                    AceptacionAviso(
                        empresa=self.empresa,
                        usuario_id=self._u(f["id"]),
                        version=AceptacionAviso.VERSION_NEXO,
                        origen=AceptacionAviso.Origen.NEXO,
                        aceptado_en=f["data_consent_accepted_at"],
                        ip=None,
                        texto=texto,
                        id_nexo=f["id"],
                    ),
                )
            )
        self._insertar("aceptacion", pares)

    # 3. Verificación -------------------------------------------------------------

    def _verificar(self):
        anotar = self.informe.anotar
        anotar(
            "aceptacion: filas en Nexo / leídas",
            self.conteos_nexo.get("aceptacion"),
            self.informe.leidos.get("aceptacion"),
        )
        importadas = list(
            ambito(AceptacionAviso, self.empresa).filter(
                origen=AceptacionAviso.Origen.NEXO,
                id_nexo__in=[f["id"] for f in self.nuevas] or [0],
            )
        )
        claves = {(f["id"], f["data_consent_accepted_at"]) for f in self.nuevas}
        importadas = [a for a in importadas if (a.id_nexo, a.aceptado_en) in claves]
        anotar("aceptacion: nuevas / en la intranet", len(self.nuevas), len(importadas))
        anotar(
            "Usuario y fecha de cada aceptación",
            sorted(
                (f["id"], self.usuarios.get(f["id"]), f["data_consent_accepted_at"])
                for f in self.nuevas
            ),
            sorted((a.id_nexo, a.usuario_id, a.aceptado_en) for a in importadas),
        )
        anotar(
            "Todas con versión «Nexo» y origen NEXO",
            len(importadas),
            sum(
                1
                for a in importadas
                if a.version == AceptacionAviso.VERSION_NEXO
                and a.origen == AceptacionAviso.Origen.NEXO
            ),
        )

    def ejecutar(self) -> InformeConsentimiento:
        self._leer()
        with usando_empresa(self.empresa):
            self._cruzar_usuarios()
            confirmar = False
            with transaction.atomic():
                self._crear()
                self._verificar()
                confirmar = self.aplicar and self.informe.cuadra
                if not confirmar:
                    transaction.set_rollback(True)
            self.informe.confirmado = confirmar
        return self.informe


__all__ = ["NO_SE_MIGRA", "ImportadorNexoConsentimiento", "InformeConsentimiento"]
