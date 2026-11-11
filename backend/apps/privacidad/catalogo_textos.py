"""El catálogo cerrado de textos de protección de datos (US-004, 11/11/2026).

Cada entrada es un texto sobre datos personales que la intranet muestra. Lo
que es de cada empresa —el texto vigente, su versión, quién lo editó— vive en
`TextoProteccion`; aquí está lo que no cambia: la clave, dónde se muestra
(módulo y sección), su nombre, si pide aceptación y su texto inicial.

Las claves son estables: el frontend y los servicios las nombran, y las
aceptaciones (`AceptacionTexto`) cuelgan del texto de cada una. No se
renombran; si un texto deja de usarse, se quita de aquí en una historia que
diga qué pasa con sus aceptaciones.

Los textos iniciales son **exactamente** los que la intranet mostraba el
11/11/2026 (CA-8), sacados de donde vivían:

- `aviso_privacidad`: `consentimiento.texto_inicial`, con el nombre de la
  empresa (por eso es una función y no una constante).
- `autorizacion_telefono`: `organizacion/textos_legales.py`.
- `cumpleanos_publico` y `aniversario_publico`: `MiCumpleanos.jsx` y
  `MiAniversario.jsx`.
- `derechos_*`: `MisDerechos.jsx` (la explicación) y `privacidadComunes.js`
  (una por tipo de solicitud: son cuatro textos y no uno porque la pantalla
  pone cada explicación en la tarjeta de su tipo; uno solo obligaría a
  partirlo al mostrarlo).
- `rol_pagos_*`: `nomina/models.py`.
- `acuerdo_confidencialidad`: `organizacion/confidencialidad.py` (con título).
- `nova_*`: `NovaChatContext.jsx`, `ConversacionNova.jsx` y `PanelNova.jsx`.

**Variables.** `derechos_explicacion` lleva `{plazo}`, que la pantalla
reemplaza por los días del plazo vigente (`settings.PRIVACIDAD_PLAZO_DIAS`):
el número no es parte del texto, depende de la configuración. La lista de
variables de cada texto está en `variables`; el servicio que guarda debe
rechazar un texto que pierda una variable obligatoria.

`privacidad/0007` siembra estos textos con una copia propia: una migración no
debe cambiar si mañana cambia este archivo.
"""

from dataclasses import dataclass, field

# Módulos y secciones, tal cual se muestran (inventario de US-004 §2).
GENERAL = "General"
MI_PERFIL = "Mi perfil"
ROL_DE_PAGOS = "Institucional › Rol de pagos"
CODIGOS_DE_CONDUCTA = "Institucional › Códigos de conducta"
NOVA = "Nova (IA)"


@dataclass(frozen=True)
class EntradaCatalogo:
    clave: str
    modulo: str
    seccion: str
    nombre: str
    requiere_aceptacion: bool
    #: El texto inicial. Para `aviso_privacidad` se usa `inicial()`.
    texto: str
    #: Dónde se acepta o se muestra, para quien lo edita.
    descripcion: str
    titulo: str = ""
    #: Marcadores `{nombre}` que la pantalla reemplaza al mostrarlo.
    variables: tuple[str, ...] = field(default_factory=tuple)


# ── Textos fijos del frontend, copiados al pie de la letra (11/11/2026) ───────

CUMPLEANOS = "Acepto que mi día de cumpleaños sea información pública dentro de la empresa."
ANIVERSARIO = (
    "Acepto que mi aniversario en la empresa sea información pública dentro de la empresa."
)
DERECHOS_EXPLICACION = (
    "La Ley Orgánica de Protección de Datos Personales (LOPDP) le da derecho a saber qué "
    "datos suyos guarda la empresa, a pedir que los corrijan y a pedir que los borren cuando "
    "ya no hacen falta. Aquí puede hacerlo. La empresa debe responderle en un plazo de "
    "{plazo} días desde que envía su solicitud."
)
DERECHOS_ACCESO = (
    "Saber qué datos personales suyos guarda la empresa en la intranet y para qué los usa."
)
DERECHOS_RECTIFICACION = (
    "Corregir o completar un dato suyo que está mal, desactualizado o incompleto."
)
DERECHOS_ELIMINACION = "Pedir que se borren datos suyos que ya no hace falta guardar."
NOVA_LINEA = "Nova es una IA y puede equivocarse. No se envían nombres."
NOVA_GENERAL = (
    "Puede preguntar por políticas sobre licencias o permisos médicos, pero no escriba datos "
    "de salud suyos ni de otras personas."
)
NOVA_SIN_SALUD = "En este modo no se envían datos de salud."
NOVA_COMO_SE_PROTEGEN = (
    "Revise las respuestas antes de decidir. Las personas se envían con seudónimos "
    "(«Persona A»), nunca con su nombre, y antes de enviar se ocultan correos, cédulas y "
    "teléfonos. En el modo General puede preguntar por políticas de salud (licencias, "
    "permisos médicos, maternidad); en Mis tareas y Mi equipo los mensajes que mencionan "
    "salud no se envían. La conversación no se guarda: se pierde al cerrar sesión o recargar "
    "la página."
)
NOVA_PANEL_DESEMPENO = (
    "Nova explica en lenguaje natural los indicadores de este mes. A la IA no se envía el "
    "nombre de la persona ni datos de salud."
)

# ── Textos que ya eran editables: su redacción inicial ────────────────────────

TELEFONO = (
    "Autorizo a la empresa a guardar mi número de teléfono de contacto, sea personal o "
    "empresarial, y a que otras personas de la empresa lo usen para contactarme, conforme a "
    "la Ley Orgánica de Protección de Datos Personales. Puedo retirar esta autorización en "
    "cualquier momento."
)
ROL_PAGOS_TERMINOS = (
    "Declaro que soy el titular del rol de pagos que voy a consultar y que la información "
    "que contiene es personal y confidencial. Me comprometo a no compartirla con terceros. "
    "Entiendo que esta consulta queda registrada con su fecha, hora y dirección de red, y "
    "que, si acepto mi rol de pagos, el rol que acepté queda guardado como constancia."
)
ROL_PAGOS_CORREO = (
    "Autorizo a la empresa a guardar mi correo personal para enviarme mis roles de pagos "
    "cuando lo solicite, conforme a la Ley Orgánica de Protección de Datos Personales. Puedo "
    "retirarlo cuando quiera."
)
ACUERDO_TITULO = "Acuerdo de confidencialidad"
ACUERDO_TEXTO = (
    "Los códigos de conducta, reglamentos y demás documentos de esta sección son de uso "
    "interno de la empresa.\n\n"
    "Al aceptar, me comprometo a:\n"
    "• Usar su contenido solo para fines laborales.\n"
    "• No copiarlos, reenviarlos ni compartirlos fuera de la empresa sin autorización.\n"
    "• Cumplir las normas que contienen.\n\n"
    "La fecha de esta aceptación queda registrada."
)

# ── Las claves ────────────────────────────────────────────────────────────────

AVISO_PRIVACIDAD = "aviso_privacidad"
AUTORIZACION_TELEFONO = "autorizacion_telefono"
CUMPLEANOS_PUBLICO = "cumpleanos_publico"
ANIVERSARIO_PUBLICO = "aniversario_publico"
DERECHOS_EXPLICACION_CLAVE = "derechos_explicacion"
DERECHOS_ACCESO_CLAVE = "derechos_acceso"
DERECHOS_RECTIFICACION_CLAVE = "derechos_rectificacion"
DERECHOS_ELIMINACION_CLAVE = "derechos_eliminacion"
ROL_PAGOS_TERMINOS_CLAVE = "rol_pagos_terminos"
ROL_PAGOS_CORREO_CLAVE = "rol_pagos_correo"
ACUERDO_CONFIDENCIALIDAD = "acuerdo_confidencialidad"
NOVA_AVISO_IA = "nova_aviso_ia"
NOVA_AVISO_GENERAL = "nova_aviso_general"
NOVA_AVISO_TAREAS = "nova_aviso_tareas"
NOVA_AVISO_EQUIPO = "nova_aviso_equipo"
NOVA_COMO_SE_PROTEGEN_CLAVE = "nova_como_se_protegen"
NOVA_PANEL_DESEMPENO_CLAVE = "nova_panel_desempeno"

#: En el orden en que se listan (por módulo y, dentro, por sección).
CATALOGO: tuple[EntradaCatalogo, ...] = (
    EntradaCatalogo(
        clave=AVISO_PRIVACIDAD,
        modulo=GENERAL,
        seccion="Entrada a la intranet",
        nombre="Aviso de tratamiento de datos",
        requiere_aceptacion=True,
        texto="",  # Depende de la empresa: `inicial()`.
        descripcion=(
            "Lo acepta cada persona al entrar a la intranet. Solo se pide de nuevo si al "
            "guardar se marca «Pedir aceptarlo de nuevo»."
        ),
    ),
    EntradaCatalogo(
        clave=AUTORIZACION_TELEFONO,
        modulo=MI_PERFIL,
        seccion="Teléfono personal",
        nombre="Autorización del teléfono personal",
        requiere_aceptacion=True,
        texto=TELEFONO,
        descripcion=(
            "Lo acepta quien escribe su teléfono personal en «Mi perfil» o en «Complete su "
            "información». Sin aceptarlo no se guarda el número."
        ),
    ),
    EntradaCatalogo(
        clave=CUMPLEANOS_PUBLICO,
        modulo=MI_PERFIL,
        seccion="Cumpleaños",
        nombre="Cumpleaños público",
        requiere_aceptacion=True,
        texto=CUMPLEANOS,
        descripcion="Lo acepta quien muestra su cumpleaños en el calendario de Inicio.",
    ),
    EntradaCatalogo(
        clave=ANIVERSARIO_PUBLICO,
        modulo=MI_PERFIL,
        seccion="Aniversario",
        nombre="Aniversario público",
        requiere_aceptacion=True,
        texto=ANIVERSARIO,
        descripcion="Lo acepta quien muestra su aniversario en la empresa en el calendario.",
    ),
    EntradaCatalogo(
        clave=DERECHOS_EXPLICACION_CLAVE,
        modulo=MI_PERFIL,
        seccion="Mis derechos",
        nombre="Explicación de los derechos",
        requiere_aceptacion=False,
        texto=DERECHOS_EXPLICACION,
        descripcion=(
            "Encabeza «Sus derechos sobre sus datos personales». {plazo} se reemplaza por "
            "los días del plazo para responder."
        ),
        variables=("plazo",),
    ),
    EntradaCatalogo(
        clave=DERECHOS_ACCESO_CLAVE,
        modulo=MI_PERFIL,
        seccion="Mis derechos",
        nombre="Derecho de acceso",
        requiere_aceptacion=False,
        texto=DERECHOS_ACCESO,
        descripcion="La explicación de la solicitud «Acceso a mis datos».",
    ),
    EntradaCatalogo(
        clave=DERECHOS_RECTIFICACION_CLAVE,
        modulo=MI_PERFIL,
        seccion="Mis derechos",
        nombre="Derecho de corrección",
        requiere_aceptacion=False,
        texto=DERECHOS_RECTIFICACION,
        descripcion="La explicación de la solicitud «Corrección de mis datos».",
    ),
    EntradaCatalogo(
        clave=DERECHOS_ELIMINACION_CLAVE,
        modulo=MI_PERFIL,
        seccion="Mis derechos",
        nombre="Derecho de eliminación",
        requiere_aceptacion=False,
        texto=DERECHOS_ELIMINACION,
        descripcion="La explicación de la solicitud «Eliminación de mis datos».",
    ),
    EntradaCatalogo(
        clave=ROL_PAGOS_TERMINOS_CLAVE,
        modulo=ROL_DE_PAGOS,
        seccion="Consultar",
        nombre="Términos de la consulta",
        requiere_aceptacion=True,
        texto=ROL_PAGOS_TERMINOS,
        descripcion="Se aceptan en cada consulta del rol de pagos.",
    ),
    EntradaCatalogo(
        clave=ROL_PAGOS_CORREO_CLAVE,
        modulo=ROL_DE_PAGOS,
        seccion="Enviar al correo",
        nombre="Consentimiento para guardar el correo personal",
        requiere_aceptacion=True,
        texto=ROL_PAGOS_CORREO,
        descripcion="Lo acepta quien guarda su correo personal para recibir su rol de pagos.",
    ),
    EntradaCatalogo(
        clave=ACUERDO_CONFIDENCIALIDAD,
        modulo=CODIGOS_DE_CONDUCTA,
        seccion="Leer documentos",
        nombre="Acuerdo de confidencialidad",
        requiere_aceptacion=True,
        texto=ACUERDO_TEXTO,
        titulo=ACUERDO_TITULO,
        descripcion=(
            "Se acepta antes de leer los códigos de conducta y reglamentos. Se pide de nuevo "
            "al cambiar los documentos o el texto."
        ),
    ),
    EntradaCatalogo(
        clave=NOVA_AVISO_IA,
        modulo=NOVA,
        seccion="Chat",
        nombre="Aviso de la IA",
        requiere_aceptacion=False,
        texto=NOVA_LINEA,
        descripcion="Encabeza el aviso del chat de Nova en todos los modos.",
    ),
    EntradaCatalogo(
        clave=NOVA_AVISO_GENERAL,
        modulo=NOVA,
        seccion="Chat",
        nombre="Aviso del modo General",
        requiere_aceptacion=False,
        texto=NOVA_GENERAL,
        descripcion="Sigue al aviso de la IA en el modo General.",
    ),
    EntradaCatalogo(
        clave=NOVA_AVISO_TAREAS,
        modulo=NOVA,
        seccion="Chat",
        nombre="Aviso del modo Mis tareas",
        requiere_aceptacion=False,
        texto=NOVA_SIN_SALUD,
        descripcion="Sigue al aviso de la IA en el modo Mis tareas.",
    ),
    EntradaCatalogo(
        clave=NOVA_AVISO_EQUIPO,
        modulo=NOVA,
        seccion="Chat",
        nombre="Aviso del modo Mi equipo",
        requiere_aceptacion=False,
        texto=NOVA_SIN_SALUD,
        descripcion="Sigue al aviso de la IA en el modo Mi equipo.",
    ),
    EntradaCatalogo(
        clave=NOVA_COMO_SE_PROTEGEN_CLAVE,
        modulo=NOVA,
        seccion="Chat",
        nombre="Cómo se protegen sus datos",
        requiere_aceptacion=False,
        texto=NOVA_COMO_SE_PROTEGEN,
        descripcion="Se despliega bajo «Cómo se protegen sus datos» en el chat de Nova.",
    ),
    EntradaCatalogo(
        clave=NOVA_PANEL_DESEMPENO_CLAVE,
        modulo=NOVA,
        seccion="Panel de desempeño",
        nombre="Aviso del análisis de desempeño",
        requiere_aceptacion=False,
        texto=NOVA_PANEL_DESEMPENO,
        descripcion="Se muestra en el panel de Nova del desempeño antes de generar el análisis.",
    ),
)

POR_CLAVE: dict[str, EntradaCatalogo] = {e.clave: e for e in CATALOGO}
CLAVES: tuple[str, ...] = tuple(POR_CLAVE)


def orden(clave: str) -> int:
    """La posición de la clave en el catálogo (para `TextoProteccion.orden`)."""
    return CLAVES.index(clave) + 1


def inicial(clave: str, nombre_empresa: str = "") -> str:
    """El texto inicial de una clave. El aviso general nombra a la empresa
    como responsable, así que depende de ella."""
    if clave == AVISO_PRIVACIDAD:
        # Importado aquí: `consentimiento` importa los servicios, que
        # importarán este catálogo.
        from .consentimiento import texto_inicial

        return texto_inicial(nombre_empresa)
    return POR_CLAVE[clave].texto
