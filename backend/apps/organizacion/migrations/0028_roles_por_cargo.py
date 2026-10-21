"""Los roles salen de los cargos, no de los niveles (21/10/2026).

1. Cada cargo recibe su rol: el nombre del cargo; si otro cargo se llama igual,
   con su unidad; si en la misma unidad hay otro igual, también con su jefe; y
   si aun así se repite, con la empresa. Nace con los
   permisos de todo empleado y con los que tenía el rol del nivel de su
   unidad (para no quitarle a nadie lo que ya tenía).
2. Quien ocupa un cargo recibe su rol en la membresía de esa empresa.
3. Los roles de nivel («LaarCourier · Área») se borran.

La lógica se copia aquí a propósito: una migración no debe depender del código
de la app, que puede cambiar (ver `apps/organizacion/roles_de_cargo.py`).
"""

import django.db.models.deletion
from django.db import migrations, models

PERMISOS_BASE = ("licencias.solicitar", "roles_pago.consultar", "sugerencias.reportar")
LARGO = 150


def _nombre(Group, Cargo, cargo):
    nombre = cargo.nombre.strip()
    iguales = Cargo.objects.filter(nombre__iexact=nombre).exclude(pk=cargo.pk)
    unidad = cargo.unidad.nombre if cargo.unidad_id else ""
    jefe = cargo.jefe.nombre if cargo.jefe_id else ""
    empresa = cargo.empresa.nombre if cargo.empresa_id else ""
    en_su_unidad = iguales.filter(unidad_id=cargo.unidad_id, empresa_id=cargo.empresa_id)
    partes, candidatos = [nombre], []
    if not iguales.exists():
        candidatos.append(nombre)
    if unidad:
        partes.append(unidad)
        if not en_su_unidad.exists():
            candidatos.append(" · ".join(partes))
    if jefe:
        partes.append(jefe)
        candidatos.append(" · ".join(partes))
    candidatos.append(" · ".join(partes + ([empresa] if empresa else [])))
    for candidato in candidatos:
        if not Group.objects.filter(name__iexact=candidato[:LARGO]).exists():
            return candidato[:LARGO]
    base, n = candidatos[-1][: LARGO - 5], 2
    while Group.objects.filter(name__iexact=f"{base} ({n})").exists():
        n += 1
    return f"{base} ({n})"


def a_cargos(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    Cargo = apps.get_model("organizacion", "Cargo")
    NivelJerarquico = apps.get_model("organizacion", "NivelJerarquico")
    DatosDeContacto = apps.get_model("organizacion", "DatosDeContacto")
    MembresiaEmpresa = apps.get_model("empresas", "MembresiaEmpresa")

    base = list(
        Permission.objects.filter(content_type__app_label="permissions", codename__in=PERMISOS_BASE)
    )
    de_nivel = {n.pk: n.rol_id for n in NivelJerarquico.objects.exclude(rol=None)}

    for cargo in Cargo.objects.select_related("unidad", "empresa", "jefe").order_by("pk"):
        if cargo.rol_id:
            continue
        rol = Group.objects.create(name=_nombre(Group, Cargo, cargo))
        rol.permissions.add(*base)
        rol_nivel = de_nivel.get(cargo.unidad.nivel_id) if cargo.unidad_id else None
        if rol_nivel:
            rol.permissions.add(*Group.objects.get(pk=rol_nivel).permissions.all())
        Cargo.objects.filter(pk=cargo.pk).update(rol=rol)

    roles = dict(Cargo.objects.exclude(rol=None).values_list("pk", "rol_id"))
    for perfil in DatosDeContacto.objects.exclude(cargo=None):
        rol_id = roles.get(perfil.cargo_id)
        membresia = MembresiaEmpresa.objects.filter(
            usuario_id=perfil.usuario_id, empresa_id=perfil.empresa_id
        ).first()
        if rol_id and membresia:
            membresia.roles.add(rol_id)

    Group.objects.filter(pk__in=list(de_nivel.values())).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
        ("organizacion", "0027_correo_personal"),
        ("empresas", "0006_estado_modulo"),
        ("roles", "0030_soporte_ti_para_todos"),
    ]

    operations = [
        migrations.AddField(
            model_name="cargo",
            name="rol",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="cargo_organigrama",
                to="auth.group",
            ),
        ),
        migrations.RunPython(a_cargos, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="niveljerarquico",
            name="rol",
        ),
    ]
