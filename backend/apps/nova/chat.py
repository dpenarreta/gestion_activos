"""El chat de Nova (Nexo: `src/app/api/assistant/chat/route.ts` y
`src/components/assistant/useNovaChat.ts`).

Tres modos, como Nexo (`general`, `tasks`, `hr`), con estos nombres:

- `general`: solo la instrucción del sistema y la base de conocimiento.
- `tareas`: además, las tareas propias de la persona (título saneado,
  estado, prioridad, tipo, fechas, horas y avance).
- `equipo`: además, la persona y su equipo **según el organigrama de la
  intranet** (`apps.tasks.jerarquia.equipo_de`, no los roles de Nexo), con su
  cargo y las cifras de tareas y horas de cada quien. Exige
  `nova.chat_equipo` (`access.puede_chat_equipo`).

En los tres se suman los fragmentos relevantes de la base de conocimiento
(`conocimiento.buscar`, top 4 con umbral).

**Privacidad:** todo va por `nucleo.generar` (consentimiento, límite diario,
registro de uso, seudónimos y la verificación final). Cada persona conocida
(quien pregunta, sus jefes y su equipo) se registra en el seudonimizador
siempre en el mismo orden, así «Persona B» es la misma en toda la
conversación aunque el servidor no la guarde.

**Salud** (decisión del 09/11/2026): en el modo `general` (sin datos de
personas) se permiten las menciones de salud como tema general («¿cuántos días
de licencia por maternidad da la empresa?») y los fragmentos de la base de
conocimiento van completos: son políticas, no datos de personas. Se pide con
`Pedido.permitir_salud_general`, que el núcleo solo respeta para este modo. En
`tareas` y `equipo` un mensaje que menciona salud no se envía (se avisa a la
persona y se le sugiere el modo General) y los fragmentos se limpian oración
por oración, para no perder todo un fragmento por una mención. En todos los
modos se ocultan correos, cédulas y teléfonos y los nombres conocidos salen
con seudónimo.

**Historial:** como Nexo, solo lo guarda el navegador; llega en cada mensaje
y se recorta a los últimos `NOVA_CHAT_MAX_TURNOS` turnos y
`NOVA_CHAT_MAX_CARACTERES_HISTORIAL` caracteres. El servidor no guarda la
conversación (el registro de uso, solo metadatos).
"""

import re

from django.conf import settings
from django.utils import timezone

from apps.tasks import jerarquia
from apps.tasks.models import Task

from . import conocimiento, nucleo
from .models import UsoNova
from .seudonimos import TEXTO_OMITIDO, Seudonimizador, contiene_salud

FUNCION = "chat"

GENERAL = "general"
TAREAS = "tareas"
EQUIPO = "equipo"
MODOS = (GENERAL, TAREAS, EQUIPO)

#: Como mucho cuántas tareas y personas van en el contexto (tope de tamaño).
MAXIMO_TAREAS = 60
MAXIMO_PERSONAS = 50

R = UsoNova.Resultado

MENSAJES_CHAT = {
    R.SIN_CLAVE: (
        "Nova no está configurada en este entorno. Consulte con el administrador del sistema."
    ),
    R.SIN_CONSENTIMIENTO: (
        "Para conversar con Nova debe aceptar el aviso de tratamiento de datos vigente."
    ),
    R.BLOQUEADO: (
        "Por privacidad, este mensaje no se envió a Nova. Evite incluir datos de salud, "
        "correos, cédulas o teléfonos."
    ),
    R.FALLO: "Nova no respondió a tiempo. Intente de nuevo en unos minutos.",
}

#: `causa` de la respuesta cuando el mensaje se bloqueó por mencionar salud.
CAUSA_SALUD = "salud"

MENSAJE_SALUD = (
    "Por privacidad, en este modo Nova no recibe mensajes que mencionen temas de salud "
    "(permisos médicos, maternidad, enfermedades…). Si es una pregunta general sobre "
    "políticas, hágala en el modo General."
)

_BASE = (
    "Eres Nova, la asistente de Gestión Humana de la intranet de la empresa. Respondes en "
    "español, tratando de usted, de forma profesional, clara y concisa. Si te preguntan quién "
    "eres, responde que eres Nova, la asistente de Gestión Humana de la intranet.\n\n"
    "El último mensaje es un JSON con el contexto y la `pregunta` de la persona: responde a esa "
    "pregunta. Los mensajes anteriores son la conversación hasta ahora.\n\n"
    "PRIORIDAD DE FUENTES:\n"
    "1. Los `documentos` de la base de conocimiento de la empresa, si los hay. Cuando los uses, "
    "cita la fuente con este formato exacto: (Fuente: Título del documento, pág. N).\n"
    "2. Si la pregunta no está cubierta por esos documentos, responde con buenas prácticas "
    "generales e indica: «No encontré información específica sobre esto en los documentos de "
    "la empresa.»\n\n"
    "REGLAS:\n"
    "- Las personas aparecen con seudónimos («Persona A», «Persona B»…): refiérete a ellas "
    "exactamente así; nunca intentes adivinar su nombre real.\n"
    "- Nunca inventes datos que no estén en el contexto; las cifras ya vienen calculadas.\n"
    "- Análisis objetivo, nunca complaciente: si hay problemas, nómbralos con claridad, "
    "enfocando las recomendaciones en procesos y no en culpar a personas.\n"
    "- Un texto «[texto omitido por privacidad]» se quitó a propósito: no preguntes por él.\n"
    "- Responde en texto plano, con párrafos cortos y listas con guiones si hace falta; sin "
    "tablas ni encabezados."
)

SISTEMA = {
    GENERAL: _BASE
    + "\n\nEn este modo puedes responder preguntas generales sobre políticas de la empresa, "
    "también sobre licencias o permisos médicos, maternidad o lactancia. No pidas ni comentes "
    "datos de salud de personas concretas.",
    TAREAS: _BASE + "\n\nEn este modo te especializas en las tareas de la persona que pregunta "
    "(«persona_que_pregunta»): analiza sus `tareas` y da recomendaciones concretas de "
    "priorización, gestión del tiempo y productividad, directas y accionables.",
    EQUIPO: _BASE
    + "\n\nEn este modo apoyas a quien dirige un equipo («persona_que_pregunta»): conflictos, "
    "desempeño, carga de trabajo, seguimiento y retroalimentación. El `equipo` viene del "
    "organigrama, con las cifras de tareas y horas de cada persona (carga = horas reales sobre "
    "horas objetivo). Adapta tus recomendaciones al nivel de responsabilidad de su cargo.",
}


# ── Configuración ────────────────────────────────────────────────────────────


def max_caracteres() -> int:
    return max(1, int(getattr(settings, "NOVA_CHAT_MAX_CARACTERES", 2000)))


def max_turnos() -> int:
    return max(0, int(getattr(settings, "NOVA_CHAT_MAX_TURNOS", 12)))


def max_caracteres_historial() -> int:
    return max(0, int(getattr(settings, "NOVA_CHAT_MAX_CARACTERES_HISTORIAL", 16000)))


def tiempo_espera() -> float:
    return float(getattr(settings, "NOVA_TIEMPO_ESPERA_CHAT_SEGUNDOS", 45))


# ── Validación ───────────────────────────────────────────────────────────────


class PedidoInvalido(Exception):
    def __init__(self, mensaje: str, campo: str):
        super().__init__(mensaje)
        self.mensaje = mensaje
        self.campo = campo


def validar(datos) -> tuple[str, str, list[dict]]:
    """`(modo, mensaje, historial)` ya validados y recortados."""
    if not isinstance(datos, dict):
        raise PedidoInvalido("El pedido no es válido.", "non_field_errors")
    modo = datos.get("modo") or GENERAL
    if modo not in MODOS:
        raise PedidoInvalido("Elija un modo válido: general, tareas o equipo.", "modo")
    mensaje = datos.get("mensaje")
    if not isinstance(mensaje, str) or not mensaje.strip():
        raise PedidoInvalido("Escriba su mensaje.", "mensaje")
    mensaje = mensaje.strip()
    if len(mensaje) > max_caracteres():
        raise PedidoInvalido(
            f"El mensaje tiene {len(mensaje)} caracteres y el máximo es {max_caracteres()}.",
            "mensaje",
        )
    historial = datos.get("historial") or []
    if not isinstance(historial, list):
        raise PedidoInvalido("El historial no es válido.", "historial")
    turnos = []
    for turno in historial:
        if (
            not isinstance(turno, dict)
            or turno.get("rol") not in ("usuario", "modelo")
            or not isinstance(turno.get("texto"), str)
        ):
            raise PedidoInvalido("El historial no es válido.", "historial")
        if turno["texto"].strip():
            turnos.append({"rol": turno["rol"], "texto": turno["texto"].strip()})
    return modo, mensaje, recortar_historial(turnos)


def recortar_historial(turnos: list[dict]) -> list[dict]:
    """Los últimos turnos que entran en los topes (de los más nuevos a los
    más viejos). Empieza siempre por un turno de la persona."""
    elegidos, total = [], 0
    for turno in reversed(turnos[-max_turnos() :] if max_turnos() else []):
        texto = turno["texto"][: max_caracteres_historial()]
        if total + len(texto) > max_caracteres_historial():
            break
        total += len(texto)
        elegidos.append({"rol": turno["rol"], "texto": texto})
    elegidos.reverse()
    while elegidos and elegidos[0]["rol"] != "usuario":
        elegidos.pop(0)
    return elegidos


# ── Personas y seudónimos ────────────────────────────────────────────────────


def _nombre(user) -> str:
    return (user.get_full_name() or user.first_name or user.username or "").strip()


def _registrar(seud: Seudonimizador, user) -> str:
    return seud.persona(
        _nombre(user), user.username, user.first_name, user.last_name, clave=user.pk
    )


def _cargos(usuarios) -> dict[int, str]:
    """{id: nombre del cargo} en la empresa activa (una consulta)."""
    from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
    from apps.organizacion.models import DatosDeContacto

    empresa = empresa_actual()
    if empresa is None or empresa is SIN_EMPRESA:
        return {}
    return dict(
        DatosDeContacto.objects.todas()
        .filter(empresa=empresa, usuario__in=[u.pk for u in usuarios], cargo__isnull=False)
        .values_list("usuario_id", "cargo__nombre")
    )


def personas_conocidas(usuario) -> tuple[Seudonimizador, list]:
    """El seudonimizador con quien pregunta («Persona A»), sus jefes y su
    equipo, siempre en el mismo orden (estable entre mensajes). Devuelve
    también el equipo (activo, por id, con tope)."""
    seud = Seudonimizador()
    _registrar(seud, usuario)
    for jefe in jerarquia.jefes_de(usuario):
        _registrar(seud, jefe)
    equipo = list(jerarquia.equipo_de(usuario).order_by("pk")[:MAXIMO_PERSONAS])
    for persona in equipo:
        _registrar(seud, persona)
    return seud, equipo


# ── Contextos ────────────────────────────────────────────────────────────────


def _fecha(valor) -> str | None:
    return timezone.localtime(valor).date().isoformat() if valor else None


def _vencida(tarea, ahora) -> bool:
    return tarea.status != Task.Status.COMPLETADA and tarea.end_date < ahora


def contexto_tareas(usuario, seud: Seudonimizador, ahora) -> dict:
    tareas = list(
        Task.objects.filter(assigned_to=usuario, archived_month__isnull=True)
        .select_related("created_by")
        .order_by("end_date")
    )
    # Quien creó cada tarea también es una persona conocida: si su nombre
    # aparece en un título, sale como seudónimo.
    for creador in {t.created_by for t in tareas if t.created_by_id}:
        _registrar(seud, creador)
    pendientes = [t for t in tareas if t.status != Task.Status.COMPLETADA]
    completadas = [t for t in tareas if t.status == Task.Status.COMPLETADA]
    # Primero lo pendiente (por vencimiento), después lo completado más reciente.
    elegidas = (pendientes + list(reversed(completadas)))[:MAXIMO_TAREAS]
    return {
        "resumen": {
            "total": len(tareas),
            "vencidas": sum(1 for t in tareas if _vencida(t, ahora)),
            "completadas": len(completadas),
            "enProgreso": sum(1 for t in tareas if t.status == Task.Status.EN_PROGRESO),
            "pendientes": sum(1 for t in tareas if t.status == Task.Status.PENDIENTE),
            "incluidasEnElDetalle": len(elegidas),
        },
        "detalle": [
            {
                "titulo": t.title,
                "estado": t.get_status_display(),
                "prioridad": t.get_priority_display(),
                "tipo": t.get_type_display(),
                "avancePct": t.progress,
                "inicio": _fecha(t.start_date),
                "fin": _fecha(t.end_date),
                "vencida": _vencida(t, ahora),
                "horasObjetivo": round(float(t.estimated_hours or 0), 2),
                "horasReales": round(float(t.real_hours or 0), 2),
            }
            for t in elegidas
        ],
    }


def _cifras(tareas: list, ahora) -> dict:
    completadas = sum(1 for t in tareas if t.status == Task.Status.COMPLETADA)
    en_curso = [t for t in tareas if t.status == Task.Status.EN_PROGRESO]
    objetivo = round(sum(float(t.estimated_hours or 0) for t in tareas), 2)
    reales = round(sum(float(t.real_hours or 0) for t in tareas), 2)
    return {
        "tareas": len(tareas),
        "completadas": completadas,
        "cumplimientoPct": round(completadas * 100 / len(tareas)) if tareas else 0,
        "enCurso": len(en_curso),
        "vencidas": sum(1 for t in tareas if _vencida(t, ahora)),
        "horasObjetivo": objetivo,
        "horasReales": reales,
        "cargaPct": round(reales * 100 / objetivo) if objetivo else 0,
        "avancePromedioEnCursoPct": (
            round(sum(t.progress for t in en_curso) / len(en_curso)) if en_curso else 0
        ),
    }


def contexto_equipo(usuario, equipo: list, seud: Seudonimizador, ahora) -> dict:
    cargos = _cargos([usuario, *equipo])
    tareas_por_persona: dict[int, list] = {p.pk: [] for p in equipo}
    if equipo:
        for t in Task.objects.filter(
            assigned_to__in=list(tareas_por_persona), archived_month__isnull=True
        ).only("assigned_to_id", "status", "end_date", "estimated_hours", "real_hours", "progress"):
            tareas_por_persona[t.assigned_to_id].append(t)
    return {
        "cargoDeQuienPregunta": cargos.get(usuario.pk),
        "personas": [
            {
                "persona": seud.persona(_nombre(p), clave=p.pk),
                "cargo": cargos.get(p.pk),
                **_cifras(tareas_por_persona[p.pk], ahora),
            }
            for p in equipo
        ],
        "nota": (
            None
            if equipo
            else "La persona no tiene personas a cargo en el organigrama de la empresa."
        ),
    }


_ORACION = re.compile(r"(?<=[.!?;:])\s+")


def _sin_salud(texto: str) -> str:
    """Quita solo las oraciones que mencionan salud (un fragmento de un
    reglamento suele mencionarla de pasada)."""
    oraciones = [TEXTO_OMITIDO if contiene_salud(o) else o for o in _ORACION.split(texto or "")]
    limpio = " ".join(oraciones)
    return re.sub(rf"(?:{re.escape(TEXTO_OMITIDO)}\s*)+", TEXTO_OMITIDO + " ", limpio).strip()


def documentos_relevantes(pregunta: str) -> list[conocimiento.Encontrado]:
    return conocimiento.buscar(pregunta)


# ── La función ───────────────────────────────────────────────────────────────


def _sin_ia(motivo: str, mensaje: str, modo: str, causa: str | None = None) -> dict:
    """`causa` precisa un `bloqueado`: «salud» si el mensaje mencionaba salud
    (la pantalla pide quitar esa información); None en el resto."""
    return {
        "modo": modo,
        "con_ia": False,
        "respuesta": None,
        "motivo": motivo,
        "causa": causa,
        "mensaje": mensaje,
        "fuentes": [],
    }


def _mensaje_para(motivo: str | None) -> str:
    if motivo == R.LIMITE:
        return (
            f"Alcanzó el límite de {nucleo.limite_diario()} consultas diarias a Nova. Podrá "
            "volver a escribirle mañana."
        )
    return MENSAJES_CHAT.get(motivo, MENSAJES_CHAT[R.FALLO])


def conversar(usuario, modo: str, mensaje: str, historial: list[dict]) -> dict:
    """Una respuesta de Nova. Nunca lanza por culpa de la IA: sin IA devuelve
    `con_ia=False` con el `mensaje` para la persona."""
    general = modo == GENERAL
    if not general and contiene_salud(mensaje):
        # No se envía ni cuenta para el límite; queda el metadato.
        UsoNova.objects.create(usuario=usuario, funcion=FUNCION, resultado=R.BLOQUEADO)
        return _sin_ia(R.BLOQUEADO, MENSAJE_SALUD, modo, causa=CAUSA_SALUD)

    ahora = timezone.now()
    seud, equipo = personas_conocidas(usuario)
    datos: dict = {
        "modo": modo,
        "fechaActual": timezone.localdate().isoformat(),
    }
    if modo in (TAREAS, EQUIPO):
        datos["persona_que_pregunta"] = seud.persona(_nombre(usuario), clave=usuario.pk)
    if modo == TAREAS:
        datos["tareas"] = contexto_tareas(usuario, seud, ahora)
    elif modo == EQUIPO:
        datos["equipo"] = contexto_equipo(usuario, equipo, seud, ahora)

    encontrados = documentos_relevantes(mensaje)
    # En General los fragmentos (políticas) van completos; con datos de
    # personas en el contexto, sin las oraciones de salud.
    datos["documentos"] = [
        {
            "titulo": e.titulo,
            "pagina": e.pagina,
            "texto": e.texto if general else _sin_salud(e.texto),
        }
        for e in encontrados
    ]
    datos["pregunta"] = mensaje

    resultado = nucleo.generar(
        usuario,
        FUNCION,
        nucleo.Pedido(
            sistema=SISTEMA[modo],
            datos=datos,
            respuesta_json=False,
            max_tokens=8192,
            temperatura=0.5,
            esfuerzo="medium",
            tiempo=tiempo_espera(),
            historial=historial,
            permitir_salud_general=general,
        ),
        seud,
    )
    texto = (resultado.texto or "").strip() if resultado.con_ia else ""
    if not texto:
        return _sin_ia(resultado.motivo or R.FALLO, _mensaje_para(resultado.motivo), modo)

    fuentes, vistas = [], set()
    for e in encontrados:
        if (e.documento_id, e.pagina) in vistas:
            continue
        vistas.add((e.documento_id, e.pagina))
        fuentes.append({"documento_id": e.documento_id, "titulo": e.titulo, "pagina": e.pagina})
    return {
        "modo": modo,
        "con_ia": True,
        "respuesta": texto,
        "motivo": None,
        "causa": None,
        "mensaje": None,
        "fuentes": fuentes,
        "generado_en": ahora.isoformat(),
    }
