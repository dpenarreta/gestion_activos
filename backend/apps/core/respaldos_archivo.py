"""Los respaldos que hay en disco: listarlos y borrarlos.

Un respaldo no es un archivo sino **varios con la misma marca de tiempo**
(`AAAAMMDD-HHMM`): el manifiesto y el paquete de adjuntos, que escribe el
comando en la carpeta de destino, y el `.bak` de la base, que escribe SQL
Server en *su* sistema de archivos. Se listan y se borran juntos: borrar el
`.bak` y dejar el manifiesto haría creer que hay de dónde volver.

El `.bak` solo se puede tocar si su carpeta está montada en esta máquina
(`RESPALDOS_SQL_LOCAL`; con Docker, la del volumen de `docker-compose.yml`).
Si no lo está, se lista lo demás y se dice que la copia de la base sigue en el
servidor: adivinar dónde la dejó SQL Server sería borrar a ciegas.

**El más reciente no se borra nunca.** Es el único que garantiza que hay de
dónde volver hoy, y la regla se aplica aquí, no solo en el botón de la
pantalla: una petición hecha a mano tampoco puede saltársela.
"""

import datetime
import json
import re
from pathlib import Path

from django.conf import settings
from django.utils import timezone

#: La marca que ponen el comando y SQL Server a los archivos de un respaldo.
FORMA_MARCA = re.compile(r"^\d{8}-\d{4}$")
_MARCA_EN_NOMBRE = re.compile(r"-(\d{8}-\d{4})\.(?:json|tar\.gz|bak)$")


class RespaldoNoEncontrado(Exception):
    pass


class RespaldoProtegido(Exception):
    """El más reciente: se conserva siempre."""


def carpeta_sql_local() -> Path | None:
    """Dónde ve esta máquina los `.bak` de SQL Server, si los ve."""
    valor = getattr(settings, "RESPALDOS_SQL_LOCAL", "") or ""
    if not valor:
        return None
    carpeta = Path(valor)
    if not carpeta.is_absolute():
        carpeta = Path(settings.BASE_DIR) / carpeta
    return carpeta if carpeta.is_dir() else None


def _carpeta_destino(destino: str) -> Path:
    carpeta = Path(destino)
    if not carpeta.is_absolute():
        carpeta = Path(settings.BASE_DIR) / carpeta
    return carpeta


def _archivos_por_marca(destino: Path, sql: Path | None) -> dict[str, list[Path]]:
    grupos: dict[str, list[Path]] = {}
    candidatos = []
    if destino.is_dir():
        candidatos += list(destino.glob("manifiesto-*.json"))
        candidatos += list(destino.glob("adjuntos-*.tar.gz"))
    if sql is not None:
        candidatos += list(sql.glob("*.bak"))
    for archivo in candidatos:
        coincide = _MARCA_EN_NOMBRE.search(archivo.name)
        if coincide and archivo.is_file():
            grupos.setdefault(coincide.group(1), []).append(archivo)
    return grupos


def _tipo(archivo: Path) -> str:
    if archivo.name.endswith(".bak"):
        return "base"
    if archivo.name.endswith(".tar.gz"):
        return "adjuntos"
    return "manifiesto"


def _fecha(marca: str) -> datetime.datetime:
    return timezone.make_aware(datetime.datetime.strptime(marca, "%Y%m%d-%H%M"))


def listar(destino: str) -> list[dict]:
    """Los respaldos en disco, del más reciente al más antiguo."""
    sql = carpeta_sql_local()
    grupos = _archivos_por_marca(_carpeta_destino(destino), sql)
    marcas = sorted(grupos, reverse=True)
    respaldos = []
    for posicion, marca in enumerate(marcas):
        archivos = sorted(grupos[marca], key=lambda ruta: ruta.name)
        contenido = None
        manifiesto = next((a for a in archivos if _tipo(a) == "manifiesto"), None)
        if manifiesto is not None:
            try:
                contenido = json.loads(manifiesto.read_text(encoding="utf-8")).get("contenido")
            except (OSError, ValueError):
                contenido = None
        tipos = {_tipo(a) for a in archivos}
        respaldos.append(
            {
                "marca": marca,
                "fecha": _fecha(marca).isoformat(),
                "archivos": [
                    {"nombre": a.name, "tipo": _tipo(a), "bytes": a.stat().st_size}
                    for a in archivos
                ],
                "bytes": sum(a.stat().st_size for a in archivos),
                "tiene_base": "base" in tipos,
                "tiene_adjuntos": "adjuntos" in tipos,
                "contenido": contenido,
                "es_el_mas_reciente": posicion == 0,
            }
        )
    return respaldos


def borrar(marca: str, destino: str) -> list[dict]:
    """Borra todos los archivos de un respaldo y devuelve cuáles eran.

    Rechaza la marca si no tiene la forma exacta —es lo que va a un `glob`, y
    nada que venga de una petición debe poder escribir comodines o rutas— y si
    es la del más reciente.
    """
    if not FORMA_MARCA.match(marca or ""):
        raise RespaldoNoEncontrado(marca)
    sql = carpeta_sql_local()
    grupos = _archivos_por_marca(_carpeta_destino(destino), sql)
    if marca not in grupos:
        raise RespaldoNoEncontrado(marca)
    if marca == max(grupos):
        raise RespaldoProtegido(marca)

    borrados = []
    for archivo in grupos[marca]:
        borrados.append(
            {"nombre": archivo.name, "tipo": _tipo(archivo), "bytes": archivo.stat().st_size}
        )
        archivo.unlink(missing_ok=True)
    return borrados
