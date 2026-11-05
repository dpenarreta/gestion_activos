"""Trae Tareas (Gestión Humana) de Nexo a una empresa de la intranet.

    manage.py importar_nexo_tareas --empresa <id> [--aplicar] [--informe <ruta.csv>]

Sin `--aplicar` es un simulacro: hace todo dentro de una transacción, verifica
y la deshace, pero imprime el resumen igual. La base de Nexo es la misma que
usa `importar_nexo` (variables NEXO_DB_*) y solo se lee. Detalle del recorrido
en `apps/tasks/nexo/importador.py`.
"""

import csv
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError

from apps.empresas.models import Empresa
from apps.novedades.nexo.comun import ErrorDeNexo, ImportacionAbortada, ruta_de_informe
from apps.tasks.nexo.importador import NO_SE_MIGRA, ImportadorNexoTareas, InformeTareas
from apps.tasks.nexo.lector import TABLAS, LectorNexoTareasSQL


class Command(BaseCommand):
    help = "Importa Tareas desde la base de Nexo (simulacro por defecto)."
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

    def handle(self, *args, **opciones):
        ruta = ruta_de_informe(opciones["informe"]) if opciones.get("informe") else None
        empresa = Empresa.objects.filter(pk=opciones["empresa"]).first()
        if empresa is None:
            raise CommandError(f"No existe la empresa con id {opciones['empresa']}.")

        importador = None
        try:
            lector = opciones.get("lector") or LectorNexoTareasSQL()
            importador = ImportadorNexoTareas(lector, empresa, aplicar=opciones["aplicar"])
            modo = "APLICAR" if opciones["aplicar"] else "SIMULACRO (no se guarda nada)"
            self.stdout.write(f"Tareas de Nexo → «{empresa}» (id {empresa.pk}) — {modo}")
            informe = importador.ejecutar()
        except ErrorDeNexo as exc:
            raise CommandError(str(exc)) from exc
        except ImportacionAbortada as exc:
            self._escribir_csv(ruta, importador.informe)
            detalle = "\n".join(f"  - {linea}" for linea in exc.detalle)
            raise CommandError(f"{exc.mensaje}\n{detalle}".rstrip()) from exc
        except DatabaseError as exc:
            raise CommandError(
                f"Falló la escritura en la intranet ({type(exc).__name__}: {exc}). "
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

    # ── Salida ────────────────────────────────────────────────────────────────

    def _imprimir(self, informe: InformeTareas):
        w = self.stdout.write
        w("\nResumen por tabla (leídos en Nexo → creados):")
        for tabla in TABLAS:
            w(
                f"  {tabla:<24} {informe.leidos.get(tabla, 0):>8} → {informe.creados.get(tabla, 0):>8}"
            )
        w("No se migran:")
        for modelo, razon in NO_SE_MIGRA.items():
            w(f"  {modelo}: {razon}")

        w(
            f"\nMotivos que ya existían en la empresa (cruzados por clave): {len(informe.motivos_cruzados)}"
        )
        for fila in informe.motivos_cruzados:
            difiere = ", ".join(fila["diferencias"]) or "igual que en Nexo"
            w(f"  {fila['key']}  «{fila['label']}»  ({difiere})")
        renombrados = sum(informe.roles_renombrados.values())
        w(f"ADMINISTRADOR → «Administrador de Gestión Humana»: {renombrados} valores")
        for tabla, veces in sorted(informe.roles_renombrados.items()):
            w(f"  {tabla}: {veces}")

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

    def _escribir_csv(self, ruta: Path | None, informe: InformeTareas):
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
            for fila in informe.motivos_cruzados:
                csv_.writerow(
                    [
                        "motivo_cruzado",
                        fila["key"],
                        fila["label"],
                        ", ".join(fila["diferencias"]),
                        "",
                    ]
                )
            for tabla, veces in sorted(informe.roles_renombrados.items()):
                csv_.writerow(["rol_renombrado", tabla, veces, "", ""])
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
