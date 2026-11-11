"""Quién pide, quién ve y quién atiende las solicitudes de derechos.

- **Pedir, seguir las propias y descargar «mis datos»**: toda cuenta con
  sesión, sin permiso. Es un derecho del titular; condicionarlo a un rol sería
  negarlo a quien no lo tenga.
- `privacidad.ver`: la bandeja y el detalle de las solicitudes de la empresa,
  de solo lectura (p. ej. quien supervisa el cumplimiento).
- `privacidad.atender`: lo anterior, más cambiar el estado con la respuesta al
  titular y descargar los datos de un titular para responder un ACCESO.

En Nexo bastaba ser ADMINISTRADOR (`is_administrator`); aquí son permisos del
catálogo, asignados por `privacidad/0002` al Administrador de Gestión Humana y
al Superusuario. Todo vale dentro de la empresa activa: el gestor de
`SolicitudDerechos` ya acota cada consulta a ella.

**Textos y aceptaciones (US-004, 11/11/2026).**

- Ver las aceptaciones de todos los textos: `privacidad.ver` o
  `privacidad.atender`, como la bandeja.
- Editar los textos: `privacidad.textos`.
- Ver el catálogo de textos y sus versiones: `privacidad.ver`,
  `privacidad.atender` **o** `privacidad.textos`. Quien edita tiene que leer
  lo que edita: `roles/0045` dio `privacidad.textos` a quien tenía
  `roles_pago.configurar` o `codigos.acuerdo` sin ver la privacidad, y sin
  esto tendría la edición pero no el texto.
- El texto vigente de una clave lo lee toda cuenta con sesión: es lo que se
  le muestra para aceptarlo.
"""

from apps.permissions.authorization import user_has_permission

VER = "privacidad.ver"
ATENDER = "privacidad.atender"

TEXTOS = "privacidad.textos"

ALL_CODENAMES = (VER, ATENDER)
#: Quien ve el catálogo de textos (ver el docstring).
VER_TEXTOS = (VER, ATENDER, TEXTOS)


def puede_atender(user) -> bool:
    return user_has_permission(user, ATENDER)


def puede_ver_bandeja(user) -> bool:
    """`atender` incluye ver: no se responde lo que no se ve."""
    return user_has_permission(user, VER) or puede_atender(user)


def puede_editar_textos(user) -> bool:
    return user_has_permission(user, TEXTOS)
