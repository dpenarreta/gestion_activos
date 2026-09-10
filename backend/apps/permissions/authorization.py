"""Resolución de permisos efectivos de un usuario contra el catálogo."""


def _permisos_de_la_empresa_activa(user) -> set[str]:
    """Los que la cuenta tiene por los roles que ejerce **en esta empresa**.

    La misma persona no hace lo mismo en todas: administra el inventario de una
    y solo consulta el de otra. Por eso los roles cuelgan de la membresía, y
    resolverlos exige saber en qué empresa se está trabajando ahora mismo.

    Fuera de una petición no hay empresa activa y esto no aporta nada: un
    comando o una migración trabajan sobre el sistema entero y no pasan por
    aquí. La importación es local para no acoplar el arranque de este módulo
    —que es el núcleo de autorización— al de la app de empresas.
    """
    from django.contrib.auth.models import Permission

    from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

    empresa = empresa_actual()
    if empresa is None or empresa is SIN_EMPRESA:
        return set()

    # Se memoriza en el objeto en memoria, no en caché compartida: cada
    # petición autenticada construye un `User` nuevo (ver
    # `apps.authentication.authentication.SessionAuthentication.get_user`), así
    # que quitar un rol surte efecto en la siguiente petición, pero dentro de
    # una misma no se repite la consulta por cada permiso que se comprueba.
    memoria = getattr(user, "_permisos_por_empresa", None)
    if memoria is None:
        memoria = user._permisos_por_empresa = {}
    if empresa.pk not in memoria:
        memoria[empresa.pk] = set(
            Permission.objects.filter(
                group__membresias__usuario=user, group__membresias__empresa=empresa
            ).values_list("codename", flat=True)
        )
    return memoria[empresa.pk]


def get_user_permission_codenames(user) -> set[str]:
    """Codenames (`"usuarios.ver"`, sin prefijo de app) que el usuario tiene,
    vía roles —globales o de la empresa activa— o asignación directa. Este
    código no cachea nada propio más allá del objeto en memoria:
    `user.get_all_permissions()` cachea en el atributo `_perm_cache` del
    `User`, pero cada request autenticado obtiene una instancia nueva (ver
    `apps.authentication.authentication.SessionAuthentication.get_user`),
    así que revocar un permiso surte efecto en la siguiente petición, sin
    requerir relogin.

    Los roles del usuario (`user.groups`) valen en todas las empresas y los de
    la membresía solo en la suya. Los dos suman: el administrador del grupo
    necesita entrar a cualquiera, y quien solo trabaja en una no debería
    arrastrar a la siguiente los permisos que tenía en la primera.

    No hace ningún bypass propio para `is_superuser` — pero Django's
    `ModelBackend` sí lo hace de forma transparente (`get_all_permissions()`
    devuelve `Permission.objects.all()` para cualquier usuario con
    `is_superuser=True`), así que un superusuario ve el catálogo completo
    igual, sin que este módulo tenga que duplicar esa lógica."""
    if user is None or not user.is_authenticated:
        return set()
    globales = {perm.partition(".")[2] for perm in user.get_all_permissions()}
    return globales | _permisos_de_la_empresa_activa(user)


def permisos_que_no_tiene(usuario, codenames) -> list[str]:
    """De los pedidos, cuáles no posee quien está concediendo.

    Es la base de una sola regla, escrita en un sitio: **nadie reparte un
    permiso que no tiene**. Sin ella, `roles.editar` es en la práctica el
    permiso máximo del sistema —quien lo tenga se añade a su propio rol
    cualquier entrada del catálogo— aunque el catálogo lo presente como uno más,
    y con administradores por empresa eso cruza además la separación: el rol es
    compartido y el cambio le llega a la otra compañía.

    El superusuario queda fuera: es la cuenta de emergencia y ya se salta toda
    la autorización.
    """
    if usuario is not None and usuario.is_superuser:
        return []
    propios = get_user_permission_codenames(usuario)
    return sorted(set(codenames) - propios)


def user_has_permission(user, codename: str) -> bool:
    """Chequeo de autorización real. El bypass explícito de `is_superuser`
    es redundante con el que ya hace Django internamente (ver docstring de
    `get_user_permission_codenames`) pero evita una consulta a la base de
    datos en el camino más común (superusuario administrando el sistema)."""
    if user is None or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    return codename in get_user_permission_codenames(user)
