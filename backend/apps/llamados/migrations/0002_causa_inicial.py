"""Cada empresa nace con la causa «Incumplimiento de la firma o aceptación del
rol de pagos» (US-013, CA-2, 12/11/2026), con un plazo de reincidencia de 12
meses y tres niveles:

1. «Primer llamado (verbal)»: no envía correo, pero el hecho queda registrado.
   Lleva igual un texto inicial por si Gestión Humana decide enviarlo.
2. «Segundo llamado (escrito)»: envía el correo con su texto inicial.
3. «Sanción económica»: envía el correo y pide el monto (sin monto sugerido:
   lo fija Gestión Humana, que valida los topes legales).

Las variables van con llave simple (`{nombre}`), como las inserta la pantalla;
el servidor acepta también `{{nombre}}` (ver `services.normalizar`). Los
textos se copian aquí, y no se importan de la app, para que la migración
no cambie si la app cambia. Todo se edita después desde la pantalla. Solo crea
lo que falta: si la empresa ya tiene una causa con ese nombre, no la toca.
"""

from django.db import migrations

CAUSA = "Incumplimiento de la firma o aceptación del rol de pagos"
DESCRIPCION = (
    "La persona no firmó o no aceptó su rol de pagos mensual dentro del plazo establecido por "
    "Gestión Humana."
)

FIRMA = "Atentamente,\n{emitido_por}\nGestión Humana · {empresa}"

NIVELES = [
    {
        "nombre": "Primer llamado (verbal)",
        "tipo": "verbal",
        "envia_correo": False,
        "asunto": "Registro de llamado de atención verbal: {causa}",
        "cuerpo": (
            "Estimado(a) {nombre_completo}:\n\n"
            "Le informamos que se registró un llamado de atención verbal por la siguiente "
            "causa: {causa}.\n\n"
            "Fecha del hecho: {fecha_hecho}\n"
            "Detalle: {descripcion}\n\n"
            "Le solicitamos tomar las medidas necesarias para que esta situación no se "
            "repita.\n\n" + FIRMA
        ),
    },
    {
        "nombre": "Segundo llamado (escrito)",
        "tipo": "escrito",
        "envia_correo": True,
        "asunto": "Llamado de atención por escrito: {causa}",
        "cuerpo": (
            "Estimado(a) {nombre_completo}:\n\n"
            "Por medio del presente, Gestión Humana de {empresa} le notifica un llamado de "
            "atención por escrito por la siguiente causa: {causa}.\n\n"
            "Fecha del hecho: {fecha_hecho}\n"
            "Detalle: {descripcion}\n\n"
            "Se trata de una reincidencia dentro del período establecido. Le solicitamos "
            "corregir esta situación a la brevedad; de repetirse, podría aplicarse una sanción "
            "económica conforme al Reglamento Interno de Trabajo.\n\n"
            "Si tiene alguna observación, puede comunicarse con Gestión Humana.\n\n" + FIRMA
        ),
    },
    {
        "nombre": "Sanción económica",
        "tipo": "sancion_economica",
        "envia_correo": True,
        "asunto": "Notificación de sanción económica: {causa}",
        "cuerpo": (
            "Estimado(a) {nombre_completo}:\n\n"
            "Por medio del presente, Gestión Humana de {empresa} le notifica la aplicación "
            "de una sanción económica por reincidencia en la siguiente causa: {causa}.\n\n"
            "Fecha del hecho: {fecha_hecho}\n"
            "Detalle: {descripcion}\n"
            "{{#monto}}Monto de la sanción: USD {monto}{{/monto}}\n\n"
            "Esta medida se aplica conforme al Reglamento Interno de Trabajo, luego de los "
            "llamados de atención registrados previamente por la misma causa.\n\n"
            "Si tiene alguna observación, puede comunicarse con Gestión Humana.\n\n" + FIRMA
        ),
    },
]


def crear(apps, schema_editor):
    Empresa = apps.get_model("empresas", "Empresa")
    CausaLlamado = apps.get_model("llamados", "CausaLlamado")
    NivelLlamado = apps.get_model("llamados", "NivelLlamado")
    for empresa in Empresa.objects.all():
        causa, creada = CausaLlamado.objects.get_or_create(
            empresa=empresa,
            nombre=CAUSA,
            defaults={"descripcion": DESCRIPCION, "meses_reincidencia": 12, "activa": True},
        )
        if not creada:
            continue
        for orden, nivel in enumerate(NIVELES, start=1):
            NivelLlamado.objects.create(
                empresa=empresa,
                causa=causa,
                orden=orden,
                nombre=nivel["nombre"],
                tipo=nivel["tipo"],
                envia_correo=nivel["envia_correo"],
                asunto=nivel["asunto"],
                cuerpo=nivel["cuerpo"],
                monto_sugerido=None,
                copia_jefe=False,
                activo=True,
            )


class Migration(migrations.Migration):
    dependencies = [
        ("llamados", "0001_initial"),
        ("empresas", "0006_estado_modulo"),
    ]

    operations = [migrations.RunPython(crear, migrations.RunPython.noop)]
