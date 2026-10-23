"""El sistema trabaja con una sola empresa (23/10/2026).

La separación por empresa sigue por dentro (cada dato tiene su empresa y las
consultas se acotan a ella), pero el despliegue es de una sola: con
`MULTIEMPRESA = False` (el valor por defecto) no se crean otras y toda cuenta
nueva entra a la única empresa, como predeterminada. Así recibe enseguida el
rol de su cargo, que cuelga de esa membresía.

Para volver a trabajar con varias empresas basta con `MULTIEMPRESA=True` en
el .env: lo demás está intacto.
"""

from django.conf import settings
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.users.models import User


def multiempresa() -> bool:
    return bool(getattr(settings, "MULTIEMPRESA", False))


def la_empresa():
    """La empresa del sistema (la primera activa), o None si aún no hay."""
    from .models import Empresa

    return Empresa.objects.filter(activa=True).order_by("id").first()


def unir(usuario) -> None:
    """Pone a la cuenta en la única empresa, si todavía no está en ninguna."""
    from .models import MembresiaEmpresa

    empresa = la_empresa()
    if empresa is None or not usuario.is_active or usuario.membresias.exists():
        return
    MembresiaEmpresa.objects.get_or_create(
        usuario=usuario, empresa=empresa, defaults={"es_predeterminada": True}
    )


@receiver(post_save, sender=User, dispatch_uid="empresas.una_sola.unir_cuenta_nueva")
def unir_cuenta_nueva(sender, instance, created, **kwargs):
    # Al confirmar: quien crea la cuenta puede asignarle la empresa en la
    # misma operación y no hay que duplicarla.
    if created and not multiempresa():
        transaction.on_commit(lambda: unir(instance))
