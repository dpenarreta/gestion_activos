"""Qué se describe de cada tipo de equipo.

Las especificaciones se guardaban como pares clave/valor libres, y esa libertad
tenía un precio: la misma característica terminaba escrita como «RAM», «Ram» y
«Memoria RAM» en tres equipos del mismo modelo, y nadie recordaba qué había que
llenar para una cámara. Filtrar o comparar por una característica devolvía un
tercio de lo que hay, que es exactamente la dispersión que este sistema viene a
eliminar del inventario.

Ahora cada tipo declara las suyas: una laptop pide procesador, RAM y disco; una
cámara, resolución y lente. El formulario del activo ofrece esas y no otras, y
el valor sigue guardándose en `Activo.especificaciones` —un JSON, sin columnas
nuevas por cada característica que alguien invente—, con el nombre declarado
como clave.

La lista es por tipo y el tipo es por empresa, así que las características lo
son también: LaarCourier puede describir sus laptops de una manera y
LaarSeguridad de otra sin pisarse.
"""

from django.core.exceptions import ValidationError
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.managers import gestor_de_lo_que_cuelga


class CaracteristicaTipo(BaseModel):
    """Una característica que se describe en todos los equipos de un tipo."""

    class Dato(models.TextChoices):
        """De qué clase es el valor, para poder validarlo y ofrecerlo bien.

        No es decoración del formulario: es lo que permite que «8» y «ocho» no
        convivan en el mismo campo, y que una lista de opciones no acumule tres
        formas de escribir «Windows 11».
        """

        TEXTO = "texto", "Texto"
        NUMERO = "numero", "Número"
        ENTERO = "entero", "Número entero"
        BOOLEANO = "booleano", "Sí / No"
        LISTA = "lista", "Lista de opciones"
        FECHA = "fecha", "Fecha"

    tipo = models.ForeignKey(
        "activos.TipoDispositivo",
        on_delete=models.CASCADE,
        related_name="caracteristicas",
        help_text="El tipo de equipo que se describe con esta característica.",
    )
    #: Es también la clave con la que el valor se guarda en
    #: `Activo.especificaciones`: lo que se ve en el formulario y lo que queda
    #: escrito son la misma palabra, así que renombrarla aquí no deja huérfano
    #: lo ya guardado sin que nadie lo note (ver `save`).
    nombre = models.CharField(max_length=80, help_text="Ej.: «RAM», «Procesador», «Resolución».")
    unidad = models.CharField(
        max_length=20,
        blank=True,
        help_text="Ej.: «GB», «pulgadas». Se muestra junto al valor, no se guarda con él.",
    )
    dato = models.CharField(max_length=10, choices=Dato.choices, default=Dato.TEXTO)
    opciones = models.JSONField(
        default=list,
        blank=True,
        help_text="Valores admitidos cuando el dato es una lista de opciones.",
    )
    obligatoria = models.BooleanField(
        default=False,
        help_text="Si un equipo de este tipo no puede darse de alta sin este dato.",
    )
    orden = models.PositiveSmallIntegerField(
        default=0, help_text="En qué posición aparece dentro del formulario."
    )
    activa = models.BooleanField(
        default=True,
        help_text=(
            "Una característica que se deja de pedir se desactiva, no se borra: "
            "los equipos que ya la tienen conservan su valor."
        ),
    )

    objects = gestor_de_lo_que_cuelga("tipo__empresa")

    class Meta:
        ordering = ["orden", "nombre"]
        verbose_name = "característica del tipo"
        verbose_name_plural = "características del tipo"
        constraints = [
            models.UniqueConstraint(fields=["tipo", "nombre"], name="caracteristica_unica_por_tipo")
        ]

    def __str__(self) -> str:
        return f"{self.tipo.nombre} · {self.nombre}"

    def clean(self):
        if self.dato == self.Dato.LISTA and not self.opciones:
            raise ValidationError(
                {"opciones": "Una lista de opciones necesita al menos una opción."}
            )
        if self.dato != self.Dato.LISTA and self.opciones:
            raise ValidationError(
                {"opciones": "Solo las listas de opciones llevan valores admitidos."}
            )

    def save(self, *args, **kwargs):
        """Renombrarla arrastra el valor ya guardado en cada equipo.

        Sin esto, cambiar «Ram» por «RAM» dejaría el dato anterior escondido en
        el JSON bajo la clave vieja y el formulario pediría llenarlo otra vez:
        la corrección de una errata haría perder el inventario de esa
        característica.
        """
        anterior = None
        if self.pk:
            anterior = type(self).objects.todas().filter(pk=self.pk).values("nombre").first()

        super().save(*args, **kwargs)

        if anterior and anterior["nombre"] != self.nombre:
            self._renombrar_en_los_activos(anterior["nombre"], self.nombre)

    def _renombrar_en_los_activos(self, viejo: str, nuevo: str) -> None:
        from .models import Activo

        equipos = Activo.objects.todas().filter(tipo_id=self.tipo_id)
        for activo in equipos.iterator(chunk_size=500):
            especificaciones = activo.especificaciones or {}
            if viejo not in especificaciones:
                continue
            especificaciones[nuevo] = especificaciones.pop(viejo)
            activo.especificaciones = especificaciones
            activo.save(update_fields=["especificaciones", "updated_at"])

    def normalizar(self, valor):
        """Convierte lo recibido al tipo declarado, o explica por qué no puede.

        Devuelve el valor listo para guardar. Lanza `ValidationError` con un
        mensaje que dice qué se esperaba: un «8 GB» escrito en un campo numérico
        es un error de quien captura, y decírselo en el momento evita que
        aparezca como texto entre números y rompa cualquier comparación.
        """
        if valor is None or valor == "":
            return None

        if self.dato == self.Dato.BOOLEANO:
            if isinstance(valor, bool):
                return valor
            texto = str(valor).strip().lower()
            if texto in {"sí", "si", "true", "1", "x"}:
                return True
            if texto in {"no", "false", "0"}:
                return False
            raise ValidationError(f"«{self.nombre}» admite Sí o No.")

        if self.dato in {self.Dato.NUMERO, self.Dato.ENTERO}:
            try:
                numero = float(str(valor).replace(",", "."))
            except (TypeError, ValueError):
                raise ValidationError(
                    f"«{self.nombre}» espera un número"
                    + (f" en {self.unidad}." if self.unidad else ".")
                ) from None
            if self.dato == self.Dato.ENTERO:
                if numero != int(numero):
                    raise ValidationError(f"«{self.nombre}» espera un número entero.")
                return int(numero)
            return numero

        if self.dato == self.Dato.LISTA:
            texto = str(valor).strip()
            if texto not in self.opciones:
                admitidos = ", ".join(str(opcion) for opcion in self.opciones)
                raise ValidationError(f"«{self.nombre}» admite: {admitidos}.")
            return texto

        if self.dato == self.Dato.FECHA:
            import datetime

            if isinstance(valor, datetime.date):
                return valor.isoformat()
            try:
                return datetime.date.fromisoformat(str(valor).strip()).isoformat()
            except ValueError:
                raise ValidationError(
                    f"«{self.nombre}» espera una fecha con la forma AAAA-MM-DD."
                ) from None

        return str(valor).strip()
