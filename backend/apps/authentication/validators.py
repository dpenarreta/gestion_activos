"""Reglas de las contraseñas (26/10/2026, decididas por la administración).

- Al menos 8 caracteres (el `MinimumLengthValidator` de Django, en settings).
- Al menos una mayúscula, un número y un signo especial
  (`ComplejidadValidator`).
- La nueva no puede ser la **clave temporal** con la que se crean las cuentas
  (`NoClaveTemporalValidator`): esa clave solo sirve para el primer inicio de
  sesión, y en él el sistema obliga a cambiarla por una propia.

La clave temporal se fija sin pasar por estos validadores (la pone el sistema
al crear la cuenta); todo lo que escribe una persona sí pasa por ellos.
"""

from django.conf import settings
from django.core.exceptions import ValidationError


def clave_temporal() -> str:
    return getattr(settings, "CLAVE_INICIAL_USUARIOS", "") or ""


class ComplejidadValidator:
    """Al menos una mayúscula, un número y un signo especial."""

    def validate(self, password, user=None):
        faltan = []
        if not any(c.isupper() for c in password):
            faltan.append("una letra mayúscula")
        if not any(c.isdigit() for c in password):
            faltan.append("un número")
        if not any(not c.isalnum() and not c.isspace() for c in password):
            faltan.append("un signo especial (por ejemplo @, #, $, !, *)")
        if faltan:
            if len(faltan) == 1:
                detalle = faltan[0]
            else:
                detalle = ", ".join(faltan[:-1]) + " y " + faltan[-1]
            raise ValidationError(
                f"La contraseña debe tener al menos {detalle}.", code="password_complejidad"
            )

    def get_help_text(self):
        return (
            "La contraseña debe tener al menos una letra mayúscula, un número y un "
            "signo especial."
        )


class NoClaveTemporalValidator:
    """La contraseña propia no puede ser la clave temporal de las cuentas
    nuevas: la conoce todo el que crea cuentas."""

    def validate(self, password, user=None):
        temporal = clave_temporal()
        if temporal and password == temporal:
            raise ValidationError(
                "Esa es la clave temporal de las cuentas nuevas: elija una propia.",
                code="password_es_temporal",
            )

    def get_help_text(self):
        return "La contraseña no puede ser la clave temporal de las cuentas nuevas."
