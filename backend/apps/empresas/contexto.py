"""La empresa activa de la petición en curso.

Se resuelve **al primer uso** y no al abrir la petición, y esa es la decisión
que sostiene todo lo demás: con autenticación por token, `request.user` sigue
siendo anónimo cuando corren los middlewares de Django y solo se convierte en
alguien dentro de la vista. Un middleware que preguntara ahí colgaría el
aislamiento de un usuario que todavía no existe; preguntando tarde, la empresa
sale bien venga la sesión de donde venga.

Vive en un `ContextVar` y no en un global de módulo porque el servidor atiende
peticiones en hilos y un global se contaminaría entre ellas.

Fuera de una petición —comandos, migraciones, cron— no hay empresa activa y los
gestores no filtran: un respaldo o un recálculo de indicadores trabajan sobre
el sistema entero, que es lo que se espera de ellos.
"""

from contextvars import ContextVar

#: Hay petición pero la cuenta no tiene empresa (o pidió una que no es suya):
#: no ve nada. Distinto de `None`, que es «no hay petición».
SIN_EMPRESA = object()

#: La cabecera con la que el frontend dice en qué empresa está trabajando.
#: Cabecera y no sesión: así dos pestañas abiertas en empresas distintas no se
#: pisan, que es exactamente lo que hace quien compara dos inventarios.
CABECERA = "HTTP_X_EMPRESA"

#: Fijada a mano: comandos que se acotan a una empresa, y las pruebas.
_empresa_explicita: ContextVar = ContextVar("empresa_explicita", default=None)

#: La petición en curso, puesta por el middleware.
_peticion: ContextVar = ContextVar("peticion", default=None)


def empresa_actual():
    explicita = _empresa_explicita.get()
    if explicita is not None:
        return explicita

    peticion = _peticion.get()
    if peticion is None:
        return None
    return _de_la_peticion(peticion)


def _de_la_peticion(peticion):
    """Resuelve una vez por petición y guarda el resultado en ella.

    El resultado anónimo **no** se guarda: si algo consulta un modelo antes de
    que la vista autentique —el cuerpo de un módulo al importarse, por
    ejemplo—, guardarlo dejaría la petición entera sin empresa aunque el
    usuario sí la tuviera.
    """
    cacheada = getattr(peticion, "_empresa_resuelta", None)
    if cacheada is not None:
        return cacheada

    from .servicios import empresa_para  # tardío: evita el ciclo con models

    usuario = getattr(peticion, "user", None)
    if usuario is None or not usuario.is_authenticated:
        return SIN_EMPRESA

    empresa = empresa_para(usuario, peticion.META.get(CABECERA))
    peticion._empresa_resuelta = empresa
    peticion.empresa = None if empresa is SIN_EMPRESA else empresa
    return empresa


def fijar_peticion(peticion):
    return _peticion.set(peticion)


def restaurar_peticion(testigo) -> None:
    _peticion.reset(testigo)


class usando_empresa:
    """Ejecuta un bloque como si la petición fuera de esa empresa.

    Lo usan las pruebas y los comandos que sí necesitan acotarse a una: el
    envío de alertas, por ejemplo, recorre las empresas una a una para que cada
    resumen lleve solo lo suyo.
    """

    def __init__(self, empresa):
        self.empresa = empresa
        self.testigo = None

    def __enter__(self):
        self.testigo = _empresa_explicita.set(self.empresa)
        return self.empresa

    def __exit__(self, *excepcion):
        _empresa_explicita.reset(self.testigo)
        return False


def clave_por_empresa(clave: str) -> str:
    """Prefija una clave de caché con la empresa activa.

    Sin esto, el panel que calculó una empresa se le serviría a la siguiente
    que preguntara: la caché no sabe de permisos ni de empresas, y una cifra
    guardada es tan visible como una consulta.
    """
    empresa = empresa_actual()
    if empresa is None:
        return f"{clave}:sistema"
    if empresa is SIN_EMPRESA:
        return f"{clave}:sin-empresa"
    return f"{clave}:e{empresa.pk}"
