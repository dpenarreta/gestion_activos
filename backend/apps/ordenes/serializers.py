from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.organizacion.models import Proveedor, Sede

from . import services
from .models import ManoDeObraOrden, MaterialOrden, MovimientoOrden, OrdenTrabajo

User = get_user_model()


def enmascarar_telefono(telefono: str) -> str:
    """Deja ver los tres últimos dígitos: alcanza para reconocerlo, no para
    llamar. Quien necesita el número completo para su función tiene
    `ordenes.ver_contacto`."""
    digitos = [c for c in telefono or "" if c.isdigit()]
    if not digitos:
        return ""
    return "•" * max(len(digitos) - 3, 0) + "".join(digitos[-3:])


def _nombre(usuario):
    return (usuario.get_full_name() or usuario.username) if usuario else ""


class _ConUsuario(serializers.Serializer):
    def _usuario(self):
        return self.context["request"].user


class OrdenListaSerializer(_ConUsuario, serializers.ModelSerializer):
    numero = serializers.CharField(read_only=True)
    sede = serializers.SerializerMethodField()
    categoria_display = serializers.CharField(source="get_categoria_display", read_only=True)
    prioridad_display = serializers.CharField(source="get_prioridad_display", read_only=True)
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)
    solicitante = serializers.SerializerMethodField()
    tecnico = serializers.SerializerMethodField()
    proveedor = serializers.SerializerMethodField()
    responsable = serializers.SerializerMethodField()
    cumplimiento = serializers.SerializerMethodField()
    contacto = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()

    class Meta:
        model = OrdenTrabajo
        fields = [
            "id",
            "numero",
            "sede",
            "categoria",
            "categoria_display",
            "prioridad",
            "prioridad_display",
            "estado",
            "estado_display",
            "titulo",
            "solicitante",
            "tecnico",
            "proveedor",
            "responsable",
            "fecha_programada",
            "cumplimiento",
            "contacto",
            "total",
            "con_observaciones",
            "created_at",
        ]

    def get_sede(self, orden):
        sede = orden.sede
        return {
            "id": sede.id,
            "nombre": sede.nombre,
            "ciudad": sede.ciudad,
            "region": sede.region,
            "region_display": sede.get_region_display(),
            "provincia": sede.provincia,
        }

    def get_solicitante(self, orden):
        return {"id": orden.solicitante_id, "nombre": _nombre(orden.solicitante)}

    def get_tecnico(self, orden):
        return (
            {"id": orden.tecnico_id, "nombre": _nombre(orden.tecnico)} if orden.tecnico_id else None
        )

    def get_proveedor(self, orden):
        if not orden.proveedor_id:
            return None
        return {"id": orden.proveedor_id, "nombre": orden.proveedor.nombre}

    def get_responsable(self, orden):
        if not orden.tecnico_id:
            return "Sin asignar"
        texto = _nombre(orden.tecnico)
        return f"{texto} ({orden.proveedor.nombre})" if orden.proveedor_id else texto

    def get_cumplimiento(self, orden):
        return orden.cumplimiento()

    def get_contacto(self, orden):
        if services.tiene(self._usuario(), "ver_contacto"):
            return orden.telefono_contacto
        return enmascarar_telefono(orden.telefono_contacto)

    def get_total(self, orden):
        return str(orden.costos()["total"])


class MaterialSerializer(serializers.ModelSerializer):
    subtotal = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = MaterialOrden
        fields = ["id", "descripcion", "cantidad", "costo_unitario", "subtotal"]


class ManoDeObraSerializer(serializers.ModelSerializer):
    subtotal = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = ManoDeObraOrden
        fields = ["id", "descripcion", "horas", "costo_hora", "subtotal"]


class MovimientoSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()
    estado_anterior_display = serializers.CharField(
        source="get_estado_anterior_display", read_only=True
    )
    estado_nuevo_display = serializers.CharField(source="get_estado_nuevo_display", read_only=True)

    class Meta:
        model = MovimientoOrden
        fields = [
            "id",
            "descripcion",
            "nota",
            "actor",
            "estado_anterior",
            "estado_anterior_display",
            "estado_nuevo",
            "estado_nuevo_display",
            "created_at",
        ]

    def get_actor(self, movimiento):
        return _nombre(movimiento.actor) or "Sistema"


class OrdenDetalleSerializer(OrdenListaSerializer):
    materiales = MaterialSerializer(many=True, read_only=True)
    mano_de_obra = ManoDeObraSerializer(many=True, read_only=True)
    movimientos = MovimientoSerializer(many=True, read_only=True)
    costos = serializers.SerializerMethodField()
    permisos = serializers.SerializerMethodField()

    class Meta(OrdenListaSerializer.Meta):
        fields = OrdenListaSerializer.Meta.fields + [
            "descripcion",
            "telefono_contacto_editable",
            "fecha_cierre",
            "observaciones_cierre",
            "materiales",
            "mano_de_obra",
            "movimientos",
            "costos",
            "permisos",
        ]

    telefono_contacto_editable = serializers.SerializerMethodField()

    def get_telefono_contacto_editable(self, orden):
        """El número completo solo para quien puede corregirlo y verlo."""
        usuario = self._usuario()
        if services.puede_editarla(usuario, orden) and (
            services.tiene(usuario, "ver_contacto") or orden.solicitante_id == usuario.id
        ):
            return orden.telefono_contacto
        return None

    def get_costos(self, orden):
        return {clave: str(valor) for clave, valor in orden.costos().items()}

    def get_permisos(self, orden):
        usuario = self._usuario()
        return {
            "editar": services.puede_editarla(usuario, orden),
            "asignar": services.es_gestor(usuario) and not orden.esta_cerrada,
            "registrar_costos": services.puede_registrar_costos(usuario, orden),
            "acciones": services.acciones_disponibles(usuario, orden),
        }


class OrdenEscrituraSerializer(serializers.ModelSerializer):
    #: El queryset se pone al construir el serializer, no al importar el
    #: módulo: el gestor de `Sede` filtra por la empresa activa en el momento
    #: en que se crea la consulta, y fijarlo al importar dejaría la empresa de
    #: la primera petición para todas las demás.
    sede = serializers.PrimaryKeyRelatedField(queryset=Sede.objects.none())

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["sede"].queryset = Sede.objects.all()

    class Meta:
        model = OrdenTrabajo
        fields = ["sede", "categoria", "prioridad", "titulo", "descripcion", "telefono_contacto"]

    def validate_sede(self, sede):
        if not sede.activa:
            raise serializers.ValidationError("La sede está cerrada: elija una sede activa.")
        return sede

    def validate_telefono_contacto(self, valor):
        valor = (valor or "").strip()
        digitos = [c for c in valor if c.isdigit()]
        if valor and not 7 <= len(digitos) <= 15:
            raise serializers.ValidationError("Escriba un teléfono de 7 a 15 dígitos.")
        return valor


class AsignacionSerializer(serializers.Serializer):
    tecnico = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True))
    proveedor = serializers.PrimaryKeyRelatedField(
        queryset=Proveedor.objects.none(), required=False, allow_null=True
    )
    fecha_programada = serializers.DateField(required=False, allow_null=True)
    nota = serializers.CharField(required=False, allow_blank=True, max_length=2000)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["proveedor"].queryset = Proveedor.objects.all()


class CambioDeEstadoSerializer(serializers.Serializer):
    estado = serializers.ChoiceField(choices=OrdenTrabajo.Estado.choices)
    nota = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    fecha_programada = serializers.DateField(required=False, allow_null=True)
    con_observaciones = serializers.BooleanField(required=False, default=False)
