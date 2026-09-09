"""Configuración de las columnas de la plantilla de carga masiva."""

from io import BytesIO

import pytest
from openpyxl import Workbook, load_workbook
from rest_framework.test import APIClient

from apps.activos.importacion import columnas_configuradas
from apps.activos.models import Activo, TipoDispositivo
from apps.activos.models_plantilla import ColumnaPlantillaActivos
from apps.organizacion.models import Departamento
from apps.users.models import User

RUTA = "/api/v1/activos/columnas-plantilla/"


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_cols", email="admin_cols@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def catalogos(db):
    departamento = Departamento.objects.create(nombre="Tecnología", codigo="TI")
    TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    return departamento


def _archivo_desde_columnas(valores_por_clave):
    """Arma un .xlsx con las columnas activas y los valores indicados."""
    columnas = columnas_configuradas()
    libro = Workbook()
    hoja = libro.active
    hoja.title = "Activos"
    hoja.append([columna.encabezado for columna in columnas])
    hoja.append([valores_por_clave.get(columna.clave, "") for columna in columnas])
    buffer = BytesIO()
    libro.save(buffer)
    buffer.seek(0)
    buffer.name = "carga.xlsx"
    return buffer


def _subir(cliente, archivo, confirmar=False):
    return cliente.post(
        "/api/v1/activos/importar/",
        {"archivo": archivo, "confirmar": "true" if confirmar else "false"},
        format="multipart",
    )


BASE = {
    "tipo": "LAP",
    "nombre": "Laptop 01",
    "marca": "Dell",
    "modelo": "Latitude",
    "numero_serie": "SN-COL-1",
    "departamento": "TI",
    "fecha_adquisicion": "2024-01-15",
}


# --- Configuración por defecto --------------------------------------------


def test_la_configuracion_arranca_con_las_columnas_del_sistema(cliente, db):
    """Sembrada por migración: una plantilla vacía no serviría para nada, y
    quien entre a configurarla debe encontrarla funcionando."""
    respuesta = cliente.get(RUTA)

    claves = [c["clave"] for c in respuesta.json()]
    assert "tipo" in claves
    assert "costo_adquisicion" in claves
    # Las columnas de garantía se siembran desactivadas: se ofrecen, pero no
    # engordan la plantilla de quien no lleva ese dato.
    assert "fecha_fin_garantia" in claves
    por_clave = {c["clave"]: c for c in respuesta.json()}
    assert por_clave["fecha_fin_garantia"]["activa"] is False


def test_las_columnas_estructurales_se_marcan_como_tales(cliente, db):
    respuesta = cliente.get(RUTA)

    por_clave = {c["clave"]: c for c in respuesta.json()}
    assert por_clave["tipo"]["es_estructural"] is True
    assert por_clave["numero_serie"]["es_estructural"] is True
    assert por_clave["sede"]["es_estructural"] is False


# --- Qué se puede configurar ----------------------------------------------


def test_desactivar_una_columna_la_quita_de_la_plantilla(cliente, catalogos):
    costo = ColumnaPlantillaActivos.objects.get(clave="costo_adquisicion")

    cliente.patch(f"{RUTA}{costo.id}/", {"activa": False}, format="json")

    hoja = load_workbook(BytesIO(cliente.get("/api/v1/activos/plantilla-importacion/").content))[
        "Activos"
    ]
    encabezados = [c.value for c in hoja[1]]
    assert "Costo de compra" not in encabezados


def test_una_columna_desactivada_deja_de_leerse_al_importar(cliente, catalogos):
    """El archivo se sigue aceptando aunque traiga la columna: lo que cambia es
    que su valor ya no se usa."""
    ColumnaPlantillaActivos.objects.filter(clave="costo_adquisicion").update(activa=False)

    respuesta = _subir(
        cliente, _archivo_desde_columnas({**BASE, "costo_adquisicion": "999"}), confirmar=True
    )

    assert respuesta.status_code == 201
    assert Activo.objects.get().costo_adquisicion is None


def test_volver_obligatoria_una_columna_opcional_la_exige(cliente, catalogos):
    columna = ColumnaPlantillaActivos.objects.get(clave="sede")

    cliente.patch(f"{RUTA}{columna.id}/", {"obligatoria": True}, format="json")
    respuesta = _subir(cliente, _archivo_desde_columnas(BASE))

    errores = respuesta.json()["errores"]
    assert any(e["columna"] == "Sede" for e in errores)


def test_renombrar_una_columna_cambia_el_encabezado_y_el_lector(cliente, catalogos):
    """El generador y el lector toman la etiqueta del mismo sitio: si cada uno
    tuviera la suya, renombrar produciría archivos ilegibles para el sistema."""
    custodio = ColumnaPlantillaActivos.objects.get(clave="custodio")

    cliente.patch(f"{RUTA}{custodio.id}/", {"etiqueta": "Cédula del responsable"}, format="json")

    hoja = load_workbook(BytesIO(cliente.get("/api/v1/activos/plantilla-importacion/").content))[
        "Activos"
    ]
    assert "Cédula del responsable" in [c.value for c in hoja[1]]

    respuesta = _subir(cliente, _archivo_desde_columnas(BASE), confirmar=True)
    assert respuesta.status_code == 201


def test_reordenar_cambia_el_orden_de_las_columnas(cliente, catalogos):
    observaciones = ColumnaPlantillaActivos.objects.get(clave="observaciones")

    cliente.patch(f"{RUTA}{observaciones.id}/", {"orden": 1}, format="json")

    hoja = load_workbook(BytesIO(cliente.get("/api/v1/activos/plantilla-importacion/").content))[
        "Activos"
    ]
    assert [c.value for c in hoja[1]][0] == "Observaciones"


# --- Columnas propias ------------------------------------------------------


def test_se_puede_agregar_una_columna_propia_que_va_a_especificaciones(cliente, catalogos):
    """Permite pedir datos que el modelo no tiene como campo, sin migrar la
    tabla de activos."""
    respuesta = cliente.post(
        RUTA,
        {
            "clave": "espec:Procesador",
            "etiqueta": "Procesador",
            "ayuda": "Modelo del procesador",
            "obligatoria": False,
            "activa": True,
            "orden": 55,
        },
        format="json",
    )

    assert respuesta.status_code == 201
    assert respuesta.json()["es_especificacion"] is True

    creado = _subir(
        cliente,
        _archivo_desde_columnas({**BASE, "espec:Procesador": "Intel i7-1360P"}),
        confirmar=True,
    )
    assert creado.status_code == 201
    assert Activo.objects.get().especificaciones == {"Procesador": "Intel i7-1360P"}


def test_una_columna_propia_convive_con_la_columna_general_de_especificaciones(cliente, catalogos):
    ColumnaPlantillaActivos.objects.create(
        clave="espec:RAM", etiqueta="RAM", obligatoria=False, activa=True, orden=56
    )

    _subir(
        cliente,
        _archivo_desde_columnas(
            {**BASE, "espec:RAM": "16 GB", "especificaciones": "Disco=512 GB SSD"}
        ),
        confirmar=True,
    )

    assert Activo.objects.get().especificaciones == {"RAM": "16 GB", "Disco": "512 GB SSD"}


def test_una_columna_propia_obligatoria_se_exige(cliente, catalogos):
    ColumnaPlantillaActivos.objects.create(
        clave="espec:Factura", etiqueta="N.º de factura", obligatoria=True, activa=True, orden=57
    )

    respuesta = _subir(cliente, _archivo_desde_columnas(BASE))

    assert any(e["columna"] == "N.º de factura" for e in respuesta.json()["errores"])


def test_una_clave_inventada_sin_prefijo_se_rechaza(cliente, db):
    respuesta = cliente.post(
        RUTA, {"clave": "numero_factura", "etiqueta": "Factura", "orden": 60}, format="json"
    )

    assert respuesta.status_code == 400
    assert "espec:" in str(respuesta.json())


# --- Lo que no se puede configurar ----------------------------------------


def test_una_columna_estructural_no_se_puede_desactivar(cliente, db):
    tipo = ColumnaPlantillaActivos.objects.get(clave="tipo")

    respuesta = cliente.patch(f"{RUTA}{tipo.id}/", {"activa": False}, format="json")

    assert respuesta.status_code == 400
    tipo.refresh_from_db()
    assert tipo.activa is True


def test_una_columna_estructural_no_se_puede_volver_opcional(cliente, db):
    serie = ColumnaPlantillaActivos.objects.get(clave="numero_serie")

    respuesta = cliente.patch(f"{RUTA}{serie.id}/", {"obligatoria": False}, format="json")

    assert respuesta.status_code == 400


def test_una_columna_estructural_no_se_puede_eliminar(cliente, db):
    fecha = ColumnaPlantillaActivos.objects.get(clave="fecha_adquisicion")

    respuesta = cliente.delete(f"{RUTA}{fecha.id}/")

    assert respuesta.status_code == 400
    assert ColumnaPlantillaActivos.objects.filter(id=fecha.id).exists()


def test_una_columna_opcional_si_se_puede_eliminar(cliente, db):
    observaciones = ColumnaPlantillaActivos.objects.get(clave="observaciones")

    respuesta = cliente.delete(f"{RUTA}{observaciones.id}/")

    assert respuesta.status_code == 204


def test_la_clave_no_se_puede_cambiar_al_editar(cliente, db):
    columna = ColumnaPlantillaActivos.objects.get(clave="sede")

    respuesta = cliente.patch(f"{RUTA}{columna.id}/", {"clave": "observaciones"}, format="json")

    assert respuesta.status_code == 400


def test_dos_columnas_no_pueden_pedir_el_mismo_campo(cliente, db):
    """La segunda pisaría a la primera al leer el archivo."""
    respuesta = cliente.post(
        RUTA, {"clave": "sede", "etiqueta": "Otra sede", "orden": 70}, format="json"
    )

    assert respuesta.status_code == 400


# --- Catálogo y permisos ---------------------------------------------------


def test_el_catalogo_de_campos_indica_cuales_ya_tienen_columna(cliente, db):
    respuesta = cliente.get(f"{RUTA}campos-disponibles/")

    por_clave = {c["clave"]: c for c in respuesta.json()}
    assert por_clave["sede"]["en_uso"] is True
    assert por_clave["tipo"]["es_estructural"] is True


def test_configurar_la_plantilla_exige_permiso_de_edicion(db):
    """Quien carga inventario no debería poder cambiar qué se le exige al resto."""
    from django.contrib.auth.models import Group, Permission
    from django.contrib.contenttypes.models import ContentType

    from apps.permissions.models import ModulePermission

    usuario = User.objects.create_user(
        username="capturista", email="capturista@example.com", password="Sup3r-Secr3t!"
    )
    grupo = Group.objects.create(name="Capturista")
    grupo.permissions.set(
        Permission.objects.filter(
            content_type=ContentType.objects.get_for_model(ModulePermission),
            codename__in=["activos.ver", "activos.crear"],
        )
    )
    usuario.groups.add(grupo)
    client = APIClient()
    client.force_authenticate(user=usuario)

    columna = ColumnaPlantillaActivos.objects.get(clave="sede")

    # Puede consultarlas (necesita saber qué llenar) pero no cambiarlas.
    assert client.get(RUTA).status_code == 200
    assert client.patch(f"{RUTA}{columna.id}/", {"activa": False}, format="json").status_code == 403


def test_configurar_la_plantilla_queda_auditado(cliente, db):
    from apps.core.models import AuditLog

    columna = ColumnaPlantillaActivos.objects.get(clave="sede")
    cliente.patch(f"{RUTA}{columna.id}/", {"obligatoria": True}, format="json")

    evento = AuditLog.objects.filter(action="columna_plantilla.updated").get()
    assert evento.new_values["obligatoria"] is True
