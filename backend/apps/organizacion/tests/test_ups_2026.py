"""La División UPS sale del área Comercial (28/10/2026).

La 0040 la dejó dentro de Comercial. La división pasa a su propia unidad
bajo la Gerencia General con sus cargos (conservan su rol y quienes los
ocupan), y Comercial queda solo con lo de su organigrama. Repetirlo no
cambia nada.
"""

from apps.organizacion import comercial_2026, ups_2026, versiones
from apps.organizacion.models import (
    Cargo,
    NivelCargo,
    NivelJerarquico,
    OcupanteCargo,
    UnidadOrganizacional,
    VersionOrganigrama,
)
from apps.organizacion.roles_de_cargo import asegurar_rol


def _como_quedo_la_0040():
    nivel = NivelJerarquico.objects.create(nombre="Área", orden=1)
    general = UnidadOrganizacional.objects.create(nombre="Gerencia General", nivel=nivel)
    comercial = UnidadOrganizacional.objects.create(nombre="Comercial", nivel=nivel, padre=general)
    cargos = {}

    def cargo(clave, nombre, jefe=None, unidad=comercial, plazas=1, activo=True):
        cargos[clave] = Cargo.objects.create(
            nombre=nombre,
            unidad=unidad,
            jefe=cargos.get(jefe),
            plazas=plazas,
            activo=activo,
            nivel=NivelCargo.OPERATIVO,
        )
        asegurar_rol(cargos[clave])

    cargo("general", "Gerente General", unidad=general)
    cargo("gerente", "Gerente Comercial", "general")
    cargo("asesor_ups", "Asesor Comercial UPS Quito", "gerente", plazas=3)
    cargo("asesor_ups_gye", "Asesor Comercial UPS Guayaquil", "gerente")
    cargo("coordinador", "Coordinador Servicio UPS", "gerente")
    cargo("supervisor", "Supervisor Operaciones UPS Quito", "coordinador")
    cargo("courier", "Courier UPS", "supervisor", plazas=3)
    cargo("motorizado", "Courier Motorizado", "supervisor", activo=False)
    cargo("sac", "Asesora de Servicio al Cliente UPS", "coordinador", plazas=5)
    # Como la dejó la 0041: la asistente comercial dentro de la división.
    cargo("asistente", "Asistente Comercial UPS Guayaquil", "coordinador")
    OcupanteCargo.objects.create(cargo=cargos["courier"], nombres="Luis", apellidos="Prueba")
    return general, comercial, cargos


def _activos(unidad):
    return {
        (c.nombre, c.jefe.nombre if c.jefe_id else None): c
        for c in Cargo.objects.filter(unidad=unidad, activo=True).select_related("jefe")
    }


def _como_la_migracion():
    with versiones.sin_peticion("prueba") as resultado:
        ups_2026.cambiar()
        comercial_2026.cambiar()
    return resultado["lineas"]


def test_la_division_sale_de_comercial(db):
    general, comercial, cargos = _como_quedo_la_0040()
    rol_coordinador = cargos["coordinador"].rol_id

    assert _como_la_migracion()

    ups = UnidadOrganizacional.objects.get(nombre="División UPS")
    assert ups.padre_id == general.id
    activos = _activos(ups)
    coordinador = activos[("Coordinador Servicio UPS", "Gerente General")]
    assert coordinador.id == cargos["coordinador"].id and coordinador.rol_id == rol_coordinador
    courier = activos[("Courier UPS", "Supervisor Operaciones UPS Quito")]
    assert courier.id == cargos["courier"].id
    assert [str(o) for o in courier.ocupantes_sin_cuenta.all()] == ["Luis Prueba"]
    # La asistente comercial no es de la división: allí se desactiva.
    assert Cargo.objects.get(pk=cargos["asistente"].pk).activo is False
    assert len(activos) == len(ups_2026.CARGOS)
    # Lo que estaba inactivo se mueve con su jefe y sigue inactivo.
    motorizado = Cargo.objects.get(pk=cargos["motorizado"].pk)
    assert motorizado.unidad_id == ups.id and motorizado.activo is False

    # Comercial queda solo con lo de su imagen.
    en_comercial = _activos(comercial)
    assert len(en_comercial) == len(comercial_2026.CARGOS)
    assert all(jefe == "Gerente Comercial" for nombre, jefe in en_comercial if "UPS" in nombre)
    # Internacional UPS, corregido por el usuario: ejecutivos y asistente.
    ejecutivo = en_comercial[("Ejecutivo de Negocios UPS Quito", "Gerente Comercial")]
    assert ejecutivo.id == cargos["asesor_ups"].id
    asistente = en_comercial[("Asistente Comercial UPS Guayaquil", "Gerente Comercial")]
    assert asistente.id == cargos["asesor_ups_gye"].id
    assert ("Ejecutiva de Negocios UPS Guayaquil", "Gerente Comercial") in en_comercial


def test_repetirlo_no_cambia_nada(db):
    _como_quedo_la_0040()
    _como_la_migracion()

    assert _como_la_migracion() == []
    assert ups_2026.aplicar() == []
    assert VersionOrganigrama.objects.count() == 1
