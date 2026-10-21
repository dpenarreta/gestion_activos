from rest_framework import serializers

from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.organizacion.models import Sede
from apps.users.models import User

from .acceso import acciones
from .estados import estado
from .models import (
    DE_DIA_Y_MES,
    Area,
    ConfiguracionRecordatorios,
    Documento,
    EntidadControl,
    EventoPeriodo,
    Notificacion,
    Obligacion,
    Periodicidad,
    Periodo,
    Prioridad,
)

# --- Catálogos ---------------------------------------------------------------


class _CatalogoSerializer(serializers.ModelSerializer):
    class Meta:
        fields = ["id", "codigo", "nombre"]

    def validate_codigo(self, value: str) -> str:
        limpio = value.strip().upper()
        if not limpio:
            raise serializers.ValidationError("El código no puede quedar vacío.")
        return limpio

    def validate_nombre(self, value: str) -> str:
        limpio = value.strip()
        if not limpio:
            raise serializers.ValidationError("El nombre no puede quedar vacío.")
        return limpio


class AreaSerializer(_CatalogoSerializer):
    class Meta(_CatalogoSerializer.Meta):
        model = Area


class EntidadControlSerializer(_CatalogoSerializer):
    class Meta(_CatalogoSerializer.Meta):
        model = EntidadControl


# --- Personas -----------------------------------------------------------------


def trabaja_en(usuario, empresa) -> bool:
    """Si la cuenta trabaja en la empresa: responsables, suplentes,
    supervisores y aprobadores deben poder entrar a ella (§4.7).

    Con una sola empresa activa, todas las cuentas trabajan en ella sin
    membresía (ver `apps.empresas.servicios.empresas_de`).
    """
    if not usuario.is_active:
        return False
    if MembresiaEmpresa.objects.filter(usuario=usuario, empresa=empresa).exists():
        return True
    return Empresa.objects.filter(activa=True).count() == 1


def persona(usuario) -> dict | None:
    if usuario is None:
        return None
    return {
        "id": usuario.id,
        "nombre": usuario.get_full_name() or usuario.username,
        "email": usuario.email,
    }


class _PersonaDeLaEmpresa(serializers.PrimaryKeyRelatedField):
    """Una cuenta que trabaja en la empresa activa."""

    def get_queryset(self):
        return User.objects.filter(is_active=True)

    def to_internal_value(self, data):
        usuario = super().to_internal_value(data)
        empresa = self.context["empresa"]
        if not trabaja_en(usuario, empresa):
            raise serializers.ValidationError(f"{usuario} no trabaja en {empresa}.")
        return usuario


class _SedeDeLaEmpresa(serializers.PrimaryKeyRelatedField):
    def get_queryset(self):
        # El gestor ya acota a la empresa activa.
        return Sede.objects.all()


# --- Obligación -----------------------------------------------------------------


class ObligacionSerializer(serializers.ModelSerializer):
    """La plantilla: lectura y edición (§11.2). No toca los períodos creados."""

    area_nombre = serializers.CharField(source="area.nombre", read_only=True)
    entidad_nombre = serializers.CharField(source="entidad.nombre", read_only=True)

    class Meta:
        model = Obligacion
        fields = [
            "id",
            "nombre",
            "descripcion",
            "area",
            "area_nombre",
            "entidad",
            "entidad_nombre",
            "tipo",
            "periodicidad",
            "fundamento_legal",
            "fundamento_url",
            "evidencia_esperada",
            "dia_vencimiento",
            "mes_vencimiento",
            "hora_vencimiento",
            "prioridad_defecto",
            "activa",
        ]

    def validate_nombre(self, value: str) -> str:
        limpio = value.strip()
        repetida = Obligacion.objects.filter(nombre__iexact=limpio)
        if self.instance is not None:
            repetida = repetida.exclude(pk=self.instance.pk)
        if repetida.exists():
            raise serializers.ValidationError(
                "Ya existe una obligación con ese nombre en la empresa."
            )
        return limpio

    def validate_evidencia_esperada(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Indique qué evidencia respalda el cumplimiento.")
        return value.strip()

    def validate(self, attrs):
        """El mes del vencimiento solo sirve en una anual, y con su día: sin
        día la regla no dice qué fecha es y el primer vencimiento saldría de
        «hoy + 30» sin que nadie lo note."""
        attrs = super().validate(attrs)

        def valor(campo):
            if campo in attrs:
                return attrs[campo]
            return getattr(self.instance, campo, None)

        mes, dia = valor("mes_vencimiento"), valor("dia_vencimiento")
        if mes and valor("periodicidad") not in DE_DIA_Y_MES:
            raise serializers.ValidationError(
                {
                    "mes_vencimiento": "El mes del vencimiento solo aplica a las anuales "
                    "y a las de varios años."
                }
            )
        if mes and not dia:
            raise serializers.ValidationError(
                {"dia_vencimiento": "Indique el día junto con el mes del vencimiento."}
            )
        return attrs


class ObligacionAltaSerializer(ObligacionSerializer):
    """La obligación más los datos de su primer período (§11.1)."""

    fecha_vencimiento = serializers.DateField(required=False, allow_null=True)
    hora = serializers.TimeField(required=False, allow_null=True)
    etiqueta = serializers.CharField(required=False, allow_blank=True, max_length=60)
    fecha_inicio = serializers.DateField(required=False, allow_null=True)
    fecha_preparacion = serializers.DateField(required=False, allow_null=True)
    responsable = _PersonaDeLaEmpresa()
    suplente = _PersonaDeLaEmpresa(required=False, allow_null=True)
    supervisor = _PersonaDeLaEmpresa(required=False, allow_null=True)
    aprobador = _PersonaDeLaEmpresa(required=False, allow_null=True)
    prioridad = serializers.ChoiceField(choices=Prioridad.choices, required=False)
    sede = _SedeDeLaEmpresa(required=False, allow_null=True)
    observaciones = serializers.CharField(required=False, allow_blank=True)

    CAMPOS_PERIODO = [
        "fecha_vencimiento",
        "hora",
        "etiqueta",
        "fecha_inicio",
        "fecha_preparacion",
        "responsable",
        "suplente",
        "supervisor",
        "aprobador",
        "prioridad",
        "sede",
        "observaciones",
    ]

    class Meta(ObligacionSerializer.Meta):
        fields = ObligacionSerializer.Meta.fields + [
            "fecha_vencimiento",
            "hora",
            "etiqueta",
            "fecha_inicio",
            "fecha_preparacion",
            "responsable",
            "suplente",
            "supervisor",
            "aprobador",
            "prioridad",
            "sede",
            "observaciones",
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        suplente = attrs.get("suplente")
        if suplente is not None and suplente == attrs.get("responsable"):
            raise serializers.ValidationError(
                {"suplente": "El suplente tiene que ser otra persona que el responsable."}
            )
        inicio, preparacion = attrs.get("fecha_inicio"), attrs.get("fecha_preparacion")
        vence = attrs.get("fecha_vencimiento")
        if inicio and preparacion and inicio > preparacion:
            raise serializers.ValidationError(
                {"fecha_preparacion": "La preparación no puede ser anterior al inicio."}
            )
        if vence and preparacion and preparacion > vence:
            raise serializers.ValidationError(
                {"fecha_preparacion": "La preparación no puede ser posterior al vencimiento."}
            )
        if vence and inicio and inicio > vence:
            raise serializers.ValidationError(
                {"fecha_inicio": "El inicio no puede ser posterior al vencimiento."}
            )
        return attrs

    def separar(self) -> tuple[dict, dict]:
        """Lo de la plantilla y lo del primer período, por separado."""
        datos = dict(self.validated_data)
        periodo = {campo: datos.pop(campo) for campo in self.CAMPOS_PERIODO if campo in datos}
        if "hora" in periodo:
            periodo["hora_vencimiento"] = periodo.pop("hora")
        return datos, {k: v for k, v in periodo.items() if v not in (None, "")}


# --- Período -----------------------------------------------------------------


class PeriodoListaSerializer(serializers.ModelSerializer):
    """Una fila de la matriz."""

    obligacion = serializers.SerializerMethodField()
    area = serializers.CharField(source="obligacion.area.nombre")
    entidad = serializers.CharField(source="obligacion.entidad.nombre")
    responsable = serializers.SerializerMethodField()
    estado = serializers.SerializerMethodField()

    class Meta:
        model = Periodo
        fields = [
            "id",
            "codigo",
            "etiqueta",
            "obligacion",
            "area",
            "entidad",
            "responsable",
            "prioridad",
            "vence_en",
            "etapa",
            "avance",
            "cerrado",
            "estado",
        ]

    def get_obligacion(self, obj):
        return {"id": obj.obligacion_id, "nombre": obj.obligacion.nombre}

    def get_responsable(self, obj):
        return persona(obj.responsable)

    def get_estado(self, obj):
        return estado(obj, self.context.get("ahora"))


class PeriodoDetalleSerializer(PeriodoListaSerializer):
    """El detalle del período, con `actions` calculadas en el servidor (§8.10)."""

    obligacion = ObligacionSerializer(read_only=True)
    empresa = serializers.SerializerMethodField()
    sede = serializers.SerializerMethodField()
    suplente = serializers.SerializerMethodField()
    supervisor = serializers.SerializerMethodField()
    aprobador = serializers.SerializerMethodField()
    validado_por = serializers.SerializerMethodField()
    acciones = serializers.SerializerMethodField()

    class Meta(PeriodoListaSerializer.Meta):
        fields = PeriodoListaSerializer.Meta.fields + [
            "empresa",
            "sede",
            "fecha_inicio",
            "fecha_preparacion",
            "suplente",
            "supervisor",
            "aprobador",
            "observaciones",
            "enviado_en",
            "cumplido_en",
            "validado_en",
            "validado_por",
            "recordatorios_suspendidos",
            "acciones",
        ]

    def get_empresa(self, obj):
        return {
            "id": obj.empresa_id,
            "nombre": obj.empresa.nombre,
            "zona_horaria": obj.empresa.zona_horaria,
        }

    def get_sede(self, obj):
        return {"id": obj.sede_id, "nombre": obj.sede.nombre} if obj.sede else None

    def get_suplente(self, obj):
        return persona(obj.suplente)

    def get_supervisor(self, obj):
        return persona(obj.supervisor)

    def get_aprobador(self, obj):
        return persona(obj.aprobador)

    def get_validado_por(self, obj):
        return persona(obj.validado_por)

    def get_acciones(self, obj):
        return acciones(obj, self.context["request"].user, self.context["capacidades"])


class SeguimientoSerializer(serializers.Serializer):
    """Lo editable del seguimiento de un período (§10, «Editar seguimiento»)."""

    responsable = _PersonaDeLaEmpresa(required=False)
    suplente = _PersonaDeLaEmpresa(required=False, allow_null=True)
    supervisor = _PersonaDeLaEmpresa(required=False, allow_null=True)
    aprobador = _PersonaDeLaEmpresa(required=False, allow_null=True)
    prioridad = serializers.ChoiceField(choices=Prioridad.choices, required=False)
    avance = serializers.IntegerField(required=False, min_value=0, max_value=100)
    observaciones = serializers.CharField(required=False, allow_blank=True)
    sede = _SedeDeLaEmpresa(required=False, allow_null=True)


class EventoSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()

    class Meta:
        model = EventoPeriodo
        fields = [
            "id",
            "created_at",
            "actor",
            "accion",
            "descripcion",
            "motivo",
            "valor_anterior",
            "valor_nuevo",
        ]

    def get_actor(self, obj):
        return persona(obj.actor)["nombre"] if obj.actor else "Sistema"


class DocumentoSerializer(serializers.ModelSerializer):
    """Una evidencia, sin la ruta en disco: el archivo solo se entrega por su
    endpoint, que comprueba permisos y deja traza (§11.4)."""

    subido_por = serializers.SerializerMethodField()
    rechazado_por = serializers.SerializerMethodField()

    class Meta:
        model = Documento
        fields = [
            "id",
            "nombre_original",
            "version",
            "tamano",
            "estado",
            "created_at",
            "subido_por",
            "motivo_rechazo",
            "rechazado_por",
            "rechazado_en",
        ]

    def get_subido_por(self, obj):
        return persona(obj.subido_por)

    def get_rechazado_por(self, obj):
        return persona(obj.rechazado_por)


class MotivoSerializer(serializers.Serializer):
    reason = serializers.CharField(allow_blank=True)


class CambioVencimientoSerializer(serializers.Serializer):
    due_date = serializers.DateField()
    due_time = serializers.TimeField(required=False, allow_null=True)
    reason = serializers.CharField(allow_blank=True)


# --- Recordatorios (fase 4) ----------------------------------------------------


class ConfiguracionRecordatoriosSerializer(serializers.ModelSerializer):
    """La configuración de la empresa (§4.10), con los nombres de la API."""

    offsets = serializers.ListField(
        source="anticipaciones",
        child=serializers.IntegerField(min_value=0, max_value=90),
        allow_empty=True,
    )
    send_time = serializers.TimeField(source="hora_envio", format="%H:%M")
    copy_backup = serializers.BooleanField(source="copia_suplente")
    escalation_enabled = serializers.BooleanField(source="escalamiento_activo")
    escalation_days = serializers.IntegerField(
        source="dias_escalamiento", min_value=1, max_value=30
    )
    escalation_repeat_days = serializers.IntegerField(
        source="repetir_escalamiento_cada", min_value=0, max_value=30
    )

    class Meta:
        model = ConfiguracionRecordatorios
        fields = [
            "offsets",
            "send_time",
            "copy_backup",
            "escalation_enabled",
            "escalation_days",
            "escalation_repeat_days",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]

    def validate_offsets(self, valores):
        if len(valores) != len(set(valores)):
            raise serializers.ValidationError("Las anticipaciones no se pueden repetir.")
        # El día del vencimiento siempre va (§4.10).
        return sorted(set(valores) | {0}, reverse=True)


class NotificacionSerializer(serializers.ModelSerializer):
    destinatario = serializers.SerializerMethodField()
    disparado_por = serializers.SerializerMethodField()
    periodo = serializers.SerializerMethodField()
    tipo_nombre = serializers.CharField(source="get_tipo_display", read_only=True)

    class Meta:
        model = Notificacion
        fields = [
            "id",
            "periodo",
            "tipo",
            "tipo_nombre",
            "anticipacion",
            "destinatario",
            "correo",
            "programada_para",
            "estado",
            "intentos",
            "ultimo_error",
            "enviado_en",
            "created_at",
            "reintento_de",
            "disparado_por",
        ]

    def get_destinatario(self, obj):
        return persona(obj.destinatario)

    def get_disparado_por(self, obj):
        return persona(obj.disparado_por)["nombre"] if obj.disparado_por else "Sistema"

    def get_periodo(self, obj):
        return {
            "id": obj.periodo_id,
            "codigo": obj.periodo.codigo,
            "etiqueta": obj.periodo.etiqueta,
            "obligacion": obj.periodo.obligacion.nombre,
        }


class EventoAuditoriaSerializer(EventoSerializer):
    """Una línea del historial de la empresa: la del período, más cuál."""

    periodo = serializers.SerializerMethodField()

    class Meta(EventoSerializer.Meta):
        fields = EventoSerializer.Meta.fields + ["periodo"]

    def get_periodo(self, obj):
        return {
            "id": obj.periodo_id,
            "codigo": obj.periodo.codigo,
            "etiqueta": obj.periodo.etiqueta,
            "obligacion": obj.periodo.obligacion.nombre,
        }
