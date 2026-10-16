"""`python manage.py reprocesar_dashboards [--aplicar] [--dashboard ID]`

Recalcula el contenido almacenado de los dashboards con el código de cálculo vigente, usando la
misma fuente y la misma fecha de corte que ya tenían. Alcanza a todo componente con mapeo, tanto
las 13 posiciones fijas como las de la Zona Personal (donde el Dashboard Directorio tiene sus 8
secciones). No toca el título: ese lo escribió una persona.

**Simula por defecto.** Sin `--aplicar` no escribe nada: solo informa qué cambiaría. Es a propósito
— los valores que muestra un dashboard son lo que la gente mira para tomar decisiones, así que
conviene ver el diff antes de moverlos.
"""

import json

from django.core.management.base import BaseCommand

from apps.cartera.services import reproceso


def _resumir(valor, limite=90):
    texto = json.dumps(valor, ensure_ascii=False, default=str)
    return texto if len(texto) <= limite else texto[:limite - 1] + '…'


class Command(BaseCommand):
    help = 'Recalcula el contenido almacenado de los dashboards. Simula salvo que se pase --aplicar.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--aplicar', action='store_true',
            help='Escribe los cambios. Sin esta bandera solo se informa qué cambiaría.',
        )
        parser.add_argument(
            '--dashboard', dest='dashboard_id', default=None,
            help='Reprocesa un solo dashboard por su id (slug). Por defecto, todos.',
        )
        parser.add_argument(
            '--detalle', action='store_true',
            help='Muestra el valor anterior y el nuevo de cada componente que cambia.',
        )

    def handle(self, *args, **opciones):
        aplicar = opciones['aplicar']
        detalle = opciones['detalle']
        ids = [opciones['dashboard_id']] if opciones['dashboard_id'] else reproceso.dashboards_con_layout()

        if not ids:
            self.stdout.write('No hay dashboards con layout.')
            return

        modo = 'APLICANDO CAMBIOS' if aplicar else 'SIMULACIÓN (no se escribe nada)'
        self.stdout.write(self.style.MIGRATE_HEADING(f'{modo} — {len(ids)} dashboard(s)'))

        total_cambios = 0
        con_cambios = 0
        omitidos = []

        for dashboard_id in ids:
            resultado = reproceso.aplicar_dashboard(dashboard_id) if aplicar else reproceso.analizar_dashboard(dashboard_id)

            if not resultado['ok']:
                omitidos.append((dashboard_id, resultado['motivo']))
                continue

            cambios = resultado['cambios']
            if not cambios:
                self.stdout.write(f'  {dashboard_id}: sin cambios ({resultado["filas"]} filas, corte {resultado["fecha_corte"]})')
                continue

            con_cambios += 1
            total_cambios += len(cambios)
            verbo = 'actualizado(s)' if aplicar else 'cambiaría(n)'
            self.stdout.write(self.style.WARNING(
                f'  {dashboard_id}: {len(cambios)} componente(s) {verbo} '
                f'({resultado["filas"]} filas, corte {resultado["fecha_corte"]})'
            ))
            for cambio in cambios:
                # Un componente oculto también se recalcula (puede volver a mostrarse), pero hay que
                # decirlo: si no, una lista de ids que nadie ve en pantalla parece un error.
                marca = '' if cambio.get('visible', True) else '  (oculto)'
                self.stdout.write(f'      - {cambio["component_id"]}{marca}')
                if detalle:
                    self.stdout.write(f'          antes:   {_resumir(cambio["antes"])}')
                    self.stdout.write(f'          después: {_resumir(cambio["despues"])}')

        if omitidos:
            self.stdout.write('')
            self.stdout.write('Omitidos:')
            for dashboard_id, motivo in omitidos:
                self.stdout.write(f'  {dashboard_id}: {motivo}')

        self.stdout.write('')
        resumen = f'{con_cambios} dashboard(s) con cambios, {total_cambios} componente(s) en total.'
        if aplicar:
            self.stdout.write(self.style.SUCCESS(f'Listo. {resumen}'))
        else:
            self.stdout.write(self.style.SUCCESS(f'Simulación terminada. {resumen}'))
            if total_cambios:
                self.stdout.write('Volvé a ejecutarlo con --aplicar para escribir los cambios.')
