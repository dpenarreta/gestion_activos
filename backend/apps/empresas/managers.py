"""Gestores que filtran por la empresa activa sin que nadie lo escriba.

El filtro no puede depender de que cada consulta se acuerde de ponerlo: hay más
de veinte vistas, servicios, comandos y reportes, y basta con que **una** lo
olvide para que una empresa vea los datos de otra. Aquí el que olvida no ve de
más: ve de menos, y eso se nota enseguida.

Para salir del ámbito hay que pedirlo por su nombre —`Modelo.objects.todas()`—,
que es una línea que salta a la vista en una revisión.
"""

from django.db import models

from .contexto import SIN_EMPRESA, empresa_actual

#: Nombre del atributo que marca un gestor como acotado, y la ruta por la que
#: lo hace. Lo lee la prueba estructural
#: (`apps/empresas/tests/test_cobertura_del_aislamiento.py`), que recorre los
#: modelos de negocio y exige que cada uno declare cómo se acota o figure en una
#: lista de excepciones con su razón escrita. Sin esa marca, un modelo nuevo se
#: colaría sin filtro y nadie lo notaría hasta que una empresa viera lo de otra.
ATRIBUTO_RUTA = "ruta_de_empresa"


class ConsultaPorEmpresa(models.QuerySet):
    def de_la_empresa_activa(self):
        empresa = empresa_actual()
        if empresa is None:
            # Sin petición en curso: comandos, migraciones y tareas trabajan
            # sobre el sistema entero.
            return self
        if empresa is SIN_EMPRESA:
            # Hay petición y la cuenta no tiene empresa: no ve nada. Devolver
            # todo aquí sería el fallo que este módulo existe para evitar.
            return self.none()
        return self.filter(empresa=empresa)


class GestorPorEmpresa(models.Manager.from_queryset(ConsultaPorEmpresa)):
    """Gestor por defecto: lo que devuelve ya viene acotado."""

    #: La empresa la lleva el propio modelo.
    ruta_de_empresa = "empresa"

    def get_queryset(self):
        return super().get_queryset().de_la_empresa_activa()

    def todas(self):
        """Sin acotar. Para migraciones, respaldos y consultas del sistema."""
        return super().get_queryset()


def gestor_de_lo_que_cuelga(ruta: str):
    """Gestor para lo que pertenece a una empresa **a través de otro modelo**.

    Un mantenimiento no lleva la empresa encima: la hereda del activo que
    reparó, y un movimiento la hereda del activo que movió. Guardarles una
    columna propia sería duplicar un dato que ya existe y abrir la puerta a que
    los dos digan cosas distintas.

    Pero sin filtrar, `Mantenimiento.objects.all()` devuelve los de todas las
    empresas: la bitácora de una se leería desde la otra. Así que se filtra por
    la ruta hasta la empresa del padre —`"activo__empresa"`— y se hace en el
    gestor por defecto, por lo mismo que en los modelos raíz: si hubiera que
    acordarse en cada consulta, alguna se olvidaría.

    `todas()` sale del ámbito, y se lee al revisar el código.
    """

    class _Consulta(models.QuerySet):
        def de_la_empresa_activa(self):
            empresa = empresa_actual()
            if empresa is None:
                return self
            if empresa is SIN_EMPRESA:
                return self.none()
            return self.filter(**{ruta: empresa})

    class _Gestor(models.Manager.from_queryset(_Consulta)):
        ruta_de_empresa = ruta

        def get_queryset(self):
            return super().get_queryset().de_la_empresa_activa()

        def todas(self):
            return super().get_queryset()

    return _Gestor()
