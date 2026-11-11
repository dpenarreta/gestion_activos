"""El área de una persona sale de su cargo (US-005, 11/11/2026).

- **El área del cargo** es el Área (`Departamento`) enlazada a la unidad del
  organigrama del cargo (`Cargo.unidad.departamento`). Si su unidad no tiene
  una, se usa la de la unidad superior más cercana que la tenga. Un área
  inactiva no cuenta: no se propone lo que la persona no puede guardar. Una
  unidad inactiva tampoco: se pasa por ella sin tomar su área. La
  pantalla de «Mi perfil» la propone al elegir el cargo (`contacto.opciones`).
- **La persona elige su área una sola vez**, como el cargo: la primera vez se
  guarda la que mande; después la cambia Gestión Humana o una persona con
  `organizacion.cambiar_area` (`cambiar_area`, desde «Asignación de cargos»).
  No se recalcula el área de quien ya la tiene guardada.
"""

from django.db import IntegrityError, transaction

from .models import DatosDeContacto, Departamento, UnidadOrganizacional

#: Cuántas unidades superiores se recorren como mucho. El organigrama no
#: admite ciclos (`organigrama.validar_padre`), pero una carga masiva o una
#: reversión a medias no deben colgar «Mi perfil»: con el tope y el registro
#: de las unidades vistas, un ciclo termina sin área.
TOPE_DE_NIVELES = 30

AREA_FIJA = "El área la cambia Gestión Humana o una persona autorizada."
AREA_INACTIVA = "Elija un área activa de la empresa."

PERMISO_CAMBIAR = "organizacion.cambiar_area"


def _resolver(unidad_id, unidades, activas) -> int | None:
    vistas = set()
    while unidad_id is not None and unidad_id not in vistas and len(vistas) < TOPE_DE_NIVELES:
        vistas.add(unidad_id)
        fila = unidades.get(unidad_id)
        if fila is None:
            return None
        padre_id, departamento_id, activa = fila
        # Una unidad inactiva (QA-TECH, 11/11/2026) no da área: se sigue
        # subiendo por ella.
        if activa and departamento_id is not None and departamento_id in activas:
            return departamento_id
        unidad_id = padre_id
    return None


def areas_de_cargos(cargos) -> dict:
    """`{cargo_id: Departamento | None}` para varios cargos, con dos consultas
    por empresa (las unidades y las áreas activas), no una por cargo."""
    resultado = {}
    por_empresa: dict = {}
    for cargo in cargos:
        if cargo.unidad_id is None:
            resultado[cargo.pk] = None
        else:
            por_empresa.setdefault(cargo.empresa_id, []).append(cargo)
    for empresa_id, del_grupo in por_empresa.items():
        unidades = {
            fila[0]: (fila[1], fila[2], fila[3])
            for fila in UnidadOrganizacional.objects.todas()
            .filter(empresa_id=empresa_id)
            .values_list("id", "padre_id", "departamento_id", "activa")
        }
        # Sin `pk__in`: SQL Server no admite más de 2100 parámetros.
        activas = {
            d.pk: d for d in Departamento.objects.todas().filter(empresa_id=empresa_id, activo=True)
        }
        for cargo in del_grupo:
            area_id = _resolver(cargo.unidad_id, unidades, activas)
            resultado[cargo.pk] = activas.get(area_id) if area_id else None
    return resultado


def area_del_cargo(cargo):
    """El Área del cargo (o `None`): la de su unidad o la de la unidad superior
    más cercana que tenga una activa."""
    if cargo is None:
        return None
    return areas_de_cargos([cargo]).get(cargo.pk)


def como_dato(area) -> dict | None:
    return {"id": area.id, "nombre": area.nombre} if area else None


def catalogo() -> list[dict]:
    """Las áreas que se pueden elegir: las activas de la empresa activa, como
    en «Mi perfil» (`contacto.opciones`)."""
    return [
        {"id": d.id, "nombre": d.nombre}
        for d in Departamento.objects.filter(activo=True).order_by("nombre")
    ]


def _bloquear(usuario):
    # Sin `select_related`: `SELECT … FOR UPDATE` con JOIN bloquearía también
    # la fila del área (QA-TECH, 11/11/2026).
    return DatosDeContacto.objects.select_for_update().filter(usuario=usuario).first()


def cambiar_area(usuario, area):
    """La administración cambia el área de la persona en su perfil de la
    empresa activa. Devuelve `(anterior, cambio)`: el área que tenía y si
    cambió. Sin cambio no se escribe nada (un doble clic no duplica la
    auditoría). Quien llama audita y sincroniza los roles del cargo, en la
    misma transacción.

    Si la persona no tiene perfil todavía, se crea; si otra petición lo crea
    al mismo tiempo (`datos_de_contacto_unicos`), se toma el suyo y se
    actualiza."""
    with transaction.atomic():
        propios = _bloquear(usuario)
        if propios is None:
            try:
                with transaction.atomic():
                    DatosDeContacto.objects.create(usuario=usuario, departamento=area)
                return None, True
            except IntegrityError:
                propios = _bloquear(usuario)
                if propios is None:
                    raise
        anterior = (
            Departamento.objects.todas().filter(pk=propios.departamento_id).first()
            if propios.departamento_id
            else None
        )
        if propios.departamento_id == area.pk:
            return anterior, False
        propios.departamento = area
        propios.save(update_fields=["departamento", "updated_at"])
    return anterior, True
