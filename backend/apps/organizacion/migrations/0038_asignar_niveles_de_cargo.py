"""Asigna a cada cargo su nivel jerárquico (27/10/2026, ver
`apps.organizacion.niveles_cargo`) y corrige lo que no encajaba:

- El nivel sale del nombre: Gerente General › Gerente… (Gerencia de Área) ›
  Jefe… (Jefatura) › Coordinador… (Coordinación) › Asistente… (Asistente de
  área); el resto, también los Supervisores de Laarbox, es Operativo de área.
- El Jefe de Nómina reportaba al Coordinador Nacional de GGHH (una Jefatura
  debajo de una Coordinación): pasa a reportar al Jefe Nacional de Talento
  Humano y SSO.

Queda en la bitácora del organigrama, con su respaldo."""

from django.db import migrations

MOTIVO = (
    "Niveles jerárquicos por cargo: Gerencia General, Gerencia de Área, "
    "Jefatura, Coordinación, Operativo de área y Asistente de área. El Jefe de "
    "Nómina pasa a reportar al Jefe Nacional de Talento Humano y SSO."
)


def aplicar(apps, schema_editor):
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa
    from apps.organizacion import niveles_cargo, versiones
    from apps.organizacion.models import Cargo

    for empresa in Empresa.objects.order_by("id"):
        with usando_empresa(empresa), versiones.sin_peticion(MOTIVO):
            for cargo in Cargo.objects.all():
                nivel = niveles_cargo.sugerido(cargo.nombre)
                if cargo.nivel != nivel:
                    Cargo.objects.filter(pk=cargo.pk).update(nivel=nivel)
            nomina = Cargo.objects.filter(
                nombre__iexact="Jefe de Nómina", jefe__nombre__iexact="Coordinador Nacional de GGHH"
            ).first()
            jefe = (
                Cargo.objects.filter(
                    nombre__iexact="Jefe Nacional de Talento Humano y SSO",
                    unidad_id=nomina.unidad_id,
                ).first()
                if nomina
                else None
            )
            if nomina and jefe:
                Cargo.objects.filter(pk=nomina.pk).update(jefe=jefe)


class Migration(migrations.Migration):

    dependencies = [("organizacion", "0037_nivel_del_cargo")]

    operations = [migrations.RunPython(aplicar, migrations.RunPython.noop)]
