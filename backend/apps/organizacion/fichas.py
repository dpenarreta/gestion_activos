"""La ficha de empleado de cada persona, a partir de su cuenta (16/11/2026).

Inventario, actas y otros módulos eligen a la persona por su ficha de
`Empleado` (con área), no por su cuenta de usuario. En producción las
personas llegaron como cuentas desde nómina (US-021), que solo trae código,
cédula, nombre y correo, y nadie les creó la ficha: «Nuevo responsable» al
asignar un equipo salía vacío.

Decisión del usuario: toda persona de nómina tiene ficha, aunque su cuenta
esté inactiva. El área y el cargo salen de Mi perfil (`DatosDeContacto`);
quien aún no los llenó queda en «Sin área asignada» hasta que lo haga.

Se mantiene al día:
- al terminar cada sincronización de nómina (`apps.nomina.empleados`);
- al guardar Mi perfil (señal `post_save` de `DatosDeContacto`);
- con `manage.py sincronizar_fichas_empleado` (la carga inicial).

No pisa un área real con «Sin área asignada»: si la ficha ya tenía área y el
perfil no dice ninguna, se queda la que tenía.
"""

import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa

from .models import DatosDeContacto, Departamento, Empleado

logger = logging.getLogger(__name__)

AREA_PENDIENTE = "Sin área asignada"
CODIGO_AREA_PENDIENTE = "SINAREA"
DOMINIO_RESERVADO = "@sin-correo.invalid"


def _empresa_de(usuario):
    membresia = (
        usuario.membresias.select_related("empresa").order_by("-es_predeterminada", "id").first()
    )
    if membresia is not None:
        return membresia.empresa
    # Las cuentas de nómina nacen sin membresía: son de la empresa de nómina,
    # que hoy es la única (o la primera).
    return Empresa.objects.order_by("id").first()


def area_pendiente(empresa):
    area = (
        Departamento.objects.todas().filter(empresa=empresa, codigo=CODIGO_AREA_PENDIENTE).first()
    )
    if area is None:
        area = Departamento.objects.create(
            empresa=empresa,
            nombre=AREA_PENDIENTE,
            codigo=CODIGO_AREA_PENDIENTE,
            descripcion=(
                "Personas de nómina que aún no indicaron su área en Mi perfil. "
                "Cada una pasa a su área al completarlo."
            ),
        )
    return area


def es_persona_de_nomina(usuario) -> bool:
    return bool(usuario.is_active or (usuario.codigo_empleado or "").strip())


def asegurar_ficha(usuario):
    """Crea o actualiza la ficha de la persona. Devuelve `(ficha, cambio)` o
    `(None, False)` si la cuenta no es de una persona de nómina o el código
    ya lo usa otra ficha."""
    if usuario.is_superuser and not (usuario.codigo_empleado or "").strip():
        return None, False
    if not es_persona_de_nomina(usuario):
        return None, False
    empresa = _empresa_de(usuario)
    if empresa is None:
        return None, False

    with usando_empresa(empresa), transaction.atomic():
        contacto = (
            DatosDeContacto.objects.todas()
            .filter(usuario=usuario)
            .select_related("departamento", "cargo")
            .order_by("-updated_at")
            .first()
        )
        codigo = (usuario.codigo_empleado or "").strip()
        ficha = Empleado.objects.todas().filter(usuario=usuario).first()
        if ficha is None and codigo:
            ficha = Empleado.objects.todas().filter(empresa=empresa, codigo_empleado=codigo).first()
            if ficha is not None and ficha.usuario_id not in (None, usuario.pk):
                logger.warning(
                    "Ficha de empleado: el código %s ya es de otra persona (cuenta %s).",
                    codigo,
                    usuario.pk,
                )
                return None, False

        area = contacto.departamento if contacto and contacto.departamento_id else None
        correo = usuario.email if not usuario.email.endswith(DOMINIO_RESERVADO) else ""
        valores = {
            "nombres": (usuario.first_name or usuario.username).strip()[:150],
            "apellidos": (usuario.last_name or "").strip()[:150],
            "correo": correo,
            "activo": True,
        }
        if contacto and contacto.cargo_id:
            valores["cargo"] = contacto.cargo.nombre[:120]

        if ficha is None:
            ficha = Empleado(
                empresa=empresa,
                usuario=usuario,
                codigo_empleado=codigo,
                departamento=area or area_pendiente(empresa),
                **valores,
            )
            ficha.save()
            return ficha, True

        cambios = []
        for campo, valor in valores.items():
            if getattr(ficha, campo) != valor:
                setattr(ficha, campo, valor)
                cambios.append(campo)
        if ficha.usuario_id is None:
            ficha.usuario = usuario
            cambios.append("usuario")
        if area is not None and ficha.departamento_id != area.id:
            ficha.departamento = area
            cambios.append("departamento")
        if codigo and not ficha.codigo_empleado:
            ficha.codigo_empleado = codigo
            cambios.append("codigo_empleado")
        if cambios:
            ficha.save(update_fields=[*cambios, "updated_at"])
        return ficha, bool(cambios)


def sincronizar_fichas():
    """Todas las personas de nómina: crea las fichas que faltan y pone al día
    las demás. Devuelve un resumen."""
    User = get_user_model()
    personas = User.objects.filter(
        Q(is_active=True) | (Q(codigo_empleado__isnull=False) & ~Q(codigo_empleado=""))
    ).order_by("id")
    creadas = actualizadas = omitidas = 0
    # Una lista y no `.iterator()`: con SQL Server (sin MARS) un cursor abierto
    # no admite otras consultas en medio («Error en la secuencia de función»).
    for usuario in list(personas):
        antes = Empleado.objects.todas().filter(usuario=usuario).exists()
        ficha, cambio = asegurar_ficha(usuario)
        if ficha is None:
            omitidas += 1
        elif not antes:
            creadas += 1
        elif cambio:
            actualizadas += 1
    logger.info(
        "Fichas de empleado: %s creadas, %s actualizadas, %s omitidas",
        creadas,
        actualizadas,
        omitidas,
    )
    return {"creadas": creadas, "actualizadas": actualizadas, "omitidas": omitidas}


# --- Al guardar Mi perfil ------------------------------------------------------


@receiver(post_save, sender=DatosDeContacto, dispatch_uid="organizacion.ficha_desde_perfil")
def _ficha_desde_perfil(sender, instance, raw=False, **kwargs):
    if raw:
        return
    try:
        asegurar_ficha(instance.usuario)
    except Exception:  # noqa: BLE001 — guardar el perfil no debe fallar por esto
        logger.exception("No se pudo poner al día la ficha de empleado de %s", instance.usuario_id)
