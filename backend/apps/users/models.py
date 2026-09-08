from django.contrib.auth.models import AbstractUser
from django.db import models

from apps.core.models import BaseModel


class User(AbstractUser, BaseModel):
    """Modelo de usuario. El hashing de contraseñas lo gestiona Django
    (PASSWORD_HASHERS, ver settings) — nunca se manipulan hashes a mano.

    `status` es la fuente de verdad para habilitar/deshabilitar/bloquear una
    cuenta; `is_active` (usado internamente por Django y por
    SessionAuthentication) se mantiene sincronizado en `save()` para que
    ningún mecanismo existente (autenticación, señal de revocación de
    sesiones) tenga que conocer `status`.
    """

    class Status(models.TextChoices):
        ACTIVE = "active", "Activo"
        DISABLED = "disabled", "Deshabilitado"
        BLOCKED = "blocked", "Bloqueado"

    email = models.EmailField(unique=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    # Forzado por un administrador (ver PasswordResetService.admin_initiate_reset):
    # exigido en cada request autenticado por SessionAuthentication.authenticate()
    # hasta que el usuario complete POST /api/auth/password/change/.
    must_change_password = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="created_users"
    )
    updated_by = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="updated_users"
    )

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS = ["email"]

    def save(self, *args, **kwargs):
        self.is_active = self.status == self.Status.ACTIVE
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.username
