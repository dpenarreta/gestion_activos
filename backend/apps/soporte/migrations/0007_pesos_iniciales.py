"""Pesos iniciales de categorías y casos, y la criticidad de los tickets que ya
existían (ver `apps/soporte/criticidad.py`).

Sin un orden elegido todavía, los pesos salen por nombre (1, 2, 3…); quien
configura la mesa los reordena después. La lógica se copia aquí a propósito:
una migración no debe depender del código de la app, que puede cambiar.
"""

from collections import defaultdict

from django.db import migrations

PESO_IMPACTO = {"bajo": 1, "medio": 2, "alto": 3}
PESO_URGENCIA = {"baja": 1, "media": 2, "alta": 3}
NIVELES = ["muy_baja", "baja", "media", "alta", "muy_alta", "critica"]


def sembrar(apps, schema_editor):
    Categoria = apps.get_model("soporte", "Categoria")
    CasoAyuda = apps.get_model("soporte", "CasoAyuda")
    Ticket = apps.get_model("soporte", "Ticket")

    por_empresa = defaultdict(list)
    for categoria in Categoria.objects.order_by("nombre", "id"):
        por_empresa[categoria.empresa_id].append(categoria)
    topes = {}
    for empresa_id, categorias in por_empresa.items():
        mas_casos = 1
        for posicion, categoria in enumerate(categorias, start=1):
            Categoria.objects.filter(pk=categoria.pk).update(peso=posicion)
            casos = list(CasoAyuda.objects.filter(categoria=categoria).order_by("nombre", "id"))
            mas_casos = max(mas_casos, len(casos))
            for orden, caso in enumerate(casos, start=1):
                CasoAyuda.objects.filter(pk=caso.pk).update(peso=orden)
        topes[empresa_id] = max(len(categorias), 1) + mas_casos + 6

    for ticket in Ticket.objects.select_related("categoria", "caso"):
        puntaje = (
            max(Categoria.objects.get(pk=ticket.categoria_id).peso, 1)
            + max(CasoAyuda.objects.get(pk=ticket.caso_id).peso, 1)
            + PESO_IMPACTO.get(ticket.impacto or "", 1)
            + PESO_URGENCIA.get(ticket.urgencia or "", 1)
        )
        tope = topes.get(ticket.empresa_id, 10)
        proporcion = (puntaje - 4) / (tope - 4) if tope > 4 else 0.5
        nivel = NIVELES[min(5, max(0, int(proporcion * 6)))]
        Ticket.objects.filter(pk=ticket.pk).update(puntaje=puntaje, criticidad=nivel)


class Migration(migrations.Migration):
    dependencies = [("soporte", "0006_criticidad")]

    operations = [migrations.RunPython(sembrar, migrations.RunPython.noop)]
