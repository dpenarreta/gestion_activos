"""De dónde sale el rol de pagos: un procedimiento almacenado de la base de
nómina que recibe año, mes y código de empleado.

- `NOMINA_ROL_PROCEDIMIENTO` (en el .env) es su nombre, por ejemplo
  `dbo.sp_rol_pagos`. Se ejecuta en la base externa de solo lectura
  (`EXTERNAL_DB_*`), con los tres parámetros enviados como parámetros (`?`),
  nunca concatenados.
- Mientras no esté configurado, en desarrollo (`NOMINA_ROL_DEMO`, por defecto
  igual a DEBUG) se usan datos **de ejemplo** ficticios, marcados así en el PDF.
  En producción sin procedimiento, la consulta se niega con un mensaje claro.

El rol se entrega siempre con la misma forma (`Rol`), sea cual sea la fuente:
el PDF no sabe de dónde vino. **Pendiente**: `_adaptar` traduce lo que
devuelva el procedimiento real a esa forma; se completa cuando llegue.
"""

import logging
import re
from dataclasses import dataclass, field
from decimal import Decimal

from django.conf import settings
from rest_framework.exceptions import APIException

logger = logging.getLogger(__name__)

MESES = [
    "ENERO",
    "FEBRERO",
    "MARZO",
    "ABRIL",
    "MAYO",
    "JUNIO",
    "JULIO",
    "AGOSTO",
    "SEPTIEMBRE",
    "OCTUBRE",
    "NOVIEMBRE",
    "DICIEMBRE",
]
_NOMBRE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$")


class RolNoDisponible(APIException):
    status_code = 404
    default_detail = "No hay rol de pagos para ese período."
    default_code = "rol_no_disponible"


class FuenteNoConfigurada(APIException):
    status_code = 503
    default_detail = "La consulta del rol de pagos todavía no está disponible."
    default_code = "rol_no_configurado"


@dataclass
class Rubro:
    nombre: str
    valor: Decimal


@dataclass
class Rol:
    empresa: str
    anio: int
    mes: int
    codigo: str
    cedula: str
    apellidos: str
    nombres: str
    estado: str = ""
    fecha_ingreso: str = ""
    sucursal: str = ""
    departamento: str = ""
    periodo_desde: str = ""
    periodo_hasta: str = ""
    deposito: str = ""
    codigo_rubro: str = ""
    informativo: list = field(default_factory=list)
    ingresos: list = field(default_factory=list)
    egresos: list = field(default_factory=list)
    ejemplo: bool = False

    @property
    def total_ingresos(self) -> Decimal:
        return sum((r.valor for r in self.ingresos), Decimal("0"))

    @property
    def total_egresos(self) -> Decimal:
        return sum((r.valor for r in self.egresos), Decimal("0"))

    @property
    def neto(self) -> Decimal:
        return self.total_ingresos - self.total_egresos

    @property
    def nombre_mes(self) -> str:
        return MESES[self.mes - 1]


def disponible() -> bool:
    return bool(getattr(settings, "NOMINA_ROL_PROCEDIMIENTO", "")) or _demo()


def _demo() -> bool:
    return bool(getattr(settings, "NOMINA_ROL_DEMO", settings.DEBUG))


def obtener(codigo: str, anio: int, mes: int, empresa: str = "") -> Rol:
    procedimiento = getattr(settings, "NOMINA_ROL_PROCEDIMIENTO", "")
    if procedimiento:
        return _desde_procedimiento(procedimiento, codigo, anio, mes, empresa)
    if _demo():
        return _ejemplo(codigo, anio, mes, empresa)
    raise FuenteNoConfigurada()


def _desde_procedimiento(procedimiento, codigo, anio, mes, empresa) -> Rol:
    if not _NOMBRE.match(procedimiento):
        logger.error("NOMINA_ROL_PROCEDIMIENTO no es un nombre válido: %r", procedimiento)
        raise FuenteNoConfigurada()
    from apps.cartera.services.db_source import _conectar

    try:
        conexion = _conectar()
    except Exception:  # noqa: BLE001 (el detalle queda en el registro)
        logger.exception("Rol de pagos: no se pudo conectar a la base de nómina")
        raise FuenteNoConfigurada(
            "No se pudo conectar con la base de nómina. Intente más tarde."
        ) from None
    try:
        conexion.timeout = 30
        cursor = conexion.cursor()
        cursor.execute(f"EXEC {procedimiento} ?, ?, ?", anio, mes, codigo)
        conjuntos = []
        while True:
            if cursor.description:
                columnas = [c[0] for c in cursor.description]
                conjuntos.append(
                    [dict(zip(columnas, fila, strict=False)) for fila in cursor.fetchall()]
                )
            if not cursor.nextset():
                break
    except Exception:  # noqa: BLE001
        logger.exception("Rol de pagos: falló el procedimiento %s", procedimiento)
        raise FuenteNoConfigurada(
            "No se pudo consultar el rol de pagos. Intente más tarde."
        ) from None
    finally:
        conexion.close()
    if not conjuntos or not any(conjuntos):
        raise RolNoDisponible()
    return _adaptar(conjuntos, codigo, anio, mes, empresa)


def _adaptar(conjuntos, codigo, anio, mes, empresa) -> Rol:
    """Traduce lo que devuelve el procedimiento a un `Rol`. **Se completa
    cuando llegue el procedimiento real**: hasta entonces se niega en vez de
    adivinar las columnas."""
    logger.error("Rol de pagos: falta adaptar la salida del procedimiento: %s", conjuntos[:1])
    raise FuenteNoConfigurada("La consulta del rol de pagos todavía se está configurando.")


def _ejemplo_local(codigo):
    """Datos de ejemplo de un código, de un archivo local que no se versiona
    (`NOMINA_ROL_EJEMPLO_ARCHIVO`, por defecto backend/datos_locales/
    rol_pagos_ejemplo.json). Sirve para ver el PDF con datos reales en
    desarrollo sin dejarlos en el repositorio."""
    import json
    from pathlib import Path

    archivo = Path(
        getattr(settings, "NOMINA_ROL_EJEMPLO_ARCHIVO", "")
        or Path(settings.BASE_DIR) / "datos_locales" / "rol_pagos_ejemplo.json"
    )
    try:
        datos = json.loads(archivo.read_text(encoding="utf-8")).get(codigo)
    except (OSError, ValueError):
        return None
    return datos


def _ejemplo(codigo, anio, mes, empresa) -> Rol:
    """Datos para probar la pantalla en desarrollo: los del archivo local si
    trae ese código; si no, ficticios."""
    import calendar

    ultimo = calendar.monthrange(anio, mes)[1]
    local = _ejemplo_local(codigo)
    if local:
        rubros = lambda clave: [Rubro(n, Decimal(v)) for n, v in local.get(clave, [])]  # noqa: E731
        return Rol(
            empresa=local.get("empresa") or (empresa or "").upper(),
            anio=anio,
            mes=mes,
            codigo=codigo,
            cedula=local.get("cedula", ""),
            apellidos=local.get("apellidos", ""),
            nombres=local.get("nombres", ""),
            estado=local.get("estado", ""),
            fecha_ingreso=local.get("fecha_ingreso", ""),
            sucursal=local.get("sucursal", ""),
            departamento=local.get("departamento", ""),
            periodo_desde=f"{anio}-{mes:02d}-01",
            periodo_hasta=f"{anio}-{mes:02d}-{ultimo:02d}",
            deposito=local.get("deposito", ""),
            codigo_rubro=local.get("codigo_rubro", ""),
            informativo=rubros("informativo"),
            ingresos=rubros("ingresos"),
            egresos=rubros("egresos"),
            ejemplo=True,
        )
    return Rol(
        empresa=(empresa or "EMPRESA DE EJEMPLO").upper(),
        anio=anio,
        mes=mes,
        codigo=codigo,
        cedula="0000000000-0",
        apellidos="EMPLEADO DE",
        nombres="EJEMPLO",
        estado="Activo",
        fecha_ingreso="2020-01-15",
        sucursal="Matriz",
        departamento="Administrativo",
        periodo_desde=f"{anio}-{mes:02d}-01",
        periodo_hasta=f"{anio}-{mes:02d}-{ultimo:02d}",
        deposito="0000000000",
        codigo_rubro="0000000",
        informativo=[Rubro("Días trabajados", Decimal("30.00"))],
        ingresos=[
            Rubro("Sueldo devengado", Decimal("1000.00")),
            Rubro("Alimentación", Decimal("20.00")),
        ],
        egresos=[
            Rubro("Seguro", Decimal("3.00")),
            Rubro("9.45 Aporte personal", Decimal("94.50")),
        ],
        ejemplo=True,
    )
