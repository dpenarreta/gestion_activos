"""Las pruebas del origen consultaban su propia tabla de auditoría
(`AuditEvent.objects.filter(domain=..., dashboard_id=...)`). Aquí los eventos
van a la bitácora del sistema (`compat.log_event`); esto los lee de vuelta con
la misma forma, para no reescribir cada aserción."""

from types import SimpleNamespace

from apps.cartera.compat import CLAVE_DETALLE, MODULO
from apps.core.models import AuditLog

_ACCIONES_COMUNES = {"ACCESS_DENIED": "access_denied"}


def _evento(registro):
    nuevos = dict(registro.new_values or {})
    detalle = nuevos.pop(CLAVE_DETALLE, {}) or {}
    return SimpleNamespace(
        registro=registro,
        action=registro.action.upper() if registro.action == "access_denied" else registro.action,
        actor=registro.actor,
        actor_id=registro.actor_id,
        domain=detalle.get("dominio", ""),
        result=detalle.get("resultado", ""),
        dashboard_id=detalle.get("dashboard_id", ""),
        component_id=detalle.get("component_id", ""),
        metadata=detalle.get("metadata", {}) or {},
        message=detalle.get("mensaje", ""),
        previous_values=registro.previous_values or {},
        new_values=nuevos,
    )


class _Consulta:
    def __init__(self, eventos):
        self._eventos = eventos

    def filter(self, **filtros):
        def coincide(evento):
            for campo, valor in filtros.items():
                if campo == "action":
                    valor = _ACCIONES_COMUNES.get(valor, valor).upper() if valor == "ACCESS_DENIED" else valor
                if getattr(evento, campo) != (str(valor) if campo in {"domain", "result"} else valor):
                    return False
            return True

        return _Consulta([e for e in self._eventos if coincide(e)])

    def all(self):
        return self

    def exists(self):
        return bool(self._eventos)

    def first(self):
        return self._eventos[0] if self._eventos else None

    def get(self, **filtros):
        encontrados = self.filter(**filtros)._eventos
        if len(encontrados) != 1:
            raise AssertionError(f"Se esperaba un evento y hay {len(encontrados)}: {filtros}")
        return encontrados[0]

    def values_list(self, *campos):
        return [tuple(getattr(e, c) for c in campos) for e in self._eventos]

    def __iter__(self):
        return iter(self._eventos)


class _Eventos:
    """`eventos.filter(...)`, `eventos.get(...)`, `eventos.all()`."""

    def _todos(self):
        return _Consulta([_evento(r) for r in AuditLog.objects.filter(module=MODULO).order_by("id")])

    def __getattr__(self, nombre):
        return getattr(self._todos(), nombre)


eventos = _Eventos()
