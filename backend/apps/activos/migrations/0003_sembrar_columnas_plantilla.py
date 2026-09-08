"""Siembra las columnas de la plantilla de carga masiva con la configuración
que el sistema traía fija hasta ahora.

Se siembra en vez de dejar la tabla vacía porque una plantilla sin columnas no
sirve para nada: quien entre a configurarla debe encontrar el juego completo
funcionando y ajustarlo, no armarlo desde cero para poder usar la función.
"""

from django.db import migrations

COLUMNAS = [
    # (clave, etiqueta, ayuda, obligatoria)
    (
        "tipo",
        "Tipo de dispositivo",
        "Código o nombre exacto de un tipo registrado (ej. LAP o Laptop).",
        True,
    ),
    ("nombre", "Nombre del activo", "Nombre corto del equipo. Se imprime en la etiqueta.", True),
    ("marca", "Marca", "Fabricante del equipo.", True),
    ("modelo", "Modelo", "Modelo comercial.", True),
    (
        "numero_serie",
        "Número de serie",
        "Serie del fabricante. Único en todo el inventario.",
        True,
    ),
    (
        "departamento",
        "Departamento",
        "Código o nombre exacto de un área registrada (ej. TI o Tecnología).",
        True,
    ),
    (
        "fecha_adquisicion",
        "Fecha de adquisición",
        "Formato AAAA-MM-DD. Base del cálculo de vida útil.",
        True,
    ),
    (
        "custodio",
        "Código del custodio",
        "Código interno del empleado responsable (ej. EMP-0001). Vacío = queda en bodega.",
        False,
    ),
    ("ubicacion", "Ubicación", "Ubicación física (ej. Piso 3, oficina 302).", False),
    (
        "costo_adquisicion",
        "Costo de compra",
        "Solo el número, sin símbolo de moneda (ej. 1150.00).",
        False,
    ),
    (
        "especificaciones",
        "Especificaciones",
        "Pares clave=valor separados por ';' (ej. Procesador=i5; RAM=16 GB).",
        False,
    ),
    ("observaciones", "Observaciones", "Texto libre.", False),
]


def sembrar(apps, schema_editor):
    Columna = apps.get_model("activos", "ColumnaPlantillaActivos")
    if Columna.objects.exists():
        return
    for orden, (clave, etiqueta, ayuda, obligatoria) in enumerate(COLUMNAS, start=1):
        Columna.objects.create(
            clave=clave,
            etiqueta=etiqueta,
            ayuda=ayuda,
            obligatoria=obligatoria,
            activa=True,
            orden=orden * 10,
        )


def revertir(apps, schema_editor):
    # Al revertir se borra la configuración completa: la tabla solo existe para
    # esto, así que no queda nada del usuario que preservar.
    apps.get_model("activos", "ColumnaPlantillaActivos").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("activos", "0002_columnaplantillaactivos"),
    ]

    operations = [
        migrations.RunPython(sembrar, revertir),
    ]
