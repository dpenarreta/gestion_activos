"""Suma proveedor y fin de garantía a la plantilla de carga masiva.

Se añaden desactivadas por defecto. La plantilla es configurable desde el panel
y muchas empresas no llevan estos datos: activarlas para todos añadiría dos
columnas que la mayoría dejaría vacías, y una plantilla con columnas de relleno
es más difícil de completar, no más completa. Quien las necesite las habilita
en «Columnas de la plantilla».
"""

from django.db import migrations

COLUMNAS = [
    (
        "proveedor",
        "Proveedor",
        "Empresa o canal donde se adquirió el equipo.",
    ),
    (
        "fecha_fin_garantia",
        "Fin de garantía",
        "Formato AAAA-MM-DD. Vacío = el equipo no tiene garantía registrada.",
    ),
]


def sembrar(apps, schema_editor):
    Columna = apps.get_model("activos", "ColumnaPlantillaActivos")
    ultimo = Columna.objects.order_by("-orden").values_list("orden", flat=True).first() or 0

    for indice, (clave, etiqueta, ayuda) in enumerate(COLUMNAS, start=1):
        Columna.objects.get_or_create(
            clave=clave,
            defaults={
                "etiqueta": etiqueta,
                "ayuda": ayuda,
                "obligatoria": False,
                "activa": False,
                "orden": ultimo + indice * 10,
            },
        )


def revertir(apps, schema_editor):
    Columna = apps.get_model("activos", "ColumnaPlantillaActivos")
    Columna.objects.filter(clave__in=[clave for clave, _, _ in COLUMNAS]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("activos", "0005_activo_fecha_fin_garantia_activo_proveedor"),
    ]

    operations = [
        migrations.RunPython(sembrar, revertir),
    ]
