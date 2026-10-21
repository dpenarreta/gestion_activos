import pytest

#: Los roles de la Matriz que las pruebas reparten entre las cuentas. Desde el
#: 21/10/2026 el sistema ya no los siembra —los roles son los cargos del
#: organigrama, más Administrador y Superusuario—, así que las pruebas los
#: crean con los permisos que dice la especificación (§7).
ROLES_DE_PRUEBA = {
    "Responsable de cumplimiento": [
        "matriz.crear",
        "matriz.editar",
        "matriz.cargar",
        "matriz.enviar",
        "matriz.recordar",
    ],
    "Supervisor de cumplimiento": [
        "matriz.ver_todas",
        "matriz.cambiar_fecha",
        "matriz.validar",
        "matriz.recordar",
        "matriz.exportar",
        "matriz.ver_auditoria",
    ],
    "Consulta / Auditoría": [
        "activos.ver",
        "activos.ver_asignados",
        "organizacion.ver",
        "mantenimientos.ver",
        "politicas.ver",
        "adjuntos.ver",
        "alertas.ver",
        "reportes.ver",
        "reportes.exportar",
        "auditoria.ver",
        "auditoria.ver_detalle",
        "auditoria.exportar",
        "matriz.ver_todas",
        "matriz.exportar",
        "matriz.ver_auditoria",
        "catalogos.ver",
        "dashboard.view",
        "ordenes.ver",
        "ordenes.ver_todas",
        "ordenes.reportes",
        "soporte.ver_todos",
        "soporte.reportes",
    ],
}


@pytest.fixture(autouse=True)
def _empresa_de_pruebas():
    """Anula el fixture global, como en `apps/empresas`: aquí se estudia qué
    puede hacer cada cuenta en cada empresa, y fijar una de antemano taparía
    justo lo que se prueba."""
    yield


@pytest.fixture(autouse=True)
def _roles_de_la_matriz(request):
    if "db" not in request.fixturenames and not request.node.get_closest_marker("django_db"):
        yield
        return
    request.getfixturevalue("db")
    from django.contrib.auth.models import Group, Permission

    for nombre, codenames in ROLES_DE_PRUEBA.items():
        rol, _ = Group.objects.get_or_create(name=nombre)
        rol.permissions.set(
            Permission.objects.filter(content_type__app_label="permissions", codename__in=codenames)
        )
    yield
