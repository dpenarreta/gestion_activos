"""Los cuatro roles del §13 y la revisión previa al despliegue.

Lo que se verifica de los roles no es que existan, sino **lo que cada uno no
puede hacer**: un rol que lo puede todo no separa responsabilidades, y la
separación es la única razón por la que existen cuatro y no uno.
"""

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.test import override_settings

from apps.permissions.catalog import all_codenames

pytestmark = pytest.mark.django_db


def _permisos_de(nombre: str) -> set[str]:
    return set(Group.objects.get(name=nombre).permissions.values_list("codename", flat=True))


def test_crea_los_cuatro_roles_del_documento():
    """Se suman a los que ya haya: el proyecto base trae su propio rol de
    superusuario, y borrarlo dejaría sin acceso a quien lo tuviera."""
    call_command("crear_roles_iniciales", verbosity=0)

    creados = {"Administrador", "Soporte TI", "Supervisor TI", "Consulta / Auditoría"}
    assert creados <= set(Group.objects.values_list("name", flat=True))


def test_el_administrador_tiene_el_catalogo_completo():
    """Existe para no depender de una cuenta de superusuario en el día a día:
    el superusuario se salta el catálogo entero y no deja ver qué puede hacer."""
    call_command("crear_roles_iniciales", verbosity=0)

    assert _permisos_de("Administrador") == all_codenames()


def test_soporte_no_puede_dar_de_baja_un_activo():
    """El §13 pone la aprobación de bajas en el supervisor. Quien opera el
    inventario a diario no debería poder sacar un equipo del parque sin que
    nadie más lo mire."""
    call_command("crear_roles_iniciales", verbosity=0)
    permisos = _permisos_de("Soporte TI")

    assert "activos.crear" in permisos
    assert "activos.asignar" in permisos
    assert "activos.dar_baja" not in permisos


def test_soporte_no_puede_borrar_evidencia():
    """Un adjunto es evidencia: subirlo es parte de la operación, borrarlo no."""
    call_command("crear_roles_iniciales", verbosity=0)
    permisos = _permisos_de("Soporte TI")

    assert "adjuntos.subir" in permisos
    assert "adjuntos.eliminar" not in permisos


def test_el_supervisor_aprueba_pero_no_opera():
    """La separación es lo que hace que la aprobación signifique algo: si
    quien decide la baja es también quien mantiene la ficha, no hay control."""
    call_command("crear_roles_iniciales", verbosity=0)
    permisos = _permisos_de("Supervisor TI")

    assert "activos.dar_baja" in permisos
    assert "politicas.editar" in permisos
    assert "activos.crear" not in permisos
    assert "activos.editar" not in permisos


def test_consulta_no_puede_modificar_nada():
    """«Visualiza información histórica sin modificar datos», dice el §13."""
    call_command("crear_roles_iniciales", verbosity=0)
    permisos = _permisos_de("Consulta / Auditoría")

    escrituras = {
        codename
        for codename in permisos
        if not codename.endswith((".ver", ".ver_detalle", ".exportar"))
    }
    assert not escrituras, f"el rol de solo lectura tiene permisos de escritura: {escrituras}"


def test_consulta_no_ve_la_ubicacion_de_la_auditoria():
    """Es un dato personal de contexto: se concede aparte, a quien lo necesite
    y por un motivo concreto."""
    call_command("crear_roles_iniciales", verbosity=0)

    assert "auditoria.ver_ubicacion" not in _permisos_de("Consulta / Auditoría")


def test_volver_a_ejecutarlo_no_pisa_los_ajustes_hechos_a_mano():
    """Los roles son una decisión de cada empresa: el comando es una plantilla,
    y reescribir lo que alguien ajustó desde el panel sería peor que no correr."""
    call_command("crear_roles_iniciales", verbosity=0)
    soporte = Group.objects.get(name="Soporte TI")
    soporte.permissions.clear()

    call_command("crear_roles_iniciales", verbosity=0)

    assert soporte.permissions.count() == 0


def test_con_actualizar_si_reescribe():
    call_command("crear_roles_iniciales", verbosity=0)
    soporte = Group.objects.get(name="Soporte TI")
    soporte.permissions.clear()

    call_command("crear_roles_iniciales", "--actualizar", verbosity=0)

    assert soporte.permissions.count() > 0


# --- Revisión previa al despliegue ---


@override_settings(DEBUG=True)
def test_la_verificacion_falla_si_debug_esta_encendido(capsys):
    """Con DEBUG, cualquier error muestra la traza completa a quien lo provoque."""
    with pytest.raises(SystemExit) as salida:
        call_command("verificar_despliegue")

    assert salida.value.code == 1
    assert "DEBUG" in capsys.readouterr().out


@override_settings(DEBUG=False, EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend")
def test_la_verificacion_pasa_con_una_configuracion_correcta(capsys):
    call_command("crear_roles_iniciales", verbosity=0)

    call_command("verificar_despliegue")

    assert "criticas" in capsys.readouterr().out


@override_settings(DEBUG=False)
def test_avisa_de_que_el_correo_no_sale_de_verdad(capsys):
    """El envío se da por exitoso y el mensaje se imprime en el log: la
    bitácora dirá que salió y nadie lo habrá recibido."""
    call_command("verificar_despliegue")

    assert "EMAIL_BACKEND no envia correo de verdad" in capsys.readouterr().out


@override_settings(DEBUG=False)
def test_avisa_de_que_falta_el_inventario_inicial(capsys):
    """Es el riesgo número uno del §26 del documento funcional."""
    call_command("verificar_despliegue")

    assert "activos registrados" in capsys.readouterr().out
