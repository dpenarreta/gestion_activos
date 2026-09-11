"""Carga masiva de activos desde una hoja de cálculo.

El flujo tiene dos pasos deliberadamente separados: primero se **valida** el
archivo completo y se devuelve un reporte fila por fila, y solo después se
**confirma** la importación. Escribir a medida que se lee dejaría el
inventario a medio cargar cuando la fila 180 de 200 tiene un tipo de
dispositivo mal escrito, y obligaría a averiguar qué entró y qué no.

Por la misma razón la importación es atómica: o entran todas las filas o no
entra ninguna. Un inventario parcialmente cargado es peor que uno vacío,
porque nadie sabe cuál de los dos casos está mirando.

Las referencias a catálogos (tipo, departamento, responsables) se resuelven por
código, no por id: quien llena la plantilla trabaja con los códigos que ve en
el sistema —"LAP", "TI", "TI-0001"— y no con los identificadores internos de
la base de datos.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from django.db import transaction

from apps.core.audit import record_audit_event
from apps.organizacion.models import (
    Concesionario,
    Departamento,
    Empleado,
    Proveedor,
    Sede,
)

from .models import Activo, TipoDispositivo
from .services import ActivoService

MAX_FILAS = 1000

# Nombre de la hoja de captura en la plantilla. Vive aquí y no en
# `plantilla_importacion` para que el generador y el lector no puedan
# desincronizarse (el importador lo usa para encontrar la hoja correcta).
NOMBRE_HOJA_DATOS = "Activos"


def columnas_configuradas():
    """Columnas activas de la plantilla, en su orden configurado.

    La plantilla es configurable desde el panel (ver
    `apps.activos.models_plantilla`), así que el generador y el lector toman de
    aquí su definición: si tomaran cada uno la suya, cambiar una columna
    produciría archivos que el propio sistema no sabe leer.
    """
    from .models_plantilla import ColumnaPlantillaActivos

    return list(ColumnaPlantillaActivos.objects.filter(activa=True).order_by("orden", "id"))


@dataclass
class ErrorFila:
    fila: int
    columna: str
    mensaje: str

    def as_dict(self) -> dict:
        return {"fila": self.fila, "columna": self.columna, "mensaje": self.mensaje}


@dataclass
class ResultadoValidacion:
    """Reporte de lo que se encontró en el archivo.

    Los hallazgos van en dos listas y no en una: `errores` impide importar,
    `advertencias` no. Mezclarlos obligaría a elegir entre bloquear cargas
    legítimas —dos equipos pueden llamarse igual— o callar cosas que quien
    carga el archivo querría mirar antes de confirmar.
    """

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

    def as_dict(self) -> dict:
        return {
            "total_filas": self.total_filas,
            "filas_validas": len(self.filas_validas),
            "errores": [e.as_dict() for e in self.errores],
            "advertencias": [a.as_dict() for a in self.advertencias],
            "filas_con_error": self.filas_con_error,
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
                    "custodio": ", ".join(e.nombre_completo for e in f["responsables"]) or None,
                }
                for f in self.filas_validas[:10]
            ],
        }


def _sin_repetidos(hallazgos: list[ErrorFila]) -> list[ErrorFila]:
    """Quita las líneas idénticas conservando el orden.

    Un campo obligatorio que además no existe en el catálogo lo señalan dos
    comprobaciones distintas —la de obligatoriedad y la que lo resuelve—, y el
    reporte mostraba «Departamento: Es obligatorio.» dos veces en la misma
    fila. Leído desde fuera parece que hay dos problemas donde hay uno.
    """
    vistos = set()
    unicos = []
    for hallazgo in hallazgos:
        clave = (hallazgo.fila, hallazgo.columna, hallazgo.mensaje)
        if clave in vistos:
            continue
        vistos.add(clave)
        unicos.append(hallazgo)
    return unicos


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


def _separar(texto: str) -> list[str]:
    """Los códigos de una celda que admite varios, sin vacíos ni repetidos."""
    vistos = []
    for parte in (texto or "").split(";"):
        codigo = parte.strip()
        if codigo and codigo not in vistos:
            vistos.append(codigo)
    return vistos


def _si_o_no(valor):
    """Lee una casilla de sí/no, o `None` si la celda no dice nada.

    Se distingue «no» de «vacío» a propósito: vacío significa que la columna no
    se llenó y deja que el número de responsables hable, mientras que un «no»
    escrito es una afirmación que puede contradecir a esa lista.
    """
    texto = _texto(valor).strip().lower()
    if not texto:
        return None
    if texto in {"si", "sí", "s", "true", "verdadero", "x", "1"}:
        return True
    if texto in {"no", "n", "false", "falso", "0"}:
        return False
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


def _indices_de_columnas(encabezados_archivo: list[str], columnas) -> dict[str, int]:
    """Ubica cada columna por su encabezado, sin depender del orden.

    Se compara sin distinguir mayúsculas ni el asterisco de obligatoriedad,
    para que reordenar o limpiar la plantilla no rompa la carga.
    """

    def normalizar(texto: str) -> str:
        return _texto(texto).replace("*", "").strip().lower()

    disponibles = {normalizar(e): i for i, e in enumerate(encabezados_archivo) if e}
    indices = {}
    for columna in columnas:
        posicion = disponibles.get(normalizar(columna.etiqueta))
        if posicion is not None:
            indices[columna.clave] = posicion
    return indices


def _hoja_de_datos(libro, columnas):
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
        if _indices_de_columnas([_texto(c) for c in primera_fila], columnas):
            return hoja

    return libro.active


def validar_archivo(archivo) -> ResultadoValidacion:
    """Lee el .xlsx y devuelve qué filas son importables y qué falla en el resto."""
    from openpyxl import load_workbook

    resultado = ResultadoValidacion()
    columnas = columnas_configuradas()
    etiqueta_de = {c.clave: c.etiqueta for c in columnas}
    especificaciones_por_columna = [c for c in columnas if c.es_especificacion]

    # `read_only` evita cargar toda la hoja en memoria; `data_only` toma el
    # valor calculado de las fórmulas en vez de su texto.
    libro = load_workbook(archivo, read_only=True, data_only=True)
    hoja = _hoja_de_datos(libro, columnas)

    filas = hoja.iter_rows(values_only=True)
    try:
        encabezados = [_texto(c) for c in next(filas)]
    except StopIteration:
        resultado.errores.append(ErrorFila(0, "-", "El archivo está vacío."))
        return resultado

    indices = _indices_de_columnas(encabezados, columnas)
    faltantes = [c.etiqueta for c in columnas if c.obligatoria and c.clave not in indices]
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
    empleados = {e.codigo_empleado.lower(): e for e in Empleado.objects.filter(activo=True)}
    proveedores = {p.nombre.strip().lower(): p for p in Proveedor.objects.filter(activo=True)}
    concesionarios = {
        c.nombre.strip().lower(): c for c in Concesionario.objects.filter(activo=True)
    }
    # La sede se acepta por su nombre o por su ciudad: quien llena la plantilla
    # escribe lo que tiene en la cabeza, y «Quito» y «Sede Quito Norte» son la
    # misma respuesta a la pregunta de dónde está el equipo. Si dos sedes
    # comparten ciudad, esa ciudad deja de servir como respuesta única.
    sedes: dict[str, object] = {}
    ambiguas: set[str] = set()
    for sede in Sede.objects.filter(activa=True):
        sedes[sede.nombre.lower()] = sede
        ciudad = (sede.ciudad or "").strip().lower()
        if not ciudad or ciudad == sede.nombre.lower():
            continue
        if ciudad in sedes:
            ambiguas.add(ciudad)
        else:
            sedes[ciudad] = sede

    series_existentes = set(Activo.objects.values_list("numero_serie", flat=True))
    series_en_archivo: dict[str, int] = {}
    # El nombre no es un identificador: dos equipos pueden llamarse «Laptop
    # Ventas» sin que nada esté mal. Repetirlo sí hace que el inventario no se
    # pueda leer de un vistazo —dos filas idénticas salvo la serie—, así que se
    # avisa y se deja pasar. La serie, en cambio, sí identifica y bloquea.
    nombres_existentes = {
        nombre.strip().lower(): codigo
        for nombre, codigo in Activo.objects.values_list("nombre", "codigo_barras")
    }
    nombres_en_archivo: dict[str, int] = {}

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
        advertencias_fila: list[ErrorFila] = []

        datos = {"_fila": numero_fila}

        # Obligatoriedad en una sola pasada sobre la configuración vigente: es
        # la única forma de que marcar obligatoria una columna en el panel
        # tenga efecto real, incluidas las columnas propias.
        for columna in columnas:
            if columna.obligatoria and not _texto(celda(columna.clave)):
                errores_fila.append(ErrorFila(numero_fila, columna.etiqueta, "Es obligatorio."))

        for clave in ("nombre", "marca", "modelo", "numero_serie"):
            datos[clave] = _texto(celda(clave))

        nombre = datos.get("nombre", "")
        if nombre:
            clave_nombre = nombre.lower()
            if clave_nombre in nombres_en_archivo:
                advertencias_fila.append(
                    ErrorFila(
                        numero_fila,
                        etiqueta_de.get("nombre", "Nombre del activo"),
                        f"El nombre {nombre!r} ya está en la fila "
                        f"{nombres_en_archivo[clave_nombre]} de este mismo archivo. "
                        "Se importará igual: revise que no sea la misma fila dos veces.",
                    )
                )
            elif clave_nombre in nombres_existentes:
                advertencias_fila.append(
                    ErrorFila(
                        numero_fila,
                        etiqueta_de.get("nombre", "Nombre del activo"),
                        f"Ya hay un activo llamado {nombre!r} "
                        f"({nombres_existentes[clave_nombre]}). Se importará igual.",
                    )
                )
            # Se registra siempre, aunque el nombre ya existiera en el
            # inventario: si no, la segunda fila del archivo con ese nombre
            # volvería a señalar al activo de la base y no a la fila de al
            # lado, que es la que hay que mirar.
            nombres_en_archivo.setdefault(clave_nombre, numero_fila)

        serie = datos.get("numero_serie", "")
        if serie:
            if serie in series_existentes:
                errores_fila.append(
                    ErrorFila(
                        numero_fila,
                        etiqueta_de.get("numero_serie", "Número de serie"),
                        f"Ya existe un activo con la serie {serie!r}.",
                    )
                )
            elif serie.lower() in series_en_archivo:
                errores_fila.append(
                    ErrorFila(
                        numero_fila,
                        etiqueta_de.get("numero_serie", "Número de serie"),
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
                    etiqueta_de.get("tipo", "Tipo de dispositivo"),
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
                    etiqueta_de.get("departamento", "Departamento"),
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
        if fecha is None and _texto(celda("fecha_adquisicion")):
            errores_fila.append(
                ErrorFila(
                    numero_fila,
                    etiqueta_de.get("fecha_adquisicion", "Fecha de adquisición"),
                    "No se entiende la fecha: use el formato AAAA-MM-DD.",
                )
            )
        elif fecha > datetime.date.today():
            errores_fila.append(
                ErrorFila(
                    numero_fila,
                    etiqueta_de.get("fecha_adquisicion", "Fecha de adquisición"),
                    "No puede ser futura.",
                )
            )
        datos["fecha_adquisicion"] = fecha

        # Uno o varios códigos separados por punto y coma, como las
        # especificaciones: es el separador que la plantilla ya enseña, y una
        # coma chocaría con los apellidos compuestos que la gente escribe igual
        # aunque se pida el código.
        responsables = []
        for codigo in _separar(_texto(celda("custodio"))):
            empleado = empleados.get(codigo.lower())
            if empleado is None:
                errores_fila.append(
                    ErrorFila(
                        numero_fila,
                        etiqueta_de.get("custodio", "Código del custodio"),
                        f"No hay un empleado activo con el código {codigo!r}.",
                    )
                )
            elif empleado not in responsables:
                responsables.append(empleado)

        compartido = _si_o_no(celda("compartido"))
        if compartido is None and len(responsables) > 1:
            # Nombrar a varios ya dice que el equipo es de varios: pedir además
            # la otra columna sería hacer escribir dos veces lo mismo.
            compartido = True
        if len(responsables) > 1 and not compartido:
            errores_fila.append(
                ErrorFila(
                    numero_fila,
                    etiqueta_de.get("compartido", "Compartido"),
                    f"Hay {len(responsables)} responsables, pero la fila dice que el equipo "
                    "no es compartido. Deje un solo código o marque la columna.",
                )
            )
        datos["compartido"] = bool(compartido)
        datos["responsables"] = responsables

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
                        etiqueta_de.get("costo_adquisicion", "Costo de compra"),
                        f"{costo_texto!r} no es un número válido.",
                    )
                )
        datos["costo_adquisicion"] = costo

        texto_sede = _texto(celda("sede"))
        sede = None
        if texto_sede:
            clave = texto_sede.strip().lower()
            if clave in ambiguas:
                errores_fila.append(
                    ErrorFila(
                        numero_fila,
                        etiqueta_de.get("sede", "Sede"),
                        f"Hay más de una sede en {texto_sede!r}: escriba el nombre de la "
                        "sede, no la ciudad.",
                    )
                )
            else:
                sede = sedes.get(clave)
                if not sede:
                    errores_fila.append(
                        ErrorFila(
                            numero_fila,
                            etiqueta_de.get("sede", "Sede"),
                            f"No existe una sede abierta {texto_sede!r}. "
                            "Créela primero en el catálogo (hoja «Sedes»).",
                        )
                    )
        datos["sede"] = sede

        # Criticidad, nivel de uso y condición se aceptan por su etiqueta
        # («Alta») o por su valor interno («alta»): quien llena la plantilla lee
        # la primera.
        for clave_campo, opciones, etiqueta_defecto in (
            ("criticidad", Activo.Criticidad, "Criticidad"),
            ("uso", Activo.Uso, "Uso"),
            ("condicion", Activo.Condicion, "Condición"),
            ("propiedad", Activo.Propiedad, "Propiedad"),
        ):
            texto = _texto(celda(clave_campo))
            if not texto:
                continue
            equivalencias = {opcion.value: opcion.value for opcion in opciones}
            equivalencias.update({opcion.label.lower(): opcion.value for opcion in opciones})
            valor = equivalencias.get(texto.lower())
            if valor is None:
                errores_fila.append(
                    ErrorFila(
                        numero_fila,
                        etiqueta_de.get(clave_campo, etiqueta_defecto),
                        f"{texto!r} no es válido. Use: "
                        f"{', '.join(opcion.label for opcion in opciones)}.",
                    )
                )
            else:
                datos[clave_campo] = valor

        texto_ingreso = _texto(celda("fecha_ingreso"))
        fecha_ingreso = _parsear_fecha(celda("fecha_ingreso"))
        if texto_ingreso and fecha_ingreso is None:
            errores_fila.append(
                ErrorFila(
                    numero_fila,
                    etiqueta_de.get("fecha_ingreso", "Fecha de ingreso"),
                    "No se entiende la fecha: use el formato AAAA-MM-DD.",
                )
            )
        elif (
            fecha_ingreso
            and datos.get("fecha_adquisicion")
            and fecha_ingreso < datos["fecha_adquisicion"]
        ):
            errores_fila.append(
                ErrorFila(
                    numero_fila,
                    etiqueta_de.get("fecha_ingreso", "Fecha de ingreso"),
                    "No puede ser anterior a la fecha de adquisición.",
                )
            )
        datos["fecha_ingreso"] = fecha_ingreso

        datos["observaciones"] = _texto(celda("observaciones"))

        # El proveedor es opcional —hay equipos heredados de los que nadie sabe
        # a quién se le compraron—, pero si viene escrito tiene que existir:
        # aceptarlo a ciegas devolvería el texto libre que el catálogo elimina.
        texto_proveedor = _texto(celda("proveedor"))
        proveedor = None
        if texto_proveedor:
            proveedor = proveedores.get(texto_proveedor.lower())
            if not proveedor:
                errores_fila.append(
                    ErrorFila(
                        numero_fila,
                        etiqueta_de.get("proveedor", "Proveedor"),
                        f"No existe un proveedor activo llamado {texto_proveedor!r}. "
                        "Créelo primero en el catálogo (hoja «Proveedores»).",
                    )
                )
        datos["proveedor"] = proveedor

        # De quién es el equipo. La columna se puede dejar vacía y entonces es
        # de la empresa: es lo que ocurre con la inmensa mayoría del parque, y
        # obligar a escribirlo en cada fila haría la plantilla más pesada sin
        # capturar nada que no se supiera ya.
        texto_concesionario = _texto(celda("concesionario"))
        concesionario = None
        if texto_concesionario:
            concesionario = concesionarios.get(texto_concesionario.lower())
            if not concesionario:
                errores_fila.append(
                    ErrorFila(
                        numero_fila,
                        etiqueta_de.get("concesionario", "Concesionario"),
                        f"No existe un concesionario activo llamado {texto_concesionario!r}. "
                        "Créelo primero con la plantilla de «Concesionarios».",
                    )
                )
        propiedad = datos.get("propiedad")
        if concesionario and not propiedad:
            # Nombrar al dueño ya dice que el equipo es suyo; pedir además la
            # otra columna sería hacer escribir dos veces lo mismo.
            propiedad = datos["propiedad"] = Activo.Propiedad.CONCESION
        if propiedad == Activo.Propiedad.CONCESION and not concesionario:
            errores_fila.append(
                ErrorFila(
                    numero_fila,
                    etiqueta_de.get("concesionario", "Concesionario"),
                    "Diga de qué partner es el equipo en concesión: sin el dueño, "
                    "«en concesión» no responde a qué hay que devolver ni a quién.",
                )
            )
        elif propiedad == Activo.Propiedad.PROPIA and concesionario:
            # Aquí no se limpia en silencio, al contrario que en el formulario:
            # las dos columnas están a la vista y llenas a mano, así que lo que
            # hay es una contradicción, no un resto de un campo que se ocultó.
            errores_fila.append(
                ErrorFila(
                    numero_fila,
                    etiqueta_de.get("propiedad", "Propiedad"),
                    f"Dice que el equipo es de la empresa y a la vez que es de "
                    f"{texto_concesionario!r}. Deje una de las dos columnas.",
                )
            )
        datos["concesionario"] = concesionario

        # La garantía es opcional: solo se valida el formato si viene algo. Un
        # equipo sin fecha es «sin garantía registrada», no un error.
        texto_garantia = _texto(celda("fecha_fin_garantia"))
        fin_garantia = _parsear_fecha(celda("fecha_fin_garantia"))
        if texto_garantia and fin_garantia is None:
            errores_fila.append(
                ErrorFila(
                    numero_fila,
                    etiqueta_de.get("fecha_fin_garantia", "Fin de garantía"),
                    "No se entiende la fecha: use el formato AAAA-MM-DD.",
                )
            )
        datos["fecha_fin_garantia"] = fin_garantia
        # La columna general de especificaciones y las columnas propias
        # (`espec:<Nombre>`) se combinan en el mismo diccionario: son dos
        # formas de llenar el mismo campo del activo.
        especificaciones = _parsear_especificaciones(celda("especificaciones"))
        for columna in especificaciones_por_columna:
            valor = _texto(celda(columna.clave))
            if valor:
                especificaciones[columna.nombre_especificacion] = valor
        datos["especificaciones"] = especificaciones

        if errores_fila:
            # Las advertencias de una fila que no va a entrar sobran: lo que
            # hay que mirar es por qué no entra.
            resultado.errores.extend(_sin_repetidos(errores_fila))
        else:
            resultado.filas_validas.append(datos)
            resultado.advertencias.extend(advertencias_fila)

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
