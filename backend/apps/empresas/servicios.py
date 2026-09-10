"""Qué empresa corresponde a cada petición."""

from .contexto import SIN_EMPRESA
from .models import Empresa, MembresiaEmpresa


def empresas_de(usuario):
    """Las que la cuenta puede ver, ordenadas por nombre.

    El superusuario las ve todas: es la cuenta de emergencia y no tiene sentido
    que necesite una membresía para entrar a arreglar algo.

    Y mientras exista **una sola empresa**, todas las cuentas trabajan en ella
    aunque nadie les haya asignado una membresía. No es una excepción cómoda
    sino la única lectura razonable: en un despliegue de una empresa no hay de
    quién aislarse, y exigir el trámite convertiría cada alta de usuario en dos
    pasos, con la cuenta sin ver nada entre uno y otro. En cuanto se crea la
    segunda, la membresía pasa a ser obligatoria y quien no la tenga no ve
    nada: ahí sí hay algo que separar.
    """
    vigentes = Empresa.objects.filter(activa=True)
    if usuario.is_superuser:
        return vigentes.order_by("nombre")

    propias = vigentes.filter(membresias__usuario=usuario).order_by("nombre")
    if propias.exists():
        return propias
    return vigentes.order_by("nombre") if vigentes.count() == 1 else Empresa.objects.none()


def empresa_predeterminada(usuario):
    membresia = (
        MembresiaEmpresa.objects.filter(
            usuario=usuario, es_predeterminada=True, empresa__activa=True
        )
        .select_related("empresa")
        .first()
    )
    if membresia:
        return membresia.empresa
    return empresas_de(usuario).first()


def empresa_para(usuario, solicitada):
    """La empresa de la petición, validando que la cuenta pueda verla.

    Una empresa pedida a la que no se pertenece no es un error del usuario sino
    un intento —una pestaña vieja, una URL copiada, o algo peor—, y la
    respuesta correcta es no mostrar nada, no mostrar otra cosa: devolver la
    predeterminada haría creer que se está viendo lo pedido.
    """
    disponibles = empresas_de(usuario)
    if solicitada:
        try:
            identificador = int(solicitada)
        except (TypeError, ValueError):
            return SIN_EMPRESA
        elegida = disponibles.filter(pk=identificador).first()
        return elegida or SIN_EMPRESA

    return empresa_predeterminada(usuario) or SIN_EMPRESA


AUTOEXCLUSION = (
    "No es posible quitarse a uno mismo todas las empresas: perdería el acceso "
    "a la información en cuanto se guardara el cambio."
)


def asignar_empresas(*, actor, usuario, asignaciones, context=None):
    """Define en qué empresas trabaja una cuenta y con qué rol en cada una.

    `asignaciones` es una lista de `{"empresa_id", "roles", "es_predeterminada"}`.
    Las dos cosas se guardan juntas porque son una sola decisión: dar acceso a
    una empresa sin decir a qué, o decir a qué sin dar el acceso, son estados a
    medias que alguien tendría que recordar completar.

    Reemplaza la lista completa en vez de sumar y restar: quien administra
    accesos piensa en «esta persona ve estas dos», no en «añade una y quita
    otra», y una operación incremental deja el estado final dependiendo de cuál
    era el anterior, que es justo lo que no se quiere al revisar accesos.

    Se prohíbe dejarse a uno mismo sin ninguna. No es paternalismo: con dos
    empresas o más, la cuenta que se queda sin membresías deja de ver todo y ya
    no puede ni devolverse el acceso —tendría que pedírselo a otro
    administrador, o al superusuario si queda alguno—.
    """
    from django.contrib.auth.models import Group
    from django.db import transaction

    from apps.core.audit import record_audit_event

    pedidas = [entrada["empresa_id"] for entrada in asignaciones]
    if len(pedidas) != len(set(pedidas)):
        raise ValueError("Una empresa no puede aparecer dos veces en la asignación.")

    empresas = {empresa.id: empresa for empresa in Empresa.objects.filter(id__in=pedidas)}
    faltantes = sorted(set(pedidas) - set(empresas))
    if faltantes:
        raise ValueError(f"Empresas inexistentes: {faltantes}.")

    roles_pedidos = {rol for entrada in asignaciones for rol in entrada.get("roles", [])}
    roles = {rol.id: rol for rol in Group.objects.filter(id__in=roles_pedidos)}
    faltantes = sorted(roles_pedidos - set(roles))
    if faltantes:
        raise ValueError(f"Roles inexistentes: {faltantes}.")

    if (
        actor is not None
        and actor.pk == usuario.pk
        and not asignaciones
        and Empresa.objects.filter(activa=True).count() > 1
    ):
        raise PermissionError(AUTOEXCLUSION)

    predeterminadas = [
        entrada["empresa_id"] for entrada in asignaciones if entrada.get("es_predeterminada")
    ]
    if len(predeterminadas) > 1:
        raise ValueError("Solo una empresa puede ser la predeterminada.")
    if predeterminadas:
        predeterminada = predeterminadas[0]
    elif asignaciones:
        # Sin una elegida se toma la primera por nombre: entrar cada día en una
        # empresa distinta según cómo ordenara la consulta es peor que entrar
        # siempre en la misma aunque no sea la que uno habría elegido.
        predeterminada = min(empresas.values(), key=lambda empresa: empresa.nombre).id
    else:
        predeterminada = None

    anteriores = _retrato(usuario)

    with transaction.atomic():
        MembresiaEmpresa.objects.filter(usuario=usuario).delete()
        for entrada in asignaciones:
            membresia = MembresiaEmpresa.objects.create(
                usuario=usuario,
                empresa=empresas[entrada["empresa_id"]],
                es_predeterminada=entrada["empresa_id"] == predeterminada,
            )
            membresia.roles.set([roles[rol] for rol in entrada.get("roles", [])])

    record_audit_event(
        actor=actor,
        action="user.empresas_assigned",
        target=usuario,
        module="empresas",
        previous_values=anteriores,
        new_values=_retrato(usuario),
        context=context,
    )
    return usuario


def _retrato(usuario):
    """Qué ve la cuenta y con qué rol, como se guarda en la auditoría.

    Se registran los nombres además de los identificadores: quien lea el
    historial dentro de un año querrá saber que se le quitó «Soporte TI» en
    LaarSeguridad, no que desapareció el rol 4 de la empresa 3.
    """
    return {
        "empresas": [
            {
                "id": membresia.empresa_id,
                "nombre": membresia.empresa.nombre,
                "predeterminada": membresia.es_predeterminada,
                "roles": sorted(rol.name for rol in membresia.roles.all()),
            }
            for membresia in membresias_de(usuario)
        ]
    }


def membresias_de(usuario):
    return (
        MembresiaEmpresa.objects.filter(usuario=usuario)
        .select_related("empresa")
        .prefetch_related("roles")
    )
