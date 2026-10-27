"""Levanta los organigramas que pasaron las áreas el 27/10/2026: «Gestión de
Talento Humano LCE 2026» (`apps.organizacion.talento_humano_2026`), LaarBox
(`laarbox_2026`) y Procesos y Proyectos (`procesos_2026`), en cada empresa que
tenga esas unidades.
Los dos quedan como un solo cambio en la bitácora del organigrama."""

from django.db import migrations

MOTIVO = (
    "Organigramas enviados por las áreas el 27/10/2026: «Gestión de Talento "
    "Humano LCE 2026» (el Gerente General es jefe del Gerente Gestión Humana) "
    "LaarBox y Procesos y Proyectos (la gerencia la lleva el Gerente General). Cargos con sus nombres nuevos, sus jefes y las personas de cada "
    "uno; se desactivan los que ya no están y nadie ocupa."
)


def aplicar(apps, schema_editor):
    # Usa los modelos reales: renombrar un cargo también renombra su rol y le
    # ajusta los permisos, y el cambio queda en la bitácora del organigrama.
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa
    from apps.organizacion import laarbox_2026, procesos_2026, talento_humano_2026, versiones

    for empresa in Empresa.objects.order_by("id"):
        with usando_empresa(empresa), versiones.sin_peticion(MOTIVO):
            talento_humano_2026.cambiar()
            laarbox_2026.cambiar()
            procesos_2026.cambiar()


class Migration(migrations.Migration):

    dependencies = [
        ("organizacion", "0032_versiones_organigrama"),
        ("roles", "0039_permiso_descargas_a_admins"),
    ]

    operations = [migrations.RunPython(aplicar, migrations.RunPython.noop)]
