"""Une los departamentos que ya existían con el organigrama (21/10/2026).

Se corre una vez al pasar a «el organigrama manda»
(`departamentos_del_organigrama.py`). Por cada empresa:

1. Enlaza cada departamento con la unidad del mismo nombre, o con la que se
   indique con `--equivale "Departamento=Unidad"`.
2. Los que no tienen unidad se crean en el organigrama, marcados «por ubicar»,
   para que quien administra la estructura los mueva a su lugar. Una empresa
   sin organigrama recibe un nivel «Área» y sus
   departamentos como unidades de ese nivel.
3. Toda unidad sin departamento recibe el suyo.

Nada pierde sus activos, empleados ni códigos: el departamento es el mismo
registro, solo pasa a obedecer a su unidad. Se puede repetir sin duplicar.

    python manage.py unir_departamentos_organigrama --equivale "Talento Humano=Gestión Humana y Seguridad Ocupacional"
    python manage.py unir_departamentos_organigrama --simular
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa
from apps.organizacion import departamentos_del_organigrama
from apps.organizacion.models import Departamento, NivelJerarquico, UnidadOrganizacional

POR_UBICAR = "Por ubicar: creada al unir los departamentos con el organigrama."


class _Simulacion(Exception):
    pass


def _donde_colgar(empresa):
    """La unidad bajo la que van los departamentos por ubicar y su nivel: se
    baja desde la raíz mientras haya una sola hija (Directorio → Gerencia
    General) y se usa el nivel siguiente."""
    unidades = UnidadOrganizacional.objects.todas().filter(empresa=empresa, activa=True)
    raiz = unidades.filter(padre=None).order_by("nivel__orden", "orden").first()
    if raiz is None:
        return None, None
    actual = raiz
    while True:
        hijas = list(unidades.filter(padre=actual))
        if len(hijas) != 1:
            break
        actual = hijas[0]
    nivel = (
        NivelJerarquico.objects.todas()
        .filter(empresa=empresa, orden__gt=actual.nivel.orden)
        .order_by("orden")
        .first()
    )
    if nivel is None:
        return actual.padre, actual.nivel
    return actual, nivel


class Command(BaseCommand):
    help = "Enlaza los departamentos existentes con las unidades del organigrama."

    def add_arguments(self, parser):
        parser.add_argument(
            "--equivale",
            action="append",
            default=[],
            help='"Nombre del departamento=Nombre de la unidad" (se puede repetir).',
        )
        parser.add_argument("--simular", action="store_true", help="Muestra y no guarda.")

    def handle(self, *args, **opciones):
        equivalencias = {}
        for par in opciones["equivale"]:
            depto, _, unidad = par.partition("=")
            equivalencias[depto.strip().lower()] = unidad.strip().lower()
        try:
            with transaction.atomic():
                for empresa in Empresa.objects.order_by("nombre"):
                    with usando_empresa(empresa):
                        self._empresa(empresa, equivalencias)
                if opciones["simular"]:
                    raise _Simulacion
        except _Simulacion:
            self.stdout.write(self.style.WARNING("Simulación: no se guardó nada."))

    def _empresa(self, empresa, equivalencias):
        unidades = UnidadOrganizacional.objects.todas().filter(empresa=empresa)
        departamentos = Departamento.objects.todas().filter(empresa=empresa)
        if not departamentos.exists() and not unidades.exists():
            return
        self.stdout.write(f"\n{empresa.nombre}")
        enlazados = set(unidades.exclude(departamento=None).values_list("departamento", flat=True))
        por_nombre = {u.nombre.strip().lower(): u for u in unidades.filter(departamento=None)}

        for depto in departamentos.exclude(pk__in=enlazados).order_by("nombre"):
            clave = depto.nombre.strip().lower()
            unidad = por_nombre.pop(equivalencias.get(clave, clave), None)
            if unidad is not None:
                unidad.departamento = depto
                unidad.save(update_fields=["departamento", "updated_at"])
                self.stdout.write(f"  enlazado: {depto.codigo} {depto.nombre} -> {unidad.nombre}")
                continue
            padre, nivel = _donde_colgar(empresa)
            if nivel is None:
                nivel = (
                    NivelJerarquico.objects.todas()
                    .filter(empresa=empresa)
                    .order_by("orden")
                    .first()
                )
            if nivel is None:
                nivel = NivelJerarquico.objects.create(empresa=empresa, nombre="Área", orden=1)
                self.stdout.write("  nivel creado: Área")
            unidad = UnidadOrganizacional.objects.create(
                empresa=empresa,
                nombre=depto.nombre,
                codigo=depto.codigo,
                nivel=nivel,
                padre=padre,
                departamento=depto,
                descripcion=POR_UBICAR,
                activa=depto.activo,
            )
            donde = f"bajo {padre.nombre}" if padre else "como unidad de primer nivel"
            self.stdout.write(f"  por ubicar: {depto.codigo} {depto.nombre} ({donde})")

        for unidad in unidades.select_related("departamento").order_by("nivel__orden", "orden"):
            tenia = unidad.departamento_id
            depto = departamentos_del_organigrama.sincronizar(unidad)
            if not tenia:
                self.stdout.write(f"  departamento creado: {depto.codigo} {depto.nombre}")
