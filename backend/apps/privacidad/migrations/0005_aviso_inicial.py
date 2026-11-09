"""Siembra el aviso de privacidad inicial en cada empresa que ya existe
(consentimiento del tratamiento de datos, 09/11/2026).

Desde aquí, quien entra a la intranet acepta este aviso una vez (versión 1).
Nombra como responsable a la empresa, con su nombre; el contacto es Gestión
Humana y la conservación, la de la relación laboral y la que exija la ley.
Es el de Nexo adaptado: sin nombres de sistemas ni de servidores, y dice que
algunas funciones usan un proveedor externo de IA (Google, Gemini:
decisión del usuario del 09/11/2026) y que a él solo se envían seudónimos, nunca nombres ni datos de
salud. Si el proveedor cambia, se edita el aviso y se pide aceptarlo de nuevo. Quien tiene
`privacidad.atender` lo edita en Protección de datos → Consentimiento.

El texto va copiado aquí y no importado de `consentimiento.py`: una migración
no debe cambiar si mañana cambia el texto que se propone.

Una empresa creada después no tiene aviso hasta que alguien lo guarde: sin
aviso no se exige nada (ver `consentimiento.py`). Al revertir se borran los
avisos sembrados que nadie editó y que nadie aceptó.
"""

from django.db import migrations
from django.utils import timezone

PLANTILLA_INICIAL = """{responsable} es la responsable del tratamiento de sus datos personales. Los recopila y trata en la intranet con el fin de gestionar el trabajo, los recursos humanos y los servicios internos. Son estos:

- Datos de identificación y contacto: nombres, usuario, correo electrónico y, si usted lo autoriza, su teléfono.
- Datos de actividad laboral: cargo, área, tareas, horas trabajadas, actividades de seguimiento e indicadores de desempeño.
- Datos de asistencia y permisos: vacaciones, permisos personales y permisos médicos.
- Datos de condición laboral especial: maternidad o lactancia, cuando afectan la jornada laboral.
- Registros de uso: inicios de sesión y acciones en el sistema, para la seguridad y la auditoría.

Los datos de salud (permisos médicos, maternidad y lactancia) son datos sensibles: solo los trata el personal autorizado de Gestión Humana, con la finalidad de calcular correctamente la carga laboral y los indicadores, conforme a la Ley Orgánica de Protección de Datos Personales del Ecuador.

Sus datos no se comparten con terceros con fines comerciales. Algunas funciones de la intranet usan un proveedor externo de inteligencia artificial para generar análisis y respuestas; el proveedor es Google (Gemini). A ese proveedor solo se envían seudónimos (códigos que no permiten saber de quién se trata), nunca su nombre ni sus datos de salud. Si el proveedor cambia, este aviso se actualizará y se le pedirá aceptarlo de nuevo.

Sus datos se conservan el tiempo que dure la relación laboral y los plazos que exija la ley. Para cualquier consulta sobre el tratamiento de sus datos, el contacto es Gestión Humana.

Puede ejercer sus derechos de acceso, corrección y eliminación de sus datos desde «Mi perfil» › «Mis derechos», después de entrar, o consultando a Gestión Humana."""


def texto_inicial(nombre_empresa: str = "") -> str:
    """El aviso inicial con la empresa como responsable: con su nombre si se
    sabe; si no, «la empresa para la que usted trabaja»."""
    nombre_empresa = (nombre_empresa or "").strip()
    responsable = (
        f"La empresa {nombre_empresa}, para la que usted trabaja,"
        if nombre_empresa
        else "La empresa para la que usted trabaja"
    )
    return PLANTILLA_INICIAL.replace("{responsable}", responsable)


def sembrar(apps, schema_editor):
    Empresa = apps.get_model("empresas", "Empresa")
    Aviso = apps.get_model("privacidad", "AvisoPrivacidad")
    ahora = timezone.now()
    con_aviso = set(Aviso.objects.values_list("empresa_id", flat=True))
    for empresa in Empresa.objects.exclude(pk__in=con_aviso):
        Aviso.objects.create(
            empresa=empresa, texto=texto_inicial(empresa.nombre), version=1, version_desde=ahora
        )


def quitar(apps, schema_editor):
    Aviso = apps.get_model("privacidad", "AvisoPrivacidad")
    Aceptacion = apps.get_model("privacidad", "AceptacionAviso")
    con_aceptaciones = set(Aceptacion.objects.values_list("empresa_id", flat=True))
    sembrados = Aviso.objects.filter(version=1, editado_por__isnull=True).exclude(
        empresa_id__in=con_aceptaciones
    )
    for aviso in sembrados.select_related("empresa"):
        if aviso.texto == texto_inicial(aviso.empresa.nombre):
            aviso.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("empresas", "0006_estado_modulo"),
        ("privacidad", "0004_consentimiento"),
    ]

    operations = [migrations.RunPython(sembrar, quitar)]
