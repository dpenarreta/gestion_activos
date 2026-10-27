"""Importar la matriz legal desde el Excel de Administración (27/10/2026).

El archivo («MATRIZ LEGAL FINAL») trae tres hojas:

- **CONSOLIDADO**: todo, una fila por concepto y regional (permisos de cada
  sucursal, arriendos, seguros, documentos legales…), con columnas para los
  seguros y los arriendos.
- **CONTABILIDAD**: las declaraciones y reportes, que no están en el
  consolidado.
- **ARRIENDOS**: los mismos arriendos del consolidado, con «Renovado» y
  «Observaciones».

`leer` lo convierte en filas; `planificar` decide, sin tocar nada, qué tema,
entidad, sede, periodicidad, vencimiento y personas lleva cada una y si la
obligación ya existe (por nombre, con las faltas de ortografía corregidas, así
la versión corregida no se duplica); `aplicar` lo guarda en una transacción:
crea lo nuevo con su primer período (`servicios.crear_obligacion`, auditado),
actualiza la plantilla y la ficha de lo que ya estaba, y no toca sus períodos.

Las filas sin fecha de vencimiento se cargan al 31/12/2026 con la nota «fecha
por confirmar». Daniela Albán y Andrés Lima, que figuran en todas, quedan
como responsable y suplente (por su correo).
"""

import datetime
import re
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from django.db import transaction

from apps.core.audit import record_audit_event
from apps.organizacion.models import Sede
from apps.users.models import User

from . import fechas, servicios
from .models import (
    DE_DIA_Y_MES,
    Area,
    EntidadControl,
    FichaObligacion,
    Obligacion,
    Periodicidad,
    Periodo,
    TipoFicha,
)

FECHA_POR_CONFIRMAR = datetime.date(2026, 12, 31)
NOTA_POR_CONFIRMAR = "Fecha de vencimiento por confirmar: no venía en la matriz legal."
VACIOS = {"", "n/a", "na", "-", "none"}

#: Faltas de ortografía del archivo (palabra completa, sin distinguir mayúsculas).
CORRECCIONES = {
    "districto": "Distrito",
    "penduente": "Pendiente",
    "pendinte": "Pendiente",
    "sociadad": "Sociedad",
    "sociadades": "Sociedades",
    "renovaion": "Renovación",
    "renovacion": "renovación",
    "rescición": "Rescisión",
    "remoras": "remotas",
    "practicas": "Prácticas",
    "distribucion": "Distribución",
    "farmaceuticos": "farmacéuticos",
    "electronica": "electrónica",
    "modificacion": "Modificación",
    "unica": "Única",
    "unico": "Único",
    "economicas": "Económicas",
    "anonima": "Anónima",
    "automatica": "automática",
    "negociacion": "negociación",
    "validacion": "validación",
    "revision": "revisión",
    "vehiculos": "Vehículos",
    "transformacion": "transformación",
    "camion": "camión",
    "camara": "cámara",
    "garantia": "garantía",
    "importacion": "importación",
    "compañias": "Compañías",
    "publicas": "públicas",
    "tecnico": "técnico",
}

PERIODICIDADES = {
    "mensual": Periodicidad.MENSUAL,
    "trimestral": Periodicidad.TRIMESTRAL,
    "semestral": Periodicidad.SEMESTRAL,
    "anual": Periodicidad.ANUAL,
    "bianual": Periodicidad.BIENAL,
    "bienal": Periodicidad.BIENAL,
    "trianual": Periodicidad.TRIENAL,
    "trienal": Periodicidad.TRIENAL,
    "quintianual": Periodicidad.QUINQUENAL,
    "quinquenal": Periodicidad.QUINQUENAL,
    "decanual": Periodicidad.DECENAL,
    "decenal": Periodicidad.DECENAL,
    "documento unico": Periodicidad.UNICA,
}

#: Regionales del Excel que en el catálogo de sedes se llaman distinto.
ALIAS_SEDES = {
    "quito matriz": "Matriz Quito",
    "cuenca sucursal": "Sucursal Cuenca",
}

SEGUROS = {
    "vehiculo",
    "incendio",
    "multiriesgo",
    "responsabilidad civil",
    "accidentes personales",
    "garantia aduanera",
    "transporte importacion",
    "transporte interno",
}

#: Concepto (normalizado, al inicio) → código de tema.
TEMAS_POR_CONCEPTO = [
    ("patente", "CONT"),
    ("1.5xmill", "CONT"),
    ("permiso de bomberos", "SST"),
    ("permiso ambiental", "AMB"),
    ("certificado ambiental", "AMB"),
    ("arriendo", "INF"),
    ("mantenimiento", "INF"),
    ("contrato proveedor", "INF"),
]
#: Los temas que usa la importación, con su nombre (los del catálogo sembrado):
#: si faltan —en producción el catálogo estaba vacío— se crean.
NOMBRES_DE_TEMAS = {
    "CONT": "Contabilidad y Tributario",
    "SST": "Seguridad y Salud en el Trabajo",
    "AMB": "Ambiental",
    "LEG": "Legal y Permisos",
    "SEG": "Seguros y Pólizas",
    "INF": "Arriendos e Infraestructura",
}
TEMAS_POR_AREA = {
    "legal": "LEG",
    "salud y seguridad ocupacional": "SST",
    "facturacion": "CONT",
    "sistemas": "INF",
    "contabilidad": "CONT",
    "administracion": "LEG",
}

#: Entidades del Excel que en el catálogo se llaman distinto.
ALIAS_ENTIDADES = {
    "iess": "Instituto Ecuatoriano de Seguridad Social (IESS)",
}

#: Documentos de la hoja CONTABILIDAD → entidad.
ENTIDADES_CONTABILIDAD = [
    ("super cias", "Superintendencia de Compañías"),
    ("mintel", "MINTEL"),
    ("inec", "INEC"),
]


def normal(texto) -> str:
    """Para comparar: sin tildes, minúsculas y espacios simples."""
    texto = unicodedata.normalize("NFD", str(texto or "").replace("\xa0", " "))
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", texto).strip().lower()


def limpiar(valor) -> str | None:
    """El texto de una celda: sin espacios de más, con las faltas corregidas;
    «N/A» o vacío → None."""
    if valor is None:
        return None
    texto = re.sub(r"\s+", " ", str(valor).replace("\xa0", " ")).strip()
    if normal(texto) in VACIOS:
        return None

    def corregir(m):
        palabra = m.group(0)
        correcta = CORRECCIONES.get(palabra.lower())
        if correcta is None:
            return palabra
        if palabra[0].isupper():
            return correcta[0].upper() + correcta[1:]
        return correcta[0].lower() + correcta[1:]

    return re.sub(r"[\wÁÉÍÓÚáéíóúÑñ]+", corregir, texto)


def clave(nombre) -> str:
    """Cómo se reconoce una obligación que ya existe: el nombre corregido y
    normalizado (la carga anterior lo tenía con faltas)."""
    return normal(limpiar(nombre) or "")


def titulo(texto: str) -> str:
    """«AMBATO BODEGA» → «Ambato Bodega» (las preposiciones en minúscula)."""
    menores = {"de", "del", "la", "las", "los", "y"}
    palabras = texto.lower().split()
    return " ".join(
        p if (i and p in menores) else p[:1].upper() + p[1:] for i, p in enumerate(palabras)
    )


def a_fecha(valor, avisos, donde) -> datetime.date | None:
    if valor is None:
        return None
    if isinstance(valor, datetime.datetime):
        return valor.date()
    if isinstance(valor, datetime.date):
        return valor
    texto = str(valor).strip()
    if normal(texto) in VACIOS:
        return None
    for formato in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.datetime.strptime(texto[:10], formato).date()
        except ValueError:
            pass
    # «2024-15-05»: el día y el mes invertidos.
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", texto[:10])
    if m and int(m.group(2)) > 12:
        fecha = datetime.date(int(m.group(1)), int(m.group(3)), int(m.group(2)))
        avisos.append(
            f"{donde}: la fecha «{texto}» tenía el día y el mes invertidos; se tomó {fecha:%d/%m/%Y}."
        )
        return fecha
    avisos.append(f"{donde}: no se entendió la fecha «{texto}»; se dejó sin fecha.")
    return None


def a_monto(valor) -> tuple[Decimal | None, str]:
    """Un monto, o el texto si no es un número («2.80 por persona»)."""
    if valor is None:
        return None, ""
    if isinstance(valor, (int, float, Decimal)):
        return Decimal(str(valor)).quantize(Decimal("0.01")), ""
    texto = limpiar(valor)
    if texto is None:
        return None, ""
    try:
        return Decimal(texto.replace(",", "")).quantize(Decimal("0.01")), ""
    except InvalidOperation:
        return None, texto[:120]


# --- Lectura ------------------------------------------------------------------


@dataclass
class Fila:
    hoja: str
    numero: int
    area: str
    concepto: str
    recurrencia: str | None
    regional: str | None
    entidad: str | None
    emision: datetime.date | None
    vencimiento: datetime.date | None
    correos: list[str]
    ficha: dict = field(default_factory=dict)
    tipo_ficha: str = TipoFicha.GENERAL
    observaciones: list[str] = field(default_factory=list)

    @property
    def donde(self) -> str:
        return f"{self.hoja}, fila {self.numero}"


def _encabezados(hoja, buscar: str) -> tuple[int, dict]:
    """La fila de encabezados (la que tiene `buscar`) y columna por nombre."""
    for fila in hoja.iter_rows(min_row=1, max_row=10):
        nombres = {normal(c.value): i for i, c in enumerate(fila) if c.value is not None}
        if buscar in nombres:
            return fila[0].row, nombres
    raise ValueError(f"La hoja «{hoja.title}» no tiene la columna «{buscar}».")


def leer(archivo) -> tuple[list[Fila], list[str]]:
    """Las filas del archivo, ya limpias, y los avisos de la lectura."""
    import openpyxl

    libro = openpyxl.load_workbook(archivo, data_only=True, read_only=False)
    hojas = {normal(h.title): h for h in libro.worksheets}
    if "consolidado" not in hojas:
        raise ValueError("El archivo no tiene la hoja «CONSOLIDADO».")
    avisos: list[str] = []
    filas: list[Fila] = []

    # ARRIENDOS: «Renovado», «Vigencia» y observaciones, por regional.
    arriendos = {}
    if "arriendos" in hojas:
        hoja = hojas["arriendos"]
        inicio, col = _encabezados(hoja, "regional")
        for fila in hoja.iter_rows(min_row=inicio + 1, values_only=True):
            regional = limpiar(fila[col["regional"]]) if "regional" in col else None
            if not regional:
                continue
            renovado = normal(fila[col["renovado"]]) if "renovado" in col else ""
            arriendos[normal(regional)] = {
                "duracion": limpiar(fila[col["vigencia"]]) if "vigencia" in col else None,
                "renovado": (
                    True if renovado in {"si", "sí"} else (False if renovado == "no" else None)
                ),
                "observaciones": (
                    limpiar(fila[col["observaciones"]]) if "observaciones" in col else None
                ),
            }

    hoja = hojas["consolidado"]
    inicio, col = _encabezados(hoja, "concepto")

    def celda(valores, nombre):
        i = col.get(nombre)
        return valores[i] if i is not None and i < len(valores) else None

    for numero, valores in enumerate(
        hoja.iter_rows(min_row=inicio + 1, values_only=True), inicio + 1
    ):
        concepto = limpiar(celda(valores, "concepto"))
        if not concepto:
            continue
        donde = f"CONSOLIDADO, fila {numero}"
        correos = re.findall(
            r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", str(celda(valores, "correo electronico") or "")
        )
        f = Fila(
            hoja="CONSOLIDADO",
            numero=numero,
            area=limpiar(celda(valores, "area")) or "Administración",
            concepto=concepto,
            recurrencia=limpiar(celda(valores, "recurrencia")),
            regional=limpiar(celda(valores, "regional")),
            entidad=limpiar(celda(valores, "entidad de control")),
            emision=a_fecha(celda(valores, "fecha de emision"), avisos, donde),
            vencimiento=a_fecha(celda(valores, "fecha de vencimiento"), avisos, donde),
            correos=[c.lower() for c in correos],
        )
        tipo_seguro = limpiar(celda(valores, "tipo de seguro"))
        if tipo_seguro or normal(concepto) in SEGUROS:
            f.tipo_ficha = TipoFicha.SEGURO
            prima, prima_detalle = a_monto(celda(valores, "prima"))
            valor, _ = a_monto(celda(valores, "valor asegurado"))
            f.ficha = {
                "tipo_seguro": titulo(tipo_seguro or concepto),
                "propietario": limpiar(celda(valores, "propietario")) or "",
                "marca": limpiar(celda(valores, "marca")) or "",
                "modelo": limpiar(celda(valores, "modelo")) or "",
                "tipo_vehiculo": titulo(limpiar(celda(valores, "tipo")) or ""),
                "placa": (limpiar(celda(valores, "placa")) or "").upper(),
                "broker": limpiar(celda(valores, "broker")) or "",
                "aseguradora": limpiar(celda(valores, "aseguradora")) or "",
                "vigencia_desde": a_fecha(celda(valores, "vigencia desde"), avisos, donde),
                "vigencia_hasta": a_fecha(celda(valores, "vigencia hasta"), avisos, donde),
                "prima": prima,
                "prima_detalle": prima_detalle,
                "valor_asegurado": valor,
                "asegurado": limpiar(celda(valores, "empresa")) or "",
                "poliza": limpiar(celda(valores, "polizas conjuntas")) or "",
                "detalle": limpiar(celda(valores, "detalle")) or "",
            }
            # Sin fecha de vencimiento, la del fin de la vigencia.
            f.vencimiento = f.vencimiento or f.ficha["vigencia_hasta"]
            f.emision = f.emision or f.ficha["vigencia_desde"]
        elif normal(concepto) == "arriendo":
            f.tipo_ficha = TipoFicha.ARRIENDO
            canon, _ = a_monto(celda(valores, "canon"))
            garantia, _ = a_monto(celda(valores, "garantia"))
            extra = arriendos.get(normal(f.regional or ""), {})
            f.ficha = {
                "canon": canon,
                "garantia": garantia,
                "incremento": limpiar(celda(valores, "incremento")) or "",
                "duracion": extra.get("duracion") or "",
                "renovado": extra.get("renovado"),
            }
            if extra.get("observaciones"):
                f.observaciones.append(extra["observaciones"])
        filas.append(f)

    if "contabilidad" in hojas:
        hoja = hojas["contabilidad"]
        inicio, col = _encabezados(hoja, "documento")
        for numero, valores in enumerate(
            hoja.iter_rows(min_row=inicio + 1, values_only=True), inicio + 1
        ):
            documento = limpiar(valores[col["documento"]])
            if not documento:
                continue
            donde = f"CONTABILIDAD, fila {numero}"
            f = Fila(
                hoja="CONTABILIDAD",
                numero=numero,
                area="Contabilidad",
                concepto=documento,
                recurrencia=(
                    limpiar(valores[col["mes de renovacion"]])
                    if "mes de renovacion" in col
                    else None
                ),
                regional=None,
                entidad=None,
                emision=a_fecha(valores[col["fecha de emision"]], avisos, donde),
                vencimiento=a_fecha(valores[col["fecha de caducidad"]], avisos, donde),
                correos=[],
            )
            if "observaciones" in col and limpiar(valores[col["observaciones"]]):
                f.observaciones.append(limpiar(valores[col["observaciones"]]))
            filas.append(f)
    return filas, avisos


# --- Plan ---------------------------------------------------------------------


@dataclass
class Propuesta:
    fila: Fila
    nombre: str
    tema: str
    entidad: str
    sede: str | None
    periodicidad: str
    vencimiento: datetime.date
    por_confirmar: bool
    existente: Obligacion | None = None


@dataclass
class Plan:
    propuestas: list[Propuesta]
    temas: dict
    temas_nuevos: list[str]
    entidades_nuevas: list[str]
    sedes_nuevas: list[str]
    responsable: User | None
    suplente: User | None
    errores: list[str]
    avisos: list[str]

    def resumen(self) -> dict:
        nuevas = [p for p in self.propuestas if p.existente is None]
        return {
            "filas": len(self.propuestas),
            "crear": len(nuevas),
            "actualizar": len(self.propuestas) - len(nuevas),
            "por_confirmar": sum(1 for p in self.propuestas if p.por_confirmar),
            "vencidas": sum(1 for p in nuevas if p.vencimiento < datetime.date.today()),
            "temas_nuevos": [f"{c} — {NOMBRES_DE_TEMAS[c]}" for c in self.temas_nuevos],
            "entidades_nuevas": self.entidades_nuevas,
            "sedes_nuevas": self.sedes_nuevas,
            "responsable": _persona(self.responsable),
            "suplente": _persona(self.suplente),
            "errores": self.errores,
            "avisos": self.avisos,
            "obligaciones": [
                {
                    "fila": p.fila.donde,
                    "nombre": p.nombre,
                    "tema": p.tema,
                    "entidad": p.entidad,
                    "sede": p.sede,
                    "periodicidad": p.periodicidad,
                    "vencimiento": p.vencimiento.isoformat(),
                    "por_confirmar": p.por_confirmar,
                    "accion": "actualizar" if p.existente else "crear",
                }
                for p in self.propuestas
            ],
        }


def _persona(usuario):
    if usuario is None:
        return None
    return {
        "id": usuario.id,
        "nombre": usuario.get_full_name() or usuario.username,
        "correo": usuario.email,
    }


def _nombre(f: Fila, sede: str | None) -> str:
    concepto = f.concepto
    n = normal(concepto)
    if f.tipo_ficha == TipoFicha.SEGURO:
        if n == "vehiculo" and f.ficha.get("placa"):
            return f"Seguro de vehículo · {f.ficha['placa']}"
        return f"Póliza de {concepto.lower()}"
    if n == "arriendo":
        base = "Contrato de arriendo"
    elif n == "1.5xmill":
        base = "Impuesto 1.5 por mil sobre activos totales"
    else:
        base = concepto
    # La sucursal va en el nombre de lo que se repite por sucursal (los
    # registros de Administración: permisos, arriendos…); los documentos de la
    # empresa (Legal, SSO, Facturación…) la llevan solo en el período.
    if f.regional and normal(f.regional) not in VACIOS and normal(f.area) == "administracion":
        base = f"{base} · {titulo(f.regional)}"
    return base[:200]


def _tema(f: Fila) -> str:
    if f.tipo_ficha == TipoFicha.SEGURO:
        return "SEG"
    n = normal(f.concepto)
    for prefijo, codigo in TEMAS_POR_CONCEPTO:
        if n.startswith(prefijo):
            return codigo
    return TEMAS_POR_AREA.get(normal(f.area), "LEG")


def _entidad(f: Fila) -> str:
    if f.hoja == "CONTABILIDAD":
        n = normal(f.concepto)
        for prefijo, nombre in ENTIDADES_CONTABILIDAD:
            if n.startswith(prefijo):
                return nombre
        return "Servicio de Rentas Internas"
    if f.tipo_ficha == TipoFicha.SEGURO and f.ficha.get("aseguradora"):
        return f.ficha["aseguradora"]
    if f.entidad:
        return ALIAS_ENTIDADES.get(normal(f.entidad), f.entidad)
    if f.tipo_ficha == TipoFicha.ARRIENDO:
        return "Arrendador (contrato de arriendo)"
    return "Sin entidad de control (interna)"


def _periodicidad(f: Fila, avisos) -> str:
    texto = normal(f.recurrencia)
    if texto in PERIODICIDADES:
        return PERIODICIDADES[texto]
    if f.recurrencia:
        avisos.append(f"{f.donde}: recurrencia «{f.recurrencia}» → única.")
    return Periodicidad.UNICA


def _codigo_libre(nombre: str, usados: set[str]) -> str:
    """Un código de 10 caracteres para una entidad nueva: sus iniciales."""
    palabras = [
        p
        for p in re.findall(r"[A-Za-z0-9]+", normal(nombre).upper())
        if p not in {"DE", "DEL", "LA", "Y"}
    ]
    base = ("".join(p[0] for p in palabras) if len(palabras) > 1 else (palabras or ["ENT"])[0])[:8]
    codigo, n = base, 2
    while codigo in usados:
        codigo, n = f"{base}{n}"[:10], n + 1
    usados.add(codigo)
    return codigo


def planificar(filas: list[Fila], empresa) -> Plan:
    """Qué se haría con cada fila, sin guardar nada."""
    errores: list[str] = []
    avisos: list[str] = []

    # Las personas: el primer correo responsable, el segundo suplente.
    correos = next((f.correos for f in filas if f.correos), [])
    usuarios = {u.email.lower(): u for u in User.objects.filter(email__in=correos, is_active=True)}
    responsable = usuarios.get(correos[0]) if correos else None
    suplente = usuarios.get(correos[1]) if len(correos) > 1 else None
    if not correos:
        errores.append("El archivo no trae el correo del responsable.")
    else:
        for correo in correos[:2]:
            if correo not in usuarios:
                errores.append(
                    f"No hay una cuenta activa con el correo {correo}: créela antes de importar "
                    "(es el responsable o suplente de las obligaciones)."
                )

    temas = {a.codigo: a for a in Area.objects.all()}
    entidades = {normal(limpiar(e.nombre)): e for e in EntidadControl.objects.all()}
    sedes = {normal(s.nombre): s for s in Sede.objects.filter(empresa=empresa)}
    existentes = {clave(o.nombre): o for o in Obligacion.objects.filter(empresa=empresa)}

    propuestas, vistos = [], {}
    entidades_nuevas, sedes_nuevas, temas_nuevos = [], [], []
    for f in filas:
        sede = None
        if f.regional and normal(f.regional) not in VACIOS:
            buscada = ALIAS_SEDES.get(normal(f.regional), titulo(f.regional))
            sede_obj = sedes.get(normal(buscada))
            sede = sede_obj.nombre if sede_obj else buscada
            if sede_obj is None and buscada not in sedes_nuevas:
                sedes_nuevas.append(buscada)
        tema = _tema(f)
        if tema not in temas and tema not in temas_nuevos:
            temas_nuevos.append(tema)
        entidad = _entidad(f)
        if normal(entidad) not in entidades and entidad not in entidades_nuevas:
            entidades_nuevas.append(entidad)
        periodicidad = _periodicidad(f, avisos)
        vencimiento, por_confirmar = f.vencimiento, False
        if vencimiento is None:
            vencimiento, por_confirmar = FECHA_POR_CONFIRMAR, True
        nombre = _nombre(f, sede)
        k = normal(nombre)
        if k in vistos:
            n = 2
            while normal(f"{nombre} ({n})") in vistos:
                n += 1
            avisos.append(
                f"{f.donde}: «{nombre}» se repite ({vistos[k]}); se cargó como «{nombre} ({n})»."
            )
            nombre = f"{nombre} ({n})"
            k = normal(nombre)
        vistos[k] = f.donde
        propuestas.append(
            Propuesta(
                fila=f,
                nombre=nombre,
                tema=tema,
                entidad=entidad,
                sede=sede,
                periodicidad=periodicidad,
                vencimiento=vencimiento,
                por_confirmar=por_confirmar,
                existente=existentes.get(k),
            )
        )
    return Plan(
        propuestas=propuestas,
        temas=temas,
        temas_nuevos=temas_nuevos,
        entidades_nuevas=entidades_nuevas,
        sedes_nuevas=sedes_nuevas,
        responsable=responsable,
        suplente=suplente,
        errores=errores,
        avisos=avisos,
    )


# --- Aplicar ------------------------------------------------------------------


def _evidencia(p: Propuesta) -> str:
    if p.fila.tipo_ficha == TipoFicha.SEGURO:
        return "Póliza vigente (PDF)"
    if p.fila.tipo_ficha == TipoFicha.ARRIENDO:
        return "Contrato de arrendamiento vigente (PDF)"
    if p.fila.hoja == "CONTABILIDAD":
        return "Formulario o comprobante de la declaración (PDF)"
    return "Documento vigente (PDF)"


def _plantilla(p: Propuesta, temas, entidades) -> dict:
    datos = {
        "area": temas[p.tema],
        "entidad": entidades[normal(p.entidad)],
        "periodicidad": p.periodicidad,
        "dia_vencimiento": None,
        "mes_vencimiento": None,
    }
    if not p.por_confirmar and p.periodicidad != Periodicidad.UNICA:
        datos["dia_vencimiento"] = p.vencimiento.day
        if p.periodicidad in DE_DIA_Y_MES:
            datos["mes_vencimiento"] = p.vencimiento.month
    return datos


def _ficha(obligacion, p: Propuesta, empresa):
    datos = {k: v for k, v in p.fila.ficha.items() if v not in (None, "")}
    datos["tipo"] = p.fila.tipo_ficha
    datos["emitido_en"] = p.fila.emision
    FichaObligacion.objects.update_or_create(
        obligacion=obligacion, defaults={"empresa": empresa, **datos}
    )


@transaction.atomic
def aplicar(plan: Plan, empresa, actor, contexto=None) -> dict:
    """Guarda el plan. No se puede aplicar con errores."""
    if plan.errores:
        raise ValueError("El plan tiene errores: corríjalos antes de importar.")
    for codigo in plan.temas_nuevos:
        plan.temas[codigo], _ = Area.objects.get_or_create(
            codigo=codigo, defaults={"nombre": NOMBRES_DE_TEMAS[codigo]}
        )
    entidades = {normal(limpiar(e.nombre)): e for e in EntidadControl.objects.all()}
    usados = set(EntidadControl.objects.values_list("codigo", flat=True))
    for nombre in plan.entidades_nuevas:
        if normal(nombre) not in entidades:
            entidades[normal(nombre)] = EntidadControl.objects.create(
                codigo=_codigo_libre(nombre, usados), nombre=nombre[:160]
            )
    sedes = {normal(s.nombre): s for s in Sede.objects.filter(empresa=empresa)}
    for nombre in plan.sedes_nuevas:
        if normal(nombre) not in sedes:
            sedes[normal(nombre)] = Sede.objects.create(
                empresa=empresa, nombre=nombre, ciudad=nombre
            )

    creadas = actualizadas = 0
    for p in plan.propuestas:
        plantilla = _plantilla(p, plan.temas, entidades)
        sede = sedes.get(normal(p.sede)) if p.sede else None
        observaciones = list(p.fila.observaciones)
        if p.por_confirmar:
            observaciones.insert(0, NOTA_POR_CONFIRMAR)
        if p.existente is None:
            obligacion, _ = servicios.crear_obligacion(
                empresa=empresa,
                actor=actor,
                plantilla={
                    "nombre": p.nombre,
                    "evidencia_esperada": _evidencia(p),
                    "descripcion": f"Importada de la matriz legal ({p.fila.donde}).",
                    **plantilla,
                },
                periodo={
                    "fecha_vencimiento": p.vencimiento,
                    "etiqueta": (
                        fechas.etiqueta(p.periodicidad, p.vencimiento)
                        if not p.por_confirmar
                        else "Por confirmar"
                    ),
                    "responsable": plan.responsable,
                    "suplente": plan.suplente,
                    "sede": sede,
                    "observaciones": "\n".join(observaciones),
                },
                contexto=contexto,
            )
            creadas += 1
        else:
            obligacion = p.existente
            anteriores = {"nombre": obligacion.nombre, "periodicidad": obligacion.periodicidad}
            obligacion.nombre = p.nombre
            for campo, valor in plantilla.items():
                setattr(obligacion, campo, valor)
            obligacion.save()
            # Sus períodos no se tocan, salvo la sucursal si no la tenían.
            if sede is not None:
                Periodo.objects.filter(obligacion=obligacion, sede__isnull=True).update(sede=sede)
            record_audit_event(
                actor=actor,
                action="obligation.updated",
                target=obligacion,
                module="matriz",
                previous_values=anteriores,
                new_values={
                    "nombre": obligacion.nombre,
                    "periodicidad": obligacion.periodicidad,
                    "origen": "matriz legal",
                },
                context=contexto,
            )
            actualizadas += 1
        _ficha(obligacion, p, empresa)

    resumen = {
        "creadas": creadas,
        "actualizadas": actualizadas,
        "temas_nuevos": len(plan.temas_nuevos),
        "entidades_nuevas": len(plan.entidades_nuevas),
        "sedes_nuevas": len(plan.sedes_nuevas),
    }
    record_audit_event(
        actor=actor,
        action="matriz.imported",
        target=empresa,
        module="matriz",
        new_values=resumen,
        context=contexto,
    )
    return resumen
