"""Higiene del repositorio: AC-025, AC-026 y AC-043.

Los tres estaban en la matriz de trazabilidad marcados «No» a secas, sin decir
siquiera por qué. No eran difíciles de automatizar: eran preguntas sobre el
contenido versionado, que es un dato al alcance de `git ls-files`.

Y son de los que conviene que una máquina vigile, porque **fallan por
acumulación**. Nadie versiona una contraseña a propósito: aparece el día que
alguien copia su `.env` para reproducir un fallo, o cuando una migración de
prueba se queda dentro. Revisarlo a mano funciona mientras alguien se acuerde.
"""

import pathlib
import re
import subprocess

import pytest

RAIZ = pathlib.Path(__file__).resolve().parents[4]

#: Lo que un valor de ejemplo puede decir. Cualquier otra cosa a la derecha de
#: un `=` en estas claves se trata como un secreto de verdad.
MARCADORES = re.compile(
    r"^(|<[^>]*>|\$\{[^}]*\}|cambi\w*|change-?me|your[-_].*|xxx+|\.\.\.|tu[-_].*|"
    r"clave[-_].*|password|secret|placeholder)$",
    re.IGNORECASE,
)

#: Las claves que no pueden llevar un valor real en nada versionado.
SENSIBLES = ("SECRET_KEY", "JWT_SECRET_KEY", "DB_PASSWORD", "EMAIL_HOST_PASSWORD")

#: Archivos donde un `SECRET_KEY = "algo"` es legítimo: la configuración de
#: pruebas necesita una clave cualquiera para que Django arranque, y ahí el
#: valor no protege nada.
EXENTOS = ("settings/testing.py", "settings/test.py", "conftest.py")


def _archivos_versionados() -> list[pathlib.Path]:
    salida = subprocess.run(
        ["git", "ls-files"],
        cwd=RAIZ,
        capture_output=True,
        text=True,
        check=True,
    )
    return [RAIZ / linea for linea in salida.stdout.splitlines() if linea]


@pytest.fixture(scope="module")
def versionados():
    try:
        archivos = _archivos_versionados()
    except (OSError, subprocess.CalledProcessError) as error:  # pragma: no cover
        pytest.skip(f"No se pudo consultar el índice de git: {error}")
    if not archivos:  # pragma: no cover
        pytest.skip("El índice de git vino vacío.")
    return archivos


def _texto(ruta: pathlib.Path) -> str:
    try:
        return ruta.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return ""


# --- AC-025: ningún secreto real versionado --------------------------------


def test_ningun_archivo_versionado_lleva_un_secreto_real(versionados):
    """Se mira el valor, no la palabra: `SECRET_KEY` aparece por todas partes
    —se lee del entorno, se documenta, se pone de ejemplo— y prohibir el nombre
    no diría nada. Lo que no puede haber es algo a la derecha del `=` que no
    sea un marcador de posición."""
    patron = re.compile(rf"^\s*(?:{'|'.join(SENSIBLES)})\s*[:=]\s*(.+?)\s*$", re.MULTILINE)
    hallazgos = []

    for ruta in versionados:
        relativa = ruta.relative_to(RAIZ).as_posix()
        if any(exento in relativa for exento in EXENTOS):
            continue
        for valor in patron.findall(_texto(ruta)):
            limpio = valor.strip().strip("\"'").strip()
            # Leerlo del entorno es justamente lo que hay que hacer.
            if limpio.startswith(("env.", "os.", "config(", "process.env")):
                continue
            if not MARCADORES.match(limpio):
                hallazgos.append(f"{relativa}: {valor[:60]}")

    assert not hallazgos, "Secretos con aspecto de reales en el repositorio:\n" + "\n".join(
        hallazgos
    )


def test_los_env_estan_excluidos_del_control_de_versiones(versionados):
    """La regla y el hecho, que son dos cosas distintas: `.gitignore` puede
    decir lo correcto y haber un `.env` añadido con `--force` desde antes."""
    reglas = _texto(RAIZ / ".gitignore")
    assert ".env" in reglas
    assert "!.env.example" in reglas, "El ejemplo tiene que quedar fuera de la exclusión."

    colados = [
        ruta.relative_to(RAIZ).as_posix()
        for ruta in versionados
        if ruta.name.startswith(".env") and not ruta.name.endswith(".example")
    ]
    assert not colados, f"Hay archivos .env versionados: {colados}"


# --- AC-026: ejemplos de entorno, y seguros --------------------------------


@pytest.mark.parametrize("carpeta", ["", "backend", "frontend"])
def test_existe_el_ejemplo_de_entorno(carpeta):
    ruta = RAIZ / carpeta / ".env.example" if carpeta else RAIZ / ".env.example"
    assert ruta.is_file(), f"Falta {ruta.relative_to(RAIZ).as_posix()}"


@pytest.mark.parametrize("carpeta", ["", "backend", "frontend"])
def test_el_ejemplo_solo_lleva_marcadores(carpeta):
    """Un ejemplo con un valor que funciona deja de ser un ejemplo: se copia
    tal cual y el sistema arranca con la clave que tiene medio mundo."""
    ruta = RAIZ / carpeta / ".env.example" if carpeta else RAIZ / ".env.example"
    reales = []
    for linea in _texto(ruta).splitlines():
        if linea.strip().startswith("#") or "=" not in linea:
            continue
        clave, _, valor = linea.partition("=")
        if clave.strip() in SENSIBLES and not MARCADORES.match(valor.strip().strip("\"'")):
            reales.append(linea.strip())
    assert not reales, f"Valores reales en {ruta.name}: {reales}"


# --- AC-043: ninguna migración siembra datos de producción -----------------

#: Lo que sí puede sembrar una migración: la identidad institucional, el
#: catálogo de permisos y la configuración por defecto. Son datos del sistema,
#: iguales en cualquier instalación.
MODELOS_PROHIBIDOS = ("User", "Empleado", "Activo", "Mantenimiento", "Adjunto")

#: `Usuario = apps.get_model("users", "User")`. Se guarda a qué modelo quedó
#: atado cada nombre, porque una migración puede **leer** empleados o activos
#: con toda legitimidad —la de responsables los recorre para traspasar la
#: custodia— y lo que no puede es crearlos. Mirar el archivo entero confundía
#: las dos cosas y señalaba a quien no debía.
_ATADURA = re.compile(
    r"""^\s*(\w+)\s*=\s*apps\.get_model\(\s*['"][\w.]+['"]\s*,\s*['"](\w+)['"]""",
    re.MULTILINE,
)


def _modelos_que_crea(contenido: str) -> set[str]:
    atados = dict(_ATADURA.findall(contenido))
    creados = set()
    for variable in re.findall(r"(\w+)\.objects\.(?:create|bulk_create)\(", contenido):
        if variable in atados:
            creados.add(atados[variable])
    return creados


def test_la_deteccion_distingue_leer_de_crear():
    """Recorrer un modelo no es sembrarlo, y una prueba que confunde las dos
    cosas se acaba desactivando por pesada."""
    lee = """
        Empleado = apps.get_model("organizacion", "Empleado")
        Relacion = Activo.responsables.through
        Relacion.objects.bulk_create([...])
    """
    siembra = """
        Usuario = apps.get_model("users", "User")
        Usuario.objects.create(username="admin")
    """

    assert _modelos_que_crea(lee) == set()
    assert _modelos_que_crea(siembra) == {"User"}


def test_ninguna_migracion_siembra_personas_ni_equipos(versionados):
    """La siembra de demostración existe —`sembrar_datos_demo`— y ese es su
    sitio: un comando que alguien decide correr. En una migración se ejecutaría
    sola, en producción, el día del despliegue."""
    hallazgos = []
    for ruta in versionados:
        relativa = ruta.relative_to(RAIZ).as_posix()
        if "/migrations/" not in relativa or not relativa.endswith(".py"):
            continue
        for modelo in sorted(_modelos_que_crea(_texto(ruta)) & set(MODELOS_PROHIBIDOS)):
            hallazgos.append(f"{relativa}: crea {modelo}")
    assert not hallazgos, "Migraciones que siembran datos de producción:\n" + "\n".join(hallazgos)


def test_ninguna_migracion_fija_una_contrasena(versionados):
    """Una contraseña escrita en una migración es la misma en todas las
    instalaciones y no caduca nunca."""
    hallazgos = [
        ruta.relative_to(RAIZ).as_posix()
        for ruta in versionados
        if "/migrations/" in ruta.as_posix()
        and re.search(r"set_password\(|make_password\(", _texto(ruta))
    ]
    assert not hallazgos, f"Migraciones que fijan contraseñas: {hallazgos}"
