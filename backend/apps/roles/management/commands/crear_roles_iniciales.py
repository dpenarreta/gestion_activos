"""Crea el catálogo general de roles con sus permisos.

El sistema tiene un catálogo de 46 permisos y un modelo de roles configurable,
pero una instalación recién migrada llega sin ningún rol: el primer
administrador acaba trabajando como superusuario y, cuando entra el resto del
equipo, o se les da superusuario también o alguien tiene que deducir a mano qué
permisos corresponden a cada puesto. Este comando parte de la tabla del §13 del
documento funcional y la traduce al catálogo.

Los roles son **generales del sistema**, no de un módulo: cada uno junta los
permisos de todos los módulos que le corresponden (inventario y Matriz de
obligaciones). Los dos de cumplimiento vienen de la especificación de la
Matriz (§7).

**Es una plantilla, no una imposición.** Los roles son una decisión de cada
empresa, así que esto no vive en una migración —que los recrearía en cada
entorno y los impondría al arrancar—: se ejecuta una vez y a partir de ahí se
editan desde el panel. Volver a ejecutarlo no pisa lo que se haya cambiado,
salvo que se pida con `--actualizar`.

El quinto rol, «Usuario final», lleva un único permiso —`activos.ver_asignados`—
y ahí está todo su sentido: muestra los equipos de quien pregunta, no el
inventario. Con `activos.ver`, que es el permiso que parece el equivalente,
vería el parque entero, los custodios de todos y los costos.
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
    "Soporte TI": {
        "descripcion": "Registra activos, asignaciones y reparaciones. El trabajo diario.",
        "permisos": [
            "activos.ver",
            "activos.ver_asignados",
            "activos.crear",
            "activos.editar",
            "activos.asignar",
            "activos.imprimir_etiqueta",
            "activos.exportar",
            # Sin `activos.dar_baja`: el §13 pone la aprobación de bajas en el
            # supervisor. Quien opera el inventario a diario no debería poder
            # sacar un equipo del parque sin que nadie más lo mire.
            "organizacion.ver",
            "organizacion.editar",
            "mantenimientos.ver",
            "mantenimientos.registrar",
            "mantenimientos.componentes",
            "mantenimientos.exportar",
            "adjuntos.ver",
            "adjuntos.subir",
            # Sin `adjuntos.eliminar`: un adjunto es evidencia, y borrarla no es
            # parte de la operación.
            "politicas.ver",
            "alertas.ver",
            "reportes.ver",
            "solicitudes.ver",
            "solicitudes.crear",
            # Es a quien se le asignan las compras: sin esto, la bandeja de
            # «Solicitudes recibidas» no la podría atender nadie salvo el
            # administrador.
            "solicitudes.gestionar",
        ],
    },
    "Supervisor TI": {
        "descripcion": "Consulta reportes, aprueba bajas y define las reglas de reemplazo.",
        "permisos": [
            "activos.ver",
            "activos.ver_asignados",
            "activos.dar_baja",
            "activos.exportar",
            # Sin crear ni editar fichas: eso es trabajo de soporte. La
            # separación es la que hace que la aprobación signifique algo.
            "organizacion.ver",
            "mantenimientos.ver",
            "mantenimientos.exportar",
            "politicas.ver",
            "politicas.editar",
            "adjuntos.ver",
            "alertas.ver",
            "alertas.configurar",
            "reportes.ver",
            "reportes.exportar",
            "auditoria.ver",
            "solicitudes.ver",
            "solicitudes.crear",
            # Ve y mueve las de todos, no solo las suyas: es quien tiene que
            # notar que una lleva tres semanas parada en la bandeja de alguien.
            "solicitudes.administrar",
        ],
    },
    "Consulta / Auditoría": {
        "descripcion": "Visualiza información histórica sin modificar datos.",
        "permisos": [
            "activos.ver",
            "activos.ver_asignados",
            "organizacion.ver",
            "mantenimientos.ver",
            "politicas.ver",
            "adjuntos.ver",
            "alertas.ver",
            "reportes.ver",
            "reportes.exportar",
            "auditoria.ver",
            "auditoria.ver_detalle",
            "auditoria.exportar",
            # De la Matriz, lo mismo: ver todo y exportar, sin tocar nada.
            "matriz.ver_todas",
            "matriz.exportar",
            "matriz.ver_auditoria",
            "catalogos.ver",
            # Y los dashboards (de cualquier área), solo para verlos.
            "dashboard.view",
            # Sin `auditoria.ver_ubicacion`: es un dato personal de contexto y
            # se concede aparte, a quien lo necesite y por un motivo concreto
            # (ver docs/data-protection-review.md).
        ],
    },
    "Usuario final": {
        "descripcion": "Consulta los equipos que tiene a su cargo. Nada más.",
        # `activos.ver_asignados` muestra los equipos de quien pregunta, no el
        # inventario. Con `activos.ver` —el que parece el equivalente— vería el
        # parque entero, los custodios de todos y los costos, que es lo
        # contrario de lo que el §13 concede.
        #
        # Pedir sí es suyo: quien necesita una laptop es él, y dejar la
        # solicitud solo en manos de soporte devolvería el pedido al correo,
        # que es de donde este módulo lo saca. `solicitudes.ver` le enseña las
        # propias y ninguna ajena.
        "permisos": [
            "activos.ver_asignados",
            "solicitudes.ver",
            "solicitudes.crear",
        ],
    },
    "Responsable de cumplimiento": {
        "descripcion": "Prepara las obligaciones a su cargo: carga la evidencia y la envía.",
        # Sin `matriz.ver_todas`: ve y actúa solo sobre lo suyo (responsable o
        # suplente), y crea en sus áreas.
        "permisos": [
            "matriz.crear",
            "matriz.editar",
            "matriz.cargar",
            "matriz.enviar",
            "matriz.recordar",
        ],
    },
    "Supervisor de cumplimiento": {
        "descripcion": "Ve todas las obligaciones, valida o devuelve los cierres y cambia fechas.",
        # Sin cargar ni enviar: la separación de funciones es la que da valor a
        # la validación.
        "permisos": [
            "matriz.ver_todas",
            "matriz.cambiar_fecha",
            "matriz.validar",
            "matriz.recordar",
            "matriz.exportar",
            "matriz.ver_auditoria",
        ],
    },
}


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
            codenames = (
                sorted(catalogo) if definicion["permisos"] == "*" else definicion["permisos"]
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
