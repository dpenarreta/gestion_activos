"""Siembra las áreas y entidades de control de la sección 5.

Son los valores de las empresas originales (Ecuador). Idempotente: no toca un
código que ya exista, para no pisar un nombre corregido a mano.
"""

from django.db import migrations

AREAS = [
    ("CONT", "Contabilidad y Tributario"),
    ("TH", "Talento Humano y Nómina"),
    ("SST", "Seguridad y Salud en el Trabajo"),
    ("AMB", "Ambiental"),
    ("LEG", "Legal y Permisos"),
    ("SEG", "Seguros y Pólizas"),
    ("INF", "Arriendos e Infraestructura"),
    ("RSE", "Responsabilidad Social"),
]

ENTIDADES = [
    ("SRI", "Servicio de Rentas Internas (SRI)"),
    ("IESS", "Instituto Ecuatoriano de Seguridad Social (IESS)"),
    ("MDT", "Ministerio del Trabajo"),
    ("BOMB", "Cuerpo de Bomberos"),
    ("GAD", "GAD Municipal"),
    ("ASEG", "Aseguradora (contrato de póliza)"),
    ("ARR", "Arrendador (contrato de arriendo)"),
    ("MINAM", "Ministerio del Ambiente, Agua y Transición Ecológica"),
]


def sembrar(apps, schema_editor):
    for modelo, filas in (("Area", AREAS), ("EntidadControl", ENTIDADES)):
        Modelo = apps.get_model("matriz", modelo)
        for codigo, nombre in filas:
            Modelo.objects.get_or_create(codigo=codigo, defaults={"nombre": nombre})


class Migration(migrations.Migration):
    dependencies = [("matriz", "0001_catalogos")]

    operations = [migrations.RunPython(sembrar, migrations.RunPython.noop)]
