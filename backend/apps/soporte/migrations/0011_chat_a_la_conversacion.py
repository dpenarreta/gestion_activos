"""El chat aparte del ticket se une a «Conversación» (04/11/2026): un solo
hilo, como Zendesk o Jira. Lo que se escribió en el chat pasa al hilo, con su
autor y su fecha, para que no se pierda la constancia; después se borra la
tabla del chat."""

from django.db import migrations


def chat_a_la_conversacion(apps, schema_editor):
    MensajeChatTicket = apps.get_model("soporte", "MensajeChatTicket")
    MensajeTicket = apps.get_model("soporte", "MensajeTicket")
    for viejo in MensajeChatTicket.objects.order_by("id").iterator():
        nuevo = MensajeTicket.objects.create(
            ticket_id=viejo.ticket_id,
            autor_id=viejo.autor_id,
            del_solicitante=viejo.del_solicitante,
            interno=False,
            texto=viejo.texto,
        )
        MensajeTicket.objects.filter(pk=nuevo.pk).update(
            created_at=viejo.created_at, updated_at=viejo.updated_at
        )


class Migration(migrations.Migration):
    dependencies = [
        ("soporte", "0010_llamada_del_ticket"),
    ]

    operations = [
        migrations.RunPython(chat_a_la_conversacion, migrations.RunPython.noop),
        migrations.DeleteModel(name="MensajeChatTicket"),
    ]
