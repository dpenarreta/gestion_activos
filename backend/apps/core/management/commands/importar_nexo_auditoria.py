"""Trae de Nexo la auditoría general (`core_auditlog`) a la auditoría de la
intranet, marcada como «Migrado de Nexo».

    manage.py importar_nexo_auditoria --empresa <id> [--aplicar] [--informe <ruta.csv>]

Sin `--aplicar` es un simulacro: hace todo dentro de una transacción, verifica
y lo deshace, pero imprime el resumen igual. Se puede repetir: lo ya importado
se salta (cada evento lleva su id de Nexo, único en la base). Las notificaciones
de Nexo no se importan (decisión del 09/11/2026).

La base de Nexo es la misma que usan las demás importaciones (variables
NEXO_DB_*) y solo se lee. Detalle en `apps/core/nexo/importador.py`.
"""

import csv
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError

from apps.core.modulos_auditoria import nombre
from apps.core.nexo.importador import (
    NO_SE_MIGRA,
    TABLAS,
    ImportadorNexoAuditoria,
    InformeAuditoria,
)
from apps.core.nexo.lector import LectorNexoAuditoriaSQL
from apps.empresas.models import Empresa
from apps.novedades.nexo.comun import ErrorDeNexo, ruta_de_informe


class Command(BaseCommand):
    help = "Importa la auditoría general desde la base de Nexo (simulacro por defecto)."
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

        try:
            lector = opciones.get("lector") or LectorNexoAuditoriaSQL()
            importador = ImportadorNexoAuditoria(lector, empresa, aplicar=opciones["aplicar"])
            modo = "APLICAR" if opciones["aplicar"] else "SIMULACRO (no se guarda nada)"
            self.stdout.write(f"Auditoría de Nexo → «{empresa}» (id {empresa.pk}) — {modo}")
            informe = importador.ejecutar()
        except ErrorDeNexo as exc:
            raise CommandError(str(exc)) from exc
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

    def _imprimir(self, informe: InformeAuditoria):
        w = self.stdout.write
        w("\nResumen por tabla (leídos en Nexo → creados):")
        for tabla in TABLAS:
            w(
                f"  {tabla:<10} {informe.leidos.get(tabla, 0):>8} → {informe.creados.get(tabla, 0):>8}"
            )
        if informe.por_modulo:
            w("Por módulo de la intranet:")
            for modulo, filas in informe.por_modulo.items():
                w(f"  {nombre(modulo)} ({modulo}): {filas}")
        w("No se migran:")
        for modelo, razon in NO_SE_MIGRA.items():
            w(f"  {modelo}: {razon}")
        for concepto, filas in informe.omitidas.items():
            w(f"  omitidas — {concepto}: {filas}")
        if informe.usuarios_faltantes:
            w(
                f"Personas de Nexo sin cuenta en la intranet: {len(informe.usuarios_faltantes)} "
                "(el detalle va en el informe CSV)."
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

    def _escribir_csv(self, ruta: Path | None, informe: InformeAuditoria):
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
            for modulo, filas in informe.por_modulo.items():
                csv_.writerow(["modulo", modulo, filas, nombre(modulo), ""])
            for concepto, filas in informe.omitidas.items():
                csv_.writerow(["omitidas", concepto, filas, "", ""])
            for correo in informe.usuarios_faltantes:
                csv_.writerow(["usuario_sin_cuenta", correo, "", "", ""])
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
