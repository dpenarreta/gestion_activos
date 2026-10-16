"""El motor de las plantillas de correo: variables y secciones, nada más.

La sintaxis es un subconjunto de Mustache, la que entienden la mayoría de
herramientas de diseño de correo, para que un HTML hecho afuera se pueda pegar
y completar con variables sin aprender nada nuevo:

- `{{ nombre }}` — el valor de la variable, **escapado** como HTML.
- `{{#causa}} … {{/causa}}` — el bloque solo si la variable tiene valor.
- `{{^causa}} … {{/causa}}` — el bloque solo si la variable está vacía.

Por qué no el motor de plantillas de Django: una plantilla de Django escrita
desde la pantalla puede recorrer los objetos que recibe (`{{ user.password }}`,
relaciones, métodos). Aquí el contexto es un diccionario plano de textos ya
preparados —las variables que el catálogo declara para ese correo— y nada más
se puede leer. Las variables de tipo `html` (tablas ya armadas, como el detalle
del resumen de alertas) se insertan tal cual: las arma el sistema, nunca quien
edita la plantilla.
"""

import html
import re

#: Nombre de variable: letras, números y guion bajo.
_VARIABLE = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
#: Una sección sin otra sección dentro (se resuelven de adentro hacia afuera).
_SECCION = re.compile(
    r"\{\{\s*([#^])\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}"
    r"((?:(?!\{\{\s*[#^]).)*?)"
    r"\{\{\s*/\s*\2\s*\}\}",
    re.DOTALL,
)


def _tiene_valor(valor) -> bool:
    """Vacío, `None`, `False`, `0` y «0» cuentan como sin valor: «0 alertas»
    es justamente el caso en que no hay nada que listar."""
    if valor is None or valor is False:
        return False
    texto = str(valor).strip()
    return texto not in {"", "0"}


def variables_usadas(plantilla: str) -> set[str]:
    """Todas las variables que menciona una plantilla (en valores y secciones)."""
    nombres = set(_VARIABLE.findall(plantilla or ""))
    nombres |= {nombre for _, nombre, _ in _SECCION.findall(plantilla or "")}
    nombres |= set(re.findall(r"\{\{\s*/\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}", plantilla or ""))
    return nombres


def renderizar(
    plantilla: str, variables: dict, *, html_crudo: frozenset = frozenset(), escapar=True
) -> str:
    """Rellena la plantilla. Una variable que no existe queda vacía.

    `html_crudo`: las variables que se insertan sin escapar (bloques HTML que
    arma el sistema). `escapar=False` para el asunto, que es texto.
    """
    texto = plantilla or ""

    # Secciones, de la más interna a la más externa.
    while True:
        nuevo = _SECCION.sub(
            lambda m: (
                m.group(3)
                if (_tiene_valor(variables.get(m.group(2))) == (m.group(1) == "#"))
                else ""
            ),
            texto,
        )
        if nuevo == texto:
            break
        texto = nuevo

    def valor(m):
        nombre = m.group(1)
        contenido = variables.get(nombre)
        if contenido is None:
            return ""
        contenido = str(contenido)
        if not escapar or nombre in html_crudo:
            return contenido
        return html.escape(contenido)

    return _VARIABLE.sub(valor, texto)


def _enlace_en_texto(texto: str, direccion: str) -> str:
    """«Restablecer mi contraseña: https://…». La dirección va suelta, sin
    paréntesis ni signos pegados, para que el cliente de correo la reconozca
    entera como enlace."""
    if not texto or texto == direccion:
        return f" {direccion} "
    return f"{texto}: {direccion} "


def a_texto_plano(contenido_html: str) -> str:
    """La versión sin HTML, para los buzones que bloquean el HTML.

    Los enlaces conservan su dirección («Restablecer: https://…»): en texto
    plano es lo único que permite seguirlos, y en el correo de recuperar la
    contraseña es todo el mensaje.
    """
    texto = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", " ", contenido_html or "")
    texto = re.sub(
        r'(?is)<a\b[^>]*href="([^"]*)"[^>]*>(.*?)</a>',
        lambda m: _enlace_en_texto(re.sub(r"<[^>]+>", "", m.group(2)).strip(), m.group(1)),
        texto,
    )
    texto = re.sub(r"(?i)<br\s*/?>|</p>|</tr>|</h[1-6]>|</li>", "\n", texto)
    texto = re.sub(r"<[^>]+>", " ", texto)
    texto = html.unescape(texto)
    lineas = [re.sub(r"[ \t\r\f\v]+", " ", linea).strip() for linea in texto.split("\n")]
    salida, vacias = [], 0
    for linea in lineas:
        if linea:
            salida.append(linea)
            vacias = 0
        elif salida and vacias == 0:
            salida.append("")
            vacias = 1
    return "\n".join(salida).strip()
