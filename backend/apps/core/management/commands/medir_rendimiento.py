"""Mide las pantallas críticas contra el parque sembrado (§21).

Mide dos cosas por operación: **tiempo** y **número de consultas SQL**. Lo
segundo importa tanto como lo primero, porque un tiempo alto se puede deber a
una máquina lenta, pero doscientas consultas para pintar veinte filas son
siempre el mismo defecto —una relación que no se precargó— y se ve igual en
cualquier hardware.

Las mediciones pasan por las vistas reales con `APIClient`, no por el ORM
directo: la serialización es parte de lo que tarda, y medir solo la consulta
daría un número optimista que no se parece a lo que espera el usuario.
"""

import statistics
import time

from django.core.management.base import BaseCommand
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.activos.models import Activo
from apps.users.models import User

#: Cada operación se corre varias veces y se informa la mediana: la primera
#: llamada paga la compilación del plan de SQL Server y el arranque de Django,
#: y tomarla como medida diría que el sistema es más lento de lo que es.
REPETICIONES = 5

#: Umbral por encima del cual una pantalla se siente lenta. No es un número
#: mágico: es el punto en que el usuario deja de percibir la respuesta como
#: inmediata y empieza a esperar.
UMBRAL_MS = 1000

#: Consultas por encima de las cuales conviene mirar el código. Un panel que
#: agrega diez indicadores hace legítimamente varias decenas; lo que delata un
#: N+1 es el orden de magnitud, no el número exacto.
UMBRAL_CONSULTAS = 45


def _titulo(texto: str) -> str:
    return f"\n{texto}\n{'─' * len(texto)}"


class Command(BaseCommand):
    help = "Mide el tiempo y las consultas de las pantallas críticas."

    def add_arguments(self, parser):
        parser.add_argument("--repeticiones", type=int, default=REPETICIONES)
        parser.add_argument(
            "--reportes", action="store_true", help="Incluye los trece reportes del §16."
        )

    def handle(self, *args, **opciones):
        total_activos = Activo.objects.count()
        if total_activos < 1000:
            self.stdout.write(
                self.style.WARNING(
                    f"Solo hay {total_activos} activos: la medición no dice nada. "
                    "Ejecute antes `sembrar_datos_rendimiento`."
                )
            )

        usuario = User.objects.filter(is_superuser=True).first()
        if usuario is None:
            usuario = User.objects.create_superuser(
                username="medicion", email="medicion@example.com", password="Sup3r-Secr3t!"
            )
        cliente = APIClient()
        cliente.force_authenticate(user=usuario)
        # Fuera del runner de pruebas, el host «testserver» que usa APIClient
        # no está en ALLOWED_HOSTS y Django responde 400 antes de tocar la
        # vista: la medición saldría en 50 ms y sin una sola consulta.
        cliente.defaults["SERVER_NAME"] = "localhost"

        self.stdout.write(
            self.style.SUCCESS(
                f"\nParque medido: {total_activos} activos, "
                f"{Activo.objects.operativos().count()} operativos."
            )
        )

        # Un código real del parque sembrado: con uno inventado la medición
        # daría 7 ms y un 404, que no mide nada.
        codigo_existente = (
            Activo.objects.values_list("codigo_barras", flat=True).first() or "SIN-ACTIVOS"
        )

        casos = [
            ("Inventario, primera página", "/api/v1/activos/"),
            ("Inventario, página 50", "/api/v1/activos/?page=50"),
            (
                "Inventario, filtros combinados",
                "/api/v1/activos/?estado=en_uso&criticidad=alta&antiguedad_min_meses=24&garantia=vencida",
            ),
            ("Inventario, búsqueda por texto", "/api/v1/activos/?q=Laptop"),
            ("Inventario, filtro por ubicación", "/api/v1/activos/?sede=Matriz Quito"),
            ("Escáner por código de barras", f"/api/v1/activos/por-codigo/{codigo_existente}/"),
            ("Panel principal", "/api/v1/activos/dashboard/"),
            ("Centro de alertas", "/api/v1/alertas/"),
            ("Sugerencias de renovación", "/api/v1/politicas/sugerencias/"),
            ("Bitácora de mantenimientos", "/api/v1/mantenimientos/"),
        ]

        if opciones["reportes"]:
            from apps.reportes.catalogo import CATALOGO

            casos += [
                (f"Reporte: {reporte.nombre}", f"/api/v1/reportes/{reporte.clave}/?formato=xlsx")
                for reporte in CATALOGO
            ]

        self.stdout.write(
            _titulo("Operacion                                 mediana   p.alto  consultas")
        )

        problemas = []
        for etiqueta, url in casos:
            tiempos, consultas, estado = [], 0, None
            for repeticion in range(opciones["repeticiones"]):
                with CaptureQueriesContext(connection) as capturadas:
                    inicio = time.perf_counter()
                    respuesta = cliente.get(url)
                    tiempos.append((time.perf_counter() - inicio) * 1000)
                estado = respuesta.status_code
                if repeticion == 0:
                    consultas = len(capturadas)

            mediana = statistics.median(tiempos)
            maximo = max(tiempos)
            marca = ""
            if estado != 200:
                marca = f" <-- HTTP {estado}"
                problemas.append((etiqueta, f"respondió {estado}"))
            elif mediana > UMBRAL_MS:
                marca = " <-- lento"
                problemas.append((etiqueta, f"{mediana:.0f} ms"))
            elif consultas > UMBRAL_CONSULTAS:
                marca = " <-- muchas consultas"
                problemas.append((etiqueta, f"{consultas} consultas"))

            self.stdout.write(
                f"{etiqueta:<40} {mediana:>7.0f}ms {maximo:>7.0f}ms {consultas:>6}{marca}"
            )

        self.stdout.write(_titulo("Exportación a Excel del inventario completo"))
        inicio = time.perf_counter()
        respuesta = cliente.get("/api/v1/activos/exportar/")
        duracion = (time.perf_counter() - inicio) * 1000
        self.stdout.write(
            f"  {duracion:>7.0f}ms | {len(respuesta.content) / 1024:.0f} KB | HTTP {respuesta.status_code}"
        )

        if problemas:
            self.stdout.write(self.style.WARNING(_titulo("Puntos a revisar")))
            for etiqueta, detalle in problemas:
                self.stdout.write(f"  - {etiqueta}: {detalle}")
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f"\nTodas las operaciones por debajo de {UMBRAL_MS} ms y de 30 consultas."
                )
            )
