"""Carga masiva de activos desde una hoja de cálculo.

El flujo tiene dos pasos deliberadamente separados: primero se **valida** el
archivo completo y se devuelve un reporte fila por fila, y solo después se
**confirma** la importación. Escribir a medida que se lee dejaría el
inventario a medio cargar cuando la fila 180 de 200 tiene un tipo de
dispositivo mal escrito, y obligaría a averiguar qué entró y qué no.

Por la misma razón la importación es atómica: o entran todas las filas o no
entra ninguna. Un inventario parcialmente cargado es peor que uno vacío,
porque nadie sabe cuál de los dos casos está mirando.

Las referencias a catálogos (tipo, departamento, custodio) se resuelven por
código o por documento, no por id: quien llena la plantilla trabaja desde el
mundo real —"LAP", "TI", la cédula del empleado— y no conoce los
identificadores internos de la base de datos.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from django.db import transaction

from apps.core.audit import record_audit_event
from apps.organizacion.models import Departamento, Empleado

from .models import Activo, TipoDispositivo
from .services import ActivoService

MAX_FILAS = 1000

# Nombre de la hoja de captura en la plantilla. Vive aquí y no en
# `plantilla_importacion` para que el generador y el lector no puedan
# desincronizarse (el importador lo usa para encontrar la hoja correcta).
NOMBRE_HOJA_DATOS = "Activos"

# (clave interna, encabezado en la plantilla, obligatoria)
COLUMNAS = [
    ("tipo", "Tipo de dispositivo *", True),
    ("nombre", "Nombre del activo *", True),
    ("marca", "Marca *", True),
    ("modelo", "Modelo *", True),
    ("numero_serie", "Número de serie *", True),
    ("departamento", "Departamento *", True),
    ("fecha_adquisicion", "Fecha de adquisición *", True),
    ("custodio", "Documento del custodio", False),
    ("ubicacion", "Ubicación", False),
    ("costo_adquisicion", "Costo de compra", False),
    ("especificaciones", "Especificaciones", False),
    ("observaciones", "Observaciones", False),
]

ENCABEZADOS = [encabezado for _, encabezado, _ in COLUMNAS]
ENCABEZADO_POR_CLAVE = {clave: encabezado for clave, encabezado, _ in COLUMNAS}

AYUDAS = {
    "tipo": "Código o nombre exacto de un tipo registrado (ej. LAP o Laptop).",
    "nombre": "Nombre corto del equipo. Se imprime en la etiqueta.",
    "marca": "Fabricante del equipo.",
    "modelo": "Modelo comercial.",
    "numero_serie": "Serie del fabricante. Único en todo el inventario.",
    "departamento": "Código o nombre exacto de un área registrada (ej. TI o Tecnología).",
    "fecha_adquisicion": "Formato AAAA-MM-DD. Base del cálculo de vida útil.",
    "custodio": "Documento de identidad del empleado responsable. Vacío = queda en bodega.",
    "ubicacion": "Ubicación física (ej. Piso 3, oficina 302).",
    "costo_adquisicion": "Solo el número, sin símbolo de moneda (ej. 1150.00).",
    "especificaciones": "Pares clave=valor separados por ';' (ej. Procesador=i5; RAM=16 GB).",
    "observaciones": "Texto libre.",
}


@dataclass
class ErrorFila:
    fila: int
    columna: str
    mensaje: str

    def as_dict(self) -> dict:
        return {"fila": self.fila, "columna": self.columna, "mensaje": self.mensaje}


@dataclass
class ResultadoValidacion:
    """Reporte de lo que se encontró en el archivo."""

    filas_validas: list[dict] = field(default_factory=list)
    errores: list[ErrorFila] = field(default_factory=list)
    total_filas: int = 0

    @property
    def es_importable(self) -> bool:
        return not self.errores and bool(self.filas_validas)

    def as_dict(self) -> dict:
        return {
            "total_filas": self.total_filas,
            "filas_validas": len(self.filas_validas),
            "errores": [e.as_dict() for e in self.errores],
            "es_importable": self.es_importable,
            # Muestra de lo que se importará, para que el usuario reconozca su
            # propio archivo antes de confirmar.
            "vista_previa": [
                {
                    "fila": f["_fila"],
                    "nombre": f["nombre"],
                    "marca": f["marca"],
                    "modelo": f["modelo"],
                    "numero_serie": f["numero_serie"],
                    "tipo": f["tipo"].nombre,
                    "departamento": f["departamento"].nombre,
                    "custodio": f["custodio"].nombre_completo if f["custodio"] else None,
                }
                for f in self.filas_validas[:10]
            ],
        }


def _texto(valor) -> str:
    if valor is None:
        return ""
    if isinstance(valor, str):
        return valor.strip()
    if isinstance(valor, float) and valor.is_integer():
        # Excel entrega los números como float: "12345" no debe volverse
        # "12345.0" en un número de serie.
        return str(int(valor))
    return str(valor).strip()


def _parsear_fecha(valor) -> datetime.date | None:
    if isinstance(valor, datetime.datetime):
        return valor.date()
    if isinstance(valor, datetime.date):
        return valor
    texto = _texto(valor)
    if not texto:
        return None
    for formato in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.datetime.strptime(texto, formato).date()
        except ValueError:
            continue
    return None


def _parsear_especificaciones(valor) -> dict:
    """Convierte "Procesador=i5; RAM=16 GB" en un diccionario."""
    texto = _texto(valor)
    if not texto:
        return {}
    resultado = {}
    for parte in texto.split(";"):
        if "=" not in parte:
            continue
        clave, _, dato = parte.partition("=")
        clave, dato = clave.strip(), dato.strip()
        if clave and dato:
            resultado[clave] = dato
    return resultado


def _indices_de_columnas(encabezados_archivo: list[str]) -> dict[str, int]:
    """Ubica cada columna por su encabezado, sin depender del orden.

    Se compara sin distinguir mayúsculas ni el asterisco de obligatoriedad,
    para que reordenar o limpiar la plantilla no rompa la carga.
    """

    def normalizar(texto: str) -> str:
        return _texto(texto).replace("*", "").strip().lower()

    disponibles = {normalizar(e): i for i, e in enumerate(encabezados_archivo) if e}
    indices = {}
    for clave, encabezado, _ in COLUMNAS:
        posicion = disponibles.get(normalizar(encabezado))
        if posicion is not None:
            indices[clave] = posicion
    return indices


def _hoja_de_datos(libro):
    """Elige la hoja que contiene los activos.

    La plantilla se abre en «Instrucciones» —es lo primero que conviene leer—,
    así que tomar `libro.active` haría fallar la carga del propio archivo que
    el sistema entrega, informando que faltan todas las columnas. Se busca la
    hoja por nombre y, si no está (un archivo armado a mano), la primera que
    tenga los encabezados esperados.
    """
    if NOMBRE_HOJA_DATOS in libro.sheetnames:
        return libro[NOMBRE_HOJA_DATOS]

    for hoja in libro.worksheets:
        primera_fila = next(hoja.iter_rows(max_row=1, values_only=True), ())
        if _indices_de_columnas([_texto(c) for c in primera_fila]):
            return hoja

    return libro.active


def validar_archivo(archivo) -> ResultadoValidacion:
    """Lee el .xlsx y devuelve qué filas son importables y qué falla en el resto."""
    from openpyxl import load_workbook

    resultado = ResultadoValidacion()

    # `read_only` evita cargar toda la hoja en memoria; `data_only` toma el
    # valor calculado de las fórmulas en vez de su texto.
    libro = load_workbook(archivo, read_only=True, data_only=True)
    hoja = _hoja_de_datos(libro)

    filas = hoja.iter_rows(values_only=True)
    try:
        encabezados = [_texto(c) for c in next(filas)]
    except StopIteration:
        resultado.errores.append(ErrorFila(0, "-", "El archivo está vacío."))
        return resultado

    indices = _indices_de_columnas(encabezados)
    faltantes = [
        encabezado
        for clave, encabezado, obligatoria in COLUMNAS
        if obligatoria and clave not in indices
    ]
    if faltantes:
        resultado.errores.append(
            ErrorFila(
                1,
                "encabezados",
                f"Faltan columnas obligatorias: {', '.join(faltantes)}. "
                "Descargue la plantilla y úsela como base.",
            )
        )
        return resultado

    # Catálogos en memoria: resolver cada fila con su propia consulta haría
    # cuatro viajes a la base por activo.
    tipos = {}
    for tipo in TipoDispositivo.objects.filter(activo=True):
        tipos[tipo.codigo.lower()] = tipo
        tipos[tipo.nombre.lower()] = tipo
    departamentos = {}
    for departamento in Departamento.objects.filter(activo=True):
        departamentos[departamento.codigo.lower()] = departamento
        departamentos[departamento.nombre.lower()] = departamento
    empleados = {e.documento_identidad.lower(): e for e in Empleado.objects.filter(activo=True)}

    series_existentes = set(Activo.objects.values_list("numero_serie", flat=True))
    series_en_archivo: dict[str, int] = {}

    for numero_fila, fila in enumerate(filas, start=2):
        if numero_fila - 1 > MAX_FILAS:
            resultado.errores.append(
                ErrorFila(
                    numero_fila,
                    "-",
                    f"El archivo supera el máximo de {MAX_FILAS} filas por carga.",
                )
            )
            break

        def celda(clave, _fila=fila):
            posicion = indices.get(clave)
            return _fila[posicion] if posicion is not None and posicion < len(_fila) else None

        # Una fila totalmente vacía es el relleno normal al final de una hoja.
        if all(_texto(valor) == "" for valor in fila):
            continue

        resultado.total_filas += 1
        errores_fila: list[ErrorFila] = []

        datos = {"_fila": numero_fila}

        for clave in ("nombre", "marca", "modelo", "numero_serie"):
            valor = _texto(celda(clave))
            if not valor:
                errores_fila.append(
                    ErrorFila(numero_fila, ENCABEZADO_POR_CLAVE[clave], "Es obligatorio.")
                )
            datos[clave] = valor

        serie = datos.get("numero_serie", "")
        if serie:
            if serie in series_existentes:
                errores_fila.append(
                    ErrorFila(
                        numero_fila,
                        "Número de serie",
                        f"Ya existe un activo con la serie {serie!r}.",
                    )
                )
            elif serie.lower() in series_en_archivo:
                errores_fila.append(
                    ErrorFila(
                        numero_fila,
                        "Número de serie",
                        f"La serie {serie!r} está repetida en la fila "
                        f"{series_en_archivo[serie.lower()]} de este mismo archivo.",
                    )
                )
            else:
                series_en_archivo[serie.lower()] = numero_fila

        clave_tipo = _texto(celda("tipo")).lower()
        tipo = tipos.get(clave_tipo)
        if not tipo:
            errores_fila.append(
                ErrorFila(
                    numero_fila,
                    "Tipo de dispositivo",
                    (
                        f"No existe un tipo activo con código o nombre {_texto(celda('tipo'))!r}."
                        if clave_tipo
                        else "Es obligatorio."
                    ),
                )
            )
        datos["tipo"] = tipo

        clave_departamento = _texto(celda("departamento")).lower()
        departamento = departamentos.get(clave_departamento)
        if not departamento:
            errores_fila.append(
                ErrorFila(
                    numero_fila,
                    "Departamento",
                    (
                        f"No existe un área activa con código o nombre "
                        f"{_texto(celda('departamento'))!r}."
                        if clave_departamento
                        else "Es obligatorio."
                    ),
                )
            )
        datos["departamento"] = departamento

        fecha = _parsear_fecha(celda("fecha_adquisicion"))
        if fecha is None:
            errores_fila.append(
                ErrorFila(
                    numero_fila,
                    "Fecha de adquisición",
                    "Es obligatoria y debe tener formato AAAA-MM-DD.",
                )
            )
        elif fecha > datetime.date.today():
            errores_fila.append(
                ErrorFila(numero_fila, "Fecha de adquisición", "No puede ser futura.")
            )
        datos["fecha_adquisicion"] = fecha

        documento = _texto(celda("custodio"))
        custodio = None
        if documento:
            custodio = empleados.get(documento.lower())
            if not custodio:
                errores_fila.append(
                    ErrorFila(
                        numero_fila,
                        "Documento del custodio",
                        f"No hay un empleado activo con documento {documento!r}.",
                    )
                )
        datos["custodio"] = custodio

        costo_texto = _texto(celda("costo_adquisicion")).replace(",", ".")
        costo = None
        if costo_texto:
            try:
                costo = Decimal(costo_texto)
                if costo < 0:
                    raise InvalidOperation
            except (InvalidOperation, ValueError):
                errores_fila.append(
                    ErrorFila(
                        numero_fila,
                        "Costo de compra",
                        f"{costo_texto!r} no es un número válido.",
                    )
                )
        datos["costo_adquisicion"] = costo

        datos["ubicacion"] = _texto(celda("ubicacion"))
        datos["observaciones"] = _texto(celda("observaciones"))
        datos["especificaciones"] = _parsear_especificaciones(celda("especificaciones"))

        if errores_fila:
            resultado.errores.extend(errores_fila)
        else:
            resultado.filas_validas.append(datos)

    libro.close()
    return resultado


@transaction.atomic
def importar(filas: list[dict], *, actor, context: dict | None = None) -> list[Activo]:
    """Crea los activos de las filas ya validadas.

    Reutiliza `ActivoService.crear_activo` en vez de un `bulk_create`: cada
    alta debe emitir su código de barras, dejar su movimiento de alta y quedar
    auditada, y duplicar esa lógica aquí para ganar velocidad la dejaría
    divergiendo de la creación normal.
    """
    creados = []
    for fila in filas:
        datos = {k: v for k, v in fila.items() if not k.startswith("_")}
        creados.append(ActivoService.crear_activo(actor=actor, context=context, **datos))

    record_audit_event(
        actor=actor,
        action="activo.importacion_masiva",
        target_type="activo",
        target_id=",".join(str(a.id) for a in creados[:20]),
        module="activos",
        new_values={
            "cantidad": len(creados),
            "codigos_generados": [a.codigo_barras for a in creados[:50]],
        },
        context=context,
    )
    return creados
