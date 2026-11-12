"""«Mis datos»: todo lo personal que la intranet guarda de una persona, en un
solo archivo (JSON o Excel), para el derecho de acceso (LOPDP).

En Nexo (`export_my_data`) eran tareas, horas, reuniones, ideas, ausencias y
las solicitudes previas. Aquí cubre la intranet entera: se recorrieron todas
las apps de `backend/apps` y cada una está en `SECCIONES` o en `EXCLUIDO` con
su motivo (ver también `docs/derechos-sobre-datos.md`).

Reglas que valen para todas las secciones:

- **Lista blanca de campos.** Cada sección nombra las columnas que entrega
  (`_filas`); nunca `values()` a secas ni un serializador del modelo entero.
  Así un campo nuevo con un secreto (un token, una clave) no entra solo: hay
  que agregarlo a propósito.
- **Solo lo de la persona.** Lo que ella es (su cuenta, su ficha, su cargo),
  lo que pidió o creó como titular (solicitudes, tickets, ideas, notas) y lo
  que se registró sobre ella (ausencias, vacaciones, novedades). Lo que hizo
  como parte de su trabajo sobre otras personas (mantenimientos, novedades que
  capturó como supervisor, órdenes que ejecutó) no se copia: entregaría datos
  de terceros; queda reflejado en el resumen de su actividad.
- **La empresa activa.** Los gestores de los modelos ya acotan cada consulta a
  la empresa de la petición: la descarga es de lo que guarda esa empresa (ver
  `models`). Lo que es de la cuenta y no de una empresa (sesiones, inicios de
  sesión) va siempre.
- **Archivos por su nombre.** Adjuntos, capturas y documentos se listan por
  nombre; el contenido se ve en su módulo.

**Quién descarga.** El titular descarga lo suyo sin permiso. Quien atiende una
solicitud de ACCESO (`privacidad.atender`) descarga lo del titular para
responderle, con dos diferencias (`para_tercero`):

- Las secciones privadas por diseño (`privada=True`: el chat y el Escritorio)
  no van: en la intranet nadie, ni la administración, lee los mensajes ni las
  notas de otra persona. El titular las descarga él mismo desde su perfil.
- Los datos de salud siguen la regla de su módulo: el tipo y la observación de
  las ausencias, los estados especiales y el detalle de los permisos solo si
  quien descarga ya los podría ver (`ausencias.medicas_ver`,
  `licencias.ver_todas`); si no, van enmascarados como en pantalla.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
from io import BytesIO

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone

User = get_user_model()

#: Topes de las secciones que pueden crecer sin fin: se entregan las más
#: recientes y la sección lo dice (`tope`).
TOPE_ACTIVIDAD = 2000
TOPE_INICIOS_DE_SESION = 500
TOPE_MENSAJES_CHAT = 5000
TOPE_NOTIFICACIONES = 2000
TOPE_DESCARGAS = 2000
TOPE_USO_NOVA = 2000

#: Lo que ve quien no puede ver el detalle de un dato de salud.
RESERVADO = "(reservado)"


@dataclass
class Contexto:
    titular: object
    #: Quien descarga: el titular o quien atiende su solicitud.
    lector: object

    @property
    def para_tercero(self) -> bool:
        return self.lector.pk != self.titular.pk

    @property
    def empleados(self):
        from apps.organizacion.models import Empleado

        return Empleado.objects.filter(usuario=self.titular)


@dataclass(frozen=True)
class Seccion:
    clave: str
    titulo: str
    #: Qué incluye, en palabras: sale en el archivo y en la pantalla.
    descripcion: str
    leer: Callable[[Contexto], list[dict] | dict]
    #: Solo la descarga el titular (ver el docstring del módulo).
    privada: bool = False
    #: Si se entregan solo las N más recientes.
    tope: int | None = None
    #: Por qué no va en la descarga de un tercero (si es privada).
    motivo_privada: str = ""


def _filas(consulta, columnas: list[tuple[str, str]]) -> list[dict]:
    """Cada fila con las columnas pedidas, con su nombre de salida. Nada más."""
    nombres = [nombre for nombre, _ in columnas]
    rutas = [ruta for _, ruta in columnas]
    return [dict(zip(nombres, fila, strict=True)) for fila in consulta.values_list(*rutas)]


def _nombre(usuario) -> str:
    if usuario is None:
        return ""
    return (usuario.get_full_name() or "").strip() or usuario.username


def _nombres_de(ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.pk: _nombre(u) for u in User.objects.filter(pk__in=ids)}


# ── Cuenta y perfil ───────────────────────────────────────────────────────────


def _cuenta(ctx: Contexto) -> dict:
    u = ctx.titular
    return {
        "usuario": u.username,
        "nombres": u.first_name,
        "apellidos": u.last_name,
        "correo": u.email,
        "estado_de_la_cuenta": u.status,
        "codigo_de_empleado": u.codigo_empleado or "",
        "creada_el": u.created_at,
        "ultimo_inicio_de_sesion": u.last_login,
    }


def _empresas_y_roles(ctx: Contexto) -> list[dict]:
    from apps.empresas.models import MembresiaEmpresa

    filas = []
    for membresia in (
        MembresiaEmpresa.objects.filter(usuario=ctx.titular)
        .select_related("empresa")
        .prefetch_related("roles")
    ):
        filas.append(
            {
                "empresa": membresia.empresa.nombre,
                "predeterminada": membresia.es_predeterminada,
                "roles_en_la_empresa": ", ".join(sorted(r.name for r in membresia.roles.all())),
            }
        )
    globales = sorted(ctx.titular.groups.values_list("name", flat=True))
    if globales:
        filas.append(
            {
                "empresa": "(todas)",
                "predeterminada": None,
                "roles_en_la_empresa": ", ".join(globales),
            }
        )
    return filas


def _permisos(ctx: Contexto) -> list[dict]:
    from apps.permissions.authorization import get_user_permission_codenames
    from apps.permissions.catalog import iter_all_permissions

    nombres = dict(iter_all_permissions())
    return [
        {"permiso": codename, "que_habilita": nombres.get(codename, "")}
        for codename in sorted(get_user_permission_codenames(ctx.titular))
        if codename in nombres
    ]


def _perfil(ctx: Contexto) -> list[dict]:
    from apps.organizacion.models import DatosDeContacto

    return _filas(
        DatosDeContacto.objects.filter(usuario=ctx.titular),
        [
            ("telefono", "telefono"),
            ("telefono_autorizado_el", "telefono_aceptado_en"),
            ("telefono_autorizado_desde_ip", "telefono_aceptado_ip"),
            ("version_del_texto_autorizado", "telefono_aceptado_version"),
            # El corporativo (10/11/2026): no pide autorización, pero es de
            # su perfil y lo guarda el sistema.
            ("tiene_telefono_corporativo", "tiene_telefono_corporativo"),
            ("telefono_corporativo", "telefono_corporativo"),
            ("correo_personal", "correo_personal"),
            ("correo_personal_autorizado_el", "correo_personal_aceptado_en"),
            ("area", "departamento__nombre"),
            ("agencia_o_sede", "sede__nombre"),
            ("muestra_su_cumpleanos", "mostrar_cumpleanos"),
            ("cumpleanos_dia", "cumpleanos_dia"),
            ("cumpleanos_mes", "cumpleanos_mes"),
            ("cumpleanos_autorizado_el", "cumpleanos_aceptado_en"),
            ("muestra_su_aniversario", "mostrar_aniversario"),
            ("aniversario_dia", "aniversario_dia"),
            ("aniversario_mes", "aniversario_mes"),
            ("aniversario_anio", "aniversario_anio"),
            ("aniversario_autorizado_el", "aniversario_aceptado_en"),
            # Quién aprueba por la persona mientras está ausente (11/11/2026,
            # US-001): su jefe inmediato u otra persona que ella eligió.
            ("quien_aprueba_por_usted_si_esta_ausente", "reemplazo_modo"),
            ("persona_elegida_nombres", "reemplazo__first_name"),
            ("persona_elegida_apellidos", "reemplazo__last_name"),
        ],
    )


def _ficha_de_empleado(ctx: Contexto) -> list[dict]:
    return _filas(
        ctx.empleados,
        [
            ("codigo_de_empleado", "codigo_empleado"),
            ("nombres", "nombres"),
            ("apellidos", "apellidos"),
            ("correo", "correo"),
            ("telefono", "telefono"),
            ("cargo", "cargo"),
            ("area", "departamento__nombre"),
            ("activo", "activo"),
        ],
    )


def _cargo(ctx: Contexto) -> list[dict]:
    """El cargo del organigrama y de qué cargo depende. El nombre de quien lo
    ocupa no: es otra persona, y el organigrama con nombres pide su permiso."""
    from apps.organizacion.models import DatosDeContacto

    return _filas(
        DatosDeContacto.objects.filter(usuario=ctx.titular, cargo__isnull=False),
        [
            ("cargo", "cargo__nombre"),
            ("nivel", "cargo__nivel"),
            ("unidad", "cargo__unidad__nombre"),
            ("cargo_del_que_depende", "cargo__jefe__nombre"),
        ],
    )


def _herramientas(ctx: Contexto) -> list[dict]:
    from apps.organizacion.models import HerramientaDeUsuario

    return _filas(
        HerramientaDeUsuario.objects.filter(usuario=ctx.titular),
        [("herramienta", "herramienta__nombre"), ("cuenta", "cuenta"), ("detalle", "detalle")],
    )


def _aceptaciones(ctx: Contexto) -> list[dict]:
    """Cada aceptación de un texto de protección de datos (US-004,
    11/11/2026): el aviso general, la autorización del teléfono, el cumpleaños
    y el aniversario públicos, el correo personal y el acuerdo de
    confidencialidad, con la versión, el texto exacto, la IP, el navegador y
    si la retiró. Reemplaza a la sección de los acuerdos aceptados: sus filas
    pasaron al registro común (`privacidad/0007`).

    Sin los términos de cada consulta del rol de pagos: son la constancia de
    cada consulta, que tiene su propia descarga protegida (ver `EXCLUIDO`)."""
    from .catalogo_textos import ROL_PAGOS_TERMINOS_CLAVE
    from .models import AceptacionTexto

    return _filas(
        AceptacionTexto.objects.filter(usuario=ctx.titular)
        .exclude(texto_proteccion__clave=ROL_PAGOS_TERMINOS_CLAVE)
        .order_by("aceptado_en", "id"),
        [
            ("modulo", "texto_proteccion__modulo"),
            ("seccion", "texto_proteccion__seccion"),
            ("texto", "texto_proteccion__nombre"),
            ("version", "version"),
            ("aceptado_el", "aceptado_en"),
            ("desde_ip", "ip"),
            ("navegador", "navegador"),
            ("origen", "origen"),
            ("retirada_el", "retirada_en"),
            ("restablecida_el", "restablecida_en"),
            ("titulo_aceptado", "titulo_aceptado"),
            ("texto_aceptado", "texto_aceptado"),
        ],
    )


# ── Vacaciones, permisos y ausencias ──────────────────────────────────────────


def _vacaciones(ctx: Contexto) -> list[dict]:
    from apps.organizacion.models import GoceVacaciones, PeriodoVacaciones

    periodos = _filas(
        PeriodoVacaciones.objects.filter(usuario=ctx.titular).order_by("desde"),
        [
            ("id", "id"),
            ("periodo_desde", "desde"),
            ("periodo_hasta", "hasta"),
            ("dias_que_corresponden", "dias_correspondientes"),
            ("nota", "nota"),
        ],
    )
    goces = _filas(
        GoceVacaciones.objects.filter(periodo__usuario=ctx.titular).order_by("desde"),
        [
            ("periodo", "periodo_id"),
            ("desde", "desde"),
            ("hasta", "hasta"),
            ("dias", "dias"),
            ("descripcion", "descripcion"),
        ],
    )
    filas = []
    for periodo in periodos:
        pid = periodo.pop("id")
        filas.append({**periodo, "tipo": "Período"})
        filas.extend(
            {
                "periodo_desde": periodo["periodo_desde"],
                "periodo_hasta": periodo["periodo_hasta"],
                "tipo": "Goce",
                "desde": g["desde"],
                "hasta": g["hasta"],
                "dias": g["dias"],
                "descripcion": g["descripcion"],
            }
            for g in goces
            if g["periodo"] == pid
        )
    return filas


def _ve_detalle_de_permisos(ctx: Contexto) -> bool:
    from apps.ausencias import access as ausencias
    from apps.permissions.authorization import user_has_permission

    return (
        not ctx.para_tercero
        or user_has_permission(ctx.lector, "licencias.ver_todas")
        or user_has_permission(ctx.lector, ausencias.MEDICAS_VER)
    )


def _solicitudes_de_permiso(ctx: Contexto) -> list[dict]:
    from apps.licencias.models import AccionSolicitud, SolicitudPermiso

    solicitudes = _filas(
        SolicitudPermiso.objects.filter(solicitante=ctx.titular).order_by("created_at"),
        [
            ("id", "id"),
            ("tipo_de_permiso", "flujo__nombre"),
            ("tipo_de_ausencia", "tipo_ausencia"),
            ("desde", "desde"),
            ("hasta", "hasta"),
            ("hora_desde", "hora_desde"),
            ("hora_hasta", "hora_hasta"),
            ("unidad", "unidad"),
            ("descuento", "descuento"),
            ("motivo", "motivo"),
            ("documento_de_respaldo", "adjunto_nombre"),
            ("estado", "estado"),
            ("pedida_el", "created_at"),
            ("cerrada_el", "cerrada_en"),
        ],
    )
    acciones = _filas(
        AccionSolicitud.objects.filter(solicitud__solicitante=ctx.titular).order_by("created_at"),
        [
            ("solicitud", "solicitud_id"),
            ("accion", "accion"),
            ("actor", "actor_id"),
            ("comentario", "comentario"),
            ("fecha", "created_at"),
        ],
    )
    nombres = _nombres_de(a["actor"] for a in acciones)
    ve_detalle = _ve_detalle_de_permisos(ctx)
    for s in solicitudes:
        if not ve_detalle:
            # Como en Ausencias: se enmascaran todos los tipos, no solo el
            # médico; si no, «reservado» delataría por descarte cuál lo es.
            s["tipo_de_permiso"] = RESERVADO
            s["tipo_de_ausencia"] = RESERVADO
            s["motivo"] = RESERVADO
        s["historial"] = [
            {
                "accion": a["accion"],
                "por": nombres.get(a["actor"], ""),
                "comentario": a["comentario"] if ve_detalle else RESERVADO,
                "fecha": a["fecha"],
            }
            for a in acciones
            if a["solicitud"] == s["id"]
        ]
    return solicitudes


def _ausencias(ctx: Contexto) -> list[dict]:
    from apps.ausencias import access as ausencias
    from apps.ausencias.models import LeaveRecord, SpecialStatus

    filas = _filas(
        LeaveRecord.objects.filter(user=ctx.titular).order_by("date"),
        [
            ("fecha", "date"),
            ("dia_completo", "is_full_day"),
            ("minutos", "duration_minutes"),
            ("tipo", "type"),
            ("observacion", "observation"),
            ("descuento", "descuento"),
            ("desde_una_solicitud", "solicitud_id"),
        ],
    )
    ve_detalle = ausencias.can_see_leave_detail(ctx.lector, ctx.titular.pk)
    for f in filas:
        f["desde_una_solicitud"] = f["desde_una_solicitud"] is not None
        f["registro"] = "Ausencia"
        if not ve_detalle:
            f["tipo"] = ausencias.MASKED_TYPE
            f["observacion"] = RESERVADO
    if ausencias.can_see_special_status(ctx.lector, ctx.titular.pk):
        for e in _filas(
            SpecialStatus.objects.filter(user=ctx.titular).order_by("start_date"),
            [
                ("tipo", "type"),
                ("desde", "start_date"),
                ("hasta", "end_date"),
                ("vigente", "is_active"),
                ("horas_diarias", "daily_hours"),
            ],
        ):
            filas.append({"registro": "Estado especial", **e})
    return filas


# ── Gestión Humana ────────────────────────────────────────────────────────────


def _tareas(ctx: Contexto) -> list[dict]:
    from apps.tasks.models import Task

    return _filas(
        Task.objects.filter(assigned_to=ctx.titular).order_by("start_date"),
        [
            ("id", "id"),
            ("titulo", "title"),
            ("descripcion", "description"),
            ("estado", "status"),
            ("prioridad", "priority"),
            ("frecuencia", "frequency"),
            ("tipo", "type"),
            ("inicio", "start_date"),
            ("fin", "end_date"),
            ("horas_estimadas", "estimated_hours"),
            ("horas_reales", "real_hours"),
            ("avance", "progress"),
            ("completada_el", "completed_at"),
            ("mes_archivado", "archived_month"),
            ("creada_el", "created_at"),
        ],
    )


def _horas(ctx: Contexto) -> list[dict]:
    from apps.tasks.models import TaskActivity

    return _filas(
        TaskActivity.objects.filter(author=ctx.titular).order_by("created_at"),
        [
            ("tarea", "task_id"),
            ("titulo_de_la_tarea", "task__title"),
            ("motivo", "reason"),
            ("fecha", "activity_date"),
            ("hora_inicio", "start_time"),
            ("hora_fin", "end_time"),
            ("minutos", "duration"),
            ("descripcion", "description"),
            ("retroactiva", "is_retroactive"),
            ("ajustada_por_la_jefatura", "modified_by_admin"),
            ("comentario_de_la_jefatura", "admin_comment"),
            ("registrada_el", "created_at"),
        ],
    )


def _comentarios(ctx: Contexto) -> list[dict]:
    from apps.projects.models import ProjectComment
    from apps.tasks.models import ActivityComment, Comment

    filas = [
        {"donde": "Tarea", **f}
        for f in _filas(
            Comment.objects.filter(author=ctx.titular),
            [("id_de_la_tarea_o_proyecto", "task_id"), ("texto", "text"), ("fecha", "created_at")],
        )
    ]
    filas += [
        {"donde": "Registro de horas", **f}
        for f in _filas(
            ActivityComment.objects.filter(author=ctx.titular),
            [
                ("id_de_la_tarea_o_proyecto", "activity__task_id"),
                ("texto", "text"),
                ("fecha", "created_at"),
            ],
        )
    ]
    filas += [
        {"donde": "Proyecto", **f}
        for f in _filas(
            ProjectComment.objects.filter(author=ctx.titular),
            [
                ("id_de_la_tarea_o_proyecto", "project_id"),
                ("texto", "text"),
                ("fecha", "created_at"),
            ],
        )
    ]
    return sorted(filas, key=lambda f: f["fecha"])


def _kpi(ctx: Contexto) -> list[dict]:
    from apps.analytics.models import KpiStartDate

    return _filas(
        KpiStartDate.objects.filter(user=ctx.titular),
        [("se_mide_desde", "kpi_start_date"), ("actualizado_el", "updated_at")],
    )


def _proyectos(ctx: Contexto) -> list[dict]:
    from apps.projects.models import Project

    columnas = [
        ("id", "id"),
        ("proyecto", "name"),
        ("estado", "status"),
        ("prioridad", "priority"),
        ("area", "area"),
        ("inicio", "start_date"),
        ("fecha_objetivo", "target_date"),
        ("completado_el", "completed_at"),
        ("eliminado_el", "deleted_at"),
    ]
    responsable = {
        f["id"]: {**f, "participa_como": "Responsable"}
        for f in _filas(Project.objects.filter(responsible=ctx.titular), columnas)
    }
    for f in _filas(Project.objects.filter(participants__user=ctx.titular).distinct(), columnas):
        responsable.setdefault(f["id"], {**f, "participa_como": "Participante"})
    return sorted(responsable.values(), key=lambda f: f["inicio"])


def _reuniones(ctx: Contexto) -> list[dict]:
    """Sin el enlace ni la clave de la reunión: dan acceso a la sala."""
    from apps.reuniones.models import Meeting, MeetingInvitee

    columnas = [
        ("id", "id"),
        ("titulo", "title"),
        ("descripcion", "description"),
        ("fecha", "meeting_date"),
        ("minutos", "duration"),
        ("estado", "status"),
        ("resumen", "otter_summary"),
    ]
    filas = {
        f["id"]: {**f, "participa_como": "Organizador", "asistio": None}
        for f in _filas(Meeting.objects.filter(host=ctx.titular, deleted_at__isnull=True), columnas)
    }
    for inv in _filas(
        MeetingInvitee.objects.filter(user=ctx.titular, meeting__deleted_at__isnull=True),
        [(n, f"meeting__{r}") for n, r in columnas] + [("asistio", "attended")],
    ):
        filas.setdefault(inv["id"], {**inv, "participa_como": "Invitado"})
    return sorted(filas.values(), key=lambda f: f["fecha"])


def _escritorio(ctx: Contexto) -> list[dict]:
    from apps.escritorio.models import DeskNote, DeskNoteReply, PersonalReminder

    notas = _filas(
        DeskNote.objects.filter(
            Q(sender=ctx.titular) | Q(recipient=ctx.titular), deleted_at__isnull=True
        ),
        [
            ("id", "id"),
            ("de", "sender_id"),
            ("para", "recipient_id"),
            ("mensaje", "message"),
            ("prioridad", "priority"),
            ("leida", "read"),
            ("adjunto", "attachment_name"),
            ("fecha", "created_at"),
        ],
    )
    respuestas = _filas(
        DeskNoteReply.objects.filter(author=ctx.titular),
        [("id", "note_id"), ("mensaje", "message"), ("fecha", "created_at")],
    )
    nombres = _nombres_de({n["de"] for n in notas} | {n["para"] for n in notas})
    filas = [
        {
            **n,
            "tipo": "Nota",
            "de": nombres.get(n["de"], ""),
            "para": nombres.get(n["para"], ""),
        }
        for n in notas
    ]
    filas += [{"tipo": "Respuesta a una nota", "de": _nombre(ctx.titular), **r} for r in respuestas]
    filas += [
        {"tipo": "Recordatorio", **r}
        for r in _filas(
            PersonalReminder.objects.filter(user=ctx.titular),
            [
                ("id", "id"),
                ("mensaje", "title"),
                ("descripcion", "description"),
                ("vence", "due_at"),
                ("prioridad", "priority"),
                ("estado", "status"),
                ("repeticion", "repeat"),
                ("adjunto", "attachment_name"),
                ("fecha", "created_at"),
            ],
        )
    ]
    return sorted(filas, key=lambda f: f["fecha"])


def _mejora_continua(ctx: Contexto) -> list[dict]:
    from apps.mejora_continua.models import IdeaVote, ImprovementIdea

    filas = [
        {"registro": "Idea propuesta", **f}
        for f in _filas(
            ImprovementIdea.objects.filter(author=ctx.titular),
            [
                ("idea", "title"),
                ("descripcion", "description"),
                ("impacto", "impact"),
                ("etapa", "status"),
                ("avance", "progress"),
                ("adjunto", "attachment_name"),
                ("fecha", "created_at"),
            ],
        )
    ]
    filas += [
        {"registro": "Voto", **f}
        for f in _filas(
            IdeaVote.objects.filter(user=ctx.titular),
            [("idea", "idea__title"), ("fecha", "created_at")],
        )
    ]
    return sorted(filas, key=lambda f: f["fecha"])


def _capacitacion(ctx: Contexto) -> list[dict]:
    from apps.capacitacion.models import Intento, Onboarding, VistaMaterial

    filas = [
        {"registro": "Onboarding", **f}
        for f in _filas(
            Onboarding.objects.filter(usuario=ctx.titular),
            [("fecha_limite", "fecha_limite"), ("completado_el", "completado_en")],
        )
    ]
    filas += [
        {"registro": "Material abierto", **f}
        for f in _filas(
            VistaMaterial.objects.filter(usuario=ctx.titular),
            [("material", "material__titulo"), ("fecha", "created_at")],
        )
    ]
    filas += [
        {"registro": "Evaluación", **f}
        for f in _filas(
            Intento.objects.filter(usuario=ctx.titular),
            [
                ("material", "material__titulo"),
                ("puntaje", "puntaje"),
                ("nota", "nota"),
                ("aprobado", "aprobado"),
                ("anulado", "anulado"),
                ("por_tiempo", "por_tiempo"),
                ("fecha", "created_at"),
            ],
        )
    ]
    return filas


def _novedades(ctx: Contexto) -> list[dict]:
    """Si la persona es colaborador del Control Operativo (su ficha de
    Novedades enlaza su ficha de empleado). La cédula, enmascarada como en
    toda la intranet fuera de quien gestiona la base: el archivo sale del
    sistema y la persona ya conoce su número."""
    from apps.novedades.models import (
        Collaborator,
        CollaboratorStatusChange,
        OvertimeRecord,
        WorkedDay,
        mask_cedula,
    )

    colaboradores = Collaborator.objects.filter(empleado__usuario=ctx.titular)
    filas = []
    for c in _filas(
        colaboradores,
        [
            ("cedula", "cedula"),
            ("nombre", "full_name"),
            ("codigo_de_empleado", "codigo_empleado"),
            ("regional", "regional"),
            ("area", "area"),
            ("cargo", "cargo"),
            ("estado", "status"),
            ("fecha", "created_at"),
        ],
    ):
        filas.append({"registro": "Ficha de colaborador", **c, "cedula": mask_cedula(c["cedula"])})
    filas += [
        {"registro": "Cambio de estado", **f}
        for f in _filas(
            CollaboratorStatusChange.objects.filter(collaborator__in=colaboradores),
            [
                ("estado_anterior", "previous_status"),
                ("estado", "new_status"),
                ("motivo", "reason"),
                ("fecha", "created_at"),
            ],
        )
    ]
    filas += [
        {"registro": "Día laborado", **f}
        for f in _filas(
            WorkedDay.objects.filter(collaborator__in=colaboradores),
            [("dia", "date"), ("horas", "hours"), ("fecha", "updated_at")],
        )
    ]
    filas += [
        {"registro": "Horas extras", **f}
        for f in _filas(
            OvertimeRecord.objects.filter(collaborator__in=colaboradores, deleted_at__isnull=True),
            [
                ("dia", "date"),
                ("horas", "overtime_hours"),
                ("horas_sabado", "saturday_hours"),
                ("domingo", "is_sunday"),
                ("feriado", "is_holiday"),
                ("trabajo_realizado", "work_done"),
                ("observaciones", "observations"),
                ("fecha", "updated_at"),
            ],
        )
    ]
    return filas


# ── Mesa de ayuda, solicitudes y otros módulos ────────────────────────────────


def _tickets(ctx: Contexto) -> list[dict]:
    """Sin el token del enlace de seguimiento (da acceso al ticket) ni las
    notas internas del equipo de soporte (ver `EXCLUIDO`)."""
    from apps.soporte.models import EncuestaTicket, MensajeTicket, Ticket

    tickets = list(
        Ticket.objects.filter(solicitante=ctx.titular)
        .select_related("categoria", "caso")
        .order_by("created_at")
    )
    mensajes = _filas(
        MensajeTicket.objects.filter(ticket__in=tickets, interno=False).order_by("created_at"),
        [
            ("ticket", "ticket_id"),
            ("autor", "autor_id"),
            ("del_solicitante", "del_solicitante"),
            ("texto", "texto"),
            ("fecha", "created_at"),
        ],
    )
    encuestas = {
        e["ticket"]: e
        for e in _filas(
            EncuestaTicket.objects.filter(ticket__in=tickets),
            [
                ("ticket", "ticket_id"),
                ("calificacion", "calificacion"),
                ("resuelto", "resuelto"),
                ("comentario", "comentario"),
            ],
        )
    }
    nombres = _nombres_de(m["autor"] for m in mensajes)
    filas = []
    for t in tickets:
        encuesta = encuestas.get(t.pk)
        filas.append(
            {
                "ticket": t.numero,
                "categoria": t.categoria.nombre if t.categoria_id else "",
                "caso": t.caso.nombre if t.caso_id else "",
                "descripcion": t.descripcion,
                "tipo": t.tipo,
                "prioridad": t.prioridad,
                "estado": t.estado,
                "nombre_de_contacto": t.solicitante_nombre,
                "telefono_de_contacto": t.solicitante_telefono,
                "correo_de_contacto": t.solicitante_correo,
                "ip_de_origen": t.ip_origen,
                "creado_el": t.created_at,
                "cerrado_el": t.cerrado_en,
                "encuesta": (
                    {k: v for k, v in encuesta.items() if k != "ticket"} if encuesta else None
                ),
                "mensajes": [
                    {
                        "autor": nombres.get(m["autor"], ""),
                        "del_solicitante": m["del_solicitante"],
                        "texto": m["texto"],
                        "fecha": m["fecha"],
                    }
                    for m in mensajes
                    if m["ticket"] == t.pk
                ],
            }
        )
    return filas


def _ordenes(ctx: Contexto) -> list[dict]:
    from apps.ordenes.models import OrdenTrabajo

    return [
        {
            "orden": o.numero,
            "titulo": o.titulo,
            "descripcion": o.descripcion,
            "categoria": o.categoria,
            "prioridad": o.prioridad,
            "estado": o.estado,
            "telefono_de_contacto": o.telefono_contacto,
            "pedida_el": o.created_at,
            "cerrada_el": o.fecha_cierre,
        }
        for o in OrdenTrabajo.objects.filter(solicitante=ctx.titular).order_by("created_at")
    ]


def _solicitudes_de_equipos(ctx: Contexto) -> list[dict]:
    from apps.solicitudes.models import Solicitud

    return _filas(
        Solicitud.objects.filter(solicitante=ctx.titular).order_by("created_at"),
        [
            ("clase", "clase"),
            ("tipo_de_equipo", "tipo_dispositivo__nombre"),
            ("detalle", "detalle"),
            ("cantidad", "cantidad"),
            ("justificacion", "justificacion"),
            ("prioridad", "prioridad"),
            ("estado", "estado"),
            ("pedida_el", "created_at"),
        ],
    )


def _solicitudes_de_la_categoria(ctx: Contexto, categoria: str, columna_tipo: str) -> list[dict]:
    """Las solicitudes de proyecto o de proceso (US-008, 12/11/2026): el mismo
    motor (`apps.proyectos`), separadas por la categoría de su tipo."""
    from apps.proyectos.models import SolicitudProyecto

    return _filas(
        SolicitudProyecto.objects.filter(
            solicitante=ctx.titular, tipo_proyecto__categoria=categoria
        ).order_by("created_at"),
        [
            ("numero", "numero"),
            (columna_tipo, "tipo_proyecto__nombre"),
            ("titulo", "titulo"),
            ("respuestas_del_formulario", "respuestas"),
            ("archivo", "archivo_nombre"),
            ("estado", "estado"),
            ("pedida_el", "created_at"),
            ("cerrada_el", "cerrada_en"),
        ],
    )


def _solicitudes_de_proyectos(ctx: Contexto) -> list[dict]:
    return _solicitudes_de_la_categoria(ctx, "proyecto", "tipo_de_proyecto")


def _solicitudes_de_procesos(ctx: Contexto) -> list[dict]:
    return _solicitudes_de_la_categoria(ctx, "proceso", "tipo_de_proceso")


def _sugerencias(ctx: Contexto) -> list[dict]:
    from apps.sugerencias.models import ComentarioReporte, Reporte

    filas = [
        {"registro": "Reporte", **f}
        for f in _filas(
            Reporte.objects.filter(autor=ctx.titular),
            [
                ("tipo", "tipo"),
                ("titulo", "titulo"),
                ("texto", "descripcion"),
                ("modulo", "modulo"),
                ("estado", "estado"),
                ("fecha", "created_at"),
            ],
        )
    ]
    filas += [
        {"registro": "Comentario", **f}
        for f in _filas(
            ComentarioReporte.objects.filter(autor=ctx.titular),
            [("titulo", "reporte__titulo"), ("texto", "texto"), ("fecha", "created_at")],
        )
    ]
    return sorted(filas, key=lambda f: f["fecha"])


def _equipos(ctx: Contexto) -> list[dict]:
    from apps.activos.models import Activo

    columnas = [
        ("id", "id"),
        ("codigo", "codigo_barras"),
        ("equipo", "nombre"),
        ("tipo", "tipo__nombre"),
        ("marca", "marca"),
        ("modelo", "modelo"),
        ("serie", "numero_serie"),
        ("estado", "estado"),
    ]
    empleados = ctx.empleados
    filas = {
        f["id"]: {**f, "relacion": "A su cargo"}
        for f in _filas(Activo.objects.filter(responsables__in=empleados).distinct(), columnas)
    }
    for f in _filas(Activo.objects.filter(solicitado_por__in=empleados), columnas):
        filas.setdefault(f["id"], {**f, "relacion": "Lo solicitó"})
    for f in filas.values():
        f.pop("id")
    return list(filas.values())


def _matriz(ctx: Contexto) -> list[dict]:
    from apps.matriz.models import Periodo

    filas = []
    for rol, campo in (
        ("Responsable", "responsable"),
        ("Suplente", "suplente"),
        ("Supervisor", "supervisor"),
        ("Aprobador", "aprobador"),
    ):
        filas += [
            {"rol": rol, **f}
            for f in _filas(
                Periodo.objects.filter(**{campo: ctx.titular}),
                [
                    ("codigo", "codigo"),
                    ("obligacion", "obligacion__nombre"),
                    ("periodo", "etiqueta"),
                    ("vence", "vence_en"),
                    ("etapa", "etapa"),
                ],
            )
        ]
    return filas


def _chat(ctx: Contexto) -> list[dict]:
    from apps.chat.models import EstadoChat, Mensaje

    filas = [
        {"registro": "Estado", **f}
        for f in _filas(
            EstadoChat.objects.filter(usuario=ctx.titular),
            [
                ("texto", "mensaje"),
                ("estado", "estado"),
                # Hasta cuándo dura (almuerzo, reunión, fuera de la oficina).
                ("hasta", "hasta"),
                ("vacaciones_desde", "vacaciones_desde"),
                ("vacaciones_hasta", "vacaciones_hasta"),
                ("mensaje_de_vacaciones", "mensaje_vacaciones"),
                ("fecha", "updated_at"),
            ],
        )
    ]
    mensajes = _filas(
        Mensaje.objects.filter(autor=ctx.titular).order_by("-created_at")[:TOPE_MENSAJES_CHAT],
        [
            ("conversacion", "conversacion__nombre"),
            ("tipo_de_conversacion", "conversacion__tipo"),
            ("texto", "texto"),
            ("archivo", "nombre_archivo"),
            ("fecha", "created_at"),
        ],
    )
    filas += [{"registro": "Mensaje enviado", **m} for m in reversed(mensajes)]
    return filas


def _notificaciones(ctx: Contexto) -> list[dict]:
    from apps.notificaciones.models import Notificacion

    filas = _filas(
        Notificacion.objects.filter(usuario=ctx.titular).order_by("-created_at")[
            :TOPE_NOTIFICACIONES
        ],
        [
            ("modulo", "modulo"),
            ("titulo", "titulo"),
            ("resumen", "resumen"),
            ("fecha", "created_at"),
            ("leida_el", "leida_en"),
        ],
    )
    return list(reversed(filas))


def _descargas(ctx: Contexto) -> list[dict]:
    from apps.descargas.models import Descarga

    filas = _filas(
        Descarga.objects.filter(usuario=ctx.titular).order_by("-created_at")[:TOPE_DESCARGAS],
        [
            ("archivo", "nombre"),
            ("modulo", "modulo"),
            ("ip", "ip"),
            ("navegador", "navegador"),
            ("fecha", "created_at"),
        ],
    )
    return list(reversed(filas))


def _sesiones(ctx: Contexto) -> list[dict]:
    """Sin el identificador del token de la sesión: es lo que la renueva."""
    from apps.authentication.models import LoginAttempt, Session

    filas = [
        {"registro": "Sesión", **f}
        for f in _filas(
            Session.objects.filter(user=ctx.titular).order_by("created_at"),
            [
                ("fecha", "created_at"),
                ("ultimo_uso", "last_used_at"),
                ("vence", "expires_at"),
                ("cerrada_el", "revoked_at"),
                ("dispositivo", "device"),
                ("navegador", "user_agent"),
                ("ip", "ip_address"),
            ],
        )
    ]
    intentos = _filas(
        LoginAttempt.objects.filter(user=ctx.titular).order_by("-created_at")[
            :TOPE_INICIOS_DE_SESION
        ],
        [("fecha", "created_at"), ("ip", "ip_address"), ("correcto", "successful")],
    )
    filas += [{"registro": "Intento de inicio de sesión", **f} for f in reversed(intentos)]
    return filas


def _actividad(ctx: Contexto) -> list[dict]:
    """Lo que hizo, según la auditoría: qué, dónde y cuándo. Sin los valores
    anteriores y nuevos: llevan datos de las personas sobre las que actuó."""
    from apps.core.models import AuditLog
    from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

    eventos = AuditLog.objects.filter(actor=ctx.titular)
    empresa = empresa_actual()
    if empresa is not None and empresa is not SIN_EMPRESA:
        eventos = eventos.filter(Q(empresa=empresa) | Q(empresa__isnull=True))
    filas = _filas(
        eventos.order_by("-created_at")[:TOPE_ACTIVIDAD],
        [
            ("fecha", "created_at"),
            ("accion", "action"),
            ("modulo", "module"),
            ("sobre", "target_type"),
            ("id", "target_id"),
            ("resultado", "result"),
            ("ip", "ip_address"),
            ("navegador", "browser"),
            ("sistema_operativo", "operating_system"),
            ("dispositivo", "device"),
        ],
    )
    return list(reversed(filas))


def _privacidad(ctx: Contexto) -> list[dict]:
    from .models import SolicitudDerechos

    return [
        {
            "solicitud": s.numero,
            "tipo": s.tipo,
            "descripcion": s.descripcion,
            "estado": s.estado,
            "fecha_limite": s.fecha_limite,
            "respuesta": s.respuesta,
            "pedida_el": s.created_at,
            "resuelta_el": s.resuelta_en,
        }
        for s in SolicitudDerechos.objects.filter(titular=ctx.titular).order_by("created_at")
    ]


_PRIVADA = (
    "Nadie, ni la administración, lee {} de otra persona. El titular lo descarga él mismo "
    "desde «Mi perfil»."
)


#: Las secciones, en el orden del archivo.
def _uso_nova(ctx: Contexto) -> list[dict]:
    """Cada consulta a Nova (la IA): solo metadatos, como se guardan. Ni la
    pregunta ni la respuesta se guardan nunca."""
    from apps.nova.models import UsoNova

    filas = _filas(
        UsoNova.objects.filter(usuario=ctx.titular).order_by("-creado")[:TOPE_USO_NOVA],
        [
            ("funcion", "funcion"),
            ("proveedor", "proveedor"),
            ("modelo", "modelo"),
            ("resultado", "resultado"),
            ("tokens_entrada", "tokens_entrada"),
            ("tokens_salida", "tokens_salida"),
            ("duracion_ms", "duracion_ms"),
            ("fecha", "creado"),
        ],
    )
    return list(reversed(filas))


def _conocimiento_nova(ctx: Contexto) -> list[dict]:
    """Los documentos que subió a la base de conocimiento de Nova (por su
    nombre: el contenido se abre en la intranet)."""
    from apps.nova.models import DocumentoConocimiento

    return _filas(
        DocumentoConocimiento.objects.filter(subido_por=ctx.titular).order_by("created_at"),
        [
            ("titulo", "titulo"),
            ("archivo", "nombre_original"),
            ("paginas", "paginas"),
            ("fecha", "created_at"),
        ],
    )


SECCIONES: tuple[Seccion, ...] = (
    Seccion(
        "cuenta",
        "Cuenta",
        "Usuario, nombres, correo, estado, código de empleado y fechas "
        "de alta y último acceso. Sin la contraseña.",
        _cuenta,
    ),
    Seccion(
        "empresas_y_roles",
        "Empresas y roles",
        "Las empresas en que trabaja y sus roles en " "cada una.",
        _empresas_y_roles,
    ),
    Seccion("permisos", "Permisos", "Lo que la cuenta puede hacer en la empresa.", _permisos),
    Seccion(
        "perfil",
        "Perfil y contacto",
        "«Mi perfil»: teléfono, correo personal, área, "
        "agencia, cumpleaños y aniversario, con cuándo autorizó publicarlos o guardarlos.",
        _perfil,
    ),
    Seccion(
        "ficha_de_empleado",
        "Ficha de empleado",
        "La ficha de Talento Humano: código, " "nombres, correo, teléfono, cargo y área.",
        _ficha_de_empleado,
    ),
    Seccion(
        "cargo",
        "Cargo y organigrama",
        "Su cargo del organigrama, su unidad y el cargo del " "que depende.",
        _cargo,
    ),
    Seccion(
        "herramientas",
        "Herramientas",
        "Las herramientas que usa, con su cuenta o usuario.",
        _herramientas,
    ),
    Seccion(
        "aceptaciones_de_textos",
        "Textos de protección de datos aceptados",
        "Cada aceptación del aviso de tratamiento de datos, de la autorización del teléfono, "
        "del cumpleaños y el aniversario públicos, del correo personal y del acuerdo de "
        "confidencialidad: la versión, el texto aceptado, cuándo, desde qué IP y navegador, y "
        "si la retiró.",
        _aceptaciones,
    ),
    Seccion("vacaciones", "Vacaciones", "Períodos de vacaciones y cada goce.", _vacaciones),
    Seccion(
        "solicitudes_de_permiso",
        "Solicitudes de permiso",
        "Cada solicitud de permiso con "
        "su historial de aprobaciones. El documento de respaldo, por su nombre.",
        _solicitudes_de_permiso,
    ),
    Seccion(
        "ausencias",
        "Ausencias",
        "Ausencias y estados especiales registrados en Gestión "
        "Humana, con el detalle que la propia persona ve en pantalla.",
        _ausencias,
    ),
    Seccion("tareas", "Tareas", "Las tareas asignadas en Gestión Humana.", _tareas),
    Seccion("horas", "Horas registradas", "Cada registro de horas en sus tareas.", _horas),
    Seccion(
        "comentarios",
        "Comentarios",
        "Sus comentarios en tareas, registros de horas y " "proyectos.",
        _comentarios,
    ),
    Seccion(
        "kpi",
        "KPI",
        "Desde cuándo se le mide. El KPI de cada mes se calcula con sus tareas, "
        "horas y ausencias (ya incluidas) y se descarga en «Mis KPI».",
        _kpi,
    ),
    Seccion(
        "proyectos",
        "Proyectos",
        "Proyectos de Gestión Humana de los que es responsable o " "participante.",
        _proyectos,
    ),
    Seccion(
        "reuniones",
        "Reuniones",
        "Reuniones que organizó o a las que la invitaron, con su "
        "asistencia. Sin el enlace ni la clave de la sala.",
        _reuniones,
    ),
    Seccion(
        "escritorio",
        "Escritorio",
        "Notas enviadas y recibidas, sus respuestas y sus " "recordatorios.",
        _escritorio,
        privada=True,
        motivo_privada=_PRIVADA.format("las notas ni los recordatorios"),
    ),
    Seccion(
        "mejora_continua", "Mejora continua", "Ideas que propuso y sus votos.", _mejora_continua
    ),
    Seccion(
        "capacitacion",
        "Onboarding y capacitación",
        "Su onboarding, los materiales que " "abrió y sus evaluaciones.",
        _capacitacion,
    ),
    Seccion(
        "novedades",
        "Novedades de Gestión Humana",
        "Si es colaborador del Control "
        "Operativo: su ficha (cédula enmascarada), cambios de estado, días laborados y horas "
        "extras.",
        _novedades,
    ),
    Seccion(
        "mesa_de_ayuda",
        "Mesa de ayuda",
        "Sus tickets con sus datos de contacto, los " "mensajes que ve en su ficha y su encuesta.",
        _tickets,
    ),
    Seccion("ordenes_de_trabajo", "Órdenes de trabajo", "Las órdenes que pidió.", _ordenes),
    Seccion(
        "solicitudes_de_equipos",
        "Solicitudes de equipos",
        "Lo que pidió en Gestión de " "Activos.",
        _solicitudes_de_equipos,
    ),
    Seccion(
        "solicitudes_de_proyectos",
        "Solicitudes de proyectos",
        "Las que pidió en " "Institucional, con sus respuestas al formulario.",
        _solicitudes_de_proyectos,
    ),
    Seccion(
        "solicitudes_de_procesos",
        "Solicitudes de procesos",
        "Las que pidió en Institucional, con sus respuestas al formulario.",
        _solicitudes_de_procesos,
    ),
    Seccion(
        "sugerencias", "Sugerencias y errores", "Lo que reportó y sus comentarios.", _sugerencias
    ),
    Seccion("equipos", "Equipos", "Los equipos a su cargo y los que pidió.", _equipos),
    Seccion(
        "matriz",
        "Matriz de obligaciones",
        "Los períodos en que figura como responsable, " "suplente, supervisor o aprobador.",
        _matriz,
    ),
    Seccion(
        "chat",
        "Chat",
        "Su estado y los mensajes que envió (los más recientes).",
        _chat,
        privada=True,
        tope=TOPE_MENSAJES_CHAT,
        motivo_privada=_PRIVADA.format("los mensajes del chat"),
    ),
    Seccion(
        "notificaciones",
        "Notificaciones",
        "Los avisos de la campana que recibió.",
        _notificaciones,
        tope=TOPE_NOTIFICACIONES,
    ),
    Seccion(
        "descargas",
        "Descargas",
        "Los archivos que descargó del sistema, con la IP.",
        _descargas,
        tope=TOPE_DESCARGAS,
    ),
    Seccion(
        "uso_de_nova",
        "Uso de Nova (IA)",
        "Cada consulta a Nova: qué función, con qué proveedor y modelo, cómo terminó, cuántos "
        "tokens y cuándo. Sus preguntas y las respuestas no se guardan.",
        _uso_nova,
        tope=TOPE_USO_NOVA,
    ),
    Seccion(
        "conocimiento_de_nova",
        "Documentos subidos a la base de conocimiento de Nova",
        "Título, archivo, páginas y fecha de los documentos que subió.",
        _conocimiento_nova,
    ),
    Seccion(
        "sesiones",
        "Sesiones e inicios de sesión",
        "Sus sesiones (dispositivo, navegador, "
        "IP) y sus intentos de inicio de sesión más recientes.",
        _sesiones,
        tope=TOPE_INICIOS_DE_SESION,
    ),
    Seccion(
        "actividad",
        "Actividad",
        "Lo que hizo en el sistema según la auditoría (qué, dónde y " "cuándo), lo más reciente.",
        _actividad,
        tope=TOPE_ACTIVIDAD,
    ),
    Seccion(
        "solicitudes_de_derechos",
        "Solicitudes de derechos",
        "Sus solicitudes de acceso, corrección y eliminación, con la respuesta.",
        _privacidad,
    ),
)

#: Lo que no va, y por qué. Cada línea es una decisión. Lo lee el titular
#: («Qué incluye la descarga y qué no» y la hoja del Excel): en palabras de
#: todos los días y tratándolo de usted, sin jerga técnica.
EXCLUIDO: tuple[tuple[str, str], ...] = (
    (
        "Rol de pagos (consultas, documentos, observaciones y su seguimiento)",
        "Tiene su propia descarga, protegida con un código que llega al correo de su cuenta, en "
        "Institucional → Rol de pagos. Copiarlo aquí lo dejaría sin esa protección. Los códigos "
        "de consulta no se guardan en claro y caducan en minutos. Por lo mismo no van los "
        "términos que aceptó en cada consulta; sí el consentimiento de su correo personal.",
    ),
    (
        "Contraseña, códigos de inicio de sesión y de recuperación de la cuenta, código de "
        "seguimiento de sus tickets, enlace y clave de las reuniones",
        "Son llaves de acceso: abren su cuenta, un ticket o una sala de reunión. No dicen nada "
        "sobre usted y quien tenga el archivo podría usarlas.",
    ),
    (
        "Notas internas de la Mesa de ayuda",
        "Son apuntes de trabajo del equipo de soporte. Si quiere conocerlas, pídalas con una "
        "solicitud de acceso.",
    ),
    (
        "Contenido de los archivos (adjuntos, documentos de respaldo, capturas)",
        "Aparecen por su nombre; cada archivo se abre dentro de la intranet, en su módulo.",
    ),
    (
        "Detalle de los cambios registrados en la auditoría",
        "Incluye datos de otras personas con las que usted trabajó. Su actividad va resumida: qué "
        "hizo, dónde y cuándo.",
    ),
    (
        "Registros de su trabajo sobre otras personas o bienes (mantenimientos, novedades de "
        "colaboradores que registró como supervisor, órdenes que ejecutó, informes ejecutivos, "
        "indicadores de su equipo, tableros)",
        "Son datos de otras personas o de la operación de la empresa, no datos suyos.",
    ),
    (
        "Cédula completa",
        "Aparece solo con los últimos 4 dígitos, como en toda la intranet: el archivo sale del "
        "sistema y usted ya conoce su número.",
    ),
    (
        "Datos de otras empresas del grupo",
        "Cada empresa responde por lo que guarda: la descarga trae lo de la empresa en la que "
        "está trabajando ahora en la intranet.",
    ),
)


#: Cada app de `backend/apps` y qué se hizo con ella: las secciones en que
#: aparecen sus datos o por qué no aporta ninguna. Una prueba
#: (`test_mis_datos.test_todas_las_apps_estan_revisadas`) exige que toda app
#: instalada figure aquí: la app que se agregue mañana obliga a decidir.
APPS_REVISADAS: dict[str, str] = {
    "activos": "Secciones: equipos.",
    "adjuntos": "Evidencias de los equipos: no son datos de la persona (ver EXCLUIDO).",
    "alertas": "Configuración de avisos del parque; quién los recibe sale de sus permisos.",
    "analytics": "Secciones: kpi. El KPI mensual se calcula y se baja en «Mis KPI».",
    "ausencias": "Secciones: ausencias.",
    "authentication": "Secciones: sesiones. Sin tokens ni recuperaciones de contraseña.",
    "branding": "Identidad visual del sistema: sin datos personales.",
    "capacitacion": "Secciones: capacitacion.",
    "cartera": "Dashboards de cartera: datos de la operación (ver EXCLUIDO).",
    "chat": "Secciones: chat (solo el titular).",
    "core": "Secciones: actividad (auditoría, sin valores).",
    "correos": "Plantillas de correo: sin datos personales.",
    "descargas": "Secciones: descargas. Las copias no (ver EXCLUIDO).",
    "empresas": "Secciones: empresas_y_roles.",
    "escritorio": "Secciones: escritorio (solo el titular).",
    "informes": "Informes ejecutivos de equipos: datos de terceros (ver EXCLUIDO).",
    "licencias": "Secciones: solicitudes_de_permiso.",
    "mantenimientos": "Bitácora de equipos: datos de la operación (ver EXCLUIDO).",
    "matriz": "Secciones: matriz.",
    "mejora_continua": "Secciones: mejora_continua.",
    "nomina": "Excluida: el rol de pagos tiene su propia descarga protegida (ver EXCLUIDO).",
    "notificaciones": "Secciones: notificaciones.",
    "novedades": "Secciones: novedades (si la persona es colaborador).",
    "nova": (
        "Secciones: uso_de_nova (metadatos; las conversaciones no se guardan), "
        "conocimiento_de_nova."
    ),
    "ordenes": "Secciones: ordenes_de_trabajo.",
    "organizacion": (
        "Secciones: perfil, ficha_de_empleado, cargo, herramientas, vacaciones. El acuerdo de "
        "confidencialidad, en aceptaciones_de_textos."
    ),
    "permissions": "Secciones: permisos.",
    "politicas": "Políticas de renovación de equipos: sin datos personales.",
    "privacidad": "Secciones: solicitudes_de_derechos, aceptaciones_de_textos.",
    "projects": "Secciones: proyectos, comentarios.",
    "proyectos": "Secciones: solicitudes_de_proyectos, solicitudes_de_procesos.",
    "reportes": "Reportes calculados al vuelo: no guarda datos propios.",
    "reuniones": "Secciones: reuniones.",
    "roles": "Secciones: empresas_y_roles.",
    "solicitudes": "Secciones: solicitudes_de_equipos.",
    "soporte": "Secciones: mesa_de_ayuda. Sin notas internas ni token (ver EXCLUIDO).",
    "sugerencias": "Secciones: sugerencias.",
    "tasks": "Secciones: tareas, horas, comentarios.",
    "users": "Secciones: cuenta.",
}


def armar(*, titular, lector) -> dict:
    """El contenido completo, listo para JSON o Excel."""
    from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

    ctx = Contexto(titular=titular, lector=lector)
    empresa = empresa_actual()
    secciones, omitidas = [], []
    for seccion in SECCIONES:
        if seccion.privada and ctx.para_tercero:
            omitidas.append(
                {"clave": seccion.clave, "titulo": seccion.titulo, "motivo": seccion.motivo_privada}
            )
            continue
        datos = seccion.leer(ctx)
        secciones.append(
            {
                "clave": seccion.clave,
                "titulo": seccion.titulo,
                "descripcion": seccion.descripcion,
                "tope": seccion.tope,
                "registros": datos,
            }
        )
    return {
        "generado_el": timezone.now(),
        "sistema": settings.SYSTEM_NAME,
        "empresa": (empresa.nombre if empresa is not None and empresa is not SIN_EMPRESA else ""),
        "titular": {"usuario": titular.username, "nombre": _nombre(titular)},
        "descargado_por": "el titular" if not ctx.para_tercero else _nombre(lector),
        "aviso": (
            "Datos personales que la intranet guarda de la persona, según la Ley Orgánica de "
            "Protección de Datos Personales. Contiene información confidencial: guárdelo en un "
            "lugar seguro y no lo reenvíe."
        ),
        "secciones": secciones,
        "secciones_omitidas": omitidas,
        "no_incluido": [{"que": que, "motivo": motivo} for que, motivo in EXCLUIDO],
    }


def descripcion_de_secciones() -> dict:
    """Qué incluye la descarga y qué no, para mostrarlo en pantalla antes de
    pedirla."""
    return {
        "secciones": [
            {
                "clave": s.clave,
                "titulo": s.titulo,
                "descripcion": s.descripcion,
                "solo_el_titular": s.privada,
            }
            for s in SECCIONES
        ],
        "no_incluido": [{"que": que, "motivo": motivo} for que, motivo in EXCLUIDO],
    }


# ── Formatos ──────────────────────────────────────────────────────────────────


def _a_texto(valor):
    """Un valor de la base, en algo que el JSON y la hoja entienden."""
    if isinstance(valor, datetime):
        return (
            timezone.localtime(valor).isoformat() if timezone.is_aware(valor) else valor.isoformat()
        )
    if isinstance(valor, (date, time)):
        return valor.isoformat()
    if isinstance(valor, Decimal):
        return float(valor)
    if isinstance(valor, dict):
        return {k: _a_texto(v) for k, v in valor.items()}
    if isinstance(valor, (list, tuple)):
        return [_a_texto(v) for v in valor]
    return valor


def a_json(contenido: dict) -> bytes:
    import json

    return json.dumps(_a_texto(contenido), ensure_ascii=False, indent=2).encode("utf-8")


CONTENT_TYPE_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _nombre_de_hoja(titulo: str, usados: set[str]) -> str:
    """Excel admite 31 caracteres y prohíbe algunos signos."""
    limpio = "".join(c for c in titulo if c not in "[]:*?/\\")[:31] or "Hoja"
    nombre, n = limpio, 2
    while nombre.lower() in usados:
        sufijo = f" {n}"
        nombre = limpio[: 31 - len(sufijo)] + sufijo
        n += 1
    usados.add(nombre.lower())
    return nombre


def _celda(valor):
    import json

    from apps.core.hojas_de_calculo import neutralizar

    valor = _a_texto(valor)
    if isinstance(valor, (dict, list)):
        valor = json.dumps(valor, ensure_ascii=False)
    return neutralizar(valor)


def a_excel(contenido: dict) -> bytes:
    """Una hoja «Resumen» y una por sección. Todo texto pasa por `neutralizar`
    (`apps.core.hojas_de_calculo`): lo que empieza por `=`, `+`, `-` o `@`
    queda como texto."""
    from openpyxl import Workbook

    libro = Workbook(write_only=True)
    usados: set[str] = set()
    resumen = libro.create_sheet(_nombre_de_hoja("Resumen", usados))
    resumen.append([_celda("Datos personales de"), _celda(contenido["titular"]["nombre"])])
    resumen.append([_celda("Empresa"), _celda(contenido["empresa"])])
    resumen.append([_celda("Generado el"), _celda(contenido["generado_el"])])
    resumen.append([_celda("Descargado por"), _celda(contenido["descargado_por"])])
    resumen.append([_celda(contenido["aviso"])])
    resumen.append([])
    resumen.append([_celda("Sección"), _celda("Qué incluye"), _celda("Registros")])
    for s in contenido["secciones"]:
        registros = s["registros"]
        total = len(registros) if isinstance(registros, list) else 1
        resumen.append([_celda(s["titulo"]), _celda(s["descripcion"]), total])
    if contenido["secciones_omitidas"]:
        resumen.append([])
        resumen.append([_celda("No incluidas en esta descarga"), _celda("Motivo")])
        for s in contenido["secciones_omitidas"]:
            resumen.append([_celda(s["titulo"]), _celda(s["motivo"])])
    resumen.append([])
    resumen.append([_celda("No se incluye"), _celda("Motivo")])
    for x in contenido["no_incluido"]:
        resumen.append([_celda(x["que"]), _celda(x["motivo"])])

    for s in contenido["secciones"]:
        hoja = libro.create_sheet(_nombre_de_hoja(s["titulo"], usados))
        registros = s["registros"]
        if isinstance(registros, dict):
            for clave, valor in registros.items():
                hoja.append([_celda(clave), _celda(valor)])
            continue
        if not registros:
            hoja.append([_celda("Sin registros.")])
            continue
        columnas: list[str] = []
        for fila in registros:
            columnas += [c for c in fila if c not in columnas]
        hoja.append([_celda(c) for c in columnas])
        for fila in registros:
            hoja.append([_celda(fila.get(c)) for c in columnas])

    salida = BytesIO()
    libro.save(salida)
    return salida.getvalue()


__all__ = [
    "APPS_REVISADAS",
    "CONTENT_TYPE_XLSX",
    "EXCLUIDO",
    "SECCIONES",
    "Contexto",
    "Seccion",
    "a_excel",
    "a_json",
    "armar",
    "descripcion_de_secciones",
]
