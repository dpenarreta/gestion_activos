"""Los trece reportes del §16, definidos como datos y no como código.

Nueve de los trece son el mismo listado de activos con otro filtro y otro
orden. Escribir trece vistas con su consulta, su exportador de Excel, su CSV y
su PDF daría treinta y nueve piezas que envejecen por separado: el día que se
agrega un campo a la ficha, doce reportes lo muestran y uno no, y nadie sabe
cuál hasta que alguien lo reclama.

Aquí cada reporte declara qué mira, qué columnas tiene y qué parámetros
acepta; un solo motor los ejecuta (`consultas.py`) y tres renderizadores los
escriben (`render_excel`, `render_csv`, `render_pdf`). Agregar un reporte es
agregar una entrada a este archivo.

`columnas_pdf` existe porque el PDF es para leer e imprimir, no para analizar:
una tabla de veinte columnas en A4 sale ilegible aunque quepa. Cuando un
reporte no la declara, el PDF usa las primeras columnas que caben.
"""

from dataclasses import dataclass, field
from decimal import Decimal

from apps.activos.models import ESTADOS_EN_ALMACEN, ESTADOS_FUERA_DE_INVENTARIO, Activo

#: Tope de filas de un reporte. El documento dimensiona el parque entre 5.000 y
#: 10.000 activos: por encima de eso el archivo deja de ser un reporte y pasa a
#: ser un volcado, que es lo que hace la exportación del inventario.
MAX_FILAS = 10000

#: El PDF se corta antes: nadie lee trescientas páginas, y generarlas tarda más
#: de lo que cualquiera espera frente a un botón. El archivo avisa del corte.
MAX_FILAS_PDF = 1000


class Fuente:
    ACTIVOS = "activos"
    MOVIMIENTOS = "movimientos"
    MANTENIMIENTOS = "mantenimientos"


@dataclass(frozen=True)
class Columna:
    clave: str
    etiqueta: str
    #: Cómo se saca el valor de cada fila. Devuelve un tipo simple: los tres
    #: renderizadores lo escriben tal cual, y un objeto obligaría a que cada
    #: uno supiera formatearlo.
    valor: callable
    ancho: int = 20


@dataclass(frozen=True)
class Reporte:
    clave: str
    nombre: str
    descripcion: str
    fuente: str
    columnas: tuple[Columna, ...]
    #: Parámetros que este reporte acepta, de los que expone la API.
    parametros: tuple[str, ...] = ()
    #: Filtros que definen el reporte y no se pueden quitar desde la API.
    filtros: dict = field(default_factory=dict)
    orden: tuple[str, ...] = ()
    columnas_pdf: tuple[str, ...] = ()
    #: Si el reporte mira solo el parque vivo. Casi todos sí: un equipo robado
    #: en «activos por área» haría creer que el área todavía lo tiene. Las dos
    #: excepciones son el inventario general —que es el censo completo— y el
    #: de bajas, que existe precisamente para lo que salió.
    solo_operativos: bool = True
    #: Columnas cuyo total se suma al pie. Solo tienen sentido en dinero y
    #: cantidades; un total de «antigüedad» no significaría nada.
    totalizar: tuple[str, ...] = ()

    def columnas_para(self, formato: str) -> tuple[Columna, ...]:
        if formato != "pdf" or not self.columnas_pdf:
            return self.columnas
        indice = {columna.clave: columna for columna in self.columnas}
        return tuple(indice[clave] for clave in self.columnas_pdf if clave in indice)


# --- Extractores compartidos ------------------------------------------------
# Se nombran en vez de escribirse como lambdas repetidas: el mismo dato debe
# verse igual en los nueve reportes de activos.


def _texto(valor) -> str:
    return "" if valor is None else str(valor)


def _custodio(activo) -> str:
    return activo.custodio.nombre_completo if activo.custodio_id else "Sin asignar"


def _ubicacion(activo) -> str:
    return activo.ubicacion.nombre_completo if activo.ubicacion_id else ""


def _sede(activo) -> str:
    return activo.ubicacion.sede.nombre if activo.ubicacion_id else ""


def _tramo_antiguedad(activo) -> str:
    """Tramo legible, para que el reporte se pueda leer sin hacer cuentas."""
    meses = activo.antiguedad_meses
    if meses < 12:
        return "Menos de 1 año"
    if meses < 36:
        return "Entre 1 y 3 años"
    if meses < 60:
        return "Entre 3 y 5 años"
    return "Más de 5 años"


COLUMNAS_ACTIVO_BASE = (
    Columna("codigo_barras", "Código", lambda a: a.codigo_barras, 18),
    Columna("nombre", "Nombre", lambda a: a.nombre, 28),
    Columna("tipo", "Tipo", lambda a: a.tipo.nombre, 16),
    Columna("marca", "Marca", lambda a: a.marca, 14),
    Columna("modelo", "Modelo", lambda a: a.modelo, 18),
    Columna("numero_serie", "Número de serie", lambda a: a.numero_serie, 20),
    Columna("estado", "Estado", lambda a: a.get_estado_display(), 18),
)

COLUMNAS_ACTIVO_CONTEXTO = (
    Columna("departamento", "Área", lambda a: a.departamento.nombre, 20),
    Columna("custodio", "Custodio", _custodio, 26),
    Columna("sede", "Sede", _sede, 18),
    Columna("ubicacion", "Ubicación", _ubicacion, 24),
    Columna("criticidad", "Criticidad", lambda a: a.get_criticidad_display(), 12),
    Columna("uso", "Uso", lambda a: a.get_uso_display(), 18),
)

COLUMNAS_ACTIVO_ECONOMICO = (
    Columna("fecha_adquisicion", "Adquirido", lambda a: a.fecha_adquisicion, 14),
    Columna("fecha_ingreso", "Ingreso", lambda a: a.fecha_ingreso, 14),
    Columna("antiguedad", "Antigüedad (meses)", lambda a: a.antiguedad_meses, 16),
    Columna("costo", "Costo de compra", lambda a: a.costo_adquisicion, 16),
    Columna("proveedor", "Proveedor", lambda a: a.proveedor, 20),
)


def _mantenimiento_costo_total(mantenimiento) -> Decimal:
    return mantenimiento.costo_total or Decimal("0")


COLUMNAS_MANTENIMIENTO = (
    Columna("fecha", "Ingreso", lambda m: m.fecha_intervencion, 12),
    Columna("salida", "Salida", lambda m: m.fecha_salida, 12),
    Columna("dias", "Días fuera", lambda m: m.dias_fuera_de_operacion, 11),
    Columna("codigo", "Código del activo", lambda m: m.activo.codigo_barras, 18),
    Columna("activo", "Activo", lambda m: m.activo.nombre, 26),
    Columna("tipo", "Tipo", lambda m: m.get_tipo_display(), 14),
    Columna("causa", "Causa", lambda m: m.causa, 24),
    Columna("descripcion", "Trabajo realizado", lambda m: m.descripcion, 36),
    Columna("solucion", "Solución", lambda m: m.solucion, 30),
    Columna("estado_final", "Estado final", lambda m: m.get_estado_final_display(), 16),
    Columna("responsable", "Responsable", lambda m: m.responsable, 22),
    Columna("garantia", "Por garantía", lambda m: "Sí" if m.garantia_usada else "No", 12),
    Columna("costo", "Costo total", _mantenimiento_costo_total, 14),
)

COLUMNAS_MOVIMIENTO = (
    Columna("fecha", "Fecha", lambda m: m.created_at.date(), 12),
    Columna("tipo", "Movimiento", lambda m: m.get_tipo_display(), 22),
    Columna("codigo", "Código del activo", lambda m: m.activo.codigo_barras, 18),
    Columna("activo", "Activo", lambda m: m.activo.nombre, 26),
    Columna(
        "custodio_anterior",
        "Custodio anterior",
        lambda m: m.custodio_anterior.nombre_completo if m.custodio_anterior_id else "",
        26,
    ),
    Columna(
        "custodio_nuevo",
        "Custodio nuevo",
        lambda m: m.custodio_nuevo.nombre_completo if m.custodio_nuevo_id else "",
        26,
    ),
    Columna(
        "departamento",
        "Área destino",
        lambda m: m.departamento_nuevo.nombre if m.departamento_nuevo_id else "",
        20,
    ),
    Columna("estado", "Estado resultante", lambda m: _texto(m.estado_nuevo), 18),
    Columna("motivo", "Motivo", lambda m: m.motivo, 34),
    Columna(
        "registrado_por",
        "Registrado por",
        lambda m: m.registrado_por.username if m.registrado_por_id else "",
        18,
    ),
)


# --- Los trece reportes del §16 ---------------------------------------------

PARAMETROS_ACTIVOS = ("departamento", "ubicacion", "tipo", "criticidad", "uso")

CATALOGO = (
    Reporte(
        clave="inventario-general",
        nombre="Inventario general",
        descripcion="Todos los activos registrados, con su ficha resumida.",
        fuente=Fuente.ACTIVOS,
        columnas=COLUMNAS_ACTIVO_BASE + COLUMNAS_ACTIVO_CONTEXTO + COLUMNAS_ACTIVO_ECONOMICO,
        parametros=PARAMETROS_ACTIVOS,
        orden=("codigo_barras",),
        columnas_pdf=("codigo_barras", "nombre", "tipo", "estado", "departamento", "custodio"),
        totalizar=("costo",),
        solo_operativos=False,
    ),
    Reporte(
        clave="activos-por-area",
        nombre="Activos por área",
        descripcion="El parque agrupado por el área que lo tiene adscrito.",
        fuente=Fuente.ACTIVOS,
        columnas=(Columna("departamento", "Área", lambda a: a.departamento.nombre, 22),)
        + COLUMNAS_ACTIVO_BASE
        + (Columna("custodio", "Custodio", _custodio, 26),),
        parametros=PARAMETROS_ACTIVOS,
        orden=("departamento__nombre", "codigo_barras"),
        columnas_pdf=("departamento", "codigo_barras", "nombre", "tipo", "estado", "custodio"),
    ),
    Reporte(
        clave="activos-por-usuario",
        nombre="Activos por usuario",
        descripcion="Qué tiene cada custodio a su cargo. Excluye lo que está sin asignar.",
        fuente=Fuente.ACTIVOS,
        columnas=(Columna("custodio", "Custodio", _custodio, 26),)
        + COLUMNAS_ACTIVO_BASE
        + (
            Columna("departamento", "Área", lambda a: a.departamento.nombre, 20),
            Columna("ubicacion", "Ubicación", _ubicacion, 24),
        ),
        # Sin custodio no hay a quién reclamarle: el listado de lo no asignado
        # es otro reporte («Activos disponibles»), con otra acción detrás.
        filtros={"custodio__isnull": False},
        parametros=PARAMETROS_ACTIVOS,
        orden=("custodio__apellidos", "custodio__nombres", "codigo_barras"),
        columnas_pdf=("custodio", "codigo_barras", "nombre", "tipo", "estado"),
    ),
    Reporte(
        clave="activos-por-ubicacion",
        nombre="Activos por ubicación",
        descripcion="Dónde está cada equipo. Es la hoja de ruta del inventario físico.",
        fuente=Fuente.ACTIVOS,
        columnas=(
            Columna("sede", "Sede", _sede, 20),
            Columna("ubicacion", "Ubicación", _ubicacion, 24),
        )
        + COLUMNAS_ACTIVO_BASE
        + (Columna("custodio", "Custodio", _custodio, 26),),
        parametros=PARAMETROS_ACTIVOS,
        orden=("ubicacion__sede__nombre", "ubicacion__nombre", "codigo_barras"),
        columnas_pdf=("sede", "ubicacion", "codigo_barras", "nombre", "estado", "custodio"),
    ),
    Reporte(
        clave="activos-disponibles",
        nombre="Activos disponibles",
        descripcion="Lo que hay en almacén: disponible para entregar o guardado en bodega.",
        fuente=Fuente.ACTIVOS,
        columnas=COLUMNAS_ACTIVO_BASE
        + (
            Columna("sede", "Sede", _sede, 18),
            Columna("ubicacion", "Ubicación", _ubicacion, 24),
            Columna("antiguedad", "Antigüedad (meses)", lambda a: a.antiguedad_meses, 16),
        ),
        filtros={"estado__in": tuple(ESTADOS_EN_ALMACEN)},
        parametros=PARAMETROS_ACTIVOS,
        orden=("estado", "codigo_barras"),
        columnas_pdf=("codigo_barras", "nombre", "tipo", "estado", "ubicacion", "antiguedad"),
    ),
    Reporte(
        clave="activos-en-reparacion",
        nombre="Activos en reparación",
        descripcion=("Equipos fuera de operación: en el taller o en reclamación al proveedor."),
        fuente=Fuente.ACTIVOS,
        columnas=COLUMNAS_ACTIVO_BASE
        + (
            Columna("departamento", "Área", lambda a: a.departamento.nombre, 20),
            Columna("custodio", "Custodio", _custodio, 26),
            Columna("intervenciones", "Intervenciones", lambda a: a.total_mantenimientos, 14),
        ),
        # Los dos estados describen lo mismo desde la operación: el equipo no
        # está disponible y alguien lo está arreglando. Quién paga la
        # reparación es otra pregunta.
        filtros={"estado__in": (Activo.Estado.EN_MANTENIMIENTO, Activo.Estado.EN_GARANTIA)},
        parametros=PARAMETROS_ACTIVOS,
        orden=("codigo_barras",),
        columnas_pdf=("codigo_barras", "nombre", "tipo", "estado", "custodio", "intervenciones"),
    ),
    Reporte(
        clave="activos-fuera-de-inventario",
        nombre="Activos dados de baja",
        descripcion=("Equipos que salieron del parque: bajas, pérdidas y robos, con su motivo."),
        fuente=Fuente.ACTIVOS,
        columnas=COLUMNAS_ACTIVO_BASE
        + (
            Columna("fecha_baja", "Fecha de salida", lambda a: a.fecha_baja, 14),
            Columna("motivo_baja", "Motivo", lambda a: a.motivo_baja, 40),
            Columna("departamento", "Área", lambda a: a.departamento.nombre, 20),
            Columna("costo", "Costo de compra", lambda a: a.costo_adquisicion, 16),
        ),
        # Incluye las tres salidas y no solo la baja: para el inventario los
        # tres equipos ya no están, y separar el robo de la baja es
        # justamente lo que hace útil la columna «motivo».
        filtros={"estado__in": tuple(ESTADOS_FUERA_DE_INVENTARIO)},
        parametros=("departamento", "tipo"),
        orden=("-fecha_baja", "codigo_barras"),
        columnas_pdf=("codigo_barras", "nombre", "estado", "fecha_baja", "motivo_baja"),
        totalizar=("costo",),
        solo_operativos=False,
    ),
    Reporte(
        clave="activos-por-antiguedad",
        nombre="Activos por antigüedad",
        descripcion="El parque ordenado del más viejo al más nuevo, por tramos.",
        fuente=Fuente.ACTIVOS,
        columnas=(
            Columna("tramo", "Tramo", _tramo_antiguedad, 18),
            Columna("antiguedad", "Antigüedad (meses)", lambda a: a.antiguedad_meses, 16),
        )
        + COLUMNAS_ACTIVO_BASE
        + (
            Columna("fecha_adquisicion", "Adquirido", lambda a: a.fecha_adquisicion, 14),
            Columna("departamento", "Área", lambda a: a.departamento.nombre, 20),
            Columna("custodio", "Custodio", _custodio, 26),
        ),
        parametros=PARAMETROS_ACTIVOS + ("antiguedad_min_meses", "antiguedad_max_meses"),
        orden=("fecha_adquisicion",),
        columnas_pdf=("tramo", "antiguedad", "codigo_barras", "nombre", "tipo", "custodio"),
    ),
    Reporte(
        clave="proximos-a-reemplazo",
        nombre="Activos próximos a reemplazo",
        descripcion="Equipos que superan los umbrales de su política de renovación (RF-07).",
        fuente=Fuente.ACTIVOS,
        columnas=(
            Columna(
                "nivel",
                "Sugerencia",
                lambda a: (
                    "Reemplazo recomendado"
                    if a.nivel_renovacion == "recomendado"
                    else "Evaluar reemplazo"
                ),
                22,
            ),
        )
        + COLUMNAS_ACTIVO_BASE
        + (
            Columna("antiguedad", "Antigüedad (meses)", lambda a: a.antiguedad_meses, 16),
            Columna("intervenciones", "Intervenciones", lambda a: a.total_mantenimientos, 14),
            Columna("criticos", "Piezas críticas", lambda a: a.total_componentes_criticos, 14),
            Columna("custodio", "Custodio", _custodio, 26),
        ),
        filtros={"requiere_renovacion": True},
        parametros=PARAMETROS_ACTIVOS,
        # Los recomendados primero: son los que ya deberían haberse cambiado.
        orden=("-nivel_renovacion", "fecha_adquisicion"),
        columnas_pdf=("nivel", "codigo_barras", "nombre", "antiguedad", "intervenciones"),
    ),
    Reporte(
        clave="garantias-por-vencer",
        nombre="Garantías próximas a vencer",
        descripcion="Coberturas que expiran dentro de la ventana de aviso.",
        fuente=Fuente.ACTIVOS,
        columnas=COLUMNAS_ACTIVO_BASE
        + (
            Columna("fin_garantia", "Vence", lambda a: a.fecha_fin_garantia, 14),
            Columna("dias", "Días restantes", lambda a: a.dias_para_fin_de_garantia, 14),
            Columna("proveedor", "Proveedor", lambda a: a.proveedor, 22),
            Columna("custodio", "Custodio", _custodio, 26),
        ),
        parametros=("dias", "departamento", "tipo"),
        orden=("fecha_fin_garantia",),
        columnas_pdf=("codigo_barras", "nombre", "fin_garantia", "dias", "proveedor"),
    ),
    Reporte(
        clave="historial-asignaciones",
        nombre="Historial de asignaciones",
        descripcion="Entregas, devoluciones y traslados registrados, con su motivo.",
        fuente=Fuente.MOVIMIENTOS,
        columnas=COLUMNAS_MOVIMIENTO,
        parametros=("desde", "hasta", "activo", "custodio", "departamento"),
        orden=("-created_at",),
        columnas_pdf=("fecha", "tipo", "codigo", "custodio_anterior", "custodio_nuevo"),
    ),
    Reporte(
        clave="historial-reparaciones",
        nombre="Historial de reparaciones",
        descripcion="Bitácora de intervenciones con causa, solución y costo.",
        fuente=Fuente.MANTENIMIENTOS,
        columnas=COLUMNAS_MANTENIMIENTO,
        parametros=("desde", "hasta", "activo", "tipo_mantenimiento", "departamento"),
        orden=("-fecha_intervencion",),
        columnas_pdf=("fecha", "codigo", "activo", "tipo", "causa", "estado_final", "costo"),
        totalizar=("costo",),
    ),
    Reporte(
        clave="costos-mantenimiento",
        nombre="Costos de mantenimiento",
        descripcion="Lo invertido en cada intervención, con el total del período.",
        fuente=Fuente.MANTENIMIENTOS,
        columnas=(
            Columna("fecha", "Fecha", lambda m: m.fecha_intervencion, 12),
            Columna("codigo", "Código del activo", lambda m: m.activo.codigo_barras, 18),
            Columna("activo", "Activo", lambda m: m.activo.nombre, 26),
            Columna("departamento", "Área", lambda m: m.activo.departamento.nombre, 20),
            Columna("tipo", "Tipo", lambda m: m.get_tipo_display(), 14),
            Columna("mano_obra", "Mano de obra", lambda m: m.costo_mano_obra, 14),
            Columna(
                "repuestos",
                "Repuestos",
                lambda m: (m.costo_total or Decimal("0")) - (m.costo_mano_obra or Decimal("0")),
                14,
            ),
            Columna("costo", "Costo total", _mantenimiento_costo_total, 14),
            Columna("garantia", "Por garantía", lambda m: "Sí" if m.garantia_usada else "No", 12),
        ),
        parametros=("desde", "hasta", "activo", "departamento"),
        orden=("-fecha_intervencion",),
        totalizar=("mano_obra", "repuestos", "costo"),
    ),
)

POR_CLAVE = {reporte.clave: reporte for reporte in CATALOGO}


def obtener(clave: str) -> Reporte | None:
    return POR_CLAVE.get(clave)
