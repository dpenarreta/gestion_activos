"""Todo empleado tiene su cuenta de usuario (21/10/2026).

Antes el vínculo era opcional: un empleado podía existir solo para custodiar
equipos. Desde ahora un empleado sin cuenta no sirve —no entra a pedir
permisos, ver su rol de pagos ni su onboarding—, así que el alta del empleado
crea también la cuenta, o la ata a la que ya existe con ese correo.

- **Alta individual:** quien crea el empleado escribe una contraseña inicial;
  la persona la cambia obligatoriamente al primer ingreso. Nadie la ve después.
- **Carga masiva:** la cuenta nace sin contraseña utilizable; la persona entra
  con «¿Olvidó su contraseña?» o el administrador le envía el enlace desde
  Usuarios y roles. Así ninguna contraseña viaja en un archivo.

El rol no se elige aquí: se asigna en Configuración → Usuarios y roles. No se
envía ningún correo.
"""

import secrets

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework.exceptions import ValidationError

from .contacto import DOMINIOS_INSTITUCIONALES


def correo_institucional(correo: str) -> str:
    """El correo normalizado, o un error si no es institucional."""
    correo = (correo or "").strip().lower()
    if not correo:
        raise ValidationError(
            {"correo": "Escriba el correo institucional: con él se crea su usuario."}
        )
    if correo.rsplit("@", 1)[-1] not in DOMINIOS_INSTITUCIONALES:
        dominios = ", ".join(f"@{d}" for d in DOMINIOS_INSTITUCIONALES)
        raise ValidationError({"correo": f"Debe ser un correo institucional ({dominios})."})
    return correo


def usuario_existente(correo: str):
    return get_user_model().objects.filter(email__iexact=correo).first()


def problema_con_la_cuenta(correo: str, *, excepto=None) -> str | None:
    """Por qué no se puede usar ese correo, o None. Una cuenta es de un solo
    empleado."""
    from .models import Empleado

    usuario = usuario_existente(correo)
    if usuario is None:
        return None
    otro = Empleado.objects.todas().filter(usuario=usuario)
    if excepto is not None:
        otro = otro.exclude(pk=excepto.pk)
    otro = otro.first()
    if otro:
        return f"El usuario de ese correo ya es de otro empleado: {otro.nombre_completo}."
    return None


def validar_contrasena(correo: str, password: str | None):
    """Una cuenta nueva necesita contraseña inicial; una existente, no."""
    if usuario_existente(correo):
        return
    if not password:
        raise ValidationError(
            {"password": "Escriba la contraseña inicial: la persona la cambiará al entrar."}
        )
    try:
        validate_password(password)
    except Exception as error:  # ValidationError de Django
        raise ValidationError({"password": list(getattr(error, "messages", [str(error)]))})


@transaction.atomic
def cuenta_para_empleado(*, actor, nombres, apellidos, correo, password=None, context=None):
    """La cuenta del empleado: la que ya tiene ese correo o una nueva.

    Sin `password` (carga masiva) la cuenta nace sin contraseña utilizable.
    En los dos casos queda dentro de la empresa activa y con cambio de
    contraseña obligatorio si es nueva.
    """
    from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
    from apps.empresas.models import MembresiaEmpresa
    from apps.users.services import UserAdminService

    correo = correo_institucional(correo)
    problema = problema_con_la_cuenta(correo)
    if problema:
        raise ValidationError({"correo": problema})
    empresa = empresa_actual()
    if empresa is SIN_EMPRESA:
        empresa = None

    usuario = usuario_existente(correo)
    if usuario is not None:
        if empresa is not None:
            MembresiaEmpresa.objects.get_or_create(
                usuario=usuario,
                empresa=empresa,
                defaults={"es_predeterminada": not usuario.membresias.exists()},
            )
        return usuario

    usuario = UserAdminService.create_user(
        actor=actor,
        email=correo,
        password=password or secrets.token_urlsafe(32) + "Aa1!",
        first_name=nombres.strip(),
        last_name=apellidos.strip(),
        empresas=(
            [{"empresa_id": empresa.id, "roles": [], "es_predeterminada": True}]
            if empresa
            else None
        ),
        context=context,
    )
    if not password:
        usuario.set_unusable_password()
    usuario.must_change_password = True
    usuario.save(update_fields=["password", "must_change_password"])
    return usuario
