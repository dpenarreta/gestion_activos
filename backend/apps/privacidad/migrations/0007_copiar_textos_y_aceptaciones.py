"""Pasa los textos de protección de datos y sus aceptaciones al catálogo y al
registro común (US-004, 11/11/2026).

**Textos.** En cada empresa se crea un `TextoProteccion` por clave del
catálogo, con el texto vigente de donde vivía hasta hoy y **la misma versión**,
para que nadie tenga que volver a aceptar por el cambio de lugar:

- `aviso_privacidad` ← `AvisoPrivacidad` (versión y versión exigida = la del
  aviso; quién lo editó; su primera fila de versión rige desde
  `version_desde`, cuándo se pidió aceptarla). **Sin aviso no se crea**: una
  empresa sin aviso no exige aceptar nada (`consentimiento.py`,
  `textos.NO_SE_SIEMBRAN`), y sembrarlo aquí obligaría a toda la empresa a
  aceptarlo desde el despliegue (QA-FUNC, B-1, 11/11/2026). Lo crea quien lo
  guarde por primera vez.
- `autorizacion_telefono` ← `organizacion.TextoLegal`.
- `rol_pagos_terminos` ← `nomina.ConfiguracionRolPagos.terminos` y su versión.
- `rol_pagos_correo` ← `ConfiguracionRolPagos.consentimiento_correo` (no tenía
  versión: empieza en 1).
- `acuerdo_confidencialidad` ← `organizacion.AcuerdoConfidencialidad` (título,
  texto y `version_documentos`, que es la versión con que se aceptaba).
- Los fijos del frontend (cumpleaños, aniversario, derechos, Nova), con su
  texto exacto del 11/11/2026, en la versión 1.

Salvo el aviso, si la fuente no existe en la empresa, el texto inicial. Cada
texto creado deja su primera fila en `VersionTextoProteccion`.

**Aceptaciones**, a `AceptacionTexto`, con `referencia` a la fila de origen:

- `AceptacionAviso`: tal cual (origen INTRANET o NEXO, IP, texto, restablecida).
  Las de Nexo no tienen versión numérica: quedan con `version` vacía. Si la
  empresa no tiene aviso no hay texto al que colgarlas: no se copian, se
  avisa cuántas son y siguen en su tabla (no debería haber: el aviso no se
  borra).
- Teléfono (`DatosDeContacto.telefono_aceptado_*`): la última constancia de
  cada persona con su IP, texto y versión. Si hoy no tiene teléfono personal,
  la autorización se retiró: `retirada_en` es la última modificación de su
  fila (cuándo se retiró no se guardaba; esa es la primera fecha en que se
  sabe que ya estaba retirada).
- Cumpleaños, aniversario y correo personal: solo guardaban la fecha. Quedan
  con origen MIGRADA, sin IP ni texto (CA-6). No se rellena el texto con el
  vigente: la constancia diría algo que no se registró. Cumpleaños y
  aniversario llevan la versión 1 porque su texto nunca cambió (era fijo en
  el frontend desde que existe); el correo, versión vacía (su texto era
  editable y sin versión: no se sabe cuál se aceptó). Solo existen mientras
  están activos (retirarlos borraba la fecha), así que todas están vigentes.
- `nomina.ConsultaRolPagos`: cada consulta es una aceptación de los términos,
  con su versión, el texto, la IP y el navegador. Puede ser la tabla más
  grande.
- `AceptacionConfidencialidad`: con su título y texto; no guardaba IP.

**Lotes.** Cada fuente se lee por rangos de clave primaria
(`filter(pk__gt=ultimo).order_by("pk")[:1000]`) y se escribe con
`bulk_create` en lotes de 1000. No se usa `iterator()`: mssql-django no lee
por partes (`can_use_chunked_reads = False`) y traería la tabla entera a
memoria de una vez.

**Idempotente.** No crea un texto que ya exista ni copia una fila cuya
referencia ya esté (restricción `privacidad_acep_una_por_referencia`). Las
filas sin empresa no se copian (no tienen catálogo al que colgar; en local y
en el diseño no existen) y se avisa cuántas quedaron fuera; siguen en su
tabla de origen.

**Al revertir** no se borra nada (`noop`): revertir `0006` elimina las tablas
enteras. Las fuentes no se tocan en esta historia, así que volver atrás no
pierde lo anterior a US-004; sí lo registrado después en el registro común.

Los textos van copiados aquí y no importados de `catalogo_textos.py`: una
migración no debe cambiar si mañana cambia el catálogo.
"""

from django.db import migrations
from django.utils import timezone

LOTE = 1000
#: Los textos que solo se crean si la empresa ya tenía el suyo: sin aviso
#: general no se exige nada (como `textos.NO_SE_SIEMBRAN`).
SOLO_CON_FUENTE = frozenset({"aviso_privacidad"})
MOTIVO = "Texto vigente al pasar al catálogo de protección de datos (US-004)."

GENERAL = "General"
MI_PERFIL = "Mi perfil"
ROL_DE_PAGOS = "Institucional › Rol de pagos"
CODIGOS_DE_CONDUCTA = "Institucional › Códigos de conducta"
NOVA = "Nova (IA)"

PLANTILLA_AVISO = """{responsable} es la responsable del tratamiento de sus datos personales. Los recopila y trata en la intranet con el fin de gestionar el trabajo, los recursos humanos y los servicios internos. Son estos:

- Datos de identificación y contacto: nombres, usuario, correo electrónico y, si usted lo autoriza, su teléfono.
- Datos de actividad laboral: cargo, área, tareas, horas trabajadas, actividades de seguimiento e indicadores de desempeño.
- Datos de asistencia y permisos: vacaciones, permisos personales y permisos médicos.
- Datos de condición laboral especial: maternidad o lactancia, cuando afectan la jornada laboral.
- Registros de uso: inicios de sesión y acciones en el sistema, para la seguridad y la auditoría.

Los datos de salud (permisos médicos, maternidad y lactancia) son datos sensibles: solo los trata el personal autorizado de Gestión Humana, con la finalidad de calcular correctamente la carga laboral y los indicadores, conforme a la Ley Orgánica de Protección de Datos Personales del Ecuador.

Sus datos no se comparten con terceros con fines comerciales. Algunas funciones de la intranet usan un proveedor externo de inteligencia artificial para generar análisis y respuestas; el proveedor es Google (Gemini). A ese proveedor solo se envían seudónimos (códigos que no permiten saber de quién se trata), nunca su nombre ni sus datos de salud. Si el proveedor cambia, este aviso se actualizará y se le pedirá aceptarlo de nuevo.

Sus datos se conservan el tiempo que dure la relación laboral y los plazos que exija la ley. Para cualquier consulta sobre el tratamiento de sus datos, el contacto es Gestión Humana.

Puede ejercer sus derechos de acceso, corrección y eliminación de sus datos desde «Mi perfil» › «Mis derechos», después de entrar, o consultando a Gestión Humana."""

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
NOVA_SIN_SALUD = "En este modo no se envían datos de salud."

#: (clave, módulo, sección, nombre, requiere aceptación, texto inicial, título)
#: en el orden del catálogo. El aviso general (texto vacío) se arma por empresa.
CATALOGO = (
    (
        "aviso_privacidad",
        GENERAL,
        "Entrada a la intranet",
        "Aviso de tratamiento de datos",
        True,
        "",
        "",
    ),
    (
        "autorizacion_telefono",
        MI_PERFIL,
        "Teléfono personal",
        "Autorización del teléfono personal",
        True,
        TELEFONO,
        "",
    ),
    (
        "cumpleanos_publico",
        MI_PERFIL,
        "Cumpleaños",
        "Cumpleaños público",
        True,
        "Acepto que mi día de cumpleaños sea información pública dentro de la empresa.",
        "",
    ),
    (
        "aniversario_publico",
        MI_PERFIL,
        "Aniversario",
        "Aniversario público",
        True,
        "Acepto que mi aniversario en la empresa sea información pública dentro de la empresa.",
        "",
    ),
    (
        "derechos_explicacion",
        MI_PERFIL,
        "Mis derechos",
        "Explicación de los derechos",
        False,
        "La Ley Orgánica de Protección de Datos Personales (LOPDP) le da derecho a saber qué "
        "datos suyos guarda la empresa, a pedir que los corrijan y a pedir que los borren cuando "
        "ya no hacen falta. Aquí puede hacerlo. La empresa debe responderle en un plazo de "
        "{plazo} días desde que envía su solicitud.",
        "",
    ),
    (
        "derechos_acceso",
        MI_PERFIL,
        "Mis derechos",
        "Derecho de acceso",
        False,
        "Saber qué datos personales suyos guarda la empresa en la intranet y para qué los usa.",
        "",
    ),
    (
        "derechos_rectificacion",
        MI_PERFIL,
        "Mis derechos",
        "Derecho de corrección",
        False,
        "Corregir o completar un dato suyo que está mal, desactualizado o incompleto.",
        "",
    ),
    (
        "derechos_eliminacion",
        MI_PERFIL,
        "Mis derechos",
        "Derecho de eliminación",
        False,
        "Pedir que se borren datos suyos que ya no hace falta guardar.",
        "",
    ),
    (
        "rol_pagos_terminos",
        ROL_DE_PAGOS,
        "Consultar",
        "Términos de la consulta",
        True,
        ROL_PAGOS_TERMINOS,
        "",
    ),
    (
        "rol_pagos_correo",
        ROL_DE_PAGOS,
        "Enviar al correo",
        "Consentimiento para guardar el correo personal",
        True,
        ROL_PAGOS_CORREO,
        "",
    ),
    (
        "acuerdo_confidencialidad",
        CODIGOS_DE_CONDUCTA,
        "Leer documentos",
        "Acuerdo de confidencialidad",
        True,
        ACUERDO_TEXTO,
        ACUERDO_TITULO,
    ),
    (
        "nova_aviso_ia",
        NOVA,
        "Chat",
        "Aviso de la IA",
        False,
        "Nova es una IA y puede equivocarse. No se envían nombres.",
        "",
    ),
    (
        "nova_aviso_general",
        NOVA,
        "Chat",
        "Aviso del modo General",
        False,
        "Puede preguntar por políticas sobre licencias o permisos médicos, pero no escriba datos "
        "de salud suyos ni de otras personas.",
        "",
    ),
    ("nova_aviso_tareas", NOVA, "Chat", "Aviso del modo Mis tareas", False, NOVA_SIN_SALUD, ""),
    ("nova_aviso_equipo", NOVA, "Chat", "Aviso del modo Mi equipo", False, NOVA_SIN_SALUD, ""),
    (
        "nova_como_se_protegen",
        NOVA,
        "Chat",
        "Cómo se protegen sus datos",
        False,
        "Revise las respuestas antes de decidir. Las personas se envían con seudónimos "
        "(«Persona A»), nunca con su nombre, y antes de enviar se ocultan correos, cédulas y "
        "teléfonos. En el modo General puede preguntar por políticas de salud (licencias, "
        "permisos médicos, maternidad); en Mis tareas y Mi equipo los mensajes que mencionan "
        "salud no se envían. La conversación no se guarda: se pierde al cerrar sesión o recargar "
        "la página.",
        "",
    ),
    (
        "nova_panel_desempeno",
        NOVA,
        "Panel de desempeño",
        "Aviso del análisis de desempeño",
        False,
        "Nova explica en lenguaje natural los indicadores de este mes. A la IA no se envía el "
        "nombre de la persona ni datos de salud.",
        "",
    ),
)


def _aviso_inicial(nombre_empresa):
    nombre_empresa = (nombre_empresa or "").strip()
    responsable = (
        f"La empresa {nombre_empresa}, para la que usted trabaja,"
        if nombre_empresa
        else "La empresa para la que usted trabaja"
    )
    return PLANTILLA_AVISO.replace("{responsable}", responsable)


def _version(valor):
    """Una versión válida (≥ 1) o `None` si no se conoce."""
    if isinstance(valor, str):
        valor = int(valor) if valor.strip().isdigit() else None
    return valor if valor and valor >= 1 else None


def _fuentes_de_texto(apps, empresa):
    """Lo vigente en la empresa de cada texto que ya era editable:
    {clave: (texto, titulo, version, version_exigida, editado_en, editado_por_id)},
    y desde cuándo rige la versión vigente de los que lo guardaban: {clave: fecha}."""
    Aviso = apps.get_model("privacidad", "AvisoPrivacidad")
    TextoLegal = apps.get_model("organizacion", "TextoLegal")
    Configuracion = apps.get_model("nomina", "ConfiguracionRolPagos")
    Acuerdo = apps.get_model("organizacion", "AcuerdoConfidencialidad")
    fuentes = {}
    desde = {}

    aviso = Aviso.objects.filter(empresa=empresa).first()
    if aviso is not None:
        version = _version(aviso.version) or 1
        fuentes["aviso_privacidad"] = (
            aviso.texto,
            "",
            version,
            version,
            aviso.updated_at,
            aviso.editado_por_id,
        )
        # «Rige desde» es cuándo se pidió aceptar la versión (`version_desde`),
        # no la última corrección del texto (`updated_at`): QA-FUNC, O-6,
        # 11/11/2026. `editado_en` del texto sí es la última edición.
        desde["aviso_privacidad"] = aviso.version_desde or aviso.updated_at
    # Sin aviso no hay fuente, y `_sembrar_textos` no lo crea (B-1).

    telefono = TextoLegal.objects.filter(empresa=empresa, clave="autorizacion_telefono").first()
    if telefono is not None:
        version = _version(telefono.version) or 1
        fuentes["autorizacion_telefono"] = (
            telefono.texto,
            "",
            version,
            version,
            telefono.updated_at,
            None,
        )

    # La fila de configuración del rol también guarda el aviso del primer día:
    # su `updated_at` no dice cuándo cambiaron los términos, así que no se usa.
    configuracion = Configuracion.objects.filter(empresa=empresa).first()
    if configuracion is not None:
        version = _version(configuracion.version) or 1
        fuentes["rol_pagos_terminos"] = (configuracion.terminos, "", version, version, None, None)
        fuentes["rol_pagos_correo"] = (configuracion.consentimiento_correo, "", 1, 1, None, None)

    acuerdo = Acuerdo.objects.filter(empresa=empresa).first()
    if acuerdo is not None:
        version = _version(acuerdo.version_documentos) or 1
        fuentes["acuerdo_confidencialidad"] = (
            acuerdo.texto,
            acuerdo.titulo,
            version,
            version,
            acuerdo.updated_at,
            None,
        )
    return fuentes, desde


def _sembrar_textos(apps, empresa, ahora):
    """Crea los textos que falten en la empresa. Devuelve {clave: TextoProteccion}."""
    Texto = apps.get_model("privacidad", "TextoProteccion")
    Version = apps.get_model("privacidad", "VersionTextoProteccion")
    existentes = {t.clave: t for t in Texto.objects.filter(empresa=empresa)}
    fuentes, desde = _fuentes_de_texto(apps, empresa)
    nuevos = []
    for orden, (clave, modulo, seccion, nombre, requiere, inicial, titulo) in enumerate(
        CATALOGO, start=1
    ):
        if clave in existentes:
            continue
        if clave in SOLO_CON_FUENTE and clave not in fuentes:
            # Una empresa sin aviso no exige nada: no se le crea (B-1).
            continue
        texto, titulo, version, exigida, editado_en, editado_por_id = fuentes.get(
            clave, (inicial, titulo, 1, 1, None, None)
        )
        nuevos.append(
            Texto(
                empresa=empresa,
                clave=clave,
                modulo=modulo,
                seccion=seccion,
                nombre=nombre,
                orden=orden,
                requiere_aceptacion=requiere,
                titulo=titulo,
                texto=texto,
                version=version,
                version_exigida=exigida,
                editado_en=editado_en,
                editado_por_id=editado_por_id,
            )
        )
    for texto in nuevos:
        # Uno a uno (son 17 por empresa): hace falta el id para su versión.
        texto.save()
        existentes[texto.clave] = texto
    Version.objects.bulk_create(
        [
            Version(
                texto_proteccion=t,
                version=t.version,
                titulo=t.titulo,
                texto=t.texto,
                editado_en=desde.get(t.clave) or t.editado_en or ahora,
                editado_por_id=t.editado_por_id,
                motivo=MOTIVO,
            )
            for t in nuevos
        ],
        batch_size=LOTE,
    )
    return existentes


def _por_rangos(consulta, *campos):
    """Las filas de `consulta` como diccionarios, de 1000 en 1000 por rangos de
    pk. Sustituye a `iterator()`, que en mssql-django lee todo de una vez."""
    ultimo = 0
    while True:
        lote = list(consulta.filter(pk__gt=ultimo).order_by("pk").values("pk", *campos)[:LOTE])
        if not lote:
            return
        yield from lote
        ultimo = lote[-1]["pk"]


class _Copiador:
    """Escribe aceptaciones de un texto en lotes y salta las ya copiadas."""

    def __init__(self, apps, texto):
        self.Aceptacion = apps.get_model("privacidad", "AceptacionTexto")
        self.texto = texto
        self.ya = set(
            self.Aceptacion.objects.filter(texto_proteccion=texto)
            .exclude(referencia="")
            .values_list("referencia", flat=True)
        )
        self.pendientes = []
        self.copiadas = 0

    def agregar(self, referencia, **campos):
        if referencia in self.ya:
            return
        self.ya.add(referencia)
        self.pendientes.append(
            self.Aceptacion(
                empresa_id=self.texto.empresa_id,
                texto_proteccion=self.texto,
                referencia=referencia,
                **campos,
            )
        )
        if len(self.pendientes) >= LOTE:
            self.vaciar()

    def vaciar(self):
        if self.pendientes:
            self.Aceptacion.objects.bulk_create(self.pendientes, batch_size=LOTE)
            self.copiadas += len(self.pendientes)
            self.pendientes = []
        return self.copiadas


def _copiar_aviso(apps, empresa, texto):
    AceptacionAviso = apps.get_model("privacidad", "AceptacionAviso")
    copiador = _Copiador(apps, texto)
    filas = _por_rangos(
        AceptacionAviso.objects.filter(empresa=empresa),
        "usuario_id",
        "version",
        "origen",
        "aceptado_en",
        "ip",
        "texto",
        "restablecida_en",
        "restablecida_por_id",
        "id_nexo",
    )
    for fila in filas:
        copiador.agregar(
            f"privacidad.AceptacionAviso:{fila['pk']}",
            usuario_id=fila["usuario_id"],
            version=_version(fila["version"]),
            texto_aceptado=fila["texto"] or "",
            aceptado_en=fila["aceptado_en"],
            ip=fila["ip"],
            origen="NEXO" if fila["origen"] == "NEXO" else "INTRANET",
            restablecida_en=fila["restablecida_en"],
            restablecida_por_id=fila["restablecida_por_id"],
            id_nexo=fila["id_nexo"],
        )
    return copiador.vaciar()


def _copiar_contacto(apps, empresa, textos):
    """Teléfono, cumpleaños, aniversario y correo personal, de `DatosDeContacto`."""
    Datos = apps.get_model("organizacion", "DatosDeContacto")
    telefono = _Copiador(apps, textos["autorizacion_telefono"])
    cumpleanos = _Copiador(apps, textos["cumpleanos_publico"])
    aniversario = _Copiador(apps, textos["aniversario_publico"])
    correo = _Copiador(apps, textos["rol_pagos_correo"])
    filas = _por_rangos(
        Datos.objects.filter(empresa=empresa),
        "usuario_id",
        "updated_at",
        "telefono",
        "telefono_aceptado_en",
        "telefono_aceptado_ip",
        "telefono_aceptado_texto",
        "telefono_aceptado_version",
        "cumpleanos_aceptado_en",
        "aniversario_aceptado_en",
        "correo_personal_aceptado_en",
    )
    for fila in filas:
        base = f"organizacion.DatosDeContacto:{fila['pk']}"
        usuario_id = fila["usuario_id"]
        if fila["telefono_aceptado_en"]:
            retirada = not (fila["telefono"] or "").strip()
            telefono.agregar(
                f"{base}:telefono",
                usuario_id=usuario_id,
                version=_version(fila["telefono_aceptado_version"]),
                texto_aceptado=fila["telefono_aceptado_texto"] or "",
                aceptado_en=fila["telefono_aceptado_en"],
                ip=fila["telefono_aceptado_ip"],
                origen="INTRANET",
                retirada_en=fila["updated_at"] if retirada else None,
                retirada_por_id=usuario_id if retirada else None,
            )
        if fila["cumpleanos_aceptado_en"]:
            cumpleanos.agregar(
                f"{base}:cumpleanos",
                usuario_id=usuario_id,
                version=1,
                aceptado_en=fila["cumpleanos_aceptado_en"],
                origen="MIGRADA",
            )
        if fila["aniversario_aceptado_en"]:
            aniversario.agregar(
                f"{base}:aniversario",
                usuario_id=usuario_id,
                version=1,
                aceptado_en=fila["aniversario_aceptado_en"],
                origen="MIGRADA",
            )
        if fila["correo_personal_aceptado_en"]:
            correo.agregar(
                f"{base}:correo",
                usuario_id=usuario_id,
                version=None,
                aceptado_en=fila["correo_personal_aceptado_en"],
                origen="MIGRADA",
            )
    return {
        "autorizacion_telefono": telefono.vaciar(),
        "cumpleanos_publico": cumpleanos.vaciar(),
        "aniversario_publico": aniversario.vaciar(),
        "rol_pagos_correo": correo.vaciar(),
    }


def _copiar_consultas_rol(apps, empresa, texto):
    Consulta = apps.get_model("nomina", "ConsultaRolPagos")
    copiador = _Copiador(apps, texto)
    filas = _por_rangos(
        Consulta.objects.filter(empresa=empresa),
        "usuario_id",
        "version_terminos",
        "terminos_aceptados",
        "ip",
        "navegador",
        "created_at",
    )
    for fila in filas:
        copiador.agregar(
            f"nomina.ConsultaRolPagos:{fila['pk']}",
            usuario_id=fila["usuario_id"],
            version=_version(fila["version_terminos"]),
            texto_aceptado=fila["terminos_aceptados"] or "",
            aceptado_en=fila["created_at"],
            ip=fila["ip"],
            navegador=(fila["navegador"] or "")[:300],
            origen="INTRANET",
        )
    return copiador.vaciar()


def _copiar_confidencialidad(apps, empresa, texto):
    Aceptacion = apps.get_model("organizacion", "AceptacionConfidencialidad")
    copiador = _Copiador(apps, texto)
    filas = _por_rangos(
        Aceptacion.objects.filter(empresa=empresa),
        "usuario_id",
        "version_documentos",
        "aceptado_en",
        "titulo_aceptado",
        "texto_aceptado",
    )
    for fila in filas:
        copiador.agregar(
            f"organizacion.AceptacionConfidencialidad:{fila['pk']}",
            usuario_id=fila["usuario_id"],
            version=_version(fila["version_documentos"]),
            titulo_aceptado=(fila["titulo_aceptado"] or "")[:200],
            texto_aceptado=fila["texto_aceptado"] or "",
            aceptado_en=fila["aceptado_en"],
            origen="INTRANET",
        )
    return copiador.vaciar()


def _sin_empresa(apps):
    """Cuántas filas de origen no tienen empresa (no se copian)."""
    fuentes = (
        ("privacidad", "AceptacionAviso"),
        ("organizacion", "DatosDeContacto"),
        ("nomina", "ConsultaRolPagos"),
        ("organizacion", "AceptacionConfidencialidad"),
    )
    return {
        f"{app}.{modelo}": n
        for app, modelo in fuentes
        if (n := apps.get_model(app, modelo).objects.filter(empresa__isnull=True).count())
    }


def copiar(apps, schema_editor):
    Empresa = apps.get_model("empresas", "Empresa")
    AceptacionAviso = apps.get_model("privacidad", "AceptacionAviso")
    ahora = timezone.now()
    sin_aviso = {}
    for empresa in Empresa.objects.order_by("pk"):
        textos = _sembrar_textos(apps, empresa, ahora)
        if "aviso_privacidad" in textos:
            _copiar_aviso(apps, empresa, textos["aviso_privacidad"])
        elif n := AceptacionAviso.objects.filter(empresa=empresa).count():
            sin_aviso[empresa.codigo] = n
        _copiar_contacto(apps, empresa, textos)
        _copiar_consultas_rol(apps, empresa, textos["rol_pagos_terminos"])
        _copiar_confidencialidad(apps, empresa, textos["acuerdo_confidencialidad"])
    if sin_aviso:
        print(f"\n  privacidad/0007: aceptaciones del aviso sin aviso en su empresa: {sin_aviso}")
    fuera = _sin_empresa(apps)
    if fuera:
        print(f"\n  privacidad/0007: filas sin empresa que no se copiaron: {fuera}")


class Migration(migrations.Migration):
    dependencies = [
        ("privacidad", "0006_textos_y_aceptaciones"),
        ("empresas", "0006_estado_modulo"),
        ("organizacion", "0049_reemplazo_en_ausencia"),
        ("nomina", "0011_codigo_consulta_rol"),
    ]

    # `noop` al revertir: ver el docstring. Revertir `0006` borra las tablas.
    operations = [migrations.RunPython(copiar, migrations.RunPython.noop)]
