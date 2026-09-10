"""Carga masiva de los catálogos, un archivo por catálogo.

La plantilla de activos llegó a traer ocho hojas en un solo libro: la de
captura, las instrucciones, el ejemplo y cinco de catálogos que estaban ahí
solo como referencia. Quien abría el archivo veía material de consulta mezclado
con material de trabajo, y —lo que importa más— no podía **cargar** ninguno de
esos catálogos: para dar de alta cincuenta empleados había que teclearlos uno a
uno mientras el archivo ya los listaba.

Aquí cada catálogo tiene su propio archivo, y el archivo hace las dos cosas: se
descarga **con lo que ya existe dentro**, así que sirve de referencia mientras
se llena la plantilla de activos, y se sube con filas nuevas añadidas debajo.
Las que ya estaban se reconocen y se omiten, de modo que bajar y volver a subir
el mismo archivo no duplica nada — que es lo que la gente hace en cuanto
descubre que el archivo se puede reutilizar.

Los catálogos se declaran como datos y no como cinco importadores: son cinco
veces «lea una hoja, valide columnas, resuelva referencias, cree filas», y
escribirlos por separado daría cinco piezas que envejecen sueltas. Es el mismo
criterio de `apps/reportes/catalogo.py`.
"""

from dataclasses import dataclass, field

from django.apps import apps


@dataclass(frozen=True)
class Referencia:
    """Una columna que apunta a otro catálogo, escrita como texto.

    Quien llena la plantilla escribe «TI» o «Tecnología», no un identificador:
    por eso se busca por varios campos y se acepta el primero que case.
    """

    modelo: str
    campos: tuple[str, ...]
    #: Solo se ofrecen los vigentes: dar de alta a alguien en un área cerrada
    #: lo deja en un sitio del que nadie se ocupa.
    filtro: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Columna:
    clave: str
    etiqueta: str
    obligatoria: bool = False
    ayuda: str = ""
    ancho: int = 26
    referencia: Referencia | None = None
    #: Se pide al cargar, pero **no se escribe** al descargar el archivo con lo
    #: que ya existe. El .xlsx se descarga y circula por correo o USB: el
    #: teléfono y el correo de cada empleado no tienen por qué viajar con él,
    #: y para reconocer una fila que ya está basta con su código y su nombre
    #: (ver `docs/data-protection-review.md`).
    sensible: bool = False

    @property
    def encabezado(self) -> str:
        return f"{self.etiqueta} *" if self.obligatoria else self.etiqueta


@dataclass(frozen=True)
class CatalogoMasivo:
    clave: str
    nombre: str
    #: Plural, para los textos: «3 sedes creadas».
    plural: str
    modelo: str
    permiso: str
    columnas: tuple[Columna, ...]
    #: Con qué se reconoce una fila que ya está. Es lo que hace que volver a
    #: subir el archivo descargado no duplique nada.
    identifica_por: tuple[str, ...]
    orden: tuple[str, ...]
    filtro_vigentes: dict = field(default_factory=dict)
    nota: str = ""

    def obtener_modelo(self):
        return apps.get_model(*self.modelo.split("."))

    def columna(self, clave: str) -> Columna | None:
        return next((c for c in self.columnas if c.clave == clave), None)


CATALOGOS: tuple[CatalogoMasivo, ...] = (
    CatalogoMasivo(
        clave="sedes",
        nombre="Sedes",
        plural="sedes",
        modelo="organizacion.Sede",
        permiso="organizacion.editar",
        columnas=(
            Columna("nombre", "Nombre", obligatoria=True, ayuda="Ej.: «Sede Quito Norte»."),
            Columna(
                "ciudad",
                "Ciudad",
                ayuda="Es lo que se muestra al decir dónde está un equipo. Ej.: «Quito».",
            ),
            Columna("direccion", "Dirección", ancho=36),
        ),
        identifica_por=("nombre",),
        orden=("nombre",),
        filtro_vigentes={"activa": True},
        nota="La ciudad no es de adorno: es lo que se lee al preguntar dónde está un equipo.",
    ),
    CatalogoMasivo(
        clave="departamentos",
        nombre="Departamentos",
        plural="áreas",
        modelo="organizacion.Departamento",
        permiso="organizacion.editar",
        columnas=(
            Columna(
                "codigo", "Código", obligatoria=True, ayuda="Corto y único. Ej.: «TI».", ancho=14
            ),
            Columna("nombre", "Nombre", obligatoria=True),
            Columna("descripcion", "Descripción", ancho=40),
        ),
        identifica_por=("codigo",),
        orden=("nombre",),
        filtro_vigentes={"activo": True},
        nota=(
            "El código va delante del código de cada empleado del área "
            "(«TI-0001»), así que conviene que sea corto."
        ),
    ),
    CatalogoMasivo(
        clave="proveedores",
        nombre="Proveedores",
        plural="proveedores",
        modelo="organizacion.Proveedor",
        permiso="organizacion.editar",
        columnas=(
            Columna("nombre", "Nombre", obligatoria=True, ayuda="Como aparece en la factura."),
            Columna("identificacion", "Identificación", ayuda="RUC o identificación tributaria."),
            Columna("contacto", "Contacto"),
            Columna("telefono", "Teléfono", ancho=18),
            Columna("correo", "Correo"),
        ),
        identifica_por=("nombre",),
        orden=("nombre",),
        filtro_vigentes={"activo": True},
        nota="El teléfono se necesita justo cuando algo falló: conviene llenarlo.",
    ),
    CatalogoMasivo(
        clave="tipos",
        nombre="Tipos de dispositivo",
        plural="tipos",
        modelo="activos.TipoDispositivo",
        permiso="activos.editar",
        columnas=(
            Columna(
                "codigo",
                "Código",
                obligatoria=True,
                ayuda="Solo letras y dígitos: va dentro del código de barras. Ej.: «LAP».",
                ancho=14,
            ),
            Columna("nombre", "Nombre", obligatoria=True),
            Columna("descripcion", "Descripción", ancho=40),
        ),
        identifica_por=("codigo",),
        orden=("nombre",),
        filtro_vigentes={"activo": True},
        nota=(
            "El código numera las etiquetas («GA-LAP-000007»): repetido, dos "
            "tipos producirían códigos que no distinguen de qué equipo son."
        ),
    ),
    CatalogoMasivo(
        clave="empleados",
        nombre="Empleados",
        plural="empleados",
        modelo="organizacion.Empleado",
        permiso="organizacion.editar",
        columnas=(
            Columna("nombres", "Nombres", obligatoria=True),
            Columna("apellidos", "Apellidos", obligatoria=True),
            Columna(
                "departamento",
                "Área",
                obligatoria=True,
                ayuda="Código o nombre exacto del área.",
                referencia=Referencia(
                    modelo="organizacion.Departamento",
                    campos=("codigo", "nombre"),
                    filtro={"activo": True},
                ),
            ),
            Columna("cargo", "Cargo"),
            Columna("correo", "Correo", sensible=True),
            Columna("telefono", "Teléfono", ancho=18, sensible=True),
            Columna(
                "codigo_empleado",
                "Código",
                ayuda="Déjelo vacío y el sistema lo genera con el área delante: «TI-0001».",
                ancho=14,
            ),
        ),
        identifica_por=("codigo_empleado",),
        orden=("apellidos", "nombres"),
        filtro_vigentes={"activo": True},
        nota=(
            "Deje el código vacío salvo que ya tenga uno propio: el sistema lo "
            "genera con el área delante y un correlativo por área."
        ),
    ),
)

POR_CLAVE = {catalogo.clave: catalogo for catalogo in CATALOGOS}
