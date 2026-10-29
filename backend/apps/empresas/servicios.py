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


ULTIMO_GESTOR = (
    "{empresa} se quedaría sin nadie que gestione sus miembros en la Matriz de "
    "obligaciones. Asigne antes ese permiso a otra persona de la empresa."
)

#: El permiso que una empresa no puede perder del todo (§8.9 de la Matriz).
GESTIONAR_MIEMBROS = "matriz.gestionar_miembros"


class EmpresaSinGestor(PermissionError):
    """Un cambio dejaría a una empresa sin quien gestione sus miembros."""


def gestores_de(empresa_ids=None) -> dict[int, int]:
    """Cuántas personas activas pueden gestionar los miembros de cada empresa.

    Cuenta a quien trabaja en la empresa (tiene membresía), está activo y tiene
    `gestionar_miembros` por cualquier vía: el rol de esa membresía, un rol
    general, un permiso directo o ser superusuario. Desde el 15 de octubre los
    roles son generales, así que el rol global cuenta como cualquier otro.
    """
    from django.db.models import Count, Q

    from apps.users.models import User

    consulta = MembresiaEmpresa.objects.filter(usuario__status=User.Status.ACTIVE).filter(
        Q(roles__permissions__codename=GESTIONAR_MIEMBROS)
        | Q(usuario__groups__permissions__codename=GESTIONAR_MIEMBROS)
        | Q(usuario__user_permissions__codename=GESTIONAR_MIEMBROS)
        | Q(usuario__is_superuser=True)
    )
    if empresa_ids is not None:
        consulta = consulta.filter(empresa_id__in=empresa_ids)
    filas = consulta.values("empresa_id").annotate(total=Count("usuario", distinct=True))
    return {fila["empresa_id"]: fila["total"] for fila in filas}


def sin_dejar_empresas_sin_gestor(cambio):
    """Ejecuta `cambio()` y lo deshace si alguna empresa se queda sin gestor.

    Es la regla del último gestor (§8.9) para todos los caminos que la pueden
    romper: la ficha de empresas del usuario, sus roles generales y permisos
    directos, deshabilitarlo o bloquearlo, y quitar el permiso a un rol o
    borrarlo. Solo cuenta para las empresas que tenían algún gestor: una que
    nunca usó la Matriz no bloquea nada.
    """
    from django.db import transaction

    with transaction.atomic():
        antes = gestores_de()
        resultado = cambio()
        despues = gestores_de(list(antes))
        for empresa_id, total in antes.items():
            if total and not despues.get(empresa_id):
                nombre = Empresa.objects.get(pk=empresa_id).nombre
                raise EmpresaSinGestor(ULTIMO_GESTOR.format(empresa=nombre))
    return resultado


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

    from apps.core.audit import record_audit_event

    pedidas = [entrada["empresa_id"] for entrada in asignaciones]
    if len(pedidas) != len(set(pedidas)):
        raise ValueError("Una empresa no puede aparecer dos veces en la asignación.")

    empresas = {empresa.id: empresa for empresa in Empresa.objects.filter(id__in=pedidas)}
    faltantes = sorted(set(pedidas) - set(empresas))
    if faltantes:
        raise ValueError(f"Empresas inexistentes: {faltantes}.")

    from apps.matriz.models import Area

    areas_pedidas = {a for entrada in asignaciones for a in entrada.get("areas") or []}
    areas = {area.id: area for area in Area.objects.filter(id__in=areas_pedidas)}
    faltantes = sorted(areas_pedidas - set(areas))
    if faltantes:
        raise ValueError(f"Áreas inexistentes: {faltantes}.")

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

    _comprobar_alcance(actor, usuario, asignaciones, roles)

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
    # Las áreas de la Matriz de cada membresía. La asignación reemplaza las
    # membresías, y sin esto cada guardado de la ficha del usuario borraría en
    # silencio sus áreas: quien no las envía, las conserva.
    areas_previas = {
        membresia.empresa_id: [area.id for area in membresia.areas_matriz.all()]
        for membresia in MembresiaEmpresa.objects.filter(usuario=usuario).prefetch_related(
            "areas_matriz"
        )
    }

    def reemplazar():
        MembresiaEmpresa.objects.filter(usuario=usuario).delete()
        for entrada in asignaciones:
            membresia = MembresiaEmpresa.objects.create(
                usuario=usuario,
                empresa=empresas[entrada["empresa_id"]],
                es_predeterminada=entrada["empresa_id"] == predeterminada,
            )
            membresia.roles.set([roles[rol] for rol in entrada.get("roles", [])])
            # El rol de nivel no se elige a mano: lo pone el cargo de la
            # persona en el organigrama (ver `organizacion.roles_de_cargo`).
            from apps.organizacion.roles_de_cargo import ajustar_membresia

            ajustar_membresia(membresia)
            elegidas = entrada.get("areas")
            if elegidas is None:
                elegidas = areas_previas.get(entrada["empresa_id"], [])
            membresia.areas_matriz.set(elegidas)

    sin_dejar_empresas_sin_gestor(reemplazar)

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


FUERA_DE_SUS_EMPRESAS = (
    "No puede dar ni quitar acceso a empresas en las que usted no trabaja: {empresas}."
)


def _roles_manuales(roles) -> set[int]:
    """Los roles elegidos a mano: los de cargo los pone el organigrama."""
    return {rol.id for rol in roles if getattr(rol, "cargo_organigrama", None) is None}


def _comprobar_alcance(actor, usuario, asignaciones, roles):
    """Nadie reparte lo que no tiene: ni empresas ajenas ni roles con permisos
    que no posee (auditoría de seguridad, 29/10/2026).

    Se mira solo lo que cambia. Las membresías que la cuenta ya tenía en
    empresas fuera del alcance del actor pueden venir tal cual —la ficha manda
    la lista completa—, pero no se pueden añadir, quitar ni cambiar de rol. Y de
    los roles, cuentan los que se añaden a cada membresía: conservar uno que ya
    tenía no es repartirlo. El superusuario y los procesos del sistema
    (`actor=None`) quedan fuera, como en `permisos_que_no_tiene`.
    """
    from apps.permissions.authorization import permisos_que_no_tiene

    if actor is None or actor.is_superuser:
        return

    previas = {
        membresia.empresa_id: _roles_manuales(membresia.roles.all())
        for membresia in MembresiaEmpresa.objects.filter(usuario=usuario).prefetch_related(
            "roles__cargo_organigrama"
        )
    }
    pedidas = {
        entrada["empresa_id"]: _roles_manuales(roles[rol] for rol in entrada.get("roles", []))
        for entrada in asignaciones
    }

    propias = set(empresas_de(actor).values_list("id", flat=True))
    ajenas = sorted(
        empresa_id
        for empresa_id in set(previas) | set(pedidas)
        if empresa_id not in propias and previas.get(empresa_id) != pedidas.get(empresa_id)
    )
    if ajenas:
        nombres = ", ".join(
            Empresa.objects.filter(id__in=ajenas)
            .order_by("nombre")
            .values_list("nombre", flat=True)
        )
        raise PermissionError(FUERA_DE_SUS_EMPRESAS.format(empresas=nombres))

    nuevos = {
        rol_id
        for empresa_id, ids in pedidas.items()
        for rol_id in ids - previas.get(empresa_id, set())
    }
    codenames = {perm.codename for rol_id in nuevos for perm in roles[rol_id].permissions.all()}
    faltantes = permisos_que_no_tiene(actor, codenames)
    if faltantes:
        raise PermissionError(
            "No puede conceder permisos que usted no tiene: " + ", ".join(faltantes) + "."
        )


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
                "areas": sorted(area.nombre for area in membresia.areas_matriz.all()),
            }
            for membresia in membresias_de(usuario)
        ]
    }


def membresias_de(usuario):
    return (
        MembresiaEmpresa.objects.filter(usuario=usuario)
        .select_related("empresa")
        .prefetch_related("roles", "areas_matriz")
    )
