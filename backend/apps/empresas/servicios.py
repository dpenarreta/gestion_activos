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


def asignar_empresas(*, actor, usuario, empresa_ids, predeterminada=None, context=None):
    """Define en qué empresas trabaja una cuenta.

    Reemplaza la lista completa en vez de sumar y restar: quien administra
    accesos piensa en «esta persona ve estas dos», no en «añade una y quita
    otra», y una operación incremental deja el estado final dependiendo de cuál
    era el anterior, que es justo lo que no se quiere al revisar accesos.

    Se prohíbe dejarse a uno mismo sin ninguna. No es paternalismo: con dos
    empresas o más, la cuenta que se queda sin membresías deja de ver todo y ya
    no puede ni devolverse el acceso —tendría que pedírselo a otro
    administrador, o al superusuario si queda alguno—.
    """
    from django.db import transaction

    from apps.core.audit import record_audit_event

    empresas = list(Empresa.objects.filter(id__in=empresa_ids))
    if len(empresas) != len(set(empresa_ids)):
        faltantes = sorted(set(empresa_ids) - {empresa.id for empresa in empresas})
        raise ValueError(f"Empresas inexistentes: {faltantes}.")

    if (
        actor is not None
        and actor.pk == usuario.pk
        and not empresas
        and Empresa.objects.filter(activa=True).count() > 1
    ):
        raise PermissionError(AUTOEXCLUSION)

    if predeterminada is not None and predeterminada not in {empresa.id for empresa in empresas}:
        raise ValueError("La empresa predeterminada tiene que estar entre las asignadas.")
    if predeterminada is None and empresas:
        # Sin una elegida se toma la primera por nombre: entrar cada día en una
        # empresa distinta según cómo ordenara la consulta es peor que entrar
        # siempre en la misma aunque no sea la que uno habría elegido.
        predeterminada = min(empresas, key=lambda empresa: empresa.nombre).id

    anteriores = list(MembresiaEmpresa.objects.filter(usuario=usuario).select_related("empresa"))

    with transaction.atomic():
        MembresiaEmpresa.objects.filter(usuario=usuario).delete()
        MembresiaEmpresa.objects.bulk_create(
            [
                MembresiaEmpresa(
                    usuario=usuario,
                    empresa=empresa,
                    es_predeterminada=empresa.id == predeterminada,
                )
                for empresa in empresas
            ]
        )

    record_audit_event(
        actor=actor,
        action="user.empresas_assigned",
        target=usuario,
        module="empresas",
        previous_values={
            "empresa_ids": [m.empresa_id for m in anteriores],
            "empresas": [m.empresa.nombre for m in anteriores],
        },
        new_values={
            "empresa_ids": [empresa.id for empresa in empresas],
            "empresas": [empresa.nombre for empresa in empresas],
            "predeterminada": predeterminada,
        },
        context=context,
    )
    return usuario


def membresias_de(usuario):
    return MembresiaEmpresa.objects.filter(usuario=usuario).select_related("empresa")
