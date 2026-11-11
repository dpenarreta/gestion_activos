"""La base de conocimiento de Nova: subir PDF, extraer su texto, trocearlo y
buscar los fragmentos relevantes para una pregunta del chat (Nexo:
`src/app/api/assistant/documents/route.ts`, `src/lib/githubDocuments.ts` y
`src/lib/embeddings.ts`).

**Diferencias con Nexo (decisión del 09/11/2026):**

- Los PDF no van a GitHub: se guardan en el almacenamiento de archivos de la
  intranet (`DocumentoConocimiento.archivo`), como cualquier adjunto, y se
  abren en el visor del sistema.
- Sin embeddings externos: el proveedor puede ser Anthropic, que no los
  ofrece, y mandar todo el documento a otro servicio para indexarlo sacaría
  datos sin necesidad. La búsqueda es léxica (BM25) y corre en el servidor,
  sin distinguir tildes ni mayúsculas. Solo los fragmentos elegidos (como
  mucho `MAXIMO_FRAGMENTOS`) salen hacia la IA, dentro de la llamada del chat,
  y pasan por el seudonimizador como el resto.

**Validación:** solo PDF (extensión y firma `%PDF-` del contenido, no el tipo
que diga el navegador), tamaño máximo `NOVA_CONOCIMIENTO_TAMANO_MAXIMO_MB`
(10 MB por defecto) y con texto seleccionable (un escaneo sin OCR no sirve
para buscar y se rechaza con un mensaje claro).
"""

import io
import logging
import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import PurePath

from django.conf import settings
from django.db import transaction

from apps.core.archivos import mensaje_de_tamano

from .models import DocumentoConocimiento, FragmentoConocimiento

logger = logging.getLogger(__name__)

FIRMA_PDF = b"%PDF-"

#: Caracteres por fragmento y solape con el anterior (como Nexo).
LARGO_FRAGMENTO = 1800
SOLAPE = 200
#: Páginas que se leen como mucho (un manual enorme no debe colgar la subida).
MAXIMO_PAGINAS = 600

#: Cuántos fragmentos van al chat como mucho (Nexo: top 4).
MAXIMO_FRAGMENTOS = 4
#: Un fragmento entra si su puntaje llega a esta fracción del mejor: evita
#: rellenar con fragmentos que solo comparten una palabra suelta.
FRACCION_DEL_MEJOR = 0.35

# BM25.
K1 = 1.5
B = 0.75

#: Palabras que no ayudan a buscar (ya sin tildes).
PALABRAS_VACIAS = frozenset(
    """
    a al algo algun alguna algunas alguno algunos ante antes aqui asi aun cada como con contra
    cual cuales cuando cuanto cuanta cuantos cuantas de del desde donde dos e el ella ellas ello
    ellos en entre era eran es esa esas ese eso esos esta estan estar este esto estos fue fueron
    ha hace hacer han hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos o otra
    otras otro otros para pero poco por porque puede pueden puedo que quien quienes se segun ser
    si sin sobre son su sus tambien tan tanto te tengo tiene tienen todo todos tu tus u un una unas
    uno unos usted ustedes y ya yo debo debe deben quiero saber dime decir favor hola gracias nova
    """.split()
)


class DocumentoInvalido(Exception):
    """El archivo no se puede usar; `mensaje` es para la persona."""

    def __init__(self, mensaje: str):
        super().__init__(mensaje)
        self.mensaje = mensaje


# ── Configuración ────────────────────────────────────────────────────────────


def tamano_maximo_bytes() -> int:
    megas = max(1, int(getattr(settings, "NOVA_CONOCIMIENTO_TAMANO_MAXIMO_MB", 10)))
    return megas * 1024 * 1024


# ── Texto ────────────────────────────────────────────────────────────────────


def _sin_tildes(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    ).casefold()


def _raiz(palabra: str) -> str:
    """Un plural simple al singular («vacaciones» → «vacacion», «días» →
    «dia»): basta para que la pregunta y el documento coincidan."""
    if len(palabra) > 4 and palabra.endswith("es"):
        return palabra[:-2]
    if len(palabra) > 3 and palabra.endswith("s"):
        return palabra[:-1]
    return palabra


def terminos(texto: str) -> list[str]:
    """Las palabras de búsqueda de un texto: sin tildes ni mayúsculas, sin
    palabras vacías y con los plurales simples reducidos."""
    palabras = re.findall(r"[a-z0-9]+", _sin_tildes(texto or ""))
    return [_raiz(p) for p in palabras if len(p) > 1 and p not in PALABRAS_VACIAS]


def _limpiar(texto: str) -> str:
    texto = (texto or "").replace("\x00", " ")
    # Palabras cortadas con guion al final de la línea.
    texto = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", texto)
    return re.sub(r"\s+", " ", texto).strip()


def trocear(texto: str, largo: int = LARGO_FRAGMENTO, solape: int = SOLAPE) -> list[str]:
    """Trozos de unos `largo` caracteres con `solape` de solape, cortando en un
    espacio cuando se puede (nunca a mitad de palabra si hay dónde)."""
    texto = texto.strip()
    if not texto:
        return []
    trozos, inicio = [], 0
    while inicio < len(texto):
        fin = min(len(texto), inicio + largo)
        if fin < len(texto):
            espacio = texto.rfind(" ", inicio + int(largo * 0.6), fin)
            if espacio > inicio:
                fin = espacio
        trozo = texto[inicio:fin].strip()
        if trozo:
            trozos.append(trozo)
        if fin >= len(texto):
            break
        siguiente = max(fin - solape, inicio + 1)
        # El solape empieza en una palabra entera.
        espacio = texto.find(" ", siguiente, fin)
        inicio = espacio + 1 if espacio != -1 else siguiente
    return trozos


# ── PDF ──────────────────────────────────────────────────────────────────────


def validar_archivo(archivo) -> None:
    """Tamaño, extensión y firma del contenido (`DocumentoInvalido` si no)."""
    maximo = tamano_maximo_bytes()
    if not archivo or archivo.size == 0:
        raise DocumentoInvalido("El archivo está vacío.")
    if archivo.size > maximo:
        raise DocumentoInvalido(mensaje_de_tamano("El archivo", archivo.size, maximo))
    if PurePath(archivo.name or "").suffix.lower() != ".pdf":
        raise DocumentoInvalido("Solo se admiten documentos PDF (.pdf).")
    cabecera = archivo.read(1024)
    archivo.seek(0)
    # La firma va al comienzo; algunos generadores dejan unos bytes antes.
    if FIRMA_PDF not in cabecera:
        raise DocumentoInvalido(
            "El contenido del archivo no es un PDF. Verifique que no se haya renombrado la "
            "extensión."
        )


def extraer_paginas(contenido: bytes) -> list[str]:
    """El texto de cada página (limpio). `DocumentoInvalido` si el PDF no se
    puede leer, está protegido con contraseña o no tiene texto."""
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        lector = PdfReader(io.BytesIO(contenido))
        if lector.is_encrypted and not lector.decrypt(""):
            raise DocumentoInvalido("El PDF está protegido con contraseña. Súbalo sin protección.")
        paginas = []
        for indice, pagina in enumerate(lector.pages):
            if indice >= MAXIMO_PAGINAS:
                break
            try:
                paginas.append(_limpiar(pagina.extract_text() or ""))
            except Exception:  # noqa: BLE001 — una página rota no tumba el resto
                logger.warning("[nova] no se pudo leer la página %s de un PDF", indice + 1)
                paginas.append("")
    except DocumentoInvalido:
        raise
    except (PdfReadError, ValueError, KeyError, TypeError, OSError) as error:
        logger.warning("[nova] PDF ilegible: %s", type(error).__name__)
        raise DocumentoInvalido("No se pudo leer el PDF: puede estar dañado.") from None
    if not any(paginas):
        raise DocumentoInvalido(
            "El PDF no tiene texto seleccionable (parece escaneado como imagen). Súbalo con el "
            "texto reconocido (OCR) para que Nova pueda consultarlo."
        )
    return paginas


def fragmentos_de(paginas: list[str]) -> list[tuple[int, str]]:
    """`(número de página, texto)` de cada fragmento, en orden."""
    return [
        (numero, trozo) for numero, texto in enumerate(paginas, start=1) for trozo in trocear(texto)
    ]


@transaction.atomic
def crear_documento(archivo, titulo: str, usuario) -> DocumentoConocimiento:
    """Valida, extrae y guarda el documento con sus fragmentos. El archivo
    solo se guarda si se pudo extraer su texto."""
    validar_archivo(archivo)
    contenido = archivo.read()
    archivo.seek(0)
    paginas = extraer_paginas(contenido)
    nombre = PurePath(archivo.name or "documento.pdf").name[:255]
    titulo = (titulo or "").strip() or PurePath(nombre).stem
    documento = DocumentoConocimiento(
        titulo=titulo[:200],
        nombre_original=nombre,
        tamano_bytes=archivo.size,
        paginas=len(paginas),
        subido_por=usuario,
    )
    documento.archivo.save(nombre, archivo, save=False)
    try:
        documento.save()
        FragmentoConocimiento.objects.bulk_create(
            [
                FragmentoConocimiento(
                    # `bulk_create` no pasa por `save`: la empresa va explícita.
                    empresa_id=documento.empresa_id,
                    documento=documento,
                    orden=orden,
                    pagina=pagina,
                    texto=texto,
                    terminos=" ".join(terminos(texto)),
                )
                for orden, (pagina, texto) in enumerate(fragmentos_de(paginas))
            ],
            batch_size=200,
        )
    except Exception:
        # Sin fila no debe quedar un archivo huérfano en el disco.
        documento.borrar_archivo()
        raise
    return documento


# ── Búsqueda ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Encontrado:
    fragmento_id: int
    documento_id: int
    titulo: str
    pagina: int
    texto: str
    puntaje: float


def buscar(pregunta: str, maximo: int = MAXIMO_FRAGMENTOS) -> list[Encontrado]:
    """Los fragmentos de la empresa activa más relevantes para `pregunta`
    (BM25), como mucho `maximo`, con umbral. Vacío si no hay documentos o
    nada se parece."""
    consulta = list(dict.fromkeys(terminos(pregunta)))
    if not consulta:
        return []
    filas = list(FragmentoConocimiento.objects.values_list("id", "terminos"))
    if not filas:
        return []

    documentos = [(pk, texto.split()) for pk, texto in filas]
    total = len(documentos)
    promedio = sum(len(t) for _, t in documentos) / total or 1
    frecuencia_doc = Counter()
    for _, palabras in documentos:
        frecuencia_doc.update(set(palabras) & set(consulta))

    def idf(termino: str) -> float:
        df = frecuencia_doc.get(termino, 0)
        return math.log(1 + (total - df + 0.5) / (df + 0.5))

    # Con una o dos palabras basta una coincidencia; con más, dos distintas.
    minimo = 1 if len(consulta) <= 2 else 2
    puntajes = []
    for pk, palabras in documentos:
        conteo = Counter(p for p in palabras if p in consulta)
        if len(conteo) < minimo:
            continue
        largo = len(palabras)
        puntaje = sum(
            idf(t) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * largo / promedio))
            for t, f in conteo.items()
        )
        puntajes.append((puntaje, pk))
    if not puntajes:
        return []
    puntajes.sort(reverse=True)
    mejor = puntajes[0][0]
    elegidos = [(s, pk) for s, pk in puntajes[:maximo] if s >= mejor * FRACCION_DEL_MEJOR]
    por_id = {
        f.pk: f
        for f in FragmentoConocimiento.objects.filter(pk__in=[pk for _, pk in elegidos])
        .select_related("documento")
        .only("id", "pagina", "texto", "documento__id", "documento__titulo")
    }
    return [
        Encontrado(
            fragmento_id=pk,
            documento_id=por_id[pk].documento.pk,
            titulo=por_id[pk].documento.titulo,
            pagina=por_id[pk].pagina,
            texto=por_id[pk].texto,
            puntaje=round(s, 4),
        )
        for s, pk in elegidos
        if pk in por_id
    ]
