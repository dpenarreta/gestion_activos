"""Las reglas de una orden de trabajo: quién la ve, quién la mueve y a dónde.

Viven aquí y no en la vista porque son del negocio: el técnico mueve lo que
tiene asignado y no lo ajeno, quien responde por la sede acepta el trabajo de
su sede y no el de otra, y cada paso deja dicho quién lo dio. La vista solo
traduce a HTTP lo que esto decide.

Alcance (lo que pinta el mockup como «perfiles»): sin `ordenes.ver_todas`, una
persona ve las órdenes que solicitó, las que tiene asignadas y las de las
sedes que tiene a su cargo (`Sede.responsables`).
"""

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Max, OuterRef, Q, Subquery
from django.utils import timezone

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.empresas.models import Empresa
from apps.organizacion.models import Proveedor
from apps.permissions.authorization import user_has_permission

from .models import ManoDeObraOrden, MaterialOrden, MovimientoOrden, OrdenTrabajo

Estado = OrdenTrabajo.Estado

#: Cuántos resultados por grupo devuelve la búsqueda de responsables: es un
#: desplegable que se afina escribiendo, no un listado.
LIMITE_RESPONSABLES = 20

SIN_RESPONSABLE = "Indique el proveedor o la persona que realizará la orden."


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


def _con_permiso(permiso: str, *, incluir_superusuarios: bool):
    """Las cuentas activas de la empresa activa que tienen `permiso` (propio,
    por grupo o por el rol de su membresía)."""
    candidatos = Q(groups__permissions__codename=permiso) | Q(user_permissions__codename=permiso)
    if incluir_superusuarios:
        candidatos |= Q(is_superuser=True)
    empresa = empresa_actual()
    queryset = get_user_model().objects.filter(is_active=True)
    if empresa is not None and empresa is not SIN_EMPRESA:
        candidatos |= Q(
            membresias__empresa=empresa, membresias__roles__permissions__codename=permiso
        )
        queryset = queryset.filter(membresias__empresa=empresa)
    return queryset.filter(candidatos).distinct().order_by("first_name", "last_name", "username")


def tecnicos(*, incluir_superusuarios: bool = True):
    """Quien puede ejecutar órdenes en la empresa activa (técnicos internos y
    personal de proveedores con cuenta).

    Es la regla de la asignación y la de la creación con responsable
    (11/11/2026, US-006): las dos tienen que aceptar a las mismas personas, o
    una orden creada no se podría reasignar a quien ya la tiene. El buscador
    de responsables pide `incluir_superusuarios=False`: un administrador sin
    el permiso de ejecutar no es alguien a quien ofrecer una orden, y quien
    solo crea órdenes no tiene por qué ver las cuentas de administración.
    """
    return _con_permiso("ordenes.ejecutar", incluir_superusuarios=incluir_superusuarios)


def coordinadores():
    """Quien coordina el mantenimiento (`ordenes.gestionar`) en la empresa
    activa, sin los superusuarios que no tienen el permiso: es a quien se
    avisa de una orden nueva."""
    return _con_permiso("ordenes.gestionar", incluir_superusuarios=False)


def puede_atender(usuario) -> bool:
    return usuario is not None and tecnicos().filter(pk=usuario.pk).exists()


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
    pidió, solo mientras nadie haya empezado el trabajo.

    Hasta el 11/11/2026 era «mientras siga solicitada». Desde US-006 la orden
    nace con responsable y fecha (programada): con la regla anterior quien la
    pide no podría corregir ni una errata. Se toma como «ya tomada» la orden
    que entró en ejecución."""
    if orden.esta_cerrada:
        return False
    if es_gestor(usuario):
        return True
    return orden.solicitante_id == usuario.id and orden.estado in {
        Estado.SOLICITADA,
        Estado.ASIGNADA,
        Estado.PROGRAMADA,
    }


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


def _quien(tecnico, proveedor) -> str:
    """«Jorge Andrade (Climas del Sur)», «Jorge Andrade» o «Climas del Sur»."""
    if tecnico is None:
        return proveedor.nombre if proveedor else "—"
    return _nombre(tecnico) + (f" ({proveedor.nombre})" if proveedor else "")


#: «No vino en la petición». En `asignar`, el técnico o el proveedor que no se
#: envía conserva lo que había, y `null` explícito lo quita (decisión del Tech
#: Lead, 11/11/2026, US-006): reasignar a una persona no borra el proveedor.
NO_ENVIADO = object()


def _avisar(orden, usuarios, *, tipo, titulo, resumen) -> None:
    """La campana, al confirmar la transacción: el aviso de una orden que al
    final no se guardó mandaría a buscar algo que no existe."""
    usuarios = list(usuarios)
    if not usuarios:
        return
    from apps.notificaciones import services as campana

    transaction.on_commit(
        lambda: campana.notificar(
            usuarios,
            tipo=tipo,
            titulo=titulo,
            resumen=resumen,
            enlace=f"/admin/ordenes/lista/{orden.id}",
            empresa=orden.empresa,
        )
    )


def _resumen(orden) -> str:
    texto = f"{orden.numero} · {orden.titulo} · {orden.sede.nombre}"
    if orden.fecha_programada:
        texto += f" · para el {orden.fecha_programada:%d/%m/%Y}"
    return texto


def _avisar_asignacion(orden, actor) -> None:
    """La campana del técnico al que le llega la orden (11/11/2026, US-006).

    Solo a quien tiene cuenta (un proveedor sin persona no la tiene) y no a
    quien se la asignó a sí mismo.
    """
    tecnico = orden.tecnico
    if tecnico is None or tecnico.pk == getattr(actor, "pk", None):
        return
    _avisar(
        orden,
        [tecnico],
        tipo="ordenes.asignada",
        titulo="Orden de trabajo asignada",
        resumen=_resumen(orden),
    )


def _avisar_orden_nueva(orden, actor) -> None:
    """Si quien crea la orden no coordina, se entera quien coordina
    (decisión del Tech Lead, 11/11/2026, US-006): la orden ya nace con
    responsable y fecha, y sin este aviso nadie que pueda corregirlos sabría
    que existe hasta abrir el panel."""
    if es_gestor(actor):
        return
    _avisar(
        orden,
        coordinadores().exclude(pk=actor.pk),
        tipo="ordenes.creada",
        titulo="Orden de trabajo nueva",
        resumen=f"{_resumen(orden)} · a cargo de {_quien(orden.tecnico, orden.proveedor)}",
    )


def _aplicar_responsable(orden, actor, *, tecnico, proveedor, fecha_programada, nota=""):
    """Pone quién ejecuta y para cuándo, mueve el estado, deja el movimiento y
    avisa. Lo comparten la asignación y la creación con responsable (US-006):
    una orden que nace con responsable queda igual que una asignada después.

    Con el mismo responsable y otra fecha es una reprogramación: el movimiento
    dice «Reprogramó…» y no se vuelve a avisar «Orden de trabajo asignada»; el
    aviso sale solo cuando cambia el técnico.
    """
    mismo_responsable = orden.tecnico_id == getattr(
        tecnico, "pk", None
    ) and orden.proveedor_id == getattr(proveedor, "pk", None)
    nueva_fecha = fecha_programada or orden.fecha_programada
    if mismo_responsable and nueva_fecha == orden.fecha_programada:
        raise ValidationError(
            {"responsable": "La orden ya está asignada así: cambie el responsable o la fecha."}
        )

    anterior = orden.estado
    tecnico_anterior_id = orden.tecnico_id
    orden.tecnico = tecnico
    orden.proveedor = proveedor
    orden.fecha_programada = nueva_fecha
    if orden.estado == Estado.SOLICITADA:
        orden.estado = Estado.PROGRAMADA if orden.fecha_programada else Estado.ASIGNADA
    elif orden.estado == Estado.ASIGNADA and orden.fecha_programada:
        orden.estado = Estado.PROGRAMADA
    orden.save()

    if mismo_responsable:
        texto = f"Reprogramó {orden.numero} para el {orden.fecha_programada:%Y-%m-%d}"
    else:
        texto = f"Asignó {orden.numero} a {_quien(tecnico, proveedor)}"
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
    if orden.tecnico_id and orden.tecnico_id != tecnico_anterior_id:
        _avisar_asignacion(orden, actor)


def _errores_de_responsable(tecnico, proveedor, *, tecnico_nuevo=True, proveedor_nuevo=True):
    """Quién la realiza: un proveedor activo, una persona que puede atender
    órdenes o las dos. Lo que ya tenía la orden y no cambia no se vuelve a
    juzgar: reprogramar no debe fallar porque el proveedor se desactivó."""
    errores = {}
    if tecnico is None and proveedor is None:
        errores["responsable"] = SIN_RESPONSABLE
    elif tecnico is not None and tecnico_nuevo and not puede_atender(tecnico):
        errores["tecnico"] = "Esa persona no puede ejecutar órdenes en esta empresa."
    if proveedor is not None and proveedor_nuevo and not proveedor.activo:
        errores["proveedor"] = "Ese proveedor está desactivado: elija otro."
    return errores


def _errores_de_fecha(fecha_programada, *, obligatoria: bool):
    """Hoy o después, en la zona horaria del sistema: una orden que nace (o se
    reprograma) vencida no es un compromiso."""
    if fecha_programada is None:
        if obligatoria:
            return {"fecha_programada": "Indique la fecha en que debe cumplirse la orden."}
        return {}
    if fecha_programada < timezone.localdate():
        return {"fecha_programada": "La fecha programada no puede ser anterior a hoy."}
    return {}


def validar_responsable_y_fecha(*, tecnico, proveedor, fecha_programada) -> None:
    """Lo que exige una orden nueva (11/11/2026, US-006): quién la realiza y
    para cuándo, sin esperar a que alguien la asigne."""
    errores = _errores_de_responsable(tecnico, proveedor)
    errores.update(_errores_de_fecha(fecha_programada, obligatoria=True))
    if errores:
        raise ValidationError(errores)


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
    def crear(
        *, actor, tecnico=None, proveedor=None, fecha_programada=None, **datos
    ) -> OrdenTrabajo:
        """Registra la orden con el siguiente número del año en la empresa, ya
        con su responsable y su fecha (US-006).

        Nace solicitada (el movimiento «Solicitó…») y en la misma transacción
        se le aplica el responsable como lo hace la asignación: el estado, el
        movimiento «Asignó…» y el aviso al técnico salen del mismo código.

        Dos altas a la vez pueden calcular el mismo número: la restricción
        única lo impide y se reintenta con el siguiente.
        """
        validar_responsable_y_fecha(
            tecnico=tecnico, proveedor=proveedor, fecha_programada=fecha_programada
        )
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
                    _aplicar_responsable(
                        orden,
                        actor,
                        tecnico=tecnico,
                        proveedor=proveedor,
                        fecha_programada=fecha_programada,
                    )
                    _avisar_orden_nueva(orden, actor)
                    return orden
            except IntegrityError:
                continue
        raise ValidationError("No se pudo numerar la orden; inténtelo de nuevo.")

    @staticmethod
    @transaction.atomic
    def asignar(
        *,
        orden,
        actor,
        tecnico=NO_ENVIADO,
        proveedor=NO_ENVIADO,
        fecha_programada=None,
        nota="",
    ) -> OrdenTrabajo:
        """Asigna, reasigna o reprograma quién ejecuta y para cuándo.

        Desde US-006 el responsable puede ser solo un proveedor, como al
        crear. `tecnico` o `proveedor` sin enviar (`NO_ENVIADO`) conservan lo
        que había; `None` lo quita. Las validaciones son las del alta: al menos
        uno de los dos, proveedor activo, persona que puede atender y fecha
        (si se envía) de hoy en adelante.
        """
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
        if tecnico is NO_ENVIADO:
            tecnico = orden.tecnico
        if proveedor is NO_ENVIADO:
            proveedor = orden.proveedor
        errores = _errores_de_responsable(
            tecnico,
            proveedor,
            tecnico_nuevo=getattr(tecnico, "pk", None) != orden.tecnico_id,
            proveedor_nuevo=getattr(proveedor, "pk", None) != orden.proveedor_id,
        )
        errores.update(_errores_de_fecha(fecha_programada, obligatoria=False))
        if errores:
            raise ValidationError(errores)

        _aplicar_responsable(
            orden,
            actor,
            tecnico=tecnico,
            proveedor=proveedor,
            fecha_programada=fecha_programada,
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


def buscar_responsables(usuario, termino, *, solo_proveedores: bool = False) -> dict:
    """Quién puede realizar una orden, en dos grupos (11/11/2026, US-006).

    - Proveedores activos del catálogo de la empresa, por nombre o contacto
      (no por RUC o cédula: sería un oráculo de cédulas para quien solo crea órdenes).
    - Personas con cuenta que pueden atender órdenes (`tecnicos`, sin los
      superusuarios que no tienen el permiso de ejecutar), por nombre o
      usuario. Se omite con `solo_proveedores`.

    El modelo no guarda de qué proveedor es cada persona: se toma el proveedor
    activo de su orden más reciente asignada con proveedor, **entre las que
    quien busca puede ver** (`visibles`). Así la búsqueda no revela con quién
    trabajó alguien en órdenes ajenas; a cambio, quien solo ve sus propias
    órdenes verá `proveedor: null` más a menudo. Es una subconsulta
    correlacionada (TOP 1 por persona), no la carga del historial.

    Ambos sin tildes ni mayúsculas y como mucho `LIMITE_RESPONSABLES` por
    grupo. Con el término vacío devuelve los primeros de cada grupo.
    """
    from apps.core.busqueda import filtro_de_busqueda

    proveedores = filtro_de_busqueda(
        Proveedor.objects.filter(activo=True), termino, ("nombre", "contacto")
    ).order_by("nombre")[:LIMITE_RESPONSABLES]
    resultado = {"proveedores": [{"id": p.id, "nombre": p.nombre} for p in proveedores]}
    if solo_proveedores:
        return resultado

    ultimo_proveedor = (
        OrdenTrabajo.objects.filter(
            pk__in=visibles(usuario).values("pk"),
            tecnico=OuterRef("pk"),
            proveedor__isnull=False,
            proveedor__activo=True,
        )
        .order_by("-created_at")
        .values("proveedor_id")[:1]
    )
    personas = list(
        filtro_de_busqueda(
            tecnicos(incluir_superusuarios=False),
            termino,
            ("first_name", "last_name", "username"),
        ).annotate(proveedor_reciente=Subquery(ultimo_proveedor))[:LIMITE_RESPONSABLES]
    )
    nombres = dict(
        Proveedor.objects.filter(
            pk__in={p.proveedor_reciente for p in personas if p.proveedor_reciente}
        ).values_list("id", "nombre")
    )
    resultado["personas"] = [
        {
            "id": p.id,
            "nombre": _nombre(p),
            "proveedor": (
                {"id": p.proveedor_reciente, "nombre": nombres[p.proveedor_reciente]}
                if p.proveedor_reciente in nombres
                else None
            ),
        }
        for p in personas
    ]
    return resultado


def _nombre_normalizado(nombre: str) -> str:
    return " ".join((nombre or "").split())


@transaction.atomic
def registrar_proveedor(*, actor, nombre, **datos) -> Proveedor:
    """Da de alta un proveedor desde la orden, con los datos mínimos (US-006).

    El catálogo es el mismo del inventario. El duplicado se busca sin
    mayúsculas ni tildes («Climatización Sur» = «CLIMATIZACION SUR»): dos
    fichas de la misma empresa partirían su historial en dos.

    La restricción única de la base (`empresa`, `nombre`) **no** basta: la
    colación de la columna puede distinguir tildes (la local es `CI_AS`), así
    que «Climatización» y «Climatizacion» pasarían las dos. Por eso la
    comprobación normalizada va dentro de la transacción y con la fila de la
    empresa bloqueada (`select_for_update`): dos altas a la vez en la misma
    empresa se ponen en fila y la segunda ve a la primera.
    """
    if not tiene(actor, "crear"):
        raise PermissionDenied("Registra proveedores desde la orden quien puede crear órdenes.")
    nombre = _nombre_normalizado(nombre)
    if not nombre:
        raise ValidationError({"nombre": "Escriba el nombre o la razón social."})
    empresa = empresa_actual()
    if empresa is not None and empresa is not SIN_EMPRESA:
        Empresa.objects.select_for_update().filter(pk=empresa.pk).first()
    choque = Proveedor.objects.filter(nombre__sin_tildes__iexact=nombre).first()
    if choque is not None:
        raise ValidationError({"nombre": _mensaje_duplicado(choque)})
    try:
        with transaction.atomic():
            return Proveedor.objects.create(nombre=nombre, **datos)
    except IntegrityError as error:
        choque = Proveedor.objects.filter(nombre__sin_tildes__iexact=nombre).first()
        raise ValidationError(
            {"nombre": _mensaje_duplicado(choque) if choque else "No se pudo registrar."}
        ) from error


def _mensaje_duplicado(proveedor) -> str:
    # Se nombra al que ya está, con su grafía: es el que hay que elegir.
    if proveedor.activo:
        return f"Ya existe un proveedor llamado «{proveedor.nombre}»: búsquelo y elíjalo."
    return (
        f"Ya existe un proveedor llamado «{proveedor.nombre}», pero está desactivado: "
        "pida a quien administra el catálogo de proveedores que lo reactive."
    )
