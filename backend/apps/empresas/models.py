"""La empresa: el ámbito al que pertenece todo lo que se registra.

Un mismo despliegue atiende a varias empresas del grupo y ninguna debe ver lo
de las otras. La separación es por columna y no por base de datos: son
empresas del mismo grupo, con el mismo administrador de sistemas y el mismo
mantenimiento, y una base por empresa multiplicaría las migraciones, los
respaldos y las conexiones sin resolver nada que una columna bien defendida no
resuelva.

«Bien defendida» es la parte que importa: el filtro no se escribe en cada
consulta —ahí es donde se olvida— sino en el gestor por defecto de cada modelo
(ver `apps.empresas.managers`). Un `Activo.objects.all()` desde una petición
devuelve solo los de la empresa activa; para verlo todo hay que pedirlo
explícitamente con `todas()`, y eso se lee en la revisión.
"""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel

from .contexto import SIN_EMPRESA, empresa_actual
from .managers import GestorPorEmpresa


class Empresa(BaseModel):
    nombre = models.CharField(max_length=120, unique=True)
    codigo = models.CharField(
        max_length=10,
        unique=True,
        help_text="Identificador corto. Ej.: «LC» para LaarCourier.",
    )
    identificacion = models.CharField(
        max_length=20, blank=True, help_text="RUC o identificación tributaria."
    )
    activa = models.BooleanField(default=True)

    # --- Lo que pide la Matriz de obligaciones ---------------------------
    #
    # Los vencimientos y recordatorios de la Matriz se calculan en la hora de
    # cada empresa, no en la del servidor: «vence hoy a las 17:00» tiene que
    # ser hoy y a las 17:00 donde trabaja quien cumple la obligación.

    class BaseDeCumplimiento(models.TextChoices):
        VALIDACION = "validacion", "Fecha de validación"
        ENVIO = "envio", "Fecha de envío a validación"

    zona_horaria = models.CharField(
        max_length=64,
        default="America/Guayaquil",
        help_text="Zona IANA. Se usa en todos los cálculos de vencimientos.",
    )
    #: Identifica la empresa a simple vista: el punto del selector y el borde
    #: de «Tablero activo» en el menú.
    color = models.CharField(max_length=7, default="#164B86")
    #: Aprobador por defecto de los períodos de la Matriz.
    gerente_general = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="empresas_que_gerencia",
    )
    #: Qué fecha cuenta como cumplimiento de una obligación: la de validación
    #: (lo habitual) o la de envío, para empresas que dan por cumplido lo que
    #: se presentó a tiempo aunque se valide después.
    base_cumplimiento = models.CharField(
        max_length=12,
        choices=BaseDeCumplimiento.choices,
        default=BaseDeCumplimiento.VALIDACION,
    )
    #: Si quien **no** ve toda la empresa puede crear obligaciones para otras
    #: personas. Desactivado, tiene que figurar como responsable o suplente
    #: del primer período: si no, no podría volver a verlo —sin `ver_todas`
    #: solo se ve lo propio— y la obligación quedaría a cargo de alguien sin
    #: que quien la registró pueda corregir un error. Activado, se permite, y
    #: lo creado para otro deja de verse en cuanto se guarda.
    matriz_crear_para_otros = models.BooleanField(
        default=False,
        help_text=(
            "Permite que quien no ve toda la empresa cree obligaciones para "
            "otras personas (dejará de verlas al guardarlas)."
        ),
    )

    class Meta:
        ordering = ["nombre"]
        verbose_name = "empresa"
        verbose_name_plural = "empresas"

    def __str__(self) -> str:
        return self.nombre


class MembresiaEmpresa(BaseModel):
    """Qué empresas puede ver cada cuenta.

    Es una tabla propia y no un campo en el usuario porque la misma persona
    trabaja para varias: quien administra el inventario del grupo entra una vez
    y cambia de empresa desde el menú, sin una cuenta por cada una.
    """

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="membresias"
    )
    empresa = models.ForeignKey(Empresa, on_delete=models.CASCADE, related_name="membresias")
    #: La que se abre al entrar. Sin esto, quien pertenece a tres empresas
    #: empezaría cada día en una distinta según cómo ordenara la consulta.
    es_predeterminada = models.BooleanField(default=False)
    #: Lo que la cuenta puede hacer **en esta empresa**.
    #:
    #: Cuelgan de la membresía y no del usuario porque la misma persona no
    #: hace lo mismo en todas: quien administra el inventario de LaarCourier
    #: puede ser solo consulta en LaarSeguridad. Con roles en el usuario, darle
    #: acceso a la segunda empresa le entregaría de paso todos los permisos que
    #: tenía en la primera, que es exactamente el error que nadie detecta hasta
    #: que alguien da de baja un equipo que no era suyo.
    #:
    #: Los roles globales del usuario (`user.groups`) siguen valiendo en todas
    #: las empresas: son los del administrador del grupo, que tiene que poder
    #: entrar a cualquiera.
    roles = models.ManyToManyField(
        "auth.Group",
        blank=True,
        related_name="membresias",
        verbose_name="roles en esta empresa",
    )

    class Meta:
        ordering = ["empresa__nombre"]
        verbose_name = "membresía"
        verbose_name_plural = "membresías"
        constraints = [
            models.UniqueConstraint(
                fields=["usuario", "empresa"], name="membresia_unica_por_usuario"
            )
        ]

    def __str__(self) -> str:
        return f"{self.usuario} → {self.empresa}"


class ModeloDeEmpresa(BaseModel):
    """Base de todo lo que pertenece a una empresa.

    Da dos cosas a la vez, y esa es la idea: el campo y el gestor que filtra
    por él. Un modelo nuevo que herede de aquí queda aislado sin que nadie se
    acuerde de escribir el filtro; uno que herede de `BaseModel` a secas se ve
    desde todas las empresas, que es justo lo que hay que poder distinguir de
    un vistazo al leer la definición.
    """

    empresa = models.ForeignKey(
        "empresas.Empresa",
        on_delete=models.PROTECT,
        related_name="%(app_label)s_%(class)s",
        null=True,
        blank=True,
    )

    objects = GestorPorEmpresa()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        """Lo que se crea durante una petición nace en la empresa activa.

        Se resuelve aquí y no en cada vista porque las altas llegan por muchos
        caminos —formulario, carga masiva, servicios, actas— y el que se olvide
        de ponerla crearía un registro sin empresa: invisible para todos, que
        es un fallo silencioso y de los caros de encontrar.
        """
        if self.empresa_id is None:
            empresa = empresa_actual()
            if empresa is not None and empresa is not SIN_EMPRESA:
                self.empresa = empresa
        return super().save(*args, **kwargs)
