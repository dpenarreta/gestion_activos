"""Repara textos guardados con la codificación equivocada.

Síntoma: en pantalla se lee «ReinstalaciÃ³n del sistema» en vez de
«Reinstalación». No es un fallo de la interfaz —el sistema guarda y devuelve
los acentos correctamente, verificado extremo a extremo— sino texto que **ya
entró mal**: alguien lo cargó desde un archivo en Latin-1 tratándolo como
UTF-8, y lo que se guardó fueron esos dos caracteres, no la eñe.

La reparación es exacta y reversible en el sentido matemático: `Ã³` son los dos
bytes de `ó` en UTF-8 interpretados como Latin-1, así que volver a codificar en
Latin-1 y decodificar en UTF-8 devuelve el original. Solo se aplica cuando esa
ida y vuelta produce un texto distinto y válido; si no, el texto se deja como
está.

**Por defecto solo informa.** Reescribir campos de la base es una operación que
nadie debería lanzar sin ver antes qué va a cambiar: con `--aplicar` se
escribe.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

#: Campos de texto donde puede haber quedado el problema. Son los que reciben
#: contenido escrito por personas o importado de archivos.
CAMPOS = {
    "mantenimientos.Mantenimiento": [
        "descripcion",
        "causa",
        "solucion",
        "diagnostico",
        "responsable",
    ],
    "activos.Activo": ["nombre", "marca", "modelo", "observaciones", "proveedor", "motivo_baja"],
    "activos.MovimientoActivo": ["motivo"],
    "organizacion.Empleado": ["nombres", "apellidos", "cargo"],
    "organizacion.Departamento": ["nombre", "descripcion"],
    "organizacion.Sede": ["nombre", "ciudad", "direccion"],
    "organizacion.Ubicacion": ["nombre", "detalle"],
    "adjuntos.Adjunto": ["descripcion", "nombre_original"],
}

#: Secuencias que delatan el problema: siempre empiezan por Ã, Â o â cuando el
#: texto original tenía un acento, una eñe o una raya.
INDICIOS = ("Ã", "Â", "â€")


def reparar(texto: str) -> str | None:
    """Devuelve el texto reparado, o `None` si no hacía falta o no se puede."""
    if not texto or not any(indicio in texto for indicio in INDICIOS):
        return None
    try:
        arreglado = texto.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None
    return arreglado if arreglado != texto else None


class Command(BaseCommand):
    help = "Encuentra (y opcionalmente corrige) textos con la codificación rota."

    def add_arguments(self, parser):
        parser.add_argument(
            "--aplicar",
            action="store_true",
            help="Escribe las correcciones. Sin esto solo se informa de lo que cambiaría.",
        )

    def handle(self, *args, **opciones):
        from django.apps import apps

        pendientes = []
        for ruta, campos in CAMPOS.items():
            etiqueta_app, modelo = ruta.split(".")
            Modelo = apps.get_model(etiqueta_app, modelo)
            for objeto in Modelo.objects.all().iterator():
                cambios = {}
                for campo in campos:
                    arreglado = reparar(getattr(objeto, campo, "") or "")
                    if arreglado is not None:
                        cambios[campo] = arreglado
                if cambios:
                    pendientes.append((Modelo, objeto, cambios))

        if not pendientes:
            self.stdout.write(self.style.SUCCESS("No hay textos con la codificacion rota."))
            return

        self.stdout.write(f"{len(pendientes)} registro(s) con texto mal codificado:\n")
        for Modelo, objeto, cambios in pendientes[:20]:
            self.stdout.write(f"  {Modelo.__name__} #{objeto.pk}")
            for campo, nuevo in cambios.items():
                actual = getattr(objeto, campo)
                self.stdout.write(f"    {campo}: {actual[:50]!r}")
                self.stdout.write(f"         -> {nuevo[:50]!r}")
        if len(pendientes) > 20:
            self.stdout.write(f"  ... y {len(pendientes) - 20} mas.")

        if not opciones["aplicar"]:
            self.stdout.write(
                self.style.WARNING(
                    "\nSimulacion: no se escribio nada. Repita con --aplicar para corregirlo."
                )
            )
            return

        with transaction.atomic():
            for _modelo, objeto, cambios in pendientes:
                for campo, nuevo in cambios.items():
                    setattr(objeto, campo, nuevo)
                # `update_fields` para no pisar nada más del registro ni
                # disparar la lógica de guardado completa.
                objeto.save(update_fields=list(cambios))

        self.stdout.write(self.style.SUCCESS(f"\n{len(pendientes)} registro(s) corregidos."))
