"""Siembra las tres categorías de partida y coloca los tipos que ya existen.

Dos decisiones, y las dos se pueden deshacer desde la pantalla:

1. **Se siembran categorías en vez de dejar la lista vacía.** Hardware,
   software y mobiliario cubren lo que casi cualquier empresa inventaría, y
   una lista vacía obliga a inventárselas antes de poder dar de alta el primer
   tipo. Son una plantilla, no una imposición: se renombran, se desactivan y se
   añaden otras.

2. **Lo que ya está registrado se coloca en Hardware.** El parque existente es
   equipamiento informático —laptops, impresoras, servidores—, así que dejar
   todos los tipos sin categoría obligaría a repasarlos uno a uno para empezar
   a usar el filtro. Un tipo mal colocado se corrige en su ficha; cien tipos
   sin colocar no se corrigen nunca.

La categoría se siembra **por empresa**: el catálogo cuelga de la empresa, como
los tipos, las sedes y el resto de catálogos.
"""

from django.db import migrations

INICIALES = [
    (
        "Hardware",
        "Equipos físicos: computadores, impresoras, servidores, redes.",
        "pc-display",
    ),
    (
        "Software",
        "Licencias y suscripciones: ofimática, antivirus, herramientas.",
        "window-stack",
    ),
    (
        "Mobiliario e inmuebles",
        "Escritorios, sillas, estanterías y espacios.",
        "building",
    ),
]


def sembrar(apps, schema_editor):
    Empresa = apps.get_model("empresas", "Empresa")
    CategoriaActivo = apps.get_model("activos", "CategoriaActivo")
    TipoDispositivo = apps.get_model("activos", "TipoDispositivo")

    for empresa in Empresa.objects.all():
        categorias = {}
        for nombre, descripcion, icono in INICIALES:
            categoria, _ = CategoriaActivo.objects.get_or_create(
                empresa=empresa,
                nombre=nombre,
                defaults={"descripcion": descripcion, "icono": icono},
            )
            categorias[nombre] = categoria

        TipoDispositivo.objects.filter(empresa=empresa, categoria__isnull=True).update(
            categoria=categorias["Hardware"]
        )


def soltar(apps, schema_editor):
    """Deshace solo lo que esta migración hizo.

    Se sueltan los tipos y se borran las tres categorías sembradas; las que
    alguien haya creado después se quedan, porque no son cosa de esta
    migración y borrarlas sería perder trabajo ajeno.
    """
    CategoriaActivo = apps.get_model("activos", "CategoriaActivo")
    TipoDispositivo = apps.get_model("activos", "TipoDispositivo")

    sembradas = CategoriaActivo.objects.filter(nombre__in=[n for n, _, _ in INICIALES])
    TipoDispositivo.objects.filter(categoria__in=sembradas).update(categoria=None)
    sembradas.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("activos", "0020_categorias_de_activo"),
        ("empresas", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(sembrar, soltar),
    ]
