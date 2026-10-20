"""Mis herramientas (20/10/2026): las licencias y sistemas que cada persona usa
para su trabajo, externos (Claude, Gmail, Asana…) e internos (Venture, Fenix,
Geolaar, Zimbra…).

- El **catálogo** lo mantiene quien tiene `herramientas.gestionar`.
- Cada persona declara en «Mi perfil» cuáles usa y con qué cuenta.
- Quien gestiona ve **quién usa cada herramienta**: es lo que se necesita al
  hacer una requisición para desactivar, reasignar o pedir licencias nuevas.
  Desde el catálogo también da y quita el acceso a cada persona: es el mismo
  dato que ella ve en «Mis herramientas».
- **Herramientas base por cargo**: con las que, como mínimo, debe venir
  configurado el equipo de quien ocupa el cargo. Se marcan en el perfil del
  cargo (Editar estructura → Perfiles de cargo). En «Mi perfil» la persona ve
  las de su cargo y cuáles todavía no tiene registradas.
"""

from django.db import transaction
from rest_framework.exceptions import ValidationError

from .models import DatosDeContacto, Herramienta, HerramientaDeCargo, HerramientaDeUsuario


def _herramienta(h) -> dict:
    return {
        "id": h.id,
        "nombre": h.nombre,
        "tipo": h.tipo,
        "tipo_display": h.get_tipo_display(),
        "descripcion": h.descripcion,
        "activa": h.activa,
    }


def catalogo(solo_activas=True) -> list[dict]:
    consulta = Herramienta.objects.all()
    if solo_activas:
        consulta = consulta.filter(activa=True)
    return [_herramienta(h) for h in consulta.order_by("tipo", "orden", "nombre")]


def mias(usuario) -> list[dict]:
    return [
        {**_herramienta(u.herramienta), "cuenta": u.cuenta}
        for u in HerramientaDeUsuario.objects.filter(usuario=usuario)
        .select_related("herramienta")
        .order_by("herramienta__tipo", "herramienta__orden", "herramienta__nombre")
    ]


def guardar_mias(usuario, elegidas: list[dict]) -> list[dict]:
    """Reemplaza las herramientas de la persona por las elegidas
    (`[{herramienta: id, cuenta: str}]`). Solo del catálogo activo."""
    ids = [e["herramienta"] for e in elegidas]
    if len(ids) != len(set(ids)):
        raise ValidationError({"herramientas": "Una herramienta aparece dos veces."})
    validas = {h.id: h for h in Herramienta.objects.filter(pk__in=ids, activa=True)}
    faltan = set(ids) - set(validas)
    if faltan:
        raise ValidationError({"herramientas": "Alguna herramienta no está en el catálogo."})
    with transaction.atomic():
        actuales = {
            u.herramienta_id: u for u in HerramientaDeUsuario.objects.filter(usuario=usuario)
        }
        for herramienta_id, registro in actuales.items():
            if herramienta_id not in validas:
                registro.delete()
        for e in elegidas:
            cuenta = (e.get("cuenta") or "").strip()[:150]
            registro = actuales.get(e["herramienta"])
            if registro is None:
                HerramientaDeUsuario.objects.create(
                    usuario=usuario, herramienta=validas[e["herramienta"]], cuenta=cuenta
                )
            elif registro.cuenta != cuenta:
                registro.cuenta = cuenta
                registro.save(update_fields=["cuenta", "updated_at"])
    return mias(usuario)


def uso() -> list[dict]:
    """Cada herramienta del catálogo con quiénes la usan (y con qué cuenta)."""
    por_herramienta: dict[int, list[dict]] = {}
    for u in HerramientaDeUsuario.objects.select_related("usuario").order_by(
        "usuario__first_name", "usuario__last_name"
    ):
        por_herramienta.setdefault(u.herramienta_id, []).append(
            {
                "id": u.usuario_id,
                "nombre": u.usuario.get_full_name().strip() or u.usuario.username,
                "correo": u.usuario.email,
                "cuenta": u.cuenta,
                "activo": u.usuario.is_active,
            }
        )
    return [
        {**h, "usuarios": por_herramienta.get(h["id"], [])} for h in catalogo(solo_activas=False)
    ]


# --- Herramientas base por cargo ---------------------------------------------------------


def base_de(cargo) -> list[dict]:
    """Las herramientas base (activas) del cargo."""
    if cargo is None:
        return []
    return [
        _herramienta(b.herramienta)
        for b in HerramientaDeCargo.objects.filter(cargo=cargo, herramienta__activa=True)
        .select_related("herramienta")
        .order_by("herramienta__tipo", "herramienta__orden", "herramienta__nombre")
    ]


def guardar_base(cargo, ids: list[int]) -> list[int]:
    """Reemplaza las herramientas base del cargo (solo del catálogo)."""
    validas = set(Herramienta.objects.filter(pk__in=ids).values_list("pk", flat=True))
    if validas != set(ids):
        raise ValidationError({"herramientas": "Alguna herramienta no está en el catálogo."})
    with transaction.atomic():
        HerramientaDeCargo.objects.filter(cargo=cargo).exclude(herramienta_id__in=validas).delete()
        ya = set(
            HerramientaDeCargo.objects.filter(cargo=cargo).values_list("herramienta_id", flat=True)
        )
        for herramienta_id in validas - ya:
            HerramientaDeCargo.objects.create(cargo=cargo, herramienta_id=herramienta_id)
    return sorted(validas)


def cargo_de(usuario):
    perfil = DatosDeContacto.objects.filter(usuario=usuario, cargo__isnull=False).first()
    return perfil.cargo if perfil else None


# --- Quién tiene acceso, desde el catálogo -----------------------------------------------


def _persona(u) -> dict:
    return {
        "id": u.usuario_id,
        "nombre": u.usuario.get_full_name().strip() or u.usuario.username,
        "correo": u.usuario.email,
        "cuenta": u.cuenta,
        "activo": u.usuario.is_active,
    }


def usuarios_de(herramienta) -> list[dict]:
    return [
        _persona(u)
        for u in HerramientaDeUsuario.objects.filter(herramienta=herramienta)
        .select_related("usuario")
        .order_by("usuario__first_name", "usuario__last_name")
    ]


def dar_acceso(herramienta, usuario, cuenta="") -> list[dict]:
    """Da (o actualiza) el acceso de una persona de la empresa a la
    herramienta; se refleja en sus «Mis herramientas»."""
    from apps.chat.services import personas_de_la_empresa

    if not personas_de_la_empresa().filter(pk=usuario.pk).exists():
        raise ValidationError({"usuario": "Esa persona no trabaja en esta empresa."})
    if not herramienta.activa:
        raise ValidationError({"herramienta": "La herramienta está desactivada."})
    registro, creado = HerramientaDeUsuario.objects.get_or_create(
        usuario=usuario, herramienta=herramienta, defaults={"cuenta": cuenta.strip()[:150]}
    )
    if not creado and registro.cuenta != cuenta.strip()[:150]:
        registro.cuenta = cuenta.strip()[:150]
        registro.save(update_fields=["cuenta", "updated_at"])
    return usuarios_de(herramienta)


def quitar_acceso(herramienta, usuario_id) -> list[dict]:
    HerramientaDeUsuario.objects.filter(herramienta=herramienta, usuario_id=usuario_id).delete()
    return usuarios_de(herramienta)
