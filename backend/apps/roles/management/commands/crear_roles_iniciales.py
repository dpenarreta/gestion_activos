"""Crea los roles que no salen del organigrama: Administrador y Superusuario.

Desde el 21/10/2026 los roles del día a día son los **cargos del organigrama**
(«Jefe TI», «Analista Programador»…; ver `apps.organizacion.roles_de_cargo`):
cada cargo es un rol y los permisos se le marcan a él. Fuera de eso solo hacen
falta los de administración del sistema, para poder asignárselos a alguien:

- **Administrador**: todo el catálogo; configura usuarios, roles y reglas.
- **Superusuario**: todo el catálogo, como rol asignable (aparte de la marca
  `is_superuser` de la cuenta de emergencia).

Volver a ejecutarlo no pisa lo que se haya cambiado, salvo con `--actualizar`.
Antes creaba también roles plantilla por función (Técnico de mesa de ayuda,
Talento Humano, Soporte TI…); ya no.
"""

from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.permissions.catalog import all_codenames
from apps.permissions.models import ModulePermission

#: El catálogo general de roles, traducido al catálogo de permisos.
#:
#: Las exclusiones son la parte que importa, porque son las que separan un rol
#: de otro; cada una lleva su motivo al lado.
ROLES = {
    "Administrador": {
        "descripcion": "Configura usuarios, roles, reglas y auditoría. Acceso completo.",
        # Todo el catálogo: es el rol que existe para no depender de una cuenta
        # de superusuario en el día a día.
        "permisos": "*",
    },
    "Superusuario": {
        "descripcion": "Todo el sistema, para asignar a quien lo administra por completo.",
        "permisos": "*",
    },
}
# Los demás roles salen de los cargos del organigrama (21/10/2026, ver
# `apps.organizacion.roles_de_cargo`): las plantillas por función (Técnico de
# mesa de ayuda, Talento Humano, Soporte TI…) ya no se crean.


class Command(BaseCommand):
    help = "Crea el catálogo general de roles (inventario y Matriz) con sus permisos."

    def add_arguments(self, parser):
        parser.add_argument(
            "--actualizar",
            action="store_true",
            help=(
                "Reescribe los permisos de los roles que ya existen. Sin esto se "
                "respeta lo que se haya ajustado desde el panel."
            ),
        )

    @transaction.atomic
    def handle(self, *args, **opciones):
        content_type = ContentType.objects.get_for_model(ModulePermission)
        disponibles = {
            permiso.codename: permiso
            for permiso in Permission.objects.filter(content_type=content_type)
        }
        catalogo = all_codenames()

        for nombre, definicion in ROLES.items():
            from apps.organizacion.permisos_por_cargo import SOLO_POR_PERSONA

            codenames = (
                sorted(set(catalogo) - SOLO_POR_PERSONA)
                if definicion["permisos"] == "*"
                else definicion["permisos"]
            )

            desconocidos = [c for c in codenames if c not in disponibles]
            if desconocidos:
                # Un permiso del catálogo que no existe en la base significa que
                # falta correr `migrate`: crear el rol a medias dejaría a
                # alguien sin acceso sin explicación visible.
                self.stderr.write(
                    self.style.ERROR(
                        f"Faltan permisos en la base ({', '.join(desconocidos)}). "
                        "Ejecute `manage.py migrate` primero."
                    )
                )
                return

            rol, creado = Group.objects.get_or_create(name=nombre)
            if creado:
                rol.permissions.set([disponibles[c] for c in codenames])
                self.stdout.write(self.style.SUCCESS(f"  + {nombre}: {len(codenames)} permisos"))
            elif opciones["actualizar"]:
                rol.permissions.set([disponibles[c] for c in codenames])
                self.stdout.write(f"  ~ {nombre}: {len(codenames)} permisos (reescrito)")
            else:
                self.stdout.write(
                    f"  = {nombre}: ya existe, se conserva como está "
                    f"({rol.permissions.count()} permisos). Use --actualizar para reescribirlo."
                )

        self.stdout.write(
            "\nLos roles son una plantilla: ajustelos desde Usuarios y roles > Roles.\n"
            "Para que 'Usuario final' sirva, cada cuenta debe estar enlazada a su "
            "ficha de empleado desde Organizacion > Empleados: es ese vinculo el que "
            "dice que equipos son suyos."
        )
