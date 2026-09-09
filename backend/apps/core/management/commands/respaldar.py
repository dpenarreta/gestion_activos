"""Copia de seguridad de la base y de los adjuntos (§21, «Disponibilidad»).

Dos cosas hay que respaldar, y solo una es la base de datos: los **adjuntos**
—facturas, actas firmadas, evidencias fotográficas— viven en el sistema de
archivos y no se regeneran. Un respaldo que solo lleve la base deja el
inventario intacto y todos sus papeles perdidos, que es la mitad de lo que el
§18 pedía conservar.

Sobre dónde queda el `.bak`: quien escribe ese archivo no es este comando sino
**el propio SQL Server**, en su sistema de archivos. Con la base en un
contenedor, eso significa dentro del contenedor: el comando lo dice y muestra
cómo sacarlo, porque un respaldo que vive en el mismo sitio que la base no
protege del caso que más importa —perder la máquina—.

Cada respaldo lleva un **manifiesto** con lo que había dentro (activos,
adjuntos, movimientos). Sirve para lo que casi nadie hace y es lo único que
convierte un archivo en un respaldo de verdad: comprobar, después de restaurar,
que está todo.
"""

import datetime
import json
import shutil
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.utils import timezone

#: Dónde escribe SQL Server dentro de su propio sistema de archivos. En la
#: imagen oficial es un directorio del volumen de datos, así que sobrevive al
#: reinicio del contenedor pero **no** a que se pierda la máquina.
RUTA_SERVIDOR_POR_DEFECTO = "/var/opt/mssql/backup"


def _validar_ruta(ruta: str) -> None:
    """Rechaza rutas que no puedan ir literales dentro de la sentencia.

    La escribe el operador que ejecuta el comando, no un usuario del sistema,
    pero va embebida en SQL: una comilla o un salto de línea la convertirían en
    otra cosa, y el respaldo es justo la operación donde no se quieren
    sorpresas.
    """
    if any(caracter in ruta for caracter in ("'", ";", "\n", "\r")):
        raise CommandError(
            f"La ruta de respaldo {ruta!r} contiene caracteres no admitidos "
            "(comillas, punto y coma o saltos de linea)."
        )


class Command(BaseCommand):
    help = "Respalda la base de datos y los adjuntos, con un manifiesto para verificar."

    def add_arguments(self, parser):
        parser.add_argument(
            "--destino",
            default="respaldos",
            help="Directorio local donde se guardan los adjuntos y el manifiesto.",
        )
        parser.add_argument(
            "--ruta-servidor",
            default=RUTA_SERVIDOR_POR_DEFECTO,
            help=(
                "Directorio donde SQL Server escribe el .bak, visto por el propio "
                "servidor. En producción conviene que sea un volumen montado fuera."
            ),
        )
        parser.add_argument(
            "--solo-adjuntos",
            action="store_true",
            help="Omite la base de datos. Para cuando el .bak lo gestiona el DBA.",
        )

    def handle(self, *args, **opciones):
        marca = timezone.localtime().strftime("%Y%m%d-%H%M")
        destino = Path(opciones["destino"]).resolve()
        destino.mkdir(parents=True, exist_ok=True)

        manifiesto = {
            "generado": timezone.localtime().isoformat(timespec="seconds"),
            "base_de_datos": connection.settings_dict["NAME"],
            "contenido": self._inventario_de_la_base(),
        }

        if not opciones["solo_adjuntos"]:
            manifiesto["base"] = self._respaldar_base(marca, opciones["ruta_servidor"])

        manifiesto["adjuntos"] = self._respaldar_adjuntos(destino, marca)

        ruta_manifiesto = destino / f"manifiesto-{marca}.json"
        ruta_manifiesto.write_text(
            json.dumps(manifiesto, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        self.stdout.write(self.style.SUCCESS(f"\nRespaldo {marca} completado."))
        self.stdout.write(f"  Manifiesto: {ruta_manifiesto}")
        self.stdout.write(
            "\nCompruebe la restauracion en una base aparte antes de confiar en el: "
            "un respaldo que nunca se restauro no es un respaldo "
            "(ver docs/respaldos.md)."
        )

    # --- Base de datos ---

    def _respaldar_base(self, marca: str, ruta_servidor: str) -> dict:
        nombre_base = connection.settings_dict["NAME"]
        archivo = f"{ruta_servidor.rstrip('/')}/{nombre_base}-{marca}.bak"

        _validar_ruta(archivo)

        self.stdout.write(f"Respaldando la base «{nombre_base}»...")
        with connection.cursor() as cursor:
            try:
                # La ruta va **literal**, no como parámetro: SQL Server no
                # admite parámetros en `TO DISK`, y con uno la sentencia no
                # escribe nada *y no lanza ningún error* — el comando informaba
                # de un respaldo completado que no existía. Por eso la ruta se
                # valida antes (`_validar_ruta`) en lugar de confiarla al driver.
                #
                # `INIT` sobrescribe el conjunto de medios en vez de anexar: sin
                # él, cada respaldo se acumula dentro del mismo archivo y este
                # crece sin que nadie lo note hasta que llena el disco.
                cursor.execute(
                    f"BACKUP DATABASE [{nombre_base}] TO DISK = '{archivo}' "
                    f"WITH INIT, FORMAT, NAME = 'Respaldo {nombre_base} {marca}'"
                )
                # El progreso llega como conjuntos de resultados: hay que
                # consumirlos para que la orden termine de verdad.
                while cursor.nextset():
                    pass
            except Exception as error:  # noqa: BLE001
                raise CommandError(
                    f"SQL Server no pudo escribir el respaldo en {archivo!r}: {error}\n"
                    "Compruebe que el directorio existe y que el servidor puede escribir "
                    "en el (dentro del contenedor, si la base corre en Docker)."
                ) from error

        tamano = self._verificar(archivo)
        self.stdout.write(
            self.style.SUCCESS(
                f"  Base respaldada y verificada: {archivo} ({tamano / 1024 / 1024:.1f} MB)"
            )
        )
        self.stdout.write(
            "  Ese archivo esta en el sistema de archivos del servidor. Para sacarlo:\n"
            f"    docker cp <contenedor>:{archivo} ."
        )
        return {"archivo_en_el_servidor": archivo, "bytes": tamano}

    def _verificar(self, archivo: str) -> int:
        """Comprueba que el respaldo existe y es legible; devuelve su tamaño.

        Sin esta comprobación, un respaldo que no llegó a escribirse se informa
        como correcto — que es exactamente lo que ocurría cuando la ruta iba
        como parámetro. Un respaldo que nadie verifica se descubre roto el día
        que hace falta, que es el peor momento posible.
        """
        with connection.cursor() as cursor:
            try:
                cursor.execute(f"RESTORE VERIFYONLY FROM DISK = '{archivo}'")
                while cursor.nextset():
                    pass
            except Exception as error:  # noqa: BLE001
                raise CommandError(
                    f"El respaldo {archivo!r} no se pudo verificar: {error}\n"
                    "No lo dé por bueno: puede no haberse escrito o estar truncado."
                ) from error

            cursor.execute(
                "SELECT TOP 1 b.backup_size FROM msdb.dbo.backupset b "
                "JOIN msdb.dbo.backupmediafamily f ON b.media_set_id = f.media_set_id "
                "WHERE f.physical_device_name = %s ORDER BY b.backup_finish_date DESC",
                [archivo],
            )
            fila = cursor.fetchone()
        return int(fila[0]) if fila and fila[0] else 0

    # --- Adjuntos ---

    def _respaldar_adjuntos(self, destino: Path, marca: str) -> dict:
        media = Path(getattr(settings, "MEDIA_ROOT", "") or "")
        if not media.exists():
            self.stdout.write("No hay directorio de adjuntos que respaldar.")
            return {"archivos": 0}

        archivos = [ruta for ruta in media.rglob("*") if ruta.is_file()]
        if not archivos:
            self.stdout.write("El directorio de adjuntos esta vacio.")
            return {"archivos": 0}

        self.stdout.write(f"Empaquetando {len(archivos)} adjunto(s)...")
        base_paquete = destino / f"adjuntos-{marca}"
        paquete = Path(shutil.make_archive(str(base_paquete), "gztar", root_dir=media))

        tamano = paquete.stat().st_size
        self.stdout.write(
            self.style.SUCCESS(f"  Adjuntos en {paquete.name} ({tamano / 1024:.0f} KB)")
        )
        return {
            "archivo": paquete.name,
            "archivos": len(archivos),
            "bytes": tamano,
        }

    # --- Qué había dentro ---

    def _inventario_de_la_base(self) -> dict:
        """Conteos con los que verificar una restauración.

        Restaurar sin comparar contra algo es confiar en que el archivo estaba
        completo. Estos números son ese algo.
        """
        from apps.activos.models import Activo, MovimientoActivo
        from apps.adjuntos.models import Adjunto
        from apps.mantenimientos.models import Mantenimiento
        from apps.organizacion.models import Empleado
        from apps.users.models import User

        return {
            "activos": Activo.objects.count(),
            "movimientos": MovimientoActivo.objects.count(),
            "mantenimientos": Mantenimiento.objects.count(),
            "adjuntos": Adjunto.objects.count(),
            "empleados": Empleado.objects.count(),
            "usuarios": User.objects.count(),
        }


def leer_manifiesto(ruta: Path) -> dict:
    """Carga un manifiesto de respaldo."""
    return json.loads(Path(ruta).read_text(encoding="utf-8"))


def comparar_con_la_base(manifiesto: dict) -> list[tuple[str, int, int]]:
    """Diferencias entre lo que decía el respaldo y lo que hay ahora.

    Devuelve `[(entidad, esperado, encontrado)]` solo con lo que no coincide.
    Es la comprobación que convierte una restauración en algo verificado: sin
    ella, un respaldo truncado se restaura sin ruido y el hueco se descubre
    meses después, cuando alguien busca un acta que no está.
    """
    from apps.activos.models import Activo, MovimientoActivo
    from apps.adjuntos.models import Adjunto
    from apps.mantenimientos.models import Mantenimiento
    from apps.organizacion.models import Empleado
    from apps.users.models import User

    actuales = {
        "activos": Activo.objects.count(),
        "movimientos": MovimientoActivo.objects.count(),
        "mantenimientos": Mantenimiento.objects.count(),
        "adjuntos": Adjunto.objects.count(),
        "empleados": Empleado.objects.count(),
        "usuarios": User.objects.count(),
    }
    esperado = manifiesto.get("contenido", {})
    return [
        (entidad, cantidad, actuales.get(entidad, 0))
        for entidad, cantidad in esperado.items()
        if actuales.get(entidad, 0) != cantidad
    ]


def fecha_del_ultimo_respaldo(directorio="respaldos") -> datetime.datetime | None:
    """Cuándo se hizo el último respaldo, según los manifiestos que haya.

    Lo usa `verificar_despliegue`: un sistema sin respaldo reciente no falla,
    simplemente no tiene de dónde volver.
    """
    carpeta = Path(directorio)
    if not carpeta.exists():
        return None
    manifiestos = sorted(carpeta.glob("manifiesto-*.json"))
    if not manifiestos:
        return None
    try:
        generado = leer_manifiesto(manifiestos[-1]).get("generado")
        return datetime.datetime.fromisoformat(generado) if generado else None
    except (ValueError, OSError, json.JSONDecodeError):
        return None
