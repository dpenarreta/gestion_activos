"""Trae el Control Operativo de Novedades de Nexo a una empresa de la intranet.

    manage.py importar_nexo --empresa <id> [--aplicar] [--informe <ruta.csv>]
                            [--asignar-roles]

Sin `--aplicar` es un simulacro: hace todo dentro de una transacción, verifica
y la deshace, pero imprime el resumen igual. La base de Nexo se configura con
las variables NEXO_DB_* (ver `.env.example`) y solo se lee. Detalle del
recorrido en `apps/novedades/nexo/importador.py`.
"""

import csv
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError

from apps.empresas.models import Empresa
from apps.novedades.nexo.comun import ruta_de_informe
from apps.novedades.nexo.importador import (
    NO_SE_MIGRA,
    ImportacionAbortada,
    ImportadorNexo,
    Informe,
)
from apps.novedades.nexo.lector import TABLAS, ErrorDeNexo, LectorNexoSQL


class Command(BaseCommand):
    help = (
        "Importa el Control Operativo de Novedades desde la base de Nexo (simulacro por defecto)."
    )
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
            "--asignar-roles",
            action="store_true",
            help="Da los roles operativos de Nexo en la membresía de la empresa.",
        )

    def handle(self, *args, **opciones):
        ruta = ruta_de_informe(opciones["informe"]) if opciones.get("informe") else None
        empresa = Empresa.objects.filter(pk=opciones["empresa"]).first()
        if empresa is None:
            raise CommandError(f"No existe la empresa con id {opciones['empresa']}.")

        try:
            lector = opciones.get("lector") or LectorNexoSQL()
            importador = ImportadorNexo(
                lector,
                empresa,
                aplicar=opciones["aplicar"],
                asignar_roles=opciones["asignar_roles"],
            )
            modo = "APLICAR" if opciones["aplicar"] else "SIMULACRO (no se guarda nada)"
            self.stdout.write(f"Importación de Nexo → «{empresa}» (id {empresa.pk}) — {modo}")
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

    def _imprimir(self, informe: Informe):
        w = self.stdout.write
        w("\nResumen por tabla (leídos en Nexo → creados):")
        for tabla in TABLAS:
            w(
                f"  {tabla:<36} {informe.leidos.get(tabla, 0):>8} → {informe.creados.get(tabla, 0):>8}"
            )
        w("No se migran:")
        for modelo, razon in NO_SE_MIGRA.items():
            w(f"  {modelo}: {razon}")

        w(f"\nColaboradores enlazados a un Empleado por nombre: {len(informe.enlazados)}")
        for fila in informe.enlazados:
            w(
                f"  {fila['cedula']}  {fila['nombre']}  →  {fila['codigo_empleado']} ({fila['empleado']})"
            )
        w(f"Colaboradores SIN Empleado enlazado: {len(informe.sin_enlace)}")
        for fila in informe.sin_enlace:
            w(f"  {fila['cedula']}  {fila['nombre']}  ({fila['motivo']})")

        if informe.roles:
            w("\nRoles operativos:")
            for fila in informe.roles:
                w(f"  {fila['correo']}  {fila['rol']}: {fila['resultado']}")

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

    def _escribir_csv(self, ruta: Path | None, informe: Informe):
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
            for fila in informe.enlazados:
                csv_.writerow(
                    [
                        "enlazado_por_nombre",
                        fila["cedula"],
                        fila["nombre"],
                        fila["codigo_empleado"],
                        fila["empleado"],
                    ]
                )
            for fila in informe.sin_enlace:
                csv_.writerow(["sin_empleado", fila["cedula"], fila["nombre"], fila["motivo"], ""])
            for correo in informe.usuarios_faltantes:
                csv_.writerow(["usuario_faltante", correo, "", "", ""])
            for fila in informe.roles:
                csv_.writerow(["rol", fila["correo"], fila["rol"], fila["resultado"], ""])
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
