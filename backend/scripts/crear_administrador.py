"""Crea el primer administrador en el servidor de aplicaciones (docs/despliegue-iis.md).

Lo llama scripts/deploy/crear-administrador.ps1, que pide los datos en la
máquina de quien despliega y los manda por WinRM. Los recibe por variables de
entorno (nunca por argumentos: los argumentos de un proceso se ven en la lista
de procesos del servidor):

    ADMIN_USUARIO, ADMIN_CORREO, ADMIN_NOMBRES, ADMIN_APELLIDOS, ADMIN_CLAVE

La contraseña pasa por los validadores del sistema (largo, que no sea común ni
parecida al usuario). La cuenta queda como superusuario, en la única empresa,
y nunca se imprime la contraseña.
"""

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)
os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings.production"


def main() -> int:
    import django

    django.setup()
    from django.contrib.auth import get_user_model
    from django.contrib.auth.password_validation import validate_password
    from django.core.exceptions import ValidationError

    from apps.empresas.una_sola import unir

    usuario = os.environ.get("ADMIN_USUARIO", "").strip()
    correo = os.environ.get("ADMIN_CORREO", "").strip().lower()
    nombres = os.environ.get("ADMIN_NOMBRES", "").strip()
    apellidos = os.environ.get("ADMIN_APELLIDOS", "").strip()
    clave = os.environ.get("ADMIN_CLAVE", "")

    faltan = [
        n for n, v in (("usuario", usuario), ("correo", correo), ("contraseña", clave)) if not v
    ]
    if faltan:
        print("ADMIN_ERROR Faltan: " + ", ".join(faltan))
        return 1

    User = get_user_model()
    if User.objects.filter(username__iexact=usuario).exists():
        print(f"ADMIN_ERROR Ya existe una cuenta con el usuario «{usuario}».")
        return 1
    if User.objects.filter(email__iexact=correo).exists():
        print(f"ADMIN_ERROR Ya existe una cuenta con el correo {correo}.")
        return 1

    cuenta = User(
        username=usuario,
        email=correo,
        first_name=nombres,
        last_name=apellidos,
        is_staff=True,
        is_superuser=True,
        must_change_password=False,
    )
    try:
        validate_password(clave, user=cuenta)
    except ValidationError as error:
        print("ADMIN_ERROR La contraseña no cumple: " + " ".join(error.messages))
        return 1
    cuenta.set_password(clave)
    cuenta.save()
    # Con una sola empresa la cuenta entra a ella como predeterminada.
    unir(cuenta)
    print(f"ADMIN_OK {cuenta.username} ({cuenta.email}) · superusuario · id {cuenta.pk}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
