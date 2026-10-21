"""El organigrama manda sobre los departamentos (21/10/2026).

Antes había dos listas de lo mismo: los departamentos del catálogo (activos,
empleados, Mesa de ayuda, chat, «Área» de Mi perfil) y las unidades del
organigrama, enlazadas solo si alguien se acordaba. Ahora cada unidad **es** un
departamento: al crearla o editarla se crea o actualiza el suyo (nombre,
código y si está activa), y el catálogo de departamentos ya no se edita.

El departamento se conserva como registro porque de él cuelgan los activos y
su historial, los empleados y sus códigos (TI-0001): cambiar todas esas
relaciones a la unidad pondría en riesgo datos sin ganar nada. Lo que cambia es
quién lo gobierna.

El código del departamento numera etiquetas y códigos de empleado, así que no
se cambia solo: se toma el de la unidad si tiene uno, y si no, el que ya tenía
o uno nuevo sacado de las iniciales.
"""

import re
import unicodedata

from django.db import transaction

#: Palabras que no aportan a las iniciales de un código.
_VACIAS = {"de", "del", "la", "las", "el", "los", "y", "e", "en", "a", "para"}


def _sin_tildes(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    )


def _codigo_base(nombre: str) -> str:
    palabras = [
        p for p in re.findall(r"[A-Za-z0-9]+", _sin_tildes(nombre)) if p.lower() not in _VACIAS
    ]
    if not palabras:
        return "UND"
    if len(palabras) == 1:
        return palabras[0][:3].upper()
    return "".join(p[0] for p in palabras)[:4].upper()


def _libre(queryset, campo: str, base: str, largo: int) -> str:
    candidato, n = base[:largo], 2
    while queryset.filter(**{f"{campo}__iexact": candidato}).exists():
        sufijo = str(n) if campo == "codigo" else f" ({n})"
        candidato = base[: largo - len(sufijo)] + sufijo
        n += 1
    return candidato


@transaction.atomic
def sincronizar(unidad):
    """Crea o actualiza el departamento de la unidad. Devuelve el departamento."""
    from .models import Departamento

    de_la_empresa = Departamento.objects.todas().filter(empresa=unidad.empresa)
    departamento = unidad.departamento
    if departamento is None:
        # Uno del catálogo con el mismo nombre y sin unidad: es el mismo.
        enlazados = type(unidad).objects.todas().exclude(departamento=None).values("departamento")
        departamento = (
            de_la_empresa.filter(nombre__iexact=unidad.nombre.strip())
            .exclude(pk__in=enlazados)
            .first()
        )
    otros = de_la_empresa.exclude(pk=getattr(departamento, "pk", None))
    nombre = _libre(otros, "nombre", unidad.nombre.strip(), 120)
    if unidad.codigo:
        codigo = unidad.codigo.strip().upper()
        if otros.filter(codigo__iexact=codigo).exists():
            codigo = _libre(otros, "codigo", codigo, 20)
    elif departamento is not None:
        codigo = departamento.codigo
    else:
        codigo = _libre(otros, "codigo", _codigo_base(unidad.nombre), 20)

    if departamento is None:
        departamento = Departamento.objects.create(
            empresa=unidad.empresa,
            nombre=nombre,
            codigo=codigo,
            descripcion=unidad.descripcion,
            activo=unidad.activa,
        )
    else:
        departamento.nombre = nombre
        departamento.codigo = codigo
        departamento.activo = unidad.activa
        departamento.save(update_fields=["nombre", "codigo", "activo", "updated_at"])
    if unidad.departamento_id != departamento.pk:
        type(unidad).objects.todas().filter(pk=unidad.pk).update(departamento=departamento)
        unidad.departamento = departamento
    return departamento


def al_borrar(unidad):
    """La unidad se borró: su departamento queda inactivo, no se borra (lo
    referencian activos e historial)."""
    if unidad.departamento_id:
        departamento = unidad.departamento
        departamento.activo = False
        departamento.save(update_fields=["activo", "updated_at"])
