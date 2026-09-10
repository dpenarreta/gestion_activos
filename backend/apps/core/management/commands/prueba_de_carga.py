"""Prueba de carga contra un servidor en marcha (§21, «Rendimiento»).

`medir_rendimiento` mide una petición a la vez y responde «cuánto tarda esto».
Esta prueba responde otra cosa: **qué pasa cuando veinte personas lo usan al
mismo tiempo**, que es la pregunta real de un sistema de soporte donde todo el
equipo trabaja a la misma hora. Un endpoint de 300 ms en solitario puede
degradarse a cuatro segundos con concurrencia si compite por conexiones a la
base de datos.

Habla HTTP contra un servidor real —no `APIClient`— porque el objetivo incluye
lo que el cliente de prueba se salta: el servidor WSGI, el pool de conexiones y
la serialización completa.

Informa la mediana y el percentil 95. La mediana dice cómo se siente el sistema
normalmente; el p95 dice cómo se siente en el peor de cada veinte intentos, que
es el número que produce las quejas.
"""

import statistics
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from django.core.management.base import BaseCommand, CommandError

#: Rutas que se golpean, con su peso. Reflejan el uso real: el inventario y el
#: escáner se consultan muchas veces al día; el panel, unas pocas.
ESCENARIO = [
    ("Inventario", "/api/v1/activos/?page=2", 5),
    ("Inventario filtrado", "/api/v1/activos/?estado=en_uso&criticidad=alta", 3),
    ("Búsqueda", "/api/v1/activos/?q=Laptop", 3),
    ("Bitácora", "/api/v1/mantenimientos/", 2),
    ("Panel principal", "/api/v1/activos/dashboard/", 1),
    ("Centro de alertas", "/api/v1/alertas/", 1),
]


class Command(BaseCommand):
    help = "Lanza peticiones concurrentes contra un servidor en marcha y mide la degradación."

    def add_arguments(self, parser):
        parser.add_argument("--url", default="http://127.0.0.1:8011")
        parser.add_argument("--usuario", default="carga")
        parser.add_argument("--password", default="Sup3r-Secr3t!")
        parser.add_argument("--usuarios", type=int, default=20, help="Peticiones simultáneas.")
        parser.add_argument("--rondas", type=int, default=5, help="Vueltas al escenario.")

    def handle(self, *args, **opciones):
        base = opciones["url"].rstrip("/")

        respuesta = requests.post(
            f"{base}/api/v1/auth/login/",
            json={"identifier": opciones["usuario"], "password": opciones["password"]},
            timeout=30,
        )
        if respuesta.status_code != 200:
            raise CommandError(
                f"No se pudo iniciar sesión en {base} ({respuesta.status_code}). "
                "¿Está el servidor levantado contra la base de pruebas y existe el usuario?"
            )
        token = respuesta.json().get("access") or respuesta.json().get("access_token")
        cabeceras = {"Authorization": f"Bearer {token}"}

        peticiones = []
        for etiqueta, ruta, peso in ESCENARIO:
            peticiones += [(etiqueta, ruta)] * peso
        peticiones *= opciones["rondas"]

        self.stdout.write(
            f"\n{len(peticiones)} peticiones, {opciones['usuarios']} simultáneas, contra {base}"
        )

        resultados = []

        def pedir(caso):
            etiqueta, ruta = caso
            inicio = time.perf_counter()
            try:
                # Sesión propia por hilo: compartirla serializaría las
                # peticiones en el pool de conexiones de requests y la prueba
                # mediría su cola, no la del servidor.
                with requests.Session() as sesion:
                    respuesta = sesion.get(f"{base}{ruta}", headers=cabeceras, timeout=120)
                estado = respuesta.status_code
            except requests.RequestException as error:
                estado = type(error).__name__
            return etiqueta, (time.perf_counter() - inicio) * 1000, estado

        arranque = time.perf_counter()
        with ThreadPoolExecutor(max_workers=opciones["usuarios"]) as ejecutor:
            resultados = list(ejecutor.map(pedir, peticiones))
        total_segundos = time.perf_counter() - arranque

        por_etiqueta: dict[str, list[float]] = {}
        errores: dict[str, int] = {}
        for etiqueta, duracion, estado in resultados:
            por_etiqueta.setdefault(etiqueta, []).append(duracion)
            if estado != 200:
                errores[f"{etiqueta} -> {estado}"] = errores.get(f"{etiqueta} -> {estado}", 0) + 1

        self.stdout.write(
            "\nOperacion                      peticiones   mediana       p95      max"
        )
        self.stdout.write("-" * 72)
        for etiqueta, tiempos in por_etiqueta.items():
            ordenados = sorted(tiempos)
            p95 = ordenados[max(int(len(ordenados) * 0.95) - 1, 0)]
            self.stdout.write(
                f"{etiqueta:<30} {len(tiempos):>9} {statistics.median(tiempos):>8.0f}ms "
                f"{p95:>8.0f}ms {max(tiempos):>7.0f}ms"
            )

        self.stdout.write(
            f"\nTotal: {len(resultados)} peticiones en {total_segundos:.1f}s "
            f"({len(resultados) / total_segundos:.1f} peticiones/s)"
        )
        if errores:
            self.stdout.write(self.style.WARNING("\nRespuestas no exitosas:"))
            for detalle, cantidad in errores.items():
                self.stdout.write(f"  - {detalle}: {cantidad}")
        else:
            self.stdout.write(self.style.SUCCESS("Todas las respuestas fueron 200."))
