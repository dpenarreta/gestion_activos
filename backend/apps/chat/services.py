"""Las reglas del chat: quién está en cada conversación, qué ve y los avisos.

Las membresías se resuelven solas: toda persona de la empresa está en el
canal general, y quien pertenece a un área está en los grupos de esa área.
Se sincronizan cuando la persona abre el chat, no con tareas aparte.
"""

from datetime import timedelta
from pathlib import PurePath

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, F, Q
from django.utils import timezone

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.permissions.authorization import user_has_permission

from .models import Conversacion, Mensaje, Participante

Tipo = Conversacion.Tipo
User = get_user_model()

#: Lo que ve cada quien; con `chat.historial_completo`, lo que se guarda.
MESES_VISIBLES = 6
MESES_GUARDADOS = 12
LARGO_MAXIMO = 4000
EXTENSIONES_DE_IMAGEN = {".jpg", ".jpeg", ".png", ".webp"}


def _empresa():
    actual = empresa_actual()
    if actual in (None, SIN_EMPRESA):
        raise PermissionDenied("Elija una empresa para usar el chat.")
    return actual


def personas_de_la_empresa(empresa=None):
    """Toda cuenta activa con membresía en la empresa, en nómina o no."""
    empresa = empresa or _empresa()
    return User.objects.filter(membresias__empresa=empresa, is_active=True).distinct()


def ventana(usuario):
    """Desde cuándo ve mensajes: 6 meses, o 12 con el historial completo."""
    meses = (
        MESES_GUARDADOS
        if user_has_permission(usuario, "chat.historial_completo")
        else MESES_VISIBLES
    )
    return timezone.now() - timedelta(days=30 * meses)


def nombre(usuario) -> str:
    return (usuario.get_full_name() or usuario.username) if usuario else "Alguien"


# --- Membresías ------------------------------------------------------------------------


def _area_de(usuario):
    empleado = getattr(usuario, "empleado", None)
    return getattr(empleado, "departamento_id", None) if empleado else None


def sincronizar(usuario):
    """Lo pone en el canal general y en los grupos de su área (y lo saca de
    los de un área a la que ya no pertenece)."""
    empresa = _empresa()
    try:
        with transaction.atomic():
            general, _ = Conversacion.objects.get_or_create(
                clave="general", defaults={"tipo": Tipo.GENERAL, "empresa": empresa}
            )
    except IntegrityError:
        general = Conversacion.objects.get(clave="general")
    Participante.objects.get_or_create(conversacion=general, usuario=usuario)

    area = _area_de(usuario)
    propios = Conversacion.objects.filter(tipo=Tipo.AREA, departamento_id=area) if area else []
    for conversacion in propios:
        Participante.objects.get_or_create(conversacion=conversacion, usuario=usuario)
    Participante.objects.filter(
        usuario=usuario, conversacion__tipo=Tipo.AREA, administra=False
    ).exclude(conversacion__departamento_id=area).delete()


def participacion(usuario, conversacion) -> Participante:
    """Su lugar en la conversación; si no está, no la ve."""
    lugar = Participante.objects.filter(conversacion=conversacion, usuario=usuario).first()
    if lugar is None:
        raise PermissionDenied("Usted no está en esta conversación.")
    return lugar


def _sumar_a_todos(general):
    """El canal general es de todas las personas de la empresa, aunque nunca
    hayan abierto el chat: así les llega el aviso del primer mensaje."""
    presentes = set(general.participantes.values_list("usuario_id", flat=True))
    faltan = personas_de_la_empresa().exclude(pk__in=presentes).values_list("pk", flat=True)
    Participante.objects.bulk_create(
        [Participante(conversacion=general, usuario_id=pk) for pk in faltan]
    )


def directa(actor, otro) -> Conversacion:
    """El chat uno a uno con otra persona de la empresa (lo crea si no existe)."""
    if otro.pk == actor.pk:
        raise ValidationError({"usuario": "Elija a otra persona."})
    if not personas_de_la_empresa().filter(pk=otro.pk).exists():
        raise ValidationError({"usuario": "Esa persona no está en esta empresa."})
    menor, mayor = sorted((actor.pk, otro.pk))
    clave = f"d:{menor}-{mayor}"
    try:
        with transaction.atomic():
            conversacion, creada = Conversacion.objects.get_or_create(
                clave=clave, defaults={"tipo": Tipo.DIRECTA, "creada_por": actor}
            )
    except IntegrityError:
        conversacion, creada = Conversacion.objects.get(clave=clave), False
    if creada:
        Participante.objects.create(conversacion=conversacion, usuario=actor)
        Participante.objects.create(conversacion=conversacion, usuario=otro)
    return conversacion


def crear_grupo(actor, *, nombre_grupo, participantes=(), departamento=None) -> Conversacion:
    """Un grupo personalizado (quien lo crea elige a los miembros y lo
    administra) o por área (sus miembros son las personas del área)."""
    nombre_grupo = (nombre_grupo or "").strip()
    if not nombre_grupo:
        raise ValidationError({"nombre": "Póngale un nombre al grupo."})
    with transaction.atomic():
        if departamento is not None:
            if not user_has_permission(actor, "chat.grupos_por_area"):
                raise PermissionDenied("Crear grupos por área es de la administración.")
            conversacion = Conversacion.objects.create(
                tipo=Tipo.AREA,
                nombre=nombre_grupo,
                clave=Conversacion.clave_de_grupo(),
                departamento=departamento,
                creada_por=actor,
            )
            miembros = personas_de_la_empresa().filter(empleado__departamento=departamento)
            for persona in miembros:
                Participante.objects.create(conversacion=conversacion, usuario=persona)
            Participante.objects.get_or_create(
                conversacion=conversacion, usuario=actor, defaults={"administra": True}
            )
            return conversacion
        validos = list(personas_de_la_empresa().filter(pk__in=[p.pk for p in participantes]))
        if not validos:
            raise ValidationError({"participantes": "Elija al menos a una persona."})
        conversacion = Conversacion.objects.create(
            tipo=Tipo.GRUPO,
            nombre=nombre_grupo,
            clave=Conversacion.clave_de_grupo(),
            creada_por=actor,
        )
        Participante.objects.create(conversacion=conversacion, usuario=actor, administra=True)
        for persona in validos:
            if persona.pk != actor.pk:
                Participante.objects.create(conversacion=conversacion, usuario=persona)
    return conversacion


def editar_grupo(actor, conversacion, *, nombre_grupo=None, agregar=(), quitar=()):
    """Quien administra el grupo lo renombra y cambia sus miembros. En un
    grupo por área los miembros los da el área: solo cambia el nombre."""
    if conversacion.tipo not in (Tipo.GRUPO, Tipo.AREA):
        raise ValidationError("Solo los grupos se editan.")
    if not participacion(actor, conversacion).administra:
        raise PermissionDenied("Edita el grupo quien lo administra.")
    with transaction.atomic():
        if nombre_grupo is not None:
            if not nombre_grupo.strip():
                raise ValidationError({"nombre": "Póngale un nombre al grupo."})
            conversacion.nombre = nombre_grupo.strip()[:120]
            conversacion.save(update_fields=["nombre", "updated_at"])
        if conversacion.tipo == Tipo.GRUPO:
            validos = personas_de_la_empresa().filter(pk__in=[p.pk for p in agregar])
            for persona in validos:
                Participante.objects.get_or_create(conversacion=conversacion, usuario=persona)
            conversacion.participantes.filter(
                usuario__in=[p.pk for p in quitar if p.pk != actor.pk]
            ).delete()
    return conversacion


def salir(actor, conversacion):
    if conversacion.tipo != Tipo.GRUPO:
        raise ValidationError(
            "Solo se sale de un grupo personalizado: el canal general, los directos y "
            "los grupos del área son de todos los que corresponden."
        )
    lugar = participacion(actor, conversacion)
    with transaction.atomic():
        lugar.delete()
        # Si se va quien administraba, administra el más antiguo que quede.
        if lugar.administra and not conversacion.participantes.filter(administra=True).exists():
            siguiente = conversacion.participantes.order_by("created_at").first()
            if siguiente:
                siguiente.administra = True
                siguiente.save(update_fields=["administra", "updated_at"])


# --- Mensajes --------------------------------------------------------------------------


def visibles(usuario, conversacion):
    return conversacion.mensajes.filter(created_at__gte=ventana(usuario))


def enviar(actor, conversacion, *, texto="", archivo=None) -> Mensaje:
    participacion(actor, conversacion)
    texto = (texto or "").strip()
    if not texto and archivo is None:
        raise ValidationError({"texto": "Escriba un mensaje o adjunte un archivo."})
    if len(texto) > LARGO_MAXIMO:
        raise ValidationError({"texto": f"Como máximo {LARGO_MAXIMO} caracteres por mensaje."})
    ahora = timezone.now()
    with transaction.atomic():
        if conversacion.tipo == Tipo.GENERAL:
            _sumar_a_todos(conversacion)
        mensaje = Mensaje(conversacion=conversacion, autor=actor, texto=texto)
        if archivo is not None:
            mensaje.archivo = archivo
            mensaje.nombre_archivo = archivo.name[:255]
            mensaje.tamano = archivo.size
            mensaje.es_imagen = PurePath(archivo.name).suffix.lower() in EXTENSIONES_DE_IMAGEN
        mensaje.save()
        Conversacion.objects.filter(pk=conversacion.pk).update(ultimo_mensaje_en=ahora)
        # Lo propio no queda «sin leer».
        Participante.objects.filter(conversacion=conversacion, usuario=actor).update(
            ultimo_leido_id=mensaje.id
        )
    transaction.on_commit(lambda: avisar(mensaje))
    return mensaje


def enlace(conversacion) -> str:
    return f"/admin/chat?c={conversacion.id}"


def titulo_para(conversacion, autor) -> str:
    if conversacion.tipo == Tipo.DIRECTA:
        return f"Mensaje de {nombre(autor)}"
    return f"Mensajes nuevos en {nombre_de(conversacion)}"


def nombre_de(conversacion, para=None) -> str:
    """Cómo se llama la conversación para una persona: en un directo, el
    nombre de la otra."""
    if conversacion.tipo == Tipo.GENERAL:
        return "Canal general"
    if conversacion.tipo == Tipo.DIRECTA and para is not None:
        otro = conversacion.participantes.exclude(usuario=para).select_related("usuario").first()
        return nombre(otro.usuario) if otro else "Mensaje directo"
    return conversacion.nombre or conversacion.get_tipo_display()


def avisar(mensaje):
    """Una notificación por conversación en la campana de cada destinatario:
    si ya tenía una sin leer, se actualiza con el último mensaje (no se apilan
    una por mensaje)."""
    from apps.notificaciones import services as campana
    from apps.notificaciones.models import Notificacion

    conversacion = mensaje.conversacion
    destinatarios = list(
        User.objects.filter(
            participaciones_chat__conversacion=conversacion, is_active=True
        ).exclude(pk=mensaje.autor_id)
    )
    if not destinatarios:
        return
    titulo = titulo_para(conversacion, mensaje.autor)
    resumen = f"{nombre(mensaje.autor)}: " + (
        mensaje.texto[:160] if mensaje.texto else f"envió {mensaje.nombre_archivo}"
    )
    destino = enlace(conversacion)
    pendientes = Notificacion.objects.todas().filter(
        usuario__in=destinatarios, tipo="chat.mensaje", enlace=destino, leida_en__isnull=True
    )
    ya_avisados = set(pendientes.values_list("usuario_id", flat=True))
    pendientes.update(titulo=titulo[:150], resumen=resumen[:300], created_at=timezone.now())
    campana.notificar(
        [u for u in destinatarios if u.pk not in ya_avisados],
        tipo="chat.mensaje",
        titulo=titulo,
        resumen=resumen,
        enlace=destino,
        empresa=conversacion.empresa,
    )


def marcar_leido(usuario, conversacion, hasta_id=None) -> int:
    """Lo leído hasta `hasta_id` (o todo). Apaga también su aviso en la campana."""
    from apps.notificaciones.models import Notificacion

    lugar = participacion(usuario, conversacion)
    ultimo = hasta_id or (
        conversacion.mensajes.order_by("-id").values_list("id", flat=True).first()
    )
    if ultimo and ultimo > lugar.ultimo_leido_id:
        lugar.ultimo_leido_id = ultimo
        lugar.leido_en = timezone.now()
        lugar.save(update_fields=["ultimo_leido_id", "leido_en", "updated_at"])
    if not sin_leer(usuario, conversacion, lugar):
        Notificacion.objects.todas().filter(
            usuario=usuario,
            tipo="chat.mensaje",
            enlace=enlace(conversacion),
            leida_en__isnull=True,
        ).update(leida_en=timezone.now())
    return lugar.ultimo_leido_id


def lecturas(usuario, conversacion) -> list[dict]:
    """Hasta dónde leyó cada una de las demás personas de la conversación y
    cuándo (22/10/2026): con esto se marca cada mensaje propio como enviado o
    leído, y por quién."""
    participacion(usuario, conversacion)
    return [
        {
            "id": p.usuario_id,
            "nombre": nombre(p.usuario),
            "ultimo_leido": p.ultimo_leido_id,
            "leido_en": p.leido_en,
        }
        for p in conversacion.participantes.exclude(usuario=usuario).select_related("usuario")
    ]


def sin_leer(usuario, conversacion, lugar=None) -> int:
    lugar = lugar or participacion(usuario, conversacion)
    return (
        visibles(usuario, conversacion)
        .filter(id__gt=lugar.ultimo_leido_id)
        .exclude(autor=usuario)
        .count()
    )


def conteo_sin_leer(usuario) -> dict:
    """{conversación: mensajes sin leer} en una sola consulta."""
    # En un solo filter(): así la condición sobre «lo leído» usa la fila del
    # mismo participante, no la de cualquiera de la conversación.
    filas = (
        Mensaje.objects.filter(
            conversacion__participantes__usuario=usuario,
            id__gt=F("conversacion__participantes__ultimo_leido_id"),
            created_at__gte=ventana(usuario),
        )
        .exclude(autor=usuario)
        .values("conversacion_id")
        .annotate(total=Count("id"))
    )
    return {fila["conversacion_id"]: fila["total"] for fila in filas}


def novedades(usuario, desde_id: int, limite=200):
    """Los mensajes nuevos de sus conversaciones después de `desde_id`."""
    return (
        Mensaje.objects.filter(
            conversacion__participantes__usuario=usuario,
            id__gt=desde_id,
            created_at__gte=ventana(usuario),
        )
        .select_related("autor", "conversacion")
        .order_by("id")[:limite]
    )


def cursor_actual(usuario) -> int:
    ultimo = (
        Mensaje.objects.filter(conversacion__participantes__usuario=usuario)
        .order_by("-id")
        .values_list("id", flat=True)
        .first()
    )
    return ultimo or 0


def buscar_personas(texto="", limite=30):
    personas = personas_de_la_empresa().select_related("empleado__departamento")
    texto = (texto or "").strip()
    if texto:
        personas = personas.filter(
            Q(first_name__icontains=texto)
            | Q(last_name__icontains=texto)
            | Q(username__icontains=texto)
            | Q(email__icontains=texto)
        )
    return personas.order_by("first_name", "last_name", "username")[:limite]


# --- Retención -------------------------------------------------------------------------


def limpiar(ahora=None) -> int:
    """Borra lo que pasó los 12 meses, con sus archivos."""
    limite = (ahora or timezone.now()) - timedelta(days=30 * MESES_GUARDADOS)
    viejos = Mensaje.objects.todas().filter(created_at__lt=limite)
    for mensaje in viejos.exclude(archivo="").exclude(archivo__isnull=True).only("archivo"):
        mensaje.archivo.delete(save=False)
    borrados, _ = viejos.delete()
    return borrados
