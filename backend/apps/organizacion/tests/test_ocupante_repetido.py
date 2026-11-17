"""El organigrama no muestra dos veces a la misma persona (17/11/2026).

Reporte del usuario: «¿por qué en el organigrama hay 2 nombres en cada
rol?». La persona salía por su cuenta (cargo en Mi perfil, nombre de nómina)
y por su registro «sin cuenta» de la imagen del área.
"""

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.empresas.models import MembresiaEmpresa
from apps.organizacion import organigrama
from apps.organizacion.models import Cargo, DatosDeContacto, OcupanteCargo
from apps.users.models import User


def test_el_sin_cuenta_de_la_misma_persona_no_se_repite_y_otra_persona_si(db):
    empresa = empresa_actual()
    with usando_empresa(empresa):
        cargo = Cargo.objects.create(nombre="Coordinador Nacional de GGHH")
        usuario = User.objects.create_user(
            username="ajacome",
            email="ajacome@grupolaar.com",
            password="x",
            first_name="Anthony Roberto",
            last_name="Jacome Buñay",
        )
        MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
        DatosDeContacto.objects.create(usuario=usuario, cargo=cargo)
        OcupanteCargo.objects.create(cargo=cargo, nombres="Antonhy", apellidos="Jácome")
        OcupanteCargo.objects.create(cargo=cargo, nombres="Farid", apellidos="Maldonado")

        solo_asignados = [p["nombre"] for p in organigrama.ocupantes()[cargo.pk]]
        con_sin_cuenta = [
            p["nombre"] for p in organigrama.ocupantes(incluir_sin_cuenta=True)[cargo.pk]
        ]

    # Decisión del usuario: el organigrama muestra solo a los asignados.
    assert solo_asignados == ["Anthony Roberto Jacome Buñay"]
    # Con los «sin cuenta», la misma persona no se repite y otra sí aparece.
    assert con_sin_cuenta == ["Anthony Roberto Jacome Buñay", "Farid Maldonado"]
