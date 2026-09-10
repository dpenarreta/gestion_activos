"""Le pone empresa a los eventos ya registrados, deduciéndola de lo que describen.

Sin esto, todo el historial anterior al cambio queda sin empresa, y hay que
elegir entre dos males: ocultárselo a quien administra una compañía —el registro
de auditoría aparecería casi vacío justo después de actualizar— o mostrárselo
entero, que es la fuga que se quería cerrar.

Se resuelve mirando el objeto al que apunta cada evento: si todavía existe y
pertenece a una empresa, el evento es de esa empresa. Lo que queda sin resolver
es de dos clases, y las dos son legítimamente globales: lo que no pertenece a
ninguna empresa —iniciar sesión, cambiar el tema, administrar cuentas— y lo que
apunta a algo ya eliminado, donde no hay a quién preguntar.
"""

from django.db import migrations

#: `target_type` guarda el nombre de la clase en minúsculas.
MODELOS_POR_EMPRESA = {
    "activo": ("activos", "Activo"),
    "tipodispositivo": ("activos", "TipoDispositivo"),
    "departamento": ("organizacion", "Departamento"),
    "sede": ("organizacion", "Sede"),
    "proveedor": ("organizacion", "Proveedor"),
    "empleado": ("organizacion", "Empleado"),
    "catalogocomponente": ("mantenimientos", "CatalogoComponente"),
    "politicaobsolescencia": ("politicas", "PoliticaObsolescencia"),
}

#: Los que heredan la empresa de su activo, en vez de llevarla encima.
MODELOS_POR_ACTIVO = {
    "mantenimiento": ("mantenimientos", "Mantenimiento"),
    "adjunto": ("adjuntos", "Adjunto"),
}


def poblar_empresa(apps, schema_editor):
    AuditLog = apps.get_model("core", "AuditLog")

    for tipo, (etiqueta, modelo) in MODELOS_POR_EMPRESA.items():
        _asignar(AuditLog, apps.get_model(etiqueta, modelo), tipo, lambda fila: fila.empresa_id)

    for tipo, (etiqueta, modelo) in MODELOS_POR_ACTIVO.items():
        _asignar(
            AuditLog,
            apps.get_model(etiqueta, modelo).objects.select_related("activo"),
            tipo,
            lambda fila: fila.activo.empresa_id,
            es_consulta=True,
        )


def _asignar(AuditLog, origen, tipo, empresa_de, es_consulta=False):
    """Copia la empresa del objeto a los eventos que lo mencionan.

    Se agrupa por empresa y se actualiza en bloque: recorrer evento por evento
    sobre un historial de años sería una consulta por fila.
    """
    consulta = origen if es_consulta else origen.objects.all()
    por_empresa = {}
    for fila in consulta.iterator(chunk_size=500):
        empresa_id = empresa_de(fila)
        if empresa_id is not None:
            por_empresa.setdefault(empresa_id, []).append(str(fila.pk))

    for empresa_id, identificadores in por_empresa.items():
        for bloque in _en_bloques(identificadores, 400):
            AuditLog.objects.filter(
                target_type=tipo, target_id__in=bloque, empresa__isnull=True
            ).update(empresa_id=empresa_id)


def _en_bloques(valores, tamano):
    for inicio in range(0, len(valores), tamano):
        yield valores[inicio : inicio + tamano]


def deshacer(apps, schema_editor):
    apps.get_model("core", "AuditLog").objects.update(empresa=None)


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0003_auditlog_empresa"),
        ("activos", "0013_columna_unica_por_empresa"),
        ("organizacion", "0007_multiempresa"),
        ("mantenimientos", "0004_multiempresa"),
        ("politicas", "0003_multiempresa"),
        ("adjuntos", "0001_initial"),
    ]

    operations = [migrations.RunPython(poblar_empresa, deshacer)]
