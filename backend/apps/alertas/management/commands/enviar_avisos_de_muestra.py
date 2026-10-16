"""Manda a un buzón una muestra de cada aviso que el sistema puede producir.

Existe para lo que ninguna prueba automatizada puede contestar: **cómo se ve
esto al llegar**. Los clientes de correo corporativos descartan hojas de estilo,
recortan anchos y tratan las tablas a su manera; que la plantilla se dibuje bien
en el navegador no dice nada sobre lo que aparece en Outlook a las siete de la
mañana.

No toca la base de datos. Arma los objetos en memoria y los pasa por la **misma
plantilla y el mismo envío** que usa el sistema de verdad, así lo que llega es
exactamente lo que llegaría. Por eso tampoco hace falta ensuciar el inventario
con equipos de prueba para revisar un texto.

    python manage.py enviar_avisos_de_muestra --a alguien@empresa.com
"""

import datetime

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.activos.models import Activo, TipoDispositivo
from apps.alertas import eventos
from apps.mantenimientos.models import Mantenimiento
from apps.organizacion.models import Departamento


def _equipo() -> Activo:
    """Un equipo verosímil, sin guardar nada."""
    return Activo(
        id=0,
        codigo_barras="GA-LAP-000042",
        nombre="Laptop Contabilidad 02",
        marca="Dell",
        modelo="Latitude 5440",
        numero_serie="DL5440-00042",
        tipo=TipoDispositivo(nombre="Laptop", codigo="LAP"),
        departamento=Departamento(nombre="Contabilidad", codigo="CTB"),
    )


def _intervencion(**extra) -> Mantenimiento:
    datos = {
        "activo": _equipo(),
        "tipo": Mantenimiento.Tipo.CORRECTIVO,
        "fecha_intervencion": datetime.date(2026, 9, 14),
        "responsable": "Soporte TI",
        "descripcion": "Reemplazo de disco y reinstalación del sistema",
        "causa": "No enciende: arranca y se apaga a los pocos segundos",
    }
    datos.update(extra)
    return Mantenimiento(**datos)


def muestras() -> list[tuple[str, str, Mantenimiento, str]]:
    """Cada situación que el sistema puede avisar hoy.

    Se define aquí y no en el comando para que una prueba pueda comprobar que
    todas las plantillas se dibujan sin mandar un solo correo.
    """
    return [
        (
            "Llegó el equipo que pidió",
            "activos.llego_lo_solicitado",
            _intervencion(),
            "Alguien pidió el equipo y ya está registrado. Un alta que nadie "
            "pidió no avisa a nadie.",
        ),
        (
            "Entra al taller",
            "mantenimientos.entrada",
            _intervencion(),
            "El equipo entra a reparación; pasa a «En reparación» en su ficha.",
        ),
        (
            "Vuelve reparado",
            "mantenimientos.salida",
            _intervencion(
                fecha_salida=datetime.date(2026, 9, 17),
                estado_final=Mantenimiento.EstadoFinal.REPARADO,
                solucion="Se cambió el disco por uno de 512 GB y se restauró el respaldo.",
            ),
            "Vuelve reparado y regresa al estado en que entró.",
        ),
        (
            "Vuelve pendiente",
            "mantenimientos.salida",
            _intervencion(
                fecha_salida=datetime.date(2026, 9, 16),
                estado_final=Mantenimiento.EstadoFinal.PENDIENTE,
                solucion="Falta la fuente de poder; se pidió al proveedor.",
            ),
            "Vuelve sin terminar: la pieza no llegó.",
        ),
        (
            "No reparable",
            "mantenimientos.salida",
            _intervencion(
                fecha_salida=datetime.date(2026, 9, 18),
                estado_final=Mantenimiento.EstadoFinal.NO_REPARABLE,
                solucion="Daño en la placa madre; el costo supera el de un equipo nuevo.",
            ),
            "No tiene arreglo: se queda en el taller hasta que alguien decida la baja.",
        ),
        (
            "Mantenimiento preventivo",
            "mantenimientos.entrada",
            _intervencion(
                tipo=Mantenimiento.Tipo.PREVENTIVO,
                causa="",
                descripcion="Limpieza interna y cambio de pasta térmica",
            ),
            "Un preventivo, sin causa de avería.",
        ),
        (
            "Reparación de un proveedor externo",
            "mantenimientos.salida",
            _intervencion(
                tipo_responsable=Mantenimiento.TipoResponsable.PROVEEDOR_EXTERNO,
                responsable="Tecnomega C.A.",
                fecha_salida=datetime.date(2026, 9, 25),
                estado_final=Mantenimiento.EstadoFinal.REPARADO,
                solucion="Cambio de bisagras en garantía.",
            ),
            "Atendida por un proveedor; once días fuera de operación.",
        ),
    ]


def variables_de_muestra(clave: str, mantenimiento) -> dict:
    """Las variables de una muestra, como las armaría el aviso de verdad."""
    from apps.activos import notificaciones as de_activos
    from apps.mantenimientos import notificaciones as de_mantenimientos

    if clave == "activos.llego_lo_solicitado":
        datos = de_activos.variables(mantenimiento.activo)
    else:
        datos = de_mantenimientos.variables(mantenimiento)
    return {**datos, "enlace": f"{settings.FRONTEND_URL.rstrip('/')}/admin/activos/42"}


class Command(BaseCommand):
    help = "Envía una muestra de cada aviso a un buzón, para revisar cómo se ven."

    def add_arguments(self, parser):
        parser.add_argument(
            "--a",
            dest="destino",
            required=True,
            help="Buzón que recibirá las muestras.",
        )

    def handle(self, *args, **opciones):
        destino = opciones["destino"].strip()
        if "@" not in destino:
            raise CommandError(f"«{destino}» no parece una dirección de correo.")

        lista = muestras()
        self.stdout.write(
            f"Enviando {len(lista)} muestras a {destino} por {settings.EMAIL_HOST}.\n"
        )

        fallos = 0
        for numero, (titulo, clave, mantenimiento, explicacion) in enumerate(lista, start=1):
            salio = eventos.enviar(
                clave=clave,
                variables=variables_de_muestra(clave, mantenimiento),
                prefijo_asunto=f"[Muestra {numero}/{len(lista)}] {titulo} · ",
                destinatarios=eventos.Destinatarios(direcciones=[destino]),
            )
            if salio:
                self.stdout.write(self.style.SUCCESS(f"  [ok]    {titulo} — {explicacion}"))
            else:
                fallos += 1
                self.stdout.write(self.style.ERROR(f"  [falla] {titulo}"))

        if fallos:
            raise CommandError(f"{fallos} muestra(s) no salieron. Revise el registro.")
        self.stdout.write("\nRevise también la carpeta de correo no deseado.")
