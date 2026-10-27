"""Bitácora y respaldo de los cambios del organigrama (26/10/2026).

Cada cambio a la estructura —niveles, unidades, cargos (y su perfil), quién
ocupa cada cargo, los ocupantes sin cuenta y la carga masiva— pide **el
motivo** y deja una versión con:

- quién lo hizo, cuándo, desde qué IP y por qué (el motivo);
- qué cambió, en frases («Nuevo cargo «Analista» en Comercial»…);
- el **respaldo**: cómo estaba toda la estructura justo antes del cambio.

Con el respaldo, el cambio se puede **revertir**: la estructura vuelve a como
estaba antes de él (y se deshacen también los cambios posteriores). Revertir
es otro cambio: pide motivo y deja su propia versión, así que también se
puede deshacer.

**Solo se guardan las 2 últimas versiones** de cada empresa: al crear una
tercera, la más antigua se borra y no se puede recuperar. El registro general
de Auditoría sigue anotando cada operación como siempre.

El motivo llega en el encabezado `X-Motivo-Cambio` (codificado como URL, para
que lleve tildes), en cualquier método: así sirve también para borrar.
"""

from contextlib import contextmanager
from urllib.parse import unquote

from django.contrib.auth.models import Permission
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import (
    Cargo,
    DatosDeContacto,
    HerramientaDeCargo,
    NivelCargo,
    NivelJerarquico,
    OcupanteCargo,
    UnidadOrganizacional,
    VersionOrganigrama,
)

ENCABEZADO = "HTTP_X_MOTIVO_CAMBIO"
MINIMO_MOTIVO = 5
VERSIONES_GUARDADAS = 2
SIN_MOTIVO = (
    "Escriba el motivo del cambio: queda en la bitácora del organigrama junto con quién " "lo hizo."
)

CAMPOS_NIVEL = ("nombre", "orden")
CAMPOS_UNIDAD = (
    "nombre",
    "codigo",
    "nivel_id",
    "padre_id",
    "departamento_id",
    "descripcion",
    "activa",
    "orden",
)
CAMPOS_CARGO = (
    "nombre",
    "unidad_id",
    "jefe_id",
    "plazas",
    "nivel",
    "descripcion",
    "activo",
    "objetivo",
    "funciones",
    "competencias",
    "kpis",
)
PERFIL = ("objetivo", "funciones", "competencias", "kpis")
ETIQUETAS = {
    "nombre": "nombre",
    "orden": "orden",
    "codigo": "código",
    "nivel_id": "nivel",
    "padre_id": "unidad de la que depende",
    "departamento_id": "área",
    "descripcion": "descripción",
    "activa": "activa",
    "activo": "activo",
    "unidad_id": "unidad",
    "jefe_id": "jefe inmediato",
    "plazas": "plazas",
    "nivel": "nivel jerárquico",
}


# --- El respaldo -------------------------------------------------------------------------


def foto() -> dict:
    """Cómo está ahora toda la estructura del organigrama de la empresa."""
    cargos = list(Cargo.objects.select_related("rol").order_by("id"))
    permisos = {}
    for cargo in cargos:
        if cargo.rol_id:
            permisos[cargo.id] = sorted(cargo.rol.permissions.values_list("codename", flat=True))
    return {
        "niveles": [
            {"id": n.id, **{c: getattr(n, c) for c in CAMPOS_NIVEL}}
            for n in NivelJerarquico.objects.order_by("id")
        ],
        "unidades": [
            {"id": u.id, **{c: getattr(u, c) for c in CAMPOS_UNIDAD}}
            for u in UnidadOrganizacional.objects.order_by("id")
        ],
        "cargos": [
            {
                "id": c.id,
                **{campo: getattr(c, campo) for campo in CAMPOS_CARGO},
                "permisos": permisos.get(c.id, []),
            }
            for c in cargos
        ],
        "asignaciones": [
            {"usuario": d.usuario_id, "nombre": _persona(d.usuario), "cargo": d.cargo_id}
            for d in DatosDeContacto.objects.exclude(cargo=None)
            .select_related("usuario")
            .order_by("usuario_id")
        ],
        "ocupantes": [
            {
                "cargo": o.cargo_id,
                "nombres": o.nombres,
                "apellidos": o.apellidos,
                "correo": o.correo,
            }
            for o in OcupanteCargo.objects.order_by("id")
        ],
        "herramientas": [
            {"cargo": h.cargo_id, "herramienta": h.herramienta_id}
            for h in HerramientaDeCargo.objects.order_by("id")
        ],
    }


def _persona(usuario) -> str:
    return (usuario.get_full_name() or "").strip() or usuario.username


# --- Qué cambió, en frases ------------------------------------------------------------------


def _nombres(datos) -> dict:
    return {
        "nivel": {n["id"]: n["nombre"] for n in datos["niveles"]},
        "unidad": {u["id"]: u["nombre"] for u in datos["unidades"]},
        "cargo": {c["id"]: c["nombre"] for c in datos["cargos"]},
    }


def _valor(campo, valor, nombres) -> str:
    if valor in (None, ""):
        return "—"
    if isinstance(valor, bool):
        return "sí" if valor else "no"
    tipo = {"nivel_id": "nivel", "padre_id": "unidad", "unidad_id": "unidad", "jefe_id": "cargo"}
    if campo in tipo:
        return nombres[tipo[campo]].get(valor, f"#{valor}")
    if campo == "nivel":
        return dict(NivelCargo.choices).get(valor, valor)
    texto = str(valor)
    return texto if len(texto) <= 60 else texto[:57] + "…"


def _comparar(tipo, antes, despues, campos, nombres_antes, nombres_despues) -> list[str]:
    por_id_antes = {x["id"]: x for x in antes}
    por_id_despues = {x["id"]: x for x in despues}
    lineas = []
    for id_, nuevo in por_id_despues.items():
        if id_ not in por_id_antes:
            lineas.append(f"Nuevo {tipo} «{nuevo['nombre']}».")
    for id_, viejo in por_id_antes.items():
        if id_ not in por_id_despues:
            lineas.append(f"Se borró el {tipo} «{viejo['nombre']}».")
    for id_, nuevo in por_id_despues.items():
        viejo = por_id_antes.get(id_)
        if viejo is None:
            continue
        cambios, perfil = [], False
        for campo in campos:
            if campo == "departamento_id" or viejo.get(campo) == nuevo.get(campo):
                continue
            if campo in PERFIL:
                perfil = True
                continue
            cambios.append(
                f"{ETIQUETAS[campo]}: {_valor(campo, viejo.get(campo), nombres_antes)} → "
                f"{_valor(campo, nuevo.get(campo), nombres_despues)}"
            )
        if perfil:
            cambios.append("se actualizó su perfil (objetivo, funciones, competencias o KPIs)")
        if cambios:
            lineas.append(f"{tipo.capitalize()} «{viejo['nombre']}»: " + "; ".join(cambios) + ".")
    return lineas


def diferencias(antes: dict, despues: dict) -> list[str]:
    na, nd = _nombres(antes), _nombres(despues)
    lineas = []
    lineas += _comparar("nivel", antes["niveles"], despues["niveles"], CAMPOS_NIVEL, na, nd)
    lineas += _comparar("unidad", antes["unidades"], despues["unidades"], CAMPOS_UNIDAD, na, nd)
    lineas += _comparar("cargo", antes["cargos"], despues["cargos"], CAMPOS_CARGO, na, nd)

    cargo_antes = {a["usuario"]: a for a in antes["asignaciones"]}
    cargo_despues = {a["usuario"]: a for a in despues["asignaciones"]}
    for usuario in sorted(set(cargo_antes) | set(cargo_despues)):
        viejo, nuevo = cargo_antes.get(usuario), cargo_despues.get(usuario)
        de = viejo["cargo"] if viejo else None
        a = nuevo["cargo"] if nuevo else None
        if de == a:
            continue
        nombre = (nuevo or viejo)["nombre"]
        lineas.append(
            f"{nombre}: cargo {na['cargo'].get(de, '—') if de else '—'} → "
            f"{nd['cargo'].get(a, '—') if a else '—'}."
        )

    def ocupantes(datos, nombres):
        return {
            (o["cargo"], o["nombres"], o["apellidos"], o["correo"]): nombres["cargo"].get(
                o["cargo"], ""
            )
            for o in datos["ocupantes"]
        }

    oa, od = ocupantes(antes, na), ocupantes(despues, nd)
    for clave in od.keys() - oa.keys():
        lineas.append(
            f"Ocupante sin cuenta {clave[1]} {clave[2]} en «{od[clave]}».".replace("  ", " ")
        )
    for clave in oa.keys() - od.keys():
        lineas.append(f"Se quitó al ocupante sin cuenta {clave[1]} {clave[2]} de «{oa[clave]}».")

    ha = {(h["cargo"], h["herramienta"]) for h in antes["herramientas"]}
    hd = {(h["cargo"], h["herramienta"]) for h in despues["herramientas"]}
    if ha != hd:
        lineas.append(
            f"Herramientas base de los cargos: {len(hd - ha)} nuevas, {len(ha - hd)} quitadas."
        )
    return lineas


# --- Registrar un cambio --------------------------------------------------------------------


def motivo_de(request) -> str:
    crudo = request.META.get(ENCABEZADO, "")
    motivo = unquote(crudo).strip() if crudo else ""
    if len(motivo) < MINIMO_MOTIVO:
        raise ValidationError({"motivo": [SIN_MOTIVO]})
    return motivo[:1000]


def _ip(request):
    from apps.core.request_meta import get_request_context

    return get_request_context(request).get("ip_address") or None


def _podar():
    vigentes = list(
        VersionOrganigrama.objects.order_by("-created_at", "-id").values_list("id", flat=True)
    )[:VERSIONES_GUARDADAS]
    VersionOrganigrama.objects.exclude(id__in=vigentes).delete()


@contextmanager
def cambio(request, motivo=None):
    """Envuelve un cambio al organigrama: pide el motivo, toma el respaldo,
    y al terminar bien guarda la versión con lo que cambió (si cambió algo)
    y deja solo las 2 últimas. Si el cambio falla, no queda nada."""
    motivo = motivo or motivo_de(request)
    with transaction.atomic():
        antes = foto()
        resultado = {}
        yield resultado
        despues = foto()
        lineas = diferencias(antes, despues)
        if not lineas:
            return
        resultado["version"] = VersionOrganigrama.objects.create(
            usuario=request.user,
            motivo=motivo,
            cambios=lineas,
            respaldo=antes,
            ip=_ip(request),
            revierte=resultado.get("revierte"),
        )
        _podar()


@contextmanager
def sin_peticion(motivo):
    """Como `cambio`, para lo que se aplica sin una persona detrás (una
    migración que levanta el organigrama de un área): la versión queda sin
    usuario ni IP. `resultado["lineas"]` dice qué cambió."""
    with transaction.atomic():
        antes = foto()
        resultado = {"lineas": []}
        yield resultado
        resultado["lineas"] = diferencias(antes, foto())
        if resultado["lineas"]:
            resultado["version"] = VersionOrganigrama.objects.create(
                usuario=None, motivo=motivo, cambios=resultado["lineas"], respaldo=antes
            )
            _podar()


def fila(version) -> dict:
    local = timezone.localtime(version.created_at)
    return {
        "id": version.id,
        "fecha": local.strftime("%d/%m/%Y"),
        "hora": local.strftime("%H:%M:%S"),
        "fecha_hora": version.created_at,
        "usuario": _persona(version.usuario) if version.usuario_id else "",
        "correo": version.usuario.email if version.usuario_id else "",
        "ip": version.ip,
        "motivo": version.motivo,
        "cambios": version.cambios,
        "revierte": version.revierte,
    }


def versiones() -> list[dict]:
    return [
        fila(v)
        for v in VersionOrganigrama.objects.select_related("usuario").order_by("-created_at", "-id")
    ]


def vista_previa(version) -> list[str]:
    """Qué cambiaría al revertir: de cómo está ahora a como estaba antes de
    esa versión."""
    return diferencias(foto(), version.respaldo)


# --- Revertir -------------------------------------------------------------------------------


def _remapear(valor, mapa):
    return mapa.get(valor, valor) if valor is not None else None


def restaurar(respaldo: dict, empresa) -> None:
    """Deja la estructura como en el respaldo: actualiza lo que existe, crea
    de nuevo lo que se borró (con id nuevo) y borra lo que se agregó después.
    Mantiene en orden las áreas de cada unidad y los roles de cada cargo."""
    from . import departamentos_del_organigrama, roles_de_cargo

    # Niveles.
    niveles = {n.id: n for n in NivelJerarquico.objects.all()}
    mapa_nivel = {}
    for datos in respaldo["niveles"]:
        nivel = niveles.get(datos["id"]) or NivelJerarquico(empresa=empresa)
        for campo in CAMPOS_NIVEL:
            setattr(nivel, campo, datos[campo])
        nivel.save()
        mapa_nivel[datos["id"]] = nivel.id

    # Unidades: primero sin su padre (puede venir después en la lista).
    unidades = {u.id: u for u in UnidadOrganizacional.objects.all()}
    mapa_unidad = {}
    for datos in respaldo["unidades"]:
        unidad = unidades.get(datos["id"]) or UnidadOrganizacional(empresa=empresa)
        for campo in CAMPOS_UNIDAD:
            if campo not in ("padre_id", "nivel_id"):
                setattr(unidad, campo, datos[campo])
        unidad.nivel_id = mapa_nivel[datos["nivel_id"]]
        unidad.padre_id = None
        unidad.save()
        mapa_unidad[datos["id"]] = unidad.id
    for datos in respaldo["unidades"]:
        UnidadOrganizacional.objects.filter(pk=mapa_unidad[datos["id"]]).update(
            padre_id=_remapear(datos["padre_id"], mapa_unidad)
        )

    # Cargos: primero sin su jefe.
    cargos = {c.id: c for c in Cargo.objects.all()}
    mapa_cargo, recreados = {}, []
    for datos in respaldo["cargos"]:
        cargo = cargos.get(datos["id"])
        if cargo is None:
            cargo = Cargo(empresa=empresa)
            recreados.append((cargo, datos["permisos"]))
        for campo in CAMPOS_CARGO:
            # Los respaldos de antes del nivel por cargo no lo traen.
            if campo not in ("jefe_id", "unidad_id") and campo in datos:
                setattr(cargo, campo, datos[campo])
        cargo.unidad_id = _remapear(datos["unidad_id"], mapa_unidad)
        cargo.jefe_id = None
        cargo.save()
        mapa_cargo[datos["id"]] = cargo.id
    for datos in respaldo["cargos"]:
        Cargo.objects.filter(pk=mapa_cargo[datos["id"]]).update(
            jefe_id=_remapear(datos["jefe_id"], mapa_cargo)
        )

    # Quién ocupa cada cargo.
    deben = {a["usuario"]: mapa_cargo.get(a["cargo"]) for a in respaldo["asignaciones"]}
    tocados = set()
    for perfil in DatosDeContacto.objects.all():
        destino = deben.get(perfil.usuario_id)
        if perfil.cargo_id != destino:
            perfil.cargo_id = destino
            perfil.save(update_fields=["cargo", "updated_at"])
            tocados.add(perfil.usuario_id)
    from apps.users.models import User

    for usuario_id, destino in deben.items():
        if destino and not DatosDeContacto.objects.filter(usuario_id=usuario_id).exists():
            if User.objects.filter(pk=usuario_id).exists():
                DatosDeContacto.objects.create(usuario_id=usuario_id, cargo_id=destino)
                tocados.add(usuario_id)

    # Ocupantes sin cuenta y herramientas base: como estaban.
    OcupanteCargo.objects.all().delete()
    for o in respaldo["ocupantes"]:
        if o["cargo"] in mapa_cargo:
            OcupanteCargo.objects.create(
                cargo_id=mapa_cargo[o["cargo"]],
                nombres=o["nombres"],
                apellidos=o["apellidos"],
                correo=o["correo"],
            )
    HerramientaDeCargo.objects.all().delete()
    from .models import Herramienta

    existentes = set(Herramienta.objects.values_list("id", flat=True))
    for h in respaldo["herramientas"]:
        if h["cargo"] in mapa_cargo and h["herramienta"] in existentes:
            HerramientaDeCargo.objects.create(
                cargo_id=mapa_cargo[h["cargo"]], herramienta_id=h["herramienta"]
            )

    # Lo que se agregó después del respaldo se borra (cargos, unidades de abajo
    # hacia arriba, niveles).
    try:
        for cargo in Cargo.objects.exclude(pk__in=mapa_cargo.values()).select_related("rol"):
            Cargo.objects.filter(jefe=cargo).update(jefe=None)
            cargo.delete()
            roles_de_cargo.borrar_rol(cargo)
        sobrantes = list(UnidadOrganizacional.objects.exclude(pk__in=mapa_unidad.values()))
        while sobrantes:
            hojas = [
                u for u in sobrantes if not UnidadOrganizacional.objects.filter(padre=u).exists()
            ]
            if not hojas:
                break
            for unidad in hojas:
                unidad.delete()
                departamentos_del_organigrama.al_borrar(unidad)
                sobrantes.remove(unidad)
        NivelJerarquico.objects.exclude(pk__in=mapa_nivel.values()).delete()
    except ProtectedError as error:
        usados = ", ".join(sorted({str(o) for o in error.protected_objects})[:3])
        raise ValidationError(
            {
                "detail": (
                    "No se puede revertir: algo creado después de esa versión se usa en otra "
                    f"parte del sistema ({usados}). Quítelo de ahí y vuelva a intentarlo."
                )
            }
        ) from None

    # Áreas de las unidades y roles de los cargos.
    for unidad in UnidadOrganizacional.objects.select_related("departamento", "empresa"):
        departamentos_del_organigrama.sincronizar(unidad)
    for cargo in Cargo.objects.select_related("rol", "unidad", "empresa"):
        roles_de_cargo.asegurar_rol(cargo, con_homonimos=False)
    for cargo, codenames in recreados:
        cargo.refresh_from_db()
        if cargo.rol_id and codenames:
            cargo.rol.permissions.set(
                Permission.objects.filter(
                    content_type__app_label="permissions", codename__in=codenames
                )
            )
    roles_de_cargo.sincronizar(empresa)


def revertir(request, version) -> dict:
    """Vuelve la estructura a como estaba antes de `version`. Es un cambio
    más: pide motivo y deja su propia versión."""
    from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

    empresa = empresa_actual()
    empresa = None if empresa in (None, SIN_EMPRESA) else empresa
    try:
        with cambio(request) as resultado:
            resultado["revierte"] = version.id
            restaurar(version.respaldo, empresa)
    except IntegrityError:
        raise ValidationError(
            {
                "detail": (
                    "No se pudo revertir: hay nombres repetidos entre lo de ahora y la versión. "
                    "Renombre el elemento que se repite y vuelva a intentarlo."
                )
            }
        ) from None
    return resultado
