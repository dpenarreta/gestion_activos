"""Las reglas de los llamados de atención (US-013, 12/11/2026).

**Quién hace qué**

- `llamados.emitir` (Gestión Humana): emite a cualquier persona activa de la
  empresa (nunca a sí mismo), confirma o rechaza lo que solicitan los jefes y
  anula lo emitido por error.
- `llamados.solicitar` (los jefes; lo da el organigrama, ver
  `organizacion.permisos_por_cargo.POR_TENER_EQUIPO`): solicita solo para
  personas de su equipo según el organigrama (`tasks.jerarquia.equipo_ids`,
  directa o indirectamente y por la línea punteada). Lo que pide queda
  `solicitado` hasta que Gestión Humana decide; a la persona no se le avisa
  hasta entonces.
- `llamados.ver` (o `emitir`): ve todos los de la empresa. Un jefe sin ellos
  ve solo los que solicitó.

**El nivel propuesto**: el siguiente al más alto que la persona ya tiene
emitido (y no anulado) por esa causa con fecha del hecho dentro del plazo de
reincidencia; sin ninguno, el primero; pasado el último, el último. Cuenta el
nivel más alto y no cuántos hay: si Gestión Humana saltó al tercero, el
siguiente sigue siendo el tercero. Aplicar otro exige justificación. Al
confirmar una solicitud se vuelve a calcular, porque entretanto pudo emitirse
otro.

**El correo**: si el nivel lo envía, sale a la persona (con copia al jefe
inmediato si el nivel lo pide, `licencias.services.jefes_de`) con la plantilla
del nivel. Las variables (`{{nombre}}`, `{{causa}}`…) las rellena el motor de
`apps.correos` (`motor.renderizar`), que **escapa** cada valor; el texto que
escribe quien configura tampoco lleva HTML: se escapa entero y sus saltos de
línea se convierten en párrafos. El asunto y el cuerpo que salieron se guardan
en el llamado. Un servidor de correo caído no impide emitir: queda «No se pudo
enviar» en el llamado y en el registro del sistema, sin datos de la persona.

**Avisos en la campana**: a quienes tienen `llamados.emitir` cuando un jefe
solicita; a la persona al emitir (y al anular, solo si antes se le avisó); al
jefe que solicitó, cuando se confirma o se rechaza.

Sanción económica: el monto es un dato (sugerido por el nivel, editable). No
se calculan topes legales ni se descuenta de la nómina: Gestión Humana valida
los montos (decisión del usuario, 12/11/2026).
"""

import html
import logging
import re
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal

from dateutil.relativedelta import relativedelta
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from apps.core.audit import record_audit_event
from apps.correos import motor
from apps.empresas.contexto import SIN_EMPRESA, empresa_actual, usando_empresa
from apps.licencias.services import jefes_de, personas_de_la_empresa
from apps.notificaciones import services as campana
from apps.permissions.authorization import user_has_permission
from apps.tasks import jerarquia

from .models import AccionLlamado, CausaLlamado, LlamadoAtencion, NivelLlamado, TipoNivel

logger = logging.getLogger("apps.llamados")

VER = "llamados.ver"
EMITIR = "llamados.emitir"
CONFIGURAR = "llamados.configurar"
SOLICITAR = "llamados.solicitar"

#: Adónde llevan los avisos de la campana (rutas del frontend).
ENLACE_GESTION = "/admin/gestion-humana/llamados-de-atencion"
ENLACE_MI_PERFIL = "/admin/perfil?seccion=llamados"

#: Un mismo llamado enviado dos veces seguidas (doble clic, reintento de la
#: red) no se registra dos veces dentro de este margen.
MARGEN_DUPLICADO = timedelta(seconds=30)

DESCRIPCION_MAX = 4000
MOTIVO_MAX = 2000
CUERPO_MAX = 10000
MONTO_MAX = Decimal("99999999.99")


class Modo:
    EMITIR = "emitir"
    SOLICITAR = "solicitar"
    #: Solo para `personas/`: la empresa entera para el filtro, con `ver`.
    VER = "ver"


class EstadoInvalido(APIException):
    """La acción no cabe en el estado del llamado (confirmar uno ya emitido,
    anular uno solicitado…), también si otra petición lo cambió a la vez."""

    status_code = 409
    default_code = "estado_invalido"
    default_detail = "El llamado de atención ya no está en un estado que permita esta acción."


class FueraDeSuEquipo(PermissionDenied):
    default_code = "fuera_de_su_equipo"
    default_detail = (
        "Solo puede solicitar llamados de atención para personas de su equipo según el "
        "organigrama."
    )


class EnUso(APIException):
    """Borrar o reordenar algo que ya tiene llamados registrados."""

    status_code = 409
    default_code = "en_uso"
    default_detail = "Ya tiene llamados de atención registrados: desactívelo en lugar de borrarlo."


class PropuestaCambio(APIException):
    """Se confirmaba sin elegir nivel con la propuesta que vio la pantalla
    (`nivel_esperado`), y entretanto cambió: 409 para que la web vuelva a
    mostrar la revisión con el nivel nuevo (`nivel`)."""

    status_code = 409
    default_code = "propuesta_cambio"
    default_detail = (
        "El nivel propuesto cambió mientras revisaba el llamado de atención. Revíselo de "
        "nuevo antes de confirmar."
    )

    def __init__(self, nivel):
        super().__init__()
        self.nivel = nivel


class Duplicado(APIException):
    status_code = 409
    default_code = "duplicado"
    default_detail = (
        "Ese llamado de atención se acaba de registrar. Revise la lista antes de volver a "
        "enviarlo."
    )


def nombre(usuario) -> str:
    return (usuario.get_full_name().strip() or usuario.username) if usuario else ""


def hoy():
    return timezone.localdate()


# --- Permisos y alcance ---------------------------------------------------------------------


def ve_todos(usuario) -> bool:
    return user_has_permission(usuario, VER) or user_has_permission(usuario, EMITIR)


def modo_para(usuario, pedido: str | None = None) -> str:
    """Con qué permiso actúa: `emitir` o `solicitar`. Sin pedir ninguno, emite
    quien puede emitir. Pedir uno que no tiene es 403."""
    puede_emitir = user_has_permission(usuario, EMITIR)
    puede_solicitar = user_has_permission(usuario, SOLICITAR)
    if pedido in (None, ""):
        if puede_emitir:
            return Modo.EMITIR
        if puede_solicitar:
            return Modo.SOLICITAR
        raise PermissionDenied(f"No tiene el permiso requerido: {EMITIR}.")
    if pedido == Modo.EMITIR:
        if not puede_emitir:
            raise PermissionDenied(f"No tiene el permiso requerido: {EMITIR}.")
        return Modo.EMITIR
    if pedido == Modo.SOLICITAR:
        if not puede_solicitar:
            raise PermissionDenied(f"No tiene el permiso requerido: {SOLICITAR}.")
        return Modo.SOLICITAR
    raise ValidationError({"modo": "El modo debe ser «emitir» o «solicitar»."})


def modo_de_personas(usuario, pedido: str | None = None) -> str:
    """Para `personas/`: `emitir` o `solicitar` como al crear, y además `ver`
    (toda la empresa, para filtrar la lista) para quien solo puede ver."""
    if pedido == Modo.VER or (
        pedido in (None, "")
        and not user_has_permission(usuario, EMITIR)
        and not user_has_permission(usuario, SOLICITAR)
    ):
        if not user_has_permission(usuario, VER):
            raise PermissionDenied(f"No tiene el permiso requerido: {VER}.")
        return Modo.VER
    return modo_para(usuario, pedido)


def personas_para(usuario, modo: str):
    """A quién puede dirigirse: con `emitir`, toda persona activa de la empresa
    menos él; con `solicitar`, su equipo según el organigrama. Con `ver`, toda
    la empresa menos él (solo para el filtro de la lista)."""
    if modo in (Modo.EMITIR, Modo.VER):
        return personas_de_la_empresa().exclude(pk=usuario.pk)
    equipo = jerarquia.equipo_ids(usuario)
    return personas_de_la_empresa().filter(pk__in=equipo).exclude(pk=usuario.pk)


def exigir_persona(usuario, modo: str, persona_id):
    """La persona, si `usuario` puede dirigirse a ella en ese modo. Fuera de su
    equipo, un jefe recibe 403 `fuera_de_su_equipo`; con `emitir`, alguien que
    no es de la empresa es un dato inválido (no se dice si existe)."""
    try:
        persona_id = int(persona_id)
    except (TypeError, ValueError):
        raise ValidationError({"persona": "Elija a la persona."}) from None
    persona = personas_para(usuario, modo).filter(pk=persona_id).first()
    if persona is not None:
        return persona
    if modo == Modo.SOLICITAR:
        raise FueraDeSuEquipo()
    if persona_id == usuario.pk:
        raise ValidationError(
            {"persona": "No puede registrarse un llamado de atención a sí mismo."}
        )
    raise ValidationError({"persona": "Elija a una persona activa de la empresa."})


def causa_activa(causa_id) -> CausaLlamado:
    try:
        causa_id = int(causa_id)
    except (TypeError, ValueError):
        raise ValidationError({"causa": "Elija la causa."}) from None
    causa = CausaLlamado.objects.filter(pk=causa_id, activa=True).first()
    if causa is None:
        raise ValidationError({"causa": "Elija una causa activa."})
    return causa


def visibles(usuario):
    """Los llamados que ve en Gestión Humana: todos con `ver` o `emitir`; si no,
    los que solicitó. **Nunca los dirigidos a sí mismo** (decisión del Tech
    Lead, 12/11/2026): esos los ve solo en Mi perfil (`mios/`), sin quién los
    solicitó ni la evidencia. Así nadie de Gestión Humana lee ni decide sobre
    lo suyo."""
    consulta = LlamadoAtencion.objects.select_related(
        "persona",
        "causa",
        "nivel",
        "nivel_propuesto",
        "solicitado_por",
        "emitido_por",
        "rechazado_por",
        "anulado_por",
    ).exclude(persona=usuario)
    if ve_todos(usuario):
        return consulta
    return consulta.filter(solicitado_por=usuario)


# --- Variables y plantillas -----------------------------------------------------------------


@dataclass(frozen=True)
class Variable:
    nombre: str
    descripcion: str
    ejemplo: str

    @property
    def marcador(self) -> str:
        return "{{" + self.nombre + "}}"


VARIABLES = (
    Variable("nombre", "Nombres de la persona", "María José"),
    Variable("apellidos", "Apellidos de la persona", "Peñafiel Ortiz"),
    Variable("nombre_completo", "Nombres y apellidos de la persona", "María José Peñafiel Ortiz"),
    Variable("cargo", "Cargo de la persona en el organigrama", "Analista de Cartera"),
    Variable("area", "Área (unidad) del cargo de la persona", "Cartera"),
    Variable("jefe", "Jefe inmediato de la persona", "Andrés Núñez"),
    Variable(
        "causa", "Causa del llamado", "Incumplimiento de la firma o aceptación del rol de pagos"
    ),
    Variable("nivel", "Nivel aplicado", "Segundo llamado (escrito)"),
    Variable("tipo_nivel", "Tipo del nivel: verbal, escrito o sanción económica", "Escrito"),
    Variable("fecha_hecho", "Fecha del hecho (dd/mm/aaaa)", "05/11/2026"),
    Variable(
        "descripcion",
        "Descripción del hecho",
        "No firmó ni aceptó el rol de pagos de octubre dentro del plazo.",
    ),
    Variable("monto", "Monto de la sanción económica, en USD (vacío si no aplica)", "25,00"),
    Variable("numero", "Número del llamado", "LLA-2026-0007"),
    Variable("empresa", "Empresa", "LaarCourier"),
    Variable("emitido_por", "Quién emite el llamado", "Carolina Albán"),
    Variable("fecha_emision", "Fecha de emisión (dd/mm/aaaa)", "12/11/2026"),
)
NOMBRES_DE_VARIABLES = frozenset(v.nombre for v in VARIABLES)


#: `{nombre}` con llave simple, como lo proponía la historia: se acepta igual
#: que `{{nombre}}` (la sintaxis del motor de correos), solo para las variables
#: que existen. Cualquier otra cosa entre llaves simples queda como texto.
_LLAVE_SIMPLE = re.compile(r"(?<!\{)\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}(?!\})")


def normalizar(texto: str) -> str:
    """Pasa `{variable}` a `{{variable}}` para las variables conocidas."""
    return _LLAVE_SIMPLE.sub(
        lambda m: "{{" + m.group(1) + "}}" if m.group(1) in NOMBRES_DE_VARIABLES else m.group(0),
        texto or "",
    )


def ejemplo() -> dict:
    return {v.nombre: v.ejemplo for v in VARIABLES}


def variables_desconocidas(*textos: str) -> list[str]:
    usadas = set()
    for texto in textos:
        usadas |= motor.variables_usadas(normalizar(texto))
    return sorted(usadas - NOMBRES_DE_VARIABLES)


def formatear_monto(monto) -> str:
    """25 → «25,00»; 1250.5 → «1.250,50» (como se escribe en Ecuador)."""
    if monto is None:
        return ""
    texto = f"{Decimal(monto):,.2f}"
    return texto.replace(",", "§").replace(".", ",").replace("§", ".")


def _cuerpo_html(cuerpo: str, variables: dict) -> str:
    """El cuerpo como HTML: el texto de la plantilla se escapa entero (quien
    configura escribe texto, no HTML), las variables las escapa el motor y cada
    bloque separado por una línea en blanco es un párrafo."""
    plantilla = html.escape((cuerpo or "").replace("\r\n", "\n"), quote=False)
    lleno = motor.renderizar(plantilla, variables)
    parrafos = [p.strip() for p in re.split(r"\n\s*\n", lleno) if p.strip()]
    contenido = "".join(
        f'<p style="margin: 0 0 12px;">{p.replace(chr(10), "<br>")}</p>' for p in parrafos
    )
    return (
        '<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; '
        f'line-height: 1.5; color: #212529;">{contenido}</div>'
    )


def renderizar(asunto: str, cuerpo: str, variables: dict) -> dict:
    """`asunto`, `html` y `texto` del correo con las variables puestas."""
    valores = {k: ("" if v is None else str(v)) for k, v in variables.items()}
    asunto, cuerpo = normalizar(asunto), normalizar(cuerpo)
    asunto_final = " ".join(motor.renderizar(asunto or "", valores, escapar=False).split())
    texto = motor.renderizar((cuerpo or "").replace("\r\n", "\n"), valores, escapar=False)
    texto = re.sub(r"\n{3,}", "\n\n", texto).strip()
    return {"asunto": asunto_final[:255], "html": _cuerpo_html(cuerpo, valores), "texto": texto}


def variables_de(llamado: LlamadoAtencion, jefes=None) -> dict:
    persona = llamado.persona
    cargo = jerarquia.cargo_de(persona)
    jefes = jefes_de(persona) if jefes is None else jefes
    empresa = llamado.empresa
    return {
        "nombre": (persona.first_name or "").strip() or persona.username,
        "apellidos": (persona.last_name or "").strip(),
        "nombre_completo": nombre(persona),
        "cargo": cargo.nombre if cargo else "",
        "area": cargo.unidad.nombre if cargo and cargo.unidad_id else "",
        "jefe": ", ".join(nombre(j) for j in jefes),
        "causa": llamado.causa_nombre,
        "nivel": llamado.nivel_nombre,
        "tipo_nivel": TipoNivel(llamado.nivel_tipo).label,
        "fecha_hecho": llamado.fecha_hecho.strftime("%d/%m/%Y"),
        "descripcion": llamado.descripcion,
        "monto": formatear_monto(llamado.monto),
        "numero": llamado.numero,
        "empresa": empresa.nombre if empresa else "",
        "emitido_por": nombre(llamado.emitido_por),
        "fecha_emision": timezone.localtime(llamado.emitido_en or timezone.now()).strftime(
            "%d/%m/%Y"
        ),
    }


# --- Causas y niveles -----------------------------------------------------------------------


def _limpio(texto) -> str:
    return (texto or "").strip()


def validar_nivel(datos: dict) -> dict:
    """Las reglas de un nivel, con los errores por campo."""
    errores = {}
    datos = dict(datos)
    datos["nombre"] = _limpio(datos.get("nombre"))
    datos["asunto"] = _limpio(datos.get("asunto"))
    datos["cuerpo"] = (datos.get("cuerpo") or "").strip()
    if not datos["nombre"]:
        errores["nombre"] = "Escriba el nombre del nivel."
    if datos.get("tipo") != TipoNivel.SANCION_ECONOMICA:
        datos["monto_sugerido"] = None
    if datos.get("envia_correo"):
        if not datos["asunto"]:
            errores["asunto"] = "Escriba el asunto del correo."
        if not datos["cuerpo"]:
            errores["cuerpo"] = "Escriba el cuerpo del correo."
    desconocidas = variables_desconocidas(datos["asunto"], datos["cuerpo"])
    if desconocidas:
        lista = ", ".join("{{" + v + "}}" for v in desconocidas)
        errores["cuerpo" if "cuerpo" not in errores else "asunto"] = (
            f"Estas variables no existen: {lista}. Use solo las de la lista."
        )
    if errores:
        raise ValidationError(errores)
    return datos


def niveles_usados(causa=None) -> set[int]:
    """Los niveles que figuran en algún llamado, aplicados o propuestos."""
    consulta = LlamadoAtencion.objects.all()
    if causa is not None:
        consulta = consulta.filter(causa=causa)
    usados = set(consulta.values_list("nivel_id", flat=True).distinct())
    usados |= set(
        consulta.filter(nivel_propuesto__isnull=False)
        .values_list("nivel_propuesto_id", flat=True)
        .distinct()
    )
    return usados


def en_uso(nivel: NivelLlamado) -> bool:
    return nivel.pk in niveles_usados(nivel.causa)


@transaction.atomic
def guardar_causa(causa: CausaLlamado | None, datos: dict, niveles: list[dict] | None):
    """Crea o edita una causa y, si llegan, deja sus niveles como dice la
    lista (en el orden de `orden`, o el de la lista): los que traen `id` se
    editan, los demás se crean y los que faltan se borran; uno ya usado que
    falta no se borra, se desactiva.

    Con llamados registrados en la causa, los niveles existentes conservan su
    orden (los nuevos van al final; si no, 409 `en_uso`), uno usado no cambia
    de tipo y los textos, el correo y el monto se siguen editando."""
    nueva = causa is None
    causa = causa or CausaLlamado()
    for campo in ("nombre", "descripcion", "meses_reincidencia", "activa"):
        if campo in datos:
            setattr(causa, campo, datos[campo])
    causa.nombre = _limpio(causa.nombre)
    if not causa.nombre:
        raise ValidationError({"nombre": "Escriba el nombre de la causa."})
    repetida = CausaLlamado.objects.filter(nombre__iexact=causa.nombre)
    if not nueva:
        repetida = repetida.exclude(pk=causa.pk)
    if repetida.exists():
        raise ValidationError({"nombre": "Ya hay una causa con ese nombre."})
    try:
        # Con savepoint: dos altas a la vez con el mismo nombre chocan con la
        # restricción única; la segunda recibe el mismo 400, no un 500.
        with transaction.atomic():
            causa.save()
    except IntegrityError:
        raise ValidationError({"nombre": "Ya hay una causa con ese nombre."}) from None

    if niveles is not None:
        _guardar_niveles(causa, niveles, nueva=nueva)

    if causa.activa and not causa.niveles.filter(activo=True).exists():
        raise ValidationError({"niveles": "Una causa activa necesita al menos un nivel activo."})
    return causa


def _guardar_niveles(causa, niveles: list[dict], *, nueva: bool):
    actuales = {} if nueva else {n.pk: n for n in causa.niveles.all()}
    usados = set() if nueva else niveles_usados(causa) & set(actuales)
    errores = {}
    validados = []
    for i, datos in enumerate(niveles):
        try:
            validados.append(validar_nivel(datos))
        except ValidationError as error:
            errores[str(i)] = error.detail
    if errores:
        raise ValidationError({"niveles": errores})
    # El orden: el que traiga cada nivel en `orden`; sin él, el de la lista.
    validados = [
        d
        for _, _, d in sorted(
            (d.get("orden") if d.get("orden") is not None else i, i, d)
            for i, d in enumerate(validados)
        )
    ]

    ids_pedidos = [d.get("id") for d in validados if d.get("id")]
    ajenos = [pk for pk in ids_pedidos if pk not in actuales]
    if ajenos:
        raise ValidationError({"niveles": "Uno de los niveles no es de esta causa."})
    if len(set(ids_pedidos)) != len(ids_pedidos):
        raise ValidationError({"niveles": "Un nivel aparece dos veces."})

    quitados = set(actuales) - set(ids_pedidos)
    # Uno usado que se quita de la lista no se borra: se desactiva y conserva
    # su lugar (decisión del 12/11/2026, contrato con la web).
    desactivar = quitados & usados
    borrar = quitados - usados
    for pk in usados & set(ids_pedidos):
        pedido = next(d for d in validados if d.get("id") == pk)
        if pedido.get("tipo", actuales[pk].tipo) != actuales[pk].tipo:
            raise EnUso(
                f"El nivel «{actuales[pk].nombre}» ya se usó: no puede cambiar de tipo. "
                "Agregue otro nivel."
            )

    if usados:
        # Los existentes, en el orden de antes; los nuevos, solo al final.
        orden_antes = sorted(actuales, key=lambda pk: (actuales[pk].orden, pk))
        esperados = [pk for pk in orden_antes if pk not in quitados]
        posiciones = [i for i, d in enumerate(validados) if d.get("id")]
        if ids_pedidos != esperados or (posiciones and posiciones[-1] != len(posiciones) - 1):
            raise EnUso(
                "Esta causa ya tiene llamados de atención: sus niveles no se reordenan. Los "
                "nuevos se agregan al final."
            )
        por_id = {d["id"]: d for d in validados if d.get("id")}
        final = [
            por_id.get(pk) or {"id": pk, "activo": False} for pk in orden_antes if pk not in borrar
        ] + [d for d in validados if not d.get("id")]
    else:
        final = validados

    NivelLlamado.objects.filter(pk__in=borrar).delete()
    for orden, datos in enumerate(final, start=1):
        nivel = actuales.get(datos.get("id")) or NivelLlamado(causa=causa, empresa=causa.empresa)
        nivel.orden = orden
        for campo in (
            "nombre",
            "tipo",
            "envia_correo",
            "asunto",
            "cuerpo",
            "monto_sugerido",
            "copia_jefe",
            "activo",
        ):
            if campo in datos:
                setattr(nivel, campo, datos[campo])
        if nivel.pk in desactivar:
            nivel.activo = False
        nivel.save()


def borrar_causa(causa: CausaLlamado) -> None:
    if LlamadoAtencion.objects.todas().filter(causa=causa).exists():
        raise EnUso("Esta causa ya tiene llamados de atención: desactívela en lugar de borrarla.")
    causa.delete()


# --- La propuesta de nivel ------------------------------------------------------------------


@dataclass
class Propuesta:
    causa: CausaLlamado
    nivel: NivelLlamado
    niveles: list
    #: Los emitidos y no anulados que cuentan para la reincidencia.
    previos: list
    desde: object
    es_ultimo: bool


def niveles_activos(causa) -> list:
    return list(causa.niveles.filter(activo=True).order_by("orden", "id"))


def proponer(persona, causa, *, fecha=None, excluir=None) -> Propuesta:
    """El nivel que corresponde: el siguiente al más alto ya emitido (y no
    anulado) dentro del plazo de reincidencia, contado hacia atrás desde la
    fecha del hecho (o desde hoy)."""
    niveles = niveles_activos(causa)
    if not niveles:
        raise ValidationError({"causa": "Esta causa no tiene niveles activos."})
    referencia = fecha or hoy()
    desde = referencia - relativedelta(months=causa.meses_reincidencia)
    previos = LlamadoAtencion.objects.filter(
        persona=persona,
        causa=causa,
        estado=LlamadoAtencion.Estado.EMITIDO,
        fecha_hecho__gte=desde,
    ).select_related("nivel")
    if excluir is not None and excluir.pk:
        previos = previos.exclude(pk=excluir.pk)
    previos = list(previos.order_by("-fecha_hecho", "-id"))
    if not previos:
        nivel = niveles[0]
    else:
        alcanzado = max(p.nivel.orden for p in previos)
        siguientes = [n for n in niveles if n.orden > alcanzado]
        nivel = siguientes[0] if siguientes else niveles[-1]
    return Propuesta(
        causa=causa,
        nivel=nivel,
        niveles=niveles,
        previos=previos,
        desde=desde,
        es_ultimo=nivel.pk == niveles[-1].pk,
    )


def historial_de(persona, causa) -> list:
    """Los llamados de la persona en esa causa (sin los rechazados), del más
    reciente al más antiguo."""
    return list(
        LlamadoAtencion.objects.filter(persona=persona, causa=causa)
        .exclude(estado=LlamadoAtencion.Estado.RECHAZADO)
        .order_by("-fecha_hecho", "-id")
    )


# --- Validaciones del llamado ---------------------------------------------------------------


def _nivel_elegido(causa, nivel_id, propuesta: Propuesta) -> NivelLlamado:
    if nivel_id in (None, ""):
        return propuesta.nivel
    nivel = next((n for n in propuesta.niveles if n.pk == int(nivel_id)), None)
    if nivel is None:
        raise ValidationError({"nivel": "Elija un nivel activo de esta causa."})
    return nivel


def _justificacion(nivel, propuesta: Propuesta, texto: str) -> str:
    texto = _limpio(texto)
    if nivel.pk != propuesta.nivel.pk and not texto:
        raise ValidationError(
            {
                "justificacion_cambio": (
                    f"El nivel propuesto es «{propuesta.nivel.nombre}». Justifique por qué "
                    "aplica otro."
                )
            }
        )
    if len(texto) > MOTIVO_MAX:
        raise ValidationError({"justificacion_cambio": f"Use como máximo {MOTIVO_MAX} caracteres."})
    return texto if nivel.pk != propuesta.nivel.pk else ""


def _monto(nivel, monto):
    """En una sanción económica es obligatorio (si no llega, el sugerido); en
    los demás niveles no hay monto."""
    if nivel.tipo != TipoNivel.SANCION_ECONOMICA:
        return None
    if monto is None:
        monto = nivel.monto_sugerido
    if monto is None:
        raise ValidationError({"monto": "Indique el monto de la sanción económica."})
    if monto <= 0:
        raise ValidationError({"monto": "El monto debe ser mayor que cero."})
    if monto > MONTO_MAX:
        raise ValidationError({"monto": "El monto es demasiado alto."})
    return monto


def _descripcion(texto) -> str:
    texto = (texto or "").strip()
    if not texto:
        raise ValidationError({"descripcion": "Describa el hecho."})
    if len(texto) > DESCRIPCION_MAX:
        raise ValidationError({"descripcion": f"Use como máximo {DESCRIPCION_MAX} caracteres."})
    return texto


def _fecha_hecho(fecha):
    if fecha is None:
        raise ValidationError({"fecha_hecho": "Indique la fecha del hecho."})
    if fecha > hoy():
        raise ValidationError({"fecha_hecho": "La fecha del hecho no puede ser futura."})
    return fecha


def _motivo(texto, campo="motivo") -> str:
    texto = (texto or "").strip()
    if not texto:
        raise ValidationError({campo: "Escriba el motivo."})
    if len(texto) > MOTIVO_MAX:
        raise ValidationError({campo: f"Use como máximo {MOTIVO_MAX} caracteres."})
    return texto


# --- Historial, avisos y correo -------------------------------------------------------------


def _registrar(llamado, accion, actor=None, comentario="", detalle=""):
    return AccionLlamado.objects.create(
        llamado=llamado,
        empresa=llamado.empresa,
        actor=actor,
        accion=accion,
        comentario=(comentario or "").strip(),
        detalle=(detalle or "")[:300],
    )


def _resumen(llamado) -> str:
    return f"{llamado.numero} · {nombre(llamado.persona)} · {llamado.causa_nombre}"


def _enlace(llamado) -> str:
    return f"{ENLACE_GESTION}?llamado={llamado.pk}"


def emisores() -> list:
    """Quienes tienen `llamados.emitir` en la empresa activa, en una consulta:
    por su cuenta, por un rol global o por un rol de su membresía en esta
    empresa (lo mismo que mira `user_has_permission`), o por ser superusuario."""
    from django.contrib.auth.models import Permission

    permiso = Permission.objects.filter(
        content_type__app_label="permissions", codename=EMITIR
    ).first()
    if permiso is None:
        return []
    filtro = Q(is_superuser=True) | Q(user_permissions=permiso) | Q(groups__permissions=permiso)
    empresa = empresa_actual()
    if empresa is not None and empresa is not SIN_EMPRESA:
        filtro |= Q(membresias__empresa=empresa, membresias__roles__permissions=permiso)
    return list(personas_de_la_empresa().filter(filtro).distinct())


def _enviar_correo(llamado) -> None:
    """Manda el correo del nivel y deja en el llamado lo que salió. Nunca
    levanta: el fallo queda en el llamado y en el registro, sin datos de la
    persona."""
    nivel = llamado.nivel
    jefes = jefes_de(llamado.persona)
    correo = renderizar(nivel.asunto, nivel.cuerpo, variables_de(llamado, jefes))
    llamado.correo_asunto = correo["asunto"]
    llamado.correo_cuerpo = correo["texto"]
    para = (llamado.persona.email or "").strip()
    copia = []
    if nivel.copia_jefe:
        copia = sorted(
            {j.email.strip() for j in jefes if j.email and j.email.strip().lower() != para.lower()}
        )
    llamado.correo_para = para[:254]
    llamado.correo_copia = ", ".join(copia)[:1000]
    if not para:
        llamado.correo_estado = LlamadoAtencion.EstadoCorreo.SIN_DIRECCION
    else:
        try:
            mensaje = EmailMultiAlternatives(
                subject=correo["asunto"],
                body=correo["texto"],
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[para],
                cc=copia,
            )
            mensaje.attach_alternative(correo["html"], "text/html")
            mensaje.send(fail_silently=False)
        except Exception:  # noqa: BLE001
            # Sin traza ni direcciones: el error del servidor puede citarlas.
            logger.error("No se pudo enviar el correo del llamado de atención %s", llamado.numero)
            llamado.correo_estado = LlamadoAtencion.EstadoCorreo.FALLIDO
        else:
            llamado.correo_estado = LlamadoAtencion.EstadoCorreo.ENVIADO
            llamado.correo_enviado_en = timezone.now()
            llamado.notificado_en = llamado.notificado_en or llamado.correo_enviado_en
    llamado.save(
        update_fields=[
            "correo_asunto",
            "correo_cuerpo",
            "correo_para",
            "correo_copia",
            "correo_estado",
            "correo_enviado_en",
            "notificado_en",
            "updated_at",
        ]
    )
    _registrar(
        llamado,
        AccionLlamado.Accion.CORREO,
        detalle=LlamadoAtencion.EstadoCorreo(llamado.correo_estado).label
        + (" (con copia al jefe inmediato)" if copia else ""),
    )
    # La auditoría con el estado final del correo: el evento de la emisión se
    # registra antes de que el correo salga.
    record_audit_event(
        actor=llamado.emitido_por,
        action="llamados.correo",
        target=llamado,
        module="llamados",
        new_values={"numero": llamado.numero, "correo": llamado.correo_estado},
    )


def enviar_correo_pendiente(llamado_id) -> None:
    """Lo que corre **tras el commit** (QA-TECH, 12/11/2026): relee el llamado
    con la fila bloqueada y manda su correo si sigue pendiente. Si la emisión
    se deshizo, no hay correo; si ya salió (un reintento, o dos envíos a la
    vez), no se repite.

    Nunca se queda «Por enviar» (ronda 2, QA): si algo falla al armarlo o al
    guardarlo, queda «No se pudo enviar» y se puede reenviar desde el
    detalle. El registro no lleva direcciones."""
    try:
        with transaction.atomic():
            llamado = (
                LlamadoAtencion.objects.todas()
                .select_for_update()
                .select_related("persona", "nivel", "empresa", "emitido_por")
                .filter(
                    pk=llamado_id,
                    estado=LlamadoAtencion.Estado.EMITIDO,
                    correo_estado=LlamadoAtencion.EstadoCorreo.PENDIENTE,
                )
                .first()
            )
            if llamado is None:
                return
            with usando_empresa(llamado.empresa):
                _enviar_correo(llamado)
    except Exception:  # noqa: BLE001
        logger.error("Falló el envío del correo del llamado de atención con id %s", llamado_id)
        LlamadoAtencion.objects.todas().filter(
            pk=llamado_id, correo_estado=LlamadoAtencion.EstadoCorreo.PENDIENTE
        ).update(correo_estado=LlamadoAtencion.EstadoCorreo.FALLIDO, updated_at=timezone.now())


def _emitir(llamado, actor) -> None:
    """Lo deja `emitido` y avisa a la persona: campana y, si el nivel lo
    envía, correo **después del commit** (con `robust=True`: un fallo del
    correo nunca deshace la emisión)."""
    ahora = timezone.now()
    llamado.estado = LlamadoAtencion.Estado.EMITIDO
    llamado.emitido_por = actor
    llamado.emitido_en = ahora
    avisos = campana.notificar(
        [llamado.persona],
        tipo="llamados.emitido",
        titulo="Tiene un llamado de atención",
        resumen=f"{llamado.causa_nombre} · {llamado.nivel_nombre}",
        enlace=ENLACE_MI_PERFIL,
    )
    if avisos:
        llamado.notificado_en = ahora
    if llamado.nivel.envia_correo:
        llamado.correo_estado = LlamadoAtencion.EstadoCorreo.PENDIENTE
    llamado.save(
        update_fields=[
            "estado",
            "emitido_por",
            "emitido_en",
            "notificado_en",
            "correo_estado",
            "updated_at",
        ]
    )
    if llamado.nivel.envia_correo:
        pk = llamado.pk
        transaction.on_commit(lambda: enviar_correo_pendiente(pk), robust=True)


# --- Lo que se puede hacer con un llamado ---------------------------------------------------
#
# Bloqueos, siempre en el mismo orden para no cruzarse: primero la causa
# (`_bloquear_causa`), luego el llamado (`_bloquear`). Bloquear la causa
# serializa lo que cambia la reincidencia de esa causa: dos emisiones a la vez
# no proponen el mismo nivel ni se cuelan como duplicadas.


def _bloquear_causa(causa_id) -> None:
    (
        CausaLlamado.objects.todas()
        .select_for_update()
        .filter(pk=causa_id)
        .values_list("pk", flat=True)
        .first()
    )


def _bloquear(llamado) -> None:
    """Relee el estado con la fila bloqueada: dos decisiones a la vez sobre el
    mismo llamado no se pisan (la segunda recibe 409)."""
    estado = (
        LlamadoAtencion.objects.select_for_update()
        .filter(pk=llamado.pk)
        .values_list("estado", flat=True)
        .first()
    )
    if estado is not None:
        llamado.estado = estado


def _exigir_estado(llamado, estado, mensaje) -> None:
    _bloquear_causa(llamado.causa_id)
    _bloquear(llamado)
    if llamado.estado != estado:
        raise EstadoInvalido(mensaje)


def _exigir_que_no_sea_suyo(llamado, actor, accion: str) -> None:
    """Nadie confirma, rechaza ni anula un llamado dirigido a sí mismo."""
    if llamado.persona_id == actor.pk:
        raise PermissionDenied(f"No puede {accion} un llamado de atención dirigido a usted.")


def crear(actor, *, adjunto=None, **datos) -> LlamadoAtencion:
    """Emite (con `emitir`) o solicita (con `solicitar`) un llamado. Si algo
    falla y la transacción se deshace, la evidencia ya escrita en disco se
    borra: no quedan archivos huérfanos."""
    guardado = []
    try:
        with transaction.atomic():
            return _crear(actor, adjunto=adjunto, guardado=guardado, **datos)
    except Exception:
        for nombre_en_disco, almacen in guardado:
            try:
                almacen.delete(nombre_en_disco)
            except Exception:  # noqa: BLE001
                logger.warning("No se pudo borrar una evidencia huérfana de llamados")
        raise


def _crear(
    actor,
    *,
    modo: str,
    persona,
    causa,
    fecha_hecho,
    descripcion: str,
    nivel_id=None,
    justificacion: str = "",
    monto=None,
    adjunto=None,
    adjunto_tipo: str = "",
    guardado: list,
) -> LlamadoAtencion:
    """Quien solicita no elige el nivel ni el monto: queda el propuesto, y
    Gestión Humana los ajusta al confirmar."""
    fecha_hecho = _fecha_hecho(fecha_hecho)
    descripcion = _descripcion(descripcion)
    _bloquear_causa(causa.pk)
    propuesta = proponer(persona, causa, fecha=fecha_hecho)
    if modo == Modo.EMITIR:
        nivel = _nivel_elegido(causa, nivel_id, propuesta)
        justificacion = _justificacion(nivel, propuesta, justificacion)
        monto = _monto(nivel, monto)
    else:
        nivel, justificacion, monto = propuesta.nivel, "", None

    reciente = timezone.now() - MARGEN_DUPLICADO
    duplicado = LlamadoAtencion.objects.filter(
        persona=persona,
        causa=causa,
        fecha_hecho=fecha_hecho,
        descripcion=descripcion,
        created_at__gte=reciente,
        estado__in=[LlamadoAtencion.Estado.SOLICITADO, LlamadoAtencion.Estado.EMITIDO],
    ).filter(**({"emitido_por": actor} if modo == Modo.EMITIR else {"solicitado_por": actor}))
    if duplicado.exists():
        raise Duplicado()

    ahora = timezone.now()
    llamado = LlamadoAtencion(
        persona=persona,
        causa=causa,
        nivel_propuesto=propuesta.nivel,
        nivel=nivel,
        justificacion_nivel=justificacion,
        causa_nombre=causa.nombre,
        nivel_nombre=nivel.nombre,
        nivel_tipo=nivel.tipo,
        fecha_hecho=fecha_hecho,
        descripcion=descripcion,
        monto=monto,
        estado=LlamadoAtencion.Estado.SOLICITADO,
    )
    if modo == Modo.SOLICITAR:
        llamado.solicitado_por = actor
        llamado.solicitado_en = ahora
    else:
        # Para el control de duplicados: se completa en `_emitir`.
        llamado.emitido_por = actor
    if adjunto is not None:
        llamado.adjunto_nombre = adjunto.name[:255]
        llamado.adjunto_tipo = adjunto_tipo
        llamado.adjunto_tamano = adjunto.size
        llamado.adjunto.save(adjunto.name, adjunto, save=False)
        guardado.append((llamado.adjunto.name, llamado.adjunto.storage))
    llamado.save()
    # LLA-AAAA-NNNN: el número sale del id, como en la Solicitud de proyectos.
    llamado.numero = f"LLA-{llamado.created_at:%Y}-{llamado.pk:04d}"
    llamado.save(update_fields=["numero"])

    if modo == Modo.SOLICITAR:
        _registrar(llamado, AccionLlamado.Accion.SOLICITADO, actor=actor, detalle=nivel.nombre)
        campana.notificar(
            [u for u in emisores() if u.pk not in {actor.pk, persona.pk}],
            tipo="llamados.solicitado",
            titulo="Llamado de atención por revisar",
            resumen=_resumen(llamado),
            enlace=_enlace(llamado),
        )
        return llamado

    if nivel.pk != propuesta.nivel.pk:
        _registrar(
            llamado,
            AccionLlamado.Accion.NIVEL_CAMBIADO,
            actor=actor,
            comentario=justificacion,
            detalle=f"Propuesto: {propuesta.nivel.nombre} → aplicado: {nivel.nombre}",
        )
    _registrar(llamado, AccionLlamado.Accion.EMITIDO, actor=actor, detalle=nivel.nombre)
    _emitir(llamado, actor)
    return llamado


#: Los estados del correo que se pueden reenviar.
CORREO_REENVIABLE = frozenset(
    {
        LlamadoAtencion.EstadoCorreo.FALLIDO,
        LlamadoAtencion.EstadoCorreo.SIN_DIRECCION,
        LlamadoAtencion.EstadoCorreo.PENDIENTE,
    }
)
#: Un correo recién programado («Por enviar») no se reenvía antes de esto: es
#: el que está saliendo, y reenviarlo sería el doble clic.
ESPERA_REENVIO = timedelta(seconds=60)


@transaction.atomic
def reenviar_correo(llamado, actor) -> LlamadoAtencion:
    """Vuelve a mandar el correo de un emitido que no salió («No se pudo
    enviar», «Sin correo registrado» o «Por enviar»), con la plantilla del
    nivel y los datos de hoy (por ejemplo, el correo que se acaba de registrar
    a la persona). Sale tras el commit, como al emitir. Nunca sobre lo propio.
    Dos clics seguidos: el segundo recibe 409 `duplicado`."""
    _exigir_estado(
        llamado,
        LlamadoAtencion.Estado.EMITIDO,
        "Solo se reenvía el correo de un llamado de atención emitido.",
    )
    _exigir_que_no_sea_suyo(llamado, actor, "reenviar el correo de")
    fila = (
        LlamadoAtencion.objects.filter(pk=llamado.pk).values("correo_estado", "updated_at").first()
    )
    if fila["correo_estado"] not in CORREO_REENVIABLE:
        raise EstadoInvalido("El correo de este llamado de atención ya salió.")
    if (
        fila["correo_estado"] == LlamadoAtencion.EstadoCorreo.PENDIENTE
        and fila["updated_at"] > timezone.now() - ESPERA_REENVIO
    ):
        raise Duplicado("El correo se está enviando. Espere un momento y revise el detalle.")
    llamado.correo_estado = LlamadoAtencion.EstadoCorreo.PENDIENTE
    llamado.save(update_fields=["correo_estado", "updated_at"])
    _registrar(
        llamado,
        AccionLlamado.Accion.REENVIO_CORREO,
        actor=actor,
        detalle=f"Antes: {LlamadoAtencion.EstadoCorreo(fila['correo_estado']).label}",
    )
    pk = llamado.pk
    transaction.on_commit(lambda: enviar_correo_pendiente(pk), robust=True)
    return llamado


def destinatarios_previstos(persona) -> dict:
    """Para la pantalla de emitir o confirmar (ronda 2, QA-UX): si la persona
    tiene correo (sin mostrarlo) y quién es su jefe inmediato, el que recibiría
    la copia si el nivel la pide."""
    jefes = jefes_de(persona)
    return {
        "persona_tiene_correo": bool((persona.email or "").strip()),
        "jefe": {"nombre": ", ".join(nombre(j) for j in jefes)} if jefes else None,
    }


def propuesta_vigente(llamado) -> Propuesta | None:
    """La propuesta de hoy para un solicitado, sin contarlo a él: la que se
    aplicaría al confirmar sin elegir nivel. None si la causa se quedó sin
    niveles activos."""
    try:
        return proponer(llamado.persona, llamado.causa, fecha=llamado.fecha_hecho, excluir=llamado)
    except ValidationError:
        return None


@transaction.atomic
def confirmar(
    llamado,
    actor,
    *,
    nivel_id=None,
    justificacion="",
    monto=None,
    descripcion=None,
    nivel_esperado=None,
) -> LlamadoAtencion:
    """Gestión Humana confirma lo que pidió un jefe: con el nivel propuesto
    **recalculado ahora** (`propuesta_vigente`) u otro con justificación, y el
    monto y la descripción que ajuste. Queda emitido y se notifica como al
    emitir. Enviar como `nivel` el propuesto viejo cuando la propuesta ya
    cambió cuenta como cambiar de nivel: sin justificación, 400
    `justificacion_cambio`.

    `nivel_esperado`: el nivel propuesto que mostraba la pantalla. Si se
    confirma sin elegir `nivel` y la propuesta de ahora es otra, 409
    `propuesta_cambio` (`PropuestaCambio`, con el nivel nuevo) en vez de
    aplicar uno que nadie revisó."""
    _exigir_estado(
        llamado,
        LlamadoAtencion.Estado.SOLICITADO,
        "Este llamado de atención ya no está pendiente de confirmar.",
    )
    _exigir_que_no_sea_suyo(llamado, actor, "confirmar")
    propuesta = proponer(llamado.persona, llamado.causa, fecha=llamado.fecha_hecho, excluir=llamado)
    if nivel_id in (None, "") and nivel_esperado and propuesta.nivel.pk != int(nivel_esperado):
        raise PropuestaCambio(propuesta.nivel)
    nivel = _nivel_elegido(llamado.causa, nivel_id, propuesta)
    justificacion = _justificacion(nivel, propuesta, justificacion)
    anterior = llamado.nivel
    llamado.nivel_propuesto = propuesta.nivel
    llamado.nivel = nivel
    llamado.nivel_nombre = nivel.nombre
    llamado.nivel_tipo = nivel.tipo
    llamado.justificacion_nivel = justificacion
    llamado.monto = _monto(nivel, monto)
    if descripcion is not None:
        llamado.descripcion = _descripcion(descripcion)
    llamado.save()
    if nivel.pk != propuesta.nivel.pk or nivel.pk != anterior.pk:
        _registrar(
            llamado,
            AccionLlamado.Accion.NIVEL_CAMBIADO,
            actor=actor,
            comentario=justificacion,
            detalle=f"Propuesto: {propuesta.nivel.nombre} → aplicado: {nivel.nombre}",
        )
    _registrar(llamado, AccionLlamado.Accion.CONFIRMADO, actor=actor, detalle=nivel.nombre)
    _emitir(llamado, actor)
    if llamado.solicitado_por_id:
        campana.notificar(
            [llamado.solicitado_por],
            tipo="llamados.confirmado",
            titulo="Gestión Humana confirmó su solicitud de llamado de atención",
            resumen=_resumen(llamado),
            enlace=_enlace(llamado),
        )
    return llamado


@transaction.atomic
def rechazar(llamado, actor, motivo: str) -> LlamadoAtencion:
    _exigir_estado(
        llamado,
        LlamadoAtencion.Estado.SOLICITADO,
        "Este llamado de atención ya no está pendiente de confirmar.",
    )
    _exigir_que_no_sea_suyo(llamado, actor, "rechazar")
    motivo = _motivo(motivo)
    llamado.estado = LlamadoAtencion.Estado.RECHAZADO
    llamado.rechazado_por = actor
    llamado.rechazado_en = timezone.now()
    llamado.motivo_rechazo = motivo
    llamado.save(
        update_fields=["estado", "rechazado_por", "rechazado_en", "motivo_rechazo", "updated_at"]
    )
    _registrar(llamado, AccionLlamado.Accion.RECHAZADO, actor=actor, comentario=motivo)
    if llamado.solicitado_por_id:
        campana.notificar(
            [llamado.solicitado_por],
            tipo="llamados.rechazado",
            titulo="Gestión Humana rechazó su solicitud de llamado de atención",
            resumen=_resumen(llamado),
            enlace=_enlace(llamado),
        )
    return llamado


@transaction.atomic
def anular(llamado, actor, motivo: str) -> LlamadoAtencion:
    """Un emitido por error: queda anulado, deja de contar para la reincidencia
    y se avisa a la persona solo si antes se le había notificado."""
    _exigir_estado(
        llamado,
        LlamadoAtencion.Estado.EMITIDO,
        "Solo se anula un llamado de atención emitido.",
    )
    _exigir_que_no_sea_suyo(llamado, actor, "anular")
    motivo = _motivo(motivo)
    llamado.estado = LlamadoAtencion.Estado.ANULADO
    llamado.anulado_por = actor
    llamado.anulado_en = timezone.now()
    llamado.motivo_anulacion = motivo
    llamado.save(
        update_fields=["estado", "anulado_por", "anulado_en", "motivo_anulacion", "updated_at"]
    )
    _registrar(llamado, AccionLlamado.Accion.ANULADO, actor=actor, comentario=motivo)
    if llamado.notificado_en:
        campana.notificar(
            [llamado.persona],
            tipo="llamados.anulado",
            titulo="Se anuló un llamado de atención suyo",
            resumen=f"{llamado.causa_nombre} · {llamado.nivel_nombre}",
            enlace=ENLACE_MI_PERFIL,
        )
    return llamado


def puede_decidir(usuario, llamado) -> dict:
    """Qué botones ve `usuario` en el detalle. Nada sobre lo suyo."""
    emite = user_has_permission(usuario, EMITIR)
    propio = llamado.persona_id == usuario.pk
    solicitado = llamado.estado == LlamadoAtencion.Estado.SOLICITADO
    emitido = llamado.estado == LlamadoAtencion.Estado.EMITIDO
    return {
        "confirmar": emite and solicitado and not propio,
        "rechazar": emite and solicitado and not propio,
        "anular": emite and emitido and not propio,
        "reenviar": emite and emitido and not propio and llamado.correo_estado in CORREO_REENVIABLE,
    }
