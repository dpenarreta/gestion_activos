"""El rol de pagos de ejemplo (solo desarrollo) con rubros propios de un mes
(18/11/2026): `por_mes` cambia los rubros de ese mes y deja los demás."""

import json
from decimal import Decimal

from django.test import override_settings

from apps.nomina import fuente


def test_un_mes_trae_sus_propios_rubros(tmp_path):
    archivo = tmp_path / "rol.json"
    archivo.write_text(
        json.dumps(
            {
                "E-1": {
                    "nombres": "ANA",
                    "fecha_ingreso": "2020-01-15",
                    "ingresos": [["Sueldo", "900.00"], ["Bono", "50.00"]],
                    "egresos": [["Aporte", "85.05"]],
                    "por_mes": {
                        "2026-11": {"ingresos": [["Sueldo básico", "487.00"]], "egresos": []}
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    with override_settings(
        NOMINA_ROL_PROCEDIMIENTO="", NOMINA_ROL_DEMO=True, NOMINA_ROL_EJEMPLO_ARCHIVO=str(archivo)
    ):
        noviembre = fuente.obtener("E-1", 2026, 11)
        octubre = fuente.obtener("E-1", 2026, 10)
    assert [(r.nombre, r.valor) for r in noviembre.ingresos] == [
        ("Sueldo básico", Decimal("487.00"))
    ]
    assert noviembre.egresos == []
    assert noviembre.nombres == "ANA"
    assert [r.nombre for r in octubre.ingresos] == ["Sueldo", "Bono"]
