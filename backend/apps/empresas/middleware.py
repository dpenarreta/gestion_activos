"""Deja la petición en curso al alcance de los gestores, y la retira al salir.

Quién es la empresa se decide en `contexto.py`, al primer uso: con token, el
usuario no se conoce a esta altura. Lo que hace falta aquí es que la petición
esté disponible cuando llegue ese momento, y —sobre todo— que deje de estarlo
al terminar: sin el `finally`, una petición heredaría la empresa de la anterior
que atendió ese mismo hilo y el aislamiento dependería de cómo el servidor
reparte el trabajo.
"""

from .contexto import fijar_peticion, restaurar_peticion


class EmpresaActivaMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        testigo = fijar_peticion(request)
        try:
            return self.get_response(request)
        finally:
            restaurar_peticion(testigo)
