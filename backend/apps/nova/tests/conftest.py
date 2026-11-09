"""Fixtures de Nova. Reusa las del equipo de prueba de los informes (cuentas
en la empresa de la prueba, roles de Gestión Humana y organigrama).

Nunca se llama a un proveedor real: `proveedor_falso` reemplaza el SDK de
Anthropic y guarda cada pedido para revisar exactamente qué se habría
enviado.
"""

import json
import threading
from types import SimpleNamespace

import pytest

from apps.informes.tests.conftest import (  # noqa: F401 — fixtures reexportadas
    _cuentas_de_la_empresa,
    admin_gh,
    ana,
    coordinadora,
    equipo,
    externo,
    jefa,
    nino,
    sin_permiso,
)


class ProveedorFalso:
    """El SDK de Anthropic de mentira. `respuestas` decide qué devuelve cada
    pedido (función que recibe los parámetros, o un texto fijo)."""

    def __init__(self):
        self.pedidos: list[dict] = []
        self.respuesta = "{}"
        self.stop_reason = "end_turn"
        self.error: Exception | None = None
        self._candado = threading.Lock()
        self.messages = self

    def __call__(self, **_opciones):
        return self

    def create(self, **parametros):
        with self._candado:
            self.pedidos.append(parametros)
        if self.error is not None:
            raise self.error
        texto = self.respuesta(parametros) if callable(self.respuesta) else self.respuesta
        if not isinstance(texto, str):
            texto = json.dumps(texto, ensure_ascii=False)
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=texto)],
            stop_reason=self.stop_reason,
            model=parametros["model"],
            usage=SimpleNamespace(input_tokens=120, output_tokens=45),
        )

    def enviado(self) -> str:
        """Todo el texto de datos que salió hacia el proveedor (sin la
        instrucción del sistema, que es texto del código)."""
        return "\n".join(m["content"] for p in self.pedidos for m in p["messages"])


@pytest.fixture
def proveedor_falso(settings, monkeypatch):
    settings.IA_PROVEEDOR = "anthropic"
    settings.ANTHROPIC_API_KEY = "clave-de-prueba"
    settings.ANTHROPIC_MODEL = "claude-opus-5-5"
    falso = ProveedorFalso()
    monkeypatch.setattr("apps.nova.cliente.anthropic.Anthropic", falso)
    # El aviso de datos se da por aceptado salvo que la prueba diga otra cosa.
    monkeypatch.setattr("apps.nova.nucleo.acepto_aviso_vigente", lambda _u: True)
    return falso
