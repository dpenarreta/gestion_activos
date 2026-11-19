from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("activos", "0022_acta_entrega")]

    operations = [
        migrations.AddField(
            model_name="actaentrega",
            name="items_sin_codigo",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
