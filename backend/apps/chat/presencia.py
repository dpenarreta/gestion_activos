"""Quién está en línea y cuándo se conectó por última vez (22/10/2026).

Sale de las sesiones: cada una guarda cuándo se usó por última vez
(`Session.last_used_at`, que se escribe como mucho una vez por minuto) y la
pantalla abierta consulta el servidor cada medio minuto. Así:

- **En línea**: tiene una sesión vigente (no cerrada ni vencida) usada en los
  últimos `EN_LINEA` minutos.
- **Última conexión**: el último uso de cualquiera de sus sesiones, o su
  último inicio de sesión si no queda ninguna.

Solo se informa de personas de la empresa activa.
"""

from datetime import timedelta

from django.db.models import Max
from django.utils import timezone

#: Cuánto puede pasar sin señales para seguir «en línea»: la escritura de la
#: actividad (cada minuto) más el refresco de la pantalla (medio minuto), con
#: margen.
EN_LINEA = timedelta(minutes=3)
MAXIMO = 200


def de(ids) -> dict[int, dict]:
    """`{id: {"en_linea": bool, "ultima_conexion": datetime | None}}`."""
    from apps.authentication.models import Session
    from apps.users.models import User

    ids = list({int(i) for i in ids})[:MAXIMO]
    if not ids:
        return {}
    ahora = timezone.now()
    ultimas = dict(
        Session.objects.filter(user_id__in=ids)
        .values("user_id")
        .annotate(ultima=Max("last_used_at"))
        .values_list("user_id", "ultima")
    )
    en_linea = set(
        Session.objects.filter(
            user_id__in=ids,
            revoked_at__isnull=True,
            expires_at__gt=ahora,
            last_used_at__gte=ahora - EN_LINEA,
        ).values_list("user_id", flat=True)
    )
    ingresos = dict(User.objects.filter(pk__in=ids).values_list("pk", "last_login"))
    from . import estados

    elegidos = estados.de([pk for pk in ids if pk in ingresos])
    return {
        pk: {
            "en_linea": pk in en_linea,
            "ultima_conexion": ultimas.get(pk) or ingresos.get(pk),
            # Lo que la persona eligió (almuerzo, vacaciones…), o None.
            "estado": elegidos.get(pk),
        }
        for pk in ids
        if pk in ingresos
    }
