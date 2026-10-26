"""Pone la clave temporal a las cuentas activas y les exige cambiarla
(26/10/2026, pedido de la administración).

    python manage.py restablecer_clave_temporal --excepto dpenarreta@grupolaar.com
    python manage.py restablecer_clave_temporal --excepto dpenarreta@grupolaar.com --confirmar

Sin `--confirmar` solo lista a quiénes se aplicaría; no cambia nada.

- La clave es la de `CLAVE_INICIAL_USUARIOS` (el .env del entorno): nunca se
  pasa por argumento ni se imprime, para que no quede en el historial ni en
  los registros.
- Solo cuentas activas; las deshabilitadas o bloqueadas no se tocan.
- A cada una: la clave temporal, el cambio obligatorio en el próximo ingreso
  y el cierre de sus sesiones abiertas (quien esté dentro vuelve a entrar con
  la temporal y la cambia en ese momento). Queda en la auditoría, sin la clave.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.authentication.services import SessionService
from apps.authentication.validators import clave_temporal
from apps.core.audit import record_audit_event
from apps.users.models import User


class Command(BaseCommand):
    help = "Pone la clave temporal a las cuentas activas y les exige cambiarla al entrar."

    def add_arguments(self, parser):
        parser.add_argument(
            "--excepto",
            nargs="*",
            default=[],
            help="Correos o usuarios que se dejan como están.",
        )
        parser.add_argument(
            "--confirmar",
            action="store_true",
            help="Aplica el cambio. Sin esto, solo lista a quiénes se aplicaría.",
        )

    def handle(self, *args, excepto, confirmar, **options):
        temporal = clave_temporal()
        if not temporal:
            raise CommandError(
                "No hay clave temporal configurada (CLAVE_INICIAL_USUARIOS en el .env). "
                "Fíjela con scripts/deploy/establecer-clave-temporal.ps1."
            )
        excluidos = {e.strip().lower() for e in excepto if e.strip()}
        cuentas = [
            u
            for u in User.objects.filter(status=User.Status.ACTIVE).order_by("username")
            if u.email.lower() not in excluidos and u.username.lower() not in excluidos
        ]
        quedan = sorted(
            u.username
            for u in User.objects.filter(status=User.Status.ACTIVE)
            if u.email.lower() in excluidos or u.username.lower() in excluidos
        )
        for u in cuentas:
            self.stdout.write(f"  {u.username} <{u.email}>")
        self.stdout.write(f"Cuentas activas a las que se aplica: {len(cuentas)}.")
        self.stdout.write(f"Se dejan como están: {', '.join(quedan) or 'ninguna'}.")
        if not confirmar:
            self.stdout.write("Solo se listó: para aplicarlo, vuelva a correrlo con --confirmar.")
            return

        sesiones = 0
        with transaction.atomic():
            for u in cuentas:
                u.set_password(temporal)
                u.must_change_password = True
                u.save(update_fields=["password", "must_change_password", "updated_at"])
                sesiones += SessionService.logout_all(u)
                record_audit_event(
                    actor=None,
                    action="user.password_reset_temporal",
                    target=u,
                    module="usuarios",
                    new_values={"must_change_password": True, "sesiones_cerradas": True},
                )
        self.stdout.write(
            self.style.SUCCESS(
                f"Listo: {len(cuentas)} cuentas con la clave temporal y cambio obligatorio; "
                f"{sesiones} sesiones cerradas."
            )
        )
