"""El tema claro vuelve al azul institucional (06/11/2026).

`0004` llevó lo editable al carbón de la marca. Decisión del usuario: en
claro, el azul con el blanco y el amarillo de la marca como acento; el negro
queda para el tema oscuro (`frontend/src/styles/marca.css`). Las fuentes
siguen en Poppins.

Como `0003` y `0004`: solo cambia los campos que siguen en el valor que dejó
`0004`; lo que un administrador personalizó se queda.
"""

from django.db import migrations, models

# Lo que dejó `0004`, copiado y no importado: el catálogo ya cambió.
DE_LA_0004 = {
    "color_primary": "#1E1E1E",
    "color_secondary": "#000000",
    "color_background": "#F4F4F4",
    "color_headings": "#000000",
    "color_text": "#1E1E1E",
    "color_links": "#6B5B00",
    "color_buttons": "#1E1E1E",
    "color_menu": "#1E1E1E",
}

AZUL = {
    "color_primary": "#1C5DA3",
    "color_secondary": "#164B86",
    "color_background": "#F2F4F8",
    "color_headings": "#0F2138",
    "color_text": "#0F2138",
    "color_links": "#1C5DA3",
    "color_buttons": "#0D6EFD",
    "color_menu": "#0A1E38",
}


def _mover(apps, desde, hacia):
    SiteTheme = apps.get_model("branding", "SiteTheme")
    for tema in SiteTheme.objects.all():
        cambiados = []
        for campo, anterior in desde.items():
            if str(getattr(tema, campo)).lower() == str(anterior).lower():
                setattr(tema, campo, hacia[campo])
                cambiados.append(campo)
        if cambiados:
            tema.save(update_fields=cambiados)


def volver_al_azul(apps, schema_editor):
    _mover(apps, DE_LA_0004, AZUL)


def volver_al_carbon(apps, schema_editor):
    _mover(apps, AZUL, DE_LA_0004)


class Migration(migrations.Migration):

    dependencies = [
        ('branding', '0004_marca_laarcourier'),
    ]

    operations = [
        migrations.RunPython(volver_al_azul, volver_al_carbon),
        migrations.AlterField(
            model_name='sitetheme',
            name='color_background',
            field=models.CharField(default='#F2F4F8', max_length=7),
        ),
        migrations.AlterField(
            model_name='sitetheme',
            name='color_buttons',
            field=models.CharField(default='#0D6EFD', max_length=7),
        ),
        migrations.AlterField(
            model_name='sitetheme',
            name='color_headings',
            field=models.CharField(default='#0F2138', max_length=7),
        ),
        migrations.AlterField(
            model_name='sitetheme',
            name='color_links',
            field=models.CharField(default='#1C5DA3', max_length=7),
        ),
        migrations.AlterField(
            model_name='sitetheme',
            name='color_menu',
            field=models.CharField(default='#0A1E38', max_length=7),
        ),
        migrations.AlterField(
            model_name='sitetheme',
            name='color_primary',
            field=models.CharField(default='#1C5DA3', max_length=7),
        ),
        migrations.AlterField(
            model_name='sitetheme',
            name='color_secondary',
            field=models.CharField(default='#164B86', max_length=7),
        ),
        migrations.AlterField(
            model_name='sitetheme',
            name='color_text',
            field=models.CharField(default='#0F2138', max_length=7),
        ),
    ]
