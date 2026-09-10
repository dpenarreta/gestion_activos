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

    def get_queryset(self):
        return super().get_queryset().de_la_empresa_activa()

    def todas(self):
        """Sin acotar. Para migraciones, respaldos y consultas del sistema."""
        return super().get_queryset()
