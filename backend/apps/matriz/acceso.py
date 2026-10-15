"""Quién puede qué en la Matriz, empresa por empresa (§8).

Los permisos `matriz.*` salen del rol de la **membresía** en cada empresa; el
superusuario los tiene todos en todas. Aquí se resuelven para una empresa
concreta —no solo la activa—, que es lo que necesita el selector para decir con
qué rol se entraría a cada una.
"""

from django.contrib.auth.models import Permission

from apps.permissions.catalog import PERMISSION_CATALOG

TODAS_LAS_CAPACIDADES = sorted(PERMISSION_CATALOG["matriz"]["permissions"])


def capacidades_en(usuario, empresa) -> list[str]:
    """Los permisos `matriz.*` de la cuenta en esa empresa."""
    if usuario.is_superuser:
        return list(TODAS_LAS_CAPACIDADES)
    if not empresa.activa:
        # Una empresa inactiva no da acceso a nadie (§8.3).
        return []
    return sorted(
        set(
            Permission.objects.filter(
                codename__startswith="matriz.",
                group__membresias__usuario=usuario,
                group__membresias__empresa=empresa,
            ).values_list("codename", flat=True)
        )
    )
