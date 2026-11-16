"""Perfiles de las personas desde nómina (US-021, 16/11/2026).

Lee el procedimiento `NOMINA_EMPLEADOS_PROCEDIMIENTO` (en producción,
`dbo.sp_ObtenerEmpleadosActivos` de `base_courier`) por la conexión de solo
lectura `EXTERNAL_DB_*` y lo vuelca en las cuentas de la intranet:

- **Emparejar:** por cédula; si no, por correo; si no, por código de empleado;
  si no, por nombre, solo cuando la cuenta (sin código ni cédula) y el
  empleado se señalan el uno al otro y a nadie más. Un dato vacío no empareja.
- **Correo:** solo el corporativo (`DOMINIOS_INSTITUCIONALES`). El personal
  (p. ej. @gmail.com) se descarta y no se guarda: es un dato personal con su
  propio tratamiento (decisión del usuario, 16/11/2026).
- **Manda nómina:** nombres, apellidos, código, cédula y correo (este solo si
  nómina lo trae). Cada cambio queda en la auditoría; la cédula, enmascarada.
  Si otra cuenta ya tiene ese código, cédula o correo, no se pisa: conflicto.
- **Sin cuenta:** se crea una inactiva, sin rol, sin contraseña utilizable y
  con cambio obligatorio. Sin correo, recibe `usuario@sin-correo.invalid`
  (TLD reservado, RFC 2606), que el envío de correos descarta
  (`apps.core.correo_backend`).
- **Fuera de nómina:** las cuentas activas que no están en la lista solo se
  reportan; nunca se desactivan.

Si la base no responde, la corrida queda «fallida» y no se cambia nada.
"""

import logging
import re
import unicodedata
from dataclasses import dataclass

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.audit import record_audit_event

logger = logging.getLogger(__name__)

#: El dominio de los correos que no existen (nómina no trae el correo).
DOMINIO_SIN_CORREO = "sin-correo.invalid"

_NOMBRE_PROCEDIMIENTO = re.compile(
    r"^(\[?[A-Za-z_][A-Za-z0-9_]*\]?\.)?\[?[A-Za-z_][A-Za-z0-9_]*\]?$"
)

#: Cómo puede llamarse cada columna en el procedimiento (sin distinguir
#: mayúsculas): la cédula todavía no llega y su nombre no está fijado.
COLUMNAS = {
    "codigo": ("codigo_emp", "codigo_empleado", "codigo"),
    "nombre": ("nombre_completo", "nombre", "nombres_completos"),
    "correo": ("email_emp", "email", "correo", "correo_emp"),
    "cedula": ("cedula", "cedula_emp", "num_cedula", "numero_cedula", "identificacion", "ci"),
}

#: Palabras que se unen al apellido que sigue («DE LA TORRE»).
_PARTICULAS = {"de", "del", "la", "las", "los", "y", "san", "da", "di", "van", "von"}
#: Las que van en minúscula dentro del nombre («Del Pozo de la Cruz»); «San»
#: y las demás, con mayúscula («San Martín»).
_MINUSCULAS = {"de", "del", "la", "las", "los", "y"}


class NominaNoDisponible(Exception):
    """La sincronización no está configurada o la base no respondió."""


@dataclass(frozen=True)
class Empleado:
    codigo: str
    nombres: str
    apellidos: str
    correo: str
    cedula: str


def configurada() -> bool:
    return bool(getattr(settings, "NOMINA_EMPLEADOS_PROCEDIMIENTO", ""))


# --- Leer nómina -------------------------------------------------------------------------


def _limpio(valor) -> str:
    return " ".join(str(valor or "").split())


def _titulo(texto: str) -> str:
    """«DE LA TORRE PEÑAFIEL» → «de la Torre Peñafiel» → con la partícula
    inicial en mayúscula: «De la Torre Peñafiel»."""
    palabras = []
    for i, palabra in enumerate(texto.lower().split()):
        minuscula = palabra in _MINUSCULAS and i
        palabras.append(palabra if minuscula else palabra.capitalize())
    return " ".join(palabras)


def separar_nombre(completo: str) -> tuple[str, str]:
    """`(nombres, apellidos)` de «APELLIDOS NOMBRES», el orden de nómina.

    Dos apellidos (con sus partículas: «DE LA TORRE» es uno) y el resto, los
    nombres. Con dos palabras, una y una; con una sola, va en los nombres."""
    palabras = _limpio(completo).split()
    if not palabras:
        return "", ""
    if len(palabras) == 1:
        return _titulo(palabras[0]), ""
    apellidos, i = [], 0
    while i < len(palabras) and len(apellidos) < 2 and len(palabras) - i > 1:
        grupo = [palabras[i]]
        while palabras[i].lower() in _PARTICULAS and i + 1 < len(palabras) - 1:
            i += 1
            grupo.append(palabras[i])
        apellidos.append(" ".join(grupo))
        i += 1
        if len(palabras) == 2:
            break
    nombres = palabras[i:]
    return _titulo(" ".join(nombres)), _titulo(" ".join(apellidos))


def _es_corporativo(correo: str) -> bool:
    from apps.organizacion.contacto import es_institucional

    return es_institucional(correo)


def _sin_tildes(texto: str) -> str:
    return unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()


def _palabras(*partes: str) -> set[str]:
    return {p for p in _sin_tildes(" ".join(partes)).split() if p not in _PARTICULAS}


def solo_digitos(valor) -> str:
    return re.sub(r"\D", "", str(valor or ""))


def _columna(fila: dict, clave: str):
    minusculas = {k.lower(): v for k, v in fila.items()}
    for nombre in COLUMNAS[clave]:
        if nombre in minusculas:
            return minusculas[nombre]
    return None


def a_empleado(fila: dict) -> Empleado | None:
    codigo = _limpio(_columna(fila, "codigo"))
    nombres, apellidos = separar_nombre(_columna(fila, "nombre") or "")
    if not codigo and not nombres:
        return None
    correo = _limpio(_columna(fila, "correo")).lower()
    if "@" not in correo or not _es_corporativo(correo):
        # El personal se descarta: no se guarda en la intranet.
        correo = ""
    return Empleado(
        codigo=codigo,
        nombres=nombres,
        apellidos=apellidos,
        correo=correo,
        cedula=solo_digitos(_columna(fila, "cedula"))[:20],
    )


def leer() -> list[Empleado]:
    """Los empleados activos de nómina. Levanta `NominaNoDisponible` si no hay
    procedimiento o la base no responde (el detalle va al registro)."""
    procedimiento = getattr(settings, "NOMINA_EMPLEADOS_PROCEDIMIENTO", "")
    if not procedimiento:
        raise NominaNoDisponible("La sincronización con nómina no está configurada.")
    if not _NOMBRE_PROCEDIMIENTO.match(procedimiento):
        logger.error("NOMINA_EMPLEADOS_PROCEDIMIENTO no es un nombre válido: %r", procedimiento)
        raise NominaNoDisponible("El procedimiento de nómina configurado no es válido.")
    from apps.cartera.services.db_source import _conectar

    try:
        conexion = _conectar()
    except Exception:  # noqa: BLE001 (el detalle queda en el registro)
        logger.exception("Nómina: no se pudo conectar a la base externa")
        raise NominaNoDisponible("No se pudo conectar con la base de nómina.") from None
    try:
        conexion.timeout = 60
        cursor = conexion.cursor()
        cursor.execute(f"EXEC {procedimiento}")
        columnas = [c[0] for c in cursor.description or []]
        filas = [dict(zip(columnas, fila, strict=False)) for fila in cursor.fetchall()]
    except Exception:  # noqa: BLE001
        logger.exception("Nómina: falló el procedimiento de empleados")
        raise NominaNoDisponible("El procedimiento de nómina devolvió un error.") from None
    finally:
        conexion.close()
    return [e for e in (a_empleado(f) for f in filas) if e is not None]


# --- Aplicar -----------------------------------------------------------------------------


def enmascarar_cedula(cedula: str | None) -> str:
    if not cedula:
        return ""
    return "•" * max(0, len(cedula) - 4) + cedula[-4:]


def correo_reservado(usuario: str) -> str:
    return f"{usuario}@{DOMINIO_SIN_CORREO}"


def es_correo_reservado(correo: str | None) -> bool:
    return bool(correo) and correo.lower().endswith("@" + DOMINIO_SIN_CORREO)


def _indices(User):
    cuentas = list(User.objects.all())
    por_cedula = {u.cedula: u for u in cuentas if u.cedula}
    por_correo = {
        u.email.lower(): u for u in cuentas if u.email and not es_correo_reservado(u.email)
    }
    por_codigo = {u.codigo_empleado.lower(): u for u in cuentas if u.codigo_empleado}
    return por_cedula, por_correo, por_codigo


def _coincide_por_nombre(cuenta, empleado: Empleado) -> bool:
    """Toda palabra del nombre de la cuenta está en el de nómina, incluidos su
    primer nombre y su primer apellido («Daniel Peñarreta» ⊂ «Peñarreta
    Feijoo Daniel Patricio»)."""
    nombres = _palabras(cuenta.first_name)
    apellidos = _palabras(cuenta.last_name)
    if not nombres or not apellidos:
        return False
    de_nomina = _palabras(empleado.nombres, empleado.apellidos)
    return (nombres | apellidos) <= de_nomina


def emparejar_por_nombre(lista: list[Empleado], cuentas) -> dict:
    """`{índice del empleado: cuenta}` solo para las parejas inequívocas: la
    cuenta (sin código ni cédula) coincide con un solo empleado y ese empleado
    con una sola cuenta. Lo ambiguo no se empareja (y no se crea nada: va al
    reporte, ver `sincronizar`)."""
    libres = [c for c in cuentas if not c.codigo_empleado and not c.cedula]
    por_empleado, por_cuenta = {}, {}
    for i, empleado in enumerate(lista):
        for cuenta in libres:
            if _coincide_por_nombre(cuenta, empleado):
                por_empleado.setdefault(i, []).append(cuenta)
                por_cuenta.setdefault(cuenta.pk, []).append(i)
    parejas, ambiguos = {}, set()
    for i, candidatas in por_empleado.items():
        if len(candidatas) == 1 and len(por_cuenta[candidatas[0].pk]) == 1:
            parejas[i] = candidatas[0]
        else:
            ambiguos.add(i)
    return {"parejas": parejas, "ambiguos": ambiguos}


def _buscar(empleado: Empleado, indices):
    por_cedula, por_correo, por_codigo = indices
    if empleado.cedula and empleado.cedula in por_cedula:
        return por_cedula[empleado.cedula]
    if empleado.correo and empleado.correo in por_correo:
        return por_correo[empleado.correo]
    if empleado.codigo and empleado.codigo.lower() in por_codigo:
        return por_codigo[empleado.codigo.lower()]
    return None


def _ocupado(User, campo, valor, propia_pk=None) -> bool:
    if not valor:
        return False
    consulta = User.objects.filter(**{f"{campo}__iexact": valor})
    if propia_pk:
        consulta = consulta.exclude(pk=propia_pk)
    return consulta.exists()


def _conflicto(empleado: Empleado, motivo: str) -> dict:
    nombre = f"{empleado.apellidos} {empleado.nombres}".strip()
    return {"codigo": empleado.codigo, "nombre": nombre, "motivo": motivo}


def _actualizar(cuenta, empleado: Empleado, ahora, actor) -> tuple[bool, list[str]]:
    """Pone en la cuenta lo que trae nómina. Devuelve `(cambió, conflictos)`."""
    from apps.users.models import User

    conflictos, antes, despues = [], {}, {}
    deseado = {"first_name": empleado.nombres, "last_name": empleado.apellidos}
    if empleado.codigo:
        if _ocupado(User, "codigo_empleado", empleado.codigo, cuenta.pk):
            conflictos.append(f"El código {empleado.codigo} ya lo tiene otra cuenta.")
        else:
            deseado["codigo_empleado"] = empleado.codigo
    if empleado.cedula:
        if _ocupado(User, "cedula", empleado.cedula, cuenta.pk):
            conflictos.append("La cédula ya la tiene otra cuenta.")
        else:
            deseado["cedula"] = empleado.cedula
    if empleado.correo:
        if _ocupado(User, "email", empleado.correo, cuenta.pk):
            conflictos.append(f"El correo {empleado.correo} ya lo tiene otra cuenta.")
        else:
            deseado["email"] = empleado.correo
    for campo, valor in deseado.items():
        if valor and (getattr(cuenta, campo) or "") != valor:
            antes[campo] = getattr(cuenta, campo) or ""
            despues[campo] = valor
            setattr(cuenta, campo, valor)
    cuenta.nomina_sincronizada_en = ahora
    if not despues:
        cuenta.save(update_fields=["nomina_sincronizada_en"])
        return False, conflictos
    cuenta.save(update_fields=[*despues.keys(), "nomina_sincronizada_en", "updated_at"])
    if "cedula" in antes:
        antes["cedula"] = enmascarar_cedula(antes["cedula"])
        despues["cedula"] = enmascarar_cedula(despues["cedula"])
    record_audit_event(
        actor=actor,
        action="usuarios.nomina.actualizado",
        target=cuenta,
        module="usuarios",
        previous_values=antes,
        new_values=despues,
    )
    return True, conflictos


def _crear(empleado: Empleado, ahora, actor):
    """Una cuenta inactiva para el empleado, o `(None, motivo)` si no se pudo."""
    from apps.users.models import User
    from apps.users.nomenclatura import generar_username

    if empleado.cedula and _ocupado(User, "cedula", empleado.cedula):
        return None, "La cédula ya la tiene otra cuenta."
    if empleado.codigo and _ocupado(User, "codigo_empleado", empleado.codigo):
        return None, f"El código {empleado.codigo} ya lo tiene otra cuenta."
    usuario = generar_username(empleado.nombres, empleado.apellidos)
    correo = empleado.correo or correo_reservado(usuario)
    if _ocupado(User, "email", correo):
        return None, f"El correo {correo} ya lo tiene otra cuenta."
    try:
        with transaction.atomic():
            cuenta = User(
                username=usuario,
                email=correo,
                first_name=empleado.nombres,
                last_name=empleado.apellidos,
                codigo_empleado=empleado.codigo or None,
                cedula=empleado.cedula or None,
                is_active=False,
                status=User.Status.DISABLED,
                must_change_password=True,
                nomina_sincronizada_en=ahora,
            )
            cuenta.set_unusable_password()
            cuenta.save()
    except IntegrityError:
        return None, "Otra cuenta ya tiene alguno de sus datos (usuario, correo, código o cédula)."
    record_audit_event(
        actor=actor,
        action="usuarios.nomina.creado",
        target=cuenta,
        module="usuarios",
        new_values={
            "usuario": cuenta.username,
            "codigo_empleado": cuenta.codigo_empleado or "",
            "cedula": enmascarar_cedula(cuenta.cedula),
            "activa": False,
        },
    )
    return cuenta, ""


def sincronizar(actor=None, empleados: list[Empleado] | None = None):
    """Una corrida completa. `empleados` permite pasar la lista ya leída (las
    pruebas); si no, se lee de nómina. Devuelve la `SincronizacionNomina`."""
    from apps.users.models import User

    from .models import SincronizacionNomina

    corrida = SincronizacionNomina.objects.create(actor=actor)
    try:
        lista = empleados if empleados is not None else leer()
    except NominaNoDisponible as error:
        corrida.estado = SincronizacionNomina.Estado.FALLIDA
        corrida.error = str(error)[:300]
        corrida.terminada_en = timezone.now()
        corrida.save()
        return corrida

    ahora = timezone.now()
    indices = _indices(User)
    por_nombre = emparejar_por_nombre(lista, list(User.objects.all()))
    vistos, conflictos = set(), []
    creadas = actualizadas = sin_cambios = 0
    for posicion, empleado in enumerate(lista):
        cuenta = _buscar(empleado, indices) or por_nombre["parejas"].get(posicion)
        if cuenta is None and posicion in por_nombre["ambiguos"]:
            conflictos.append(
                _conflicto(
                    empleado,
                    "Su nombre coincide con más de una cuenta (o la cuenta con más de un "
                    "empleado): no se creó otra; revíselo a mano.",
                )
            )
            continue
        if cuenta is None:
            cuenta, motivo = _crear(empleado, ahora, actor)
            if cuenta is None:
                conflictos.append(_conflicto(empleado, motivo))
                continue
            creadas += 1
            # Para que un segundo empleado con el mismo dato no cree otra.
            indices = _indices(User) if (creadas % 200 == 0) else indices
            if cuenta.cedula:
                indices[0][cuenta.cedula] = cuenta
            if cuenta.codigo_empleado:
                indices[2][cuenta.codigo_empleado.lower()] = cuenta
        else:
            if cuenta.pk in vistos:
                conflictos.append(
                    _conflicto(empleado, "Coincide con una cuenta que ya tomó otro empleado.")
                )
                continue
            cambio, problemas = _actualizar(cuenta, empleado, ahora, actor)
            conflictos.extend(_conflicto(empleado, p) for p in problemas)
            if cambio:
                actualizadas += 1
            else:
                sin_cambios += 1
        vistos.add(cuenta.pk)

    fuera = (
        User.objects.filter(is_active=True, is_superuser=False)
        .exclude(pk__in=vistos)
        .order_by("last_name", "first_name")
    )
    corrida.empleados = len(lista)
    corrida.creadas = creadas
    corrida.actualizadas = actualizadas
    corrida.sin_cambios = sin_cambios
    corrida.conflictos = conflictos[:1000]
    corrida.fuera_de_nomina = [
        {"id": u.pk, "usuario": u.username, "nombre": u.get_full_name().strip() or u.username}
        for u in fuera[:1000]
    ]
    corrida.estado = SincronizacionNomina.Estado.OK
    corrida.terminada_en = timezone.now()
    corrida.save()
    # Cada persona de nómina con su ficha de empleado, para que se la pueda
    # elegir como responsable de un equipo (16/11/2026). Un fallo aquí no
    # tumba la sincronización: las cuentas ya quedaron al día.
    try:
        from apps.organizacion.fichas import sincronizar_fichas

        sincronizar_fichas()
    except Exception:  # noqa: BLE001
        logger.exception("Nómina: no se pudieron poner al día las fichas de empleado")
    logger.info(
        "Nómina: %s empleados, %s creadas, %s actualizadas, %s sin cambios, %s conflictos",
        len(lista),
        creadas,
        actualizadas,
        sin_cambios,
        len(conflictos),
    )
    return corrida
