"""El parque de demostración se siembra y se retira entero.

Lo que se prueba no es que existan filas, sino las dos propiedades de las que
depende que sirva: que volver a correrlo no duplique nada —se ejecuta más de una
vez mientras se prepara una demostración— y que `--eliminar` no deje rastro,
porque es lo que hay que correr antes de pasar a producción.
"""

import pytest
from django.core.management import call_command

from apps.activos.models import Activo, TipoDispositivo
from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.mantenimientos.models import CatalogoComponente, ComponenteUtilizado, Mantenimiento
from apps.organizacion.models import Departamento, Empleado, Proveedor, Sede
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def empresas():
    courier = Empresa.objects.create(nombre="LaarCourier", codigo="LC")
    seguridad = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    User.objects.create_superuser(
        username="raiz", email="raiz@example.com", password="Sup3r-Secr3t!"
    )
    return courier, seguridad


def _contar(empresa):
    with usando_empresa(empresa):
        return {
            "activos": Activo.objects.count(),
            "tipos": TipoDispositivo.objects.count(),
            "departamentos": Departamento.objects.count(),
            "sedes": Sede.objects.count(),
            "proveedores": Proveedor.objects.count(),
            "empleados": Empleado.objects.count(),
            "componentes": CatalogoComponente.objects.count(),
            "mantenimientos": Mantenimiento.objects.count(),
        }


def test_siembra_las_dos_empresas_con_lo_pedido(empresas):
    courier, seguridad = empresas

    call_command("sembrar_datos_demo")

    assert _contar(courier) == {
        "activos": 10,
        "tipos": 2,
        "departamentos": 5,
        "sedes": 4,
        "proveedores": 4,
        "empleados": 6,
        "componentes": 10,
        "mantenimientos": 8,
    }
    en_seguridad = _contar(seguridad)
    assert en_seguridad["activos"] == 5
    assert en_seguridad["mantenimientos"] == 3


def test_lo_sembrado_no_se_ve_desde_la_otra_empresa(empresas):
    """Es lo que se quiere enseñar con dos empresas sembradas."""
    courier, seguridad = empresas

    call_command("sembrar_datos_demo")

    with usando_empresa(seguridad):
        assert not Mantenimiento.objects.filter(responsable="Técnico interno de TI").filter(
            activo__nombre="Laptop Jefatura TI"
        )
        assert not Activo.objects.filter(nombre="Laptop Jefatura TI").exists()


def test_volver_a_correrlo_no_duplica_nada(empresas):
    courier, _ = empresas
    call_command("sembrar_datos_demo")
    primera = _contar(courier)

    call_command("sembrar_datos_demo")

    assert _contar(courier) == primera


def test_las_cuentas_nacen_con_su_empresa_y_su_rol(empresas):
    from django.contrib.auth.models import Group

    Group.objects.create(name="Soporte TI")
    courier, seguridad = empresas

    call_command("sembrar_datos_demo")

    compartida = User.objects.get(username="cmunozvera")
    empresas_de_la_cuenta = {m.empresa.nombre for m in compartida.membresias.all()}
    # Trabaja en las dos: es el caso que hay que poder mirar.
    assert empresas_de_la_cuenta == {"LaarCourier", "LaarSeguridad"}
    membresia = compartida.membresias.get(empresa=courier)
    assert [rol.name for rol in membresia.roles.all()] == ["Soporte TI"]


def test_eliminar_no_deja_rastro(empresas):
    courier, seguridad = empresas
    call_command("sembrar_datos_demo")

    call_command("sembrar_datos_demo", eliminar=True)

    for empresa in (courier, seguridad):
        cifras = _contar(empresa)
        assert cifras["activos"] == 0, empresa
        assert cifras["mantenimientos"] == 0, empresa
        assert cifras["empleados"] == 0, empresa
        assert cifras["componentes"] == 0, empresa
    assert not ComponenteUtilizado.objects.todas().exists()
    assert not User.objects.filter(username="cmunozvera").exists()
    assert not MembresiaEmpresa.objects.filter(usuario__username="cmunozvera").exists()
    # Las empresas no se tocan: son configuración, no datos de demostración.
    assert Empresa.objects.filter(nombre__in=["LaarCourier", "LaarSeguridad"]).count() == 2


# --- Lo que la revisión de seguridad exigió (AC-SEC-001, AC-SEC-002) ---------


def test_la_clave_no_esta_escrita_en_el_codigo(empresas, monkeypatch):
    """Una clave fija quedaría en el historial de Git para siempre."""
    import inspect

    from apps.core.management.commands import sembrar_datos_demo

    fuente = inspect.getsource(sembrar_datos_demo)
    # Se genera o se toma del entorno: no hay literal que sirva para entrar.
    assert "secrets.token_urlsafe" in fuente
    assert "DEMO_PASSWORD" in fuente

    monkeypatch.setenv("DEMO_PASSWORD", "Elegida.2026$Laar")
    call_command("sembrar_datos_demo")

    assert User.objects.get(username="cmunozvera").check_password("Elegida.2026$Laar")


def test_las_cuentas_obligan_a_cambiar_la_contrasena(empresas):
    """La clave se imprime en una consola, y una consola se comparte."""
    call_command("sembrar_datos_demo")

    creadas = User.objects.filter(username__in=["cmunozvera", "vespintoapanta"])
    assert creadas.count() == 2
    assert all(cuenta.must_change_password for cuenta in creadas)


def test_verificar_despliegue_las_detecta(empresas):
    """Depender de que alguien se acuerde es depender de que nadie tenga prisa."""
    from apps.core.management.commands.sembrar_datos_demo import usuarios_demo

    call_command("sembrar_datos_demo")

    assert User.objects.filter(username__in=usuarios_demo()).exists()

    call_command("sembrar_datos_demo", eliminar=True)

    assert not User.objects.filter(username__in=usuarios_demo()).exists()
