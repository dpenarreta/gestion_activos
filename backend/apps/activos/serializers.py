from django.db import transaction
from rest_framework import serializers

from apps.empresas.campos import RelacionDeEmpresa
from apps.organizacion.models import (
    Concesionario,
    Departamento,
    Empleado,
    Proveedor,
    Sede,
)
from apps.politicas.depreciacion import calcular_de as calcular_depreciacion
from apps.politicas.depreciacion import motivo_sin_depreciacion
from apps.politicas.depreciacion import resolver_politica as resolver_politica_depreciacion
from apps.politicas.services import evaluar_activo

from .especificaciones import validar as validar_especificaciones
from .models import ESTADOS_FUERA_DE_INVENTARIO, Activo, MovimientoActivo, TipoDispositivo
from .models_caracteristicas import CaracteristicaTipo
from .serializers_caracteristicas import CaracteristicaDeTipoNuevoSerializer
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
    #: Lo que se describe de los equipos de este tipo, declarado en la misma
    #: alta. Solo de escritura: el listado del catálogo pagina tipos, y
    #: arrastrar las características de cada uno lo convertiría en una consulta
    #: por fila para un dato que la pantalla pide aparte cuando lo necesita.
    caracteristicas = CaracteristicaDeTipoNuevoSerializer(
        many=True, required=False, write_only=True
    )

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
            "caracteristicas",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_tiene_politica(self, obj) -> bool:
        return hasattr(obj, "politica")

    def validate_caracteristicas(self, value):
        """Que dos del mismo lote no se llamen igual.

        La restricción de la base distingue mayúsculas, así que «RAM» y «ram»
        pasarían las dos y el formulario del activo pediría dos veces lo mismo
        para guardarlo en sitios distintos. Se comprueba aquí y no en cada
        característica porque es lo único que solo se ve mirando el lote
        entero.
        """
        vistos = {}
        for posicion, caracteristica in enumerate(value):
            nombre = caracteristica["nombre"]
            anterior = vistos.get(nombre.lower())
            if anterior is not None:
                raise serializers.ValidationError(
                    {
                        posicion: {
                            "nombre": (
                                f"«{nombre}» repite a «{anterior}». Dos características "
                                "con el mismo nombre guardarían su valor en el mismo sitio."
                            )
                        }
                    }
                )
            vistos[nombre.lower()] = nombre
        return value

    def validate(self, attrs):
        """Describir un tipo que ya existe se hace de a una, no reenviando todas.

        Aceptarlas aquí en una edición obligaría a decidir qué pasa con las que
        no vengan en la lista —¿se borran, se dejan?—, y cualquiera de las dos
        respuestas destruye trabajo ajeno el día que dos personas editan el
        mismo tipo. El endpoint de características cambia una sin tocar las
        otras y deja su propio rastro en la auditoría.
        """
        if self.instance is not None and "caracteristicas" in attrs:
            raise serializers.ValidationError(
                {
                    "caracteristicas": (
                        "Las características de un tipo ya creado se administran una a "
                        "una en /activos/caracteristicas/."
                    )
                }
            )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        """El tipo y lo que describe entran juntos o no entra ninguno.

        Sin la transacción, una característica rechazada a mitad del lote
        dejaría el tipo creado y descrito a medias: quien reintentara chocaría
        con «ya existe un tipo llamado así» sin ver que el suyo está ahí,
        incompleto.
        """
        caracteristicas = validated_data.pop("caracteristicas", [])
        tipo = super().create(validated_data)
        #: El viewset las audita una a una, igual que si se hubieran creado por
        #: su propio endpoint: que el rastro dependa de por dónde entraron
        #: dejaría sin registrar justo el camino por el que van a entrar casi
        #: todas.
        self.caracteristicas_creadas = [
            CaracteristicaTipo.objects.create(tipo=tipo, **datos) for datos in caracteristicas
        ]
        return tipo

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


class ResponsableSerializer(serializers.Serializer):
    """Quién responde por un equipo, con lo justo para nombrarlo y abrirlo.

    El código va junto al nombre porque dos personas pueden llamarse igual y la
    pantalla tiene que poder distinguirlas sin abrir otra ficha.
    """

    id = serializers.IntegerField(read_only=True)
    nombre_completo = serializers.CharField(read_only=True)
    codigo_empleado = serializers.CharField(read_only=True)
    activo = serializers.BooleanField(read_only=True)
    #: Si tiene correo en su ficha y por tanto le llegarán los avisos de
    #: entrada y salida del taller. Va el sí o no, **no la dirección**: la
    #: pantalla necesita poder decir «a esta persona no se le avisará», y para
    #: eso no hace falta repartir el correo de nadie por cada listado de
    #: activos (ver `docs/data-protection-review.md`).
    recibe_avisos = serializers.SerializerMethodField()

    def get_recibe_avisos(self, obj) -> bool:
        return bool((getattr(obj, "correo", "") or "").strip())


class ActivoListSerializer(serializers.ModelSerializer):
    """Versión ligera para el listado: sin especificaciones ni historial."""

    estado_garantia = serializers.CharField(read_only=True)
    #: Si el equipo sigue formando parte del parque. El listado lo necesita
    #: para no ofrecer «asignar» sobre uno dado de baja, perdido o robado: el
    #: servidor lo rechaza, pero después de que alguien abriera el formulario.
    #: Viene calculado, igual que en la ficha, para no repetir en el frontend
    #: qué estados cuentan como fuera del inventario.
    esta_operativo = serializers.BooleanField(read_only=True)
    tipo_nombre = serializers.CharField(source="tipo.nombre", read_only=True)
    # Los nombres ya resueltos, no un conteo: «3 responsables» obligaría a
    # abrir la ficha para saber a quién llamar, que es lo que se pregunta al
    # mirar la columna.
    responsables_resumen = serializers.CharField(source="resumen_de_responsables", read_only=True)
    responsables = ResponsableSerializer(many=True, read_only=True)
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
            "compartido",
            "responsables",
            "responsables_resumen",
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
    responsables = ResponsableSerializer(many=True, read_only=True)
    responsables_resumen = serializers.CharField(source="resumen_de_responsables", read_only=True)
    solicitado_por_nombre = serializers.CharField(
        source="solicitado_por.nombre_completo", read_only=True, default=None
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
    # Vacío significa «no consta», así que no se traduce a «Nuevo» ni a nada:
    # se deja en blanco y la interfaz lo dice con sus palabras.
    condicion_display = serializers.CharField(source="get_condicion_display", read_only=True)
    propiedad_display = serializers.CharField(source="get_propiedad_display", read_only=True)
    concesionario_nombre = serializers.CharField(
        source="concesionario.nombre", read_only=True, default=None
    )
    es_de_la_empresa = serializers.BooleanField(read_only=True)
    esta_operativo = serializers.BooleanField(read_only=True)
    antiguedad_meses = serializers.IntegerField(read_only=True)
    estado_garantia = serializers.CharField(read_only=True)
    estado_garantia_display = serializers.SerializerMethodField()
    dias_para_fin_de_garantia = serializers.IntegerField(read_only=True)
    dias_en_reparacion = serializers.SerializerMethodField()
    tiempos = serializers.SerializerMethodField()
    renovacion = serializers.SerializerMethodField()
    depreciacion = serializers.SerializerMethodField()

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
            "compartido",
            "responsables",
            "responsables_resumen",
            "solicitado_por",
            "solicitado_por_nombre",
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
            "condicion",
            "condicion_display",
            "propiedad",
            "propiedad_display",
            "concesionario",
            "concesionario_nombre",
            "es_de_la_empresa",
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
            "depreciacion",
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

    def get_depreciacion(self, obj) -> dict:
        """Qué vale hoy el equipo en libros (§22.3).

        Cuando no hay con qué calcularla se dice por qué, en vez de devolver
        ceros: un valor en libros de 0 significa «ya no vale nada», que es muy
        distinto de «nadie capturó lo que costó».

        Va en la ficha y no en el listado por lo mismo que los tiempos: obliga
        a resolver la política de cada equipo de la página.
        """
        politica = resolver_politica_depreciacion(obj.tipo)
        calculo = calcular_depreciacion(obj, politica)
        if calculo is None:
            return {"disponible": False, "motivo": motivo_sin_depreciacion(obj, politica)}
        return {
            "disponible": True,
            "motivo": None,
            "costo": calculo.costo,
            "desde": calculo.desde,
            "meses_vida_contable": calculo.meses_vida_contable,
            "meses_transcurridos": calculo.meses_transcurridos,
            "cuota_mensual": calculo.cuota_mensual,
            "acumulada": calculo.acumulada,
            "valor_en_libros": calculo.valor_en_libros,
            "porcentaje_depreciado": calculo.porcentaje_depreciado,
            "totalmente_depreciado": calculo.totalmente_depreciado,
            "fin": calculo.fin,
        }

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
    renovación y el historial de responsables: son datos del inventario, no del
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
    #: Los demás que responden por el mismo equipo. Es lo primero que se
    #: pregunta cuando algo falla en un aparato de turno —«¿quién más lo
    #: usa?»—, y solo van los nombres: el correo y el teléfono de un compañero
    #: no hacen falta para eso (ver `docs/data-protection-review.md`).
    con_quien_mas = serializers.SerializerMethodField()

    def get_con_quien_mas(self, obj) -> list:
        yo = self.context.get("empleado")
        return [
            empleado.nombre_completo
            for empleado in obj.responsables_ordenados
            if yo is None or empleado.id != yo.id
        ]

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
            "compartido",
            "con_quien_mas",
            "desde",
        ]
        read_only_fields = fields


class ActivoWriteSerializer(serializers.ModelSerializer):
    """Alta y edición de la ficha técnica.

    No expone `estado`, `responsables` ni `departamento` en la edición: esos
    cambian por sus propias acciones (`asignar`, `cambiar-estado`), que dejan
    el movimiento correspondiente en el historial. Permitirlos aquí abriría una
    vía de cambiar de responsable sin dejar rastro.

    `compartido` sí se edita aquí: no es una entrega, es una decisión sobre qué
    clase de equipo es. Quitar la marca a un equipo que ya tiene varios
    responsables se rechaza, porque dejaría una ficha que el propio sistema no
    admitiría volver a guardar.
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
            "compartido",
            "responsables",
            "solicitado_por",
            "departamento",
            "sede",
            "criticidad",
            "uso",
            "fecha_adquisicion",
            "fecha_ingreso",
            "costo_adquisicion",
            "condicion",
            "propiedad",
            "concesionario",
            "proveedor",
            "fecha_fin_garantia",
        ]

    # Solo sedes abiertas: dejar un equipo registrado en una sede cerrada lo
    # pone en un sitio donde nadie va a buscarlo.
    sede = RelacionDeEmpresa(Sede, {"activa": True}, required=False, allow_null=True)
    # Igual con el proveedor: uno dado de baja ya no vende ni atiende un
    # reclamo, así que registrarle una compra nueva no significa nada.
    proveedor = RelacionDeEmpresa(Proveedor, {"activo": True}, required=False, allow_null=True)
    # Y con el concesionario: uno con el que ya no se opera no puede estar
    # poniendo equipos nuevos.
    concesionario = RelacionDeEmpresa(
        Concesionario, {"activo": True}, required=False, allow_null=True
    )
    # Entregar un equipo a alguien dado de baja reintroduce el problema de
    # custodia sin dueño que RF-01 busca resolver.
    responsables = RelacionDeEmpresa(
        Empleado, {"activo": True}, many=True, required=False, default=list
    )
    # Quien pidió el equipo, **sin filtrar por si sigue activo**: esa marca no
    # la mantiene ninguna integración, así que filtrar por ella no protegería
    # de nada y sí escondería a gente que sí está. Si la ficha resulta estar
    # desactualizada, el aviso cae en el respaldo de siempre.
    solicitado_por = RelacionDeEmpresa(Empleado, required=False, allow_null=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance is not None:
            # `solicitado_por` tampoco se edita: es un hecho del alta —quién
            # pidió este equipo— y cambiarlo después reescribiría la historia
            # de una compra que ya ocurrió.
            for campo in ("responsables", "departamento", "solicitado_por"):
                self.fields.pop(campo, None)

    def validate_compartido(self, value):
        """No se le quita la marca a un equipo que ya tiene varios responsables.

        Dejaría una ficha que el propio sistema no admitiría volver a guardar,
        y la salida —repartir a quién quitar— no es del formulario de la ficha
        técnica sino de la asignación, que deja el movimiento y el acta.
        """
        if value or self.instance is None:
            return value
        cuantos = self.instance.responsables.count()
        if cuantos > 1:
            raise serializers.ValidationError(
                f"Responden por él {cuantos} personas. Deje una sola en «Asignar» "
                "antes de quitarle la marca de compartido."
            )
        return value

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

        # Propiedad y concesionario se validan juntos: cada uno por separado
        # admite cualquier cosa y es la pareja la que puede no tener sentido.
        propiedad = attrs.get("propiedad", getattr(self.instance, "propiedad", None))
        concesionario = attrs.get("concesionario", getattr(self.instance, "concesionario", None))
        if propiedad == Activo.Propiedad.CONCESION and concesionario is None:
            # «En concesión» sin decir de quién es media ficha: no se podría
            # devolver el parque de un partner ni reclamarle nada.
            raise serializers.ValidationError(
                {"concesionario": "Diga de qué partner es el equipo en concesión."}
            )
        if propiedad == Activo.Propiedad.PROPIA and concesionario is not None:
            # Se vacía en vez de rechazarse: cambiar un equipo a propio es
            # justamente lo que pasa cuando la empresa se lo compra al partner,
            # y sería absurdo exigir dos pasos para algo que ya está dicho.
            attrs["concesionario"] = None

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

        La comprobación vive en `apps.activos.especificaciones` porque ya no la
        usa solo la ficha: una solicitud de compra describe lo que se pide con
        las mismas características y con las mismas exigencias.
        """
        limpias, errores = validar_especificaciones(
            tipo,
            especificaciones,
            heredadas=getattr(self.instance, "especificaciones", None) or {},
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

    # La lista completa de quienes responden **después** de la operación, no
    # los que se suman: vacía es una devolución a bodega. Mandarla entera es lo
    # que el formulario tiene delante, y evita que cada pantalla calcule la
    # diferencia a su manera.
    responsables = RelacionDeEmpresa(
        Empleado, {"activo": True}, many=True, required=False, default=list
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
