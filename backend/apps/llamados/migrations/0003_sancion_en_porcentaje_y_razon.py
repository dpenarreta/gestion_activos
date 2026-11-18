"""US-033 (18/11/2026): sanción en porcentaje del sueldo o monto fijo, razón
del reglamento (documento institucional + artículo) y el tope por empresa.

Los llamados existentes quedan como monto fijo y sin documento (CA-9); los que
no son sanción económica quedan sin forma de sanción, como los nuevos."""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def sin_forma_fuera_de_las_sanciones(apps, schema_editor):
    Llamado = apps.get_model("llamados", "LlamadoAtencion")
    Llamado.objects.exclude(nivel_tipo="sancion_economica").update(forma_sancion="")


class Migration(migrations.Migration):

    dependencies = [
        ("empresas", "0006_estado_modulo"),
        ("llamados", "0002_causa_inicial"),
        ("organizacion", "0051_perfil_confirmado"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="llamadoatencion",
            name="articulo",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="llamadoatencion",
            name="documento",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="llamados_de_atencion",
                to="organizacion.documentoinstitucional",
            ),
        ),
        migrations.AddField(
            model_name="llamadoatencion",
            name="documento_titulo",
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name="llamadoatencion",
            name="forma_sancion",
            field=models.CharField(
                blank=True,
                choices=[
                    ("monto", "Monto fijo (USD)"),
                    ("porcentaje", "Porcentaje del sueldo (%)"),
                ],
                default="monto",
                max_length=12,
            ),
        ),
        migrations.AddField(
            model_name="llamadoatencion",
            name="porcentaje",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True),
        ),
        migrations.AddField(
            model_name="nivelllamado",
            name="porcentaje_sugerido",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True),
        ),
        migrations.CreateModel(
            name="ConfiguracionLlamados",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "tope_porcentaje",
                    models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True),
                ),
                (
                    "actualizado_por",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "empresa",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="%(app_label)s_%(class)s",
                        to="empresas.empresa",
                    ),
                ),
            ],
            options={
                "verbose_name": "configuración de llamados de atención",
                "verbose_name_plural": "configuraciones de llamados de atención",
                "constraints": [
                    models.UniqueConstraint(
                        fields=("empresa",), name="una_configuracion_llamados_por_empresa"
                    )
                ],
            },
        ),
        migrations.RunPython(sin_forma_fuera_de_las_sanciones, migrations.RunPython.noop),
    ]
