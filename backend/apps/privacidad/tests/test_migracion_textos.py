"""La migración de datos de US-004 (`privacidad/0007`): los textos de antes
pasan al catálogo con su versión y las aceptaciones de antes al registro
común, sin perder nada (CA-6) y sin copiar dos veces si se repite.

Se corre `copiar` con el registro de modelos del proyecto y sin empresa
activa, como corre `migrate` (los gestores no acotan)."""

from importlib import import_module

import pytest
from django.apps import apps
from django.utils import timezone

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa
from apps.organizacion.models import AceptacionConfidencialidad, DatosDeContacto, TextoLegal
from apps.privacidad import catalogo_textos as cat
from apps.privacidad.models import (
    AceptacionAviso,
    AceptacionTexto,
    AvisoPrivacidad,
    TextoProteccion,
    VersionTextoProteccion,
)

from .conftest import make_user

pytestmark = pytest.mark.django_db

migracion = import_module("apps.privacidad.migrations.0007_copiar_textos_y_aceptaciones")


@pytest.fixture
def heredada():
    """Una empresa con los datos de antes de US-004 y sin catálogo."""
    empresa = Empresa.objects.create(codigo="HEREDADA", nombre="Heredada Peñón")
    begona = make_user("bpena", first_name="Begoña")
    ahora = timezone.now()
    with usando_empresa(empresa):
        AvisoPrivacidad.objects.create(
            texto="Aviso viejo de la empresa Heredada, versión tres.",
            version=3,
            version_desde=ahora,
        )
        AceptacionAviso.objects.create(
            usuario=begona, version="3", aceptado_en=ahora, ip="10.0.0.7", texto="Aviso viejo"
        )
        AceptacionAviso.objects.create(
            usuario=begona,
            version="Nexo",
            origen="NEXO",
            aceptado_en=ahora - timezone.timedelta(days=90),
            id_nexo=41,
        )
        TextoLegal.objects.create(
            clave="autorizacion_telefono", texto="Autorizo el teléfono, versión dos.", version=2
        )
        DatosDeContacto.objects.create(
            usuario=begona,
            telefono="0991112222",
            telefono_aceptado_en=ahora,
            telefono_aceptado_ip="10.0.0.8",
            telefono_aceptado_texto="Autorizo el teléfono, versión dos.",
            telefono_aceptado_version=2,
            mostrar_cumpleanos=True,
            cumpleanos_dia=25,
            cumpleanos_mes=10,
            cumpleanos_aceptado_en=ahora,
            correo_personal="bego@example.com",
            correo_personal_aceptado_en=ahora,
        )
        AceptacionConfidencialidad.objects.create(
            usuario=begona,
            version_documentos=1,
            titulo_aceptado="Acuerdo de confidencialidad",
            texto_aceptado="Texto del acuerdo.",
        )
    return empresa, begona


def _copiar():
    with usando_empresa(None):
        migracion.copiar(apps, None)


def test_copia_textos_con_su_version_y_aceptaciones_sin_perder_nada(heredada):
    empresa, begona = heredada
    _copiar()
    with usando_empresa(empresa):
        textos = {t.clave: t for t in TextoProteccion.objects.all()}
        assert set(textos) == set(cat.CLAVES)
        aviso = textos[cat.AVISO_PRIVACIDAD]
        assert (aviso.version, aviso.version_exigida) == (3, 3)
        assert textos[cat.AUTORIZACION_TELEFONO].version == 2
        assert textos[cat.CUMPLEANOS_PUBLICO].texto == cat.CUMPLEANOS
        assert VersionTextoProteccion.objects.count() == len(cat.CLAVES)

        de = AceptacionTexto.objects.filter(usuario=begona)
        intranet = de.get(texto_proteccion=aviso, origen="INTRANET")
        assert (intranet.version, intranet.ip) == (3, "10.0.0.7")
        nexo = de.get(texto_proteccion=aviso, origen="NEXO")
        assert nexo.version is None and nexo.id_nexo == 41
        telefono = de.get(texto_proteccion__clave=cat.AUTORIZACION_TELEFONO)
        assert (telefono.version, telefono.ip, telefono.retirada_en) == (2, "10.0.0.8", None)
        # Las que solo guardaban la fecha: migradas, sin IP ni texto (CA-6).
        for clave in (cat.CUMPLEANOS_PUBLICO, cat.ROL_PAGOS_CORREO_CLAVE):
            migrada = de.get(texto_proteccion__clave=clave)
            assert migrada.origen == "MIGRADA"
            assert migrada.ip is None and migrada.texto_aceptado == ""
        acuerdo = de.get(texto_proteccion__clave=cat.ACUERDO_CONFIDENCIALIDAD)
        assert acuerdo.texto_aceptado == "Texto del acuerdo."

    # El servicio entiende lo migrado: el aviso de la versión 3 vale.
    from apps.privacidad import textos as servicio

    with usando_empresa(empresa):
        assert servicio.acepto_vigente(begona, cat.AVISO_PRIVACIDAD) is True
        assert servicio.acepto_vigente(begona, cat.AUTORIZACION_TELEFONO) is True
        assert servicio.acepto_vigente(begona, cat.CUMPLEANOS_PUBLICO) is True


def test_repetirla_no_copia_dos_veces(heredada):
    empresa, _ = heredada
    _copiar()
    with usando_empresa(empresa):
        antes = (
            TextoProteccion.objects.count(),
            AceptacionTexto.objects.count(),
            VersionTextoProteccion.objects.count(),
        )
    _copiar()
    with usando_empresa(empresa):
        despues = (
            TextoProteccion.objects.count(),
            AceptacionTexto.objects.count(),
            VersionTextoProteccion.objects.count(),
        )
    assert antes == despues
    assert antes[1] == 6


def test_un_telefono_borrado_queda_como_retirado(heredada):
    empresa, begona = heredada
    with usando_empresa(empresa):
        DatosDeContacto.objects.filter(usuario=begona).update(telefono="")
    _copiar()
    with usando_empresa(empresa):
        telefono = AceptacionTexto.objects.get(
            usuario=begona, texto_proteccion__clave=cat.AUTORIZACION_TELEFONO
        )
    assert telefono.retirada_en is not None and telefono.retirada_por == begona


def test_los_textos_de_la_migracion_son_los_del_catalogo():
    """La migración lleva su copia; el día del cambio deben coincidir (CA-8)."""
    for clave, _, _, _, requiere, inicial, titulo in migracion.CATALOGO:
        entrada = cat.POR_CLAVE[clave]
        assert entrada.requiere_aceptacion == requiere
        assert entrada.titulo == titulo
        if clave != cat.AVISO_PRIVACIDAD:
            assert entrada.texto == inicial
    assert migracion._aviso_inicial("Demo") == cat.inicial(cat.AVISO_PRIVACIDAD, "Demo")


# ── B-1 y O-8 de QA-FUNC (11/11/2026) ─────────────────────────────────────────


def test_una_empresa_sin_aviso_sigue_sin_exigirlo():
    """B-1: sin `AvisoPrivacidad` no se siembra el aviso general; si se
    sembrara, toda la empresa tendría que aceptarlo desde el despliegue."""
    empresa = Empresa.objects.create(codigo="SINAVISO", nombre="Sin Aviso Ñandú")
    with usando_empresa(empresa):
        nuno = make_user("nmunoz", first_name="Nuño")
    _copiar()
    from apps.privacidad import consentimiento

    with usando_empresa(empresa):
        assert not TextoProteccion.objects.filter(clave=cat.AVISO_PRIVACIDAD).exists()
        # Los demás textos sí se siembran.
        assert TextoProteccion.objects.count() == len(cat.CLAVES) - 1
        estado = consentimiento.estado_propio(nuno)
        assert estado["exigido"] is False
        assert estado["pendiente"] is False


def test_el_aniversario_aceptado_sigue_valiendo(heredada):
    empresa, begona = heredada
    with usando_empresa(empresa):
        DatosDeContacto.objects.filter(usuario=begona).update(
            mostrar_aniversario=True,
            aniversario_dia=3,
            aniversario_mes=2,
            aniversario_aceptado_en=timezone.now(),
        )
    _copiar()
    from apps.privacidad import textos as servicio

    with usando_empresa(empresa):
        fila = AceptacionTexto.objects.get(
            usuario=begona, texto_proteccion__clave=cat.ANIVERSARIO_PUBLICO
        )
        assert (fila.origen, fila.version, fila.ip, fila.texto_aceptado) == (
            "MIGRADA",
            1,
            None,
            "",
        )
        assert servicio.acepto_vigente(begona, cat.ANIVERSARIO_PUBLICO) is True


def test_cada_consulta_del_rol_es_una_aceptacion(heredada):
    from apps.nomina.models import ConsultaRolPagos

    empresa, begona = heredada
    with usando_empresa(empresa):
        consultas = [
            ConsultaRolPagos.objects.create(
                usuario=begona,
                codigo_empleado="EMP-0007",
                anio=2026,
                mes=mes,
                version_terminos=1,
                terminos_aceptados="Declaro que soy el titular del rol (versión de prueba).",
                ip="10.0.0.9",
                navegador="Mozilla/5.0 (Windows NT 10.0) — prueba",
            )
            for mes in (8, 9, 10)
        ]
    _copiar()
    with usando_empresa(empresa):
        filas = AceptacionTexto.objects.filter(
            usuario=begona, texto_proteccion__clave=cat.ROL_PAGOS_TERMINOS_CLAVE
        )
        assert set(filas.values_list("referencia", flat=True)) == {
            f"nomina.ConsultaRolPagos:{c.pk}" for c in consultas
        }
        for consulta in consultas:
            fila = filas.get(referencia=f"nomina.ConsultaRolPagos:{consulta.pk}")
            assert fila.aceptado_en == consulta.created_at
            assert (fila.version, fila.ip) == (1, "10.0.0.9")
            assert fila.navegador == consulta.navegador
            assert fila.texto_aceptado == consulta.terminos_aceptados


def test_del_acuerdo_solo_vale_la_version_de_los_documentos_vigente(heredada):
    from apps.organizacion.models import AcuerdoConfidencialidad
    from apps.privacidad import textos as servicio

    empresa, begona = heredada
    with usando_empresa(empresa):
        AcuerdoConfidencialidad.objects.create(
            titulo="Acuerdo de confidencialidad", texto="Texto del acuerdo.", version_documentos=4
        )
        ines = make_user("iibanez", first_name="Inés")
        AceptacionConfidencialidad.objects.filter(usuario=begona).update(version_documentos=4)
        AceptacionConfidencialidad.objects.create(
            usuario=ines,
            version_documentos=3,
            titulo_aceptado="Acuerdo de confidencialidad",
            texto_aceptado="Texto del acuerdo.",
        )
    _copiar()
    with usando_empresa(empresa):
        acuerdo = TextoProteccion.objects.get(clave=cat.ACUERDO_CONFIDENCIALIDAD)
        assert (acuerdo.version, acuerdo.version_exigida) == (4, 4)
        assert servicio.acepto_vigente(begona, cat.ACUERDO_CONFIDENCIALIDAD) is True
        assert servicio.acepto_vigente(ines, cat.ACUERDO_CONFIDENCIALIDAD) is False
        # La de la versión 3 no se pierde: queda como constancia.
        assert AceptacionTexto.objects.filter(texto_proteccion=acuerdo, usuario=ines).exists()


def test_una_aceptacion_del_aviso_restablecida_no_vale(heredada):
    from apps.privacidad import textos as servicio

    empresa, begona = heredada
    with usando_empresa(empresa):
        AceptacionAviso.objects.filter(usuario=begona, origen="INTRANET").update(
            restablecida_en=timezone.now()
        )
    _copiar()
    with usando_empresa(empresa):
        fila = AceptacionTexto.objects.get(
            usuario=begona, texto_proteccion__clave=cat.AVISO_PRIVACIDAD, origen="INTRANET"
        )
        assert fila.restablecida_en is not None
        assert servicio.acepto_vigente(begona, cat.AVISO_PRIVACIDAD) is False


def test_el_aviso_migrado_rige_desde_que_se_pidio_aceptarlo(heredada):
    """O-6: «Rige desde» es `version_desde` del aviso, no su última
    corrección (`updated_at`)."""
    from apps.privacidad import consentimiento

    empresa, _ = heredada
    pedido = timezone.now() - timezone.timedelta(days=30)
    corregido = timezone.now() - timezone.timedelta(days=2)
    with usando_empresa(empresa):
        AvisoPrivacidad.objects.update(version_desde=pedido, updated_at=corregido)
        ramon = make_user("rnunez", first_name="Ramón", perms=("privacidad.ver",))
    _copiar()
    with usando_empresa(empresa):
        resumen = consentimiento.resumen_del_aviso(ramon)
    assert resumen["version"] == 3
    assert resumen["version_desde"] == pedido.isoformat()
