"""El servicio único de los textos de protección de datos y sus aceptaciones
(US-004, 11/11/2026).

Hasta hoy cada módulo leía su texto y guardaba su constancia a su manera (ver
`models.TextoProteccion`). Desde US-004 todos pasan por aquí:

- **Leer** el texto vigente de una clave del catálogo (`vigente`, `obtener`).
- **Guardar** un texto nuevo (`guardar`): entre 20 y 6000 caracteres; la
  versión sube solo si el texto (o el título) cambió; cada versión deja su fila
  en `VersionTextoProteccion`, y la auditoría guarda el texto anterior y el
  nuevo.
- **Aceptar** y **retirar** (`aceptar`, `retirar`, `restablecer`): cada
  aceptación es una fila de `AceptacionTexto` con la versión, el texto exacto,
  la IP y el navegador. No se sobrescribe; retirar o restablecer la marca.
- **Saber si la persona aceptó lo que hoy se exige** (`acepto_vigente`).

**Qué se exige tras un cambio (CA-3).** Cada flujo conserva su regla; aquí se
traduce a `version_exigida`, la versión más antigua cuya aceptación sigue
valiendo:

- Aviso general (`aviso_privacidad`): editar no obliga a nadie; solo
  `pedir_de_nuevo` sube la versión exigida (`SOLO_SI_SE_PIDE`).
- Todos los demás textos que piden aceptación: la versión exigida es siempre
  la vigente. Cuándo se vuelve a pedir lo decide cada flujo (el teléfono, el
  cumpleaños, el aniversario y el correo al volver a guardarlos o activarlos;
  el rol de pagos en cada consulta; el acuerdo al entrar a Códigos de
  conducta).
- El acuerdo de confidencialidad, además, pide aceptarlo de nuevo cuando
  cambian los documentos: `nueva_version` sube la versión sin cambiar el texto
  (la fila de la versión dice por qué).

**Textos que no existen todavía en la empresa.** `privacidad/0007` sembró el
catálogo en las empresas que había. En una empresa nueva cada texto se crea
con su redacción inicial la primera vez que se necesita (`obtener`), salvo el
aviso general: sin aviso no se exige nada (la regla de `consentimiento.py`
desde el 09/11/2026) y nace cuando alguien lo guarda.

**Auditoría.** `guardar` y `nueva_version` auditan aquí. Aceptar y retirar los
audita cada flujo, como hasta hoy (con sus acciones de siempre): auditarlos
también aquí duplicaría cada evento.
"""

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.permissions.authorization import user_has_permission

from . import access
from . import catalogo_textos as cat
from .models import AceptacionTexto, TextoProteccion, VersionTextoProteccion
from .services import PrivacidadError, _audit, _invalido, nombre, plazo_dias

TEXTO_MIN = 20
TEXTO_MAX = 6000
TITULO_MAX = 200
MOTIVO_MAX = 300
NAVEGADOR_MAX = 300

Origen = AceptacionTexto.Origen

#: Los textos cuya versión exigida solo sube si se pide (CA-3).
SOLO_SI_SE_PIDE = frozenset({cat.AVISO_PRIVACIDAD})
#: Los que no se crean solos: sin ellos no se exige nada.
NO_SE_SIEMBRAN = frozenset({cat.AVISO_PRIVACIDAD})

MOTIVO_INICIAL = "Texto inicial del catálogo."

#: Los estados de una aceptación en el listado.
VIGENTE = "vigente"
RETIRADA = "retirada"
RESTABLECIDA = "restablecida"


# ── Empresa y texto ───────────────────────────────────────────────────────────


def _empresa(empresa=None):
    empresa = empresa if empresa is not None else empresa_actual()
    if empresa is None or empresa is SIN_EMPRESA:
        return None
    return empresa


def entrada(clave: str) -> cat.EntradaCatalogo:
    """La entrada del catálogo; una clave que no está, 404."""
    encontrada = cat.POR_CLAVE.get(clave)
    if encontrada is None:
        raise PrivacidadError("Texto no encontrado.", code="not_found", status=404)
    return encontrada


def _sin_empresa() -> PrivacidadError:
    return PrivacidadError("Elija la empresa.", code="sin_empresa", status=400)


def _sembrar(clave: str, empresa) -> TextoProteccion:
    """Crea el texto de la clave en la empresa con su redacción inicial y su
    primera versión. Si otra petición lo creó a la vez, devuelve ese."""
    datos = entrada(clave)
    try:
        with transaction.atomic():
            texto = TextoProteccion.objects.create(
                empresa=empresa,
                clave=clave,
                modulo=datos.modulo,
                seccion=datos.seccion,
                nombre=datos.nombre,
                orden=cat.orden(clave),
                requiere_aceptacion=datos.requiere_aceptacion,
                titulo=datos.titulo,
                texto=cat.inicial(clave, getattr(empresa, "nombre", "")),
                version=1,
                version_exigida=1,
            )
            VersionTextoProteccion.objects.create(
                texto_proteccion=texto,
                version=1,
                titulo=texto.titulo,
                texto=texto.texto,
                editado_en=timezone.now(),
                motivo=MOTIVO_INICIAL,
            )
    except IntegrityError:
        texto = TextoProteccion.objects.todas().get(empresa=empresa, clave=clave)
    return texto


def obtener(clave: str, empresa=None, *, crear: bool = True, bloquear: bool = False):
    """El `TextoProteccion` de la clave en la empresa (la activa si no se dice).

    `None` si no hay empresa, o si es el aviso general y la empresa no tiene.
    Con `crear`, el que falte (salvo el aviso) se siembra. Con `bloquear`, la
    fila queda bloqueada hasta el fin de la transacción: serializa los
    cambios de versión y las aceptaciones del mismo texto."""
    entrada(clave)
    empresa = _empresa(empresa)
    if empresa is None:
        return None
    consulta = TextoProteccion.objects.todas().filter(empresa=empresa, clave=clave)
    if bloquear:
        consulta = consulta.select_for_update()
    else:
        consulta = consulta.select_related("editado_por")
    texto = consulta.first()
    if texto is None and crear and clave not in NO_SE_SIEMBRAN:
        _sembrar(clave, empresa)
        texto = consulta.first()
    return texto


def _valores_de_variables() -> dict[str, str]:
    return {"plazo": str(plazo_dias())}


def con_variables(clave: str, texto: str) -> str:
    """El texto con sus marcadores (`{plazo}`) reemplazados, como lo lee la
    persona."""
    variables = entrada(clave).variables
    if not variables:
        return texto
    valores = _valores_de_variables()
    for variable in variables:
        texto = texto.replace("{" + variable + "}", valores.get(variable, ""))
    return texto


def vigente(clave: str, empresa=None) -> dict | None:
    """`{clave, version, texto, titulo}` del texto vigente, con las variables
    reemplazadas. `None` si no hay (sin empresa, o el aviso de una empresa
    que no lo tiene)."""
    texto = obtener(clave, empresa)
    if texto is None:
        return None
    return {
        "clave": clave,
        "version": texto.version,
        "texto": con_variables(clave, texto.texto),
        "titulo": texto.titulo,
    }


def vigente_o_inicial(clave: str, empresa=None) -> dict:
    """Como `vigente`, pero nunca `None` (QA-FUNC O-1): sin empresa, o el
    aviso de una empresa que no lo tiene, devuelve el texto inicial del
    catálogo con `version` vacía. Para las pantallas que leen
    `.texto`/`.titulo`/`.version` y no deben romperse; aceptar sin versión
    sigue sin poder hacerse (`aceptar` lo rechaza)."""
    datos = vigente(clave, empresa)
    if datos is not None:
        return datos
    empresa = _empresa(empresa)
    inicial = cat.inicial(clave, getattr(empresa, "nombre", ""))
    return {
        "clave": clave,
        "version": None,
        "texto": con_variables(clave, inicial),
        "titulo": entrada(clave).titulo,
    }


# ── Memo por petición ─────────────────────────────────────────────────────────
#
# Hay pantallas que preguntan por el mismo texto una vez por persona (la Mesa
# de ayuda arma «Mi perfil» de cada solicitante): sin memo eran ~100 consultas
# iguales por petición. Se guarda en la petición en curso y se olvida al
# guardar un texto; sin petición (comandos, pruebas con el ORM) no se memoriza.


def _memo() -> dict | None:
    from apps.empresas.contexto import _peticion

    peticion = _peticion.get()
    if peticion is None:
        return None
    destino = getattr(peticion, "_request", peticion)
    memo = getattr(destino, "_textos_proteccion", None)
    if memo is None:
        memo = {}
        destino._textos_proteccion = memo
    return memo


def _olvidar_memo() -> None:
    memo = _memo()
    if memo is not None:
        memo.clear()


def obtener_memo(clave: str):
    """`obtener(clave)` memorizado en la petición en curso (sin bloqueo)."""
    memo = _memo()
    empresa = _empresa()
    llave = (clave, getattr(empresa, "pk", None))
    if memo is not None and llave in memo:
        return memo[llave]
    texto = obtener(clave)
    if memo is not None:
        memo[llave] = texto
    return texto


# ── Catálogo ──────────────────────────────────────────────────────────────────


def _editor(usuario) -> dict | None:
    if usuario is None:
        return None
    return {"id": usuario.pk, "nombre": nombre(usuario)}


def de_texto(datos: cat.EntradaCatalogo, texto: TextoProteccion | None, empresa=None) -> dict:
    """Un texto del catálogo para quien lo administra. Sin fila (solo el aviso
    general de una empresa que no tiene) `existe` es falso, la versión vacía y
    el texto es el inicial que se propone."""
    base = {
        "clave": datos.clave,
        "modulo": datos.modulo,
        "seccion": datos.seccion,
        "nombre": datos.nombre,
        "descripcion": datos.descripcion,
        "requiere_aceptacion": datos.requiere_aceptacion,
        "lleva_titulo": bool(datos.titulo),
        "variables": list(datos.variables),
        "pide_aceptar_de_nuevo_al_guardar": datos.clave not in SOLO_SI_SE_PIDE
        and datos.requiere_aceptacion,
    }
    if texto is None:
        empresa = _empresa(empresa)
        return {
            **base,
            "existe": False,
            "titulo": datos.titulo,
            "texto": cat.inicial(datos.clave, getattr(empresa, "nombre", "")),
            "version": None,
            "version_exigida": None,
            "editado_en": None,
            "editado_por": None,
        }
    return {
        **base,
        "existe": True,
        "titulo": texto.titulo,
        "texto": texto.texto,
        "version": texto.version,
        "version_exigida": texto.version_exigida,
        "editado_en": texto.editado_en.isoformat() if texto.editado_en else None,
        "editado_por": _editor(texto.editado_por),
    }


def catalogo(empresa=None) -> list[dict]:
    """Todos los textos del catálogo en la empresa, agrupados por módulo y,
    dentro, por sección, en el orden del catálogo:
    `[{modulo, secciones: [{seccion, textos: [...]}]}]`. Los que falten se
    siembran (salvo el aviso general)."""
    empresa = _empresa(empresa)
    if empresa is None:
        raise _sin_empresa()
    existentes = {
        t.clave: t
        for t in TextoProteccion.objects.todas()
        .filter(empresa=empresa)
        .select_related("editado_por")
    }
    faltan = [c for c in cat.CLAVES if c not in existentes and c not in NO_SE_SIEMBRAN]
    if faltan:
        for clave in faltan:
            _sembrar(clave, empresa)
        existentes = {
            t.clave: t
            for t in TextoProteccion.objects.todas()
            .filter(empresa=empresa)
            .select_related("editado_por")
        }
    modulos: list[dict] = []
    for datos in cat.CATALOGO:
        if not modulos or modulos[-1]["modulo"] != datos.modulo:
            modulos.append({"modulo": datos.modulo, "secciones": []})
        secciones = modulos[-1]["secciones"]
        if not secciones or secciones[-1]["seccion"] != datos.seccion:
            secciones.append({"seccion": datos.seccion, "textos": []})
        secciones[-1]["textos"].append(de_texto(datos, existentes.get(datos.clave), empresa))
    return modulos


def versiones(clave: str, empresa=None) -> list[dict]:
    """Cada versión del texto, de la más nueva a la más vieja."""
    texto = obtener(clave, empresa)
    if texto is None:
        return []
    return [
        {
            "version": v.version,
            "titulo": v.titulo,
            "texto": v.texto,
            "editado_en": v.editado_en.isoformat(),
            "editado_por": _editor(v.editado_por),
            "motivo": v.motivo,
            "vigente": v.version == texto.version,
        }
        for v in VersionTextoProteccion.objects.filter(texto_proteccion=texto)
        .select_related("editado_por")
        .order_by("-version")
    ]


# ── Guardar ───────────────────────────────────────────────────────────────────


def _validar(datos: cat.EntradaCatalogo, texto, titulo, motivo) -> tuple[str, str, str]:
    texto = (texto or "").strip()
    if len(texto) < TEXTO_MIN:
        raise _invalido("texto", f"Escriba el texto completo (al menos {TEXTO_MIN} caracteres).")
    if len(texto) > TEXTO_MAX:
        raise _invalido("texto", f"El texto admite hasta {TEXTO_MAX} caracteres.")
    faltan = [v for v in datos.variables if "{" + v + "}" not in texto]
    if faltan:
        marcadores = ", ".join("{" + v + "}" for v in faltan)
        raise _invalido(
            "texto",
            f"El texto debe conservar {marcadores}: la pantalla lo reemplaza por su valor.",
        )
    titulo = (titulo or "").strip()
    if datos.titulo:
        if not titulo:
            raise _invalido("titulo", "Escriba el título.")
        if len(titulo) > TITULO_MAX:
            raise _invalido("titulo", f"El título admite hasta {TITULO_MAX} caracteres.")
    elif titulo:
        raise _invalido("titulo", "Este texto no lleva título.")
    motivo = (motivo or "").strip()
    if len(motivo) > MOTIVO_MAX:
        raise _invalido("motivo", f"El motivo admite hasta {MOTIVO_MAX} caracteres.")
    return texto, titulo, motivo


def _nueva_fila_de_version(texto: TextoProteccion, *, actor, motivo: str, ahora) -> None:
    VersionTextoProteccion.objects.create(
        texto_proteccion=texto,
        version=texto.version,
        titulo=texto.titulo,
        texto=texto.texto,
        editado_en=ahora,
        editado_por=actor,
        motivo=motivo,
    )


def _foto(texto: TextoProteccion) -> dict:
    return {
        "clave": texto.clave,
        "version": texto.version,
        "version_exigida": texto.version_exigida,
        "titulo": texto.titulo,
        "texto": texto.texto,
    }


def guardar(
    clave: str,
    *,
    texto: str,
    actor,
    titulo: str | None = None,
    motivo: str = "",
    pedir_de_nuevo: bool | None = None,
    context=None,
) -> TextoProteccion:
    """Guarda el texto de la clave en la empresa activa (`privacidad.textos`).

    - El texto, de 20 a 6000 caracteres, con sus variables; el título solo en
      los textos que lo llevan (el acuerdo de confidencialidad).
    - Sin cambios (y sin `pedir_de_nuevo` en el aviso) no hace nada: ni versión
      nueva ni auditoría.
    - Si cambió, la versión sube y queda su fila en `VersionTextoProteccion`.
    - La versión exigida sigue la regla de la clave (ver el docstring).
      `pedir_de_nuevo` solo cuenta en el aviso general; si el texto no cambió
      y la versión vigente ya es la exigida, abre una versión nueva con el
      mismo texto para que todos vuelvan a aceptar (como hasta hoy).
    - El primer aviso de una empresa nace en la versión 1."""
    if not user_has_permission(actor, access.TEXTOS):
        raise PrivacidadError(
            "No tiene permiso para editar los textos de protección de datos.",
            code="permission_denied",
            status=403,
        )
    datos = entrada(clave)
    nuevo_texto, nuevo_titulo, motivo = _validar(datos, texto, titulo, motivo)
    empresa = _empresa()
    if empresa is None:
        raise _sin_empresa()
    pedir = bool(pedir_de_nuevo) and clave in SOLO_SI_SE_PIDE
    ahora = timezone.now()
    with transaction.atomic():
        actual = obtener(clave, empresa, bloquear=True)
        if actual is None:
            # Solo el aviso general llega aquí: la empresa no tenía. Con su
            # savepoint: si otra persona lo crea a la vez, la restricción
            # única salta y se responde 409 sin romper la transacción.
            try:
                with transaction.atomic():
                    actual = TextoProteccion.objects.create(
                        empresa=empresa,
                        clave=clave,
                        modulo=datos.modulo,
                        seccion=datos.seccion,
                        nombre=datos.nombre,
                        orden=cat.orden(clave),
                        requiere_aceptacion=datos.requiere_aceptacion,
                        titulo=nuevo_titulo,
                        texto=nuevo_texto,
                        version=1,
                        version_exigida=1,
                        editado_en=ahora,
                        editado_por=actor,
                    )
            except IntegrityError as error:
                raise PrivacidadError(
                    "Otra persona creó este texto a la vez. Recargue la página e inténtelo de "
                    "nuevo.",
                    code="conflicto",
                    status=409,
                ) from error
            _nueva_fila_de_version(actual, actor=actor, motivo=motivo, ahora=ahora)
            accion, previo = "texto.creado", None
        else:
            cambio = nuevo_texto != actual.texto or nuevo_titulo != actual.titulo
            # «Pedir aceptarlo de nuevo» sin cambiar el texto abre siempre una
            # versión nueva con el mismo texto (QA-FUNC O-5, 11/11/2026): es lo
            # que dice la pantalla y deja en el historial cuándo se pidió.
            reabrir = pedir and not cambio
            if not cambio and not pedir:
                return actual
            previo = _foto(actual)
            actual.texto, actual.titulo = nuevo_texto, nuevo_titulo
            if cambio or reabrir:
                actual.version += 1
            if clave not in SOLO_SI_SE_PIDE or pedir or not actual.requiere_aceptacion:
                actual.version_exigida = actual.version
            actual.editado_en, actual.editado_por = ahora, actor
            actual.save()
            if cambio or reabrir:
                _nueva_fila_de_version(actual, actor=actor, motivo=motivo, ahora=ahora)
            accion = "texto.aceptacion_pedida" if pedir else "texto.editado"
        # Dentro de la transacción: el cambio y su rastro se guardan juntos.
        nuevo = {**_foto(actual), "motivo": motivo}
        _audit(actor, accion, actual, previo=previo, nuevo=nuevo, context=context)
    _olvidar_memo()
    return obtener(clave, empresa)


def nueva_version(clave: str, *, motivo: str, actor=None, context=None) -> TextoProteccion | None:
    """Abre una versión nueva con el mismo texto, que todos deben aceptar.
    La usa el acuerdo de confidencialidad cuando cambian los documentos (la
    regla de antes de US-004: cualquier documento publicado o reemplazado
    pide aceptarlo de nuevo). `None` si no hay empresa."""
    empresa = _empresa()
    if empresa is None:
        return None
    ahora = timezone.now()
    with transaction.atomic():
        actual = obtener(clave, empresa, bloquear=True)
        if actual is None:
            return None
        previo = _foto(actual)
        actual.version += 1
        actual.version_exigida = actual.version
        actual.save(update_fields=["version", "version_exigida", "updated_at"])
        _nueva_fila_de_version(actual, actor=actor, motivo=motivo[:MOTIVO_MAX], ahora=ahora)
        _audit(
            actor,
            "texto.nueva_version",
            actual,
            previo={"version": previo["version"], "version_exigida": previo["version_exigida"]},
            nuevo={"clave": clave, "version": actual.version, "motivo": motivo},
            context=context,
        )
    _olvidar_memo()
    return actual


# ── Aceptaciones ──────────────────────────────────────────────────────────────


def _sin_efecto():
    return {"retirada_en__isnull": True, "restablecida_en__isnull": True}


def validas(texto: TextoProteccion):
    """Las aceptaciones que hoy valen para el texto: sin retirar ni
    restablecer y de una versión igual o posterior a la exigida. Las de
    versión desconocida (Nexo, el correo migrado) no valen: no se sabe qué
    texto se aceptó."""
    return AceptacionTexto.objects.todas().filter(
        texto_proteccion=texto, version__gte=texto.version_exigida, **_sin_efecto()
    )


def valida_de(usuario, clave: str, empresa=None) -> AceptacionTexto | None:
    """La aceptación más reciente de la persona que hoy vale, o `None`."""
    texto = obtener(clave, empresa, crear=False)
    if texto is None:
        return None
    return validas(texto).filter(usuario=usuario).order_by("-aceptado_en", "-id").first()


def acepto_vigente(usuario, clave: str, empresa=None) -> bool:
    """Si la persona tiene aceptado lo que hoy se exige del texto. Sin aviso
    general en la empresa (o sin empresa) no se le exige nada: verdadero."""
    entrada(clave)
    if _empresa(empresa) is None:
        return True
    texto = obtener(clave, empresa, crear=False)
    if texto is None:
        return clave in NO_SE_SIEMBRAN
    return validas(texto).filter(usuario=usuario).exists()


def ultima_de(usuario, clave: str, empresa=None) -> AceptacionTexto | None:
    """La aceptación más reciente de la persona, valga o no."""
    texto = obtener(clave, empresa, crear=False)
    if texto is None:
        return None
    return (
        AceptacionTexto.objects.todas()
        .filter(texto_proteccion=texto, usuario=usuario)
        .order_by("-aceptado_en", "-id")
        .first()
    )


def aceptar(
    usuario,
    clave: str,
    *,
    ip=None,
    navegador: str = "",
    origen: str = Origen.INTRANET,
    referencia: str = "",
    version: int | None = None,
    empresa=None,
) -> tuple[AceptacionTexto, bool]:
    """Registra que la persona acepta el texto vigente de la clave. Devuelve
    `(aceptacion, creada)`.

    - `version`: la que leyó la persona. Si entretanto cambió, 409
      (`texto_cambiado`, con la vigente en `details.version`).
    - Con `referencia` (cada consulta del rol de pagos) es idempotente por
      referencia: la misma no se registra dos veces.
    - Sin referencia, si ya tiene una aceptación que hoy vale, devuelve esa
      (doble clic, o volver a guardar con el mismo texto).
    - Guarda el texto y el título exactos, la IP y el navegador."""
    empresa = _empresa(empresa)
    if empresa is None:
        raise _sin_empresa()
    with transaction.atomic():
        texto = obtener(clave, empresa, bloquear=True)
        if texto is None:
            raise PrivacidadError("No hay un texto que aceptar.", code="sin_texto", status=409)
        if version is not None and int(version) != texto.version:
            raise PrivacidadError(
                "El texto cambió mientras lo leía. Lea la versión nueva y acéptela.",
                code="texto_cambiado",
                status=409,
                details={"version": texto.version},
            )
        aceptaciones = AceptacionTexto.objects.todas().filter(texto_proteccion=texto)
        if referencia:
            existente = aceptaciones.filter(referencia=referencia).first()
        else:
            existente = (
                validas(texto).filter(usuario=usuario).order_by("-aceptado_en", "-id").first()
            )
        if existente is not None:
            return existente, False
        aceptacion = AceptacionTexto.objects.create(
            empresa=empresa,
            texto_proteccion=texto,
            usuario=usuario,
            version=texto.version,
            texto_aceptado=texto.texto,
            titulo_aceptado=texto.titulo,
            aceptado_en=timezone.now(),
            ip=ip or None,
            navegador=(navegador or "")[:NAVEGADOR_MAX],
            origen=origen,
            referencia=referencia,
        )
    return aceptacion, True


TEXTO_CAMBIADO = "El texto cambió mientras lo leía. Léalo de nuevo y acéptelo."


def aceptar_en_campo(
    usuario, clave: str, *, campo: str = "acepto", mensaje: str = TEXTO_CAMBIADO, **opciones
) -> tuple[AceptacionTexto, bool]:
    """`aceptar` para los flujos de otros módulos (QA-TECH, 11/11/2026): si la
    versión que leyó la persona ya no es la vigente, 400 de validación junto
    al campo de la casilla (`acepto`, `acepta_telefono`…), que es donde la
    pantalla muestra el error. Lo demás, como `aceptar`."""
    from rest_framework.exceptions import ValidationError

    try:
        return aceptar(usuario, clave, **opciones)
    except PrivacidadError as error:
        if error.code == "texto_cambiado":
            raise ValidationError({campo: [mensaje]}) from error
        raise


def autorizacion(usuario, clave: str) -> dict:
    """El texto vigente (memorizado en la petición) y lo que la persona tiene
    aceptado, con una sola consulta a sus aceptaciones: su última sin retirar
    vale si es de la versión exigida (siempre se acepta la vigente, así que
    una posterior nunca es de una versión menor)."""
    texto = obtener_memo(clave)
    if texto is None:
        inicial = vigente_o_inicial(clave)
        return {**inicial, "aceptado": False, "aceptado_en": None, "version_aceptada": None}
    ultima = (
        AceptacionTexto.objects.todas()
        .filter(texto_proteccion=texto, usuario=usuario, **_sin_efecto())
        .order_by("-aceptado_en", "-id")
        .only("version", "aceptado_en")
        .first()
    )
    return {
        "clave": clave,
        "version": texto.version,
        "texto": con_variables(clave, texto.texto),
        "titulo": texto.titulo,
        "aceptado": bool(
            ultima and ultima.version is not None and ultima.version >= texto.version_exigida
        ),
        "aceptado_en": ultima.aceptado_en if ultima else None,
        "version_aceptada": ultima.version if ultima else None,
    }


def retirar(usuario, clave: str, *, actor=None, empresa=None) -> int:
    """Retira la autorización de la persona (teléfono, cumpleaños,
    aniversario, correo): marca sus aceptaciones vigentes con la fecha de
    retiro, sin borrarlas. Devuelve cuántas marcó."""
    texto = obtener(clave, empresa, crear=False)
    if texto is None:
        return 0
    return (
        AceptacionTexto.objects.todas()
        .filter(texto_proteccion=texto, usuario=usuario, **_sin_efecto())
        .update(retirada_en=timezone.now(), retirada_por=actor or usuario)
    )


def restablecer(clave: str, *, actor, usuario=None, empresa=None) -> int:
    """La administración deja sin efecto las aceptaciones vigentes (de una
    persona, o de todas si `usuario` es `None`): las vuelven a aceptar. Las
    marca `restablecida_en`, sin borrarlas. Las importadas de Nexo no se
    tocan: no valían para el texto vigente (ver `validas`)."""
    texto = obtener(clave, empresa, crear=False)
    if texto is None:
        return 0
    filas = (
        AceptacionTexto.objects.todas()
        .filter(texto_proteccion=texto, **_sin_efecto())
        .exclude(origen=Origen.NEXO)
    )
    if usuario is not None:
        filas = filas.filter(usuario=usuario)
    return filas.update(restablecida_en=timezone.now(), restablecida_por=actor)


# ── Listado de aceptaciones ───────────────────────────────────────────────────


def estado_de(aceptacion: AceptacionTexto) -> str:
    if aceptacion.retirada_en is not None:
        return RETIRADA
    if aceptacion.restablecida_en is not None:
        return RESTABLECIDA
    return VIGENTE


def aceptaciones(
    *, clave: str = "", modulo: str = "", seccion: str = "", persona: str = "", estado: str = ""
):
    """Las aceptaciones de la empresa activa, de la más reciente a la más
    vieja, con los filtros del listado y del Excel. `estado` filtra por el
    mismo `estado` que devuelve cada fila (`estado_de`, 11/11/2026):

    - «vigente»: sin retirar ni restablecer.
    - «retirada»: la retiró su titular (teléfono, cumpleaños, aniversario,
      correo). Gana sobre «restablecida» si tuviera las dos marcas.
    - «restablecida»: la administración la dejó sin efecto (aviso general)
      y no está retirada."""
    from apps.core.busqueda import condicion_de_busqueda

    consulta = AceptacionTexto.objects.select_related(
        "texto_proteccion", "usuario", "retirada_por", "restablecida_por"
    )
    if clave:
        consulta = consulta.filter(texto_proteccion__clave=clave)
    if modulo:
        consulta = consulta.filter(texto_proteccion__modulo=modulo)
    if seccion:
        consulta = consulta.filter(texto_proteccion__seccion=seccion)
    if estado == VIGENTE:
        consulta = consulta.filter(**_sin_efecto())
    elif estado == RETIRADA:
        consulta = consulta.filter(retirada_en__isnull=False)
    elif estado == RESTABLECIDA:
        consulta = consulta.filter(retirada_en__isnull=True, restablecida_en__isnull=False)
    condicion = condicion_de_busqueda(
        persona,
        ("usuario__first_name", "usuario__last_name", "usuario__username", "usuario__email"),
    )
    if condicion is not None:
        consulta = consulta.filter(condicion)
    return consulta.order_by("-aceptado_en", "-id")


def _momento(valor):
    return timezone.localtime(valor).isoformat() if valor is not None else None


def de_aceptacion(aceptacion: AceptacionTexto, *, con_texto: bool = False) -> dict:
    """Una fila del listado de aceptaciones (con `con_texto`, el detalle)."""
    texto = aceptacion.texto_proteccion
    estado = estado_de(aceptacion)
    datos = {
        "id": aceptacion.pk,
        "persona": {
            "id": aceptacion.usuario_id,
            "nombre": nombre(aceptacion.usuario),
            "usuario": aceptacion.usuario.username,
        },
        "clave": texto.clave,
        "nombre_texto": texto.nombre,
        "modulo": texto.modulo,
        "seccion": texto.seccion,
        "version": aceptacion.version,
        "aceptado_en": _momento(aceptacion.aceptado_en),
        "ip": aceptacion.ip,
        "navegador": aceptacion.navegador,
        "origen": aceptacion.origen,
        "origen_label": aceptacion.get_origen_display(),
        "migrada": aceptacion.origen == Origen.MIGRADA,
        "estado": estado,
        "vigente": estado == VIGENTE,
        # Si además es de una versión que hoy se exige (una vigente de una
        # versión anterior ya no basta para el flujo que la pide).
        "de_la_version_exigida": (
            estado == VIGENTE
            and aceptacion.version is not None
            and aceptacion.version >= texto.version_exigida
        ),
        "retirada_en": _momento(aceptacion.retirada_en),
        "retirada_por": _editor(aceptacion.retirada_por),
        "restablecida_en": _momento(aceptacion.restablecida_en),
        "restablecida_por": _editor(aceptacion.restablecida_por),
    }
    if con_texto:
        datos["titulo"] = aceptacion.titulo_aceptado
        datos["texto"] = aceptacion.texto_aceptado
        # Si no se registró el texto exacto (migradas que solo guardaban la
        # fecha), el de su versión según el historial, marcado como tal.
        datos["texto_de_la_version"] = None
        if not aceptacion.texto_aceptado and aceptacion.version is not None:
            version = (
                VersionTextoProteccion.objects.filter(
                    texto_proteccion=texto, version=aceptacion.version
                )
                .only("titulo", "texto")
                .first()
            )
            if version is not None:
                datos["texto_de_la_version"] = {"titulo": version.titulo, "texto": version.texto}
    return datos


def obtener_aceptacion(pk) -> AceptacionTexto:
    """Una aceptación de la empresa activa; la de otra empresa, 404."""
    aceptacion = (
        AceptacionTexto.objects.select_related(
            "texto_proteccion", "usuario", "retirada_por", "restablecida_por"
        )
        .filter(pk=pk)
        .first()
    )
    if aceptacion is None:
        raise PrivacidadError("Aceptación no encontrada.", code="not_found", status=404)
    return aceptacion


ESTADOS_LABEL = {VIGENTE: "Vigente", RETIRADA: "Retirada", RESTABLECIDA: "Restablecida"}

COLUMNAS_EXCEL = (
    ("Módulo", 30),
    ("Sección", 24),
    ("Texto", 36),
    ("Persona", 32),
    ("Usuario", 20),
    ("Versión", 9),
    ("Aceptado el", 18),
    ("IP", 16),
    ("Navegador", 40),
    ("Origen", 20),
    ("Estado", 14),
    ("Retirada o restablecida el", 22),
)


#: Más filas que esto no caben con holgura en memoria ni sirven en una hoja:
#: se pide filtrar (QA-TECH, 11/11/2026).
TOPE_EXCEL = 100_000
#: Filas por lectura. Menos de 2100 (el tope de parámetros de SQL Server)
#: porque cada lote se pide por su lista de ids.
LOTE_EXCEL = 1000


def _por_lotes(ids):
    """Las aceptaciones de `ids`, en ese orden, leídas de a `LOTE_EXCEL`. En
    mssql `iterator()` trae todo el resultado de una vez; así no."""
    relacionadas = ("texto_proteccion", "usuario")
    for inicio in range(0, len(ids), LOTE_EXCEL):
        lote = ids[inicio : inicio + LOTE_EXCEL]
        filas = {
            a.pk: a
            for a in AceptacionTexto.objects.todas()
            .select_related(*relacionadas)
            .filter(pk__in=lote)
        }
        for pk in lote:
            if pk in filas:
                yield filas[pk]


def a_excel(consulta) -> bytes:
    """Las aceptaciones en un Excel (openpyxl en modo de solo escritura, que
    no guarda la hoja entera en memoria), con los textos neutralizados para
    que ninguno se abra como fórmula. Más de `TOPE_EXCEL` filas: 400
    `demasiadas_filas`, sin armar nada."""
    from io import BytesIO

    from openpyxl import Workbook
    from openpyxl.cell import WriteOnlyCell
    from openpyxl.styles import Font
    from openpyxl.utils import get_column_letter

    from apps.core.hojas_de_calculo import neutralizar_fila

    ids = list(consulta.values_list("pk", flat=True)[: TOPE_EXCEL + 1])
    if len(ids) > TOPE_EXCEL:
        raise PrivacidadError(
            f"Hay más de {TOPE_EXCEL:_} aceptaciones con estos filtros. Filtre por texto, ".replace(
                "_", "."
            )
            + "módulo, persona o estado para exportar menos.",
            code="demasiadas_filas",
            status=400,
            details={"tope": TOPE_EXCEL},
        )

    def fecha(valor):
        return timezone.localtime(valor).strftime("%d/%m/%Y %H:%M") if valor else ""

    libro = Workbook(write_only=True)
    hoja = libro.create_sheet("Aceptaciones")
    for indice, (_, ancho) in enumerate(COLUMNAS_EXCEL, start=1):
        hoja.column_dimensions[get_column_letter(indice)].width = ancho
    hoja.freeze_panes = "A2"
    negrita = Font(bold=True)
    encabezado = []
    for titulo, _ in COLUMNAS_EXCEL:
        celda = WriteOnlyCell(hoja, value=titulo)
        celda.font = negrita
        encabezado.append(celda)
    hoja.append(encabezado)
    for a in _por_lotes(ids):
        texto = a.texto_proteccion
        estado = estado_de(a)
        hoja.append(
            neutralizar_fila(
                [
                    texto.modulo,
                    texto.seccion,
                    texto.nombre,
                    nombre(a.usuario),
                    a.usuario.username,
                    a.version if a.version is not None else "",
                    fecha(a.aceptado_en),
                    a.ip or "",
                    a.navegador,
                    a.get_origen_display(),
                    ESTADOS_LABEL[estado],
                    fecha(a.retirada_en or a.restablecida_en),
                ]
            )
        )
    salida = BytesIO()
    libro.save(salida)
    return salida.getvalue()
