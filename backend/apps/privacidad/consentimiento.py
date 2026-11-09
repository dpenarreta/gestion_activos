"""Consentimiento del tratamiento de datos personales (09/11/2026), portado del
«gate» de Nexo (`ConsentGate.tsx`, `User.data_consent_accepted[_at]`,
`PATCH /api/auth/consent`, `reset-consent` y `reset-consent-all`, y el texto
editable `consent_text`).

Se conserva de Nexo:

- Al entrar, una pantalla obligatoria con el aviso. No hay más salida que
  aceptarlo o cerrar sesión, y mientras tanto no se pinta el resto de la
  intranet.
- El texto es editable por quien administra la privacidad.
- Restablecer el consentimiento de una persona o el de todas.

Lo que cambia:

1. **Por empresa.** El aviso y las aceptaciones son de la empresa activa: cada
   empresa del grupo es un responsable del tratamiento distinto (lo mismo que
   las solicitudes de derechos). Quien trabaja en dos acepta el aviso de cada
   una al entrar en ella.
2. **Versión explícita.** En Nexo cualquier edición del texto dejaba a todos
   con el consentimiento dado. Aquí editar el texto no cambia la versión;
   pedir que se acepte de nuevo (`pedir_de_nuevo`) la sube y todos vuelven a
   aceptar. Así una corrección menor no obliga a nadie, y un cambio sustancial
   sí.
3. **Historial, no un valor.** Nexo guardaba un booleano y una fecha, y
   restablecer los borraba: se perdía la prueba de que la persona había
   aceptado. Aquí cada aceptación es una fila (`AceptacionAviso`) con la
   versión, la fecha, la IP —la intranet ya la guarda en las sesiones, la
   auditoría y la autorización del teléfono— y el texto exacto que se mostró.
   Restablecer la marca (`restablecida_en`, `restablecida_por`), no la borra.
4. **Sin aviso, no se exige nada.** Si la empresa no tiene aviso configurado
   (una empresa nueva) nadie queda bloqueado, tampoco las cuentas de soporte.
   `privacidad/0005` siembra el aviso inicial en las empresas existentes.
5. **Las aceptaciones de Nexo** (`importar_nexo_consentimiento`) se guardan con
   la versión «Nexo» y su fecha original, como constancia previa; no cuentan
   como aceptación del aviso vigente, que es otro texto (otro sistema, y
   menciona los seudónimos que se envían a la IA). Cada persona acepta una vez
   el aviso nuevo.
6. **Auditoría.** Aceptar, editar el aviso, pedir aceptarlo de nuevo y
   restablecer (una persona o todas) quedan en el registro de auditoría, en el
   módulo «privacidad». En Nexo el restablecer individual no se auditaba.

La pantalla la pone el frontend con lo que dice `GET /auth/me/`
(`consentimiento`), igual que en Nexo. El servidor no bloquea el resto de la
API mientras falta aceptar: hacerlo exigiría tocar la autenticación de toda la
intranet y excepciones para la sesión, las notificaciones y el cierre de
sesión; lo que se protege aquí es la constancia, y esa la da el registro.
"""

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Exists, OuterRef
from django.utils import timezone

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

from . import access
from .models import AVISO_MAX, AceptacionAviso, AvisoPrivacidad
from .services import PrivacidadError, _audit, _invalido, nombre

User = get_user_model()
Origen = AceptacionAviso.Origen

#: El aviso con que se siembra cada empresa (`privacidad/0005`) y el que se
#: propone al crear el de una empresa nueva. Adaptado del de Nexo: sin nombres
#: de sistemas ni de servidores, con la IA y los seudónimos. No da por hecho el
#: proveedor de IA (la intranet puede usar Claude o Gemini, `IA_PROVEEDOR`):
#: nombra el previsto; si cambia, se edita el aviso y se pide aceptarlo de nuevo.
#: Nombra a la empresa como responsable (con su nombre, ver `texto_inicial`), a
#: Gestión Humana como contacto y el plazo de conservación. Sin correos ni
#: teléfonos: el repositorio es público y cada empresa los añade al editarlo.
PLANTILLA_INICIAL = """{responsable} es la responsable del tratamiento de sus datos personales. Los recopila y trata en la intranet con el fin de gestionar el trabajo, los recursos humanos y los servicios internos. Son estos:

- Datos de identificación y contacto: nombres, usuario, correo electrónico y, si usted lo autoriza, su teléfono.
- Datos de actividad laboral: cargo, área, tareas, horas trabajadas, actividades de seguimiento e indicadores de desempeño.
- Datos de asistencia y permisos: vacaciones, permisos personales y permisos médicos.
- Datos de condición laboral especial: maternidad o lactancia, cuando afectan la jornada laboral.
- Registros de uso: inicios de sesión y acciones en el sistema, para la seguridad y la auditoría.

Los datos de salud (permisos médicos, maternidad y lactancia) son datos sensibles: solo los trata el personal autorizado de Gestión Humana, con la finalidad de calcular correctamente la carga laboral y los indicadores, conforme a la Ley Orgánica de Protección de Datos Personales del Ecuador.

Sus datos no se comparten con terceros con fines comerciales. Algunas funciones de la intranet usan un proveedor externo de inteligencia artificial para generar análisis y respuestas; el proveedor es Google (Gemini). A ese proveedor solo se envían seudónimos (códigos que no permiten saber de quién se trata), nunca su nombre ni sus datos de salud. Si el proveedor cambia, este aviso se actualizará y se le pedirá aceptarlo de nuevo.

Sus datos se conservan el tiempo que dure la relación laboral y los plazos que exija la ley. Para cualquier consulta sobre el tratamiento de sus datos, el contacto es Gestión Humana.

Puede ejercer sus derechos de acceso, corrección y eliminación de sus datos desde «Mi perfil» › «Mis derechos», después de entrar, o consultando a Gestión Humana."""


def texto_inicial(nombre_empresa: str = "") -> str:
    """El aviso inicial con la empresa como responsable: con su nombre si se
    sabe; si no, «la empresa para la que usted trabaja»."""
    nombre_empresa = (nombre_empresa or "").strip()
    responsable = (
        f"La empresa {nombre_empresa}, para la que usted trabaja,"
        if nombre_empresa
        else "La empresa para la que usted trabaja"
    )
    return PLANTILLA_INICIAL.replace("{responsable}", responsable)


#: Estados de una persona frente al aviso vigente (filtro del listado).
ACEPTADO = "ACEPTADO"
PENDIENTE = "PENDIENTE"


def _hay_empresa() -> bool:
    empresa = empresa_actual()
    return empresa is not None and empresa is not SIN_EMPRESA


def aviso_vigente() -> AvisoPrivacidad | None:
    """El aviso de la empresa activa, o `None` si no tiene (o no hay empresa)."""
    if not _hay_empresa():
        return None
    return AvisoPrivacidad.objects.select_related("editado_por").first()


def _vigentes(aviso: AvisoPrivacidad):
    """Las aceptaciones que valen para ese aviso: de la intranet, de su
    versión y sin restablecer."""
    return AceptacionAviso.objects.filter(
        origen=Origen.INTRANET, version=str(aviso.version), restablecida_en__isnull=True
    )


def acepto(usuario, aviso: AvisoPrivacidad | None = None) -> bool:
    aviso = aviso if aviso is not None else aviso_vigente()
    if aviso is None:
        return True
    return _vigentes(aviso).filter(usuario=usuario).exists()


def para_la_sesion(usuario) -> dict:
    """Lo que `GET /auth/me/` dice del consentimiento. Si falta aceptar trae
    el aviso, para que la pantalla salga sin otra consulta."""
    aviso = aviso_vigente()
    if aviso is None or acepto(usuario, aviso):
        return {"pendiente": False}
    return {"pendiente": True, "version": aviso.version, "texto": aviso.texto}


def estado_propio(usuario) -> dict:
    """`GET /privacidad/consentimiento/`: el aviso vigente y lo que aceptó la
    persona (su última aceptación, de cualquier versión)."""
    aviso = aviso_vigente()
    ultima = AceptacionAviso.objects.filter(usuario=usuario).first() if _hay_empresa() else None
    return {
        "exigido": aviso is not None,
        "pendiente": aviso is not None and not acepto(usuario, aviso),
        "version": aviso.version if aviso else None,
        "texto": aviso.texto if aviso else "",
        "ultima_aceptacion": de_aceptacion(ultima, con_texto=False) if ultima else None,
    }


# ── Escritura ─────────────────────────────────────────────────────────────────


def aceptar(*, usuario, version, context=None) -> AceptacionAviso:
    """Registra que la persona acepta el aviso vigente. `version` es la que
    leyó: si entretanto cambió, 409 (tiene que leer la nueva). Idempotente:
    si ya la había aceptado, devuelve esa aceptación."""
    with transaction.atomic():
        aviso = AvisoPrivacidad.objects.select_for_update().first() if _hay_empresa() else None
        if aviso is None:
            raise PrivacidadError(
                "No hay un aviso de privacidad que aceptar.", code="sin_aviso", status=409
            )
        if str(version) != str(aviso.version):
            raise PrivacidadError(
                "El aviso cambió mientras lo leía. Lea la versión nueva y acéptela.",
                code="aviso_cambiado",
                status=409,
                details={"version": aviso.version},
            )
        existente = _vigentes(aviso).filter(usuario=usuario).first()
        if existente is not None:
            return existente
        contexto = context or {}
        aceptacion = AceptacionAviso.objects.create(
            usuario=usuario,
            version=str(aviso.version),
            origen=Origen.INTRANET,
            aceptado_en=timezone.now(),
            ip=contexto.get("ip_address") or None,
            texto=aviso.texto,
        )
    _audit(
        usuario,
        "consentimiento.aceptado",
        aceptacion,
        nuevo={"version": aceptacion.version},
        context=context,
    )
    return aceptacion


def guardar_aviso(*, actor, texto: str, pedir_de_nuevo: bool = False, context=None):
    """Crea o cambia el aviso de la empresa activa (`privacidad.atender`).

    Editar el texto no cambia la versión. `pedir_de_nuevo` la sube: desde ese
    momento nadie lo tiene aceptado y todos lo aceptan al entrar. El primer
    aviso de una empresa nace en la versión 1 (nadie lo tiene aceptado)."""
    _exigir_atender(actor)
    if not _hay_empresa():
        raise PrivacidadError("Elija la empresa del aviso.", code="sin_empresa", status=400)
    texto = (texto or "").strip()
    if not texto:
        raise _invalido("texto", "Escriba el texto del aviso.")
    if len(texto) > AVISO_MAX:
        raise _invalido("texto", f"El aviso admite hasta {AVISO_MAX} caracteres.")

    ahora = timezone.now()
    with transaction.atomic():
        aviso = AvisoPrivacidad.objects.select_for_update().first()
        if aviso is None:
            aviso = AvisoPrivacidad.objects.create(
                texto=texto, version=1, version_desde=ahora, editado_por=actor
            )
            _audit(
                actor,
                "consentimiento.aviso_creado",
                aviso,
                nuevo={"version": 1, "texto": texto},
                context=context,
            )
            return aviso
        previo = {"version": aviso.version, "texto": aviso.texto}
        if texto == aviso.texto and not pedir_de_nuevo:
            return aviso
        aviso.texto = texto
        aviso.editado_por = actor
        if pedir_de_nuevo:
            aviso.version += 1
            aviso.version_desde = ahora
        aviso.save()
    _audit(
        actor,
        "consentimiento.aceptacion_pedida" if pedir_de_nuevo else "consentimiento.aviso_editado",
        aviso,
        previo=previo,
        nuevo={"version": aviso.version, "texto": aviso.texto},
        context=context,
    )
    return aviso


def restablecer(*, actor, usuario_id, context=None) -> int:
    """Deja sin efecto la aceptación vigente de una persona de la empresa: la
    próxima vez que entre vuelve a aceptar. Devuelve cuántas se marcaron (0 si
    no tenía; también queda en la auditoría)."""
    _exigir_atender(actor)
    usuario = personas().filter(pk=usuario_id).first()
    if usuario is None:
        raise PrivacidadError("Persona no encontrada.", code="not_found", status=404)
    marcadas = AceptacionAviso.objects.filter(
        usuario=usuario, origen=Origen.INTRANET, restablecida_en__isnull=True
    ).update(restablecida_en=timezone.now(), restablecida_por=actor)
    _audit(
        actor,
        "consentimiento.restablecido",
        usuario,
        nuevo={"aceptaciones_restablecidas": marcadas},
        context=context,
    )
    return marcadas


def restablecer_todos(*, actor, context=None) -> int:
    """Lo mismo para toda la empresa activa."""
    _exigir_atender(actor)
    if not _hay_empresa():
        raise PrivacidadError("Elija la empresa.", code="sin_empresa", status=400)
    marcadas = AceptacionAviso.objects.filter(
        origen=Origen.INTRANET, restablecida_en__isnull=True
    ).update(restablecida_en=timezone.now(), restablecida_por=actor)
    _audit(
        actor,
        "consentimiento.restablecido_todos",
        empresa_actual(),
        nuevo={"aceptaciones_restablecidas": marcadas},
        context=context,
    )
    return marcadas


# ── Lectura para quien administra ─────────────────────────────────────────────


def _exigir_bandeja(actor):
    if not access.puede_ver_bandeja(actor):
        raise PrivacidadError(
            "No tiene permiso para ver el consentimiento de datos.",
            code="permission_denied",
            status=403,
        )


def _exigir_atender(actor):
    if not access.puede_atender(actor):
        raise PrivacidadError(
            "No tiene permiso para administrar el consentimiento de datos.",
            code="permission_denied",
            status=403,
        )


def personas():
    """Las cuentas activas de la empresa activa."""
    if not _hay_empresa():
        return User.objects.none()
    return User.objects.filter(membresias__empresa=empresa_actual(), is_active=True).distinct()


def _texto_inicial_de_la_empresa() -> str:
    empresa = empresa_actual() if _hay_empresa() else None
    return texto_inicial(getattr(empresa, "nombre", ""))


def resumen_del_aviso(actor) -> dict:
    _exigir_bandeja(actor)
    aviso = aviso_vigente()
    total = personas().count()
    if aviso is None:
        return {
            "existe": False,
            "texto_inicial": _texto_inicial_de_la_empresa(),
            "totales": {"personas": total, "aceptaron": 0, "pendientes": 0},
            "puede_atender": access.puede_atender(actor),
        }
    aceptaron = personas().filter(pk__in=_vigentes(aviso).values("usuario_id")).count()
    return {
        "existe": True,
        "texto": aviso.texto,
        "version": aviso.version,
        "version_desde": aviso.version_desde.isoformat(),
        "editado_por": nombre(aviso.editado_por) or None,
        "actualizado": aviso.updated_at.isoformat(),
        "texto_inicial": _texto_inicial_de_la_empresa(),
        "totales": {"personas": total, "aceptaron": aceptaron, "pendientes": total - aceptaron},
        "puede_atender": access.puede_atender(actor),
    }


def listado(actor, *, q: str = "", estado: str = ""):
    """Las personas de la empresa con su estado frente al aviso vigente."""
    from apps.core.busqueda import condicion_de_busqueda

    _exigir_bandeja(actor)
    aviso = aviso_vigente()
    consulta = personas()
    if aviso is not None:
        consulta = consulta.annotate(
            _acepto=Exists(_vigentes(aviso).filter(usuario=OuterRef("pk")))
        )
        if estado == ACEPTADO:
            consulta = consulta.filter(_acepto=True)
        elif estado == PENDIENTE:
            consulta = consulta.filter(_acepto=False)
    elif estado == ACEPTADO:
        consulta = consulta.none()
    consulta = consulta.annotate(
        _de_nexo=Exists(AceptacionAviso.objects.filter(usuario=OuterRef("pk"), origen=Origen.NEXO))
    )
    condicion = condicion_de_busqueda(q, ("first_name", "last_name", "username", "email"))
    if condicion is not None:
        consulta = consulta.filter(condicion)
    return consulta.order_by("first_name", "last_name", "username"), aviso


def de_persona(usuario, aviso, ultimas: dict) -> dict:
    ultima = ultimas.get(usuario.pk)
    return {
        "id": usuario.pk,
        "nombre": nombre(usuario),
        "usuario": usuario.username,
        "correo": usuario.email,
        "estado": (
            None
            if aviso is None
            else (ACEPTADO if getattr(usuario, "_acepto", False) else PENDIENTE)
        ),
        "aceptacion_de_nexo": bool(getattr(usuario, "_de_nexo", False)),
        "ultima_aceptacion": de_aceptacion(ultima, con_texto=False) if ultima else None,
    }


def ultimas_aceptaciones(ids) -> dict:
    """La última aceptación (de cualquier versión) de cada persona."""
    ultimas = {}
    for aceptacion in AceptacionAviso.objects.filter(usuario_id__in=list(ids)).order_by(
        "usuario_id", "-aceptado_en", "-id"
    ):
        ultimas.setdefault(aceptacion.usuario_id, aceptacion)
    return ultimas


def historial(actor, usuario_id) -> dict:
    """Todas las aceptaciones de una persona en la empresa, con su texto."""
    _exigir_bandeja(actor)
    usuario = personas().filter(pk=usuario_id).first()
    if usuario is None:
        raise PrivacidadError("Persona no encontrada.", code="not_found", status=404)
    aviso = aviso_vigente()
    aceptaciones = AceptacionAviso.objects.filter(usuario=usuario).select_related(
        "restablecida_por"
    )
    return {
        "id": usuario.pk,
        "nombre": nombre(usuario),
        "usuario": usuario.username,
        "correo": usuario.email,
        "estado": None if aviso is None else (ACEPTADO if acepto(usuario, aviso) else PENDIENTE),
        "aceptaciones": [de_aceptacion(a) for a in aceptaciones],
    }


def de_aceptacion(aceptacion: AceptacionAviso, *, con_texto: bool = True) -> dict:
    datos = {
        "id": aceptacion.pk,
        "version": aceptacion.version,
        "origen": aceptacion.origen,
        "origen_label": aceptacion.get_origen_display(),
        "aceptado_en": aceptacion.aceptado_en.isoformat(),
        "ip": aceptacion.ip,
        "restablecida_en": (
            aceptacion.restablecida_en.isoformat() if aceptacion.restablecida_en else None
        ),
    }
    if con_texto:
        datos["texto"] = aceptacion.texto
        datos["restablecida_por"] = nombre(aceptacion.restablecida_por) or None
    return datos
