"""Lee, valida e importa el archivo de un catálogo.

Un solo motor para los cinco: la diferencia entre cargar sedes y cargar
empleados son las columnas y con qué se reconoce una fila repetida, y ambas
cosas están declaradas en `catalogos_masivos.py`.

Comparte la forma del reporte con la carga de activos —errores que bloquean,
advertencias que no, todo con fila y columna— porque la pantalla es la misma y
porque la distinción es la misma: lo que impide crear el registro frente a lo
que conviene mirar antes de confirmar.
"""

from dataclasses import dataclass, field

from django.apps import apps
from django.db import transaction

from apps.core.audit import record_audit_event

from .catalogos_masivos import CatalogoMasivo

#: El mismo tope que la carga de activos: un archivo mayor es casi siempre un
#: error de exportación, y validarlo entero cuesta más de lo que un navegador
#: espera sin dar la conexión por perdida.
MAX_FILAS = 1000

MAX_BYTES = 5 * 1024 * 1024

MODULO = "core"


@dataclass
class ErrorFila:
    fila: int
    columna: str
    mensaje: str

    def as_dict(self) -> dict:
        return {"fila": self.fila, "columna": self.columna, "mensaje": self.mensaje}


@dataclass
class ResultadoValidacion:
    filas_validas: list[dict] = field(default_factory=list)
    errores: list[ErrorFila] = field(default_factory=list)
    advertencias: list[ErrorFila] = field(default_factory=list)
    total_filas: int = 0

    @property
    def es_importable(self) -> bool:
        return not self.errores and bool(self.filas_validas)

    @property
    def filas_con_error(self) -> int:
        return len({e.fila for e in self.errores})

    def as_dict(self, catalogo: CatalogoMasivo) -> dict:
        return {
            "catalogo": catalogo.clave,
            "total_filas": self.total_filas,
            "filas_validas": len(self.filas_validas),
            "errores": [e.as_dict() for e in self.errores],
            "advertencias": [a.as_dict() for a in self.advertencias],
            "filas_con_error": self.filas_con_error,
            "es_importable": self.es_importable,
            "vista_previa": [
                {
                    "fila": fila["_fila"],
                    "valores": [_legible(fila.get(columna.clave)) for columna in catalogo.columnas],
                }
                for fila in self.filas_validas[:10]
            ],
            "columnas": [columna.etiqueta for columna in catalogo.columnas],
        }


def _legible(valor) -> str:
    if valor is None:
        return ""
    return str(valor)


def _texto(valor) -> str:
    if valor is None:
        return ""
    if isinstance(valor, str):
        return valor.strip()
    if isinstance(valor, float) and valor.is_integer():
        # Excel entrega los números como float: un teléfono «099123456» no debe
        # volverse «99123456.0».
        return str(int(valor))
    return str(valor).strip()


def _hoja_de_datos(libro, catalogo: CatalogoMasivo):
    """La hoja del catálogo, o la primera si el archivo viene de otra parte."""
    if catalogo.nombre in libro.sheetnames:
        return libro[catalogo.nombre]
    return libro[libro.sheetnames[0]]


def validar_archivo(archivo, catalogo: CatalogoMasivo) -> ResultadoValidacion:
    """Devuelve qué filas son importables y qué falla en el resto."""
    from openpyxl import load_workbook

    resultado = ResultadoValidacion()
    libro = load_workbook(archivo, read_only=True, data_only=True)
    hoja = _hoja_de_datos(libro, catalogo)

    Modelo = catalogo.obtener_modelo()
    # Lo que ya está, para reconocerlo en vez de intentar crearlo otra vez: el
    # archivo se descarga lleno, así que la mayoría de las filas de una segunda
    # subida son las que ya existían.
    existentes = {
        _clave_natural([_texto(getattr(objeto, campo)) for campo in catalogo.identifica_por])
        for objeto in Modelo.objects.all()
    }
    referencias = _cargar_referencias(catalogo)

    vistas_en_archivo: dict[str, int] = {}
    filas = hoja.iter_rows(values_only=True)
    next(filas, None)  # el encabezado

    for numero_fila, fila in enumerate(filas, start=2):
        if fila is None or all(_texto(celda) == "" for celda in fila):
            continue

        resultado.total_filas += 1
        if resultado.total_filas > MAX_FILAS:
            resultado.errores.append(
                ErrorFila(
                    numero_fila,
                    "Archivo",
                    f"El archivo supera las {MAX_FILAS} filas. Divídalo en varias cargas.",
                )
            )
            break

        errores_fila: list[ErrorFila] = []
        advertencias_fila: list[ErrorFila] = []
        datos: dict = {"_fila": numero_fila}

        for indice, columna in enumerate(catalogo.columnas):
            crudo = _texto(fila[indice]) if indice < len(fila) else ""

            if columna.obligatoria and not crudo:
                errores_fila.append(ErrorFila(numero_fila, columna.etiqueta, "Es obligatorio."))
                continue

            if columna.referencia and crudo:
                objeto = referencias[columna.clave].get(crudo.lower())
                if objeto is None:
                    errores_fila.append(
                        ErrorFila(
                            numero_fila,
                            columna.etiqueta,
                            f"No existe {crudo!r}. Cárguelo primero en su propio catálogo.",
                        )
                    )
                else:
                    datos[columna.clave] = objeto
                continue

            datos[columna.clave] = crudo

        clave = _clave_natural([_texto(datos.get(c, "")) for c in catalogo.identifica_por])
        if clave and clave in vistas_en_archivo:
            errores_fila.append(
                ErrorFila(
                    numero_fila,
                    catalogo.columna(catalogo.identifica_por[0]).etiqueta,
                    f"Repetido en la fila {vistas_en_archivo[clave]} de este mismo archivo.",
                )
            )
        elif clave and clave in existentes:
            # No es un error: el archivo se descarga con lo que ya hay dentro, y
            # volver a subirlo es lo que la gente hace en cuanto descubre que se
            # puede reutilizar. Se omite y se dice.
            advertencias_fila.append(
                ErrorFila(
                    numero_fila,
                    catalogo.columna(catalogo.identifica_por[0]).etiqueta,
                    "Ya existe: esta fila se omite y el registro se deja como está.",
                )
            )
            datos["_omitir"] = True
        elif clave:
            vistas_en_archivo[clave] = numero_fila

        if errores_fila:
            resultado.errores.extend(errores_fila)
        elif datos.get("_omitir"):
            resultado.advertencias.extend(advertencias_fila)
        else:
            resultado.filas_validas.append(datos)

    libro.close()
    return resultado


def _clave_natural(valores: list[str]) -> str:
    return "|".join(valor.strip().lower() for valor in valores)


def _cargar_referencias(catalogo: CatalogoMasivo) -> dict[str, dict]:
    """Índice por texto de cada columna que apunta a otro catálogo."""
    indices: dict[str, dict] = {}
    for columna in catalogo.columnas:
        if not columna.referencia:
            continue
        Modelo = apps.get_model(*columna.referencia.modelo.split("."))
        indice: dict[str, object] = {}
        for objeto in Modelo.objects.filter(**columna.referencia.filtro):
            for campo in columna.referencia.campos:
                valor = _texto(getattr(objeto, campo, ""))
                if valor:
                    indice.setdefault(valor.lower(), objeto)
        indices[columna.clave] = indice
    return indices


@transaction.atomic
def importar(filas: list[dict], catalogo: CatalogoMasivo, *, actor, context=None) -> int:
    """Crea los registros de las filas ya validadas.

    Uno a uno con `save()` y no con `bulk_create`: el código del empleado se
    genera en el guardado, y saltárselo dejaría filas sin código —o con el de
    otro— justo en la carga que más filas produce.
    """
    Modelo = catalogo.obtener_modelo()
    creados = []
    for fila in filas:
        valores = {k: v for k, v in fila.items() if not k.startswith("_")}
        creados.append(Modelo.objects.create(**valores))

    record_audit_event(
        actor=actor,
        action="catalogo.importacion_masiva",
        target_type=catalogo.clave,
        target_id=",".join(str(objeto.pk) for objeto in creados[:20]),
        module=MODULO,
        new_values={"catalogo": catalogo.clave, "creados": len(creados)},
        context=context,
    )
    return len(creados)
