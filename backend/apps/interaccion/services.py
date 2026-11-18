"""Registro y resumen de la interacción con la plataforma (18/11/2026).

El registro nunca interrumpe una petición: si algo falla, se anota en el log
y la petición sigue. Escribe como mucho una vez por minuto y persona (la
caché lo evita antes de llegar a la base, y el filtro por minuto lo evita
aunque haya varios procesos).
"""

import datetime
import logging

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import Avg, Count, F, Max, Min, Q, Sum
from django.utils import timezone

from .models import ActividadDiaria, UsoFuncionalidad

logger = logging.getLogger(__name__)

#: El id del dashboard en el módulo de Dashboards.
DASHBOARD_ID = "interaccion-plataforma"
#: Sin señales por más de esto, la siguiente conexión cuenta como otro
#: ingreso del día.
PAUSA_INGRESO = datetime.timedelta(minutes=30)
#: Los periodos que se pueden consultar, en días.
PERIODOS = (1, 7, 30, 90)
#: Cuántos días se conservan los registros.
CONSERVAR_DIAS = 400
TOP = 10
MAXIMO_SIN_INGRESO = 300


def _minuto(ahora):
    return ahora.replace(second=0, microsecond=0)


def _una_vez_por_minuto(tipo, usuario_id, ahora) -> bool:
    """True la primera vez en este minuto (por proceso)."""
    return cache.add(f"interaccion:{tipo}:{usuario_id}:{ahora:%Y%m%d%H%M}", 1, 120)


def registrar_conexion(usuario, ahora=None) -> None:
    """Un minuto conectado para `usuario` (lo llama la autenticación en cada
    petición)."""
    try:
        ahora = ahora or timezone.now()
        if not _una_vez_por_minuto("c", usuario.pk, ahora):
            return
        fecha = timezone.localdate(ahora)
        with transaction.atomic():
            registro, creado = ActividadDiaria.objects.get_or_create(
                usuario_id=usuario.pk,
                fecha=fecha,
                defaults={"primera_conexion": ahora, "ultima_senal": ahora},
            )
        if creado or registro.ultima_senal >= _minuto(ahora):
            return
        regreso = ahora - registro.ultima_senal > PAUSA_INGRESO
        ActividadDiaria.objects.filter(pk=registro.pk, ultima_senal__lt=_minuto(ahora)).update(
            minutos_conectado=F("minutos_conectado") + 1,
            ultima_senal=ahora,
            ingresos=F("ingresos") + (1 if regreso else 0),
        )
    except IntegrityError:
        # Otra petición simultánea creó el registro del día: ya contó.
        return
    except Exception:  # noqa: BLE001 - el registro nunca tumba una petición
        logger.exception("No se pudo registrar la conexión de %s", getattr(usuario, "pk", None))


def limpiar_titulo(titulo) -> str:
    """«Organigrama · Intranet LCE» → «Organigrama»."""
    texto = " ".join(str(titulo or "").split())
    texto = texto.split(" · ")[0].strip()
    return texto[:120] or "Sin título"


def registrar_latido(usuario, titulo, ahora=None) -> bool:
    """Un minuto de actividad en la pantalla `titulo`. Devuelve si contó."""
    try:
        ahora = ahora or timezone.now()
        if not _una_vez_por_minuto("l", usuario.pk, ahora):
            return False
        registrar_conexion(usuario, ahora)
        fecha = timezone.localdate(ahora)
        contado = ActividadDiaria.objects.filter(
            Q(ultimo_latido__isnull=True) | Q(ultimo_latido__lt=_minuto(ahora)),
            usuario_id=usuario.pk,
            fecha=fecha,
        ).update(minutos_activo=F("minutos_activo") + 1, ultimo_latido=ahora)
        if not contado:
            return False
        funcionalidad = limpiar_titulo(titulo)
        try:
            with transaction.atomic():
                _, creado = UsoFuncionalidad.objects.get_or_create(
                    usuario_id=usuario.pk, fecha=fecha, funcionalidad=funcionalidad
                )
        except IntegrityError:
            creado = False
        if not creado:
            UsoFuncionalidad.objects.filter(
                usuario_id=usuario.pk, fecha=fecha, funcionalidad=funcionalidad
            ).update(minutos=F("minutos") + 1)
        return True
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo registrar la actividad de %s", getattr(usuario, "pk", None))
        return False


def purgar(ahora=None) -> int:
    """Borra lo que tiene más de `CONSERVAR_DIAS` días."""
    limite = timezone.localdate(ahora or timezone.now()) - datetime.timedelta(days=CONSERVAR_DIAS)
    borrados, _ = ActividadDiaria.objects.filter(fecha__lt=limite).delete()
    otros, _ = UsoFuncionalidad.objects.filter(fecha__lt=limite).delete()
    return borrados + otros


# --- El resumen del dashboard ------------------------------------------------


def _nombre(usuario) -> str:
    return (usuario.get_full_name() or usuario.username or "").strip()


def _redondeo(valor, decimales=1):
    return round(float(valor or 0), decimales)


def _persona_dia(registro):
    if registro is None:
        return None
    return {
        "nombre": _nombre(registro.usuario),
        "fecha": registro.fecha.isoformat(),
        "minutos": registro.minutos_conectado,
    }


def _mensajes_por_dia(desde, hasta) -> dict:
    """`{fecha: mensajes}` del chat, por día local."""
    from apps.chat.models import Mensaje

    zona = timezone.get_current_timezone()
    inicio = timezone.make_aware(datetime.datetime.combine(desde, datetime.time.min), zona)
    fin = timezone.make_aware(
        datetime.datetime.combine(hasta + datetime.timedelta(days=1), datetime.time.min), zona
    )
    conteo: dict = {}
    for creado in Mensaje.objects.filter(
        created_at__gte=inicio, created_at__lt=fin, autor__isnull=False
    ).values_list("created_at", flat=True):
        fecha = timezone.localtime(creado, zona).date()
        conteo[fecha] = conteo.get(fecha, 0) + 1
    return conteo


def _promedio(total, cantidad):
    return _redondeo(total / cantidad) if cantidad else 0


def resumen(dias: int = 7, ahora=None) -> dict:
    from apps.users.models import User

    ahora = ahora or timezone.now()
    dias = dias if dias in PERIODOS else 7
    hasta = timezone.localdate(ahora)
    desde = hasta - datetime.timedelta(days=dias - 1)
    actividad = ActividadDiaria.objects.filter(fecha__gte=desde, fecha__lte=hasta)
    activas = User.objects.filter(status=User.Status.ACTIVE)

    por_dia = {
        fila["fecha"]: fila
        for fila in actividad.values("fecha").annotate(
            personas=Count("usuario", distinct=True),
            conexion=Avg("minutos_conectado"),
            activo=Avg("minutos_activo"),
        )
    }
    mensajes = _mensajes_por_dia(desde, hasta)
    serie = []
    for n in range(dias):
        fecha = desde + datetime.timedelta(days=n)
        fila = por_dia.get(fecha, {})
        serie.append(
            {
                "fecha": fecha.isoformat(),
                "personas": fila.get("personas", 0),
                "mensajes": mensajes.get(fecha, 0),
                "minutos_conexion": _redondeo(fila.get("conexion")),
                "minutos_activo": _redondeo(fila.get("activo")),
            }
        )
    # Los promedios por día cuentan solo los días con alguien conectado: un
    # fin de semana vacío no debe bajar el promedio de un día de trabajo.
    dias_con_actividad = sum(1 for d in serie if d["personas"])
    personas_dia = sum(d["personas"] for d in serie)
    total_mensajes = sum(mensajes.values())
    promedios = actividad.aggregate(conexion=Avg("minutos_conectado"), activo=Avg("minutos_activo"))

    usuarios = {u.pk: u for u in User.objects.filter(pk__in=actividad.values("usuario"))}
    recurrentes = []
    for fila in (
        actividad.values("usuario")
        .annotate(
            ingresos=Sum("ingresos"),
            dias=Count("id"),
            minutos=Sum("minutos_conectado"),
            ultima=Max("ultima_senal"),
        )
        .order_by("-ingresos", "-minutos")[:TOP]
    ):
        usuario = usuarios.get(fila["usuario"])
        if usuario is None:
            continue
        recurrentes.append(
            {
                "nombre": _nombre(usuario),
                "ingresos": fila["ingresos"],
                "dias": fila["dias"],
                "ingresos_por_dia": _promedio(fila["ingresos"], fila["dias"]),
                "minutos": fila["minutos"],
                "ultima": fila["ultima"].isoformat() if fila["ultima"] else None,
            }
        )

    nunca = activas.filter(last_login__isnull=True).order_by("first_name", "last_name", "username")

    funcionalidades = [
        {"nombre": f["funcionalidad"], "minutos": f["minutos"], "personas": f["personas"]}
        for f in UsoFuncionalidad.objects.filter(fecha__gte=desde, fecha__lte=hasta)
        .values("funcionalidad")
        .annotate(minutos=Sum("minutos"), personas=Count("usuario", distinct=True))
        .order_by("-minutos", "funcionalidad")[:25]
    ]

    con_usuario = actividad.select_related("usuario")
    inicio = ActividadDiaria.objects.aggregate(inicio=Min("fecha"))["inicio"]
    return {
        "periodo": {"dias": dias, "desde": desde.isoformat(), "hasta": hasta.isoformat()},
        "registro_desde": inicio.isoformat() if inicio else None,
        "cuentas_activas": activas.count(),
        "dias_con_actividad": dias_con_actividad,
        "personas_promedio_dia": _promedio(personas_dia, dias_con_actividad),
        "personas_hoy": por_dia.get(hasta, {}).get("personas", 0),
        "minutos_activo_promedio": _redondeo(promedios["activo"]),
        "minutos_conexion_promedio": _redondeo(promedios["conexion"]),
        "conexion_maxima": _persona_dia(
            con_usuario.order_by("-minutos_conectado", "fecha").first()
        ),
        "conexion_minima": _persona_dia(con_usuario.order_by("minutos_conectado", "fecha").first()),
        "mensajes": {
            "total": total_mensajes,
            "promedio_dia": _promedio(total_mensajes, dias_con_actividad),
            "promedio_persona_dia": _promedio(total_mensajes, personas_dia),
        },
        "serie": serie,
        "recurrentes": recurrentes,
        "sin_ingreso": {
            "nunca": nunca.count(),
            "en_periodo": activas.exclude(pk__in=actividad.values("usuario")).count(),
            "personas": [
                {
                    "nombre": _nombre(u),
                    "correo": u.email,
                    "creada": (
                        timezone.localtime(u.date_joined).date().isoformat()
                        if u.date_joined
                        else None
                    ),
                }
                for u in nunca[:MAXIMO_SIN_INGRESO]
            ],
        },
        "funcionalidades": funcionalidades,
    }
