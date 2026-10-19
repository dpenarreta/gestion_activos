"""El organigrama institucional (módulo Institucional): niveles jerárquicos,
unidades y cargos, y quién ocupa cada cargo.

Lo que se protege:

- **Un árbol, no un grafo**: ni una unidad cuelga de sí misma o de una de sus
  hijas, ni un cargo reporta a sí mismo o a uno de sus subordinados.
- **Los niveles bajan**: una unidad cuelga de otra de un nivel superior
  (menor `orden`). Así «Gerencia» no queda debajo de «Área».
- **Quién ocupa un cargo** es lo que dice «Mi perfil» de cada persona
  (`DatosDeContacto.cargo`). Lo elige ella o se lo asigna quien administra el
  organigrama: es el mismo dato, así que nunca hay dos versiones.
"""

from django.db import transaction
from rest_framework.exceptions import ValidationError

from .models import Cargo, DatosDeContacto, NivelJerarquico, UnidadOrganizacional


def validar_padre(unidad, padre, nivel):
    """Que `padre` sea un lugar válido para la unidad (nueva si `unidad` es
    None) con ese `nivel`."""
    if padre is None:
        return
    if nivel is not None and padre.nivel.orden >= nivel.orden:
        raise ValidationError(
            {
                "padre": (
                    f"«{padre.nombre}» es del nivel {padre.nivel.nombre}: una unidad de "
                    f"nivel {nivel.nombre} no puede colgar de ella. Elija una unidad de "
                    "un nivel superior."
                )
            }
        )
    if unidad is None:
        return
    actual = padre
    while actual is not None:
        if actual.pk == unidad.pk:
            raise ValidationError(
                {"padre": "Una unidad no puede colgar de sí misma ni de una de sus unidades."}
            )
        actual = actual.padre


def validar_jefe(cargo, jefe):
    """Que `jefe` no cierre un círculo en la línea de reporte."""
    if jefe is None or cargo is None:
        return
    actual = jefe
    while actual is not None:
        if actual.pk == cargo.pk:
            raise ValidationError(
                {"jefe": "Un cargo no puede reportar a sí mismo ni a uno de sus subordinados."}
            )
        actual = actual.jefe


def _persona(usuario):
    return {"id": usuario.id, "nombre": usuario.get_full_name().strip() or usuario.username}


def ocupantes() -> dict[int, list[dict]]:
    """Cargo → las personas activas que lo ocupan (según su perfil)."""
    por_cargo: dict[int, list[dict]] = {}
    filas = (
        DatosDeContacto.objects.filter(cargo__isnull=False, usuario__is_active=True)
        .select_related("usuario")
        .order_by("usuario__first_name", "usuario__last_name")
    )
    for fila in filas:
        por_cargo.setdefault(fila.cargo_id, []).append(_persona(fila.usuario))
    return por_cargo


def arbol() -> dict:
    """Todo el organigrama de la empresa activa, plano: el frontend lo arma.

    Plano y no anidado porque cada pantalla lo recorre distinto (el gráfico
    por unidades, las listas por nivel, los selectores) y así se pide una vez.
    """
    quienes = ocupantes()
    cargos = []
    for cargo in Cargo.objects.select_related("unidad", "jefe").order_by("nombre"):
        en_el = quienes.get(cargo.id, [])
        cargos.append(
            {
                "id": cargo.id,
                "nombre": cargo.nombre,
                "unidad": cargo.unidad_id,
                "jefe": cargo.jefe_id,
                "plazas": cargo.plazas,
                "descripcion": cargo.descripcion,
                "activo": cargo.activo,
                "ocupantes": en_el,
                "vacantes": max(cargo.plazas - len(en_el), 0),
            }
        )
    return {
        "niveles": [
            {"id": n.id, "nombre": n.nombre, "orden": n.orden}
            for n in NivelJerarquico.objects.order_by("orden", "nombre")
        ],
        "unidades": [
            {
                "id": u.id,
                "nombre": u.nombre,
                "codigo": u.codigo,
                "nivel": u.nivel_id,
                "padre": u.padre_id,
                "departamento": (
                    {"id": u.departamento_id, "nombre": u.departamento.nombre}
                    if u.departamento_id
                    else None
                ),
                "descripcion": u.descripcion,
                "activa": u.activa,
                "orden": u.orden,
            }
            for u in UnidadOrganizacional.objects.select_related("departamento").order_by(
                "orden", "nombre"
            )
        ],
        "cargos": cargos,
    }


def nombre_con_unidad(cargo) -> str:
    """«Analista de TI · Tecnología»: el mismo nombre se repite entre
    unidades, así que en un selector se dice de cuál. Si en la unidad hay otro
    con el mismo nombre (bajo otro jefe), se dice también a quién reporta."""
    if not cargo.unidad_id:
        return cargo.nombre
    texto = f"{cargo.nombre} · {cargo.unidad.nombre}"
    gemelos = (
        Cargo.objects.filter(unidad_id=cargo.unidad_id, nombre__iexact=cargo.nombre)
        .exclude(pk=cargo.pk)
        .exists()
    )
    if gemelos and cargo.jefe_id:
        texto += f" (reporta a {cargo.jefe.nombre})"
    return texto


def asignar(usuario, cargo) -> None:
    """Pone a la persona en el cargo (o la saca, con `cargo=None`), en su
    perfil de la empresa activa."""
    with transaction.atomic():
        perfil = DatosDeContacto.objects.filter(usuario=usuario).first()
        if perfil is None:
            if cargo is None:
                return
            perfil = DatosDeContacto(usuario=usuario)
        perfil.cargo = cargo
        perfil.save()


def no_se_puede_borrar(objeto) -> str | None:
    """Por qué no se puede borrar un nivel, una unidad o un cargo, o None."""
    if isinstance(objeto, NivelJerarquico) and objeto.unidades.exists():
        return "El nivel tiene unidades: muévalas a otro nivel antes de borrarlo."
    if isinstance(objeto, UnidadOrganizacional):
        if objeto.hijas.exists():
            return "La unidad tiene unidades debajo: muévalas o bórrelas primero."
        if objeto.cargos.exists():
            return "La unidad tiene cargos: muévalos o bórrelos primero."
    if isinstance(objeto, Cargo):
        if objeto.subordinados.exists():
            return "Otros cargos reportan a este: cambie su jefe antes de borrarlo."
        if DatosDeContacto.objects.filter(cargo=objeto).exists():
            return "Hay personas en este cargo: desactívelo o páselas a otro cargo."
    return None
