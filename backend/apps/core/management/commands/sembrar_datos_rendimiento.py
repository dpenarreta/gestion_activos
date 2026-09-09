"""Siembra un parque sintético para medir el rendimiento (§21).

El documento funcional dimensiona entre 5.000 y 10.000 activos, y hasta ahora
el sistema solo se había probado con decenas: los índices están puestos, pero
«están puestos» y «la pantalla abre rápido con 10.000 filas» son afirmaciones
distintas, y la segunda no se puede deducir de la primera.

**No se ejecuta contra la base de desarrollo.** Exige una base cuyo nombre
termine en `_perf` o el argumento `--forzar`: sembrar diez mil equipos falsos
sobre el inventario real lo dejaría inservible, y el borrado tampoco sería
trivial porque cada activo arrastra movimientos, mantenimientos y auditoría.

Los datos son deliberadamente heterogéneos —distintos estados, tipos, áreas,
ubicaciones, antigüedades y cantidades de intervenciones— porque un parque
uniforme mide mal: los filtros combinados que hay que medir son justamente los
que separan unos equipos de otros.
"""

import datetime
import random

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from apps.activos.models import Activo, MovimientoActivo, TipoDispositivo
from apps.mantenimientos.models import Mantenimiento
from apps.organizacion.models import Departamento, Empleado, Sede
from apps.politicas.models import PoliticaObsolescencia

TIPOS = [
    ("Laptop", "LAP"),
    ("Desktop", "DSK"),
    ("Monitor", "MON"),
    ("Impresora", "IMP"),
    ("Tablet", "TAB"),
    ("Celular", "CEL"),
    ("Servidor", "SRV"),
    ("Equipo de red", "NET"),
]

SEDES = ["Matriz Quito", "Sucursal Guayaquil", "Sucursal Cuenca", "Centro de datos"]
LUGARES = ["Bodega TI", "Piso 1", "Piso 2", "Piso 3", "Recepción", "Sala de servidores"]
AREAS = [
    ("Tecnología", "TI"),
    ("Contabilidad", "CTB"),
    ("Operaciones", "OPS"),
    ("Ventas", "VTA"),
    ("Recursos Humanos", "RRHH"),
    ("Gerencia", "GER"),
]

ESTADOS_POSIBLES = (
    [Activo.Estado.EN_USO] * 55
    + [Activo.Estado.EN_BODEGA] * 15
    + [Activo.Estado.DISPONIBLE] * 10
    + [Activo.Estado.EN_MANTENIMIENTO] * 7
    + [Activo.Estado.EN_GARANTIA] * 3
    + [Activo.Estado.EN_TRANSITO] * 2
    + [Activo.Estado.DADO_DE_BAJA] * 5
    + [Activo.Estado.PERDIDO] * 2
    + [Activo.Estado.ROBADO] * 1
)


class Command(BaseCommand):
    help = "Siembra activos sintéticos para medir el rendimiento del sistema."

    def add_arguments(self, parser):
        parser.add_argument("--activos", type=int, default=10000)
        parser.add_argument(
            "--semilla",
            type=int,
            default=20260909,
            help="Semilla del generador. Fija por defecto: dos corridas producen el mismo parque.",
        )
        parser.add_argument(
            "--forzar",
            action="store_true",
            help="Permite sembrar en una base que no termina en «_perf». Úselo con cuidado.",
        )

    def handle(self, *args, **opciones):
        nombre_base = connection.settings_dict["NAME"]
        if not nombre_base.endswith("_perf") and not opciones["forzar"]:
            raise CommandError(
                f"La base «{nombre_base}» no parece de pruebas. Sembrar aquí dejaría el "
                "inventario real mezclado con datos falsos. Use una base terminada en "
                "«_perf» o --forzar si sabe lo que hace."
            )

        random.seed(opciones["semilla"])
        total = opciones["activos"]
        hoy = timezone.localdate()

        self.stdout.write(f"Sembrando {total} activos en «{nombre_base}»…")

        departamentos = [
            Departamento.objects.get_or_create(codigo=codigo, defaults={"nombre": nombre})[0]
            for nombre, codigo in AREAS
        ]
        tipos = [
            TipoDispositivo.objects.get_or_create(codigo=codigo, defaults={"nombre": nombre})[0]
            for nombre, codigo in TIPOS
        ]
        sedes = [Sede.objects.get_or_create(nombre=nombre)[0] for nombre in SEDES]

        # Un custodio cada veinte equipos: repartir uno por activo daría una
        # tabla de empleados irreal y escondería el coste de los JOIN.
        # Políticas: sin ellas el motor de renovación no evalúa nada y la
        # medición sale optimista, porque justo el trabajo caro no se hace.
        PoliticaObsolescencia.objects.get_or_create(
            tipo_dispositivo=None,
            defaults={
                "nombre": "Política general",
                "vida_util_meses": 48,
                "vida_util_critica_meses": 60,
                "max_mantenimientos": 3,
                "ventana_mantenimientos_meses": 12,
                "max_componentes_criticos": 2,
            },
        )
        for tipo, vida, criticos in ((tipos[0], 36, 48), (tipos[6], 60, 84)):
            PoliticaObsolescencia.objects.get_or_create(
                tipo_dispositivo=tipo,
                defaults={
                    "nombre": f"Política de {tipo.nombre}",
                    "vida_util_meses": vida,
                    "vida_util_critica_meses": criticos,
                    "max_mantenimientos": 4,
                },
            )

        empleados = []
        for indice in range(max(total // 20, 25)):
            empleados.append(
                Empleado(
                    nombres=f"Nombre{indice}",
                    apellidos=f"Apellido{indice}",
                    codigo_empleado=f"EMP-P{indice:05d}",
                    departamento=random.choice(departamentos),
                )
            )
        # `ignore_conflicts` no existe en el backend de SQL Server: se filtra
        # antes lo que ya está, que además hace el comando repetible.
        existentes = set(
            Empleado.objects.filter(codigo_empleado__startswith="EMP-P").values_list(
                "codigo_empleado", flat=True
            )
        )
        Empleado.objects.bulk_create(
            [e for e in empleados if e.codigo_empleado not in existentes], batch_size=500
        )
        empleados = list(Empleado.objects.all())

        activos = []
        for indice in range(total):
            tipo = random.choice(tipos)
            estado = random.choice(ESTADOS_POSIBLES)
            # Antigüedades repartidas entre 1 y 96 meses: los filtros por
            # antigüedad y las políticas de renovación necesitan variedad para
            # que la medición signifique algo.
            dias = random.randint(30, 96 * 30)
            adquisicion = hoy - datetime.timedelta(days=dias)
            tiene_custodio = estado == Activo.Estado.EN_USO
            activos.append(
                Activo(
                    codigo_barras=f"GA-{tipo.codigo}-P{indice:06d}",
                    tipo=tipo,
                    nombre=f"{tipo.nombre} {indice:05d}",
                    marca=random.choice(["Dell", "HP", "Lenovo", "Apple", "Asus"]),
                    modelo=f"Modelo {random.randint(100, 999)}",
                    numero_serie=f"SN-PERF-{indice:06d}",
                    departamento=random.choice(departamentos),
                    custodio=random.choice(empleados) if tiene_custodio else None,
                    sede=random.choice(sedes),
                    estado=estado,
                    criticidad=random.choice([c.value for c in Activo.Criticidad]),
                    uso=random.choice([u.value for u in Activo.Uso]),
                    fecha_adquisicion=adquisicion,
                    fecha_ingreso=adquisicion + datetime.timedelta(days=random.randint(0, 60)),
                    costo_adquisicion=random.randint(200, 3000),
                    proveedor=random.choice(["Tecnomega", "Comptronix", "Siglo21", ""]),
                    # Un tercio sin garantía registrada: el panel distingue
                    # «sin registrar» de «vencida», y esa rama hay que medirla.
                    fecha_fin_garantia=(
                        adquisicion + datetime.timedelta(days=random.choice([365, 730, 1095]))
                        if random.random() > 0.33
                        else None
                    ),
                    especificaciones={"RAM": f"{random.choice([8, 16, 32])} GB"},
                )
            )

        with transaction.atomic():
            Activo.objects.bulk_create(activos, batch_size=500)
        creados = list(Activo.objects.filter(numero_serie__startswith="SN-PERF-"))
        self.stdout.write(f"  {len(creados)} activos creados.")

        # Historial: sin él, los reportes de movimientos y de reparaciones
        # medirían sobre tablas vacías, que es justo lo que no se quiere.
        movimientos = []
        for activo in creados:
            movimientos.append(
                MovimientoActivo(
                    activo=activo,
                    tipo=MovimientoActivo.Tipo.ALTA,
                    estado_nuevo=activo.estado,
                    departamento_nuevo=activo.departamento,
                    custodio_nuevo=activo.custodio,
                )
            )
            if activo.custodio_id and random.random() > 0.5:
                movimientos.append(
                    MovimientoActivo(
                        activo=activo,
                        tipo=MovimientoActivo.Tipo.ASIGNACION,
                        estado_anterior=Activo.Estado.EN_BODEGA,
                        estado_nuevo=Activo.Estado.EN_USO,
                        custodio_nuevo=activo.custodio,
                        departamento_nuevo=activo.departamento,
                        motivo="Entrega inicial",
                    )
                )
        MovimientoActivo.objects.bulk_create(movimientos, batch_size=500)
        self.stdout.write(f"  {len(movimientos)} movimientos creados.")

        mantenimientos = []
        for activo in creados:
            for _ in range(random.choices([0, 1, 2, 3, 5], weights=[45, 25, 15, 10, 5])[0]):
                ingreso = activo.fecha_adquisicion + datetime.timedelta(
                    days=random.randint(30, max((hoy - activo.fecha_adquisicion).days, 31))
                )
                if ingreso > hoy:
                    continue
                cerrado = random.random() > 0.1
                mantenimientos.append(
                    Mantenimiento(
                        activo=activo,
                        tipo=random.choice([t.value for t in Mantenimiento.Tipo]),
                        fecha_intervencion=ingreso,
                        fecha_salida=(
                            ingreso + datetime.timedelta(days=random.randint(1, 15))
                            if cerrado
                            else None
                        ),
                        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
                        responsable="Soporte TI",
                        causa=random.choice(["No enciende", "Lentitud", "Pantalla", "Teclado"]),
                        descripcion="Intervención de prueba de rendimiento.",
                        estado_final=Mantenimiento.EstadoFinal.REPARADO
                        if cerrado
                        else Mantenimiento.EstadoFinal.PENDIENTE,
                        costo_mano_obra=random.randint(10, 200),
                    )
                )
        Mantenimiento.objects.bulk_create(mantenimientos, batch_size=500)
        self.stdout.write(f"  {len(mantenimientos)} mantenimientos creados.")

        self.stdout.write(
            self.style.SUCCESS(
                f"Parque sintético listo: {len(creados)} activos, {len(movimientos)} movimientos "
                f"y {len(mantenimientos)} intervenciones."
            )
        )
