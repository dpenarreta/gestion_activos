from pathlib import PurePath

from django.contrib.auth.models import Group
from django.db import transaction
from rest_framework import serializers

from apps.adjuntos.models import FIRMAS
from apps.empresas.campos import RelacionDeEmpresa
from apps.organizacion.models import Cargo
from apps.users.models import User

from .models import (
    APROBADORES_VALIDOS,
    AccionSolicitud,
    AprobadorPaso,
    AvisoFlujo,
    Destino,
    FlujoPermiso,
    PasoFlujo,
    SolicitudPermiso,
)

EXTENSIONES = {".pdf", ".jpg", ".jpeg", ".png"}
TIPOS = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
}
TAMANO_MAXIMO = 10 * 1024 * 1024


def _nombre(usuario):
    return (usuario.get_full_name().strip() or usuario.username) if usuario else ""


def describir_destino(destino) -> str:
    if destino.tipo == Destino.PERSONA and destino.usuario_id:
        return _nombre(destino.usuario)
    if destino.tipo == Destino.ROL and destino.rol_id:
        return f"Rol {destino.rol.name}"
    if destino.tipo == Destino.CARGO and destino.cargo_id:
        return f"Cargo {destino.cargo.nombre}"
    return Destino(destino.tipo).label


class DestinoSerializer(serializers.Serializer):
    """Un destino (aprobador o aviso): su tipo y la persona, el rol o el cargo
    que corresponda."""

    tipo = serializers.ChoiceField(choices=Destino.choices)
    usuario = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), required=False, allow_null=True
    )
    rol = serializers.PrimaryKeyRelatedField(
        queryset=Group.objects.all(), required=False, allow_null=True
    )
    cargo = RelacionDeEmpresa(Cargo, required=False, allow_null=True)
    descripcion = serializers.SerializerMethodField()

    def get_descripcion(self, destino) -> str:
        return describir_destino(destino)

    def validate(self, datos):
        tipo = datos["tipo"]
        faltante = {Destino.PERSONA: "usuario", Destino.ROL: "rol", Destino.CARGO: "cargo"}.get(
            tipo
        )
        if faltante and not datos.get(faltante):
            raise serializers.ValidationError({faltante: "Elija a quién."})
        return datos

    def to_representation(self, instancia):
        return {
            "tipo": instancia.tipo,
            "usuario": instancia.usuario_id,
            "rol": instancia.rol_id,
            "cargo": instancia.cargo_id,
            "descripcion": describir_destino(instancia),
        }


class PasoSerializer(serializers.Serializer):
    nombre = serializers.CharField(max_length=120)
    aprobadores = DestinoSerializer(many=True)

    def validate_aprobadores(self, aprobadores):
        if not aprobadores:
            raise serializers.ValidationError("Cada paso necesita al menos un aprobador.")
        for aprobador in aprobadores:
            if aprobador["tipo"] not in APROBADORES_VALIDOS:
                raise serializers.ValidationError(
                    "Aprueba el jefe inmediato, una persona, un rol o un cargo."
                )
        return aprobadores


class FlujoSerializer(serializers.ModelSerializer):
    """Un flujo con sus pasos (en orden) y sus avisos, que se guardan juntos."""

    pasos = PasoSerializer(many=True)
    avisos_aprobada = DestinoSerializer(many=True, required=False)
    avisos_rechazada = DestinoSerializer(many=True, required=False)
    nombre = serializers.CharField(max_length=120, validators=[])

    class Meta:
        model = FlujoPermiso
        fields = [
            "id",
            "nombre",
            "descripcion",
            "activo",
            "adjunto",
            "orden",
            "pasos",
            "avisos_aprobada",
            "avisos_rechazada",
        ]

    def validate_nombre(self, valor):
        valor = valor.strip()
        repetido = FlujoPermiso.objects.filter(nombre__iexact=valor)
        if self.instance is not None:
            repetido = repetido.exclude(pk=self.instance.pk)
        if repetido.exists():
            raise serializers.ValidationError(f"Ya hay un tipo de permiso «{valor}».")
        return valor

    def validate_pasos(self, pasos):
        if not pasos:
            raise serializers.ValidationError("El flujo necesita al menos un paso de aprobación.")
        return pasos

    def to_representation(self, flujo):
        datos = super().to_representation(flujo)
        datos["pasos"] = [
            {
                "id": paso.id,
                "nombre": paso.nombre,
                "aprobadores": [
                    DestinoSerializer().to_representation(a) for a in paso.aprobadores.all()
                ],
            }
            for paso in flujo.pasos.order_by("orden", "id")
        ]
        for resultado in ("aprobada", "rechazada"):
            datos[f"avisos_{resultado}"] = [
                DestinoSerializer().to_representation(a)
                for a in flujo.avisos.filter(resultado=resultado)
            ]
        return datos

    def _guardar_partes(self, flujo, pasos, avisos):
        flujo.pasos.all().delete()
        for orden, paso in enumerate(pasos, start=1):
            nuevo = PasoFlujo.objects.create(flujo=flujo, orden=orden, nombre=paso["nombre"])
            for aprobador in paso["aprobadores"]:
                AprobadorPaso.objects.create(
                    paso=nuevo,
                    tipo=aprobador["tipo"],
                    usuario=aprobador.get("usuario"),
                    rol=aprobador.get("rol"),
                    cargo=aprobador.get("cargo"),
                )
        flujo.avisos.all().delete()
        for resultado, lista in avisos.items():
            for aviso in lista:
                AvisoFlujo.objects.create(
                    flujo=flujo,
                    resultado=resultado,
                    tipo=aviso["tipo"],
                    usuario=aviso.get("usuario"),
                    rol=aviso.get("rol"),
                    cargo=aviso.get("cargo"),
                )

    def _separar(self, datos):
        pasos = datos.pop("pasos", None)
        avisos = {
            "aprobada": datos.pop("avisos_aprobada", []),
            "rechazada": datos.pop("avisos_rechazada", []),
        }
        return pasos, avisos

    @transaction.atomic
    def create(self, datos):
        pasos, avisos = self._separar(datos)
        flujo = FlujoPermiso.objects.create(**datos)
        self._guardar_partes(flujo, pasos, avisos)
        return flujo

    @transaction.atomic
    def update(self, flujo, datos):
        pasos, avisos = self._separar(datos)
        for campo, valor in datos.items():
            setattr(flujo, campo, valor)
        flujo.save()
        if pasos is not None:
            self._guardar_partes(flujo, pasos, avisos)
        return flujo


class FlujoParaSolicitarSerializer(serializers.ModelSerializer):
    """Lo que ve quien solicita de un tipo de permiso: qué es, si pide
    documento y por qué pasos va a pasar."""

    pasos = serializers.SerializerMethodField()

    class Meta:
        model = FlujoPermiso
        fields = ["id", "nombre", "descripcion", "adjunto", "pasos"]

    def get_pasos(self, flujo):
        return [
            {
                "nombre": paso.nombre,
                "aprobadores": [describir_destino(a) for a in paso.aprobadores.all()],
            }
            for paso in flujo.pasos.order_by("orden", "id")
        ]


class NuevaSolicitudSerializer(serializers.Serializer):
    flujo = RelacionDeEmpresa(FlujoPermiso, {"activo": True})
    desde = serializers.DateField()
    hasta = serializers.DateField()
    motivo = serializers.CharField(allow_blank=True, default="")
    adjunto = serializers.FileField(required=False)

    def validate_adjunto(self, archivo):
        if archivo.size > TAMANO_MAXIMO:
            raise serializers.ValidationError("El documento pesa más de 10 MB.")
        extension = PurePath(archivo.name).suffix.lower()
        if extension not in EXTENSIONES:
            raise serializers.ValidationError("Adjunte un PDF o una imagen (JPG o PNG).")
        cabecera = archivo.read(8)
        archivo.seek(0)
        if not any(cabecera.startswith(f) for f in FIRMAS[extension]):
            raise serializers.ValidationError(
                f"El contenido no corresponde a un {extension}. "
                "Verifique que no se haya renombrado la extensión."
            )
        self._tipo = TIPOS[extension]
        return archivo


class AccionSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()
    accion_display = serializers.CharField(source="get_accion_display", read_only=True)
    paso = serializers.CharField(source="paso.nombre", default="", read_only=True)

    class Meta:
        model = AccionSolicitud
        fields = [
            "id",
            "accion",
            "accion_display",
            "actor",
            "paso",
            "comentario",
            "detalle",
            "created_at",
        ]

    def get_actor(self, accion):
        return _nombre(accion.actor)


class SolicitudSerializer(serializers.ModelSerializer):
    flujo = serializers.CharField(source="flujo.nombre", read_only=True)
    solicitante = serializers.SerializerMethodField()
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)
    paso_actual = serializers.CharField(source="paso_actual.nombre", default="", read_only=True)
    pendiente_de = serializers.SerializerMethodField()
    dias = serializers.IntegerField(read_only=True)
    tiene_adjunto = serializers.SerializerMethodField()

    class Meta:
        model = SolicitudPermiso
        fields = [
            "id",
            "flujo",
            "solicitante",
            "desde",
            "hasta",
            "dias",
            "motivo",
            "estado",
            "estado_display",
            "paso_actual",
            "pendiente_de",
            "tiene_adjunto",
            "adjunto_nombre",
            "created_at",
            "cerrada_en",
        ]

    def get_solicitante(self, solicitud):
        return {"id": solicitud.solicitante_id, "nombre": _nombre(solicitud.solicitante)}

    def get_pendiente_de(self, solicitud):
        return [{"id": u.id, "nombre": _nombre(u)} for u in solicitud.pendiente_de.all()]

    def get_tiene_adjunto(self, solicitud) -> bool:
        return bool(solicitud.adjunto)


class DetalleSolicitudSerializer(SolicitudSerializer):
    acciones = AccionSerializer(many=True, read_only=True)
    puedo = serializers.SerializerMethodField()

    class Meta(SolicitudSerializer.Meta):
        fields = SolicitudSerializer.Meta.fields + ["acciones", "puedo"]

    def get_puedo(self, solicitud):
        from apps.permissions.authorization import user_has_permission

        usuario = self.context["request"].user
        pendiente = solicitud.estado == SolicitudPermiso.Estado.PENDIENTE
        mia = solicitud.pendiente_de.filter(pk=usuario.pk).exists()
        return {
            "resolver": pendiente and mia,
            "escalar": pendiente and (mia or user_has_permission(usuario, "licencias.ver_todas")),
            "cancelar": pendiente and solicitud.solicitante_id == usuario.pk,
        }
