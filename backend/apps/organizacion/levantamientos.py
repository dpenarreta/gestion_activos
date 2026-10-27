"""Levantar el organigrama de un área tal como lo pasó (27/10/2026).

Cada área describe sus cargos (`laarbox_2026.CARGOS` es el ejemplo): nombre,
jefe, plazas, cómo se llamaba antes (nombre y nombre de su jefe, porque hay
homónimos) y quiénes lo ocupan. `levantar`:

- reconoce los cargos que ya existían y los renombra, así conservan su rol, su
  perfil y quienes los ocupan; crea los que faltan;
- pone a cada persona en su cargo: en su perfil si tiene cuenta (y no ocupa un
  cargo de otra área), si no como ocupante sin cuenta;
- desactiva los cargos que ya no están, solo si nadie los ocupa ni les reporta
  un cargo activo; los ocupados se quedan como estaban.

Se puede repetir: lo que ya está como dice el organigrama no se toca.
"""

from . import departamentos_del_organigrama, niveles_cargo, roles_de_cargo
from .models import (
    Cargo,
    DatosDeContacto,
    NivelJerarquico,
    OcupanteCargo,
    UnidadOrganizacional,
)
from .permisos_por_cargo import normalizar as _normal


def _ocupantes(cargo) -> int:
    return cargo.ocupantes_sin_cuenta.count() + DatosDeContacto.objects.filter(cargo=cargo).count()


def _poner_persona(cargo, nombres, apellidos, unidad) -> None:
    """La persona queda en el cargo: si tiene cuenta y no ocupa un cargo de
    otra área, en su perfil; si no, como ocupante sin cuenta. Si ya estaba en
    otro cargo del área, se mueve."""
    contacto = (
        DatosDeContacto.objects.filter(
            usuario__first_name__iexact=nombres, usuario__last_name__iexact=apellidos
        )
        .select_related("cargo", "usuario")
        .first()
    )
    if contacto is not None:
        if contacto.cargo_id == cargo.id:
            return
        if contacto.cargo_id is None or contacto.cargo.unidad_id == unidad.id:
            contacto.cargo = cargo
            contacto.save(update_fields=["cargo", "updated_at"])
            roles_de_cargo.sincronizar(cargo.empresa, [contacto.usuario])
        return
    ocupante = OcupanteCargo.objects.filter(
        nombres__iexact=nombres, apellidos__iexact=apellidos
    ).first()
    if ocupante is None:
        OcupanteCargo.objects.create(cargo=cargo, nombres=nombres, apellidos=apellidos)
    elif ocupante.cargo_id != cargo.id and ocupante.cargo.unidad_id == unidad.id:
        ocupante.cargo = cargo
        ocupante.save(update_fields=["cargo", "updated_at"])


def _unidad(nombre_unidad, nombres_anteriores, padre):
    """La unidad del área (con su nombre de antes, si cambió). Si no existe
    se crea bajo `padre`, en el nivel de sus otras unidades: así se levantó
    en producción, donde el área todavía no estaba. Sin `padre` no se crea."""
    buscados = {_normal(n) for n in (nombre_unidad, *nombres_anteriores)}
    unidad = next(
        (u for u in UnidadOrganizacional.objects.all() if _normal(u.nombre) in buscados),
        None,
    )
    if unidad is not None:
        if unidad.nombre != nombre_unidad:
            unidad.nombre = nombre_unidad
            unidad.save(update_fields=["nombre", "updated_at"])
            departamentos_del_organigrama.sincronizar(unidad)
        return unidad
    superior = next(
        (
            u
            for u in UnidadOrganizacional.objects.select_related("nivel")
            if _normal(u.nombre) == _normal(padre)
        ),
        None,
    )
    if superior is None:
        return None
    hermana = superior.hijas.select_related("nivel").order_by("orden", "id").first()
    nivel = (
        hermana.nivel
        if hermana is not None
        else NivelJerarquico.objects.filter(orden__gt=superior.nivel.orden)
        .order_by("orden")
        .first()
        or superior.nivel
    )
    unidad = UnidadOrganizacional.objects.create(
        nombre=nombre_unidad, nivel=nivel, padre=superior, orden=superior.hijas.count()
    )
    departamentos_del_organigrama.sincronizar(unidad)
    return unidad


def levantar(
    nombre_unidad: str,
    cargos: dict,
    *,
    nombres_anteriores=(),
    padre: str = "Gerencia General",
) -> None:
    """Deja la unidad como dice su organigrama (`cargos`, ver
    `laarbox_2026.CARGOS`), y la crea bajo `padre` si no existe. No anota en
    la bitácora: lo hace quien llama, dentro de `versiones.sin_peticion`."""
    unidad = _unidad(nombre_unidad, nombres_anteriores, padre)
    if unidad is None:
        return
    existentes = list(Cargo.objects.filter(unidad=unidad).select_related("jefe"))

    def identidad(cargo):
        return (_normal(cargo.nombre), _normal(cargo.jefe.nombre if cargo.jefe_id else ""))

    # Primero se reconoce cada cargo, con los nombres de antes de renombrar.
    por_clave, usados = {}, set()
    for clave, datos in cargos.items():
        jefe_nuevo = cargos.get(datos["jefe"], {}).get("nombre", datos["jefe"])
        buscadas = [(datos["nombre"], jefe_nuevo), *datos["antes"]]
        for nombre, jefe in buscadas:
            cargo = next(
                (
                    c
                    for c in existentes
                    if c.id not in usados and identidad(c) == (_normal(nombre), _normal(jefe))
                ),
                None,
            )
            if cargo is not None:
                por_clave[clave] = cargo
                usados.add(cargo.id)
                break

    for clave, datos in cargos.items():
        cargo = por_clave.get(clave)
        if cargo is None:
            por_clave[clave] = Cargo.objects.create(
                nombre=datos["nombre"],
                unidad=unidad,
                plazas=datos["plazas"],
                nivel=niveles_cargo.sugerido(datos["nombre"]),
            )
        elif cargo.nombre != datos["nombre"] or not cargo.activo:
            # Un cargo que cambia de nombre puede cambiar de nivel (el Asesor
            # Comercial que encabezaba un equipo pasa a Jefe Comercial).
            if _normal(cargo.nombre) != _normal(datos["nombre"]):
                cargo.nivel = niveles_cargo.sugerido(datos["nombre"])
            cargo.nombre = datos["nombre"]
            cargo.activo = True
            cargo.save(update_fields=["nombre", "nivel", "activo", "updated_at"])

    for clave, datos in cargos.items():
        cargo = por_clave[clave]
        jefe = por_clave.get(datos["jefe"]) or (
            Cargo.objects.filter(nombre__iexact=datos["jefe"], activo=True)
            .exclude(unidad=unidad)
            .order_by("id")
            .first()
        )
        for nombres, apellidos in datos["personas"]:
            _poner_persona(cargo, nombres, apellidos, unidad)
        plazas = max(datos["plazas"], _ocupantes(cargo))
        if cargo.jefe_id != (jefe.id if jefe else None) or cargo.plazas != plazas:
            cargo.jefe = jefe
            cargo.plazas = plazas
            cargo.save(update_fields=["jefe", "plazas", "updated_at"])

    # Lo que ya no está: se desactiva si nadie lo ocupa ni le reporta un
    # cargo activo (de abajo hacia arriba).
    vigentes = {c.id for c in por_clave.values()}
    cambio = True
    while cambio:
        cambio = False
        for cargo in Cargo.objects.filter(unidad=unidad, activo=True).exclude(id__in=vigentes):
            if _ocupantes(cargo) or cargo.subordinados.filter(activo=True).exists():
                continue
            cargo.activo = False
            cargo.save(update_fields=["activo", "updated_at"])
            cambio = True

    for cargo in Cargo.objects.filter(unidad=unidad).select_related("rol", "unidad", "empresa"):
        roles_de_cargo.asegurar_rol(cargo)
