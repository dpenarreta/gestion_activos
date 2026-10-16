"""Los correos que envía el sistema, con su diseño por defecto y sus variables.

Cada entrada dice cuándo sale el correo y a quién, qué variables puede usar su
plantilla (con un ejemplo, que es lo que alimenta la vista previa) y su diseño
por defecto, que es el que se usa mientras nadie lo personalice desde
Configuración → Notificaciones → Plantillas de correo.

Las variables **comunes** las agrega el servicio a todos los correos; las
**propias** las prepara quien envía cada uno (`servicio.renderizar`).
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Variable:
    nombre: str
    descripcion: str
    ejemplo: str
    #: Un bloque HTML que arma el sistema (una tabla): se inserta sin escapar.
    html: bool = False


@dataclass(frozen=True)
class Plantilla:
    clave: str
    nombre: str
    modulo: str
    #: Cuándo sale y a quién le llega.
    descripcion: str
    asunto: str
    html: str
    variables: tuple[Variable, ...] = field(default_factory=tuple)
    #: Por qué le llega a quien lo recibe: el valor de `{{razon}}`.
    razon: str = ""

    def todas_las_variables(self) -> tuple[Variable, ...]:
        return (
            COMUNES
            + (Variable("razon", "Por qué le llega este correo", self.razon),)
            + self.variables
        )


COMUNES = (
    Variable("sistema", "Nombre del sistema", "Gestión de Activos"),
    Variable("empresa", "Empresa activa (vacía en los correos del sistema)", "LaarCourier"),
    Variable(
        "asunto", "El asunto de este correo, ya completo", "Equipo en mantenimiento: ACT-000123"
    ),
    Variable("modulo", "Módulo del que proviene el correo", "Gestión de Activos · Mantenimientos"),
    Variable("fecha", "Fecha de envío (dd/mm/aaaa)", "16/10/2026"),
    Variable("enlace_sistema", "Dirección del sistema", "https://activos.empresa.com"),
)


# --- El diseño por defecto ------------------------------------------------------------
# Estilos en línea y una tabla como estructura: los clientes de correo
# corporativos descartan las hojas de estilo y buena parte de flexbox. Es el
# mismo diseño que tenían los avisos antes de poder editarse.

_GRIS = "color: #6c757d;"


def _fila(etiqueta: str, valor: str, *, condicion: str = "", destacar=False, mono=False) -> str:
    estilo = "padding: 6px 0;" + (" font-family: monospace;" if mono else "")
    contenido = f"<strong>{valor}</strong>" if destacar else valor
    fila = (
        f'<tr><td style="padding: 6px 0; {_GRIS} width: 40%;">{etiqueta}</td>'
        f'<td style="{estilo}">{contenido}</td></tr>'
    )
    return f"{{{{#{condicion}}}}}{fila}{{{{/{condicion}}}}}" if condicion else fila


def _aviso(
    *, encabezado: str, filas: list[str], cuerpo: str = "", boton: str = "", saludo: str = ""
) -> str:
    boton_html = (
        f'<p style="margin: 24px 0 0;"><a href="{{{{enlace}}}}" style="display: inline-block; '
        f"padding: 10px 18px; background-color: #0d6efd; color: #ffffff; text-decoration: none; "
        f'border-radius: 6px; font-size: 14px;">{boton}</a></p>'
        if boton
        else ""
    )
    cuerpo_html = f'<p style="margin: 20px 0 0; font-size: 14px;">{cuerpo}</p>' if cuerpo else ""
    saludo_html = f'<p style="margin: 0 0 16px; font-size: 14px;">{saludo}</p>' if saludo else ""
    return (
        "<!DOCTYPE html>\n"
        '<html lang="es">\n<head><meta charset="utf-8" /><title>{{asunto}}</title></head>\n'
        '<body style="margin: 0; padding: 24px; background-color: #f5f6f8; '
        'font-family: Arial, Helvetica, sans-serif; color: #212529;">\n'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; '
        'border: 1px solid #dee2e6;">\n<tr><td style="padding: 24px;">\n'
        f'<h1 style="margin: 0 0 4px; font-size: 18px;">{encabezado}</h1>\n'
        f'<p style="margin: 0 0 20px; font-size: 13px; {_GRIS}">{{{{sistema}}}}'
        "{{#empresa}} · {{empresa}}{{/empresa}}</p>\n"
        f"{saludo_html}\n"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="font-size: 14px; border-collapse: collapse;">\n' + "\n".join(filas) + "\n</table>\n"
        f"{cuerpo_html}\n{boton_html}\n"
        f'<p style="margin: 20px 0 0; font-size: 12px; {_GRIS}">{{{{razon}}}}</p>\n'
        "</td></tr>\n</table>\n</body>\n</html>\n"
    )


_EQUIPO = [
    _fila("Equipo", "{{equipo}}", destacar=True),
    _fila("Código", "{{codigo}}", mono=True),
    _fila("Serie", "{{serie}}", mono=True),
]

_VARIABLES_EQUIPO = (
    Variable("equipo", "Nombre del equipo", "Laptop Dell Latitude 5440"),
    Variable("codigo", "Código de barras del equipo", "ACT-000123"),
    Variable("serie", "Número de serie", "5CD1234XYZ"),
    Variable(
        "enlace", "Enlace a la ficha del equipo", "https://activos.empresa.com/admin/activos/123"
    ),
)

_MATRIZ_VARIABLES = (
    Variable("nombre", "Nombre de quien recibe el aviso", "Ana Torres"),
    Variable("codigo", "Código del período", "IVA-2026-10"),
    Variable("obligacion", "Nombre de la obligación", "Declaración de IVA"),
    Variable("periodo", "Período", "Octubre 2026"),
    Variable("entidad", "Entidad de control", "SRI"),
    Variable("responsable", "Responsable del período", "Ana Torres"),
    Variable("vencimiento", "Vencimiento, como se lee en la Matriz", "28/10/2026 (en 12 días)"),
    Variable("estado", "Estado actual del período", "Pendiente"),
    Variable(
        "enlace",
        "Enlace al período (pide iniciar sesión)",
        "https://activos.empresa.com/admin/matriz/obligaciones?periodo=8",
    ),
)

_MATRIZ_FILAS = [
    _fila("Obligación", "{{obligacion}}", destacar=True),
    _fila("Período", "{{periodo}}"),
    _fila("Empresa", "{{empresa}}"),
    _fila("Entidad de control", "{{entidad}}"),
    _fila("Responsable", "{{responsable}}"),
    _fila("Vencimiento", "{{vencimiento}}"),
    _fila("Estado actual", "{{estado}}"),
]

_MATRIZ_RAZON = (
    "Este aviso lo envía la Matriz de obligaciones según la configuración de recordatorios "
    "de la empresa, y deja de enviarse cuando el cierre se valida. El enlace pide iniciar sesión."
)

_ACCESO_HTML = (
    "<!DOCTYPE html>\n"
    '<html lang="es">\n<head><meta charset="utf-8" /><title>{{asunto}}</title></head>\n'
    '<body style="font-family: Arial, Helvetica, sans-serif; color: #212529;">\n'
    "{CUERPO}\n"
    '<p style="font-size: 12px; color: #6c757d;">{{razon}}</p>\n'
    "</body>\n</html>\n"
)

PLANTILLAS = (
    # --- Acceso al sistema ----------------------------------------------------------
    Plantilla(
        clave="acceso.recuperar_contrasena",
        nombre="Recuperar la contraseña",
        modulo="Acceso al sistema",
        descripcion="Cuando alguien pide «¿Olvidó su contraseña?». Llega al correo de la cuenta.",
        asunto="Recuperación de contraseña — {{sistema}}",
        html=_ACCESO_HTML.replace(
            "{CUERPO}",
            "<p>Hola {{nombre}},</p>\n"
            "<p>Recibimos una solicitud para restablecer tu contraseña en {{sistema}}.</p>\n"
            '<p><a href="{{enlace}}">Restablecer mi contraseña</a></p>\n'
            "<p>Este enlace es de un solo uso y vence en {{minutos}} minutos.</p>\n"
            "<p>Si no solicitaste este cambio, podés ignorar este correo: tu contraseña actual "
            "sigue siendo válida.</p>",
        ),
        variables=(
            Variable("nombre", "Nombre de la persona", "Ana"),
            Variable("usuario", "Nombre de usuario", "atorres"),
            Variable("correo", "Correo de la cuenta", "ana.torres@empresa.com"),
            Variable(
                "enlace",
                "Enlace para restablecer (un solo uso)",
                "https://activos.empresa.com/reset-password?token=…",
            ),
            Variable("minutos", "Minutos de validez del enlace", "30"),
        ),
        razon="Le llega porque alguien pidió restablecer la contraseña de su cuenta.",
    ),
    Plantilla(
        clave="acceso.contrasena_cambiada",
        nombre="Contraseña actualizada",
        modulo="Acceso al sistema",
        descripcion="Cuando la contraseña de una cuenta cambia. Llega al correo de la cuenta.",
        asunto="Tu contraseña fue actualizada — {{sistema}}",
        html=_ACCESO_HTML.replace(
            "{CUERPO}",
            "<p>Hola {{nombre}},</p>\n"
            "<p>Tu contraseña en {{sistema}} fue actualizada correctamente.</p>\n"
            "<p>Si no fuiste vos quien hizo este cambio, contactá a un administrador de inmediato.</p>",
        ),
        variables=(
            Variable("nombre", "Nombre de la persona", "Ana"),
            Variable("usuario", "Nombre de usuario", "atorres"),
            Variable("correo", "Correo de la cuenta", "ana.torres@empresa.com"),
        ),
        razon="Le llega porque la contraseña de su cuenta cambió.",
    ),
    # --- Gestión de Activos ---------------------------------------------------------
    Plantilla(
        clave="alertas.resumen",
        nombre="Resumen de alertas del parque",
        modulo="Gestión de Activos · Alertas",
        descripcion=(
            "Cada día o cada semana, según Configuración → Notificaciones → Alertas del "
            "inventario. Llega en copia oculta a los destinatarios configurados."
        ),
        asunto="{{prefijo}}{{#total_alertas}}{{total_alertas}} alerta(s) del parque{{/total_alertas}}"
        "{{^total_alertas}}Sin alertas pendientes{{/total_alertas}} — {{firma}}",
        html=(
            "<!DOCTYPE html>\n"
            '<html lang="es">\n<head><meta charset="utf-8" /><title>{{asunto}}</title></head>\n'
            '<body style="margin: 0; padding: 24px; background-color: #f5f6f8; '
            'font-family: Arial, Helvetica, sans-serif; color: #212529;">\n'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            'style="max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; '
            'border: 1px solid #dee2e6;">\n<tr><td style="padding: 24px;">\n'
            '{{#es_prueba}}<p style="margin: 0 0 16px; padding: 8px 12px; background-color: #fff3cd; '
            'border: 1px solid #ffe69c; border-radius: 4px; font-size: 13px;">Correo de prueba. Se '
            "envió solo a quien lo solicitó, con las alertas reales de hoy.</p>{{/es_prueba}}\n"
            '<h1 style="margin: 0 0 4px; font-size: 18px;">Alertas del parque</h1>\n'
            '<p style="margin: 0 0 20px; font-size: 13px; color: #6c757d;">{{sistema}}'
            "{{#empresa}} · {{empresa}}{{/empresa}}</p>\n"
            '{{#total_alertas}}<p style="margin: 0 0 16px; font-size: 14px;">{{total_alertas}} '
            "alerta(s) con {{total_elementos}} situación(es) por atender.</p>\n"
            "{{detalle_alertas}}{{/total_alertas}}\n"
            '{{^total_alertas}}<p style="margin: 0 0 16px; font-size: 14px;">Ninguna alerta activa '
            "tiene equipos pendientes. El parque se revisó y no hay nada que atender.</p>{{/total_alertas}}\n"
            '<p style="margin: 24px 0 0;"><a href="{{enlace}}" style="display: inline-block; '
            "padding: 10px 16px; background-color: #0d6efd; color: #ffffff; border-radius: 4px; "
            'font-size: 14px; text-decoration: none;">Abrir el centro de alertas</a></p>\n'
            '<p style="margin: 20px 0 0; font-size: 12px; color: #6c757d;">{{razon}}</p>\n'
            "</td></tr>\n</table>\n</body>\n</html>\n"
        ),
        variables=(
            Variable("total_alertas", "Cuántas alertas tienen algo pendiente", "3"),
            Variable("total_elementos", "Cuántas situaciones suman entre todas", "14"),
            Variable(
                "detalle_alertas",
                "Tabla con cada alerta, su cantidad y el enlace a su listado",
                '<table role="presentation" width="100%"><tr><td style="padding: 12px 0; '
                'border-top: 1px solid #e9ecef;"><strong>Activos sin asignar</strong> — 5</td></tr>'
                "</table>",
                html=True,
            ),
            Variable("es_prueba", "«sí» si es un envío de prueba (vacía si no)", ""),
            Variable("prefijo", "«[PRUEBA] » en los envíos de prueba", ""),
            Variable(
                "firma",
                "Empresa y sistema, para distinguir los resúmenes",
                "LaarCourier · Gestión de Activos",
            ),
            Variable(
                "enlace", "Enlace al centro de alertas", "https://activos.empresa.com/admin/alertas"
            ),
        ),
        razon=(
            "Este correo resume cuántos equipos necesitan atención; el detalle está en el sistema, "
            "que pedirá iniciar sesión. Si ya no querés recibirlo, pedí que te quiten de los "
            "destinatarios en la configuración de alertas."
        ),
    ),
    Plantilla(
        clave="activos.llego_lo_solicitado",
        nombre="Llegó el equipo solicitado",
        modulo="Gestión de Activos · Inventario",
        descripcion="Al registrar un equipo que alguien había pedido. Llega a quien lo pidió.",
        asunto="Llegó el equipo que pidió: {{equipo}}",
        html=_aviso(
            encabezado="Llegó el equipo que pidió",
            filas=_EQUIPO
            + [
                _fila("Tipo", "{{tipo}}"),
                _fila("Área", "{{area}}"),
                _fila("Condición", "{{condicion}}", condicion="condicion"),
            ],
            cuerpo=(
                "Ya está registrado en el inventario con su código de barras. Todavía no está "
                "entregado a nadie: cuando se lo asignen, recibirá su acta."
            ),
            boton="Ver la ficha del equipo",
        ),
        variables=_VARIABLES_EQUIPO
        + (
            Variable("tipo", "Tipo de equipo", "Laptop"),
            Variable("area", "Área o departamento", "Tecnología"),
            Variable("condicion", "Condición del equipo, si se registró", "Nuevo"),
        ),
        razon=(
            "Este aviso se envía al ocurrir el hecho, no en un resumen. Le llega porque usted "
            "pidió este equipo."
        ),
    ),
    Plantilla(
        clave="mantenimientos.entrada",
        nombre="Equipo entró a mantenimiento",
        modulo="Gestión de Activos · Mantenimientos",
        descripcion="Al registrar que un equipo entra a reparación. Llega a quienes responden por él.",
        asunto="Equipo en mantenimiento: {{codigo}}",
        html=_aviso(
            encabezado="Su equipo entró a mantenimiento",
            filas=_EQUIPO
            + [
                _fila("Ingresó", "{{fecha_ingreso}}"),
                _fila("Tipo", "{{tipo_mantenimiento}}"),
                _fila("Atiende", "{{atiende}}"),
                _fila("Causa", "{{causa}}", condicion="causa"),
            ],
            cuerpo=(
                "Le avisaremos cuando vuelva. Mientras tanto el equipo figura fuera de operación, "
                "así que no cuenta en los indicadores del parque."
            ),
            boton="Ver la ficha del equipo",
        ),
        variables=_VARIABLES_EQUIPO
        + (
            Variable("fecha_ingreso", "Fecha en que ingresó", "16/10/2026"),
            Variable("tipo_mantenimiento", "Preventivo o correctivo", "Correctivo"),
            Variable("atiende", "Quién lo atiende", "Soporte TI"),
            Variable("causa", "Causa registrada, si la hay", "No enciende"),
            Variable("responsables", "Quiénes responden por el equipo", "Ana Torres"),
        ),
        razon=(
            "Este aviso se envía al ocurrir el hecho, no en un resumen. Llega a quien responde "
            "por el equipo; si usted no es esa persona, avise a Sistemas para corregir la ficha."
        ),
    ),
    Plantilla(
        clave="mantenimientos.salida",
        nombre="Equipo salió de mantenimiento",
        modulo="Gestión de Activos · Mantenimientos",
        descripcion="Al registrar que un equipo vuelve de reparación. Llega a quienes responden por él.",
        asunto="Equipo de vuelta: {{codigo}}",
        html=_aviso(
            encabezado="Su equipo salió de mantenimiento",
            filas=_EQUIPO
            + [
                _fila("Salió", "{{fecha_salida}}"),
                _fila("Estuvo fuera", "{{dias_fuera}} día(s)"),
                _fila("Resultado", "{{resultado}}", destacar=True),
                _fila("Solución", "{{solucion}}", condicion="solucion"),
            ],
            cuerpo=(
                "Si al recibirlo nota que el problema sigue, dígalo antes de firmar la entrega: "
                "reabrir la misma avería cuenta distinto que registrar una nueva."
            ),
            boton="Ver la ficha del equipo",
        ),
        variables=_VARIABLES_EQUIPO
        + (
            Variable("fecha_salida", "Fecha en que salió", "18/10/2026"),
            Variable("dias_fuera", "Días fuera de operación", "2"),
            Variable("resultado", "Cómo quedó", "Reparado"),
            Variable("solucion", "Qué se hizo, si se registró", "Cambio de fuente de poder"),
            Variable("responsables", "Quiénes responden por el equipo", "Ana Torres"),
        ),
        razon=(
            "Este aviso se envía al ocurrir el hecho, no en un resumen. Llega a quien responde "
            "por el equipo; si usted no es esa persona, avise a Sistemas para corregir la ficha."
        ),
    ),
    Plantilla(
        clave="solicitudes.recibida",
        nombre="Nueva solicitud de compra",
        modulo="Gestión de Activos · Solicitudes",
        descripcion="Al registrar una solicitud de compra. Llega al encargado elegido.",
        asunto="Nueva solicitud #{{numero}}: {{que_se_pide}}",
        html=_aviso(
            encabezado="Le asignaron una solicitud de compra",
            filas=[
                _fila("Solicitud", "#{{numero}}", destacar=True),
                _fila("Qué se pide", "{{que_se_pide}}", destacar=True),
                _fila("Cantidad", "{{cantidad}}"),
                _fila("Prioridad", "{{prioridad}}"),
                _fila("Se necesita para", "{{fecha_necesaria}}", condicion="fecha_necesaria"),
                _fila("Justificación", "{{justificacion}}"),
                _fila("Pedida por", "{{solicitante}}"),
            ],
            boton="Ver la solicitud",
        ),
        variables=(
            Variable("numero", "Número de la solicitud", "42"),
            Variable("que_se_pide", "Qué se pide", "Laptop — con 32 GB para diseño"),
            Variable("cantidad", "Cantidad", "1"),
            Variable("prioridad", "Prioridad", "Alta"),
            Variable("fecha_necesaria", "Para cuándo se necesita, si hay fecha", "01/11/2026"),
            Variable(
                "justificacion", "Para qué hace falta", "Entra un analista el 1 de noviembre."
            ),
            Variable("solicitante", "Quién la pidió", "Esteban Paredes"),
            Variable("nombre", "Nombre de quien la recibe (el encargado)", "Marco Villacís"),
            Variable("correo", "Correo de quien la recibe", "marco.villacis@empresa.com"),
            Variable(
                "enlace",
                "Enlace a la solicitud",
                "https://activos.empresa.com/admin/solicitudes/42",
            ),
        ),
        razon=(
            "Le llega porque quien la registró lo eligió como encargado de la compra. Aparece en "
            "«Solicitudes recibidas» hasta que se entregue o se rechace."
        ),
    ),
    Plantilla(
        clave="solicitudes.actualizada",
        nombre="Solicitud cambió de estado",
        modulo="Gestión de Activos · Solicitudes",
        descripcion="Cuando una solicitud avanza, se rechaza o se entrega. Llega a quien la pidió.",
        asunto="Solicitud #{{numero}}: {{estado_minusculas}}",
        html=_aviso(
            encabezado="Su solicitud está {{estado_minusculas}}",
            filas=[
                _fila("Solicitud", "#{{numero}}", destacar=True),
                _fila("Qué se pidió", "{{que_se_pide}}", destacar=True),
                _fila("Estado", "{{estado}}"),
                _fila("Motivo", "{{motivo}}", condicion="motivo"),
            ],
            boton="Ver la solicitud",
        ),
        variables=(
            Variable("numero", "Número de la solicitud", "42"),
            Variable("que_se_pide", "Qué se pidió", "Laptop — con 32 GB para diseño"),
            Variable("estado", "Estado nuevo", "Comprada"),
            Variable("estado_minusculas", "Estado nuevo, en minúsculas", "comprada"),
            Variable("motivo", "Motivo o nota del cambio, si la hay", "Llega el viernes."),
            Variable("nombre", "Nombre de quien la pidió", "Esteban Paredes"),
            Variable("correo", "Correo de quien la pidió", "esteban.paredes@empresa.com"),
            Variable(
                "enlace",
                "Enlace a la solicitud",
                "https://activos.empresa.com/admin/solicitudes/42",
            ),
        ),
        razon=(
            "Le llega porque usted registró esta solicitud. El recorrido completo, con quién dio "
            "cada paso, queda en la propia solicitud."
        ),
    ),
    # --- Matriz de obligaciones -----------------------------------------------------
    Plantilla(
        clave="matriz.recordatorio",
        nombre="Recordatorio de vencimiento",
        modulo="Matriz de obligaciones",
        descripcion=(
            "Los días antes del vencimiento que configure la empresa, y al reenviar un "
            "recordatorio a mano. Llega al responsable y al suplente."
        ),
        asunto="Recordatorio de vencimiento — {{obligacion}} ({{periodo}})",
        html=_aviso(
            encabezado="Recordatorio de vencimiento",
            saludo="Estimado(a) {{nombre}}: le recordamos el vencimiento del período <strong>{{codigo}}</strong>.",
            filas=_MATRIZ_FILAS,
            boton="Consultar el detalle y cargar la evidencia",
        ),
        variables=_MATRIZ_VARIABLES,
        razon=_MATRIZ_RAZON,
    ),
    Plantilla(
        clave="matriz.vencimiento",
        nombre="Hoy vence una obligación",
        modulo="Matriz de obligaciones",
        descripcion="El día del vencimiento. Llega al responsable y al suplente.",
        asunto="Hoy vence — {{obligacion}} ({{periodo}})",
        html=_aviso(
            encabezado="Hoy vence una obligación",
            saludo="Estimado(a) {{nombre}}: hoy vence el período <strong>{{codigo}}</strong>.",
            filas=_MATRIZ_FILAS,
            boton="Consultar el detalle y cargar la evidencia",
        ),
        variables=_MATRIZ_VARIABLES,
        razon=_MATRIZ_RAZON,
    ),
    Plantilla(
        clave="matriz.escalamiento",
        nombre="Escalamiento: obligación vencida",
        modulo="Matriz de obligaciones",
        descripcion=(
            "Cuando un período sigue sin cierre validado después de vencer. Llega al supervisor "
            "o, si no hay, al aprobador."
        ),
        asunto="Escalamiento: obligación vencida — {{obligacion}} ({{periodo}})",
        html=_aviso(
            encabezado="Obligación vencida sin cierre",
            saludo=(
                "Estimado(a) {{nombre}}: el período <strong>{{codigo}}</strong> está vencido, con "
                "<strong>{{dias_atraso}} día(s) de atraso</strong>, y aún no tiene el cierre validado."
            ),
            filas=_MATRIZ_FILAS,
            boton="Consultar el detalle y cargar la evidencia",
        ),
        variables=_MATRIZ_VARIABLES + (Variable("dias_atraso", "Días de atraso", "3"),),
        razon=_MATRIZ_RAZON,
    ),
)

# --- Mesa de ayuda -----------------------------------------------------------------------

_SOPORTE_VARIABLES = (
    Variable("numero", "Número del ticket", "TCK-2026-000042"),
    Variable("nombre", "Nombre de quien pidió", "Carla Ordóñez"),
    Variable("correo", "Correo de quien pidió", "carla.ordonez@empresa.com"),
    Variable("telefono", "Teléfono de contacto", "099 418 2273"),
    Variable("agencia", "Agencia o sede de quien pidió", "Loja · Agencia"),
    Variable("area", "Área a la que pertenece", "Cobranzas"),
    Variable("categoria", "Categoría del ticket", "Hardware"),
    Variable("caso", "Caso de ayuda elegido", "El equipo no enciende"),
    Variable("prioridad", "Prioridad (la fija el caso)", "Alta"),
    Variable("estado", "Estado del ticket", "En cola"),
    Variable(
        "datos_adicionales",
        "Tabla con lo respondido en los campos propios del formulario (vacía si no hay)",
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        '<td style="padding: 4px 12px 4px 0; color: #6c757d; font-size: 13px;">Serie del equipo'
        '</td><td style="padding: 4px 0; font-size: 13px;">PF3K9ZL</td></tr></table>',
        html=True,
    ),
)

_SOPORTE_FILAS = [
    _fila("Ticket", "{{numero}}", destacar=True),
    _fila("Categoría", "{{categoria}}"),
    _fila("Caso", "{{caso}}"),
    _fila("Prioridad", "{{prioridad}}"),
]

_SOPORTE_RAZON = (
    "Le llega porque creó este ticket en la mesa de ayuda. Para responder use el enlace: "
    "las respuestas a este correo no se leen."
)

PLANTILLAS_SOPORTE = (
    Plantilla(
        clave="soporte.ticket_creado",
        nombre="Ticket creado",
        modulo="Mesa de ayuda",
        descripcion="Al enviar el formulario de soporte. Llega a quien lo creó, con su enlace de seguimiento.",
        asunto="[{{numero}}] Recibimos su solicitud: {{caso}}",
        html=_aviso(
            encabezado="Recibimos su solicitud de soporte",
            saludo=(
                "Hola {{nombre}}: su ticket quedó registrado.{{#posicion}} Hay "
                "<strong>{{posicion}}</strong> ticket(s) en la cola incluyendo el suyo; lo "
                "atenderemos en orden de llegada.{{/posicion}}"
                "{{#fuera_de_horario}}<br /><br />Lo recibimos fuera del horario de atención: "
                "quedó en la cola y se atenderá a la brevedad el siguiente día hábil."
                "{{/fuera_de_horario}}"
            ),
            filas=_SOPORTE_FILAS,
            cuerpo="Con el enlace puede ver en qué posición está, leer las respuestas y contestar.",
            boton="Seguir mi ticket",
        ),
        variables=_SOPORTE_VARIABLES
        + (
            Variable("posicion", "Posición en la cola al crearse", "4"),
            Variable("fuera_de_horario", "«sí» si llegó fuera del horario de atención", ""),
            Variable(
                "enlace",
                "Enlace secreto de seguimiento",
                "https://activos.empresa.com/soporte/seguimiento/…",
            ),
        ),
        razon=_SOPORTE_RAZON,
    ),
    Plantilla(
        clave="soporte.ticket_respondido",
        nombre="Soporte respondió el ticket",
        modulo="Mesa de ayuda",
        descripcion=(
            "Cuando el equipo responde o pide información al usuario. Llega a quien creó el ticket."
        ),
        asunto="[{{numero}}] Respuesta de soporte",
        html=_aviso(
            encabezado="Tiene una respuesta de soporte",
            saludo="Hola {{nombre}}: {{#tecnico}}{{tecnico}}{{/tecnico}}{{^tecnico}}el equipo de soporte{{/tecnico}} respondió su ticket.",
            filas=_SOPORTE_FILAS + [_fila("Mensaje", "{{mensaje}}")],
            cuerpo="Para contestar, abra el ticket con el enlace.",
            boton="Ver y responder",
        ),
        variables=_SOPORTE_VARIABLES
        + (
            Variable(
                "mensaje",
                "Lo que escribió soporte",
                "¿Puede indicarnos el número de serie del equipo?",
            ),
            Variable("tecnico", "Quién atiende el ticket", "Jorge Andrade"),
            Variable(
                "enlace",
                "Enlace secreto de seguimiento",
                "https://activos.empresa.com/soporte/seguimiento/…",
            ),
        ),
        razon=_SOPORTE_RAZON,
    ),
    Plantilla(
        clave="soporte.ticket_atendido",
        nombre="Ticket atendido",
        modulo="Mesa de ayuda",
        descripcion="Cuando el técnico marca el ticket como atendido. Llega a quien lo creó.",
        asunto="[{{numero}}] Su ticket fue atendido",
        html=_aviso(
            encabezado="Su ticket fue atendido",
            saludo=(
                "Hola {{nombre}}: {{#tecnico}}{{tecnico}}{{/tecnico}}{{^tecnico}}el equipo de soporte{{/tecnico}} "
                "marcó su ticket como atendido. Si todo quedó bien, confírmelo con el enlace; si el "
                "problema sigue, respóndanos ahí mismo y el ticket se reabre."
            ),
            filas=_SOPORTE_FILAS,
            cuerpo="Si no recibimos respuesta en {{dias_cierre}} día(s), el ticket se cerrará solo.",
            boton="Confirmar o responder",
        ),
        variables=_SOPORTE_VARIABLES
        + (
            Variable("tecnico", "Quién lo atendió", "Jorge Andrade"),
            Variable("dias_cierre", "Días hasta el cierre automático", "3"),
            Variable(
                "enlace",
                "Enlace secreto de seguimiento",
                "https://activos.empresa.com/soporte/seguimiento/…",
            ),
        ),
        razon=_SOPORTE_RAZON,
    ),
    Plantilla(
        clave="soporte.sla_por_vencer",
        nombre="SLA por vencer",
        modulo="Mesa de ayuda",
        descripcion=(
            "Al llegar al 80 % del plazo de atención. Llega al técnico y a la línea de "
            "supervisión de su nivel."
        ),
        asunto="[{{numero}}] SLA por vencer ({{vence}})",
        html=_aviso(
            encabezado="Un ticket está por vencer su SLA",
            filas=_SOPORTE_FILAS
            + [
                _fila("Atiende", "{{tecnico}}"),
                _fila("Nivel", "{{nivel}}"),
                _fila("Vence", "{{vence}}", destacar=True),
                _fila("Solicitante", "{{nombre}} · {{agencia}}"),
            ],
            boton="Abrir el ticket",
        ),
        variables=_SOPORTE_VARIABLES
        + (
            Variable("tecnico", "Quién lo atiende", "Jorge Andrade"),
            Variable("nivel", "Nivel de soporte", "N1 · Mesa de ayuda"),
            Variable("vence", "Cuándo vence el plazo", "16/10/2026 15:30"),
            Variable(
                "enlace",
                "Enlace al ticket en el sistema",
                "https://activos.empresa.com/admin/soporte/tickets/42",
            ),
        ),
        razon="Le llega porque atiende este ticket o supervisa su nivel en la mesa de ayuda.",
    ),
    Plantilla(
        clave="soporte.sla_vencido",
        nombre="SLA vencido (escalamiento)",
        modulo="Mesa de ayuda",
        descripcion=(
            "Cuando vence el plazo sin que el ticket esté atendido. Llega al técnico y a la línea "
            "de supervisión, para que lo atiendan o lo reasignen."
        ),
        asunto="Escalamiento: [{{numero}}] SLA vencido",
        html=_aviso(
            encabezado="Un ticket venció su SLA",
            filas=_SOPORTE_FILAS
            + [
                _fila("Atiende", "{{tecnico}}"),
                _fila("Nivel", "{{nivel}}"),
                _fila("Venció", "{{vence}}", destacar=True),
                _fila("Solicitante", "{{nombre}} · {{agencia}}"),
            ],
            cuerpo="Se escala a la línea de supervisión para que se atienda o se reasigne.",
            boton="Abrir el ticket",
        ),
        variables=_SOPORTE_VARIABLES
        + (
            Variable("tecnico", "Quién lo atiende", "Jorge Andrade"),
            Variable("nivel", "Nivel de soporte", "N1 · Mesa de ayuda"),
            Variable("vence", "Cuándo venció el plazo", "16/10/2026 15:30"),
            Variable(
                "enlace",
                "Enlace al ticket en el sistema",
                "https://activos.empresa.com/admin/soporte/tickets/42",
            ),
        ),
        razon="Le llega porque atiende este ticket o supervisa su nivel en la mesa de ayuda.",
    ),
)

PLANTILLAS = PLANTILLAS + PLANTILLAS_SOPORTE

POR_CLAVE = {plantilla.clave: plantilla for plantilla in PLANTILLAS}


def obtener(clave: str) -> Plantilla | None:
    return POR_CLAVE.get(clave)
