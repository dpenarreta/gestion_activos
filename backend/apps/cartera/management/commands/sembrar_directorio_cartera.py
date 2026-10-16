"""`python manage.py sembrar_directorio_cartera --archivo "ruta.xlsx"`
(o `--desde-carga`, para sembrarlo con los datos que el dashboard ya tiene cargados)

Construye el "Dashboard Directorio" (4 KPI + gráfico de antigüedad + tabla de cumplimiento de metas
+ tabla de concentración) con datos reales de un archivo.

Existe como comando y no como parte del flujo normal de carga porque este dashboard es la excepción
declarada del proyecto: no usa las 13 posiciones de la plantilla genérica, así que el asistente de
"Cargar archivo → mapear columnas" no puede producirlo.

**Simula por defecto**: sin `--aplicar` informa qué calcularía sin escribir nada, igual que
`reprocesar_dashboards`.

`--desde-carga` existe para el caso de producción: ahí el dashboard no se alimenta de un Excel que
alguien sube, sino de una vista/procedimiento de la base, y el archivo de origen no está en el
servidor. Los datos se releen de la última carga procesada — la misma fuente que usa
`reprocesar_dashboards`—, así que sembrar y reprocesar parten exactamente del mismo dato.
"""

import uuid

import pandas as pd
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.cartera.models import CargaArchivo, Dashboard
from apps.cartera.services import carga_archivos, db_source, directorio_cartera, estructura
from apps.cartera.services.carga_archivos import HOJA_ARCHIVO_PERMANENTE
from apps.cartera.utils.archivos import asegurar_directorio
from apps.cartera.utils.dates import fecha_corte_por_defecto

DASHBOARD_POR_DEFECTO = 'directorio-cartera'
# El archivo de origen trae una fila de título sobre los encabezados reales, así que estos están en
# la segunda fila. Es configurable porque el próximo archivo podría no traerla.
FILA_ENCABEZADO_POR_DEFECTO = 2


class Command(BaseCommand):
    help = 'Construye el Dashboard Directorio con datos reales de un archivo Excel.'

    def add_arguments(self, parser):
        parser.add_argument('--archivo', help='Ruta del .xlsx de origen.')
        parser.add_argument(
            '--desde-carga', action='store_true',
            help='Lee los datos de la última carga procesada del dashboard, en vez de un .xlsx.',
        )
        parser.add_argument('--dashboard', default=DASHBOARD_POR_DEFECTO)
        parser.add_argument('--hoja', default=None, help='Hoja a leer (por defecto, la primera).')
        parser.add_argument(
            '--fila-encabezado', type=int, default=FILA_ENCABEZADO_POR_DEFECTO,
            help=f'Fila (1-based) con los encabezados. Por defecto {FILA_ENCABEZADO_POR_DEFECTO}.',
        )
        parser.add_argument('--fecha-corte', default=None, help='ISO (YYYY-MM-DD). Por defecto, el último día del mes anterior.')
        # Las columnas y el Top-N son PARÁMETROS, no constantes: quedan guardados en el `mapeo` de
        # cada sección y después se editan desde "Configurar componente → Datos" sin tocar código.
        parser.add_argument('--columna-valor', default=directorio_cartera.COLUMNA_VALOR)
        parser.add_argument('--columna-fecha', default=directorio_cartera.COLUMNA_FECHA)
        parser.add_argument('--columna-cliente', default=directorio_cartera.COLUMNA_CLIENTE)
        parser.add_argument(
            '--columna-ruc', default=directorio_cartera.COLUMNA_RUC,
            help='Columna con el identificador del cliente. Vacía ("") si el origen no la trae: '
                 'la consulta por cliente identifica entonces por nombre.',
        )
        parser.add_argument('--top-n', type=int, default=directorio_cartera.TOP_N)
        parser.add_argument('--aplicar', action='store_true', help='Escribe los cambios.')

    def handle(self, *args, **opciones):
        dashboard_id = opciones['dashboard']
        if bool(opciones['archivo']) == bool(opciones['desde_carga']):
            raise CommandError(
                'Elegí de dónde salen los datos: --archivo "ruta.xlsx" o --desde-carga, uno de los dos.'
            )

        carga = self._carga_vigente(dashboard_id) if opciones['desde_carga'] else None
        df = self._leer_de_carga(carga, dashboard_id) if carga is not None else self._leer(opciones)
        fecha_corte = self._fecha_corte(opciones, carga)

        columnas = {
            'columna_valor': opciones['columna_valor'], 'columna_fecha': opciones['columna_fecha'],
            'columna_cliente': opciones['columna_cliente'],
        }
        faltantes = directorio_cartera.columnas_faltantes(df, **columnas)
        if faltantes:
            raise CommandError(
                f'Al origen le faltan columnas que este dashboard necesita: {", ".join(faltantes)}. '
                f'Encontradas: {", ".join(map(str, df.columns[:12]))}…'
            )

        origen = f'Carga {carga.id}' if carga is not None else 'Archivo'
        self.stdout.write(f'{origen}: {len(df)} fila(s), {len(df.columns)} columna(s). Fecha de corte: {fecha_corte}.')

        columna_ruc = opciones['columna_ruc']
        if columna_ruc and columna_ruc not in df.columns:
            # No es un error: la consulta por cliente cae a identificar por nombre. Pero conviene
            # que quien siembra lo sepa, porque dos clientes homónimos se suman en una sola ficha.
            self.stdout.write(self.style.WARNING(
                f'  Aviso: el origen no trae la columna "{columna_ruc}". '
                f'La consulta por cliente identificará por nombre.'
            ))

        parametros = {**columnas, 'top_n': opciones['top_n'], 'columna_ruc': columna_ruc}

        if not opciones['aplicar']:
            self._simular(df, fecha_corte, parametros)
            return

        resultados = directorio_cartera.construir(dashboard_id, df, fecha_corte, **parametros)
        # Sembrar es la única operación que define legítimamente una estructura nueva. Si el
        # dashboard está bloqueado, la foto que se repone tiene que pasar a ser ÉSTA: si no, la
        # reposición devolvería el layout a la estructura anterior.
        if estructura.fijada_de(dashboard_id):
            estructura.fijar(dashboard_id)
            self.stdout.write('  Estructura fijada de nuevo (el dashboard está bloqueado).')
        if carga is None:
            self._registrar_carga(dashboard_id, df, fecha_corte)
        elif carga.fecha_corte != fecha_corte:
            # La carga que viene de una fuente de base puede no traer fecha de corte (la fecha es un
            # parámetro del procedimiento, no una columna). Se le graba la que se usó acá para que
            # `reprocesar_dashboards`, que la relee de la carga, no borre después el "Corte <mes>"
            # del informe ni recalcule la antigüedad contra la fecha de hoy.
            carga.fecha_corte = fecha_corte
            carga.save(update_fields=['fecha_corte'])
            self.stdout.write(f'  Fecha de corte grabada en la carga {carga.id}.')

        for component_id, calculado in resultados:
            estilo = self.style.SUCCESS if calculado else self.style.WARNING
            self.stdout.write(estilo(f'  {component_id}: {"calculado" if calculado else "SIN DATOS"}'))
        self.stdout.write(self.style.SUCCESS(f'Listo. {dashboard_id} reconstruido con datos reales.'))

    def _carga_vigente(self, dashboard_id):
        carga = (
            CargaArchivo.objects
            .filter(dashboard_id=dashboard_id, estado=CargaArchivo.Estado.PROCESADO)
            .order_by('-fecha_carga')
            .first()
        )
        if carga is None:
            raise CommandError(
                f'El dashboard "{dashboard_id}" no tiene ninguna carga procesada de la que leer los '
                f'datos. Cargá primero el archivo (o actualizá desde la fuente de base) y volvé a correr esto.'
            )
        return carga

    def _leer_de_carga(self, carga, dashboard_id):
        """El dataframe de la última carga procesada, leído igual que lo lee el reproceso."""
        try:
            _ruta, df = carga_archivos.leer_archivo_de_carga(carga)
        except Exception as exc:  # noqa: BLE001 - cualquier fallo de lectura deja la siembra sin datos
            raise CommandError(f'No se pudo leer el archivo de la carga {carga.id}: {exc}')
        dashboard = Dashboard.objects.filter(dashboard_id=dashboard_id).first()
        if dashboard is not None and dashboard.fuente_bd_ultimo_aliases:
            df = db_source.aplicar_alias_columnas(df, dashboard.fuente_bd_ultimo_aliases)
        df.columns = [str(columna).strip() for columna in df.columns]
        return df

    def _leer(self, opciones):
        ruta = opciones['archivo']
        try:
            libro = pd.ExcelFile(ruta)
        except Exception as exc:  # noqa: BLE001 - cualquier fallo de apertura es un archivo inválido
            raise CommandError(f'No se pudo abrir "{ruta}": {exc}')
        hoja = opciones['hoja'] or libro.sheet_names[0]
        df = pd.read_excel(ruta, sheet_name=hoja, header=opciones['fila_encabezado'] - 1)
        # Los encabezados de un Excel real llegan con espacios de sobra; el mapeo los compara literal.
        df.columns = [str(columna).strip() for columna in df.columns]
        return df

    def _fecha_corte(self, opciones, carga=None):
        """La explícita; si no, la de la carga que se está releyendo; si no, la del mes anterior.

        El orden importa: al sembrar desde una carga, su fecha de corte es la que corresponde a esos
        datos, y tomar en su lugar la del mes anterior calcularía la antigüedad contra otra fecha.
        """
        if not opciones['fecha_corte']:
            if carga is not None and carga.fecha_corte:
                return carga.fecha_corte
            return fecha_corte_por_defecto()
        from datetime import date
        try:
            return date.fromisoformat(opciones['fecha_corte'])
        except ValueError:
            raise CommandError(f'La fecha de corte "{opciones["fecha_corte"]}" no es una fecha ISO válida.')

    def _simular(self, df, fecha_corte, parametros):
        self.stdout.write(self.style.MIGRATE_HEADING('SIMULACIÓN (no se escribe nada)'))
        for spec, contenido in directorio_cartera.calcular_contenidos(df, fecha_corte, **parametros):
            self.stdout.write(f'  {spec["component_id"]}: {self._resumen(contenido)}')
        self.stdout.write('')
        self.stdout.write('Volvé a ejecutarlo con --aplicar para escribir los cambios.')

    @staticmethod
    def _resumen(contenido):
        if contenido is None:
            return 'SIN DATOS (revisá las columnas elegidas)'
        if 'valor' in contenido:
            return f'{contenido["valor"]:,.2f}'
        if 'categorias' in contenido:
            return ' · '.join(f'{c}={v:,.0f}' for c, v in zip(contenido['categorias'], contenido['valores']))
        if 'filas' in contenido:
            return f'{len(contenido["filas"])} fila(s)'
        return 'contenido calculado'

    def _registrar_carga(self, dashboard_id, df, fecha_corte):
        """Deja una `CargaArchivo` procesada con una copia normalizada del archivo.

        Sin esto el dashboard quedaría con datos pero sin rastro de su origen: no aparecería en
        "Histórico de cargas" ni habría de dónde releerlo para recalcular más adelante.
        """
        carga = CargaArchivo.objects.create(
            id=uuid.uuid4(), dashboard_id=dashboard_id,
            nombre_original='Dashboard Directorio (carga inicial).xlsx',
            estado=CargaArchivo.Estado.PROCESADO, fecha_corte=fecha_corte,
            total_filas_excel=len(df), filas_validas=len(df),
        )
        nombre = f'{carga.id}.xlsx'
        ruta = asegurar_directorio(settings.CARTERA_ARCHIVOS_DIR) / nombre
        # Se guarda YA normalizado (encabezados en la primera fila): quien lo relea después no tiene
        # que volver a adivinar dónde empezaban.
        df.to_excel(ruta, index=False, sheet_name=HOJA_ARCHIVO_PERMANENTE)
        carga.archivo_permanente_nombre = nombre
        carga.save(update_fields=['archivo_permanente_nombre'])
        self.stdout.write(f'  carga registrada: {carga.id}')
