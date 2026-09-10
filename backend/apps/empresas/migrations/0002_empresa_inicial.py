"""Crea la primera empresa y le asigna todo lo que ya estaba registrado.

Lo que había hasta ahora es de una sola empresa: no hay forma de repartirlo y
tampoco haría falta, porque la separación empieza hoy. Se le pone el nombre del
sistema —el que está configurado en la identidad institucional— para que quien
entre después del cambio reconozca lo suyo en el selector en vez de encontrar
una «Empresa 1» que no le dice nada.

Todas las cuentas quedan con acceso a esa empresa. Cualquier otra separación
sería inventada: hasta ahora todo el mundo veía todo, y quitarle el acceso a
alguien es una decisión que la toma un administrador, no una migración.
"""

from django.db import migrations

NOMBRE_DE_RESERVA = "Empresa principal"
CODIGO_DE_RESERVA = "EMP"


def crear_empresa_inicial(apps, schema_editor):
    Empresa = apps.get_model("empresas", "Empresa")
    Membresia = apps.get_model("empresas", "MembresiaEmpresa")
    Usuario = apps.get_model("users", "User")
    SiteTheme = apps.get_model("branding", "SiteTheme")

    tema = SiteTheme.objects.first()
    nombre = (getattr(tema, "site_name", "") or "").strip() or NOMBRE_DE_RESERVA
    empresa = Empresa.objects.create(nombre=nombre[:120], codigo=CODIGO_DE_RESERVA)

    for usuario in Usuario.objects.all():
        Membresia.objects.create(usuario=usuario, empresa=empresa, es_predeterminada=True)

    # Todo lo registrado pasa a ser suyo. Se recorre modelo por modelo y no con
    # una consulta genérica para que la lista se lea: si mañana hay un modelo
    # nuevo por empresa, esta migración no lo cubre y hay que escribir la suya.
    for etiqueta, modelo in (
        ("activos", "TipoDispositivo"),
        ("activos", "Activo"),
        ("activos", "ColumnaPlantillaActivos"),
        ("organizacion", "Departamento"),
        ("organizacion", "Sede"),
        ("organizacion", "Proveedor"),
        ("organizacion", "Empleado"),
        ("mantenimientos", "CatalogoComponente"),
        ("politicas", "PoliticaObsolescencia"),
        ("alertas", "ConfiguracionAlertas"),
    ):
        apps.get_model(etiqueta, modelo).objects.update(empresa=empresa)


def deshacer(apps, schema_editor):
    """Suelta los registros y borra la empresa: el `PROTECT` no deja al revés."""
    for etiqueta, modelo in (
        ("activos", "TipoDispositivo"),
        ("activos", "Activo"),
        ("activos", "ColumnaPlantillaActivos"),
        ("organizacion", "Departamento"),
        ("organizacion", "Sede"),
        ("organizacion", "Proveedor"),
        ("organizacion", "Empleado"),
        ("mantenimientos", "CatalogoComponente"),
        ("politicas", "PoliticaObsolescencia"),
        ("alertas", "ConfiguracionAlertas"),
    ):
        apps.get_model(etiqueta, modelo).objects.update(empresa=None)
    apps.get_model("empresas", "MembresiaEmpresa").objects.all().delete()
    apps.get_model("empresas", "Empresa").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("empresas", "0001_initial"),
        ("activos", "0012_multiempresa"),
        ("organizacion", "0007_multiempresa"),
        ("mantenimientos", "0004_multiempresa"),
        ("politicas", "0003_multiempresa"),
        ("alertas", "0003_multiempresa"),
        ("branding", "0001_initial"),
        ("users", "0001_initial"),
    ]

    operations = [migrations.RunPython(crear_empresa_inicial, deshacer)]
