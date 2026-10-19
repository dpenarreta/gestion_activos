"""«Mi perfil»: cómo se arman el nombre, el correo, el teléfono, el área, la
agencia y el cargo de una persona, y qué le falta completar.

Lo usa la Mesa de ayuda para cargar por defecto los datos de quien pide un
ticket (decidido el 20/10/2026). El orden de las fuentes:

- **Nombre y correo**: los de su cuenta.
- **Teléfono y área**: los de «Mi perfil» y, si no los puso, los de su ficha
  de empleado.
- **Agencia**: la de «Mi perfil» (la ficha de empleado no la guarda).
- **Cargo**: el de «Mi perfil», de un catálogo. No es obligatorio: el
  catálogo empieza vacío.
"""

from django.db import transaction

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

from .models import Cargo, DatosDeContacto, Departamento, Sede
from .organigrama import nombre_con_unidad

#: Lo que debe tener completo quien pide soporte.
OBLIGATORIOS = ("nombre", "telefono", "area", "agencia")

ETIQUETAS = {
    "nombre": "Nombre y apellido",
    "telefono": "Teléfono",
    "area": "Área",
    "agencia": "Agencia",
}


def _propios(usuario):
    return (
        DatosDeContacto.objects.filter(usuario=usuario)
        .select_related("departamento", "sede", "cargo__unidad")
        .first()
    )


def _empleado(usuario):
    empleado = getattr(usuario, "empleado", None)
    if empleado is None or not empleado.activo:
        return None
    actual = empresa_actual()
    if actual not in (None, SIN_EMPRESA) and empleado.empresa_id != actual.id:
        return None
    return empleado


def de(usuario) -> dict:
    """Los datos de contacto de la persona en la empresa activa, con lo que
    falta (`faltan`)."""
    propios = _propios(usuario)
    empleado = _empleado(usuario)
    area = (propios.departamento if propios and propios.departamento_id else None) or (
        empleado.departamento if empleado else None
    )
    sede = propios.sede if propios and propios.sede_id else None
    cargo = propios.cargo if propios and propios.cargo_id else None
    datos = {
        "nombre": usuario.get_full_name().strip(),
        "nombres": usuario.first_name,
        "apellidos": usuario.last_name,
        "correo": usuario.email,
        "telefono": (propios.telefono if propios and propios.telefono else "")
        or (empleado.telefono if empleado else ""),
        "area": {"id": area.id, "nombre": area.nombre} if area else None,
        "agencia": {"id": sede.id, "nombre": sede.nombre} if sede else None,
        "cargo": {"id": cargo.id, "nombre": nombre_con_unidad(cargo)} if cargo else None,
        "en_nomina": empleado is not None,
    }
    datos["faltan"] = [clave for clave in OBLIGATORIOS if not datos[clave]]
    return datos


def opciones() -> dict:
    """Las áreas, agencias y cargos de la empresa activa, para elegir."""
    return {
        "areas": [
            {"id": d.id, "nombre": d.nombre}
            for d in Departamento.objects.filter(activo=True).order_by("nombre")
        ],
        "agencias": [
            {"id": s.id, "nombre": s.nombre, "ciudad": s.ciudad}
            for s in Sede.objects.filter(activa=True).order_by("nombre")
        ],
        # Con su unidad: el mismo nombre se repite entre unidades.
        "cargos": [
            {"id": c.id, "nombre": nombre_con_unidad(c)}
            for c in Cargo.objects.filter(activo=True)
            .select_related("unidad")
            .order_by("unidad__nombre", "nombre")
        ],
    }


def guardar(usuario, *, nombres, apellidos, telefono, departamento, sede, cargo=None) -> dict:
    """Actualiza su nombre (en la cuenta) y su teléfono, área, agencia y cargo
    (en «Mi perfil»)."""
    with transaction.atomic():
        usuario.first_name = nombres.strip()[:150]
        usuario.last_name = apellidos.strip()[:150]
        usuario.save(update_fields=["first_name", "last_name", "updated_at"])
        propios = _propios(usuario) or DatosDeContacto(usuario=usuario)
        propios.telefono = telefono.strip()[:30]
        propios.departamento = departamento
        propios.sede = sede
        propios.cargo = cargo
        propios.save()
    return de(usuario)
