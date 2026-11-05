"""Trae de Nexo lo que queda de Gestión Humana (fase 2b) a una empresa de la
intranet: Proyectos (con su papelera y sus documentos), Ausencias y lo que
persiste el motor de KPI.

    manage.py importar_nexo_gh --empresa <id> [--aplicar] [--informe <ruta.csv>]

Sin `--aplicar` es un simulacro: hace todo dentro de una transacción (también
guarda los documentos, para probar el almacenamiento), verifica y lo deshace
todo, archivos incluidos; pero imprime el resumen igual. La base de Nexo es la
misma que usan `importar_nexo` e `importar_nexo_tareas` (variables NEXO_DB_*)
y solo se lee. Detalle del recorrido en `apps/projects/nexo/importador.py`.

Se llama `_gh` y no `_proyectos` porque trae tres módulos en una pasada.
"""

import csv
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError
from django.utils import timezone

from apps.ausencias.services import medical_retention_cutoff
from apps.empresas.models import Empresa
from apps.novedades.nexo.comun import ErrorDeNexo, ImportacionAbortada, ruta_de_informe
from apps.projects.nexo.importador import NO_SE_MIGRA, ImportadorNexoGH, InformeGH
from apps.projects.nexo.lector import TABLAS, LectorNexoGHSQL
from apps.tasks.business_time import business_calendar_day

_COLUMNAS_RECHAZO = (
    "id_nexo",
    "proyecto",
    "archivo",
    "extension",
    "mime",
    "bytes",
    "subido_por",
    "fecha",
    "motivo",
    "sha256",
)


class Command(BaseCommand):
    help = "Importa Proyectos, Ausencias y KPI desde la base de Nexo (simulacro por defecto)."
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
            lector = opciones.get("lector") or LectorNexoGHSQL(
                corte_medico=medical_retention_cutoff(business_calendar_day(timezone.now()))
            )
            importador = ImportadorNexoGH(lector, empresa, aplicar=opciones["aplicar"])
            modo = "APLICAR" if opciones["aplicar"] else "SIMULACRO (no se guarda nada)"
            self.stdout.write(
                f"Proyectos, Ausencias y KPI de Nexo → «{empresa}» (id {empresa.pk}) — {modo}"
            )
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
        except OSError as exc:
            raise CommandError(
                f"No se pudo escribir un documento en el almacenamiento ({type(exc).__name__}). "
                "Revise MEDIA_ROOT y sus permisos. Se deshizo todo y se borraron los archivos "
                "escritos."
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

    def _imprimir(self, informe: InformeGH):
        w = self.stdout.write
        w("\nResumen por tabla (leídos en Nexo → creados):")
        for tabla in TABLAS:
            w(
                f"  {tabla:<24} {informe.leidos.get(tabla, 0):>8} → {informe.creados.get(tabla, 0):>8}"
            )
        w("No se migran:")
        for modelo, razon in NO_SE_MIGRA.items():
            w(f"  {modelo}: {razon}")

        vencidos = informe.medicos_vencidos or {}
        corte = informe.corte_medico.isoformat() if informe.corte_medico else "?"
        w(
            f"\nPermisos médicos anteriores al {corte} (retención de 5 años), no importados: "
            f"{vencidos.get('registros', 0)}"
            + (
                f" (del {vencidos['desde']} al {vencidos['hasta']})"
                if vencidos.get("registros") and vencidos.get("desde")
                else ""
            )
        )

        rechazados = informe.documentos_rechazados
        w(f"Documentos NO importados (para que decida Talento Humano): {len(rechazados)}")
        for doc in rechazados:
            w(
                self.style.WARNING(
                    f"  #{doc['id_nexo']} «{doc['archivo']}» del proyecto «{doc['proyecto']}» "
                    f"({doc['bytes']} bytes): {doc['motivo']}"
                )
            )
        if informe.kpi_omitidos:
            w(f"Fecha de inicio del KPI omitida (sin cuenta): {len(informe.kpi_omitidos)}")
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

    def _escribir_csv(self, ruta: Path | None, informe: InformeGH):
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
            vencidos = informe.medicos_vencidos or {}
            # Solo el agregado: ni personas ni observaciones (LOPDP).
            csv_.writerow(
                [
                    "medicos_vencidos",
                    informe.corte_medico.isoformat() if informe.corte_medico else "",
                    vencidos.get("registros", 0),
                    vencidos.get("desde") or "",
                    vencidos.get("hasta") or "",
                ]
            )
            for doc in informe.documentos_rechazados:
                csv_.writerow(
                    [
                        "documento_rechazado",
                        doc["id_nexo"],
                        doc["archivo"],
                        doc["proyecto"],
                        "; ".join(
                            f"{c}={doc[c]}"
                            for c in _COLUMNAS_RECHAZO
                            if c not in ("id_nexo", "archivo", "proyecto")
                        ),
                    ]
                )
            for correo in informe.kpi_omitidos:
                csv_.writerow(["kpi_omitido", correo, "", "", ""])
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
