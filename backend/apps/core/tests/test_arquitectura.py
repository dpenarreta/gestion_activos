"""Los siete criterios de arquitectura: AC-008, 009, 011, 012, 013, 014 y 015.

Estaban marcados «No» en la matriz por parecer verdades obvias —«el backend usa
Django», «el frontend usa React»—, y esa es exactamente la razón para fijarlos:
lo obvio es lo que nadie vuelve a comprobar. Ninguno describe un comportamiento
que se pueda ejercitar con una petición, pero todos son afirmaciones sobre la
estructura del repositorio, y eso sí se lee.

Lo que sostienen no es el presente sino los límites: que el backend no empiece
a servir la interfaz, que los estilos no se muden al JSX, que la lógica no se
escurra de los servicios a las vistas. Son barandas, y una baranda sin prueba
es una convención.
"""

import json
import pathlib
import re

import pytest

RAIZ = pathlib.Path(__file__).resolve().parents[4]
BACKEND = RAIZ / "backend"
FRONTEND = RAIZ / "frontend"


def _texto(ruta: pathlib.Path) -> str:
    try:
        return ruta.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return ""


@pytest.fixture(scope="module")
def manifiesto_frontend() -> dict:
    ruta = FRONTEND / "package.json"
    if not ruta.is_file():  # pragma: no cover
        pytest.skip("No hay package.json del frontend.")
    return json.loads(_texto(ruta))


# --- AC-008: dos proyectos, no uno ------------------------------------------


def test_backend_y_frontend_son_proyectos_independientes():
    """Cada uno con su gestor de dependencias. Es lo que permite desplegarlos
    por separado y lo que impide que una dependencia de la interfaz acabe
    condicionando al servidor."""
    assert (BACKEND / "manage.py").is_file()
    assert (BACKEND / "requirements").is_dir() or (BACKEND / "pyproject.toml").is_file()
    assert (FRONTEND / "package.json").is_file()

    # Y ninguno vive dentro del otro.
    assert not (BACKEND / "package.json").is_file()
    assert not (FRONTEND / "manage.py").is_file()


def test_el_backend_no_sirve_la_interfaz():
    """Ninguna plantilla de Django dibuja pantallas.

    Los correos tampoco usan plantillas de Django: desde el 16 de octubre de
    2026 viven en `apps.correos` (editables desde Configuración), así que
    `templates/` puede quedar vacío; si vuelve a haber algo, que sea de correo.

    Es la frontera que separa «API con cliente propio» de «Django sirviendo
    HTML»: el día que aparezca aquí una plantilla de interfaz, habrá dos sitios
    donde se dibuja lo mismo.
    """
    plantillas = [
        ruta.relative_to(BACKEND).as_posix() for ruta in (BACKEND / "templates").rglob("*.html")
    ]
    ajenas = [ruta for ruta in plantillas if not ruta.startswith("templates/emails/")]
    assert not ajenas, f"Plantillas fuera de correo: {ajenas}"


# --- AC-009: Python y Django ------------------------------------------------


def test_el_backend_usa_django():
    requisitos = "\n".join(
        _texto(ruta) for ruta in (BACKEND / "requirements").glob("*.txt")
    ).lower()
    assert re.search(r"^django[=<>~ ]", requisitos, re.MULTILINE), requisitos[:200]
    assert "djangorestframework" in requisitos


# --- AC-011: modelo, vista y una capa de servicios --------------------------

#: Las apps con pantalla propia. Las de infraestructura —`core`, `empresas`,
#: `branding`— no describen entidades del negocio.
APPS_DE_NEGOCIO = (
    "activos",
    "mantenimientos",
    "politicas",
    "organizacion",
    "ordenes",
    "soporte",
)

#: Y de esas, las que llevan **reglas**: dar de alta un activo emite su código
#: de barras y deja un movimiento; cerrar una reparación recalcula indicadores.
#: `organizacion` queda fuera a propósito —es un catálogo, y sus dos guardas
#: viven en el viewset—: exigirle una capa de servicios sería ceremonia.
APPS_CON_SERVICIOS = ("activos", "mantenimientos", "politicas", "ordenes", "soporte")


@pytest.mark.parametrize("app", APPS_DE_NEGOCIO)
def test_cada_app_separa_el_modelo_de_la_vista(app):
    carpeta = BACKEND / "apps" / app
    assert (carpeta / "models.py").is_file() or (carpeta / "models").is_dir()
    assert (carpeta / "views.py").is_file() or (carpeta / "views").is_dir()


@pytest.mark.parametrize("app", APPS_DE_NEGOCIO)
def test_cada_app_declara_sus_serializers(app):
    """En su propio módulo o dentro de las vistas —`politicas` hace lo segundo,
    y con cuatro serializers cortos es razonable—. Lo que se comprueba es que
    exista la capa, no dónde se escribió."""
    carpeta = BACKEND / "apps" / app
    propios = (carpeta / "serializers.py").is_file() or (carpeta / "serializers").is_dir()
    en_las_vistas = "Serializer" in _texto(carpeta / "views.py")
    assert propios or en_las_vistas


@pytest.mark.parametrize("app", APPS_CON_SERVICIOS)
def test_las_reglas_de_negocio_viven_en_su_capa(app):
    assert (
        BACKEND / "apps" / app / "services.py"
    ).is_file(), f"{app} no tiene capa de servicios: la lógica acabaría en las vistas."


def test_las_vistas_no_escriben_en_la_base_directamente():
    """La regla que el patrón existe para sostener: una vista que guarda por su
    cuenta se salta la auditoría y el movimiento del historial, que es lo que
    los servicios garantizan.

    Se miran las escrituras, no las lecturas: una vista consulta y pagina, y
    eso es su trabajo.
    """
    escritura = re.compile(r"\.objects\.(create|bulk_create|update|delete)\(")
    hallazgos = []
    for app in APPS_DE_NEGOCIO:
        vista = BACKEND / "apps" / app / "views.py"
        for numero, linea in enumerate(_texto(vista).splitlines(), start=1):
            if escritura.search(linea) and not linea.lstrip().startswith("#"):
                hallazgos.append(f"{app}/views.py:{numero}: {linea.strip()[:70]}")
    assert not hallazgos, "Escrituras fuera de la capa de servicios:\n" + "\n".join(hallazgos)


# --- AC-012, AC-013 y AC-014: React, Node y Bootstrap -----------------------


def test_el_frontend_usa_react(manifiesto_frontend):
    dependencias = manifiesto_frontend.get("dependencies", {})
    assert "react" in dependencias
    assert "react-dom" in dependencias


def test_node_administra_las_dependencias(manifiesto_frontend):
    """Con su archivo de bloqueo: sin él, dos instalaciones del mismo commit
    pueden traer versiones distintas."""
    assert manifiesto_frontend.get("scripts", {}).get("build")
    bloqueos = [
        nombre
        for nombre in ("package-lock.json", "pnpm-lock.yaml", "yarn.lock")
        if (FRONTEND / nombre).is_file()
    ]
    assert bloqueos, "No hay archivo de bloqueo de dependencias."


def test_bootstrap_es_el_framework_visual(manifiesto_frontend):
    dependencias = manifiesto_frontend.get("dependencies", {})
    assert "bootstrap" in dependencias

    # Y que no conviva con otro que haga lo mismo: dos frameworks visuales son
    # dos rejillas, dos escalas de espaciado y una pantalla que no se parece a
    # las demás según quién la escribió.
    rivales = {"tailwindcss", "@mui/material", "antd", "bulma", "foundation-sites"}
    assert not rivales & set(dependencias), f"Conviven dos frameworks: {dependencias}"


# --- AC-015: los estilos, en su archivo -------------------------------------


def test_ningun_componente_lleva_estilos_embebidos_extensos():
    """Un `style={{...}}` suelto para una anchura es razonable; una hoja de
    estilos dentro del JSX significa que ese componente ya no se puede
    retematizar desde el CSS, que es donde vive la identidad visual.
    """
    embebido = re.compile(r"style=\{\{(.+?)\}\}", re.DOTALL)
    hallazgos = []
    for ruta in (FRONTEND / "src").rglob("*.jsx"):
        for bloque in embebido.findall(_texto(ruta)):
            propiedades = [p for p in bloque.split(",") if ":" in p]
            if len(propiedades) > 3:
                hallazgos.append(
                    f"{ruta.relative_to(FRONTEND).as_posix()}: {len(propiedades)} propiedades"
                )
    assert not hallazgos, "Estilos embebidos extensos en el JSX:\n" + "\n".join(hallazgos)


def test_no_hay_hojas_de_estilo_dentro_del_jsx():
    """Una etiqueta `<style>` en un componente se salta el empaquetado y el
    ámbito del CSS: pasa a aplicarse a toda la aplicación desde el momento en
    que ese componente se monta."""
    hallazgos = [
        ruta.relative_to(FRONTEND).as_posix()
        for ruta in (FRONTEND / "src").rglob("*.jsx")
        if "<style" in _texto(ruta)
    ]
    assert not hallazgos, f"Hojas de estilo dentro del JSX: {hallazgos}"


def test_los_componentes_con_estilos_los_tienen_al_lado():
    """La convención del proyecto: `Componente/Componente.jsx` y su
    `Componente.css`. Se comprueba que se cumpla donde ya se usa, para que la
    siguiente carpeta la siga."""
    sueltos = []
    for hoja in (FRONTEND / "src" / "components").rglob("*.css"):
        hermano = hoja.with_suffix(".jsx")
        if not hermano.is_file():
            sueltos.append(hoja.relative_to(FRONTEND).as_posix())
    assert not sueltos, f"Hojas de estilo sin su componente al lado: {sueltos}"
