import logging

from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


class CarteraError(Exception):
    """Error de negocio esperado (validación, mapeo, archivo). Se traduce a HTTP 400."""

    def __init__(self, message, codigo='ERROR', detalles=None):
        super().__init__(message)
        self.message = message
        self.codigo = codigo
        self.detalles = detalles or {}


def cartera_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        return response

    if isinstance(exc, CarteraError):
        from rest_framework.response import Response
        return Response(
            {'error': exc.codigo, 'mensaje': exc.message, 'detalles': exc.detalles},
            status=400,
        )

    logger.exception('Error no controlado en cartera')
    from rest_framework.response import Response
    return Response({'error': 'ERROR_INTERNO', 'mensaje': 'Ocurrió un error inesperado procesando la solicitud.'}, status=500)
