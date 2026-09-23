"""Lo que viaja entre el formulario de solicitudes y la API."""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as ErrorDeModelo
from rest_framework import serializers

from apps.activos.especificaciones import validar as validar_especificaciones
from apps.activos.models import TipoDispositivo
from apps.activos.models_caracteristicas import CaracteristicaTipo
from apps.empresas.campos import RelacionDeEmpresa
from apps.mantenimientos.models import CatalogoComponente

from .encargados import encargados_posibles
from .models import MovimientoSolicitud, Solicitud

User = get_user_model()


def nombre_de(usuario) -> str:
    """Cómo se nombra a una persona en pantalla.

    El nombre completo si lo hay y el usuario si no: una bandeja que dice
    «jperez» obliga a traducir mentalmente quién es cada uno.
    """
    if usuario is None:
        return ""
    completo = f"{usuario.first_name} {usuario.last_name}".strip()
    return completo or usuario.get_username()


class EncargadoSerializer(serializers.ModelSerializer):
    """A quién se le puede asignar una solicitud.

    **Sin el correo.** El desplegable solo necesita el nombre, y devolverlo
    repartía la dirección de todo el personal de compras a cualquiera que pueda
    ver solicitudes —incluido el rol «Usuario final», que existe justamente para
    no ver nada más que lo suyo—. Un dato personal que la pantalla no usa es un
    dato personal que no hay por qué exponer.
    """

    nombre = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "nombre"]

    def get_nombre(self, obj) -> str:
        return nombre_de(obj)


class CaracteristicaParaPedirSerializer(serializers.ModelSerializer):
    """Una característica del tipo, como la necesita el formulario de pedido.

    Lleva `obligatoria` para poder señalarla —«esto es lo que siempre se
    especifica de una laptop»— pero el servidor no la exige aquí: es una guía de
    qué conviene decir, no un requisito de algo que aún no se ha comprado.
    """

    class Meta:
        model = CaracteristicaTipo
        fields = ["id", "nombre", "dato", "unidad", "opciones", "obligatoria", "orden"]


class MovimientoSolicitudSerializer(serializers.ModelSerializer):
    estado_nuevo_display = serializers.CharField(source="get_estado_nuevo_display", read_only=True)
    estado_anterior_display = serializers.CharField(
        source="get_estado_anterior_display", read_only=True
    )
    actor_nombre = serializers.SerializerMethodField()

    class Meta:
        model = MovimientoSolicitud
        fields = [
            "id",
            "estado_anterior",
            "estado_anterior_display",
            "estado_nuevo",
            "estado_nuevo_display",
            "actor_nombre",
            "nota",
            "created_at",
        ]

    def get_actor_nombre(self, obj) -> str:
        return nombre_de(obj.actor)


class SolicitudSerializer(serializers.ModelSerializer):
    """La solicitud como la lee una pantalla: con los nombres ya resueltos."""

    solicitante_nombre = serializers.SerializerMethodField()
    encargado_nombre = serializers.SerializerMethodField()
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)
    clase_display = serializers.CharField(source="get_clase_display", read_only=True)
    prioridad_display = serializers.CharField(source="get_prioridad_display", read_only=True)
    lo_que_se_pide = serializers.CharField(read_only=True)
    esta_cerrada = serializers.BooleanField(read_only=True)
    movimientos = MovimientoSolicitudSerializer(many=True, read_only=True)

    class Meta:
        model = Solicitud
        fields = [
            "id",
            "solicitante",
            "solicitante_nombre",
            "encargado",
            "encargado_nombre",
            "clase",
            "clase_display",
            "tipo_dispositivo",
            "componente",
            "detalle",
            "lo_que_se_pide",
            "especificaciones",
            "cantidad",
            "justificacion",
            "prioridad",
            "prioridad_display",
            "fecha_necesaria",
            "estado",
            "estado_display",
            "esta_cerrada",
            "movimientos",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_solicitante_nombre(self, obj) -> str:
        return nombre_de(obj.solicitante)

    def get_encargado_nombre(self, obj) -> str:
        return nombre_de(obj.encargado)


class SolicitudWriteSerializer(serializers.ModelSerializer):
    """El formulario de «Realizar solicitud».

    El solicitante no viaja: es quien está autenticado. Mandarlo desde el
    cliente dejaría pedir en nombre de otro, y «Mis solicitudes» dejaría de
    querer decir lo que dice.
    """

    tipo_dispositivo = RelacionDeEmpresa(
        TipoDispositivo, {"activo": True}, required=False, allow_null=True
    )
    componente = RelacionDeEmpresa(
        CatalogoComponente, {"activo": True}, required=False, allow_null=True
    )
    #: Solo quien puede gestionarlas: asignarle una solicitud a quien no tiene
    #: cómo atenderla es dejarla en un buzón que nadie abre.
    encargado = serializers.PrimaryKeyRelatedField(queryset=User.objects.none())

    class Meta:
        model = Solicitud
        fields = [
            "encargado",
            "clase",
            "tipo_dispositivo",
            "componente",
            "detalle",
            "especificaciones",
            "cantidad",
            "justificacion",
            "prioridad",
            "fecha_necesaria",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # En cada petición, no al importar: quién puede gestionar depende de la
        # empresa activa, y al importar todavía no hay ninguna (es el mismo
        # motivo por el que existe `RelacionDeEmpresa`).
        self.fields["encargado"].queryset = encargados_posibles()

    def validate_especificaciones(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError(
                "Las características se mandan como pares nombre/valor."
            )
        return value

    def validate(self, attrs):
        """Se reutiliza `clean()` del modelo en vez de repetir sus reglas.

        Que una solicitud diga qué se pide no es un caso distinto según entre
        por el formulario o por un comando.
        """
        datos = {**self._del_instance(), **attrs}
        instancia = Solicitud(
            solicitante=self._solicitante(),
            encargado=datos.get("encargado"),
            clase=datos.get("clase", Solicitud.Clase.DISPOSITIVO),
            tipo_dispositivo=datos.get("tipo_dispositivo"),
            componente=datos.get("componente"),
            detalle=(datos.get("detalle") or "").strip(),
            cantidad=datos.get("cantidad", 1),
            justificacion=datos.get("justificacion", ""),
        )
        try:
            instancia.clean()
        except ErrorDeModelo as error:
            raise serializers.ValidationError(
                error.message_dict if hasattr(error, "message_dict") else error.messages
            ) from error

        attrs["especificaciones"] = self._contra_el_tipo(
            datos.get("tipo_dispositivo"), datos.get("especificaciones") or {}
        )
        return attrs

    def _contra_el_tipo(self, tipo, especificaciones):
        """Las características del tipo, con las mismas exigencias que la ficha.

        Se valida que existan, que el valor sea del dato declarado —un número
        donde va un número, una opción de la lista— y que estén las marcadas
        obligatorias: si se declaró que de una laptop siempre se dice la RAM,
        una solicitud que no la diga es una que habrá que devolver preguntando.
        Lo que no deba exigirse al pedir se desmarca en la característica.

        Sin tipo del catálogo no hay nada contra qué comprobar: una solicitud
        escrita a mano no lleva características.
        """
        if tipo is None:
            return {}
        limpias, errores = validar_especificaciones(tipo, especificaciones)
        if errores:
            raise serializers.ValidationError({"especificaciones": errores})
        return limpias

    def _del_instance(self) -> dict:
        if self.instance is None:
            return {}
        return {
            "encargado": self.instance.encargado,
            "clase": self.instance.clase,
            "tipo_dispositivo": self.instance.tipo_dispositivo,
            "componente": self.instance.componente,
            "detalle": self.instance.detalle,
            "especificaciones": self.instance.especificaciones,
            "cantidad": self.instance.cantidad,
            "justificacion": self.instance.justificacion,
        }

    def _solicitante(self):
        if self.instance is not None:
            return self.instance.solicitante
        peticion = self.context.get("request")
        return getattr(peticion, "user", None)


class CambioDeEstadoSerializer(serializers.Serializer):
    """Un paso del recorrido, con su motivo."""

    estado = serializers.ChoiceField(choices=Solicitud.Estado.choices)
    nota = serializers.CharField(required=False, allow_blank=True, default="")
