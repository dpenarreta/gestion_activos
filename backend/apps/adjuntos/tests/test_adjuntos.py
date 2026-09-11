"""Adjuntos, evidencias y actas (§18, §6 del documento funcional)."""

import datetime
import shutil
import tempfile

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient

from apps.activos.models import Activo, MovimientoActivo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.adjuntos.actas import ActaNoAplicable, generar_acta
from apps.adjuntos.models import TAMANO_MAXIMO_BYTES, Adjunto
from apps.mantenimientos.models import Mantenimiento
from apps.mantenimientos.services import MantenimientoService
from apps.organizacion.models import Departamento, Empleado
from apps.users.models import User

PDF = b"%PDF-1.4\n" + b"contenido de prueba " * 10
PNG = b"\x89PNG\r\n\x1a\n" + b"pixeles" * 10


@pytest.fixture
def almacenamiento_temporal():
    """Cada prueba escribe en su propio directorio, que se borra al terminar.

    Sin esto, las pruebas dejarían archivos en el `media/` del proyecto y
    acabarían dependiendo del orden de ejecución.
    """
    carpeta = tempfile.mkdtemp()
    with override_settings(MEDIA_ROOT=carpeta):
        yield carpeta
    shutil.rmtree(carpeta, ignore_errors=True)


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_adj", email="admin_adj@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin, almacenamiento_temporal):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def departamento(db):
    return Departamento.objects.create(nombre="Tecnología", codigo="TI")


@pytest.fixture
def empleado(departamento):
    return Empleado.objects.create(
        nombres="Ana María",
        apellidos="Pérez Gómez",
        codigo_empleado="EMP-0001",
        departamento=departamento,
    )


@pytest.fixture
def activo(db, admin, departamento):
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    return ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre="Laptop Contabilidad 01",
        marca="Dell",
        modelo="Latitude 5440",
        numero_serie="SN-ADJ-1",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2024, 1, 15),
        especificaciones={"Procesador": "i5", "RAM": "16 GB"},
    )


def _subir(cliente, activo, contenido=PDF, nombre="factura.pdf", tipo="factura", **extra):
    return cliente.post(
        "/api/v1/adjuntos/",
        {
            "activo": activo.id,
            "tipo": tipo,
            "archivo": SimpleUploadedFile(nombre, contenido, content_type="application/pdf"),
            **extra,
        },
        format="multipart",
    )


# --- Carga -----------------------------------------------------------------


def test_se_adjunta_un_documento_a_un_activo(cliente, activo, admin):
    respuesta = _subir(cliente, activo)

    assert respuesta.status_code == 201
    adjunto = Adjunto.objects.get()
    assert adjunto.activo == activo
    assert adjunto.tipo == Adjunto.Tipo.FACTURA
    assert adjunto.nombre_original == "factura.pdf"
    assert adjunto.subido_por == admin
    assert adjunto.tamano_bytes == len(PDF)


def test_el_archivo_se_guarda_con_un_nombre_generado(cliente, activo):
    """El nombre que trae el cliente puede llevar separadores, `..` o chocar
    con otro archivo: se conserva como dato, nunca como ruta."""
    _subir(cliente, activo, nombre="../../etc/factura.pdf")

    adjunto = Adjunto.objects.get()
    assert "etc" not in adjunto.archivo.name
    assert ".." not in adjunto.archivo.name
    assert adjunto.archivo.name.startswith(f"adjuntos/{activo.id}/")
    assert adjunto.archivo.name.endswith(".pdf")


def test_dos_archivos_con_el_mismo_nombre_no_se_pisan(cliente, activo):
    _subir(cliente, activo)
    _subir(cliente, activo)

    rutas = list(Adjunto.objects.values_list("archivo", flat=True))
    assert len(set(rutas)) == 2


def test_una_intervencion_de_otro_activo_no_se_puede_colgar_de_este(
    cliente, activo, admin, departamento
):
    otro = ActivoService.crear_activo(
        actor=admin,
        tipo=activo.tipo,
        nombre="Otro equipo",
        marca="HP",
        modelo="ProBook",
        numero_serie="SN-ADJ-2",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2024, 1, 15),
    )
    mantenimiento = MantenimientoService.registrar(
        actor=admin,
        activo=otro,
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=datetime.date(2024, 6, 1),
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        responsable="Soporte",
        descripcion="Reparación",
    )

    respuesta = _subir(cliente, activo, mantenimiento=mantenimiento.id)

    assert respuesta.status_code == 400
    assert "mantenimiento" in respuesta.json()["error"]["details"]


# --- Validación ------------------------------------------------------------


def test_una_extension_no_permitida_se_rechaza(cliente, activo):
    respuesta = _subir(cliente, activo, contenido=b"MZ\x90\x00", nombre="virus.exe")

    assert respuesta.status_code == 400
    assert Adjunto.objects.count() == 0


def test_un_ejecutable_renombrado_a_pdf_se_rechaza(cliente, activo):
    """La extensión la elige quien sube el archivo; la firma del contenido,
    no. Es lo que separa un control real de uno cosmético."""
    respuesta = _subir(cliente, activo, contenido=b"MZ\x90\x00ejecutable", nombre="factura.pdf")

    assert respuesta.status_code == 400
    assert "contenido" in str(respuesta.json()["error"]["details"]).lower()
    assert Adjunto.objects.count() == 0


def test_un_archivo_demasiado_grande_se_rechaza(cliente, activo):
    grande = b"%PDF-1.4\n" + b"x" * TAMANO_MAXIMO_BYTES

    respuesta = _subir(cliente, activo, contenido=grande, nombre="enorme.pdf")

    assert respuesta.status_code == 400
    assert Adjunto.objects.count() == 0


def test_un_archivo_vacio_se_rechaza(cliente, activo):
    respuesta = _subir(cliente, activo, contenido=b"", nombre="vacio.pdf")

    assert respuesta.status_code == 400


def test_una_imagen_valida_se_acepta(cliente, activo):
    respuesta = _subir(cliente, activo, contenido=PNG, nombre="equipo.png", tipo="foto")

    assert respuesta.status_code == 201
    assert Adjunto.objects.get().tipo == Adjunto.Tipo.FOTO


def test_el_archivo_se_guarda_completo(cliente, activo):
    """La validación lee los primeros bytes para comprobar la firma; si no
    devolviera el puntero al inicio, el archivo quedaría truncado."""
    _subir(cliente, activo)

    adjunto = Adjunto.objects.get()
    with adjunto.archivo.open("rb") as fichero:
        assert fichero.read() == PDF


# --- Descarga --------------------------------------------------------------


def test_la_descarga_devuelve_el_archivo_con_su_nombre_original(cliente, activo):
    _subir(cliente, activo, nombre="Factura Ñandú.pdf")
    adjunto = Adjunto.objects.get()

    respuesta = cliente.get(f"/api/v1/adjuntos/{adjunto.id}/descargar/")

    assert respuesta.status_code == 200
    assert b"".join(respuesta.streaming_content) == PDF
    assert "attachment" in respuesta["Content-Disposition"]
    # El nombre viaja codificado para no romper con acentos.
    assert "Factura" in respuesta["Content-Disposition"]


def test_la_descarga_impide_que_el_navegador_adivine_el_tipo(cliente, activo):
    """Un archivo subido por un usuario no debe poder ejecutarse en el
    navegador de otro."""
    _subir(cliente, activo)
    adjunto = Adjunto.objects.get()

    respuesta = cliente.get(f"/api/v1/adjuntos/{adjunto.id}/descargar/")

    assert respuesta["X-Content-Type-Options"] == "nosniff"


def test_la_descarga_queda_auditada(cliente, activo, admin):
    from apps.core.models import AuditLog

    _subir(cliente, activo)
    adjunto = Adjunto.objects.get()

    cliente.get(f"/api/v1/adjuntos/{adjunto.id}/descargar/")

    evento = AuditLog.objects.filter(action="adjunto.descargado").get()
    assert evento.actor == admin
    assert evento.new_values["nombre"] == "factura.pdf"


def test_si_falta_el_fichero_se_informa_en_vez_de_fallar(cliente, activo):
    _subir(cliente, activo)
    adjunto = Adjunto.objects.get()
    adjunto.borrar_archivo()

    respuesta = cliente.get(f"/api/v1/adjuntos/{adjunto.id}/descargar/")

    assert respuesta.status_code == 404


# --- Listado y borrado -----------------------------------------------------


def test_los_adjuntos_se_listan_por_activo(cliente, activo, admin, departamento):
    otro = ActivoService.crear_activo(
        actor=admin,
        tipo=activo.tipo,
        nombre="Otro",
        marca="HP",
        modelo="ProBook",
        numero_serie="SN-ADJ-3",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2024, 1, 15),
    )
    _subir(cliente, activo)
    _subir(cliente, otro)

    respuesta = cliente.get("/api/v1/adjuntos/", {"activo": activo.id})

    assert respuesta.json()["count"] == 1


def test_eliminar_un_adjunto_borra_tambien_el_archivo(cliente, activo):
    _subir(cliente, activo)
    adjunto = Adjunto.objects.get()
    ruta = adjunto.archivo.path

    respuesta = cliente.delete(f"/api/v1/adjuntos/{adjunto.id}/")

    import os

    assert respuesta.status_code == 204
    assert Adjunto.objects.count() == 0
    assert not os.path.exists(ruta)


def test_eliminar_deja_constancia_de_lo_que_habia(cliente, activo):
    """El registro desaparece, pero la auditoría conserva qué documento era
    y de qué equipo: es lo que permite saber después que existió."""
    from apps.core.models import AuditLog

    _subir(cliente, activo)
    adjunto = Adjunto.objects.get()

    cliente.delete(f"/api/v1/adjuntos/{adjunto.id}/")

    evento = AuditLog.objects.filter(action="adjunto.deleted").get()
    assert evento.new_values["nombre"] == "factura.pdf"
    assert evento.new_values["activo"] == activo.codigo_barras


def test_dar_de_baja_un_activo_no_borra_sus_adjuntos(cliente, activo, admin):
    """La baja es lógica: la factura y el acta de un equipo retirado siguen
    siendo el respaldo de que existió y de quién lo tuvo."""
    _subir(cliente, activo)

    ActivoService.cambiar_estado(
        actor=admin, activo=activo, estado=Activo.Estado.DADO_DE_BAJA, motivo="Obsoleto"
    )

    assert Adjunto.objects.filter(activo=activo).count() == 1


# --- Permisos --------------------------------------------------------------


def _usuario_con(codenames, almacenamiento_temporal):
    from django.contrib.auth.models import Group, Permission
    from django.contrib.contenttypes.models import ContentType

    from apps.permissions.models import ModulePermission

    usuario = User.objects.create_user(
        username=f"u_{'_'.join(codenames)}", password="Sup3r-S3cr3t!"
    )
    rol = Group.objects.create(name=f"rol_{'_'.join(codenames)}")
    rol.permissions.set(
        Permission.objects.filter(
            content_type=ContentType.objects.get_for_model(ModulePermission),
            codename__in=codenames,
        )
    )
    usuario.groups.add(rol)
    client = APIClient()
    client.force_authenticate(user=usuario)
    return client


def test_subir_exige_su_propio_permiso(db, activo, almacenamiento_temporal):
    client = _usuario_con(["adjuntos.ver"], almacenamiento_temporal)

    assert client.get("/api/v1/adjuntos/").status_code == 200
    assert _subir(client, activo).status_code == 403


def test_eliminar_exige_un_permiso_distinto_de_subir(db, activo, cliente, almacenamiento_temporal):
    """Un adjunto es evidencia: la factura o el acta firmada de un equipo no
    deberían poder desaparecer con el mismo permiso con el que se sube una
    foto."""
    _subir(cliente, activo)
    adjunto = Adjunto.objects.get()
    client = _usuario_con(["adjuntos.ver", "adjuntos.subir"], almacenamiento_temporal)

    assert client.delete(f"/api/v1/adjuntos/{adjunto.id}/").status_code == 403


def test_sin_permiso_no_se_ven_los_adjuntos(db, almacenamiento_temporal):
    client = _usuario_con(["activos.ver"], almacenamiento_temporal)

    assert client.get("/api/v1/adjuntos/").status_code == 403


# --- Actas -----------------------------------------------------------------


@pytest.fixture
def movimiento_de_entrega(admin, activo, empleado):
    ActivoService.asignar_responsables(
        actor=admin, activo=activo, responsables=[empleado], motivo="Entrega por ingreso"
    )
    return MovimientoActivo.objects.filter(tipo=MovimientoActivo.Tipo.ASIGNACION).latest("id")


def test_el_acta_de_entrega_se_genera_en_pdf(movimiento_de_entrega):
    contenido = generar_acta(movimiento_de_entrega, nombre_empresa="Grupo LAAR")

    assert contenido.startswith(b"%PDF-")
    assert len(contenido) > 1000


def test_el_acta_se_construye_desde_el_movimiento_y_no_desde_la_ficha(
    admin, activo, empleado, departamento, movimiento_de_entrega
):
    """El acta documenta un hecho con fecha. Si se rehiciera desde el estado
    actual, un equipo que ya cambió de custodio produciría un acta con el
    nombre equivocado."""
    otro = Empleado.objects.create(
        nombres="Luis",
        apellidos="Torres",
        codigo_empleado="EMP-0002",
        departamento=departamento,
    )
    ActivoService.asignar_responsables(
        actor=admin, activo=activo, responsables=[otro], motivo="Traslado"
    )

    contenido = generar_acta(movimiento_de_entrega)

    # El PDF comprime su contenido, así que se comprueba lo que sí es
    # verificable sin extraerlo: que sigue generándose contra el movimiento
    # original y que ese movimiento conserva al primer custodio.
    assert contenido.startswith(b"%PDF-")
    movimiento_de_entrega.refresh_from_db()
    assert movimiento_de_entrega.custodio_nuevo == empleado


def test_un_movimiento_que_no_es_entrega_ni_devolucion_no_tiene_acta(activo):
    alta = MovimientoActivo.objects.filter(tipo=MovimientoActivo.Tipo.ALTA).latest("id")

    with pytest.raises(ActaNoAplicable):
        generar_acta(alta)


def test_la_api_devuelve_el_acta_sin_guardarla(cliente, movimiento_de_entrega):
    respuesta = cliente.get("/api/v1/adjuntos/acta/", {"movimiento": movimiento_de_entrega.id})

    assert respuesta.status_code == 200
    assert respuesta["Content-Type"] == "application/pdf"
    assert respuesta.content.startswith(b"%PDF-")
    assert Adjunto.objects.count() == 0


def test_el_acta_se_puede_archivar_como_adjunto(cliente, movimiento_de_entrega, activo):
    respuesta = cliente.post(
        "/api/v1/adjuntos/acta/", {"movimiento": movimiento_de_entrega.id}, format="json"
    )

    assert respuesta.status_code == 201
    adjunto = Adjunto.objects.get()
    assert adjunto.tipo == Adjunto.Tipo.ACTA_ENTREGA
    assert adjunto.generado_por_el_sistema is True
    assert adjunto.activo == activo
    assert adjunto.nombre_original.endswith(".pdf")


def test_archivar_dos_veces_no_duplica_el_acta(cliente, movimiento_de_entrega):
    """El documento del movimiento es uno solo; dos copias en la ficha harían
    dudar de cuál se firmó."""
    primera = cliente.post(
        "/api/v1/adjuntos/acta/", {"movimiento": movimiento_de_entrega.id}, format="json"
    )
    segunda = cliente.post(
        "/api/v1/adjuntos/acta/", {"movimiento": movimiento_de_entrega.id}, format="json"
    )

    assert primera.status_code == 201
    assert segunda.status_code == 200
    assert Adjunto.objects.count() == 1


def test_la_devolucion_genera_un_acta_de_devolucion(cliente, admin, activo, empleado):
    ActivoService.asignar_responsables(actor=admin, activo=activo, responsables=[empleado])
    ActivoService.asignar_responsables(
        actor=admin, activo=activo, responsables=[], motivo="Devuelve"
    )
    devolucion = MovimientoActivo.objects.filter(tipo=MovimientoActivo.Tipo.DEVOLUCION).latest("id")

    respuesta = cliente.post("/api/v1/adjuntos/acta/", {"movimiento": devolucion.id}, format="json")

    assert respuesta.status_code == 201
    assert Adjunto.objects.get().tipo == Adjunto.Tipo.ACTA_DEVOLUCION


def test_el_acta_de_un_movimiento_sin_acta_se_rechaza(cliente, activo):
    alta = MovimientoActivo.objects.filter(tipo=MovimientoActivo.Tipo.ALTA).latest("id")

    respuesta = cliente.get("/api/v1/adjuntos/acta/", {"movimiento": alta.id})

    assert respuesta.status_code == 400


def test_generar_el_acta_sin_indicar_movimiento_se_rechaza(cliente):
    assert cliente.get("/api/v1/adjuntos/acta/").status_code == 400
