from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import serializers

from apps.empresas.campos import RelacionDeEmpresa

from . import departamentos_del_organigrama, documentos, niveles_cargo, noticias, organigrama
from .models import (
    Cargo,
    Concesionario,
    Departamento,
    DocumentoInstitucional,
    Empleado,
    EventoCalendario,
    Herramienta,
    NivelJerarquico,
    NoticiaInicio,
    Proveedor,
    Sede,
    UnidadOrganizacional,
)


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
    region_display = serializers.CharField(source="get_region_display", read_only=True)
    #: Quienes responden por la sede (mantenimiento de sedes). Se escriben por
    #: id y se leen también con su nombre, para pintarlos sin otra consulta.
    responsables = serializers.PrimaryKeyRelatedField(
        many=True, required=False, queryset=get_user_model().objects.filter(is_active=True)
    )
    responsables_detalle = serializers.SerializerMethodField()

    class Meta:
        model = Sede
        fields = [
            "id",
            "nombre",
            "ciudad",
            "direccion",
            "region",
            "region_display",
            "provincia",
            "responsables",
            "responsables_detalle",
            "activa",
            "total_activos",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_responsables_detalle(self, sede):
        return [
            {"id": u.id, "nombre": u.get_full_name() or u.username} for u in sede.responsables.all()
        ]

    def validate_responsables(self, usuarios):
        """Solo quien trabaja en la empresa: un responsable sin membresía no
        podría entrar a ver las órdenes de la sede que se le encarga."""
        from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

        empresa = empresa_actual()
        if empresa is None or empresa is SIN_EMPRESA:
            return usuarios
        ajenos = [
            u
            for u in usuarios
            if not u.is_superuser and not u.membresias.filter(empresa=empresa).exists()
        ]
        if ajenos:
            nombres = ", ".join(u.get_full_name() or u.username for u in ajenos)
            raise serializers.ValidationError(f"No trabajan en esta empresa: {nombres}.")
        return usuarios

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


class ConcesionarioSerializer(serializers.ModelSerializer):
    """El partner dueño de los equipos en concesión.

    Los mismos campos que el proveedor y a propósito: la pregunta de contacto
    es la misma —a quién se llama cuando algo falló—. Lo que cambia es qué
    responde cada catálogo, y por eso son dos. Ver `Concesionario`.
    """

    total_activos = serializers.IntegerField(read_only=True)

    # Sin el validador automático de unicidad, por lo mismo que en proveedores.
    nombre = serializers.CharField(max_length=150, validators=[])

    class Meta:
        model = Concesionario
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
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_nombre(self, value):
        """Rechaza el duplicado sin distinguir mayúsculas y diciendo con cuál
        choca: dos fichas del mismo partner repartirían sus equipos entre las
        dos, y entonces «qué equipos son de este partner» ya no tiene una sola
        respuesta —que es la única razón por la que existe este catálogo—."""
        nombre = (value or "").strip()
        existente = Concesionario.objects.filter(nombre__iexact=nombre)
        if self.instance is not None:
            existente = existente.exclude(pk=self.instance.pk)
        choque = existente.first()
        if choque:
            raise serializers.ValidationError(
                f"Ya existe un concesionario llamado «{choque.nombre}»."
            )
        return nombre


class EmpleadoSerializer(serializers.ModelSerializer):
    """El empleado se identifica con un código interno, no con su cédula.

    Ver la nota de `apps.organizacion.models.Empleado` y
    `docs/data-protection-review.md`.
    """

    nombre_completo = serializers.CharField(read_only=True)
    departamento_nombre = serializers.CharField(source="departamento.nombre", read_only=True)
    total_activos = serializers.IntegerField(read_only=True)
    #: Solo al crear la cuenta del empleado (ver `cuentas.py`); nunca se lee.
    password = serializers.CharField(
        write_only=True, required=False, allow_blank=True, trim_whitespace=False
    )
    usuario_username = serializers.CharField(source="usuario.username", read_only=True)

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
            "usuario_username",
            "password",
            "activo",
            "total_activos",
            "created_at",
            "updated_at",
        ]
        # El usuario no se elige ni se suelta: lo crea o lo ata el alta.
        read_only_fields = ["id", "usuario", "created_at", "updated_at"]
        extra_kwargs = {"codigo_empleado": {"required": False, "allow_blank": True}}

    def validate_codigo_empleado(self, value):
        return value.strip().upper()

    def validate(self, attrs):
        """Todo empleado tiene usuario: al crearlo (o al completar uno que no
        lo tenía) el correo institucional es obligatorio y, si la cuenta es
        nueva, también la contraseña inicial."""
        from . import cuentas

        instancia = self.instance
        # Desactivar a un pendiente (sin usuario) no le exige cuenta: es
        # justamente lo que se hace con quien ya no está.
        solo_desactiva = instancia is not None and set(attrs) == {"activo"} and not attrs["activo"]
        if solo_desactiva:
            return attrs
        if instancia is None or instancia.usuario_id is None:
            correo = cuentas.correo_institucional(
                attrs.get("correo", getattr(instancia, "correo", ""))
            )
            problema = cuentas.problema_con_la_cuenta(correo, excepto=instancia)
            if problema:
                raise serializers.ValidationError({"correo": problema})
            cuentas.validar_contrasena(correo, attrs.get("password"))
            attrs["correo"] = correo
        elif "correo" in attrs and attrs["correo"] != instancia.correo:
            attrs["correo"] = cuentas.correo_institucional(attrs["correo"])
        return attrs


class MisDatosSerializer(serializers.Serializer):
    """«Mi perfil»: lo que cada persona actualiza de sí misma."""

    nombres = serializers.CharField(max_length=150)
    apellidos = serializers.CharField(max_length=150)
    #: Opcional (26/10/2026); si viene, con su autorización (acepta_telefono).
    telefono = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")
    area = RelacionDeEmpresa(Departamento, {"activo": True})
    agencia = RelacionDeEmpresa(Sede, {"activa": True})
    #: Obligatorio desde el 20/10/2026, como el resto de «Mi perfil».
    cargo = RelacionDeEmpresa(Cargo, {"activo": True})
    #: Autoriza guardar su teléfono y que la empresa lo use para contactarlo.
    acepta_telefono = serializers.BooleanField(default=False)

    def validate_nombres(self, valor):
        if not valor.strip():
            raise serializers.ValidationError("Escriba sus nombres.")
        return valor

    def validate_apellidos(self, valor):
        if not valor.strip():
            raise serializers.ValidationError("Escriba sus apellidos.")
        return valor

    def validate_telefono(self, valor):
        if not valor.strip():
            return ""
        digitos = [c for c in valor if c.isdigit()]
        if not 7 <= len(digitos) <= 15:
            raise serializers.ValidationError("Escriba un teléfono de 7 a 15 dígitos.")
        return valor.strip()


# --- Organigrama (módulo Institucional) ---------------------------------------


class NivelJerarquicoSerializer(serializers.ModelSerializer):
    nombre = serializers.CharField(max_length=80, validators=[])

    class Meta:
        model = NivelJerarquico
        fields = ["id", "nombre", "orden"]

    def validate_nombre(self, valor):
        valor = valor.strip()
        repetido = NivelJerarquico.objects.filter(nombre__iexact=valor)
        if self.instance is not None:
            repetido = repetido.exclude(pk=self.instance.pk)
        if repetido.exists():
            raise serializers.ValidationError(f"Ya hay un nivel «{valor}».")
        return valor


class UnidadOrganizacionalSerializer(serializers.ModelSerializer):
    nivel = RelacionDeEmpresa(NivelJerarquico)
    padre = RelacionDeEmpresa(UnidadOrganizacional, required=False, allow_null=True)
    #: Lo crea y mantiene el sistema (la unidad es el departamento).
    departamento = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = UnidadOrganizacional
        fields = [
            "id",
            "nombre",
            "codigo",
            "nivel",
            "padre",
            "departamento",
            "descripcion",
            "activa",
            "orden",
        ]

    def validate(self, datos):
        nivel = datos.get("nivel", getattr(self.instance, "nivel", None))
        padre = datos.get("padre", getattr(self.instance, "padre", None))
        organigrama.validar_padre(self.instance, padre, nivel)
        return datos

    # La unidad es el departamento: se guarda con él, en la misma transacción.
    @transaction.atomic
    def create(self, datos):
        unidad = super().create(datos)
        departamentos_del_organigrama.sincronizar(unidad)
        return unidad

    @transaction.atomic
    def update(self, instancia, datos):
        unidad = super().update(instancia, datos)
        departamentos_del_organigrama.sincronizar(unidad)
        return unidad


class CargoSerializer(serializers.ModelSerializer):
    unidad = RelacionDeEmpresa(UnidadOrganizacional)
    jefe = RelacionDeEmpresa(Cargo, required=False, allow_null=True)
    plazas = serializers.IntegerField(min_value=1, max_value=999, default=1)

    class Meta:
        model = Cargo
        fields = ["id", "nombre", "unidad", "jefe", "plazas", "nivel", "descripcion", "activo"]
        extra_kwargs = {"nivel": {"required": False}}

    def validate(self, datos):
        nombre = datos.get("nombre", getattr(self.instance, "nombre", "")).strip()
        unidad = datos.get("unidad", getattr(self.instance, "unidad", None))
        jefe = datos.get("jefe", getattr(self.instance, "jefe", None))
        # Nivel jerárquico (niveles_cargo.py). Un cargo nuevo sin nivel toma el
        # de su nombre (Jefe… → Jefatura), nunca por encima del de su jefe. Si
        # se elige el nivel o se cambia el jefe, no puede reportar a un cargo de
        # nivel más bajo.
        if self.instance is None and not datos.get("nivel"):
            nivel = niveles_cargo.sugerido(nombre, jefe)
        else:
            nivel = datos.get("nivel") or self.instance.nivel
        if self.instance is not None and "nivel" in datos:
            mas_altos = [
                s.nombre
                for s in self.instance.subordinados.filter(activo=True)
                if niveles_cargo.ORDEN[s.nivel] < niveles_cargo.ORDEN[nivel]
            ]
            if mas_altos:
                raise serializers.ValidationError(
                    {
                        "nivel": (
                            f"Le reportan cargos de nivel superior ({', '.join(mas_altos)}): "
                            "cámbieles el jefe o el nivel antes."
                        )
                    }
                )
        datos["nivel"] = nivel
        # El mismo nombre se repite en una unidad bajo jefes distintos («Asesor
        # Comercial» del coordinador y del jefe de ventas), no bajo el mismo.
        repetido = Cargo.objects.filter(nombre__iexact=nombre, unidad=unidad, jefe=jefe)
        if self.instance is not None:
            repetido = repetido.exclude(pk=self.instance.pk)
        if repetido.exists():
            bajo = f" que reporte a «{jefe}»" if jefe else " sin jefe"
            raise serializers.ValidationError(
                {"nombre": f"«{unidad}» ya tiene un cargo «{nombre}»{bajo}."}
            )
        organigrama.validar_jefe(self.instance, jefe)
        if "nivel" in datos or "jefe" in datos:
            niveles_cargo.validar_jefe(nivel, jefe)
        datos["nombre"] = nombre
        return datos


class AsignacionSerializer(serializers.Serializer):
    """Poner a una persona en un cargo (o sacarla, con `cargo` vacío)."""

    usuario = serializers.IntegerField()
    cargo = RelacionDeEmpresa(Cargo, {"activo": True}, allow_null=True)


class DocumentoInstitucionalSerializer(serializers.ModelSerializer):
    """Un código o reglamento. El archivo se sube al crear (y puede
    reemplazarse al editar); nunca se devuelve su ruta, solo lo que hace falta
    para mostrarlo."""

    archivo = serializers.FileField(write_only=True, required=False)
    # Explícito: en un formulario multipart, un booleano que no viene se lee
    # como `False` y el documento se publicaría ya retirado.
    activo = serializers.BooleanField(default=True)
    predeterminado = serializers.BooleanField(default=False)
    categoria_display = serializers.CharField(source="get_categoria_display", read_only=True)
    es_pdf = serializers.SerializerMethodField()
    subido_por_nombre = serializers.SerializerMethodField()

    class Meta:
        model = DocumentoInstitucional
        fields = [
            "id",
            "titulo",
            "categoria",
            "categoria_display",
            "descripcion",
            "version",
            "vigente_desde",
            "archivo",
            "nombre_original",
            "tamano_bytes",
            "es_pdf",
            "activo",
            "predeterminado",
            "subido_por_nombre",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["nombre_original", "tamano_bytes", "created_at", "updated_at"]

    def get_es_pdf(self, documento) -> bool:
        return documento.extension == ".pdf"

    def get_subido_por_nombre(self, documento) -> str:
        quien = documento.subido_por
        return (quien.get_full_name().strip() or quien.username) if quien else ""

    def validate_archivo(self, archivo):
        self._extension = documentos.validar(archivo)
        return archivo

    def validate(self, datos):
        if self.instance is None and not datos.get("archivo"):
            raise serializers.ValidationError({"archivo": "Adjunte el documento (PDF o Word)."})
        archivo = datos.get("archivo")
        if archivo:
            datos["nombre_original"] = archivo.name[:255]
            datos["tamano_bytes"] = archivo.size
            datos["content_type"] = documentos.TIPOS[self._extension]
        return datos


class AcuerdoConfidencialidadSerializer(serializers.Serializer):
    titulo = serializers.CharField(max_length=200)
    texto = serializers.CharField()


class NoticiaInicioSerializer(serializers.ModelSerializer):
    """Una imagen del carrusel de Inicio. La imagen se sube al crear (y puede
    reemplazarse); nunca se devuelve su ruta."""

    imagen = serializers.FileField(write_only=True, required=False)
    estado = serializers.SerializerMethodField()

    class Meta:
        model = NoticiaInicio
        fields = [
            "id",
            "titulo",
            "descripcion",
            "imagen",
            "nombre_original",
            "tamano_bytes",
            "publicar_desde",
            "publicar_hasta",
            "orden",
            "estado",
            "created_at",
        ]
        read_only_fields = ["nombre_original", "tamano_bytes", "created_at"]

    def get_estado(self, noticia) -> str:
        return noticias.estado(noticia)

    def validate_imagen(self, archivo):
        self._extension = noticias.validar_imagen(archivo)
        return archivo

    def validate(self, datos):
        if self.instance is None and not datos.get("imagen"):
            raise serializers.ValidationError({"imagen": "Adjunte la imagen."})
        desde = datos.get("publicar_desde", getattr(self.instance, "publicar_desde", None))
        hasta = datos.get("publicar_hasta", getattr(self.instance, "publicar_hasta", None))
        if desde and hasta and hasta < desde:
            raise serializers.ValidationError(
                {"publicar_hasta": "La fecha de fin no puede ser anterior a la de inicio."}
            )
        imagen = datos.get("imagen")
        if imagen:
            datos["nombre_original"] = imagen.name[:255]
            datos["tamano_bytes"] = imagen.size
            datos["content_type"] = noticias.TIPOS[self._extension]
        return datos


class AjustesCarruselSerializer(serializers.Serializer):
    segundos = serializers.IntegerField(
        min_value=noticias.SEGUNDOS_MIN, max_value=noticias.SEGUNDOS_MAX
    )


class EventoCalendarioSerializer(serializers.ModelSerializer):
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)
    cada_anio = serializers.BooleanField(default=False)

    class Meta:
        model = EventoCalendario
        fields = [
            "id",
            "titulo",
            "tipo",
            "tipo_display",
            "fecha",
            "fecha_fin",
            "descripcion",
            "cada_anio",
        ]

    def validate(self, datos):
        fecha = datos.get("fecha", getattr(self.instance, "fecha", None))
        fin = datos.get("fecha_fin", getattr(self.instance, "fecha_fin", None))
        if fecha and fin and fin < fecha:
            raise serializers.ValidationError(
                {"fecha_fin": "La fecha de fin no puede ser anterior a la de inicio."}
            )
        return datos


class AvisoInicioSerializer(serializers.Serializer):
    """Lo que se guarda del aviso al iniciar sesión. La imagen es opcional; se
    reemplaza subiendo otra o se quita con `quitar_imagen`."""

    activo = serializers.BooleanField(default=False)
    titulo = serializers.CharField(max_length=150, allow_blank=True, default="")
    contenido = serializers.CharField(allow_blank=True, default="")
    imagen = serializers.FileField(required=False)
    quitar_imagen = serializers.BooleanField(default=False)

    def validate_imagen(self, archivo):
        self._extension = noticias.validar_imagen(archivo)
        return archivo

    def validate(self, datos):
        if datos.get("activo") and not datos.get("titulo", "").strip():
            raise serializers.ValidationError(
                {"titulo": "Escriba un título para poder mostrar el aviso."}
            )
        if datos.get("imagen"):
            datos["content_type"] = noticias.TIPOS[self._extension]
        return datos


class CumpleanosSerializer(serializers.Serializer):
    """Mostrar o no el cumpleaños en el calendario. Para mostrarlo hay que
    aceptar que sea público y dar el día y el mes (el año no se guarda)."""

    mostrar = serializers.BooleanField()
    acepto = serializers.BooleanField(default=False)
    dia = serializers.IntegerField(min_value=1, max_value=31, required=False, allow_null=True)
    mes = serializers.IntegerField(min_value=1, max_value=12, required=False, allow_null=True)

    def validate(self, datos):
        if not datos["mostrar"]:
            return datos
        if not datos.get("acepto"):
            raise serializers.ValidationError(
                {"acepto": "Para mostrar su cumpleaños, acepte que sea visible para la empresa."}
            )
        dia, mes = datos.get("dia"), datos.get("mes")
        if not dia or not mes:
            raise serializers.ValidationError({"dia": "Indique el día y el mes de su cumpleaños."})
        import datetime

        try:
            datetime.date(2024, mes, dia)  # 2024 es bisiesto: el 29/02 vale
        except ValueError:
            raise serializers.ValidationError({"dia": "Esa fecha no existe."}) from None
        return datos


class AniversarioSerializer(serializers.Serializer):
    """Mostrar o no el aniversario en la empresa en el calendario. Para
    mostrarlo hay que aceptar que sea público y dar día y mes de ingreso; el
    año es opcional y no puede ser futuro."""

    mostrar = serializers.BooleanField()
    acepto = serializers.BooleanField(default=False)
    dia = serializers.IntegerField(min_value=1, max_value=31, required=False, allow_null=True)
    mes = serializers.IntegerField(min_value=1, max_value=12, required=False, allow_null=True)
    anio = serializers.IntegerField(min_value=1950, max_value=2100, required=False, allow_null=True)

    def validate(self, datos):
        if not datos["mostrar"]:
            return datos
        if not datos.get("acepto"):
            raise serializers.ValidationError(
                {"acepto": "Para mostrar su aniversario, acepte que sea visible para la empresa."}
            )
        dia, mes, anio = datos.get("dia"), datos.get("mes"), datos.get("anio")
        if not dia or not mes:
            raise serializers.ValidationError(
                {"dia": "Indique al menos el día y el mes de su ingreso."}
            )
        import datetime

        from django.utils import timezone

        try:
            fecha = datetime.date(anio or 2024, mes, dia)  # 2024: el 29/02 vale
        except ValueError:
            raise serializers.ValidationError({"dia": "Esa fecha no existe."}) from None
        if anio and fecha > timezone.localdate():
            raise serializers.ValidationError({"anio": "La fecha de ingreso no puede ser futura."})
        return datos


class PerfilCargoSerializer(serializers.Serializer):
    """El perfil de un cargo. Funciones, competencias y KPIs: una por línea."""

    objetivo = serializers.CharField(allow_blank=True, max_length=2000, default="")
    funciones = serializers.CharField(allow_blank=True, max_length=6000, default="")
    competencias = serializers.CharField(allow_blank=True, max_length=4000, default="")
    kpis = serializers.CharField(allow_blank=True, max_length=4000, default="")
    #: Las herramientas base del cargo (ids del catálogo); sin el campo, no se tocan.
    herramientas = serializers.ListField(
        child=serializers.IntegerField(), required=False, allow_empty=True
    )


class HerramientaSerializer(serializers.ModelSerializer):
    nombre = serializers.CharField(max_length=120, validators=[])

    class Meta:
        model = Herramienta
        fields = ["id", "nombre", "tipo", "descripcion", "activa", "orden"]

    def validate_nombre(self, valor):
        valor = valor.strip()
        repetida = Herramienta.objects.filter(nombre__iexact=valor)
        if self.instance is not None:
            repetida = repetida.exclude(pk=self.instance.pk)
        if repetida.exists():
            raise serializers.ValidationError(f"Ya hay una herramienta «{valor}».")
        return valor


class MiHerramientaSerializer(serializers.Serializer):
    herramienta = serializers.IntegerField()
    cuenta = serializers.CharField(max_length=150, allow_blank=True, default="")
    detalle = serializers.CharField(max_length=500, allow_blank=True, default="")


class MisHerramientasSerializer(serializers.Serializer):
    herramientas = MiHerramientaSerializer(many=True)


class AccesoHerramientaSerializer(serializers.Serializer):
    usuario = serializers.IntegerField()
    cuenta = serializers.CharField(max_length=150, allow_blank=True, default="")
    detalle = serializers.CharField(max_length=500, allow_blank=True, default="")
