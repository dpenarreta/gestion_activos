"""Enmascara retroactivamente los datos personales ya grabados en la bitácora.

La bitácora es append-only por diseño y esa propiedad es deliberada: un
historial que se puede reescribir no sirve para deslindar responsabilidades.
Este comando es la excepción explícita a esa regla, y existe por dos razones
concretas:

1. El enmascarado de `apps.core.sensitive_data` se aplica al escribir. Los
   eventos anteriores a que un campo entrara en la lista conservan el valor en
   claro — es exactamente lo que pasó al sumar correo, teléfono y documento.
2. Un derecho de supresión no se puede atender si el dato está en una tabla
   que nadie puede tocar.

No borra eventos ni cambia quién hizo qué ni cuándo: solo reemplaza el *valor*
de los campos sensibles por el marcador, dejando intacta la trazabilidad, que
es el propósito de la bitácora.
"""

from django.core.management.base import BaseCommand

from apps.core.models import AuditLog
from apps.core.sensitive_data import mask_sensitive_fields


class Command(BaseCommand):
    help = "Enmascara datos personales en registros de auditoría ya escritos."

    def add_arguments(self, parser):
        parser.add_argument(
            "--aplicar",
            action="store_true",
            help="Aplica los cambios. Sin este parámetro solo informa qué se cambiaría.",
        )

    def handle(self, *args, **options):
        aplicar = options["aplicar"]
        revisados = afectados = 0

        for evento in AuditLog.objects.iterator():
            revisados += 1
            previos = mask_sensitive_fields(evento.previous_values)
            nuevos = mask_sensitive_fields(evento.new_values)

            if previos == evento.previous_values and nuevos == evento.new_values:
                continue

            afectados += 1
            if aplicar:
                evento.previous_values = previos
                evento.new_values = nuevos
                evento.save(update_fields=["previous_values", "new_values"])

        if aplicar:
            self.stdout.write(
                self.style.SUCCESS(
                    f"{revisados} eventos revisados; {afectados} con datos personales enmascarados."
                )
            )
        else:
            self.stdout.write(
                f"{revisados} eventos revisados; {afectados} contienen datos personales en claro."
            )
            self.stdout.write(
                self.style.WARNING("Simulación: vuelva a ejecutarlo con --aplicar para cambiarlos.")
            )
