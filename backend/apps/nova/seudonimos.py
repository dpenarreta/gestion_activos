"""Seudónimos y limpieza de lo que se manda a la IA (decisión del 09/11/2026).

Regla: **a Google nunca van nombres de personas ni datos de salud.**

- Cada persona se nombra con un seudónimo («Persona A», «Persona B»…), estable
  dentro de una misma llamada: la misma persona es siempre la misma letra. Se
  envían su cargo y sus cifras, nunca su nombre, usuario ni correo.
- En los textos libres que pudieran colarse (títulos de tareas, comentarios,
  hallazgos ya redactados) se reemplazan los nombres conocidos por su seudónimo
  y se ocultan correos, cédulas/RUC y teléfonos.
- Un texto que menciona salud (maternidad, lactancia, permisos o motivos
  médicos, enfermedades…) no se envía: se reemplaza entero por una marca. Las
  claves de un diccionario que llevan datos de salud se quitan.
- Única excepción (decisión del 09/11/2026): `permitir_salud=True` deja pasar
  las menciones de salud como tema general (políticas de licencias, permisos
  médicos…). Solo lo pide el núcleo para el modo General del chat, que no
  lleva datos de personas (`nucleo._salud_permitida`); el resto de la
  limpieza (nombres, correos, cédulas, teléfonos y claves de salud) sigue
  igual.
- Al volver la respuesta, `reponer` cambia cada seudónimo por el nombre real
  antes de mostrarla.
- `verificar` es la última barrera: revisa el texto exacto que se va a enviar y
  lanza `EnvioBloqueado` si aún queda un nombre, un dato de contacto o una
  mención de salud. El núcleo (`nucleo.py`) la llama siempre, así que una
  función nueva que olvide seudonimizar no envía nada: degrada a la versión
  sin IA.
"""

import re
import unicodedata

#: Lo que reemplaza un texto entero que mencionaba salud.
TEXTO_OMITIDO = "[texto omitido por privacidad]"
CORREO_OCULTO = "[correo]"
IDENTIFICACION_OCULTA = "[identificación]"
TELEFONO_OCULTO = "[teléfono]"
NOMBRE_AMBIGUO = "[persona]"

_CORREO = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# Cédula (10 dígitos) o RUC (13) de Ecuador, sueltos.
_IDENTIFICACION = re.compile(r"(?<!\d)\d{10}(?:\d{3})?(?!\d)")
# Teléfonos con prefijo internacional, o nacionales que empiezan por 0
# (fijos 0X-XXX-XXXX y celulares 09X XXX XXXX), con o sin separadores.
_TELEFONO = re.compile(
    r"(?<![\w+])(?:\+\d{1,3}[\s.-]?\(?\d{1,3}\)?|\(?0\d{1,2}\)?)[\s.-]?\d{3}[\s.-]?\d{3,4}(?!\w)"
)
# Menciones de salud. «salud» como palabra suelta (no «saludable», que los
# motores usan para «dentro de rango»).
_SALUD = re.compile(
    r"m[eé]dic|maternidad|lactancia|lactante|embaraz|prenatal|pre-natal|posparto|postparto|"
    r"\bparto\b|enfermedad|enferm[oa]s?\b|incapacidad|discapacidad|diagn[oó]stic|cirug[ií]a|"
    r"quir[uú]rg|hospital|cl[ií]nic|\breposo\b|terapia|fisioterap|psicol[oó]g|psiqui|"
    r"\bsalud\b|covid|odontol|s[ií]ntoma|tratamiento m|\bIESS\b|licencia por",
    re.IGNORECASE,
)
#: Claves de diccionario que llevan datos de salud: se quitan enteras.
_CLAVE_DE_SALUD = re.compile(
    r"medic|special_?status|estado_?especial|maternidad|lactancia|leave|ausencia|salud",
    re.IGNORECASE,
)

_VOCALES = {
    "a": "aáàäâ",
    "e": "eéèëê",
    "i": "iíìïî",
    "o": "oóòöô",
    "u": "uúùüû",
    "n": "nñ",
}


def _sin_tildes(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    ).casefold()


def _patron(palabras: str) -> str:
    """Patrón que reconoce `palabras` sin importar tildes ni mayúsculas, como
    palabra entera."""
    partes = []
    for c in _sin_tildes(palabras):
        if c in _VOCALES:
            partes.append(f"[{_VOCALES[c]}]")
        elif c.isspace():
            partes.append(r"\s+")
        else:
            partes.append(re.escape(c))
    return r"(?<!\w)" + "".join(partes) + r"(?!\w)"


def contiene_salud(texto: str) -> bool:
    return bool(_SALUD.search(texto or ""))


def ocultar_contacto(texto: str) -> str:
    """Oculta correos, cédulas/RUC y teléfonos (en ese orden: el correo puede
    llevar dígitos)."""
    texto = _CORREO.sub(CORREO_OCULTO, texto)
    texto = _IDENTIFICACION.sub(IDENTIFICACION_OCULTA, texto)
    return _TELEFONO.sub(TELEFONO_OCULTO, texto)


def _etiqueta(indice: int) -> str:
    """0 → A, 25 → Z, 26 → AA…"""
    letras = ""
    indice += 1
    while indice:
        indice, resto = divmod(indice - 1, 26)
        letras = chr(65 + resto) + letras
    return f"Persona {letras}"


class EnvioBloqueado(Exception):
    """El texto a enviar aún tiene algo que no debe salir. `motivos` dice qué
    (sin repetir el dato)."""

    def __init__(self, motivos: list[str]):
        super().__init__(", ".join(motivos))
        self.motivos = motivos


class Seudonimizador:
    """Los seudónimos de UNA llamada (o de un grupo de llamadas que deben
    compartirlos, como las cuatro de la narrativa de un informe)."""

    #: Largo mínimo de una parte del nombre para buscarla suelta en un texto
    #: («Ana», «Luis»…). Las partes más cortas («de», «la») solo cuentan
    #: dentro del nombre completo.
    LARGO_MINIMO_PARTE = 3
    #: Partes de un nombre que también son palabras comunes del texto.
    PARTES_IGNORADAS = frozenset({"del", "las", "los", "san", "santa", "von", "van"})

    def __init__(self):
        self._alias_por_clave: dict[str, str] = {}
        self._real_por_alias: dict[str, str] = {}
        # patrón → reemplazo; nombres completos primero, luego sus partes.
        self._completos: dict[str, str] = {}
        self._partes: dict[str, str | None] = {}

    # ── Alta de personas ────────────────────────────────────────────────────

    def persona(self, nombre: str, *otros: str, clave=None) -> str:
        """El seudónimo de una persona, creándolo si es la primera vez.

        `nombre` es el que se repone al mostrar la respuesta. `otros` son más
        formas de reconocerla en un texto libre (usuario, nombre corto). `clave`
        identifica a la persona (p. ej. su id) si dos se llaman igual."""
        nombre = (nombre or "").strip()
        clave = str(clave) if clave is not None else _sin_tildes(nombre)
        alias = self._alias_por_clave.get(clave)
        if alias is None:
            alias = _etiqueta(len(self._alias_por_clave))
            self._alias_por_clave[clave] = alias
            self._real_por_alias[alias] = nombre or alias
        for forma in (nombre, *otros):
            self._reconocer(forma, alias)
        return alias

    def _reconocer(self, forma: str, alias: str) -> None:
        forma = (forma or "").strip()
        if not forma:
            return
        self._completos[_patron(forma)] = alias
        for parte in re.split(r"[\s._@-]+", forma):
            if len(parte) < self.LARGO_MINIMO_PARTE or _sin_tildes(parte) in self.PARTES_IGNORADAS:
                continue
            patron = _patron(parte)
            previo = self._partes.get(patron, alias)
            # Una parte que comparten dos personas («Ana» y «Ana María») no
            # puede reponerse a ninguna de las dos: se oculta sin seudónimo.
            self._partes[patron] = alias if previo == alias else None

    @property
    def personas(self) -> dict[str, str]:
        """{seudónimo: nombre real}."""
        return dict(self._real_por_alias)

    # ── Limpieza de lo que se envía ─────────────────────────────────────────

    def _reemplazar_nombres(self, texto: str) -> str:
        for patron, alias in sorted(self._completos.items(), key=lambda p: -len(p[0])):
            texto = re.sub(patron, alias, texto, flags=re.IGNORECASE)
        for patron, alias in self._partes.items():
            texto = re.sub(patron, alias or NOMBRE_AMBIGUO, texto, flags=re.IGNORECASE)
        return texto

    def texto(self, texto, permitir_salud: bool = False) -> str:
        """Un texto libre listo para enviar: sin salud, sin contacto y con
        seudónimos en lugar de los nombres conocidos. Con `permitir_salud`
        (solo el modo General del chat) las menciones de salud se conservan."""
        if texto is None:
            return ""
        texto = str(texto)
        if not permitir_salud and contiene_salud(texto):
            return TEXTO_OMITIDO
        return self._reemplazar_nombres(ocultar_contacto(texto))

    def sanear(self, valor, permitir_salud: bool = False):
        """`texto` aplicado a toda una estructura (dict/list/str). Quita las
        claves de salud (también con `permitir_salud`); los números y
        booleanos pasan tal cual."""
        if isinstance(valor, dict):
            return {
                clave: self.sanear(v, permitir_salud)
                for clave, v in valor.items()
                if not _CLAVE_DE_SALUD.search(str(clave))
            }
        if isinstance(valor, (list, tuple)):
            return [self.sanear(v, permitir_salud) for v in valor]
        if isinstance(valor, str):
            return self.texto(valor, permitir_salud)
        return valor

    def verificar(self, texto: str, permitir_salud: bool = False) -> None:
        """La última barrera antes de enviar `texto`: si aún queda un nombre
        conocido, un dato de contacto o una mención de salud, `EnvioBloqueado`.
        `permitir_salud` (solo el modo General del chat) deja pasar la mención
        de salud, nunca nombres ni datos de contacto."""
        motivos = []
        sin_alias = re.sub(r"Persona [A-Z]+", "", texto)
        if any(
            re.search(p, sin_alias, flags=re.IGNORECASE) for p in [*self._completos, *self._partes]
        ):
            motivos.append("nombre de persona")
        if _CORREO.search(texto):
            motivos.append("correo")
        if _IDENTIFICACION.search(texto):
            motivos.append("identificación")
        if _TELEFONO.search(texto):
            motivos.append("teléfono")
        if not permitir_salud and contiene_salud(texto):
            motivos.append("dato de salud")
        if motivos:
            raise EnvioBloqueado(motivos)

    # ── Respuesta ───────────────────────────────────────────────────────────

    def reponer(self, valor):
        """Cambia cada seudónimo por el nombre real, en un texto o en toda una
        estructura."""
        if isinstance(valor, dict):
            return {clave: self.reponer(v) for clave, v in valor.items()}
        if isinstance(valor, (list, tuple)):
            return [self.reponer(v) for v in valor]
        if not isinstance(valor, str):
            return valor
        for alias in sorted(self._real_por_alias, key=len, reverse=True):
            letras = alias.split(" ", 1)[1]
            real = self._real_por_alias[alias]
            valor = re.sub(
                rf"(?<!\w)[Pp]ersona\s+{letras}(?![A-Za-z])", lambda _m, r=real: r, valor
            )
        return valor
