"""Trae de Nexo el Escritorio Digital (las notas con sus respuestas, los
recordatorios y la bitácora, con los adjuntos como archivos) a una empresa de
la intranet.

    manage.py importar_nexo_escritorio --empresa <id> [--aplicar] [--informe <ruta.csv>]
                                       [--excluir-usuario <correo> ...]

Conviene correrlo después de `importar_nexo_tareas`: los recordatorios que se
convirtieron en tarea buscan su tarea entre las importadas.

Sin `--aplicar` es un simulacro: hace todo dentro de una transacción, verifica
y lo deshace (y borra los archivos que escribió), pero imprime el resumen igual.
La base de Nexo es la misma que usan las demás importaciones (variables
NEXO_DB_*) y solo se lee. Detalle del recorrido en
`apps/escritorio/nexo/importador.py`.
"""

import csv
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError

from apps.empresas.models import Empresa
from apps.escritorio.nexo.importador import (
    NO_SE_MIGRA,
    ImportadorNexoEscritorio,
    InformeEscritorio,
)
from apps.escritorio.nexo.lector import TABLAS, LectorNexoEscritorioSQL
from apps.novedades.nexo.comun import ErrorDeNexo, ImportacionAbortada, ruta_de_informe


class Command(BaseCommand):
    help = "Importa el Escritorio Digital desde la base de Nexo (simulacro por defecto)."
    #: Las pruebas inyectan un lector en memoria: `call_command(..., lector=...)`.
    stealth_options = ("lector",)

    def add_arguments(self, parser):
        parser.add_argument("--empresa", type=int, required=True, help="Id de la empresa destino.")
        parser.add_argument(
            "--aplicar",
            action="store_true",
            help="Confirma la importación. Sin esto es un simulacro que no deja nada.",
        )
        parser.add_argument(
            "--informe", help="Ruta de un CSV con el informe (fuera del repositorio)."
        )
        parser.add_argument(
            "--excluir-usuario",
            action="append",
            default=[],
            metavar="CORREO",
            help=(
                "Correo de Nexo cuyas notas (mandadas o recibidas), recordatorios y bitácora no "
                "se importan (repetible)."
            ),
        )

    def handle(self, *args, **opciones):
        ruta = ruta_de_informe(opciones["informe"]) if opciones.get("informe") else None
        excluir = [c.strip().lower() for c in opciones.get("excluir_usuario") or []]
        if any("@" not in c for c in excluir):
            raise CommandError("--excluir-usuario espera un correo.")
        empresa = Empresa.objects.filter(pk=opciones["empresa"]).first()
        if empresa is None:
            raise CommandError(f"No existe la empresa con id {opciones['empresa']}.")

        importador = None
        try:
            lector = opciones.get("lector") or LectorNexoEscritorioSQL()
            importador = ImportadorNexoEscritorio(
                lector, empresa, aplicar=opciones["aplicar"], excluir_usuarios=excluir
            )
            modo = "APLICAR" if opciones["aplicar"] else "SIMULACRO (no se guarda nada)"
            self.stdout.write(f"Escritorio de Nexo → «{empresa}» (id {empresa.pk}) — {modo}")
            informe = importador.ejecutar()
        except ErrorDeNexo as exc:
            raise CommandError(str(exc)) from exc
        except ImportacionAbortada as exc:
            if importador is not None:
                self._escribir_csv(ruta, importador.informe)
            detalle = "\n".join(f"  - {linea}" for linea in exc.detalle)
            raise CommandError(f"{exc.mensaje}\n{detalle}".rstrip()) from exc
        except DatabaseError as exc:
            raise CommandError(
                f"Falló la escritura en la intranet ({type(exc).__name__}). "
                "Se deshizo todo; no quedó nada a medias."
            ) from exc

        self._imprimir(informe)
        self._escribir_csv(ruta, informe)
        if not informe.cuadra:
            raise CommandError(
                "La verificación NO cuadra"
                + (": se deshizo todo, no se guardó nada." if opciones["aplicar"] else ".")
            )
        if informe.confirmado:
            self.stdout.write(self.style.SUCCESS("Importación confirmada."))
        else:
            self.stdout.write(
                self.style.WARNING("Simulacro: todo cuadra, pero no se guardó nada. Use --aplicar.")
            )

    def _imprimir(self, informe: InformeEscritorio):
        w = self.stdout.write
        w("\nResumen por tabla (leídos en Nexo → creados):")
        for tabla in TABLAS:
            w(
                f"  {tabla:<10} {informe.leidos.get(tabla, 0):>8} → {informe.creados.get(tabla, 0):>8}"
            )
        w("No se migran:")
        for modelo, razon in NO_SE_MIGRA.items():
            w(f"  {modelo}: {razon}")
        for concepto, filas in informe.omitidas.items():
            w(f"  omitidas — {concepto}: {filas}")
        if informe.usuarios_excluidos:
            w(f"Usuarios excluidos: {', '.join(informe.usuarios_excluidos)}")
            for tabla, filas in informe.excluidas_por_usuario.items():
                w(f"  excluidas por usuario — {tabla}: {filas}")
        for rechazo in informe.adjuntos_rechazados:
            w(
                f"  Adjunto no importado — {rechazo['tabla']} #{rechazo['id_nexo']} "
                f"«{rechazo['archivo']}»: {rechazo['motivo']}"
            )

        fallidas = [v for v in informe.verificacion if not v["ok"]]
        w(
            f"\nVerificación: {len(informe.verificacion) - len(fallidas)} de "
            f"{len(informe.verificacion)} comprobaciones cuadran."
        )
        for v in fallidas:
            w(
                self.style.ERROR(
                    f"  NO CUADRA — {v['concepto']}: Nexo {v['nexo']} / intranet {v['intranet']}"
                )
            )
        for problema in informe.problemas:
            w(self.style.ERROR(f"  PROBLEMA — {problema}"))
        for aviso in informe.avisos:
            w(self.style.WARNING(f"  Aviso — {aviso}"))

    def _escribir_csv(self, ruta: Path | None, informe: InformeEscritorio):
        if ruta is None:
            return
        with ruta.open("w", newline="", encoding="utf-8-sig") as archivo:
            csv_ = csv.writer(archivo)
            csv_.writerow(["seccion", "clave", "valor", "detalle", "extra"])
            for tabla in TABLAS:
                csv_.writerow(
                    [
                        "tabla",
                        tabla,
                        informe.leidos.get(tabla, 0),
                        informe.creados.get(tabla, 0),
                        "",
                    ]
                )
            for concepto, filas in informe.omitidas.items():
                csv_.writerow(["omitidas", concepto, filas, "", ""])
            for correo in informe.usuarios_excluidos:
                csv_.writerow(["usuario_excluido", correo, "", "", ""])
            for tabla, filas in informe.excluidas_por_usuario.items():
                csv_.writerow(["excluidas_por_usuario", tabla, filas, "", ""])
            for rechazo in informe.adjuntos_rechazados:
                csv_.writerow(
                    [
                        "adjunto_rechazado",
                        f"{rechazo['tabla']} #{rechazo['id_nexo']}",
                        rechazo["archivo"],
                        f"{rechazo['bytes']} bytes — {rechazo['motivo']}",
                        rechazo["sha256"],
                    ]
                )
            for correo in informe.usuarios_faltantes:
                csv_.writerow(["usuario_faltante", correo, "", "", ""])
            for v in informe.verificacion:
                csv_.writerow(
                    [
                        "verificacion",
                        v["concepto"],
                        v["nexo"],
                        v["intranet"],
                        "ok" if v["ok"] else "NO CUADRA",
                    ]
                )
            for problema in informe.problemas:
                csv_.writerow(["problema", problema, "", "", ""])
            for aviso in informe.avisos:
                csv_.writerow(["aviso", aviso, "", "", ""])
        self.stdout.write(f"Informe CSV: {ruta}")
