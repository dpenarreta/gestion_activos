"""«Mi perfil»: cómo se arman el nombre, el correo, el teléfono, el área, la
agencia y el cargo de una persona, y qué le falta completar.

Lo usa la Mesa de ayuda para cargar por defecto los datos de quien pide un
ticket (decidido el 20/10/2026). El orden de las fuentes:

- **Nombre y correo**: los de su cuenta.
- **Teléfono y área**: los de «Mi perfil» y, si no los puso, los de su ficha
  de empleado.
- **Agencia**: la de «Mi perfil» (la ficha de empleado no la guarda).
- **Cargo**: el de «Mi perfil», del catálogo del organigrama. La persona lo
  elige **una sola vez**; después lo cambia solo TI o la administración
  (Estructura → Asignación de cargos), no ella desde «Mi perfil».

Desde el 20/10/2026 los siete datos de `OBLIGATORIOS` son obligatorios para
usar el sistema: mientras falte alguno, al entrar se bloquea con una ventana
que los pide (frontend `AvisoPerfil`). El correo debe ser institucional y no
lo cambia la persona: lo corrige la administración.
"""

from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

from . import perfiles_cargo
from .models import Cargo, DatosDeContacto, Departamento, Sede
from .organigrama import linea_de_supervision, nombre_con_unidad

#: Lo que toda persona debe tener completo para usar el sistema.
OBLIGATORIOS = ("nombres", "apellidos", "correo", "telefono", "area", "agencia", "cargo")

#: Los dominios del correo institucional.
DOMINIOS_INSTITUCIONALES = ("grupolaar.com",)

ETIQUETAS = {
    "nombre": "Nombre y apellido",
    "nombres": "Nombres",
    "apellidos": "Apellidos",
    "correo": "Correo institucional",
    "telefono": "Teléfono",
    "area": "Área",
    "agencia": "Agencia",
    "cargo": "Cargo",
}


CARGO_FIJO = (
    "Su cargo ya está elegido y no puede cambiarlo usted. "
    "Si no es el correcto, pídale a TI o a la administración del sistema que lo cambie."
)


def es_institucional(correo: str) -> bool:
    correo = (correo or "").strip().lower()
    return any(correo.endswith(f"@{dominio}") for dominio in DOMINIOS_INSTITUCIONALES)


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
        "codigo_empleado": usuario.codigo_empleado or "",
        "telefono": (propios.telefono if propios and propios.telefono else "")
        or (empleado.telefono if empleado else ""),
        "area": {"id": area.id, "nombre": area.nombre} if area else None,
        "agencia": {"id": sede.id, "nombre": sede.nombre} if sede else None,
        "cargo": {"id": cargo.id, "nombre": nombre_con_unidad(cargo)} if cargo else None,
        "en_nomina": empleado is not None,
        "cumpleanos": cumpleanos(usuario),
        "aniversario": aniversario(usuario),
        # Lo que se espera de su cargo (perfiles_cargo.py).
        "cargo_perfil": perfiles_cargo.de(cargo) if cargo else None,
        # Sus jefes y a quiénes supervisa, según el organigrama.
        "supervision": linea_de_supervision(usuario, cargo) if cargo else None,
    }
    datos["correo_institucional"] = es_institucional(usuario.email)
    presentes = {
        **datos,
        "nombres": (usuario.first_name or "").strip(),
        "apellidos": (usuario.last_name or "").strip(),
        "correo": datos["correo_institucional"],
    }
    datos["faltan"] = [clave for clave in OBLIGATORIOS if not presentes[clave]]
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
        # El cargo se elige una sola vez: si ya tiene uno, no lo cambia ella.
        if propios.cargo_id and getattr(cargo, "pk", None) != propios.cargo_id:
            raise ValidationError({"cargo": [CARGO_FIJO]})
        propios.telefono = telefono.strip()[:30]
        propios.departamento = departamento
        propios.sede = sede
        propios.cargo = cargo
        propios.save()
        from .roles_de_nivel import sincronizar

        sincronizar(propios.empresa, [usuario])
    return de(usuario)


def cumpleanos(usuario) -> dict:
    """Si muestra su cumpleaños en el calendario, cuál es y desde cuándo lo
    aceptó."""
    propios = _propios(usuario)
    if propios is None or not propios.mostrar_cumpleanos:
        return {"mostrar": False, "dia": None, "mes": None, "aceptado_en": None}
    return {
        "mostrar": True,
        "dia": propios.cumpleanos_dia,
        "mes": propios.cumpleanos_mes,
        "aceptado_en": propios.cumpleanos_aceptado_en,
    }


def guardar_cumpleanos(usuario, *, mostrar, dia=None, mes=None) -> dict:
    """Publica su cumpleaños (día y mes) o lo retira. Retirarlo borra la
    fecha: no se guarda lo que no se muestra."""
    from django.utils import timezone

    with transaction.atomic():
        propios = _propios(usuario) or DatosDeContacto(usuario=usuario)
        if mostrar:
            propios.mostrar_cumpleanos = True
            propios.cumpleanos_dia = dia
            propios.cumpleanos_mes = mes
            propios.cumpleanos_aceptado_en = timezone.now()
        else:
            propios.mostrar_cumpleanos = False
            propios.cumpleanos_dia = None
            propios.cumpleanos_mes = None
            propios.cumpleanos_aceptado_en = None
        propios.save()
    return cumpleanos(usuario)


def aniversario(usuario) -> dict:
    """Si muestra su aniversario en la empresa en el calendario, cuándo
    ingresó y desde cuándo lo aceptó."""
    propios = _propios(usuario)
    if propios is None or not propios.mostrar_aniversario:
        return {"mostrar": False, "dia": None, "mes": None, "anio": None, "aceptado_en": None}
    return {
        "mostrar": True,
        "dia": propios.aniversario_dia,
        "mes": propios.aniversario_mes,
        "anio": propios.aniversario_anio,
        "aceptado_en": propios.aniversario_aceptado_en,
    }


def guardar_aniversario(usuario, *, mostrar, dia=None, mes=None, anio=None) -> dict:
    """Publica su aniversario (día y mes de ingreso, y el año si lo da) o lo
    retira. Retirarlo borra la fecha."""
    from django.utils import timezone

    with transaction.atomic():
        propios = _propios(usuario) or DatosDeContacto(usuario=usuario)
        propios.mostrar_aniversario = bool(mostrar)
        propios.aniversario_dia = dia if mostrar else None
        propios.aniversario_mes = mes if mostrar else None
        propios.aniversario_anio = anio if mostrar else None
        propios.aniversario_aceptado_en = timezone.now() if mostrar else None
        propios.save()
    return aniversario(usuario)
