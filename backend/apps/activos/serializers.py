from rest_framework import serializers

from apps.empresas.campos import RelacionDeEmpresa
from apps.organizacion.models import Departamento, Empleado, Proveedor, Sede
from apps.politicas.services import evaluar_activo

from .models import ESTADOS_FUERA_DE_INVENTARIO, Activo, MovimientoActivo, TipoDispositivo
from .tiempos import calcular as calcular_tiempos


class TipoDispositivoSerializer(serializers.ModelSerializer):
    # Sin los validadores automáticos de unicidad: se disparan antes que
    # `validate_<campo>` y contestan «Ya existe … con este nombre», sin decir
    # con cuál se choca ni distinguir mayúsculas de forma predecible. Los
    # métodos de abajo hacen la comprobación completa y con un mensaje que
    # lleva a corregirlo.
    nombre = serializers.CharField(max_length=120, validators=[])
    codigo = serializers.CharField(max_length=10, validators=[])
    total_activos = serializers.IntegerField(read_only=True)
    tiene_politica = serializers.SerializerMethodField()

    class Meta:
        model = TipoDispositivo
        fields = [
            "id",
            "nombre",
            "codigo",
            "descripcion",
            "activo",
            "total_activos",
            "tiene_politica",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_tiene_politica(self, obj) -> bool:
        return hasattr(obj, "politica")

    def validate_nombre(self, value):
        """Rechaza el duplicado sin distinguir mayúsculas y diciendo con cuál
        choca.

        La restricción única de la base sí distingue: «Laptop» y «LAPTOP»
        pasarían las dos y quedarían dos tipos indistinguibles en el
        desplegable, cada uno con su política de renovación y sus activos.
        """
        nombre = (value or "").strip()
        existente = TipoDispositivo.objects.filter(nombre__iexact=nombre)
        if self.instance is not None:
            existente = existente.exclude(pk=self.instance.pk)
        choque = existente.first()
        if choque:
            raise serializers.ValidationError(
                f"Ya existe un tipo llamado «{choque.nombre}» (código {choque.codigo})."
            )
        return nombre

    def validate_codigo(self, value):
        """El código va dentro del código de barras, que se lee con lectores
        1D: se normaliza a mayúsculas y se restringe a alfanuméricos para que
        quepa en el subconjunto B de Code 128 sin escapes.

        Repetido sería peor que un duplicado más: es lo que numera las
        etiquetas (`GA-LAP-000007`), así que dos tipos con el mismo código
        producirían códigos de barras que no distinguen de qué equipo son.
        """
        limpio = value.strip().upper()
        if not limpio.isalnum():
            raise serializers.ValidationError(
                "El código solo admite letras y dígitos (va codificado en la etiqueta)."
            )
        existente = TipoDispositivo.objects.filter(codigo__iexact=limpio)
        if self.instance is not None:
            existente = existente.exclude(pk=self.instance.pk)
        choque = existente.first()
        if choque:
            raise serializers.ValidationError(
                f"El código «{limpio}» ya lo usa el tipo «{choque.nombre}»."
            )
        return limpio


class MovimientoActivoSerializer(serializers.ModelSerializer):
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)
    custodio_anterior_nombre = serializers.CharField(
        source="custodio_anterior.nombre_completo", read_only=True, default=None
    )
    custodio_nuevo_nombre = serializers.CharField(
        source="custodio_nuevo.nombre_completo", read_only=True, default=None
    )
    departamento_anterior_nombre = serializers.CharField(
        source="departamento_anterior.nombre", read_only=True, default=None
    )
    departamento_nuevo_nombre = serializers.CharField(
        source="departamento_nuevo.nombre", read_only=True, default=None
    )
    # Lo que se muestra es la ciudad —«pasó de Quito a Guayaquil»—, con el
    # nombre de la sede como respaldo cuando la ciudad está sin rellenar.
    sede_anterior_nombre = serializers.CharField(
        source="sede_anterior.donde", read_only=True, default=None
    )
    sede_nueva_nombre = serializers.CharField(
        source="sede_nueva.donde", read_only=True, default=None
    )
    registrado_por_nombre = serializers.CharField(
        source="registrado_por.username", read_only=True, default=None
    )

    class Meta:
        model = MovimientoActivo
        fields = [
            "id",
            "tipo",
            "tipo_display",
            "custodio_anterior_nombre",
            "custodio_nuevo_nombre",
            "departamento_anterior_nombre",
            "departamento_nuevo_nombre",
            "sede_anterior_nombre",
            "sede_nueva_nombre",
            "estado_anterior",
            "estado_nuevo",
            "motivo",
            "registrado_por_nombre",
            "created_at",
        ]
        read_only_fields = fields


class ActivoListSerializer(serializers.ModelSerializer):
    """Versión ligera para el listado: sin especificaciones ni historial."""

    estado_garantia = serializers.CharField(read_only=True)
    tipo_nombre = serializers.CharField(source="tipo.nombre", read_only=True)
    custodio_nombre = serializers.CharField(
        source="custodio.nombre_completo", read_only=True, default=None
    )
    departamento_nombre = serializers.CharField(source="departamento.nombre", read_only=True)
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)
    sede_nombre = serializers.CharField(source="sede.nombre", read_only=True, default=None)
    ciudad = serializers.CharField(source="sede.donde", read_only=True, default=None)
    criticidad_display = serializers.CharField(source="get_criticidad_display", read_only=True)
    uso_display = serializers.CharField(source="get_uso_display", read_only=True)

    class Meta:
        model = Activo
        fields = [
            "id",
            "codigo_barras",
            "nombre",
            "tipo",
            "tipo_nombre",
            "marca",
            "modelo",
            "numero_serie",
            "custodio",
            "custodio_nombre",
            "departamento",
            "departamento_nombre",
            "sede",
            "sede_nombre",
            "ciudad",
            "criticidad",
            "criticidad_display",
            "uso",
            "uso_display",
            "estado",
            "estado_display",
            "fecha_adquisicion",
            "fecha_ingreso",
            "estado_garantia",
            "fecha_fin_garantia",
            "total_mantenimientos",
            "total_componentes_criticos",
            "requiere_renovacion",
            "nivel_renovacion",
            "created_at",
        ]
        read_only_fields = fields


class ActivoDetailSerializer(serializers.ModelSerializer):
    """Ficha completa, incluido el veredicto de renovación en vivo.

    `renovacion` se calcula en cada lectura y no se toma de la columna
    `requiere_renovacion`: la longevidad cruza su umbral por el paso del
    tiempo, sin ningún evento que actualice la caché (ver
    `apps.politicas.services`).
    """

    tipo_nombre = serializers.CharField(source="tipo.nombre", read_only=True)
    custodio_nombre = serializers.CharField(
        source="custodio.nombre_completo", read_only=True, default=None
    )
    departamento_nombre = serializers.CharField(source="departamento.nombre", read_only=True)
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)
    sede_nombre = serializers.CharField(source="sede.nombre", read_only=True, default=None)
    ciudad = serializers.CharField(source="sede.donde", read_only=True, default=None)
    proveedor_nombre = serializers.CharField(
        source="proveedor.nombre", read_only=True, default=None
    )
    criticidad_display = serializers.CharField(source="get_criticidad_display", read_only=True)
    uso_display = serializers.CharField(source="get_uso_display", read_only=True)
    esta_operativo = serializers.BooleanField(read_only=True)
    antiguedad_meses = serializers.IntegerField(read_only=True)
    estado_garantia = serializers.CharField(read_only=True)
    estado_garantia_display = serializers.SerializerMethodField()
    dias_para_fin_de_garantia = serializers.IntegerField(read_only=True)
    dias_en_reparacion = serializers.SerializerMethodField()
    tiempos = serializers.SerializerMethodField()
    renovacion = serializers.SerializerMethodField()

    class Meta:
        model = Activo
        fields = [
            "id",
            "codigo_barras",
            "nombre",
            "tipo",
            "tipo_nombre",
            "marca",
            "modelo",
            "numero_serie",
            "especificaciones",
            "observaciones",
            "custodio",
            "custodio_nombre",
            "departamento",
            "departamento_nombre",
            "sede",
            "sede_nombre",
            "ciudad",
            "criticidad",
            "criticidad_display",
            "uso",
            "uso_display",
            "estado",
            "estado_display",
            "esta_operativo",
            "fecha_adquisicion",
            "fecha_ingreso",
            "costo_adquisicion",
            "proveedor",
            "proveedor_nombre",
            "fecha_fin_garantia",
            "estado_garantia",
            "estado_garantia_display",
            "dias_para_fin_de_garantia",
            "fecha_baja",
            "motivo_baja",
            "antiguedad_meses",
            "dias_en_reparacion",
            "tiempos",
            "total_mantenimientos",
            "total_componentes_criticos",
            "renovacion",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "codigo_barras",
            "estado",
            "fecha_baja",
            "motivo_baja",
            "total_mantenimientos",
            "total_componentes_criticos",
            "created_at",
            "updated_at",
        ]

    def get_renovacion(self, obj) -> dict:
        return evaluar_activo(obj).as_dict()

    def get_estado_garantia_display(self, obj) -> str:
        return Activo.Garantia(obj.estado_garantia).label

    def get_tiempos(self, obj) -> dict:
        """Los siete tiempos del §10, reconstruidos desde el historial.

        Solo en la ficha: en el listado obligarían a recorrer los movimientos
        de cada equipo de la página (ver `apps.activos.tiempos`).
        """
        return calcular_tiempos(obj)

    def get_dias_en_reparacion(self, obj) -> int:
        """Tiempo acumulado fuera de operación (§10 del documento funcional).

        Las intervenciones sin fecha de salida no suman: el equipo sigue fuera
        y ese tiempo todavía no está cerrado.
        """
        return sum(
            m.dias_fuera_de_operacion or 0
            for m in obj.mantenimientos.all()
            if m.fecha_salida is not None
        )


class MiEquipoSerializer(serializers.ModelSerializer):
    """Lo que ve una persona de un equipo **suyo** (§13, rol «Usuario final»).

    Deliberadamente corto. Fuera quedan el costo, el proveedor, el veredicto de
    renovación y el historial de custodios: son datos del inventario, no del
    equipo que uno usa. El veredicto además es una decisión de planificación
    —«este equipo se reemplaza el año que viene»— que no se comunica por una
    pantalla, y el historial dice quién más tuvo el equipo, que no es asunto de
    quien lo tiene ahora.

    Lo que queda es lo que sirve para responder «¿qué tengo yo?» y para
    identificar el aparato al pedir soporte: el código de la etiqueta, qué es,
    su serie, en qué estado está y desde cuándo lo tiene.
    """

    tipo_nombre = serializers.CharField(source="tipo.nombre", read_only=True)
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)
    ciudad = serializers.CharField(source="sede.donde", read_only=True, default=None)
    departamento_nombre = serializers.CharField(source="departamento.nombre", read_only=True)
    desde = serializers.DateTimeField(read_only=True, default=None)

    class Meta:
        model = Activo
        fields = [
            "id",
            "codigo_barras",
            "nombre",
            "tipo_nombre",
            "marca",
            "modelo",
            "numero_serie",
            "especificaciones",
            "estado",
            "estado_display",
            "ciudad",
            "departamento_nombre",
            "desde",
        ]
        read_only_fields = fields


class ActivoWriteSerializer(serializers.ModelSerializer):
    """Alta y edición de la ficha técnica.

    No expone `estado`, `custodio` ni `departamento` en la edición: esos
    cambian por sus propias acciones (`asignar`, `cambiar-estado`), que dejan
    el movimiento correspondiente en el historial. Permitirlos aquí abriría una
    vía de cambiar de responsable sin dejar rastro.
    """

    class Meta:
        model = Activo
        fields = [
            "tipo",
            "nombre",
            "marca",
            "modelo",
            "numero_serie",
            "especificaciones",
            "observaciones",
            "custodio",
            "departamento",
            "sede",
            "criticidad",
            "uso",
            "fecha_adquisicion",
            "fecha_ingreso",
            "costo_adquisicion",
            "proveedor",
            "fecha_fin_garantia",
        ]

    # Solo sedes abiertas: dejar un equipo registrado en una sede cerrada lo
    # pone en un sitio donde nadie va a buscarlo.
    sede = RelacionDeEmpresa(Sede, {"activa": True}, required=False, allow_null=True)
    # Igual con el proveedor: uno dado de baja ya no vende ni atiende un
    # reclamo, así que registrarle una compra nueva no significa nada.
    proveedor = RelacionDeEmpresa(Proveedor, {"activo": True}, required=False, allow_null=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance is not None:
            for campo in ("custodio", "departamento"):
                self.fields.pop(campo, None)

    def validate_numero_serie(self, value):
        return value.strip()

    def validate(self, attrs):
        """La fecha de ingreso no puede ser anterior a la de adquisición.

        Se separan porque un equipo comprado en diciembre puede entrar al
        inventario en marzo; al revés no ocurre, y cuando aparece es que una
        de las dos se digitó mal.
        """
        adquisicion = attrs.get(
            "fecha_adquisicion", getattr(self.instance, "fecha_adquisicion", None)
        )
        ingreso = attrs.get("fecha_ingreso", getattr(self.instance, "fecha_ingreso", None))
        if adquisicion and ingreso and ingreso < adquisicion:
            raise serializers.ValidationError(
                {
                    "fecha_ingreso": (
                        f"El ingreso al inventario ({ingreso}) no puede ser anterior a la "
                        f"adquisición ({adquisicion})."
                    )
                }
            )

        # Las especificaciones se comprueban aquí y no en `validate_especificaciones`
        # porque hace falta el tipo, y en una edición parcial puede venir en el
        # cuerpo o estar ya guardado.
        tipo = attrs.get("tipo") or getattr(self.instance, "tipo", None)
        if tipo is not None and (
            "especificaciones" in attrs or "tipo" in attrs or self.instance is None
        ):
            especificaciones = attrs.get(
                "especificaciones", getattr(self.instance, "especificaciones", None) or {}
            )
            attrs["especificaciones"] = self._validar_contra_el_tipo(tipo, especificaciones)

        return attrs

    def validate_especificaciones(self, value):
        """Solo pares clave/valor planos: la ficha se renderiza como tabla y
        un diccionario anidado no tendría cómo mostrarse."""
        if not isinstance(value, dict):
            raise serializers.ValidationError(
                "Las especificaciones deben ser un objeto de pares clave/valor."
            )
        for clave, valor in value.items():
            if isinstance(valor, (dict, list)):
                raise serializers.ValidationError(
                    f"El valor de {clave!r} debe ser un dato simple, no una estructura anidada."
                )
        return value

    def _validar_contra_el_tipo(self, tipo, especificaciones):
        """Comprueba las características que el tipo declara.

        **Solo se exige cuando el tipo declara alguna.** Un tipo sin
        características sigue admitiendo pares libres, como antes: obligar a
        configurarlos todos antes de poder registrar un equipo convertiría una
        mejora en un bloqueo, y la mitad del inventario se cargó cuando esto no
        existía.

        Las claves que no declara el tipo se rechazan —es lo que impide que
        vuelva la dispersión de «RAM», «Ram» y «Memoria RAM»— salvo las que el
        equipo ya tenía guardadas: al describir un tipo por primera vez, sus
        equipos antiguos arrastran características que nadie declaró, y hacer
        que su ficha deje de poder guardarse castigaría precisamente a quien
        cargó el inventario primero.
        """
        from django.core.exceptions import ValidationError as ErrorDeModelo

        from .models_caracteristicas import CaracteristicaTipo

        declaradas = list(
            CaracteristicaTipo.objects.filter(tipo=tipo, activa=True).order_by("orden", "nombre")
        )
        if not declaradas:
            return especificaciones

        por_nombre = {c.nombre: c for c in declaradas}
        heredadas = set(getattr(self.instance, "especificaciones", None) or {})
        errores = {}
        limpias = {}

        for clave, valor in (especificaciones or {}).items():
            caracteristica = por_nombre.get(clave)
            if caracteristica is None:
                if clave in heredadas:
                    limpias[clave] = valor
                else:
                    errores[clave] = (
                        f"«{tipo.nombre}» no describe «{clave}». Añádala a las "
                        f"características del tipo si hace falta."
                    )
                continue
            try:
                normalizado = caracteristica.normalizar(valor)
            except ErrorDeModelo as error:
                errores[clave] = error.messages[0]
                continue
            if normalizado is not None:
                limpias[clave] = normalizado

        for caracteristica in declaradas:
            # Si el valor ya falló por otra razón —una opción que no está en la
            # lista, un texto donde iba un número— ese mensaje dice qué corregir
            # y este lo taparía con un genérico «es obligatoria».
            if caracteristica.nombre in errores:
                continue
            if caracteristica.obligatoria and limpias.get(caracteristica.nombre) in (None, ""):
                errores[caracteristica.nombre] = (
                    f"«{caracteristica.nombre}» es obligatoria para un equipo de "
                    f"tipo {tipo.nombre}."
                )

        if errores:
            raise serializers.ValidationError({"especificaciones": errores})
        return limpias


class AsignacionSerializer(serializers.Serializer):
    """Asignación, traslado o devolución de un activo.

    Los querysets filtran por `activo=True`: entregar un equipo a un empleado
    dado de baja, o adscribirlo a un área desactivada, reintroduce el problema
    de custodia sin dueño que RF-01 busca resolver.
    """

    custodio = RelacionDeEmpresa(
        Empleado, {"activo": True}, allow_null=True, required=False, default=None
    )
    departamento = RelacionDeEmpresa(
        Departamento, {"activo": True}, required=False, allow_null=True, default=None
    )
    # Sin `default`: que el campo no venga significa «no muevas el equipo de
    # sitio», y es distinto de mandarlo vacío para dejarlo sin sede.
    sede = RelacionDeEmpresa(Sede, {"activa": True}, required=False, allow_null=True)
    motivo = serializers.CharField(required=False, allow_blank=True, default="")


class CambioEstadoSerializer(serializers.Serializer):
    estado = serializers.ChoiceField(choices=Activo.Estado.choices)
    motivo = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        """Sacar un equipo del inventario exige decir por qué.

        Vale para los tres estados de salida, no solo para la baja: «perdido»
        y «robado» sin explicación dejan un equipo desaparecido del inventario
        y ninguna constancia de qué pasó, que es justamente lo que habría que
        poder consultar meses después —y en el caso del robo, lo que respalda
        la denuncia.
        """
        if attrs["estado"] in ESTADOS_FUERA_DE_INVENTARIO and not attrs.get("motivo"):
            etiqueta = Activo.Estado(attrs["estado"]).label.lower()
            raise serializers.ValidationError(
                {"motivo": f"Registrar un activo como {etiqueta} exige indicar el motivo."}
            )
        return attrs
