"""Campos de serializador que resuelven su consulta en cada petición.

`PrimaryKeyRelatedField(queryset=Sede.objects.filter(activa=True))` construye la
consulta **al importar el módulo**, una sola vez para toda la vida del proceso.
Con el filtro por empresa dentro del gestor, eso significaría que el desplegable
de sedes queda congelado en la empresa que estuviera activa en ese instante —o,
peor, sin filtro ninguno, porque al importar todavía no hay petición—: quien
edite un activo vería sedes de otra empresa y, al elegir una, el sistema la
aceptaría.

Este campo pide la consulta cada vez que la necesita, que es cuando ya se sabe
en qué empresa se está trabajando.
"""

from rest_framework import serializers


class RelacionDeEmpresa(serializers.PrimaryKeyRelatedField):
    def __init__(self, modelo, filtro=None, **kwargs):
        self._modelo = modelo
        self._filtro = filtro or {}
        # DRF exige `queryset` o `read_only` al construir el campo; el valor
        # real lo pone `get_queryset` en cada uso.
        kwargs.setdefault("queryset", modelo._default_manager.none())
        super().__init__(**kwargs)

    def get_queryset(self):
        return self._modelo._default_manager.filter(**self._filtro)
