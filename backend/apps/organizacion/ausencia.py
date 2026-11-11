"""Ausencias visibles y reemplazo en las aprobaciones (11/11/2026, US-001).

Una persona está **ausente** en una fecha si:

1. tiene un permiso o vacaciones **aprobados** de día completo ese día
   (`ausencias.LeaveRecord`, `is_full_day`, de la empresa activa), o
2. su estado de chat vigente es «De vacaciones» (vacaciones en curso), o
3. su estado de chat vigente es «Fuera de la oficina».

Los permisos por horas no cuentan: la persona vuelve el mismo día.

**Privacidad (LOPDP).** A terceros solo se les dice si es «vacaciones» o
«fuera_oficina», hasta cuándo y quién la reemplaza. Un permiso médico o
personal se muestra como «fuera_oficina»: nunca el tipo ni el motivo (la
misma regla que `apps.ausencias.access`).

**Reemplazo.** Cada persona elige, por empresa, quién aprueba por ella
(`DatosDeContacto.reemplazo_modo`): su jefe inmediato (por defecto, según
`licencias.services.jefes_de`) u otra persona (`reemplazo`). Si el reemplazo
también está ausente se sigue la cadena (el reemplazo del reemplazo, o el jefe
del jefe) hasta `MAXIMO_SALTOS` saltos, sin volver a nadie ya visitado y
saltando a quien no puede aprobar (el solicitante, quien ya aprobó el paso).
Si no queda nadie, la aprobación se queda con quien estaba.

**Lo reasignado no vuelve** al regresar la persona: es lo más simple y evita
que una aprobación cambie de manos dos veces (decisión del 11/11/2026).
"""

import datetime
import logging

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual, usando_empresa

logger = logging.getLogger(__name__)

VACACIONES = "vacaciones"
FUERA_OFICINA = "fuera_oficina"
CLAVES = (VACACIONES, FUERA_OFICINA)
TEXTOS = {VACACIONES: "De vacaciones", FUERA_OFICINA: "Fuera de la oficina"}

#: Cuántos saltos se dan por la cadena de reemplazos antes de rendirse.
MAXIMO_SALTOS = 5

#: Entre dos días de un permiso registrado a mano puede haber un fin de
#: semana y un feriado sin que deje de ser la misma ausencia.
HUECO_MAXIMO = datetime.timedelta(days=4)
#: Hasta dónde se mira hacia adelante para encadenar los días a mano.
HORIZONTE = datetime.timedelta(days=120)
#: Cuánto se recuerda el reemplazo que solo se muestra (presencia del chat,
#: listas de solicitudes): la pantalla consulta cada medio minuto y resolver
#: la cadena cuesta varias consultas. Lo que reasigna nunca usa esta memoria.
MEMORIA_SEGUNDOS = 120


def _nombre(usuario) -> str:
    if usuario is None:
        return ""
    return (usuario.get_full_name() or "").strip() or usuario.username


def persona(usuario) -> dict | None:
    """`{id, nombre}` de una persona, o None."""
    if usuario is None:
        return None
    return {"id": usuario.pk, "nombre": _nombre(usuario)}


def _empresa():
    actual = empresa_actual()
    return None if actual in (None, SIN_EMPRESA) else actual


def _ids(usuarios_o_ids) -> list[int]:
    ids = []
    for valor in usuarios_o_ids or []:
        pk = getattr(valor, "pk", valor)
        if pk is not None:
            ids.append(int(pk))
    return list(dict.fromkeys(ids))


def _texto(clave: str, hasta: datetime.date) -> str:
    return f"{TEXTOS[clave]} hasta el {hasta:%d/%m}"


# --- ¿Quién está ausente? ---------------------------------------------------------------


def por_permisos(ids, fecha=None) -> dict[int, dict]:
    """Los permisos aprobados de día completo que cubren `fecha`, en la empresa
    activa: `{user_id: {clave, hasta}}`. Dos fuentes, dos consultas (más una
    si hay registros a mano), sea cual sea el número de personas:

    - **Solicitudes aprobadas por días** cuyo rango `desde..hasta` contiene la
      fecha: cuentan también el sábado, el domingo o el feriado que caen en
      medio, aunque ese día no tenga `LeaveRecord` (QA-FUNC, 11/11/2026).
      `hasta` es el último día de la solicitud.
    - **Registros a mano** (`LeaveRecord` sin solicitud) de ese día: `hasta`
      es el último de los días seguidos, salvando fines de semana y feriados.

    Las solicitudes por horas no cuentan: la persona vuelve el mismo día."""
    from apps.ausencias.models import LeaveRecord
    from apps.licencias.models import FlujoPermiso, SolicitudPermiso

    ids = _ids(ids)
    if not ids or _empresa() is None:
        return {}
    fecha = fecha or timezone.localdate()
    candidatas = []  # (user_id, tipo, hasta)
    for fila in SolicitudPermiso.objects.filter(
        solicitante_id__in=ids,
        estado=SolicitudPermiso.Estado.APROBADA,
        unidad=FlujoPermiso.Unidad.DIAS,
        desde__lte=fecha,
        hasta__gte=fecha,
    ).values("solicitante_id", "tipo_ausencia", "hasta"):
        candidatas.append((fila["solicitante_id"], fila["tipo_ausencia"], fila["hasta"]))
    de_hoy = list(
        LeaveRecord.objects.filter(
            user_id__in=ids, is_full_day=True, date=fecha, solicitud__isnull=True
        ).values("user_id", "type")
    )
    if de_hoy:
        siguientes: dict[int, list] = {}
        for fila in LeaveRecord.objects.filter(
            user_id__in={f["user_id"] for f in de_hoy},
            is_full_day=True,
            solicitud__isnull=True,
            date__gt=fecha,
            date__lte=fecha + HORIZONTE,
        ).values("user_id", "type", "date"):
            siguientes.setdefault(fila["user_id"], []).append(fila)
        for fila in de_hoy:
            hasta = fecha
            for otra in sorted(siguientes.get(fila["user_id"], []), key=lambda f: f["date"]):
                if otra["type"] != fila["type"] or otra["date"] - hasta > HUECO_MAXIMO:
                    break
                hasta = otra["date"]
            candidatas.append((fila["user_id"], fila["type"], hasta))
    resultado: dict[int, dict] = {}
    for user_id, tipo, hasta in candidatas:
        clave = VACACIONES if tipo == LeaveRecord.Type.VACACIONES else FUERA_OFICINA
        previa = resultado.get(user_id)
        # Dos ausencias el mismo día (raro): manda la que dura más.
        if previa is None or hasta > previa["hasta"]:
            resultado[user_id] = {"clave": clave, "hasta": hasta}
    return resultado


def por_estado(estado, fecha=None, ahora=None) -> dict | None:
    """Si el estado de chat dice que está ausente en `fecha`: `{clave, hasta}`
    (vacaciones en curso o «Fuera de la oficina» sin vencer)."""
    from apps.chat.models import EstadoChat

    if estado is None:
        return None
    ahora = ahora or timezone.now()
    fecha = fecha or timezone.localdate(ahora)
    if (
        estado.vacaciones_desde
        and estado.vacaciones_hasta
        and estado.vacaciones_desde <= fecha <= estado.vacaciones_hasta
    ):
        return {"clave": VACACIONES, "hasta": estado.vacaciones_hasta}
    if estado.estado == EstadoChat.Estado.FUERA_OFICINA and estado.hasta:
        if estado.hasta <= ahora:
            return None
        hasta = timezone.localdate(estado.hasta)
        if hasta >= fecha:
            return {"clave": FUERA_OFICINA, "hasta": hasta}
    return None


def ausencias_de(usuarios_o_ids, fecha=None, *, con_reemplazo=True) -> dict[int, dict]:
    """Quiénes de esas personas están ausentes en `fecha` (hoy, si no se dice):
    `{user_id: {clave, texto, hasta, reemplazo}}`. Quien no está ausente no
    aparece. En lote: unas pocas consultas para todas, más la resolución del
    reemplazo de cada ausente (`con_reemplazo=False` la omite).

    - `clave`: «vacaciones» o «fuera_oficina» (nunca el tipo de permiso).
    - `texto`: «De vacaciones hasta el dd/mm» o «Fuera de la oficina hasta el
      dd/mm».
    - `hasta`: el último día de la ausencia (`date`).
    - `reemplazo`: `{id, nombre}` de quien aprueba por ella, o None.
    """
    from apps.chat.models import EstadoChat

    ids = _ids(usuarios_o_ids)
    if not ids:
        return {}
    ahora = timezone.now()
    fecha = fecha or timezone.localdate(ahora)
    permisos = por_permisos(ids, fecha)
    estados = {e.usuario_id: e for e in EstadoChat.objects.filter(usuario_id__in=ids)}
    resultado = {}
    for pk in ids:
        candidatas = [c for c in (permisos.get(pk), por_estado(estados.get(pk), fecha, ahora)) if c]
        if not candidatas:
            continue
        # Si las dos dicen que no está, manda la que termina más tarde.
        elegida = max(candidatas, key=lambda c: c["hasta"])
        resultado[pk] = {
            "clave": elegida["clave"],
            "texto": _texto(elegida["clave"], elegida["hasta"]),
            "hasta": elegida["hasta"],
            "reemplazo": None,
        }
    if con_reemplazo and resultado and _empresa() is not None:
        for pk, mostrado in reemplazos_mostrados(list(resultado), fecha).items():
            resultado[pk]["reemplazo"] = mostrado
    return resultado


def _clave_memoria(usuario_id, fecha) -> str:
    empresa = _empresa()
    return f"ausencia:reemplazo:e{empresa.pk if empresa else 0}:u{usuario_id}:{fecha}"


def reemplazos_mostrados(ids, fecha=None) -> dict[int, dict | None]:
    """`{user_id: {id, nombre} | None}`: el reemplazo que se **muestra** de
    cada persona (chat, listas de solicitudes), recordado `MEMORIA_SEGUNDOS`
    por empresa, persona y día. Solo para mostrar: lo que reasigna llama a
    `reemplazo_para`, sin memoria."""
    from apps.users.models import User

    ids = _ids(ids)
    if not ids or _empresa() is None:
        return {pk: None for pk in ids}
    fecha = fecha or timezone.localdate()
    claves = {pk: _clave_memoria(pk, fecha) for pk in ids}
    guardados = cache.get_many(list(claves.values()))
    resultado = {}
    faltan = []
    for pk, clave in claves.items():
        if clave in guardados:
            # Se guarda {"persona": …} para distinguir «sin reemplazo» (None)
            # de «no está en la memoria».
            resultado[pk] = guardados[clave]["persona"]
        else:
            faltan.append(pk)
    if faltan:
        nuevos = {}
        for usuario in User.objects.filter(pk__in=faltan):
            resultado[usuario.pk] = persona(reemplazo_para(usuario, fecha=fecha))
            nuevos[claves[usuario.pk]] = {"persona": resultado[usuario.pk]}
        cache.set_many(nuevos, MEMORIA_SEGUNDOS)
    return resultado


def olvidar_reemplazo_mostrado(usuario) -> None:
    """Tras cambiar su configuración, su reemplazo se vuelve a calcular."""
    cache.delete(_clave_memoria(usuario.pk, timezone.localdate()))


def ausencia_de(usuario, fecha=None) -> dict | None:
    """La ausencia de una sola persona, o None."""
    if usuario is None:
        return None
    return ausencias_de([usuario], fecha).get(getattr(usuario, "pk", usuario))


# --- El reemplazo -----------------------------------------------------------------------


def _miembro_activo(usuario_id):
    from apps.licencias.services import personas_de_la_empresa

    if not usuario_id:
        return None
    return personas_de_la_empresa().filter(pk=usuario_id).first()


def configuracion(usuario) -> tuple[str, object]:
    """`(modo, persona)` de la empresa activa. Con «persona» pero sin una
    persona válida (borrada, inactiva o fuera de la empresa), se vuelve al
    jefe inmediato."""
    from apps.organizacion.models import DatosDeContacto

    Modo = DatosDeContacto.ReemplazoModo
    fila = (
        DatosDeContacto.objects.filter(usuario=usuario)
        .values("reemplazo_modo", "reemplazo_id")
        .first()
    )
    if not fila or fila["reemplazo_modo"] != Modo.PERSONA:
        return Modo.JEFE, None
    elegido = _miembro_activo(fila["reemplazo_id"])
    if elegido is None or elegido.pk == usuario.pk:
        return Modo.JEFE, None
    return Modo.PERSONA, elegido


def candidatos_de(usuario) -> list:
    """A quién pasa lo de `usuario`, sin mirar si está ausente: la persona que
    eligió o, si no, su jefe inmediato (puede ser más de uno si el cargo del
    jefe tiene varias plazas)."""
    from apps.licencias.services import jefes_de

    modo, elegido = configuracion(usuario)
    if elegido is not None:
        return [elegido]
    return [j for j in jefes_de(usuario) if j.pk != usuario.pk]


def reemplazo_para(usuario, excluir=frozenset(), fecha=None):
    """Quién aprueba por `usuario` mientras está ausente, o None si no queda
    nadie. Sigue la cadena si el reemplazo también está ausente o no puede
    aprobar (`excluir`: el solicitante, quien ya aprobó el paso…): el
    reemplazo del reemplazo, o el jefe del jefe. Como mucho `MAXIMO_SALTOS`
    saltos y sin volver a nadie ya visitado (un ciclo A → B → A se corta)."""
    if usuario is None or _empresa() is None:
        return None
    excluir = {getattr(x, "pk", x) for x in (excluir or ())}
    visitados = {usuario.pk}
    actual = usuario
    for _ in range(MAXIMO_SALTOS):
        candidatos = [c for c in candidatos_de(actual) if c.pk not in visitados]
        if not candidatos:
            return None
        ausentes = ausencias_de(candidatos, fecha, con_reemplazo=False)
        for candidato in candidatos:
            if candidato.pk not in excluir and candidato.pk not in ausentes:
                return candidato
        visitados.update(c.pk for c in candidatos)
        actual = candidatos[0]
    return None


def sustituir_ausentes(personas, excluir=frozenset()) -> tuple[list, list[tuple]]:
    """Para asignar aprobadores: cambia a cada ausente por su reemplazo.
    Devuelve `(personas, cambios)`, con `cambios` = `[(ausente, reemplazo)]`
    para dejar la constancia. Si un ausente no tiene reemplazo, se queda."""
    personas = [p for p in personas if p is not None]
    if not personas or _empresa() is None:
        return personas, []
    ausentes = ausencias_de(personas, con_reemplazo=False)
    if not ausentes:
        return personas, []
    resultado, cambios = [], []
    for p in personas:
        if p.pk in ausentes:
            reemplazo = reemplazo_para(p, excluir)
            if reemplazo is not None:
                resultado.append(reemplazo)
                cambios.append((p, reemplazo))
                continue
        resultado.append(p)
    return resultado, cambios


def mi_reemplazo(usuario) -> dict:
    """Lo que ve la persona en «¿Quién aprueba por usted mientras no está?»:
    `{modo, persona, jefe}`, con `jefe` = su jefe inmediato de hoy."""
    from apps.licencias.services import jefes_de

    modo, elegido = configuracion(usuario)
    jefes = [j for j in jefes_de(usuario) if j.pk != usuario.pk]
    return {
        "modo": str(modo),
        "persona": persona(elegido),
        "jefe": persona(jefes[0]) if jefes else None,
    }


def guardar_reemplazo(usuario, *, modo, persona_id=None) -> dict:
    """Guarda quién aprueba por la persona en la empresa activa. Con
    «persona», `persona_id` es obligatorio, no puede ser ella misma y tiene
    que ser una cuenta activa de la empresa. Con «jefe» se olvida la persona
    elegida."""
    from rest_framework.exceptions import PermissionDenied, ValidationError

    from apps.organizacion.models import DatosDeContacto

    if _empresa() is None:
        raise PermissionDenied("Elija una empresa para configurar quién aprueba por usted.")
    Modo = DatosDeContacto.ReemplazoModo
    elegido = None
    if modo == Modo.PERSONA:
        if not persona_id:
            raise ValidationError({"persona_id": "Elija a la persona que aprobará por usted."})
        if int(persona_id) == usuario.pk:
            raise ValidationError(
                {"persona_id": "No puede elegirse a usted mismo: elija a otra persona."}
            )
        elegido = _miembro_activo(persona_id)
        if elegido is None:
            raise ValidationError(
                {"persona_id": "Esa persona no tiene una cuenta activa en esta empresa."}
            )
    # Dos guardados a la vez sin fila previa: el segundo choca con la
    # restricción única (empresa, usuario); se reintenta una vez y entonces
    # ya encuentra la fila y la bloquea.
    for intento in range(2):
        try:
            with transaction.atomic():
                propios = DatosDeContacto.objects.select_for_update().filter(
                    usuario=usuario
                ).first() or DatosDeContacto(usuario=usuario)
                propios.reemplazo_modo = modo
                propios.reemplazo = elegido
                propios.save()
            break
        except IntegrityError:
            if intento:
                raise
    olvidar_reemplazo_mostrado(usuario)
    return mi_reemplazo(usuario)


def constancia(reemplazo, ausente) -> str:
    """El texto del historial."""
    return f"Escalada a {_nombre(reemplazo)} por ausencia de {_nombre(ausente)}"


# --- Lo que ya tenía pendiente ----------------------------------------------------------


def _reasignar_en_la_empresa(usuario) -> int:
    from apps.licencias import services as licencias
    from apps.proyectos import services as proyectos
    from apps.soporte import services as soporte

    if usuario.pk not in ausencias_de([usuario], con_reemplazo=False):
        return 0
    # Sin reemplazo posible ni siquiera sin exclusiones (las exclusiones solo
    # quitan candidatos), no se abre ninguna transacción ni se bloquea nada:
    # la revisión corre cada 5 minutos.
    base = reemplazo_para(usuario)
    if base is None:
        return 0
    total = 0
    for flujo in (licencias, proyectos, soporte):
        try:
            total += flujo.reasignar_por_ausencia(usuario, base=base)
        except Exception:  # noqa: BLE001
            # Un flujo que falla no deja sin reasignar a los otros dos; la
            # próxima revisión periódica lo vuelve a intentar.
            logger.exception("No se pudo reasignar por ausencia en %s", flujo.__name__)
    return total


def reasignar_pendientes(usuario, empresas=None) -> int:
    """Pasa a su reemplazo las aprobaciones pendientes de `usuario` en los tres
    flujos (permisos, proyectos y Mesa de ayuda), en cada empresa donde esté
    ausente. Devuelve cuántas pasó. Idempotente: lo que ya pasó deja de estar
    pendiente de él y no se vuelve a tocar.

    Sin `empresas`, recorre todas las de sus membresías: el estado de chat es
    de la persona, no de una empresa."""
    from apps.empresas.models import Empresa

    if usuario is None:
        return 0
    if empresas is None:
        empresas = Empresa.objects.filter(membresias__usuario=usuario, activa=True).distinct()
    total = 0
    for empresa in empresas:
        with usando_empresa(empresa):
            total += _reasignar_en_la_empresa(usuario)
    return total


def ausentes_con_pendientes() -> list:
    """De la empresa activa: quiénes tienen aprobaciones pendientes en alguno
    de los tres flujos y están ausentes hoy (para la revisión periódica)."""
    from apps.licencias.models import SolicitudPermiso
    from apps.proyectos.models import SolicitudProyecto
    from apps.soporte.models import AprobacionTicket, Ticket
    from apps.users.models import User

    ids = set(
        SolicitudPermiso.objects.filter(estado=SolicitudPermiso.Estado.PENDIENTE).values_list(
            "pendiente_de", flat=True
        )
    )
    ids |= set(
        SolicitudProyecto.objects.filter(estado=SolicitudProyecto.Estado.PENDIENTE).values_list(
            "pendiente_de", flat=True
        )
    )
    ids |= set(
        AprobacionTicket.objects.filter(
            estado=AprobacionTicket.Estado.PENDIENTE,
            ticket__estado=Ticket.Estado.ESPERANDO_APROBACION,
            aprobador__isnull=False,
        ).values_list("aprobador_id", flat=True)
    )
    ids.discard(None)
    if not ids:
        return []
    ausentes = ausencias_de(ids, con_reemplazo=False)
    return list(User.objects.filter(pk__in=list(ausentes)))


def revisar_empresa(empresa) -> int:
    """La revisión periódica en una empresa: reasigna lo pendiente de cada
    ausente de hoy. Devuelve cuántas aprobaciones pasaron."""
    with usando_empresa(empresa):
        return sum(_reasignar_en_la_empresa(u) for u in ausentes_con_pendientes())


# --- Para los serializers ---------------------------------------------------------------


def en_lote(serializer, ids_de, clave="_ausencias") -> dict[int, dict]:
    """Las ausencias de todas las personas de una respuesta, calculadas una vez
    y no por fila. `ids_de(objeto)` dice qué personas mira cada objeto. Con
    `many=True` se recorre la lista entera del padre (ya cargada) en la primera
    fila; lo que falte después se completa."""
    from rest_framework.serializers import ListSerializer

    memoria = serializer.context.get(clave)
    if memoria is None:
        memoria = {"vistos": set(), "ausencias": {}}
        serializer.context[clave] = memoria
        padre = serializer.parent
        objetos = (
            padre.instance
            if isinstance(padre, ListSerializer) and padre.instance is not None
            else [serializer.instance]
        )
        ids = set()
        for objeto in objetos or []:
            if objeto is not None:
                ids |= set(ids_de(objeto))
        _completar(memoria, ids)
    return memoria


def _completar(memoria, ids) -> None:
    faltan = {i for i in ids if i is not None} - memoria["vistos"]
    if faltan:
        memoria["ausencias"].update(ausencias_de(faltan))
        memoria["vistos"] |= faltan


def ausencia_en_lote(serializer, usuario_id, ids_de, clave="_ausencias", excluir=None):
    """La ausencia de `usuario_id` dentro de una respuesta (o None).

    `excluir` es quien no puede ser su reemplazo en esta fila (el solicitante):
    si el reemplazo calculado es él, se vuelve a resolver la cadena sin él
    (una vez por pareja y respuesta) y, si no queda nadie, `reemplazo` es
    None."""
    memoria = en_lote(serializer, ids_de, clave)
    _completar(memoria, {usuario_id})
    datos = memoria["ausencias"].get(usuario_id)
    if not datos or not excluir or not datos["reemplazo"]:
        return datos
    if datos["reemplazo"]["id"] != excluir:
        return datos
    corregidos = memoria.setdefault("corregidos", {})
    if (usuario_id, excluir) not in corregidos:
        from apps.users.models import User

        usuario = User.objects.filter(pk=usuario_id).first()
        corregidos[(usuario_id, excluir)] = {
            **datos,
            "reemplazo": persona(reemplazo_para(usuario, excluir={excluir})),
        }
    return corregidos[(usuario_id, excluir)]
