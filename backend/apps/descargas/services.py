"""Las reglas del registro de descargas (ver `models`).

- **Registrar** (`registrar`): el navegador avisa cada vez que la persona
  guarda un archivo, y manda el archivo. Aquí se calcula su huella, se coteja
  con lo que el servidor le entregó en las últimas horas (`ArchivoServido`) y
  se guarda la copia. Quién, la IP, la fecha y la hora salen de la petición,
  nunca de lo que diga la pantalla.
- **Sin copia** solo cuando lo dice el servidor (la vista que lo entregó lo
  marcó así: los roles de pagos), no la pantalla; o si el archivo pasa de
  `TAMANO_COPIA`.
- **Ver** el registro y las copias pide `auditoria.descargas`.
- **Resumen diario**: desde las 07:00, una notificación a quienes tienen ese
  permiso con lo descargado el día anterior.
- Las copias se borran un año después de la última vez que alguien descargó
  ese archivo; el registro queda.
"""

import hashlib
from datetime import datetime, time, timedelta

from django.core.files.base import File
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied

from apps.permissions.authorization import user_has_permission

from .models import ArchivoServido, CopiaArchivo, Descarga, ResumenDescargas

PERMISO = "auditoria.descargas"
#: Hasta cuánto se copia (lo que acepta IIS es 50 MB por petición).
TAMANO_COPIA = 45 * 1024 * 1024
#: Cuánto atrás se busca lo que entregó el servidor para cotejarlo.
VENTANA_COTEJO = timedelta(hours=12)
DIAS_SERVIDOS = 2
DIAS_COPIAS = 365
HORA_RESUMEN = 7
GRANDE = "Demasiado grande para guardar una copia"

#: El nombre de cada parte del sistema, por el primer tramo de la ruta de la
#: API (`/api/v1/<tramo>/`) o de la pantalla (`/admin/<tramo>/`).
MODULOS = {
    "activos": "Gestión de Activos",
    "adjuntos": "Gestión de Activos",
    "solicitudes": "Gestión de Activos · Solicitudes",
    "mantenimientos": "Gestión de Activos · Mantenimientos",
    "nomina": "Rol de pagos",
    "licencias": "Solicitud de permisos",
    "proyectos": "Solicitud de proyectos",
    "capacitacion": "Onboarding y capacitación",
    "sugerencias": "Sugerencias y errores",
    "soporte": "Mesa de ayuda",
    "ayuda": "Mesa de ayuda",
    "matriz": "Matriz de obligaciones",
    "ordenes": "Órdenes de trabajo",
    "cartera": "Dashboards",
    "dashboards": "Dashboards",
    "chat": "Chat",
    "reportes": "Reportes",
    "auditoria": "Auditoría",
    "organizacion": "Organización",
    "institucional": "Institucional",
    "catalogos": "Configuración · Catálogos",
    "configuracion": "Configuración",
    "descargas": "Auditoría · Descargas",
}
#: Pantallas de Institucional con su propio nombre.
INSTITUCIONAL = {"rol-pagos": "nomina", "permisos": "licencias", "proyectos": "proyectos"}


def puede_ver(usuario) -> bool:
    return user_has_permission(usuario, PERMISO)


def _exigir(usuario):
    if not puede_ver(usuario):
        raise PermissionDenied(f"No tiene el permiso requerido: {PERMISO}.")


def _tramo(ruta: str, prefijo: str) -> str:
    if not (ruta or "").startswith(prefijo):
        return ""
    return ruta[len(prefijo) :].split("/", 1)[0].split("?", 1)[0]


def modulo_de(origen: str, pantalla: str) -> str:
    """El nombre de la parte del sistema: la de la API que lo entregó y, si
    no se sabe, la de la pantalla."""
    tramo = _tramo(origen, "/api/v1/")
    if tramo == "audit":
        tramo = "auditoria"
    if tramo not in MODULOS:
        tramo = _tramo(pantalla, "/admin/") or tramo
        if tramo == "institucional":
            tramo = INSTITUCIONAL.get(_tramo(pantalla, "/admin/institucional/"), tramo)
    return MODULOS.get(tramo, tramo.capitalize() if tramo else "Sistema")[:60]


def _huella(archivo) -> str:
    huella = hashlib.sha256()
    for parte in archivo.chunks():
        huella.update(parte)
    archivo.seek(0)
    return huella.hexdigest()


def _servido(usuario, huella: str, tamano: int, nombre: str):
    """Lo último que el servidor le entregó a esa persona con esa huella (o,
    sin archivo, con ese tamaño)."""
    recientes = ArchivoServido.objects.filter(
        usuario=usuario, creado__gte=timezone.now() - VENTANA_COTEJO
    )
    if huella:
        return recientes.filter(sha256=huella).first()
    if not tamano:
        return None
    return (
        recientes.filter(tamano=tamano, nombre=nombre).first()
        or recientes.filter(tamano=tamano).first()
    )


def _copiar(archivo, huella: str, nombre: str) -> CopiaArchivo:
    """La copia, una por huella: si ya existe, solo se renueva su fecha."""
    ahora = timezone.now()
    copia = CopiaArchivo.objects.filter(sha256=huella).first()
    if copia is not None:
        copia.ultima_vez = ahora
        copia.save(update_fields=["ultima_vez", "updated_at"])
        return copia
    copia = CopiaArchivo(sha256=huella, tamano=archivo.size, ultima_vez=ahora)
    copia.archivo.save(nombre or "archivo", File(archivo), save=False)
    copia.save()
    return copia


def registrar(
    usuario,
    *,
    nombre,
    archivo=None,
    tamano=0,
    content_type="",
    pantalla="",
    ip=None,
    navegador="",
) -> Descarga:
    nombre = (nombre or "").strip()[:255] or "archivo"
    huella = _huella(archivo) if archivo is not None else ""
    tamano = archivo.size if archivo is not None else max(int(tamano or 0), 0)
    servido = _servido(usuario, huella, tamano, nombre)
    referencia = dict(servido.referencia) if servido else {}
    sin_copia = str(referencia.pop("sin_copia", "") or "")
    copia = None
    if not sin_copia:
        if archivo is None or archivo.size > TAMANO_COPIA:
            sin_copia = GRANDE
        else:
            copia = _copiar(archivo, huella, nombre)
    origen = servido.ruta if servido else ""
    return Descarga.objects.create(
        usuario=usuario,
        nombre=nombre,
        content_type=(content_type or (servido.content_type if servido else ""))[:120],
        tamano=tamano,
        sha256=huella or (servido.sha256 if servido else ""),
        ip=ip,
        navegador=(navegador or "")[:300],
        pantalla=(pantalla or "")[:300],
        modulo=modulo_de(origen, pantalla or ""),
        origen=origen,
        verificada=servido is not None,
        copia=copia,
        sin_copia=sin_copia[:120],
        referencia=referencia,
    )


# --- El reporte ---------------------------------------------------------------------------


def _nombre(usuario) -> str:
    return (usuario.get_full_name() or "").strip() or usuario.username


def _momento(fecha) -> dict:
    local = timezone.localtime(fecha)
    return {
        "fecha_hora": fecha,
        "fecha": local.strftime("%d/%m/%Y"),
        "hora": local.strftime("%H:%M:%S"),
    }


def fila(d: Descarga) -> dict:
    return {
        "id": d.id,
        "momento": _momento(d.created_at),
        "usuario": {"id": d.usuario_id, "nombre": _nombre(d.usuario), "correo": d.usuario.email},
        "nombre": d.nombre,
        "content_type": d.content_type,
        "tamano": d.tamano,
        "sha256": d.sha256,
        "ip": d.ip,
        "navegador": d.navegador,
        "pantalla": d.pantalla,
        "modulo": d.modulo,
        "origen": d.origen,
        "verificada": d.verificada,
        "tiene_copia": bool(d.copia_id),
        "sin_copia": d.sin_copia,
        "referencia": d.referencia,
    }


def _dia(texto, fin=False):
    try:
        fecha = datetime.strptime(texto or "", "%Y-%m-%d").date()
    except ValueError:
        return None
    return timezone.make_aware(datetime.combine(fecha, time.max if fin else time.min))


def consulta(actor, *, q="", desde="", hasta="", modulo="", usuario=None):
    """Las descargas, lo más reciente primero, con los filtros del reporte."""
    _exigir(actor)
    descargas = Descarga.objects.select_related("usuario")
    q = (q or "").strip()
    if q:
        descargas = descargas.filter(
            Q(usuario__first_name__icontains=q)
            | Q(usuario__last_name__icontains=q)
            | Q(usuario__email__icontains=q)
            | Q(usuario__username__icontains=q)
            | Q(nombre__icontains=q)
            | Q(ip__icontains=q)
        )
    inicio = _dia(desde)
    if inicio is not None:
        descargas = descargas.filter(created_at__gte=inicio)
    fin = _dia(hasta, fin=True)
    if fin is not None:
        descargas = descargas.filter(created_at__lte=fin)
    if modulo:
        descargas = descargas.filter(modulo=modulo)
    if usuario:
        descargas = descargas.filter(usuario_id=usuario)
    return descargas


def modulos(actor) -> list[str]:
    _exigir(actor)
    return sorted(set(Descarga.objects.exclude(modulo="").values_list("modulo", flat=True)))


def copia_de(actor, descarga_id) -> Descarga:
    _exigir(actor)
    descarga = Descarga.objects.select_related("copia").filter(pk=descarga_id).first()
    if descarga is None or descarga.copia is None:
        raise NotFound("Esa descarga no tiene copia guardada.")
    return descarga


# --- Resumen diario y limpieza ------------------------------------------------------------


def _destinatarios():
    from apps.chat.services import personas_de_la_empresa

    return [u for u in personas_de_la_empresa() if puede_ver(u)]


def _quien(fila_) -> str:
    nombre = f"{fila_['usuario__first_name']} {fila_['usuario__last_name']}".strip()
    return f"{nombre or fila_['usuario__username']} ({fila_['n']})"


def resumen_diario(ahora=None) -> int:
    """Desde las 07:00, una vez por día y empresa: a quienes tienen
    `auditoria.descargas`, cuántas descargas hubo ayer y de quiénes. Lo corre
    la tarea de cada 5 minutos. Devuelve cuántas notificaciones dejó."""
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa
    from apps.notificaciones.services import notificar

    ahora = timezone.localtime(ahora or timezone.now())
    if ahora.hour < HORA_RESUMEN:
        return 0
    ayer = ahora.date() - timedelta(days=1)
    enviadas = 0
    for empresa in Empresa.objects.all():
        with usando_empresa(empresa):
            if ResumenDescargas.objects.filter(fecha=ayer).exists():
                continue
            del_dia = Descarga.objects.filter(
                created_at__gte=timezone.make_aware(datetime.combine(ayer, time.min)),
                created_at__lte=timezone.make_aware(datetime.combine(ayer, time.max)),
            )
            total = del_dia.count()
            ResumenDescargas.objects.create(fecha=ayer, total=total)
            if not total:
                continue
            personas = list(
                del_dia.values("usuario__first_name", "usuario__last_name", "usuario__username")
                .annotate(n=Count("id"))
                .order_by("-n")
            )
            dia = ayer.isoformat()
            enviadas += notificar(
                _destinatarios(),
                tipo="descargas.resumen_diario",
                titulo=f"Descargas del {ayer:%d/%m/%Y}: {total}",
                resumen=(
                    f"{len(personas)} persona(s). Más descargas: "
                    + ", ".join(_quien(p) for p in personas[:3])
                    + "."
                ),
                enlace=f"/admin/auditoria?modulo=descargas&desde={dia}&hasta={dia}",
            )
    return enviadas


def limpiar(ahora=None) -> dict:
    """Borra lo servido de hace más de dos días y las copias que nadie
    descargó en un año (el registro de la descarga queda, sin copia)."""
    ahora = ahora or timezone.now()
    servidos, _ = ArchivoServido.objects.filter(
        creado__lt=ahora - timedelta(days=DIAS_SERVIDOS)
    ).delete()
    copias = 0
    for copia in CopiaArchivo.objects.filter(ultima_vez__lt=ahora - timedelta(days=DIAS_COPIAS)):
        Descarga.objects.todas().filter(copia=copia).update(
            copia=None, sin_copia="La copia se borró al cumplir un año"
        )
        copia.archivo.delete(save=False)
        copia.delete()
        copias += 1
    return {"servidos": servidos, "copias": copias}
