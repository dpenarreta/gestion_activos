"""El departamento «Innovación y Transformación Digital» pasa a llamarse «TI»
(27/10/2026). Como al renombrarlo en Estructura: cambia también su
departamento y los roles de sus cargos que llevan el nombre del área (los
«Asistente de Sistemas · …»), y queda en la bitácora del organigrama. Los
cargos conservan su nombre."""

from django.db import migrations

from apps.core.migraciones import si_el_esquema_esta_al_dia

ANTES = "Innovación y Transformación Digital"
AHORA = "TI"
MOTIVO = "Se renombra el departamento «Innovación y Transformación Digital» a «TI»."


def aplicar(apps, schema_editor):
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa
    from apps.organizacion import departamentos_del_organigrama, roles_de_cargo, versiones
    from apps.organizacion.models import UnidadOrganizacional

    for empresa in Empresa.objects.order_by("id"):
        with usando_empresa(empresa):
            unidad = UnidadOrganizacional.objects.filter(nombre__iexact=ANTES).first()
            if unidad is None:
                continue
            with versiones.sin_peticion(MOTIVO):
                unidad.nombre = AHORA
                unidad.save(update_fields=["nombre", "updated_at"])
                departamentos_del_organigrama.sincronizar(unidad)
                for cargo in unidad.cargos.select_related("rol", "unidad", "empresa", "jefe"):
                    roles_de_cargo.asegurar_rol(cargo, con_homonimos=False)


class Migration(migrations.Migration):
    dependencies = [("organizacion", "0034_crear_areas_que_faltan")]

    operations = [
        migrations.RunPython(si_el_esquema_esta_al_dia(aplicar), migrations.RunPython.noop)
    ]
