"""«Mi perfil»: cómo se arman el nombre, el correo, el teléfono, el área, la
agencia y el cargo de una persona, y qué le falta completar.

Lo usa la Mesa de ayuda para cargar por defecto los datos de quien pide un
ticket (decidido el 20/10/2026). El orden de las fuentes:

- **Nombre y correo**: los de su cuenta.
- **Teléfono y área**: los de «Mi perfil» y, si no los puso, los de su ficha
  de empleado.
- **Agencia**: la de «Mi perfil» (la ficha de empleado no la guarda).
- **Cargo**: el de «Mi perfil», del catálogo del organigrama. La persona lo
  elige **una sola vez**; después lo cambia solo TI o la administración
  (Estructura → Asignación de cargos), no ella desde «Mi perfil».

Desde el 20/10/2026 los siete datos de `OBLIGATORIOS` son obligatorios para
usar el sistema: mientras falte alguno, al entrar se bloquea con una ventana
que los pide (frontend `AvisoPerfil`). El correo debe ser institucional y no
lo cambia la persona: lo corrige la administración.

**Dos teléfonos: el corporativo y el personal** (10/11/2026).

- **Teléfono corporativo**: la persona responde «¿Tiene teléfono corporativo
  asignado?». La respuesta es obligatoria para usar el sistema (está en
  `OBLIGATORIOS`): quien no respondió la ve al entrar. Si responde que sí, el
  número es obligatorio; si responde que no, se borra. No es dato personal: no
  pide autorización y se muestra a las demás personas de la empresa siempre
  que lo tenga. La Mesa de ayuda lo usa como teléfono por defecto.
- **Uno u otro** (11/11/2026): con «sí» se pide solo el corporativo y el
  personal no se guarda; con «no», solo el personal, opcional. La autorización
  de datos personales aparece únicamente en ese segundo caso.
- **Teléfono personal** (`telefono`): es opcional y pide autorización (desde
  el 26/10/2026, Ley Orgánica de Protección de Datos Personales). Si la
  persona lo escribe, antes de guardar marca que autoriza a la empresa a
  guardar su número de contacto y a que otras personas de la empresa lo usen
  para contactarla. El texto es parametrizable (`textos_legales.py`); se
  guarda cuándo, desde qué IP, el texto exacto y su versión. Si el texto
  cambia, lo vuelve a aceptar la próxima vez que guarde su teléfono. Los
  teléfonos guardados antes del 10/11/2026 quedan como personales.
"""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

from . import perfiles_cargo, textos_legales
from .models import Cargo, DatosDeContacto, Departamento, Sede
from .organigrama import linea_de_supervision, nombre_con_unidad

#: Lo que toda persona debe tener completo para usar el sistema.
#: El teléfono personal no está: es opcional desde el 26/10/2026. El
#: corporativo sí (10/11/2026): responder si lo tiene y, si lo tiene, el número.
OBLIGATORIOS = (
    "nombres",
    "apellidos",
    "correo",
    "area",
    "agencia",
    "cargo",
    "telefono_corporativo",
)

#: Los dominios del correo institucional.
DOMINIOS_INSTITUCIONALES = ("grupolaar.com",)

ETIQUETAS = {
    "nombre": "Nombre y apellido",
    "nombres": "Nombres",
    "apellidos": "Apellidos",
    "correo": "Correo institucional",
    "telefono": "Teléfono personal",
    # Lo que falta es la respuesta, y «No» vale: con «Teléfono corporativo»
    # quien no tiene uno creía que debía conseguir un número (11/11/2026).
    "telefono_corporativo": "¿Tiene teléfono o línea corporativa?",
    "area": "Área",
    "agencia": "Agencia",
    "cargo": "Cargo",
}


TELEFONO = "autorizacion_telefono"
SIN_AUTORIZACION = (
    "Para guardar su teléfono, marque que autoriza a la empresa a guardarlo y a que "
    "otras personas de la empresa lo usen para contactarlo."
)

SIN_TELEFONO_CORPORATIVO = "Escriba su teléfono corporativo."

#: Para quien llama a `guardar` sin la respuesta del teléfono corporativo: se
#: conserva lo que ya estaba guardado (ni se borra ni se da por respondido).
SIN_CAMBIOS = object()

CARGO_FIJO = (
    "Su cargo ya está elegido y no puede cambiarlo usted. "
    "Si no es el correcto, pídale a TI o a la administración del sistema que lo cambie."
)


def es_institucional(correo: str) -> bool:
    correo = (correo or "").strip().lower()
    return any(correo.endswith(f"@{dominio}") for dominio in DOMINIOS_INSTITUCIONALES)


def _propios(usuario):
    return (
        DatosDeContacto.objects.filter(usuario=usuario)
        .select_related("departamento", "sede", "cargo__unidad")
        .first()
    )


def _empleado(usuario):
    empleado = getattr(usuario, "empleado", None)
    if empleado is None or not empleado.activo:
        return None
    actual = empresa_actual()
    if actual not in (None, SIN_EMPRESA) and empleado.empresa_id != actual.id:
        return None
    return empleado


def de(usuario) -> dict:
    """Los datos de contacto de la persona en la empresa activa, con lo que
    falta (`faltan`)."""
    propios = _propios(usuario)
    empleado = _empleado(usuario)
    area = (propios.departamento if propios and propios.departamento_id else None) or (
        empleado.departamento if empleado else None
    )
    sede = propios.sede if propios and propios.sede_id else None
    cargo = propios.cargo if propios and propios.cargo_id else None
    datos = {
        "nombre": usuario.get_full_name().strip(),
        "nombres": usuario.first_name,
        "apellidos": usuario.last_name,
        "correo": usuario.email,
        "codigo_empleado": usuario.codigo_empleado or "",
        "telefono": (propios.telefono if propios and propios.telefono else "")
        or (empleado.telefono if empleado else ""),
        "area": {"id": area.id, "nombre": area.nombre} if area else None,
        "agencia": {"id": sede.id, "nombre": sede.nombre} if sede else None,
        "cargo": {"id": cargo.id, "nombre": nombre_con_unidad(cargo)} if cargo else None,
        "tiene_telefono_corporativo": propios.tiene_telefono_corporativo if propios else None,
        "telefono_corporativo": (propios.telefono_corporativo if propios else "") or "",
        "en_nomina": empleado is not None,
        "telefono_autorizacion": _autorizacion_telefono(propios),
        "cumpleanos": cumpleanos(usuario),
        "aniversario": aniversario(usuario),
        # Lo que se espera de su cargo (perfiles_cargo.py).
        "cargo_perfil": perfiles_cargo.de(cargo) if cargo else None,
        # Sus jefes y a quiénes supervisa, según el organigrama.
        "supervision": linea_de_supervision(usuario, cargo) if cargo else None,
    }
    datos["correo_institucional"] = es_institucional(usuario.email)
    presentes = {
        **datos,
        "nombres": (usuario.first_name or "").strip(),
        "apellidos": (usuario.last_name or "").strip(),
        "correo": datos["correo_institucional"],
        # Respondió que no tiene, o que sí y escribió el número.
        "telefono_corporativo": datos["tiene_telefono_corporativo"] is False
        or bool(datos["tiene_telefono_corporativo"] and datos["telefono_corporativo"]),
    }
    datos["faltan"] = [clave for clave in OBLIGATORIOS if not presentes[clave]]
    return datos


def para_compartir(usuario) -> dict:
    """Lo que otra persona de la empresa ve de alguien para contactarlo
    (26/10/2026, desde el chat): su correo, solo si es institucional; su
    teléfono corporativo, siempre que lo tenga (10/11/2026: no es dato
    personal), y su teléfono personal, solo si lo cargó en «Mi perfil» y
    autorizó que la contacten por él. El teléfono de la ficha de nómina no se
    muestra: no tiene esa autorización. Lo que no hay viene vacío y no se
    dibuja."""
    propios = _propios(usuario)
    autorizado = bool(propios and propios.telefono and propios.telefono_aceptado_en)
    cargo = propios.cargo if propios and propios.cargo_id else None
    area = propios.departamento if propios and propios.departamento_id else None
    return {
        "id": usuario.id,
        "nombre": usuario.get_full_name().strip() or usuario.username,
        "correo": usuario.email if es_institucional(usuario.email) else "",
        "telefono": propios.telefono if autorizado else "",
        "telefono_corporativo": (
            propios.telefono_corporativo if propios and propios.tiene_telefono_corporativo else ""
        ),
        "cargo": cargo.nombre if cargo else "",
        "area": area.nombre if area else "",
    }


def _autorizacion_telefono(propios) -> dict:
    """El texto vigente y si la persona aceptó esa versión. Si aceptó una
    anterior, `aceptado` es falso y lo vuelve a aceptar al guardar."""
    vigente = textos_legales.actual(TELEFONO)
    aceptada = propios.telefono_aceptado_version if propios else None
    return {
        "texto": vigente.texto,
        "version": vigente.version,
        "aceptado": bool(propios and propios.telefono_aceptado_en and aceptada == vigente.version),
        "aceptado_en": propios.telefono_aceptado_en if propios else None,
        "version_aceptada": aceptada,
    }


def opciones() -> dict:
    """Las áreas, agencias y cargos de la empresa activa, para elegir."""
    return {
        "areas": [
            {"id": d.id, "nombre": d.nombre}
            for d in Departamento.objects.filter(activo=True).order_by("nombre")
        ],
        "agencias": [
            {"id": s.id, "nombre": s.nombre, "ciudad": s.ciudad}
            for s in Sede.objects.filter(activa=True).order_by("nombre")
        ],
        # Con su unidad: el mismo nombre se repite entre unidades.
        "cargos": [
            {"id": c.id, "nombre": nombre_con_unidad(c)}
            for c in Cargo.objects.filter(activo=True)
            .select_related("unidad")
            .order_by("unidad__nombre", "nombre")
        ],
    }


def guardar(
    usuario,
    *,
    nombres,
    apellidos,
    telefono,
    departamento,
    sede,
    cargo=None,
    acepta_telefono=False,
    ip=None,
    tiene_telefono_corporativo=SIN_CAMBIOS,
    telefono_corporativo="",
) -> dict:
    """Actualiza su nombre (en la cuenta) y sus teléfonos, área, agencia y
    cargo (en «Mi perfil»).

    - El teléfono personal (`telefono`) es opcional; si lo escribe, solo se
      guarda con su autorización (`acepta_telefono`): la primera vez se guarda
      cuándo, desde qué `ip` y qué texto aceptó. Dejarlo vacío lo borra (la
      constancia de la autorización se conserva).
    - El corporativo (10/11/2026): con `tiene_telefono_corporativo=True` el
      número es obligatorio; con `False` se borra. Nunca pide autorización.
      Sin el argumento (`SIN_CAMBIOS`) o con `None` se conserva lo guardado:
      quien llama sin la respuesta no la da por contestada.
    - Uno u otro (11/11/2026): con `True` no se guarda el personal, aunque
      llegue; solo quien no tiene corporativo da un número personal."""
    with transaction.atomic():
        usuario.first_name = nombres.strip()[:150]
        usuario.last_name = apellidos.strip()[:150]
        usuario.save(update_fields=["first_name", "last_name", "updated_at"])
        propios = _propios(usuario) or DatosDeContacto(usuario=usuario)
        # El cargo se elige una sola vez: si ya tiene uno, no lo cambia ella.
        if propios.cargo_id and getattr(cargo, "pk", None) != propios.cargo_id:
            raise ValidationError({"cargo": [CARGO_FIJO]})
        telefono = (telefono or "").strip()[:30]
        if tiene_telefono_corporativo is True:
            telefono = ""
        if telefono:
            if not acepta_telefono:
                raise ValidationError({"acepta_telefono": [SIN_AUTORIZACION]})
            vigente = textos_legales.actual(TELEFONO)
            # Una constancia por versión del texto: si ya aceptó la vigente, se
            # conserva la original; si cambió, se registra la nueva.
            if (
                propios.telefono_aceptado_version != vigente.version
                or not propios.telefono_aceptado_en
            ):
                propios.telefono_aceptado_en = timezone.now()
                propios.telefono_aceptado_ip = ip
                propios.telefono_aceptado_texto = vigente.texto
                propios.telefono_aceptado_version = vigente.version
        propios.telefono = telefono
        if tiene_telefono_corporativo is not SIN_CAMBIOS and tiene_telefono_corporativo is not None:
            corporativo = (telefono_corporativo or "").strip()[:30]
            if tiene_telefono_corporativo and not corporativo:
                raise ValidationError({"telefono_corporativo": [SIN_TELEFONO_CORPORATIVO]})
            propios.tiene_telefono_corporativo = bool(tiene_telefono_corporativo)
            propios.telefono_corporativo = corporativo if tiene_telefono_corporativo else ""
        propios.departamento = departamento
        propios.sede = sede
        propios.cargo = cargo
        propios.save()
        from .roles_de_cargo import sincronizar

        sincronizar(propios.empresa, [usuario])
    return de(usuario)


def cumpleanos(usuario) -> dict:
    """Si muestra su cumpleaños en el calendario, cuál es y desde cuándo lo
    aceptó."""
    propios = _propios(usuario)
    if propios is None or not propios.mostrar_cumpleanos:
        return {"mostrar": False, "dia": None, "mes": None, "aceptado_en": None}
    return {
        "mostrar": True,
        "dia": propios.cumpleanos_dia,
        "mes": propios.cumpleanos_mes,
        "aceptado_en": propios.cumpleanos_aceptado_en,
    }


def guardar_cumpleanos(usuario, *, mostrar, dia=None, mes=None) -> dict:
    """Publica su cumpleaños (día y mes) o lo retira. Retirarlo borra la
    fecha: no se guarda lo que no se muestra."""
    from django.utils import timezone

    with transaction.atomic():
        propios = _propios(usuario) or DatosDeContacto(usuario=usuario)
        if mostrar:
            propios.mostrar_cumpleanos = True
            propios.cumpleanos_dia = dia
            propios.cumpleanos_mes = mes
            propios.cumpleanos_aceptado_en = timezone.now()
        else:
            propios.mostrar_cumpleanos = False
            propios.cumpleanos_dia = None
            propios.cumpleanos_mes = None
            propios.cumpleanos_aceptado_en = None
        propios.save()
    return cumpleanos(usuario)


def aniversario(usuario) -> dict:
    """Si muestra su aniversario en la empresa en el calendario, cuándo
    ingresó y desde cuándo lo aceptó."""
    propios = _propios(usuario)
    if propios is None or not propios.mostrar_aniversario:
        return {"mostrar": False, "dia": None, "mes": None, "anio": None, "aceptado_en": None}
    return {
        "mostrar": True,
        "dia": propios.aniversario_dia,
        "mes": propios.aniversario_mes,
        "anio": propios.aniversario_anio,
        "aceptado_en": propios.aniversario_aceptado_en,
    }


def guardar_aniversario(usuario, *, mostrar, dia=None, mes=None, anio=None) -> dict:
    """Publica su aniversario (día y mes de ingreso, y el año si lo da) o lo
    retira. Retirarlo borra la fecha."""
    from django.utils import timezone

    with transaction.atomic():
        propios = _propios(usuario) or DatosDeContacto(usuario=usuario)
        propios.mostrar_aniversario = bool(mostrar)
        propios.aniversario_dia = dia if mostrar else None
        propios.aniversario_mes = mes if mostrar else None
        propios.aniversario_anio = anio if mostrar else None
        propios.aniversario_aceptado_en = timezone.now() if mostrar else None
        propios.save()
    return aniversario(usuario)
