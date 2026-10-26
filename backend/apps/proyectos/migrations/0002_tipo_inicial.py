"""Cada empresa nace con un tipo «Solicitud de proyecto» (26/10/2026), con
los tres pasos pedidos —Aprobación, Autorización y Revisión— y un formulario
inicial. Queda **inactivo**: quien administra los tipos carga la plantilla,
elige quién decide cada paso y lo activa. Solo crea lo que falta."""

from django.db import migrations

PASOS = ["Aprobación", "Autorización", "Revisión"]
CAMPOS = [
    ("Objetivo del proyecto", "parrafo", [], True, "Qué se quiere lograr."),
    ("Área que lo solicita", "texto", [], True, ""),
    ("Prioridad", "lista", ["Alta", "Media", "Baja"], True, ""),
    ("Beneficio esperado", "parrafo", [], False, ""),
    ("Presupuesto estimado (USD)", "numero", [], False, ""),
    ("Fecha deseada de inicio", "fecha", [], False, ""),
]


def crear(apps, schema_editor):
    Empresa = apps.get_model("empresas", "Empresa")
    TipoProyecto = apps.get_model("proyectos", "TipoProyecto")
    PasoProyecto = apps.get_model("proyectos", "PasoProyecto")
    AprobadorPasoProyecto = apps.get_model("proyectos", "AprobadorPasoProyecto")
    CampoProyecto = apps.get_model("proyectos", "CampoProyecto")
    for empresa in Empresa.objects.all():
        tipo, creado = TipoProyecto.objects.get_or_create(
            empresa=empresa,
            nombre="Solicitud de proyecto",
            defaults={
                "descripcion": (
                    "Descargue la plantilla, llénela y cárguela con los datos del "
                    "proyecto. Pasa por aprobación, autorización y revisión antes de "
                    "iniciarse."
                ),
                "activo": False,
            },
        )
        if not creado:
            continue
        for orden, nombre in enumerate(PASOS, start=1):
            paso = PasoProyecto.objects.create(
                empresa=empresa, tipo_proyecto=tipo, orden=orden, nombre=nombre
            )
            AprobadorPasoProyecto.objects.create(
                empresa=empresa, paso=paso, tipo="jefe_inmediato"
            )
        for orden, (etiqueta, tipo_campo, opciones, obligatorio, ayuda) in enumerate(
            CAMPOS, start=1
        ):
            CampoProyecto.objects.create(
                empresa=empresa,
                tipo_proyecto=tipo,
                etiqueta=etiqueta,
                tipo=tipo_campo,
                opciones=opciones,
                obligatorio=obligatorio,
                ayuda=ayuda,
                orden=orden,
            )


class Migration(migrations.Migration):
    dependencies = [
        ("proyectos", "0001_initial"),
        ("empresas", "0006_estado_modulo"),
    ]

    operations = [migrations.RunPython(crear, migrations.RunPython.noop)]
