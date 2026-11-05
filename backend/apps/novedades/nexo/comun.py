"""Piezas comunes de las importaciones únicas desde Nexo.

Las usan `manage.py importar_nexo` (Novedades, en este paquete) y
`manage.py importar_nexo_tareas` (Tareas, en `apps.tasks.nexo`):

- Lectura: `Tabla`, `convertir` y `LectorSQL`, que solo ejecuta SELECT con SQL
  crudo sobre el alias `nexo` (además del router y del `solo_select` que la
  propia conexión instala).
- Escritura: `ImportadorBase` (cruce de usuarios por correo, inserción por
  lotes con recuperación de ids por clave natural, remapeo de referencias),
  `fechas_tal_cual`, `ambito`, `InformeBase` e `ImportacionAbortada`.
- Comando: `ruta_de_informe`, que impide dejar el CSV dentro del repositorio.
"""

import json
from collections import Counter, defaultdict
from collections.abc import Iterable
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import CommandError
from django.db import DatabaseError, connections
from django.db.models.functions import Lower

from config.db_routers import ALIAS_NEXO, solo_select

#: Filas por viaje al leer.
TAMANO_DE_LOTE = 2000
#: Parámetros por consulta `IN (...)` (SQL Server admite 2100).
MAXIMO_DE_PARAMETROS = 1000


class ErrorDeNexo(Exception):
    """No se pudo leer la base de Nexo (conexión, permisos o esquema)."""

    codigo = "nexo_no_disponible"


# ── Lectura ───────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Tabla:
    """Una tabla de Nexo y cómo convertir sus columnas."""

    nombre: str
    columnas: tuple[str, ...]
    fechas_hora: frozenset[str] = field(default_factory=frozenset)
    fechas: frozenset[str] = field(default_factory=frozenset)
    json: frozenset[str] = field(default_factory=frozenset)
    #: Columnas que son claves foráneas a `users_user`.
    usuarios: tuple[str, ...] = ()
    #: Filtro fijo (sin datos de entrada) y sus parámetros.
    filtro: str = ""
    parametros: tuple = ()


def f(*nombres: str) -> frozenset[str]:
    return frozenset(nombres)


def q(nombre: str) -> str:
    """Identificador entre corchetes. Solo se usa con nombres fijos del
    código, nunca con datos de entrada."""
    return "[" + nombre.replace("]", "]]") + "]"


def _a_utc(valor):
    if isinstance(valor, str):
        valor = datetime.fromisoformat(valor)
    if isinstance(valor, datetime) and valor.tzinfo is None:
        return valor.replace(tzinfo=UTC)
    return valor


def _a_fecha(valor):
    if isinstance(valor, str):
        return date.fromisoformat(valor[:10])
    if isinstance(valor, datetime):
        return valor.date()
    return valor


def _a_json(valor):
    if isinstance(valor, str):
        return json.loads(valor)
    return valor


def convertir(tabla: Tabla, fila: dict) -> dict:
    """Tipos de Python para una fila tal como la entrega el driver."""
    for nombre in tabla.fechas_hora:
        if fila.get(nombre) is not None:
            fila[nombre] = _a_utc(fila[nombre])
    for nombre in tabla.fechas:
        if fila.get(nombre) is not None:
            fila[nombre] = _a_fecha(fila[nombre])
    for nombre in tabla.json:
        if fila.get(nombre) is not None:
            fila[nombre] = _a_json(fila[nombre])
    return fila


def a_decimal(valor) -> Decimal:
    return Decimal(str(valor if valor is not None else 0))


class LectorSQL:
    """Lector real sobre `connections["nexo"]`, para el diccionario de tablas
    de cada importación (`tablas`). Cada consulta corre además dentro de
    `solo_select`, aunque la conexión ya lo tenga instalado."""

    tablas: dict[str, Tabla] = {}

    def __init__(self, alias: str = ALIAS_NEXO):
        if alias not in connections.databases:
            raise ErrorDeNexo(
                "La base de Nexo no está configurada: defina NEXO_DB_NAME y las demás "
                "variables NEXO_DB_* en el .env del backend."
            )
        self.conexion = connections[alias]

    def _select(self, sql: str, parametros: Iterable = ()) -> list[dict]:
        try:
            with self.conexion.execute_wrapper(solo_select), self.conexion.cursor() as cursor:
                cursor.execute(sql, list(parametros))
                columnas = [d[0] for d in cursor.description]
                filas = []
                while lote := cursor.fetchmany(TAMANO_DE_LOTE):
                    filas.extend(dict(zip(columnas, fila, strict=True)) for fila in lote)
                return filas
        except DatabaseError as exc:
            # Sin el texto del driver: puede incluir el servidor o el usuario.
            raise ErrorDeNexo(
                f"No se pudo leer la base de Nexo ({type(exc).__name__}). Revise la "
                "conexión, los permisos de lectura y que el esquema sea el esperado."
            ) from exc

    def filas(self, tabla: str) -> list[dict]:
        definicion = self.tablas[tabla]
        columnas = ", ".join(q(c) for c in definicion.columnas)
        sql = f"SELECT {columnas} FROM {q(definicion.nombre)}"  # noqa: S608 (nombres fijos)
        if definicion.filtro:
            sql += f" WHERE {definicion.filtro}"
        sql += " ORDER BY [id]"
        return [convertir(definicion, fila) for fila in self._select(sql, definicion.parametros)]

    def usuarios(self, ids: Iterable[int]) -> list[dict]:
        ids = sorted({int(i) for i in ids})
        resultado = []
        for inicio in range(0, len(ids), MAXIMO_DE_PARAMETROS):
            tramo = ids[inicio : inicio + MAXIMO_DE_PARAMETROS]
            marcas = ", ".join(["%s"] * len(tramo))
            resultado += self._select(
                f"SELECT [id], [username], [email] FROM [users_user] WHERE [id] IN ({marcas})",
                tramo,
            )
        return resultado

    def conteos(self) -> dict[str, int]:
        resultado = {}
        for clave, definicion in self.tablas.items():
            sql = f"SELECT COUNT(*) AS n FROM {q(definicion.nombre)}"  # noqa: S608
            if definicion.filtro:
                sql += f" WHERE {definicion.filtro}"
            resultado[clave] = int(self._select(sql, definicion.parametros)[0]["n"])
        return resultado


# ── Escritura ─────────────────────────────────────────────────────────────────


class ImportacionAbortada(Exception):
    """La importación no puede empezar: nada se escribió."""

    def __init__(self, mensaje: str, detalle: Iterable[str] = (), codigo: str = "abortada"):
        super().__init__(mensaje)
        self.mensaje = mensaje
        self.detalle = list(detalle)
        self.codigo = codigo


@dataclass
class InformeBase:
    aplicar: bool
    leidos: dict[str, int] = field(default_factory=dict)
    creados: dict[str, int] = field(default_factory=dict)
    usuarios_faltantes: list[str] = field(default_factory=list)
    verificacion: list[dict] = field(default_factory=list)
    #: Referencias que no se pudieron remapear (hacen fallar la verificación).
    problemas: list[str] = field(default_factory=list)
    #: Avisos que no invalidan la importación.
    avisos: list[str] = field(default_factory=list)
    confirmado: bool = False

    @property
    def cuadra(self) -> bool:
        return not self.problemas and all(v["ok"] for v in self.verificacion)

    def anotar(self, concepto, nexo, intranet):
        self.verificacion.append(
            {"concepto": concepto, "nexo": nexo, "intranet": intranet, "ok": nexo == intranet}
        )


@contextmanager
def fechas_tal_cual(modelos):
    """Desactiva `auto_now`/`auto_now_add` de esos modelos mientras dura el
    bloque, para que `bulk_create` guarde las fechas de Nexo en vez de la hora
    actual. Los campos de un modelo abstracto se copian en cada modelo
    concreto, así que solo se tocan los de estos. Se restauran siempre."""
    cambiados = []
    for modelo in modelos:
        for campo in modelo._meta.concrete_fields:
            if getattr(campo, "auto_now", False) or getattr(campo, "auto_now_add", False):
                cambiados.append((campo, campo.auto_now, campo.auto_now_add))
                campo.auto_now = campo.auto_now_add = False
    try:
        yield
    finally:
        for campo, auto_now, auto_now_add in cambiados:
            campo.auto_now, campo.auto_now_add = auto_now, auto_now_add


def ambito(modelo, empresa):
    """Filtro de lo que pertenece a la empresa, sea raíz o cuelgue de otro."""
    return modelo.objects.todas().filter(**{modelo.objects.ruta_de_empresa: empresa})


def normal(valor):
    """Sumas comparables: `None` y 0 son lo mismo; los decimales y los
    flotantes, a 2 cifras (un flotante, por su representación)."""
    if valor is None:
        return Decimal("0.00")
    if isinstance(valor, bool):
        return valor
    if isinstance(valor, int):
        return Decimal(valor)
    if isinstance(valor, float):
        valor = Decimal(repr(valor))
    if isinstance(valor, Decimal):
        return valor.quantize(Decimal("0.01"))
    return valor


class ImportadorBase:
    """Lo común a cada importación. La subclase define `modelos` (tabla lógica
    de Nexo → modelo de la intranet), `tablas` (las `Tabla` del lector) y el
    `Informe`, y calcula `usuarios_necesarios`/`usuarios_nexo` al leer."""

    modelos: dict[str, type] = {}
    tablas: dict[str, Tabla] = {}
    informe_class = InformeBase

    def __init__(self, lector, empresa, *, aplicar: bool = False):
        self.lector = lector
        self.empresa = empresa
        self.aplicar = aplicar
        self.informe = self.informe_class(aplicar=aplicar)
        #: tabla → {id de Nexo: id en la intranet}
        self.mapas: dict[str, dict[int, int]] = defaultdict(dict)
        self.usuarios: dict[int, int] = {}
        self.usuarios_necesarios: set[int] = set()
        self.usuarios_nexo: dict[int, dict] = {}

    def _usuarios_de_las_filas(self) -> set[int]:
        """Ids de usuario de Nexo que referencian las filas leídas."""
        necesarios = set()
        for tabla, filas in self.datos.items():
            columnas = self.tablas[tabla].usuarios
            for fila in filas:
                necesarios |= {fila[c] for c in columnas if fila.get(c) is not None}
        return necesarios

    def _cruzar_usuarios(self):
        """Usuario de Nexo → usuario de la intranet, por correo (sin distinguir
        mayúsculas). Aborta si falta alguno de los que referencia un registro.
        No crea cuentas."""
        correos = {
            uid: str(u.get("email") or "").strip().lower() for uid, u in self.usuarios_nexo.items()
        }
        por_correo = defaultdict(list)
        intranet = (
            get_user_model()
            .objects.annotate(correo=Lower("email"))
            .filter(correo__in={c for c in correos.values() if c})
            .values_list("correo", "id")
        )
        for correo, uid in intranet:
            por_correo[correo].append(uid)

        self.usuarios = {}
        faltantes = set()
        for uid in sorted(self.usuarios_necesarios | set(self.usuarios_nexo)):
            fila = self.usuarios_nexo.get(uid)
            correo = correos.get(uid, "")
            coincidencias = por_correo.get(correo, []) if correo else []
            if len(coincidencias) == 1:
                self.usuarios[uid] = coincidencias[0]
                continue
            if uid not in self.usuarios_necesarios:
                continue
            if fila is None:
                faltantes.add(f"(usuario #{uid} de Nexo: no existe en Nexo)")
            elif not correo:
                faltantes.add(f"(usuario «{fila.get('username')}» de Nexo: sin correo)")
            elif coincidencias:
                faltantes.add(f"{correo} (varias cuentas de la intranet con ese correo)")
            else:
                faltantes.add(correo)
        if faltantes:
            self.informe.usuarios_faltantes = sorted(faltantes)
            raise ImportacionAbortada(
                f"Faltan {len(faltantes)} usuarios en la intranet. Créelos (con el mismo correo "
                "que en Nexo) y vuelva a ejecutar; no se creó ni se cambió nada.",
                sorted(faltantes),
                codigo="usuarios_faltantes",
            )

    def _u(self, uid):
        return None if uid is None else self.usuarios[uid]

    def _insertar(
        self,
        tabla: str,
        pares: list[tuple[int, object]],
        clave: tuple[str, ...] | None = None,
    ):
        """Inserta por lotes y, si se da `clave` (atributos de la clave natural
        en la intranet), recupera el id nuevo de cada fila de Nexo.

        El backend de SQL Server no devuelve los ids de un `bulk_create`: se
        recuperan releyendo por la clave natural, y las filas cuya clave se
        repite se insertan una a una (eso sí devuelve el id)."""
        modelo = self.modelos[tabla]
        self.informe.creados[tabla] = self.informe.creados.get(tabla, 0) + len(pares)
        if not pares:
            return
        if clave is None:
            modelo.objects.bulk_create([obj for _, obj in pares])
            return

        def clave_de(obj):
            return tuple(getattr(obj, a) for a in clave)

        repeticiones = Counter(clave_de(obj) for _, obj in pares)
        en_lote = [(i, o) for i, o in pares if repeticiones[clave_de(o)] == 1]
        sueltos = [(i, o) for i, o in pares if repeticiones[clave_de(o)] > 1]
        modelo.objects.bulk_create([obj for _, obj in en_lote])
        for id_nexo, obj in sueltos:
            obj.save(force_insert=True)
            self.mapas[tabla][id_nexo] = obj.pk

        buscadas = {clave_de(o): i for i, o in en_lote}
        for fila in ambito(modelo, self.empresa).values_list("pk", *clave):
            id_nexo = buscadas.get(tuple(fila[1:]))
            if id_nexo is not None:
                self.mapas[tabla][id_nexo] = fila[0]
        perdidos = sum(1 for id_nexo, _ in pares if id_nexo not in self.mapas[tabla])
        if perdidos:
            self.informe.problemas.append(
                f"{tabla}: {perdidos} filas creadas sin poder recuperar su id."
            )

    def _id(self, tabla: str, id_nexo, *, requerido=True, contexto=""):
        if id_nexo is None:
            return None
        nuevo = self.mapas[tabla].get(id_nexo)
        if nuevo is None and requerido:
            self.informe.problemas.append(
                f"{contexto or tabla}: referencia a {tabla} #{id_nexo} de Nexo sin registro migrado."
            )
        return nuevo


# ── Comando ───────────────────────────────────────────────────────────────────


def ruta_de_informe(texto: str) -> Path:
    """La ruta del CSV, que nunca puede quedar dentro del repositorio: lleva
    nombres y correos, y el repositorio es público."""
    ruta = Path(texto).expanduser().resolve()
    repositorio = Path(settings.BASE_DIR).resolve().parent
    if ruta == repositorio or repositorio in ruta.parents:
        raise CommandError(
            f"El informe no puede guardarse dentro del repositorio ({repositorio}). "
            "Indique una ruta fuera de él."
        )
    if ruta.suffix.lower() != ".csv":
        raise CommandError("El informe tiene que ser un archivo .csv.")
    if not ruta.parent.is_dir():
        raise CommandError(f"No existe la carpeta del informe: {ruta.parent}")
    return ruta
