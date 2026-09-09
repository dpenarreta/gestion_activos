"""Las siete alertas del §19, cada una como una regla independiente.

Todas se calculan al vuelo y devuelven el total más una muestra corta. El
detalle completo no viaja en esta respuesta a propósito: el centro de alertas
responde «cuántos y de qué tipo», y cada tarjeta enlaza al listado ya filtrado
donde el usuario puede trabajar con ellos. Devolver 800 activos dentro del
resumen haría lenta la pantalla que debería ser la más rápida del sistema.
"""

from dataclasses import dataclass, field
from datetime import timedelta

from django.utils import timezone

from apps.activos.models import DIAS_AVISO_GARANTIA, ESTADOS_EN_ALMACEN, Activo
from apps.mantenimientos.models import Mantenimiento
from apps.politicas.models import NivelRenovacion
from apps.politicas.services import candidatos_a_renovacion, evaluar_lote

#: Cuántos elementos acompañan a cada alerta. Suficientes para reconocer de
#: qué se trata sin abrir el listado, pocos para no convertir el resumen en
#: un volcado del inventario.
TAMANO_MUESTRA = 5


class Severidad:
    ALTA = "alta"
    MEDIA = "media"
    BAJA = "baja"


@dataclass
class Alerta:
    tipo: str
    titulo: str
    severidad: str
    total: int
    detalle: str
    destino: str
    muestra: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "tipo": self.tipo,
            "titulo": self.titulo,
            "severidad": self.severidad,
            "total": self.total,
            "detalle": self.detalle,
            "destino": self.destino,
            "muestra": self.muestra,
        }


def _fila_activo(activo, dato: str, clave: str | None = None) -> dict:
    """Una línea de la muestra.

    `clave` identifica la fila cuando un mismo activo aparece más de una vez
    en la misma alerta —dos reparaciones abiertas, por ejemplo—; `id` sigue
    siendo el del activo, porque es adonde lleva el enlace.
    """
    return {
        "clave": clave or f"activo-{activo.id}",
        "id": activo.id,
        "codigo_barras": activo.codigo_barras,
        "nombre": activo.nombre,
        "dato": dato,
    }


def _activos_operativos():
    """Parque vivo. Un equipo que salió del inventario —de baja, perdido o
    robado— no genera alertas: no hay nada que nadie pueda resolver sobre él,
    y aparecería cada día en la pantalla como pendiente eterno."""
    return Activo.objects.operativos()


# --- Reglas ----------------------------------------------------------------


def proximos_a_reemplazo(veredictos) -> Alerta:
    """Equipos que superan los umbrales de su política de renovación."""
    afectados = [
        (activo, resultado) for activo, resultado in veredictos if resultado.requiere_renovacion
    ]
    recomendados = [
        (activo, r) for activo, r in afectados if r.nivel == NivelRenovacion.RECOMENDADO
    ]

    # La severidad sube solo si hay alguno en el nivel alto: un parque con
    # equipos «a evaluar» no está en la misma situación que uno con equipos
    # que ya deberían haberse reemplazado.
    severidad = Severidad.ALTA if recomendados else Severidad.MEDIA
    detalle = (
        f"{len(recomendados)} con reemplazo recomendado y "
        f"{len(afectados) - len(recomendados)} a evaluar."
    )
    # Los recomendados encabezan la muestra, y el resto la completa sin
    # repetirlos: verlos dos veces haría dudar de si son dos equipos distintos.
    a_evaluar = [(a, r) for a, r in afectados if r.nivel != NivelRenovacion.RECOMENDADO]
    muestra = [
        _fila_activo(activo, f"{activo.antiguedad_meses} meses · {resultado.nivel_display}")
        for activo, resultado in (recomendados + a_evaluar)[:TAMANO_MUESTRA]
    ]

    return Alerta(
        tipo="proximos_a_reemplazo",
        titulo="Equipos próximos a reemplazo",
        severidad=severidad,
        total=len(afectados),
        detalle=detalle,
        destino="/admin/renovacion/sugerencias",
        muestra=muestra,
    )


def demasiadas_reparaciones(veredictos) -> Alerta:
    """Equipos que exceden el umbral de intervenciones de su política.

    Se separa de la alerta anterior aunque comparta el motor: son acciones
    distintas. Un equipo viejo se reemplaza; uno que falla mucho puede tener
    un problema concreto que conviene diagnosticar antes de gastar en otro.
    """
    afectados = [
        (activo, motivo)
        for activo, resultado in veredictos
        for motivo in resultado.motivos
        if motivo["criterio"] == "mantenimientos"
    ]
    muestra = [
        _fila_activo(activo, motivo["detalle"]) for activo, motivo in afectados[:TAMANO_MUESTRA]
    ]

    return Alerta(
        tipo="demasiadas_reparaciones",
        titulo="Equipos con demasiadas reparaciones",
        severidad=Severidad.MEDIA,
        total=len(afectados),
        detalle="Superan el número de intervenciones que tolera su política.",
        destino="/admin/renovacion/sugerencias",
        muestra=muestra,
    )


def garantias_por_vencer() -> Alerta:
    """Coberturas que expiran dentro de la ventana de aviso.

    Es la alerta con fecha límite real del conjunto: pasada la fecha ya no hay
    nada que reclamarle al proveedor, así que se marca como alta.
    """
    hoy = timezone.localdate()
    limite = hoy + timedelta(days=DIAS_AVISO_GARANTIA)
    consulta = (
        _activos_operativos()
        .filter(fecha_fin_garantia__gte=hoy, fecha_fin_garantia__lte=limite)
        .order_by("fecha_fin_garantia")
    )
    total = consulta.count()
    muestra = [
        _fila_activo(activo, f"vence en {activo.dias_para_fin_de_garantia} día(s)")
        for activo in consulta[:TAMANO_MUESTRA]
    ]

    return Alerta(
        tipo="garantias_por_vencer",
        titulo="Garantías próximas a vencer",
        severidad=Severidad.ALTA if total else Severidad.BAJA,
        total=total,
        detalle=f"Vencen dentro de los próximos {DIAS_AVISO_GARANTIA} días.",
        destino="/admin/activos?garantia=por_vencer",
        muestra=muestra,
    )


def sin_asignar(dias: int) -> Alerta:
    """Equipos parados en bodega. Capital inmovilizado, no una urgencia."""
    limite = timezone.now() - timedelta(days=dias)
    consulta = Activo.objects.filter(estado__in=ESTADOS_EN_ALMACEN, updated_at__lt=limite).order_by(
        "updated_at"
    )
    total = consulta.count()
    muestra = [_fila_activo(activo, "en bodega") for activo in consulta[:TAMANO_MUESTRA]]

    return Alerta(
        tipo="sin_asignar",
        titulo="Activos sin asignar",
        severidad=Severidad.BAJA,
        total=total,
        detalle=f"Llevan más de {dias} días en bodega sin asignarse.",
        destino="/admin/activos?almacenados=true",
        muestra=muestra,
    )


def reparaciones_pendientes(dias: int) -> Alerta:
    """Intervenciones abiertas desde hace demasiado.

    Sin fecha de salida el equipo sigue fuera de operación; pasado el umbral,
    o la reparación se atascó o alguien olvidó cerrarla. Ambas cosas hay que
    mirarlas, y ninguna se ve en la bitácora ordenada por fecha.
    """
    limite = timezone.localdate() - timedelta(days=dias)
    consulta = (
        Mantenimiento.objects.filter(fecha_salida__isnull=True, fecha_intervencion__lt=limite)
        .select_related("activo")
        .order_by("fecha_intervencion")
    )
    total = consulta.count()
    hoy = timezone.localdate()
    muestra = [
        _fila_activo(
            mantenimiento.activo,
            f"{(hoy - mantenimiento.fecha_intervencion).days} día(s) en reparación",
            clave=f"mantenimiento-{mantenimiento.id}",
        )
        for mantenimiento in consulta[:TAMANO_MUESTRA]
    ]

    return Alerta(
        tipo="reparaciones_pendientes",
        titulo="Reparaciones sin cerrar",
        severidad=Severidad.ALTA if total else Severidad.BAJA,
        total=total,
        detalle=f"Ingresaron hace más de {dias} días y no tienen fecha de salida.",
        destino="/admin/mantenimientos?pendientes=true",
        muestra=muestra,
    )


def custodios_inactivos() -> Alerta:
    """Equipos a cargo de alguien que ya no está activo.

    Es la alerta de mayor riesgo del conjunto: un equipo cuyo responsable dejó
    la empresa no tiene, en la práctica, responsable. Si se pierde, nadie
    responde por él.
    """
    consulta = (
        _activos_operativos()
        .filter(custodio__isnull=False, custodio__activo=False)
        .select_related("custodio")
        .order_by("custodio__apellidos")
    )
    total = consulta.count()
    muestra = [
        _fila_activo(activo, f"a cargo de {activo.custodio.nombre_completo} (inactivo)")
        for activo in consulta[:TAMANO_MUESTRA]
    ]

    return Alerta(
        tipo="custodios_inactivos",
        titulo="Equipos con custodio inactivo",
        severidad=Severidad.ALTA if total else Severidad.BAJA,
        total=total,
        detalle="Su responsable figura como inactivo en la organización.",
        destino="/admin/activos?custodio_inactivo=true",
        muestra=muestra,
    )


def sin_actualizacion(dias: int) -> Alerta:
    """Fichas que nadie ha tocado en mucho tiempo.

    No dice que el dato esté mal, dice que nadie lo ha confirmado: es el aviso
    de que conviene un inventario físico de esa parte del parque.
    """
    limite = timezone.now() - timedelta(days=dias)
    consulta = _activos_operativos().filter(updated_at__lt=limite).order_by("updated_at")
    total = consulta.count()
    muestra = [
        _fila_activo(activo, f"sin cambios desde {activo.updated_at.date().isoformat()}")
        for activo in consulta[:TAMANO_MUESTRA]
    ]

    return Alerta(
        tipo="sin_actualizacion",
        titulo="Fichas sin actualizar",
        severidad=Severidad.BAJA,
        total=total,
        detalle=f"Llevan más de {dias} días sin ningún cambio registrado.",
        destino=f"/admin/activos?sin_actualizar_dias={dias}",
        muestra=muestra,
    )


def construir_alertas(configuracion) -> list[Alerta]:
    """Evalúa las reglas encendidas y devuelve las que tienen algo que decir.

    Las que dan cero no se descartan aquí: el centro de alertas necesita poder
    mostrar «revisado, nada pendiente» y distinguirlo de «esta alerta está
    apagada», que son cosas distintas.
    """
    alertas: list[Alerta] = []

    # Las dos reglas que dependen de las políticas comparten una sola pasada
    # por el parque: son el cálculo más caro de esta pantalla.
    necesita_veredictos = (
        configuracion.avisar_proximos_a_reemplazo or configuracion.avisar_demasiadas_reparaciones
    )
    veredictos = []
    if necesita_veredictos:
        # Prefiltro en SQL antes de evaluar: las dos reglas que dependen de
        # las políticas solo miran a los que superan algún umbral, y traer el
        # parque completo para descartar el 95 % costaba más de un segundo.
        candidatos, politicas = candidatos_a_renovacion(
            _activos_operativos().select_related("tipo")
        )
        veredictos = evaluar_lote(candidatos, politicas)

    if configuracion.avisar_proximos_a_reemplazo:
        alertas.append(proximos_a_reemplazo(veredictos))
    if configuracion.avisar_demasiadas_reparaciones:
        alertas.append(demasiadas_reparaciones(veredictos))
    if configuracion.avisar_garantias_por_vencer:
        alertas.append(garantias_por_vencer())
    if configuracion.avisar_reparaciones_pendientes:
        alertas.append(reparaciones_pendientes(configuracion.dias_reparacion_pendiente))
    if configuracion.avisar_custodios_inactivos:
        alertas.append(custodios_inactivos())
    if configuracion.avisar_sin_asignar:
        alertas.append(sin_asignar(configuracion.dias_sin_asignar))
    if configuracion.avisar_sin_actualizacion:
        alertas.append(sin_actualizacion(configuracion.dias_sin_actualizacion))

    return alertas
