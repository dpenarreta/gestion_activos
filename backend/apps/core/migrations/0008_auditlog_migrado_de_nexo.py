"""Marca de origen para la auditoría traída de Nexo (`importar_nexo_auditoria`).

Dos columnas que no tocan los eventos existentes: `id_en_nexo` es nula (agregarla
no reescribe la tabla) y `actor_en_nexo` nace vacía. El índice único filtrado a
los no nulos es lo que impide importar dos veces el mismo evento de Nexo.
"""

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0007_respaldo_diario_a_las_17"),
        ("empresas", "0006_estado_modulo"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="auditlog",
            name="actor_en_nexo",
            field=models.CharField(blank=True, default="", editable=False, max_length=150),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="id_en_nexo",
            field=models.PositiveBigIntegerField(blank=True, editable=False, null=True),
        ),
        migrations.AddConstraint(
            model_name="auditlog",
            constraint=models.UniqueConstraint(
                condition=models.Q(("id_en_nexo__isnull", False)),
                fields=("id_en_nexo",),
                name="auditlog_id_en_nexo_unico",
            ),
        ),
    ]
