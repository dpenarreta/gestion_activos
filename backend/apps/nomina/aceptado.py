"""El rol aceptado queda guardado (26/10/2026, decisión de la administración).

Cuando la persona acepta su rol de pagos de un mes («Estuvo de acuerdo» o
«Aceptó al cerrar sin responder»), se guardan los datos de **ese** rol
—rubros y montos, no el PDF— como constancia. Desde entonces ese mes sale
siempre de lo guardado, no de nómina: al consultarlo, al enviarlo al correo,
en el historial, en la descarga masiva y en el rol auditado. La aceptación es
definitiva: no se vuelve a preguntar ni se puede observar después.

Para que lo guardado sea lo que la persona vio, cada consulta anota la huella
del rol que mostró (`ConsultaRolPagos.huella_rol`); al aceptar se vuelve a
pedir a nómina y, si cambió desde que lo abrió, se pide abrirlo de nuevo.
"""

import hashlib
import json
from decimal import Decimal

from rest_framework.exceptions import ValidationError

from . import fuente
from .models import RolAceptado

CAMPOS = (
    "empresa",
    "anio",
    "mes",
    "codigo",
    "cedula",
    "apellidos",
    "nombres",
    "estado",
    "fecha_ingreso",
    "sucursal",
    "departamento",
    "periodo_desde",
    "periodo_hasta",
    "deposito",
    "codigo_rubro",
    "ejemplo",
)
LISTAS = ("informativo", "ingresos", "egresos")


def a_dict(rol) -> dict:
    datos = {campo: getattr(rol, campo) for campo in CAMPOS}
    for lista in LISTAS:
        datos[lista] = [{"nombre": r.nombre, "valor": str(r.valor)} for r in getattr(rol, lista)]
    return datos


def de_dict(datos) -> fuente.Rol:
    listas = {
        lista: [fuente.Rubro(r["nombre"], Decimal(r["valor"])) for r in datos.get(lista, [])]
        for lista in LISTAS
    }
    return fuente.Rol(**{campo: datos[campo] for campo in CAMPOS if campo in datos}, **listas)


def huella(rol) -> str:
    """La huella de los datos del rol (no del PDF, que lleva la fecha)."""
    texto = json.dumps(a_dict(rol), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def de_periodo(codigo: str, anio: int, mes: int):
    return RolAceptado.objects.filter(codigo_empleado=codigo, anio=anio, mes=mes).first()


def rol_del_periodo(codigo: str, anio: int, mes: int, empresa: str = ""):
    """`(rol, aceptado)`: el aceptado si la persona ya lo aceptó; si no, el
    de nómina (y `aceptado` es None)."""
    aceptado = de_periodo(codigo, anio, mes)
    if aceptado is not None:
        return de_dict(aceptado.datos), aceptado
    return fuente.obtener(codigo, anio, mes, empresa), None


def guardar(consulta, empresa: str = "") -> RolAceptado:
    """Guarda el rol que la persona acaba de aceptar en esa consulta. Si
    nómina cambió ese rol desde que lo abrió, no se acepta: se pide abrirlo
    de nuevo para aceptar lo que de verdad dice ahora."""
    try:
        rol = fuente.obtener(consulta.codigo_empleado, consulta.anio, consulta.mes, empresa)
    except (fuente.RolNoDisponible, fuente.FuenteNoConfigurada):
        raise ValidationError(
            {"detail": "No se pudo confirmar su rol con nómina. Intente aceptarlo más tarde."}
        ) from None
    actual = huella(rol)
    if consulta.huella_rol and consulta.huella_rol != actual:
        raise ValidationError(
            {
                "detail": (
                    "Su rol de pagos cambió en nómina desde que lo abrió. "
                    "Vuelva a abrirlo para revisar y aceptar el actual."
                )
            }
        )
    return RolAceptado.objects.create(
        usuario=consulta.usuario,
        codigo_empleado=consulta.codigo_empleado,
        anio=consulta.anio,
        mes=consulta.mes,
        consulta=consulta,
        datos=a_dict(rol),
        huella=actual,
    )
