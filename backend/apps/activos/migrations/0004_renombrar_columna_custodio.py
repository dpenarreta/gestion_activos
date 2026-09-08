"""Actualiza la columna del custodio en la plantilla: pide el código interno
del empleado, no su cédula.

La siembra de `0003` ya corrió en las instalaciones existentes con la etiqueta
anterior, y una migración aplicada no se vuelve a ejecutar. Esta corrige el
dato en esas bases; en una instalación nueva, `0003` ya siembra el valor
correcto y esta no encuentra nada que cambiar.

Solo toca la etiqueta y la ayuda si siguen siendo las originales: si alguien ya
personalizó esa columna desde el panel, su texto se respeta.
"""

from django.db import migrations

ETIQUETA_ANTERIOR = "Documento del custodio"
ETIQUETA_NUEVA = "Código del custodio"
AYUDA_NUEVA = "Código interno del empleado responsable (ej. EMP-0001). Vacío = queda en bodega."


def renombrar(apps, schema_editor):
    Columna = apps.get_model("activos", "ColumnaPlantillaActivos")
    Columna.objects.filter(clave="custodio", etiqueta=ETIQUETA_ANTERIOR).update(
        etiqueta=ETIQUETA_NUEVA, ayuda=AYUDA_NUEVA
    )


def revertir(apps, schema_editor):
    Columna = apps.get_model("activos", "ColumnaPlantillaActivos")
    Columna.objects.filter(clave="custodio", etiqueta=ETIQUETA_NUEVA).update(
        etiqueta=ETIQUETA_ANTERIOR,
        ayuda="Documento de identidad del empleado responsable. Vacío = queda en bodega.",
    )


class Migration(migrations.Migration):
    dependencies = [
        ("activos", "0003_sembrar_columnas_plantilla"),
    ]

    operations = [
        migrations.RunPython(renombrar, revertir),
    ]
