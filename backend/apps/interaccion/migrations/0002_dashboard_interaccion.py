"""El dashboard «Interacción de la plataforma» (18/11/2026).

Decisión del usuario: por ahora solo lo ve él, como dueño, con «Ver» y
«Editar». Por eso nace sin roles lectores ni editores: con la regla de
Dashboards (12/11/2026) un dashboard sin roles solo lo abren su dueño y el
superusuario. Más adelante se le dan roles desde «Mis dashboards».

El dueño es la cuenta `dpenarreta`; si no existe (otra base), el primer
superusuario. Va en la empresa predeterminada del dueño.
"""

from django.conf import settings
from django.db import migrations

DASHBOARD_ID = "interaccion-plataforma"


def crear(apps, schema_editor):
    Dashboard = apps.get_model("cartera", "Dashboard")
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    Membresia = apps.get_model("empresas", "MembresiaEmpresa")
    if Dashboard.objects.filter(dashboard_id=DASHBOARD_ID).exists():
        return
    dueno = (
        User.objects.filter(username="dpenarreta").first()
        or User.objects.filter(is_superuser=True).order_by("id").first()
    )
    membresia = (
        Membresia.objects.filter(usuario=dueno).order_by("-es_predeterminada", "id").first()
        if dueno
        else None
    )
    Dashboard.objects.create(
        dashboard_id=DASHBOARD_ID,
        name="Interacción de la plataforma",
        area="Tecnología",
        description=(
            "Conexiones por día, tiempo de actividad, mensajes, usuarios recurrentes, "
            "quién no ha ingresado y las funcionalidades más usadas."
        ),
        contexto="Indicadores de uso de la intranet calculados por el sistema.",
        estructura_bloqueada=True,
        created_by=dueno,
        owner=dueno,
        empresa=membresia.empresa if membresia else None,
    )


def quitar(apps, schema_editor):
    apps.get_model("cartera", "Dashboard").objects.filter(dashboard_id=DASHBOARD_ID).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("interaccion", "0001_initial"),
        ("cartera", "0001_initial"),
        ("empresas", "0006_estado_modulo"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [migrations.RunPython(crear, quitar)]
