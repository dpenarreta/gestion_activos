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
            # Desde US-006 una orden puede quedar a cargo de un proveedor sin
            # persona con cuenta (p. ej. un técnico independiente).
            return orden.proveedor.nombre if orden.proveedor_id else "Sin asignar"
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


class OrdenCreacionSerializer(OrdenEscrituraSerializer):
    """El alta: los datos de la orden más quién la realiza y para cuándo
    (11/11/2026, US-006).

    Aparte del de corrección a propósito: el responsable no se cambia con un
    `PATCH`, se reasigna con `asignar`, que tiene su permiso y su historial.
    Los tres campos llegan opcionales aquí y los exige
    `services.validar_responsable_y_fecha`, que da el error en `responsable`
    cuando faltan los dos y el mensaje propio de la fecha.
    """

    tecnico = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True), required=False, allow_null=True
    )
    proveedor = serializers.PrimaryKeyRelatedField(
        queryset=Proveedor.objects.none(), required=False, allow_null=True
    )
    fecha_programada = serializers.DateField(required=False, allow_null=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["proveedor"].queryset = Proveedor.objects.all()

    class Meta(OrdenEscrituraSerializer.Meta):
        fields = OrdenEscrituraSerializer.Meta.fields + [
            "tecnico",
            "proveedor",
            "fecha_programada",
        ]


class ProveedorRapidoSerializer(serializers.Serializer):
    """Los datos mínimos de un proveedor nuevo registrado desde la orden.

    Nombre o razón social y una forma de contactarlo (teléfono o correo): es
    lo que se necesita cuando hay que llamarlo. El resto de la ficha (RUC,
    observaciones) se completa en el catálogo de proveedores.
    """

    nombre = serializers.CharField(max_length=150)
    contacto = serializers.CharField(max_length=120, required=False, allow_blank=True)
    telefono = serializers.CharField(max_length=30, required=False, allow_blank=True)
    correo = serializers.EmailField(max_length=254, required=False, allow_blank=True)
    identificacion = serializers.CharField(max_length=20, required=False, allow_blank=True)

    def validate_nombre(self, valor):
        valor = " ".join((valor or "").split())
        if not valor:
            raise serializers.ValidationError("Escriba el nombre o la razón social.")
        return valor

    def validate_identificacion(self, valor):
        """Cédula (10 dígitos) o RUC (13) si es un número; una identificación
        tributaria extranjera puede llevar letras y se deja pasar."""
        valor = (valor or "").strip()
        if valor.isdigit() and len(valor) not in (10, 13):
            raise serializers.ValidationError(
                "Escriba la cédula (10 dígitos) o el RUC (13 dígitos)."
            )
        return valor

    def validate_telefono(self, valor):
        valor = (valor or "").strip()
        digitos = [c for c in valor if c.isdigit()]
        if valor and not 7 <= len(digitos) <= 15:
            raise serializers.ValidationError("Escriba un teléfono de 7 a 15 dígitos.")
        return valor

    def validate(self, datos):
        datos = {k: (v.strip() if isinstance(v, str) else v) for k, v in datos.items()}
        if not datos.get("telefono") and not datos.get("correo"):
            raise serializers.ValidationError(
                {"telefono": "Indique un teléfono o un correo para contactarlo."}
            )
        return datos


class AsignacionSerializer(serializers.Serializer):
    """Asignar, reasignar o reprogramar. Desde US-006 el técnico es opcional
    (una orden puede quedar solo a cargo de un proveedor): el campo que no se
    envía conserva lo que había y `null` lo quita. Las reglas, en
    `services.OrdenService.asignar`."""

    tecnico = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True), required=False, allow_null=True
    )
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
