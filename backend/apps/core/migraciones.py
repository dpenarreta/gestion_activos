"""Ayudas para las migraciones de datos."""

from django.db import DatabaseError, transaction


def si_el_esquema_esta_al_dia(funcion):
    """Para las migraciones de datos que usan los modelos de hoy (y no los
    históricos de `apps`): en una base nueva —la de las pruebas— a esa altura
    todavía faltan columnas que los modelos esperan y no hay datos reales que
    cambiar, así que se saltan en vez de romper la creación de la base. Donde
    correspondía (producción) ya se aplicaron con su esquema al día."""

    def envoltura(apps, schema_editor):
        try:
            with transaction.atomic():
                funcion(apps, schema_editor)
        except DatabaseError:
            return

    envoltura.__name__ = funcion.__name__
    return envoltura
