"""La División UPS sale del área Comercial (28/10/2026).

La 0040 la había dejado dentro de Comercial; el área Comercial es solo lo de
su imagen (`comercial_2026`). Ahora la división es su propia unidad bajo la
Gerencia General (`ups_2026`), con su Coordinador reportando al Gerente
General, y Comercial se vuelve a levantar sin ella. Repetirlo no cambia
nada."""

from django.db import migrations

MOTIVO = (
    "La División UPS se separa del área Comercial como unidad propia bajo la "
    "Gerencia General; el área Comercial queda como su organigrama: jefes "
    "comerciales de Quito, Guayaquil y Cuenca, e Internacional UPS y "
    "Televentas con reporte directo a la Gerencia."
)


def aplicar(apps, schema_editor):
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa
    from apps.organizacion import comercial_2026, ups_2026, versiones

    for empresa in Empresa.objects.order_by("id"):
        with usando_empresa(empresa), versiones.sin_peticion(MOTIVO):
            # Primero la división se lleva sus cargos: si no, Comercial los
            # desactivaría por no estar en su organigrama.
            ups_2026.cambiar()
            comercial_2026.cambiar()


class Migration(migrations.Migration):
    dependencies = [("organizacion", "0040_organigrama_comercial_2026")]

    operations = [migrations.RunPython(aplicar, migrations.RunPython.noop)]
