"""El catálogo, lo que el código exige y lo que la base concede: lo mismo.

Tres formas de desincronizarse que esta suite ataja, y que no dan error hasta
que alguien se queda sin poder hacer su trabajo:

1. Exigir en una vista un permiso que no está en el catálogo. El chequeo
   devuelve 403 para todo el mundo —nadie puede tener lo que no existe—,
   incluido el superusuario si se revisa por catálogo.
2. Añadirlo al catálogo y olvidar la migración. El `auth.Permission` no se
   crea, así que no se puede asignar a ningún rol: la pantalla de roles no lo
   ofrece y el permiso es letra muerta.
3. Repartir en los roles iniciales un permiso que ya no existe.
"""

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType

from apps.permissions.catalog import PERMISSION_CATALOG, all_codenames
from apps.permissions.models import ModulePermission
from apps.permissions.permissions import HasModulePermission
from apps.roles.management.commands.crear_roles_iniciales import ROLES

pytestmark = pytest.mark.django_db


def _subclases(base):
    for hija in base.__subclasses__():
        yield hija
        yield from _subclases(hija)


def test_todo_permiso_exigido_por_una_vista_existe_en_el_catalogo():
    """`HasModulePermission` declara los suyos como atributos de clase.

    Las subclases de `HasActionPermission` los deciden en tiempo de request
    —dependen de la acción— así que no se pueden leer aquí sin inventarse un
    request; esas quedan cubiertas por las pruebas de cada módulo.
    """
    catalogo = all_codenames()
    declarados = {
        codename: clase.__name__
        for clase in _subclases(HasModulePermission)
        for codename in (
            getattr(clase, "view_permission", None),
            getattr(clase, "write_permission", None),
        )
        if codename
    }

    fuera = {c: clase for c, clase in declarados.items() if c not in catalogo}
    assert fuera == {}, f"Permisos exigidos que no están en el catálogo: {fuera}"


def test_el_catalogo_esta_materializado_en_la_base():
    """Cada entrada del catálogo tiene su `auth.Permission`.

    Si falta alguno, es que se añadió al catálogo sin generar la migración que
    actualiza `Meta.permissions` del modelo ancla.
    """
    content_type = ContentType.objects.get_for_model(ModulePermission)
    en_la_base = set(
        Permission.objects.filter(content_type=content_type).values_list("codename", flat=True)
    )

    faltan = all_codenames() - en_la_base
    assert faltan == set(), f"En el catálogo y sin `auth.Permission`: {sorted(faltan)}"


def test_no_sobra_ningun_permiso_en_la_base():
    """Y al revés: un permiso retirado del catálogo no se queda concedido.

    Uno huérfano seguiría apareciendo asignado a los roles que lo tuvieran, y
    nadie sabría qué habilita —porque ya no habilita nada—.
    """
    content_type = ContentType.objects.get_for_model(ModulePermission)
    en_la_base = set(
        Permission.objects.filter(content_type=content_type).values_list("codename", flat=True)
    )

    sobran = en_la_base - all_codenames()
    assert sobran == set(), f"Con `auth.Permission` y fuera del catálogo: {sorted(sobran)}"


def test_los_roles_iniciales_solo_reparten_permisos_que_existen():
    catalogo = all_codenames()
    for nombre, rol in ROLES.items():
        permisos = rol["permisos"]
        if permisos == "*":
            continue
        inventados = set(permisos) - catalogo
        assert inventados == set(), f"El rol «{nombre}» reparte permisos inexistentes: {inventados}"


def test_cada_permiso_pertenece_a_un_modulo_con_su_prefijo():
    """La convención `<modulo>.<accion>` no es cosmética: la pantalla de roles
    agrupa por ella, y un permiso colgado del módulo equivocado se le ofrece a
    quien administra otra cosa."""
    for modulo, datos in PERMISSION_CATALOG.items():
        for codename in datos["permissions"]:
            assert codename.startswith(
                f"{modulo}."
            ), f"«{codename}» está declarado dentro del módulo «{modulo}»"
