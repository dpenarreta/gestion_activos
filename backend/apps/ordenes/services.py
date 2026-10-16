"""Las reglas de una orden de trabajo: quién la ve, quién la mueve y a dónde.

Viven aquí y no en la vista porque son del negocio: el técnico mueve lo que
tiene asignado y no lo ajeno, quien responde por la sede acepta el trabajo de
su sede y no el de otra, y cada paso deja dicho quién lo dio. La vista solo
traduce a HTTP lo que esto decide.

Alcance (lo que pinta el mockup como «perfiles»): sin `ordenes.ver_todas`, una
persona ve las órdenes que solicitó, las que tiene asignadas y las de las
sedes que tiene a su cargo (`Sede.responsables`).
"""

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Max, Q
from django.utils import timezone

from apps.permissions.authorization import user_has_permission

from .models import ManoDeObraOrden, MaterialOrden, MovimientoOrden, OrdenTrabajo

Estado = OrdenTrabajo.Estado


def tiene(usuario, permiso: str) -> bool:
    return user_has_permission(usuario, f"ordenes.{permiso}")


def visibles(usuario):
    """Las órdenes que esta persona puede ver en la empresa activa."""
    queryset = OrdenTrabajo.objects.all()
    if tiene(usuario, "ver_todas"):
        return queryset
    return queryset.filter(
        Q(solicitante=usuario) | Q(tecnico=usuario) | Q(sede__responsables=usuario)
    ).distinct()


def es_gestor(usuario) -> bool:
    return tiene(usuario, "gestionar")


def puede_ejecutarla(usuario, orden: OrdenTrabajo) -> bool:
    """Quien coordina, o el técnico asignado con permiso de ejecutar."""
    if es_gestor(usuario):
        return True
    return orden.tecnico_id == usuario.id and tiene(usuario, "ejecutar")


def responde_por_la_sede(usuario, orden: OrdenTrabajo) -> bool:
    return orden.sede.responsables.filter(pk=usuario.pk).exists()


def puede_aceptarla(usuario, orden: OrdenTrabajo) -> bool:
    """Quien coordina, o quien responde por la sede con permiso de aceptar."""
    if es_gestor(usuario):
        return True
    return tiene(usuario, "aceptar") and responde_por_la_sede(usuario, orden)


def puede_editarla(usuario, orden: OrdenTrabajo) -> bool:
    """Corregir los datos: quien coordina mientras esté abierta; quien la
    pidió, solo mientras nadie la haya tomado."""
    if orden.esta_cerrada:
        return False
    if es_gestor(usuario):
        return True
    return orden.solicitante_id == usuario.id and orden.estado == Estado.SOLICITADA


def puede_registrar_costos(usuario, orden: OrdenTrabajo) -> bool:
    return not orden.esta_cerrada and puede_ejecutarla(usuario, orden)


def acciones_disponibles(usuario, orden: OrdenTrabajo) -> list[str]:
    """Los estados a los que esta persona puede llevar la orden ahora mismo.

    La pantalla pinta un botón por cada uno: ofrecer un paso que el servidor
    va a rechazar hace parecer roto el sistema.
    """
    posibles = []
    for destino in OrdenTrabajo.TRANSICIONES.get(orden.estado, set()):
        if destino == Estado.ASIGNADA:
            continue  # se llega asignando (`asignar`), no con un botón de estado
        if _puede_llevarla(usuario, orden, destino):
            posibles.append(destino)
    orden_logico = list(Estado.values)
    return sorted(posibles, key=orden_logico.index)


def _puede_llevarla(usuario, orden, destino) -> bool:
    if destino == Estado.CERRADA:
        return puede_aceptarla(usuario, orden)
    if destino == Estado.EN_EJECUCION and orden.estado == Estado.PENDIENTE_APROBACION:
        return puede_aceptarla(usuario, orden)  # devolver a ejecución
    return puede_ejecutarla(usuario, orden)


def _nombre(usuario) -> str:
    return (usuario.get_full_name() or usuario.username) if usuario else "—"


def _movimiento(orden, actor, descripcion, *, anterior="", nuevo="", nota=""):
    MovimientoOrden.objects.create(
        orden=orden,
        actor=actor,
        descripcion=descripcion[:255],
        estado_anterior=anterior,
        estado_nuevo=nuevo,
        nota=nota,
    )


class OrdenService:
    @staticmethod
    def crear(*, actor, **datos) -> OrdenTrabajo:
        """Registra la orden con el siguiente número del año en la empresa.

        Dos altas a la vez pueden calcular el mismo número: la restricción
        única lo impide y se reintenta con el siguiente.
        """
        anio = timezone.localdate().year
        for _intento in range(5):
            try:
                with transaction.atomic():
                    ultimo = (
                        OrdenTrabajo.objects.filter(anio=anio).aggregate(m=Max("secuencia"))["m"]
                        or 0
                    )
                    orden = OrdenTrabajo(
                        solicitante=actor, anio=anio, secuencia=ultimo + 1, **datos
                    )
                    orden.save()
                    _movimiento(
                        orden, actor, f"Solicitó la orden {orden.numero}", nuevo=orden.estado
                    )
                    return orden
            except IntegrityError:
                continue
        raise ValidationError("No se pudo numerar la orden; inténtelo de nuevo.")

    @staticmethod
    @transaction.atomic
    def asignar(
        *, orden, actor, tecnico, proveedor=None, fecha_programada=None, nota=""
    ) -> OrdenTrabajo:
        """Asigna (o reasigna) quién ejecuta y, si se sabe, para cuándo."""
        if not es_gestor(actor):
            raise PermissionDenied("Las órdenes las asigna quien coordina el mantenimiento.")
        if orden.esta_cerrada:
            raise ValidationError({"estado": "La orden está cerrada: ya no se reasigna."})
        if orden.estado not in {
            Estado.SOLICITADA,
            Estado.ASIGNADA,
            Estado.PROGRAMADA,
            Estado.PAUSADA,
        }:
            raise ValidationError(
                {
                    "estado": f"Una orden {orden.get_estado_display().lower()} no se reasigna; páusela antes."
                }
            )
        if tecnico is None:
            raise ValidationError({"tecnico": "Elija quién ejecuta la orden."})

        anterior = orden.estado
        orden.tecnico = tecnico
        orden.proveedor = proveedor
        if fecha_programada:
            orden.fecha_programada = fecha_programada
        if orden.estado == Estado.SOLICITADA:
            orden.estado = Estado.PROGRAMADA if orden.fecha_programada else Estado.ASIGNADA
        elif orden.estado == Estado.ASIGNADA and orden.fecha_programada:
            orden.estado = Estado.PROGRAMADA
        orden.save()

        quien = _nombre(tecnico) + (f" ({proveedor.nombre})" if proveedor else "")
        texto = f"Asignó {orden.numero} a {quien}"
        if orden.fecha_programada:
            texto += f" para el {orden.fecha_programada:%Y-%m-%d}"
        _movimiento(
            orden,
            actor,
            texto,
            anterior=anterior if anterior != orden.estado else "",
            nuevo=orden.estado if anterior != orden.estado else "",
            nota=nota,
        )
        return orden

    @staticmethod
    @transaction.atomic
    def cambiar_estado(
        *, orden, actor, estado, nota="", fecha_programada=None, con_observaciones=False
    ) -> OrdenTrabajo:
        if estado not in Estado.values:
            raise ValidationError({"estado": f"«{estado}» no es un estado de orden."})
        if estado == Estado.ASIGNADA:
            raise ValidationError({"estado": "Para asignar la orden use «Asignar»."})
        if not orden.puede_pasar_a(estado):
            actual = orden.get_estado_display().lower()
            if orden.esta_cerrada:
                raise ValidationError(
                    {"estado": "La orden está cerrada: si el problema vuelve, es una orden nueva."}
                )
            raise ValidationError(
                {"estado": f"Una orden {actual} no puede pasar a {Estado(estado).label.lower()}."}
            )
        if not _puede_llevarla(actor, orden, estado):
            if estado == Estado.CERRADA or orden.estado == Estado.PENDIENTE_APROBACION:
                raise PermissionDenied(
                    "El trabajo lo acepta o lo devuelve quien responde por la sede, o quien coordina."
                )
            raise PermissionDenied("Esta orden la ejecuta el técnico asignado, o quien coordina.")

        nota = (nota or "").strip()
        devolucion = orden.estado == Estado.PENDIENTE_APROBACION and estado == Estado.EN_EJECUCION
        if (estado == Estado.PAUSADA or devolucion) and not nota:
            raise ValidationError(
                {"nota": "Diga el motivo: es lo que lee quien tiene que retomar la orden."}
            )
        if estado == Estado.PROGRAMADA:
            orden.fecha_programada = fecha_programada or orden.fecha_programada
            if not orden.fecha_programada:
                raise ValidationError({"fecha_programada": "Indique para qué fecha se programa."})
        if estado == Estado.CERRADA:
            if con_observaciones and not nota:
                raise ValidationError(
                    {"nota": "Escriba las observaciones: es lo que queda pendiente de revisar."}
                )
            orden.con_observaciones = bool(con_observaciones)
            orden.observaciones_cierre = nota if con_observaciones else ""
            orden.fecha_cierre = timezone.now()

        anterior = orden.estado
        orden.estado = estado
        orden.save()

        etiqueta_ant = Estado(anterior).label
        etiqueta_nueva = Estado(estado).label
        if estado == Estado.CERRADA:
            texto = (
                f"Aceptó con observaciones {orden.numero}"
                if con_observaciones
                else f"Aceptó y cerró {orden.numero}"
            )
        elif devolucion:
            texto = f"Devolvió {orden.numero} a ejecución"
        else:
            texto = f"Cambió el estado de {orden.numero}: {etiqueta_ant} → {etiqueta_nueva}"
        _movimiento(orden, actor, texto, anterior=anterior, nuevo=estado, nota=nota)
        return orden

    @staticmethod
    @transaction.atomic
    def corregir(*, orden, actor, **datos) -> dict:
        """Corrige los datos de la orden y devuelve qué cambió (antes, después)."""
        if not puede_editarla(actor, orden):
            raise PermissionDenied(
                "La orden la corrige quien coordina, o quien la pidió mientras nadie la haya tomado."
            )
        previos = {campo: str(getattr(orden, campo)) for campo in datos}
        for campo, valor in datos.items():
            setattr(orden, campo, valor)
        orden.save()
        cambios = {c: str(getattr(orden, c)) for c in datos if str(getattr(orden, c)) != previos[c]}
        if cambios:
            _movimiento(orden, actor, f"Corrigió los datos de {orden.numero}")
        return {"previos": {c: previos[c] for c in cambios}, "nuevos": cambios}

    @staticmethod
    @transaction.atomic
    def registrar_material(*, orden, actor, **datos) -> MaterialOrden:
        OrdenService._exigir_costos(orden, actor)
        material = MaterialOrden.objects.create(orden=orden, registrado_por=actor, **datos)
        _movimiento(orden, actor, f"Registró material en {orden.numero}: {material.descripcion}")
        return material

    @staticmethod
    @transaction.atomic
    def registrar_mano_de_obra(*, orden, actor, **datos) -> ManoDeObraOrden:
        OrdenService._exigir_costos(orden, actor)
        fila = ManoDeObraOrden.objects.create(orden=orden, registrado_por=actor, **datos)
        horas = f"{fila.horas:g}".replace(".", ",")
        _movimiento(orden, actor, f"Registró {horas} h de mano de obra en {orden.numero}")
        return fila

    @staticmethod
    @transaction.atomic
    def quitar_costo(*, orden, actor, fila) -> None:
        OrdenService._exigir_costos(orden, actor)
        _movimiento(orden, actor, f"Quitó «{fila.descripcion}» de {orden.numero}")
        fila.delete()

    @staticmethod
    def _exigir_costos(orden, actor):
        if orden.esta_cerrada:
            raise ValidationError({"estado": "La orden está cerrada: sus costos ya no cambian."})
        if not puede_ejecutarla(actor, orden):
            raise PermissionDenied(
                "Materiales y horas los registra el técnico asignado, o quien coordina."
            )
