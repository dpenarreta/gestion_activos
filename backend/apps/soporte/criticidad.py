"""La criticidad de cada ticket: con qué orden se atiende (21/10/2026).

Cada respuesta del formulario, y dos datos de quien pide, valen puntos según
su peso:

- **Categoría:** de 1 a N, donde N es el total de categorías de la mesa.
- **Caso de ayuda:** de 1 a M, donde M es el total de casos de su categoría.
- **¿A quién afecta?** y **¿Puede seguir trabajando?:** de 1 a 3, según lo que
  significa cada opción (a uno, a un grupo, a muchos; puede esperar, con
  dificultad, detenido).
- **Área** del ticket: de 1 al total de áreas; quien configura la mesa decide
  cuál pesa más (Operaciones antes que Talento Humano, por ejemplo).
- **Nivel jerárquico** de quien pide (el de su cargo en el organigrama): de 1
  al total de niveles, automático: el nivel de arriba (orden 0) pesa más.

Todo empieza en 1 porque siempre hay una opción mínima (quien no tiene área o
cargo suma 1), y un número más alto es más crítico. El orden de categorías,
casos y áreas lo decide quien configura la mesa (el peso es su posición). El
**puntaje** del ticket es la suma y ordena la cola: el más alto se atiende
primero. El número no se muestra a nadie; se ve solo su nivel: Muy baja, Baja,
Media, Alta, Muy alta o Crítica.

La prioridad P1–P4 sigue existiendo para los plazos (SLA); la criticidad
decide el orden de atención.
"""

from dataclasses import dataclass, field

from django.db import transaction
from django.db.models import Count, Max

PESO_IMPACTO = {"bajo": 1, "medio": 2, "alto": 3}
PESO_URGENCIA = {"baja": 1, "media": 2, "alta": 3}
#: Una opción mínima en cada una de las seis partes.
MINIMO = 6

NIVELES = [
    ("muy_baja", "Muy baja"),
    ("baja", "Baja"),
    ("media", "Media"),
    ("alta", "Alta"),
    ("muy_alta", "Muy alta"),
    ("critica", "Crítica"),
]
NOMBRES = dict(NIVELES)

#: Los estados en que el ticket todavía espera o se trabaja: su puntaje se
#: recalcula si cambian los pesos.
_ABIERTOS = ("esperando_aprobacion", "nuevo", "asignado", "en_curso", "esperando_usuario")


@dataclass
class Pesos:
    """Los pesos de la empresa que no viven en el propio ticket."""

    tope: int
    areas: dict = field(default_factory=dict)
    niveles: dict = field(default_factory=dict)


# --- Áreas ------------------------------------------------------------------


def asegurar_areas(empresa_id) -> None:
    """Cada área activa tiene su peso; las nuevas entran con 1 (lo menos
    crítico hasta que se las ubique) y las demás suben."""
    from apps.organizacion.models import Departamento

    from .models import PesoArea

    activas = set(
        Departamento.objects.todas()
        .filter(empresa_id=empresa_id, activo=True)
        .values_list("id", flat=True)
    )
    con_peso = set(
        PesoArea.objects.todas().filter(empresa_id=empresa_id).values_list("area_id", flat=True)
    )
    faltan = activas - con_peso
    if not faltan:
        return
    PesoArea.objects.todas().bulk_create(
        [PesoArea(empresa_id=empresa_id, area_id=pk, peso=0) for pk in faltan]
    )
    renumerar(
        PesoArea.objects.todas().filter(empresa_id=empresa_id, area__activo=True),
        nombre="area__nombre",
    )


def areas(empresa_id) -> list[dict]:
    """Las áreas activas con su peso, de menos a más crítica."""
    from .models import PesoArea

    asegurar_areas(empresa_id)
    return [
        {"id": p.area_id, "nombre": p.area.nombre, "peso": p.peso}
        for p in PesoArea.objects.todas()
        .filter(empresa_id=empresa_id, area__activo=True)
        .select_related("area")
        .order_by("peso", "area__nombre")
    ]


# --- Niveles jerárquicos -------------------------------------------------------


def niveles(empresa_id) -> list[dict]:
    """Los niveles del organigrama con su peso: el de orden más bajo (el de
    arriba) vale el total; el último, 1."""
    from apps.organizacion.models import NivelJerarquico

    lista = list(
        NivelJerarquico.objects.todas().filter(empresa_id=empresa_id).order_by("orden", "nombre")
    )
    total = len(lista)
    return [
        {"id": n.id, "nombre": n.nombre, "orden": n.orden, "peso": total - indice}
        for indice, n in enumerate(lista)
    ]


def nivel_de(usuario, empresa_id):
    """El nivel jerárquico del cargo de la persona en la empresa, o None."""
    if usuario is None:
        return None
    from apps.organizacion.models import DatosDeContacto

    perfil = (
        DatosDeContacto.objects.todas()
        .filter(empresa_id=empresa_id, usuario=usuario, cargo__unidad__isnull=False)
        .select_related("cargo__unidad")
        .first()
    )
    return perfil.cargo.unidad.nivel_id if perfil else None


# --- Puntaje ---------------------------------------------------------------------


def pesos(empresa_id) -> Pesos:
    from .models import CasoAyuda, Categoria

    categorias = Categoria.objects.todas().filter(empresa_id=empresa_id).count()
    casos = (
        CasoAyuda.objects.todas()
        .filter(categoria__empresa_id=empresa_id)
        .values("categoria")
        .annotate(n=Count("id"))
        .aggregate(m=Max("n"))["m"]
        or 1
    )
    de_areas = {a["id"]: a["peso"] for a in areas(empresa_id)}
    de_niveles = {n["id"]: n["peso"] for n in niveles(empresa_id)}
    tope = max(categorias, 1) + casos + 3 + 3 + max(len(de_areas), 1) + max(len(de_niveles), 1)
    return Pesos(tope=tope, areas=de_areas, niveles=de_niveles)


def maximo(empresa_id) -> int:
    """El puntaje más alto posible en la mesa de la empresa."""
    return pesos(empresa_id).tope


def puntaje(ticket, contexto: Pesos) -> int:
    return (
        max(ticket.categoria.peso, 1)
        + max(ticket.caso.peso, 1)
        + PESO_IMPACTO.get(ticket.impacto or "", 1)
        + PESO_URGENCIA.get(ticket.urgencia or "", 1)
        + max(contexto.areas.get(ticket.area_id, 1), 1)
        + max(contexto.niveles.get(ticket.nivel_solicitante_id, 1), 1)
    )


def nivel(valor: int, tope: int) -> str:
    """Seis tramos iguales entre el mínimo y el máximo posibles."""
    if tope <= MINIMO:
        return "media"
    proporcion = (valor - MINIMO) / (tope - MINIMO)
    return NIVELES[min(len(NIVELES) - 1, max(0, int(proporcion * len(NIVELES))))][0]


def aplicar(ticket, contexto: Pesos | None = None) -> None:
    """Calcula el puntaje y la criticidad del ticket (no lo guarda)."""
    empresa_id = ticket.empresa_id or ticket.categoria.empresa_id
    contexto = contexto or pesos(empresa_id)
    ticket.puntaje = puntaje(ticket, contexto)
    ticket.criticidad = nivel(ticket.puntaje, contexto.tope)


def recalcular_abiertos(empresa_id) -> int:
    """Tras cambiar pesos, categorías, casos o áreas: los tickets que siguen
    abiertos se reordenan con los pesos nuevos. Los cerrados conservan los
    suyos."""
    from .models import Ticket

    if empresa_id is None:
        return 0
    contexto = pesos(empresa_id)
    tickets = list(
        Ticket.objects.todas()
        .filter(empresa_id=empresa_id, estado__in=_ABIERTOS)
        .select_related("categoria", "caso")
    )
    for ticket in tickets:
        aplicar(ticket, contexto)
    Ticket.objects.todas().bulk_update(tickets, ["puntaje", "criticidad"], batch_size=500)
    return len(tickets)


@transaction.atomic
def renumerar(queryset, nombre: str = "nombre") -> None:
    """Deja los pesos seguidos de 1 a N conservando el orden (los nuevos, con
    peso 0, quedan primeros: lo menos crítico hasta que se los ubique)."""
    for posicion, objeto in enumerate(queryset.order_by("peso", nombre, "id"), start=1):
        if objeto.peso != posicion:
            type(objeto).objects.todas().filter(pk=objeto.pk).update(peso=posicion)


@transaction.atomic
def ponderar(queryset, ids: list[int], campo: str = "id") -> None:
    """Fija el orden de menos a más crítico: el primero de `ids` vale 1."""
    existentes = set(queryset.values_list(campo, flat=True))
    if set(ids) != existentes or len(ids) != len(existentes):
        from rest_framework.exceptions import ValidationError

        raise ValidationError({"ids": "Envíe todos los elementos, cada uno una vez."})
    for posicion, pk in enumerate(ids, start=1):
        queryset.filter(**{campo: pk}).update(peso=posicion)
