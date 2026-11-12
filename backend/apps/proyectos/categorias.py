"""Las dos categorías del motor de solicitudes (US-008, 12/11/2026).

La Solicitud de proyectos y la Solicitud de procesos comparten modelos,
servicios y pantallas; lo que las separa es la **categoría del tipo**
(`TipoProyecto.categoria`). Todo lo que cambia de una a otra está aquí, en un
solo lugar: los permisos, la numeración, el enlace de la campana y las
palabras de los avisos y de la auditoría.

La API recibe la categoría en el parámetro de consulta `?categoria=`. Si
falta vale `proyecto`, para que la pantalla de proyectos que ya existía no
cambie; un valor que no es ninguna de las dos responde 400.
"""

from dataclasses import dataclass

from rest_framework.exceptions import ValidationError

from .models import TipoProyecto

Categoria = TipoProyecto.Categoria
PARAMETRO = "categoria"


@dataclass(frozen=True)
class Datos:
    """Lo propio de una categoría."""

    clave: str
    #: «proyecto» o «proceso», para los textos.
    singular: str
    #: El nombre de su pantalla en el menú.
    pantalla: str
    #: Prefijo de la numeración: `PRY-AAAA-NNNN` o `PRC-AAAA-NNNN`.
    prefijo: str
    #: El que hace falta para pedir una solicitud; `None` si no hace falta.
    permiso_solicitar: str | None
    permiso_configurar: str
    permiso_ver_todas: str
    #: La pantalla a la que llevan los avisos de la campana.
    enlace: str
    #: Prefijo del `tipo` de los avisos, de la acción y del módulo de la
    #: auditoría («proyectos» o «procesos»).
    modulo: str


CATEGORIAS = {
    Categoria.PROYECTO: Datos(
        clave=Categoria.PROYECTO,
        singular="proyecto",
        pantalla="Solicitud de proyectos",
        prefijo="PRY",
        # Pedir proyectos nunca pidió permiso, y sigue así (US-008).
        permiso_solicitar=None,
        permiso_configurar="proyectos.configurar",
        permiso_ver_todas="proyectos.ver_todas",
        enlace="/admin/institucional/proyectos",
        modulo="proyectos",
    ),
    Categoria.PROCESO: Datos(
        clave=Categoria.PROCESO,
        singular="proceso",
        pantalla="Solicitud de procesos",
        prefijo="PRC",
        permiso_solicitar="procesos.solicitar",
        permiso_configurar="procesos.configurar",
        permiso_ver_todas="procesos.ver_todas",
        enlace="/admin/institucional/procesos",
        modulo="procesos",
    ),
}


def datos(categoria) -> Datos:
    """Lo propio de una categoría (`"proyecto"`, `"proceso"`)."""
    return CATEGORIAS[categoria]


def de_la_solicitud(solicitud) -> Datos:
    """Lo propio de la categoría de una solicitud: la de su tipo."""
    return datos(solicitud.tipo_proyecto.categoria)


def leer(query_params) -> str:
    """La categoría pedida en `?categoria=`. Sin parámetro (o vacío) vale
    `proyecto`; cualquier otro valor da 400 con el error en `categoria`."""
    valor = (query_params.get(PARAMETRO) or "").strip().lower()
    if not valor:
        return Categoria.PROYECTO
    if valor not in CATEGORIAS:
        raise ValidationError(
            {PARAMETRO: [f"«{valor[:30]}» no es una categoría válida: use «proyecto» o «proceso»."]}
        )
    return valor


class PorCategoriaMixin:
    """Para las vistas de `apps.proyectos`: lee y valida `?categoria=` una vez
    por petición y lo deja en `self.categoria` (y lo propio de ella en
    `self.datos_categoria`).

    Se valida en `initial()`, después de la autenticación y de los permisos
    que no dependen de la categoría: sin sesión sigue siendo 401. Los permisos
    que sí dependen de ella (`ConfigurarPermission`) la leen antes, desde esta
    misma propiedad."""

    @property
    def categoria(self) -> str:
        if not hasattr(self, "_categoria"):
            self._categoria = leer(self.request.query_params)
        return self._categoria

    @property
    def datos_categoria(self) -> Datos:
        return datos(self.categoria)

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        self.categoria  # noqa: B018 — valida el parámetro: 400 si no sirve

    def tipos(self):
        """Los tipos de la categoría pedida."""
        return TipoProyecto.objects.filter(categoria=self.categoria)

    def de_la_categoria(self, queryset, campo="tipo_proyecto__categoria"):
        """Filtra por la categoría pedida un queryset de solicitudes (o de lo
        que llegue al tipo por `campo`)."""
        return queryset.filter(**{campo: self.categoria})
