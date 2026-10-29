"""El mensaje del aviso del rol de pagos dice las fechas del plazo, calculadas
con el calendario: desde el primer día hábil del mes hasta el último de los
días hábiles permitidos (pedido de la administración, 29/10/2026). Se
actualiza el texto guardado solo donde sigue siendo el de 0008: si una empresa
ya lo personalizó, se respeta."""

from django.db import migrations, models

ANTERIOR = (
    "Su rol de pagos de {mes} de {anio} ya está disponible para que lo revise. "
    "Tiene {dias} días hábiles, contados desde el primer día hábil del mes, para "
    "aceptarlo y confirmar que está correcto; así evita multas o sanciones. "
    "Ábralo y verifique los valores; si encuentra algo que no está bien, deje "
    "una observación."
)
NUEVO = (
    "Su rol de pagos de {mes} de {anio} ya está disponible para que lo revise. "
    "Tiene plazo hasta el {fecha_limite} para aceptarlo y confirmar que está "
    "correcto ({dias} días hábiles desde el {primer_dia}); así evita multas o "
    "sanciones. Ábralo y verifique los valores; si encuentra algo que no está "
    "bien, deje una observación."
)


def con_fechas(apps, schema_editor):
    Configuracion = apps.get_model("nomina", "ConfiguracionRolPagos")
    Configuracion._base_manager.filter(aviso_mensaje=ANTERIOR).update(aviso_mensaje=NUEVO)


def sin_fechas(apps, schema_editor):
    Configuracion = apps.get_model("nomina", "ConfiguracionRolPagos")
    Configuracion._base_manager.filter(aviso_mensaje=NUEVO).update(aviso_mensaje=ANTERIOR)


class Migration(migrations.Migration):
    dependencies = [
        ("nomina", "0008_aviso_mensaje_con_plazo"),
    ]

    operations = [
        migrations.AlterField(
            model_name="configuracionrolpagos",
            name="aviso_mensaje",
            field=models.TextField(default=NUEVO),
        ),
        migrations.RunPython(con_fechas, sin_fechas),
    ]
