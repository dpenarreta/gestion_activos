"""Los roles fuera del organigrama y la revisión previa al despliegue.

Desde el 21/10/2026 los roles del día a día son los cargos del organigrama; el
comando solo crea los de administración del sistema, Administrador y
Superusuario, con todo el catálogo, y ya no las plantillas por función.
"""

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.test import override_settings

from apps.permissions.catalog import all_codenames

pytestmark = pytest.mark.django_db


def _permisos_de(nombre: str) -> set[str]:
    return set(Group.objects.get(name=nombre).permissions.values_list("codename", flat=True))


def test_crea_administrador_y_superusuario_con_todo_el_catalogo():
    call_command("crear_roles_iniciales", verbosity=0)

    # Menos lo que se da persona por persona (consultar el rol de pagos).
    from apps.organizacion.permisos_por_cargo import SOLO_POR_PERSONA

    # El Administrador (TI), además, sin lo de Gestión Humana que no es suyo:
    # tareas, equipo, proyectos, ausencias, KPI (decisión del usuario,
    # 05/11/2026), informes ejecutivos, mejora continua, reuniones y escritorio
    # (06/11/2026).
    de_gestion_humana = {
        c
        for c in all_codenames()
        if c.startswith(
            (
                "tareas.",
                "equipo.",
                "proyectos_gh.",
                "ausencias.",
                "kpi.",
                "inteligencia_preventiva.",
                "informes_gh.",
                # Nova, la IA (09/11/2026, `roles/0041` y `roles/0042`).
                "nova.",
                "mejora_continua.",
                "reuniones.",
                "escritorio.",
                # Y las solicitudes de datos personales (09/11/2026).
                "privacidad.",
            )
        )
        # Salvo editar los textos de protección de datos (US-004, 11/11/2026).
        and c != "privacidad.textos"
    }
    assert de_gestion_humana
    assert _permisos_de("Administrador") == all_codenames() - SOLO_POR_PERSONA - de_gestion_humana
    assert _permisos_de("Superusuario") == all_codenames() - SOLO_POR_PERSONA


def test_el_administrador_edita_los_textos_de_privacidad_sin_atender_solicitudes():
    """US-004 (decisión del usuario del 11/11/2026): TI edita los textos de
    protección de datos, pero no ve ni atiende las solicitudes de derechos."""
    call_command("crear_roles_iniciales", verbosity=0)

    privacidad = {c for c in _permisos_de("Administrador") if c.startswith("privacidad.")}
    assert privacidad == {"privacidad.textos"}


def test_los_dos_roles_pueden_anular_permisos_aprobados():
    """`licencias.anular_aprobadas` (05/11/2026) está en el catálogo y en los
    dos roles de administración: no es de Gestión Humana que no sea de TI."""
    call_command("crear_roles_iniciales", verbosity=0)

    assert "licencias.anular_aprobadas" in all_codenames()
    assert "licencias.anular_aprobadas" in _permisos_de("Administrador")
    assert "licencias.anular_aprobadas" in _permisos_de("Superusuario")


def test_ya_no_crea_las_plantillas_por_funcion():
    """Los permisos de un técnico o de Talento Humano se marcan en el rol de su
    cargo, no en un rol aparte."""
    Group.objects.filter(name__in=["Soporte TI", "Talento Humano"]).delete()
    call_command("crear_roles_iniciales", verbosity=0)

    nombres = set(Group.objects.values_list("name", flat=True))
    assert (
        not {
            "Soporte TI",
            "Supervisor TI",
            "Consulta / Auditoría",
            "Usuario final",
            "Técnico de mesa de ayuda",
            "Talento Humano",
        }
        & nombres
    )


def test_volver_a_ejecutarlo_no_pisa_los_ajustes_hechos_a_mano():
    """Los roles se ajustan desde el panel: reescribir lo que alguien cambió
    sería peor que no correr."""
    call_command("crear_roles_iniciales", verbosity=0)
    administrador = Group.objects.get(name="Administrador")
    administrador.permissions.clear()

    call_command("crear_roles_iniciales", verbosity=0)

    assert administrador.permissions.count() == 0


def test_con_actualizar_si_reescribe():
    call_command("crear_roles_iniciales", verbosity=0)
    administrador = Group.objects.get(name="Administrador")
    administrador.permissions.clear()

    call_command("crear_roles_iniciales", "--actualizar", verbosity=0)

    assert administrador.permissions.count() > 0


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
