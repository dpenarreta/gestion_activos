"""Importación única de la auditoría general de Nexo (`core_auditlog`) a la
auditoría de la intranet (`apps.core.models.AuditLog`).

Mismo recorrido que las demás importaciones desde Nexo:

1. Lee de Nexo las filas, los conteos y los usuarios antes de abrir ninguna
   transacción.
2. Cruza los usuarios por correo (sin distinguir mayúsculas, una sola cuenta
   con ese correo), como los otros importadores. No crea cuentas.
3. Dentro de UNA transacción crea los eventos con la fecha de Nexo y verifica.
   En simulacro, o si la verificación no cuadra, lo deshace.

Decisiones propias de esta importación (salen en el informe):

- **Idempotente.** Cada evento lleva `id_en_nexo` (el id en `core_auditlog`),
  único en la base: los ya importados se saltan y repetir el comando no
  duplica. A diferencia de las demás importaciones, la empresa destino puede
  tener ya auditoría propia: los eventos de Nexo se suman a la historia.
- **Empresa.** Todos los eventos quedan en la empresa indicada (`--empresa`):
  Nexo era de una sola, y un evento sin empresa de «usuarios» o «roles» se
  vería desde cualquier otra.
- **Quién.** Si la persona de Nexo no tiene cuenta en la intranet, el evento se
  importa igual, sin `actor` y con su nombre en `actor_en_nexo` (nunca el
  correo: la auditoría de la intranet no guarda correos).
- **Sobre qué.** `target_id` era un id de Nexo, que en la intranet no apunta a
  nada o apunta a otra cosa: se guarda como `nexo:<id>`. La excepción son los
  eventos sobre un usuario que sí tiene cuenta, que pasan al id de esa cuenta
  (así el historial de una persona se encuentra con el filtro de siempre).
- **Módulo.** Ver `MODULOS` y `PISTAS`; lo que no tiene equivalente va a
  «Nexo (histórico)» (`nexo`).
- **Datos sensibles.** `previous_values`/`new_values` pasan por la lista de la
  intranet (`apps.core.sensitive_data`, más amplia que la de Nexo: también
  correo, teléfono y cédula), y además en profundidad: un diccionario anidado
  no deja pasar una contraseña. Un JSON ilegible se guarda vacío, con aviso.
"""

import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models.functions import Lower

from apps.core.models import AuditLog
from apps.core.sensitive_data import MASK_PLACEHOLDER, _is_sensitive_field
from apps.novedades.nexo.comun import (
    MAXIMO_DE_PARAMETROS,
    InformeBase,
    fechas_tal_cual,
)

from .lector import TABLAS, LectorNexoAuditoria

TABLA = "auditlog"

#: Módulo de Nexo → módulo de la intranet.
MODULOS = {
    "usuarios": "usuarios",
    "roles": "roles",
    "novedades": "novedades",
    "solicitudes_lopd": "privacidad",
}
#: Lo que no tiene equivalente.
MODULO_HISTORICO = "nexo"

#: Para los eventos sin módulo en Nexo (los «acceso denegado» y los fallos de
#: validación, que registraba el núcleo para cualquier vista): un fragmento de
#: la vista, la acción o la ruta → módulo de la intranet. Gana el primero.
PISTAS = (
    ("datarequest", "privacidad"),
    ("data_request", "privacidad"),
    ("data-request", "privacidad"),
    ("novedad", "novedades"),
    ("collaborator", "novedades"),
    ("overtime", "novedades"),
    ("worked_day", "novedades"),
    ("worked-day", "novedades"),
    ("task", "tareas"),
    ("project", "proyectos_gh"),
    ("idea", "mejora_continua"),
    ("meeting", "reuniones"),
    ("training", "capacitacion"),
    ("onboarding", "capacitacion"),
    ("role", "roles"),
    ("user", "usuarios"),
    ("auth", "usuarios"),
    ("password", "usuarios"),
)

NO_SE_MIGRA = {
    "Notificaciones de Nexo": "decisión del 09/11/2026: solo se importa la auditoría",
    "Bitácoras propias de cada módulo (escritorio, tareas, proyectos, informes…)": (
        "las trae el importador de su módulo, no este"
    ),
}

RESULTADOS = {AuditLog.Result.SUCCESS, AuditLog.Result.FAILURE}

#: Filas por `INSERT` (unas veinte columnas cada una; SQL Server admite 2100
#: parámetros por consulta).
LOTE = 80


def enmascarar(valor):
    """Como `mask_sensitive_fields`, pero también en lo anidado."""
    if isinstance(valor, dict):
        return {
            k: (MASK_PLACEHOLDER if _is_sensitive_field(str(k)) else enmascarar(v))
            for k, v in valor.items()
        }
    if isinstance(valor, list):
        return [enmascarar(v) for v in valor]
    return valor


def sensibles_en_claro(valor) -> int:
    """Cuántos campos sensibles quedan con un valor distinto del marcador."""
    if isinstance(valor, dict):
        return sum(
            (1 if v != MASK_PLACEHOLDER else 0)
            if _is_sensitive_field(str(k))
            else sensibles_en_claro(v)
            for k, v in valor.items()
        )
    if isinstance(valor, list):
        return sum(sensibles_en_claro(v) for v in valor)
    return 0


def _diferencias(nexo: Counter, intranet: Counter) -> int:
    return sum(((nexo - intranet) + (intranet - nexo)).values())


@dataclass
class InformeAuditoria(InformeBase):
    #: Lo que no se crea, con el motivo (p. ej., ya importado antes).
    omitidas: dict[str, int] = field(default_factory=dict)
    #: Eventos que se crean por módulo de la intranet.
    por_modulo: dict[str, int] = field(default_factory=dict)
    #: Eventos de personas sin cuenta en la intranet (quedan con su nombre).
    sin_cuenta: int = 0


class ImportadorNexoAuditoria:
    def __init__(self, lector: LectorNexoAuditoria, empresa, *, aplicar: bool = False):
        self.lector = lector
        self.empresa = empresa
        self.aplicar = aplicar
        self.informe = InformeAuditoria(aplicar=aplicar)
        #: usuario de Nexo → usuario de la intranet
        self.usuarios: dict[int, int] = {}
        self.usuarios_nexo: dict[int, dict] = {}
        self.nuevas: list[dict] = []
        #: id en Nexo → evento preparado
        self.preparados: dict[int, AuditLog] = {}
        self.ilegibles = 0

    # 1. Lectura ---------------------------------------------------------------

    def _leer(self):
        self.filas = self.lector.filas(TABLA)
        self.informe.leidos = {TABLA: len(self.filas)}
        self.conteos_nexo = self.lector.conteos()
        necesarios = {f["actor_id"] for f in self.filas if f.get("actor_id") is not None}
        necesarios |= {
            int(f["target_id"]) for f in self.filas if self._objetivo_usuario(f) is not None
        }
        self.usuarios_nexo = {u["id"]: u for u in self.lector.usuarios(necesarios)}
        self.usuarios_necesarios = necesarios

    @staticmethod
    def _objetivo_usuario(fila) -> int | None:
        if (fila.get("target_type") or "").lower() != "user":
            return None
        texto = str(fila.get("target_id") or "").strip()
        return int(texto) if texto.isdigit() else None

    # 2. Usuarios ----------------------------------------------------------------

    def _cruzar_usuarios(self):
        """Por correo, como los otros importadores, pero sin abortar: quien no
        tiene cuenta queda como texto."""
        correos = {
            uid: str(u.get("email") or "").strip().lower() for uid, u in self.usuarios_nexo.items()
        }
        por_correo = defaultdict(list)
        buscados = sorted({c for c in correos.values() if c})
        for inicio in range(0, len(buscados), MAXIMO_DE_PARAMETROS):
            for correo, uid in (
                get_user_model()
                .objects.annotate(correo=Lower("email"))
                .filter(correo__in=buscados[inicio : inicio + MAXIMO_DE_PARAMETROS])
                .values_list("correo", "id")
            ):
                por_correo[correo].append(uid)
        faltantes = set()
        for uid in sorted(self.usuarios_necesarios):
            correo = correos.get(uid, "")
            coincidencias = por_correo.get(correo, []) if correo else []
            if len(coincidencias) == 1:
                self.usuarios[uid] = coincidencias[0]
            elif uid not in self.usuarios_nexo:
                faltantes.add(f"(usuario #{uid} de Nexo: no existe en Nexo)")
            elif not correo:
                faltantes.add(f"(usuario «{self.usuarios_nexo[uid].get('username')}»: sin correo)")
            elif coincidencias:
                faltantes.add(f"{correo} (varias cuentas de la intranet con ese correo)")
            else:
                faltantes.add(correo)
        self.informe.usuarios_faltantes = sorted(faltantes)

    def _nombre_en_nexo(self, uid: int) -> str:
        u = self.usuarios_nexo.get(uid)
        if u is None:
            return f"Usuario #{uid} de Nexo"
        nombre = " ".join(
            p.strip() for p in (u.get("first_name") or "", u.get("last_name") or "") if p.strip()
        )
        return (nombre or str(u.get("username") or "").strip() or f"Usuario #{uid} de Nexo")[:150]

    # 3. Traducción de cada evento ------------------------------------------------

    def _valores(self, fila, columna) -> dict:
        valor = fila.get(columna)
        if valor is None or valor == "":
            return {}
        if isinstance(valor, str | bytes):
            try:
                valor = json.loads(valor)
            except ValueError:
                self.ilegibles += 1
                return {}
        if isinstance(valor, list):
            valor = {"valores": valor}
        if not isinstance(valor, dict):
            valor = {"valor": valor}
        return enmascarar(valor)

    @staticmethod
    def modulo(fila) -> str:
        original = (fila.get("module") or "").strip()
        if original:
            return MODULOS.get(original, MODULO_HISTORICO)
        pistas = [fila.get("target_type") or "", fila.get("action") or ""]
        nuevos = fila.get("new_values")
        if isinstance(nuevos, str | bytes):
            try:
                nuevos = json.loads(nuevos)
            except ValueError:
                nuevos = None
        if isinstance(nuevos, dict):
            # Solo la ruta: el resto son datos del formulario, no del módulo.
            pistas.append(str(nuevos.get("path") or ""))
        texto = " ".join(pistas).lower()
        for fragmento, modulo in PISTAS:
            if fragmento in texto:
                return modulo
        return MODULO_HISTORICO

    def _objetivo(self, fila) -> str:
        uid = self._objetivo_usuario(fila)
        if uid is not None and uid in self.usuarios:
            return str(self.usuarios[uid])
        texto = str(fila.get("target_id") or "").strip()
        if not texto:
            return ""
        objetivo = f"nexo:{texto}"
        if len(objetivo) > 64:
            self.informe.avisos.append(
                f"Evento #{fila['id']} de Nexo: el id del objeto no cabía y se recortó."
            )
        return objetivo[:64]

    def _preparar(self, fila) -> AuditLog:
        actor = fila.get("actor_id")
        cuenta = self.usuarios.get(actor) if actor is not None else None
        if actor is not None and cuenta is None:
            self.informe.sin_cuenta += 1
        resultado = fila.get("result") or AuditLog.Result.SUCCESS
        if resultado not in RESULTADOS:
            self.informe.problemas.append(
                f"Evento #{fila['id']} de Nexo: resultado desconocido «{resultado}»."
            )
        return AuditLog(
            id_en_nexo=fila["id"],
            empresa=self.empresa,
            actor_id=cuenta,
            actor_en_nexo=""
            if cuenta is not None or actor is None
            else self._nombre_en_nexo(actor),
            action=(fila.get("action") or "")[:100],
            module=self.modulo(fila),
            target_type=(fila.get("target_type") or "")[:100],
            target_id=self._objetivo(fila),
            previous_values=self._valores(fila, "previous_values"),
            new_values=self._valores(fila, "new_values"),
            result=resultado,
            ip_address=fila.get("ip_address") or None,
            user_agent=(fila.get("user_agent") or "")[:255],
            browser=(fila.get("browser") or "")[:50],
            operating_system=(fila.get("operating_system") or "")[:50],
            device=(fila.get("device") or "")[:50],
            location=(fila.get("location") or "")[:255],
            correlation_id=(fila.get("correlation_id") or "")[:64],
            created_at=fila["created_at"],
            updated_at=fila.get("updated_at") or fila["created_at"],
        )

    # 4. Escritura -----------------------------------------------------------------

    def _ya_importados(self) -> dict[int, int | None]:
        """id en Nexo → empresa, de los que ya están en la intranet."""
        ids = sorted(f["id"] for f in self.filas)
        resultado = {}
        for inicio in range(0, len(ids), MAXIMO_DE_PARAMETROS):
            resultado.update(
                AuditLog.objects.filter(
                    id_en_nexo__in=ids[inicio : inicio + MAXIMO_DE_PARAMETROS]
                ).values_list("id_en_nexo", "empresa_id")
            )
        return resultado

    def _separar(self):
        ya = self._ya_importados()
        self.nuevas = [f for f in self.filas if f["id"] not in ya]
        if ya:
            self.informe.omitidas["ya importadas antes"] = len(ya)
            otras = sum(1 for empresa in ya.values() if empresa != self.empresa.pk)
            if otras:
                self.informe.avisos.append(
                    f"{otras} eventos ya importados están en otra empresa; no se mueven."
                )

    def _crear(self):
        self.preparados = {f["id"]: self._preparar(f) for f in self.nuevas}
        AuditLog.objects.bulk_create(list(self.preparados.values()), batch_size=LOTE)
        self.informe.creados = {TABLA: len(self.preparados)}
        self.informe.por_modulo = dict(
            sorted(Counter(e.module for e in self.preparados.values()).items())
        )
        if self.ilegibles:
            self.informe.avisos.append(
                f"{self.ilegibles} valores de antes/después no eran JSON legible: quedan vacíos."
            )
        if self.informe.sin_cuenta:
            self.informe.avisos.append(
                f"{self.informe.sin_cuenta} eventos son de personas sin cuenta en la intranet: "
                "quedan con su nombre de Nexo y sin usuario."
            )

    # 5. Verificación ----------------------------------------------------------------

    def _en_la_intranet(self, ids) -> list[AuditLog]:
        ids = sorted(ids)
        eventos = []
        for inicio in range(0, len(ids), MAXIMO_DE_PARAMETROS):
            eventos += list(
                AuditLog.objects.filter(id_en_nexo__in=ids[inicio : inicio + MAXIMO_DE_PARAMETROS])
            )
        return eventos

    def _verificar(self):
        anotar = self.informe.anotar
        leidos = self.informe.leidos[TABLA]
        anotar("auditlog: filas en Nexo / leídas", self.conteos_nexo.get(TABLA), leidos)
        todos = self._en_la_intranet(f["id"] for f in self.filas)
        anotar("auditlog: leídas / en la intranet (con las de antes)", leidos, len(todos))
        creados = [e for e in todos if e.id_en_nexo in self.preparados]
        anotar("auditlog: por crear / creadas", len(self.preparados), len(creados))

        def huella(e: AuditLog):
            return (
                e.id_en_nexo,
                e.empresa_id,
                e.actor_id,
                e.actor_en_nexo,
                e.action,
                e.module,
                e.target_type,
                e.target_id,
                e.result,
                e.created_at,
            )

        anotar(
            "Eventos distintos de lo preparado (quién, acción, módulo, objeto, resultado, fecha)",
            0,
            _diferencias(
                Counter(huella(e) for e in self.preparados.values()),
                Counter(huella(e) for e in creados),
            ),
        )
        fechas = {f["id"]: f["created_at"] for f in self.nuevas}
        anotar(
            "Fechas distintas de las de Nexo",
            0,
            sum(1 for e in creados if e.created_at != fechas[e.id_en_nexo]),
        )
        anotar(
            "Datos sensibles sin enmascarar",
            0,
            sum(
                sensibles_en_claro(e.previous_values) + sensibles_en_claro(e.new_values)
                for e in creados
            ),
        )
        anotar(
            "Eventos con usuario de Nexo / con usuario o nombre en la intranet",
            sum(1 for f in self.nuevas if f.get("actor_id") is not None),
            sum(1 for e in creados if e.actor_id is not None or e.actor_en_nexo),
        )

    # Orquestación -------------------------------------------------------------------

    def ejecutar(self) -> InformeAuditoria:
        self._leer()
        self._cruzar_usuarios()
        self._separar()
        confirmar = False
        with transaction.atomic(), fechas_tal_cual([AuditLog]):
            self._crear()
            self._verificar()
            confirmar = self.aplicar and self.informe.cuadra
            if not confirmar:
                transaction.set_rollback(True)
        self.informe.confirmado = confirmar
        return self.informe


__all__ = ["NO_SE_MIGRA", "TABLAS", "ImportadorNexoAuditoria", "InformeAuditoria"]
