"""Encender y apagar módulos por empresa (21/10/2026).

Un módulo apagado no existe para nadie de la empresa, tenga los permisos que
tenga: ni en el menú ni en la API. Solo el superusuario y quien tiene
`configuracion.modulos` (el administrador) lo siguen viendo y entrando, para
prepararlo antes de encenderlo.

El bloqueo corre en la autenticación (`apps.authentication.authentication`),
el único punto que pasa por toda petición autenticada: se niega cualquier
ruta de la API de un módulo apagado con `modulo_apagado`. Lo común del
sistema (perfil, notificaciones, chat, configuración, organización) nunca se
apaga.
"""

from rest_framework.exceptions import PermissionDenied

from apps.permissions.authorization import user_has_permission

#: Cada módulo con su nombre y los prefijos de la API que son solo suyos. Las
#: claves son las de `frontend/src/modulos/modulos.js`.
MODULOS = {
    "institucional": (
        "Institucional",
        (
            "/api/v1/licencias/",
            "/api/v1/proyectos/",
            "/api/v1/sugerencias/",
            "/api/v1/nomina/",
            "/api/v1/capacitacion/",
        ),
    ),
    "dashboards": ("Dashboards", ("/api/v1/cartera/", "/api/v1/dashboards/")),
    "soporte": ("Mesa de ayuda", ("/api/v1/soporte/",)),
    "matriz": ("Matriz de obligaciones", ("/api/v1/matriz/",)),
    "sedes": ("Órdenes de trabajo", ("/api/v1/ordenes/",)),
    "activos": (
        "Gestión de Activos",
        (
            "/api/v1/activos/",
            "/api/v1/solicitudes/",
            "/api/v1/mantenimientos/",
            "/api/v1/politicas/",
            "/api/v1/alertas/",
            "/api/v1/adjuntos/",
        ),
    ),
}


class ModuloApagado(PermissionDenied):
    default_code = "modulo_apagado"
    default_detail = "Este módulo está apagado en la empresa."


def ve_apagados(usuario) -> bool:
    """El superusuario y quien administra los módulos ven los apagados."""
    return user_has_permission(usuario, "configuracion.modulos")


def apagados(empresa) -> set[str]:
    from .models import EstadoModulo

    if empresa is None:
        return set()
    return set(
        EstadoModulo.objects.todas()
        .filter(empresa=empresa, activo=False)
        .values_list("clave", flat=True)
    )


def modulo_de_ruta(ruta: str) -> str | None:
    for clave, (_, prefijos) in MODULOS.items():
        if any(ruta.startswith(p) for p in prefijos):
            return clave
    return None


def exigir_encendido(request, usuario):
    """Niega la petición si es de un módulo apagado en la empresa activa y la
    persona no puede ver los apagados."""
    clave = modulo_de_ruta(request.path)
    if clave is None or ve_apagados(usuario):
        return
    from .contexto import CABECERA, SIN_EMPRESA
    from .servicios import empresa_para

    empresa = empresa_para(usuario, request.META.get(CABECERA))
    if empresa is SIN_EMPRESA:
        return
    if clave in apagados(empresa):
        raise ModuloApagado(f"El módulo «{MODULOS[clave][0]}» está apagado en la empresa.")


def estado(empresa) -> list[dict]:
    fuera = apagados(empresa)
    return [
        {"id": clave, "nombre": nombre, "activo": clave not in fuera}
        for clave, (nombre, _) in MODULOS.items()
    ]


def cambiar(empresa, clave: str, activo: bool):
    from .models import EstadoModulo

    if clave not in MODULOS:
        from rest_framework.exceptions import ValidationError

        raise ValidationError({"modulo": "Módulo desconocido."})
    EstadoModulo.objects.todas().update_or_create(
        empresa=empresa, clave=clave, defaults={"activo": bool(activo)}
    )
    return estado(empresa)
