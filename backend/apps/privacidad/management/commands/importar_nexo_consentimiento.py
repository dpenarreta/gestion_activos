"""Trae de Nexo los consentimientos de datos ya dados a una empresa de la
intranet, como constancia previa (versión «Nexo», con su fecha original).

    manage.py importar_nexo_consentimiento --empresa <id> [--aplicar] [--informe <ruta.csv>]
                                           [--excluir-usuario <correo> ...]

Sin `--aplicar` es un simulacro: hace todo dentro de una transacción, verifica
y lo deshace, pero imprime el resumen igual. La base de Nexo es la misma que
usan las demás importaciones (variables NEXO_DB_*) y solo se lee. Es
repetible: lo ya importado se salta. Las aceptaciones importadas NO cuentan
como aceptación del aviso vigente: cada persona lo acepta una vez al entrar
(ver `apps/privacidad/nexo/importador_consentimiento.py`).
"""

import csv
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError

from apps.empresas.models import Empresa
from apps.novedades.nexo.comun import ErrorDeNexo, ImportacionAbortada, ruta_de_informe
from apps.privacidad.nexo.importador_consentimiento import (
    NO_SE_MIGRA,
    ImportadorNexoConsentimiento,
    InformeConsentimiento,
)
from apps.privacidad.nexo.lector_consentimiento import LectorNexoConsentimientoSQL


class Command(BaseCommand):
    help = (
        "Importa los consentimientos de datos dados en Nexo como constancia previa "
        "(simulacro por defecto)."
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
            "--excluir-usuario",
            action="append",
            default=[],
            metavar="CORREO",
            help="Correo de Nexo cuyo consentimiento no se importa (repetible).",
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
            lector = opciones.get("lector") or LectorNexoConsentimientoSQL()
            importador = ImportadorNexoConsentimiento(
                lector, empresa, aplicar=opciones["aplicar"], excluir_usuarios=excluir
            )
            modo = "APLICAR" if opciones["aplicar"] else "SIMULACRO (no se guarda nada)"
            self.stdout.write(
                f"Consentimiento de datos de Nexo → «{empresa}» (id {empresa.pk}) — {modo}"
            )
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

    def _imprimir(self, informe: InformeConsentimiento):
        w = self.stdout.write
        w("\nResumen (leídos en Nexo → creados):")
        w(
            f"  aceptaciones {informe.leidos.get('aceptacion', 0):>8} → "
            f"{informe.creados.get('aceptacion', 0):>8}"
        )
        w(f"  Versiones del texto del aviso en Nexo: {informe.leidos.get('texto', 0)}")
        w(f"  Ya importadas antes (se saltan): {informe.ya_importadas}")
        w(f"  Sin fecha (no se importan): {informe.sin_fecha}")
        w(f"  Sin texto de Nexo vigente en su fecha (regía el de por defecto): {informe.sin_texto}")
        w(
            "  Se registran con la versión «Nexo» como constancia previa: cada persona "
            "acepta una vez el aviso vigente de la intranet."
        )
        w("No se migran:")
        for que, razon in NO_SE_MIGRA.items():
            w(f"  {que}: {razon}")
        if informe.usuarios_excluidos:
            w(f"Usuarios excluidos: {', '.join(informe.usuarios_excluidos)}")
            w(f"  aceptaciones excluidas: {informe.excluidas_por_usuario}")

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

    def _escribir_csv(self, ruta: Path | None, informe: InformeConsentimiento):
        if ruta is None:
            return
        with ruta.open("w", newline="", encoding="utf-8-sig") as archivo:
            csv_ = csv.writer(archivo)
            csv_.writerow(["seccion", "clave", "valor", "detalle", "extra"])
            csv_.writerow(
                [
                    "tabla",
                    "aceptacion",
                    informe.leidos.get("aceptacion", 0),
                    informe.creados.get("aceptacion", 0),
                    "",
                ]
            )
            csv_.writerow(["ya_importadas", "aceptacion", informe.ya_importadas, "", ""])
            csv_.writerow(["sin_fecha", "aceptacion", informe.sin_fecha, "", ""])
            csv_.writerow(["sin_texto", "aceptacion", informe.sin_texto, "", ""])
            for correo in informe.usuarios_excluidos:
                csv_.writerow(["usuario_excluido", correo, "", "", ""])
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
