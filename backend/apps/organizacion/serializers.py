from rest_framework import serializers

from .models import Departamento, Empleado, Proveedor, Sede


class DepartamentoSerializer(serializers.ModelSerializer):
    # Sin los validadores automáticos de unicidad: se disparan antes que
    # `validate_<campo>` y contestan «Ya existe … con este nombre», sin decir
    # con cuál se choca ni distinguir mayúsculas de forma predecible. Los
    # métodos de abajo hacen la comprobación completa y con un mensaje que
    # lleva a corregirlo.
    nombre = serializers.CharField(max_length=120, validators=[])
    codigo = serializers.CharField(max_length=20, validators=[])
    responsable_nombre = serializers.CharField(source="responsable.nombre_completo", read_only=True)
    total_activos = serializers.IntegerField(read_only=True)
    total_empleados = serializers.IntegerField(read_only=True)

    class Meta:
        model = Departamento
        fields = [
            "id",
            "nombre",
            "codigo",
            "descripcion",
            "responsable",
            "responsable_nombre",
            "activo",
            "total_activos",
            "total_empleados",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_nombre(self, value):
        """Rechaza el duplicado sin distinguir mayúsculas y diciendo con quién
        choca.

        La restricción única de la base sí distingue: «Contabilidad» y
        «CONTABILIDAD» pasarían las dos y quedarían dos áreas indistinguibles
        en el desplegable, con los activos repartidos entre ambas.
        """
        nombre = (value or "").strip()
        existente = Departamento.objects.filter(nombre__iexact=nombre)
        if self.instance is not None:
            existente = existente.exclude(pk=self.instance.pk)
        choque = existente.first()
        if choque:
            raise serializers.ValidationError(
                f"Ya existe un área llamada «{choque.nombre}» (código {choque.codigo})."
            )
        return nombre

    def validate_codigo(self, value):
        """El código identifica al área en la plantilla de carga y en el código
        del empleado: repetido, deja de identificar nada."""
        codigo = (value or "").strip().upper()
        existente = Departamento.objects.filter(codigo__iexact=codigo)
        if self.instance is not None:
            existente = existente.exclude(pk=self.instance.pk)
        choque = existente.first()
        if choque:
            raise serializers.ValidationError(
                f"El código «{codigo}» ya lo usa el área «{choque.nombre}»."
            )
        return codigo


class SedeSerializer(serializers.ModelSerializer):
    total_activos = serializers.IntegerField(read_only=True)

    class Meta:
        model = Sede
        fields = [
            "id",
            "nombre",
            "ciudad",
            "direccion",
            "activa",
            "total_activos",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_nombre(self, value):
        """El duplicado se rechaza sin distinguir mayúsculas.

        «Sede Quito Norte» y «SEDE QUITO NORTE» pasarían la restricción única
        de la base y saldrían como dos sedes en el desplegable del traslado,
        que es justo el problema que este catálogo viene a resolver.
        """
        nombre = (value or "").strip()
        existente = Sede.objects.filter(nombre__iexact=nombre)
        if self.instance is not None:
            existente = existente.exclude(pk=self.instance.pk)
        if existente.exists():
            raise serializers.ValidationError(f"Ya existe una sede llamada «{nombre}».")
        return nombre


class ProveedorSerializer(serializers.ModelSerializer):
    total_activos = serializers.IntegerField(read_only=True)
    total_repuestos = serializers.IntegerField(read_only=True)

    # Sin el validador automático de unicidad: contesta «Ya existe … con este
    # nombre» sin decir con cuál se choca. Ver `validate_nombre`.
    nombre = serializers.CharField(max_length=150, validators=[])

    class Meta:
        model = Proveedor
        fields = [
            "id",
            "nombre",
            "identificacion",
            "contacto",
            "telefono",
            "correo",
            "observaciones",
            "activo",
            "total_activos",
            "total_repuestos",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_nombre(self, value):
        """Rechaza el duplicado sin distinguir mayúsculas y diciendo con cuál
        choca: «Tecnomega» y «TECNOMEGA» pasarían las dos y quedarían dos
        fichas de la misma empresa, con las compras repartidas entre ambas."""
        nombre = (value or "").strip()
        existente = Proveedor.objects.filter(nombre__iexact=nombre)
        if self.instance is not None:
            existente = existente.exclude(pk=self.instance.pk)
        # Se nombra al que ya está, no al que se acaba de escribir: es la
        # grafía que hay que reutilizar para no partir el histórico en dos.
        choque = existente.first()
        if choque:
            raise serializers.ValidationError(f"Ya existe un proveedor llamado «{choque.nombre}».")
        return nombre


class EmpleadoSerializer(serializers.ModelSerializer):
    """El empleado se identifica con un código interno, no con su cédula.

    Ver la nota de `apps.organizacion.models.Empleado` y
    `docs/data-protection-review.md`.
    """

    nombre_completo = serializers.CharField(read_only=True)
    departamento_nombre = serializers.CharField(source="departamento.nombre", read_only=True)
    total_activos = serializers.IntegerField(read_only=True)

    class Meta:
        model = Empleado
        fields = [
            "id",
            "nombres",
            "apellidos",
            "nombre_completo",
            "codigo_empleado",
            "correo",
            "telefono",
            "cargo",
            "departamento",
            "departamento_nombre",
            "usuario",
            "activo",
            "total_activos",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {"codigo_empleado": {"required": False, "allow_blank": True}}

    def validate_codigo_empleado(self, value):
        return value.strip().upper()
