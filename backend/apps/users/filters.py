"""Búsqueda y filtros del listado administrativo de usuarios.

Función simple en vez de un backend de filtros genérico: el conjunto de
filtros es pequeño y fijo, y mantenerlo explícito evita sumar una
dependencia (`django-filter`) para un caso de uso acotado.
"""

from django.db.models import Q, QuerySet
from django.utils.dateparse import parse_date

from apps.core.busqueda import condicion_de_busqueda


def filter_users(queryset: QuerySet, params) -> QuerySet:
    query = (params.get("q") or "").strip()
    if query:
        # Palabra por palabra y sin tildes (ver `apps.core.busqueda`); el id,
        # con el término entero.
        search = condicion_de_busqueda(query, ("username", "email", "first_name", "last_name"))
        if query.isdigit():
            search |= Q(id=int(query))
        queryset = queryset.filter(search)

    status = params.get("status")
    if status:
        queryset = queryset.filter(status=status)

    role = params.get("role")
    if role:
        queryset = (
            queryset.filter(groups__id=int(role))
            if role.isdigit()
            else queryset.filter(groups__name__iexact=role)
        )

    created_from = parse_date(params.get("created_from", ""))
    if created_from:
        queryset = queryset.filter(created_at__date__gte=created_from)

    created_to = parse_date(params.get("created_to", ""))
    if created_to:
        queryset = queryset.filter(created_at__date__lte=created_to)

    return queryset.distinct()
