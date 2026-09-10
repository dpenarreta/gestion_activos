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
