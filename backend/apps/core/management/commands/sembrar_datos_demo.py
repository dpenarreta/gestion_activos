"""Parque de demostración para recorrer el sistema antes de producción.

No es lo mismo que `sembrar_datos_rendimiento`: aquel llena diez mil equipos
sintéticos para medir tiempos, y este pone un inventario pequeño y verosímil
—con nombres, áreas, sedes y averías que se parecen a las reales— para ver cómo
se ve y cómo se comporta cada pantalla con datos dentro.

Siembra en **las dos empresas** a propósito. Con una sola no se ve lo que
importa de la separación: que al cambiar de empresa en el menú cambian el
inventario, los catálogos, el panel y los reportes, y que un rol dado en una no
vale en la otra.

Todo pasa por los servicios de negocio (`ActivoService`, `MantenimientoService`)
y no por el ORM directo: así los equipos quedan con su código de barras emitido,
su movimiento de alta y sus contadores de renovación calculados, que es lo que
se quiere mirar. Un `objects.create()` daría filas que ninguna pantalla
mostraría igual.

Es idempotente —vuelve a correrse sin duplicar— y reversible: `--eliminar`
borra lo sembrado y deja la base como estaba, que es lo que hay que hacer antes
de pasar a producción.

    python manage.py sembrar_datos_demo
    python manage.py sembrar_datos_demo --eliminar
"""

import datetime
import os
import secrets

from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.activos.models import Activo, MovimientoActivo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.adjuntos.models import Adjunto
from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.mantenimientos.models import CatalogoComponente, ComponenteUtilizado, Mantenimiento
from apps.mantenimientos.services import MantenimientoService
from apps.organizacion.models import Departamento, Empleado, Proveedor, Sede
from apps.users.models import User
from apps.users.nomenclatura import generar_username


def clave_demo() -> str:
    """La contraseña de las cuentas de demostración, nunca escrita en el código.

    Una clave fija aquí quedaría en el historial de Git para siempre, y estas
    son cuentas reales: dos de ellas administran una empresa. Se toma de
    `DEMO_PASSWORD` si el operador quiere una conocida, y si no se genera una al
    azar que se imprime **una vez** al terminar.

    Aun así nacen con cambio de contraseña obligatorio: quien entre por primera
    vez la sustituye, así que ni siquiera la que se imprimió sirve dos veces.
    """
    return os.environ.get("DEMO_PASSWORD") or f"{secrets.token_urlsafe(12)}.aA1"


#: Las cuentas que crea este comando, para que `verificar_despliegue` pueda
#: comprobar que ninguna sobrevivió al paso a producción.
def usuarios_demo() -> list[str]:
    from apps.users.nomenclatura import base_de_username

    return [
        base_de_username(nombres, apellidos)
        for plan in (COURIER, SEGURIDAD)
        for nombres, apellidos, *_ in plan["personas"]
    ]


#: Marca los catálogos de demostración para poder retirarlos después sin tocar
#: lo que se haya cargado de verdad mientras tanto. Va en campos de notas y no
#: en los que se leen en pantalla: un «[demo]» delante de cada trabajo
#: realizado ensucia justo lo que se quiere mirar. Los activos y sus
#: mantenimientos no lo necesitan —se identifican por su número de serie—.
MARCA = "[demo]"

#: Lo que sí se lee en pantalla, en el campo de notas del equipo.
NOTA = "Equipo del parque de demostración."

FECHA = datetime.date(2026, 9, 10)

#: Quién trabaja en las dos empresas y con qué rol en la segunda. Es soporte de
#: TI en LaarCourier —donde administra el inventario— y solo consulta en
#: LaarSeguridad: (usuario, empresa, rol).
PERSONA_COMPARTIDA = ("cmunozvera", "LaarSeguridad", "Consulta / Auditoría")


def _dia(dias_atras):
    return FECHA - datetime.timedelta(days=dias_atras)


# --- Qué se siembra en cada empresa -----------------------------------------
#
# Las tablas de activos y mantenimientos se leen como tablas: `fmt: off` evita
# que el formateador las despliegue en un campo por línea, que es correcto pero
# ilegible para comparar una fila con la siguiente.

COURIER = {
    "empresa": "LaarCourier",
    "sedes": [
        ("Matriz Quito", "Quito", "Av. Amazonas N32-14 y Naciones Unidas"),
        ("Sucursal Guayaquil", "Guayaquil", "Av. Francisco de Orellana 234"),
        ("Sucursal Cuenca", "Cuenca", "Av. Ordóñez Lasso 5-12"),
        ("Bodega Norte", "Quito", "Calderón, vía a Marianitas km 2"),
    ],
    "departamentos": [
        ("Tecnología", "TI"),
        ("Operaciones", "OPE"),
        ("Comercial", "COM"),
        ("Contabilidad", "CTB"),
        ("Talento Humano", "TTH"),
    ],
    "proveedores": [
        ("Tecnomega C.A.", "1791234567001", "Ventas corporativas", "022345678"),
        ("Comptronix S.A.", "1790987654001", "Mesa de servicio", "023456789"),
        ("Akros Cía. Ltda.", "1791122334001", "Cuenta corporativa", "024567890"),
        ("Siglo21 Soluciones", "0992233445001", "Soporte en sitio", "042345678"),
    ],
    "tipos": [("Laptop", "LAP"), ("Computador de escritorio", "PCE")],
    "componentes": [
        ("Disco sólido 480 GB", "SSD480", True),
        ("Memoria RAM 8 GB DDR4", "RAM8", True),
        ("Tarjeta madre", "MB", True),
        ("Fuente de poder 500 W", "PSU500", True),
        ("Pantalla LCD de 14 pulgadas", "LCD14", True),
        ("Batería de laptop", "BAT", False),
        ("Cargador 65 W", "CAR65", False),
        ("Teclado de repuesto", "TEC", False),
        ("Ventilador disipador", "VENT", False),
        ("Cable de red Cat 6", "CAT6", False),
    ],
    "personas": [
        ("María Fernanda", "Salazar Ruiz", "TI", "Jefa de Tecnología", "Administrador"),
        ("Carlos Andrés", "Muñoz Vera", "TI", "Analista de soporte", "Soporte TI"),
        ("Ana Lucía", "Ñacato Pérez", "OPE", "Supervisora de operaciones", "Supervisor TI"),
        ("Jorge", "Ramírez Cedeño", "CTB", "Contador general", "Consulta / Auditoría"),
        ("Paola", "Vásquez Ordóñez", "COM", "Ejecutiva comercial", "Soporte TI"),
        ("Luis Fernando", "Chalán Guamán", "TTH", "Analista de RR. HH.", "Consulta / Auditoría"),
    ],
    # fmt: off
    # tipo   nombre                   marca     modelo              serie            área   sede                  custodio  estado              criticidad  uso                 meses  costo  proveedor
    "activos": [
        ("LAP", "Laptop Jefatura TI",    "Dell",   "Latitude 5440",    "DL5440-0011",   "TI",  "Matriz Quito",       0,    "en_uso",           "alta",    "gerencial",        14, 1180, 0),
        ("LAP", "Laptop Soporte 1",      "HP",     "ProBook 450 G9",   "HP450-0027",    "TI",  "Matriz Quito",       1,    "en_uso",           "alta",    "administrativo",   20,  980, 1),
        ("LAP", "Laptop Operaciones QT", "Lenovo", "ThinkPad E14",     "LNE14-0043",    "OPE", "Matriz Quito",       2,    "en_uso",           "critica", "operativo",        31, 1050, 0),
        ("LAP", "Laptop Comercial GYE",  "HP",     "ProBook 440 G8",   "HP440-0058",    "COM", "Sucursal Guayaquil", 4,    "en_uso",           "media",   "atencion_cliente", 26,  890, 1),
        ("LAP", "Laptop Talento Humano", "Dell",   "Vostro 3520",      "DLV3520-0064",  "TTH", "Matriz Quito",       5,    "en_uso",           "baja",    "administrativo",    9,  760, 2),
        ("LAP", "Laptop de reserva",     "Lenovo", "ThinkPad L14",     "LNL14-0072",    "TI",  "Bodega Norte",       None, "disponible",       "media",   "bodega",            5, 1020, 0),
        ("PCE", "PC Contabilidad 1",     "HP",     "EliteDesk 800 G6", "HPED800-0080",  "CTB", "Matriz Quito",       3,    "en_uso",           "alta",    "administrativo",   40,  870, 1),
        ("PCE", "PC Ventanilla GYE",     "Dell",   "OptiPlex 3090",    "DLOP3090-0095", "COM", "Sucursal Guayaquil", None, "en_uso",           "media",   "atencion_cliente", 34,  810, 3),
        ("PCE", "PC Bodega Cuenca",      "Lenovo", "ThinkCentre M70q", "LNM70Q-0103",   "OPE", "Sucursal Cuenca",    None, "en_mantenimiento", "media",   "bodega",           47,  720, 2),
        ("PCE", "PC Recepción Matriz",   "HP",     "ProDesk 400 G7",   "HPPD400-0118",  "OPE", "Matriz Quito",       None, "en_bodega",        "baja",    "administrativo",   55,  690, 1),
    ],
    # activo  tipo          ingreso  fuera  externo  causa                       estado final    mano obra  repuestos
    "mantenimientos": [
        (8, "correctivo",  12, None,  True,  "No enciende",              "pendiente",    45, [("MB", 1, 210), ("PSU500", 1, 65)]),
        (2, "correctivo",  40, 3,     False, "Lentitud extrema",         "reparado",      0, [("SSD480", 1, 78), ("RAM8", 1, 42)]),
        (6, "correctivo",  75, 5,     True,  "Fuente quemada",           "reparado",     35, [("PSU500", 1, 65)]),
        (0, "preventivo",  90, 1,     False, "Mantenimiento semestral",  "reparado",      0, [("VENT", 1, 12)]),
        (1, "correctivo", 120, 4,     True,  "Pantalla rota",            "reparado",     40, [("LCD14", 1, 155)]),
        (3, "correctivo", 150, 2,     False, "Batería no carga",         "reparado",      0, [("BAT", 1, 88), ("CAR65", 1, 35)]),
        (2, "preventivo", 200, 1,     False, "Limpieza y actualización", "reparado",      0, []),
        (9, "correctivo", 260, 9,     True,  "Equipo sin video",         "no_reparable", 25, [("MB", 1, 210)]),
    ],
    # fmt: on
}

SEGURIDAD = {
    "empresa": "LaarSeguridad",
    "sedes": [
        ("Matriz Quito Seguridad", "Quito", "Av. Eloy Alfaro N40-15"),
        ("Base Guayaquil", "Guayaquil", "Km 8.5 vía Daule"),
    ],
    "departamentos": [
        ("Tecnología", "TI"),
        ("Central de Monitoreo", "MON"),
        ("Administración", "ADM"),
    ],
    "proveedores": [
        ("Hikvision Ecuador", "1793344556001", "Canal corporativo", "023344556"),
        ("Seguridad Total S.A.", "0993344556001", "Servicio técnico", "043344556"),
    ],
    "tipos": [("Laptop", "LAP"), ("Cámara de seguridad", "CAM")],
    "componentes": [
        ("Disco de videovigilancia 2 TB", "HDD2T", True),
        ("Fuente 12 V para cámara", "PSU12V", True),
        ("Lente de repuesto", "LENTE", False),
        ("Cable coaxial", "COAX", False),
    ],
    "personas": [
        ("Verónica", "Espín Toapanta", "TI", "Coordinadora de sistemas", "Administrador"),
        ("Ricardo", "Sánchez Yépez", "MON", "Operador de monitoreo", "Soporte TI"),
        ("Gabriela", "Loor Zambrano", "ADM", "Asistente administrativa", "Consulta / Auditoría"),
    ],
    # fmt: off
    "activos": [
        ("LAP", "Laptop Coordinación",     "Dell",      "Latitude 3540",  "DL3540-0201", "TI",  "Matriz Quito Seguridad", 0,    "en_uso",     "alta",    "administrativo",  11,  940, 0),
        ("LAP", "Laptop Monitoreo",        "HP",        "ProBook 445 G9", "HP445-0212",  "MON", "Matriz Quito Seguridad", 1,    "en_uso",     "critica", "operativo",       18, 1010, 0),
        ("CAM", "Cámara acceso principal", "Hikvision", "DS-2CD2143G2",   "HK2143-0301", "MON", "Matriz Quito Seguridad", None, "en_uso",     "critica", "infraestructura", 22,  210, 0),
        ("CAM", "Cámara bodega GYE",       "Hikvision", "DS-2CD1043G2",   "HK1043-0312", "MON", "Base Guayaquil",         None, "en_uso",     "alta",    "infraestructura", 29,  180, 1),
        ("CAM", "Cámara de reserva",       "Dahua",     "IPC-HDW2431",    "DH2431-0325", "TI",  "Matriz Quito Seguridad", None, "disponible", "media",   "bodega",           6,  165, 1),
    ],
    "mantenimientos": [
        (2, "correctivo",  20, 2, True,  "Imagen intermitente", "reparado", 30, [("PSU12V", 1, 18)]),
        (3, "preventivo",  60, 1, False, "Limpieza de lente",   "reparado",  0, [("LENTE", 1, 40)]),
        (1, "correctivo", 110, 6, False, "Disco lleno",         "reparado",  0, [("HDD2T", 1, 120)]),
    ],
    # fmt: on
}


class Command(BaseCommand):
    help = "Siembra (o retira) el parque de demostración de las dos empresas."

    def add_arguments(self, parser):
        parser.add_argument(
            "--eliminar",
            action="store_true",
            help="Retira lo sembrado en vez de crearlo. Úselo antes de pasar a producción.",
        )

    @transaction.atomic
    def handle(self, *args, **opciones):
        if opciones["eliminar"]:
            self._eliminar()
            return

        actor = User.objects.filter(is_superuser=True).order_by("id").first()
        self.clave = clave_demo()
        total = {}
        for plan in (COURIER, SEGURIDAD):
            empresa = Empresa.objects.filter(nombre=plan["empresa"]).first()
            if empresa is None:
                self.stdout.write(self.style.WARNING(f"No existe {plan['empresa']}; se omite."))
                continue
            with usando_empresa(empresa):
                total[empresa.nombre] = self._sembrar_empresa(plan, empresa, actor)

        self._persona_en_las_dos()
        self._resumen(total)

    def _persona_en_las_dos(self):
        """Una cuenta que trabaja en las dos empresas, con distinto rol en cada una.

        Es el caso que hay que poder mirar: con un solo rol por persona no se
        distingue «tiene acceso a las dos» de «puede lo mismo en las dos», y es
        justamente lo que separa administrar el inventario de una de solo
        consultarlo en la otra.
        """
        usuario = User.objects.filter(username=PERSONA_COMPARTIDA[0]).first()
        empresa = Empresa.objects.filter(nombre=PERSONA_COMPARTIDA[1]).first()
        if usuario is None or empresa is None:
            return
        self._dar_acceso(usuario, empresa, PERSONA_COMPARTIDA[2])

    # --- Siembra -----------------------------------------------------------

    def _sembrar_empresa(self, plan, empresa, actor):
        sedes = {
            nombre: Sede.objects.get_or_create(
                nombre=nombre, defaults={"ciudad": ciudad, "direccion": direccion}
            )[0]
            for nombre, ciudad, direccion in plan["sedes"]
        }
        departamentos = {
            codigo: Departamento.objects.get_or_create(
                codigo=codigo, defaults={"nombre": nombre, "descripcion": MARCA}
            )[0]
            for nombre, codigo in plan["departamentos"]
        }
        proveedores = [
            Proveedor.objects.get_or_create(
                nombre=nombre,
                defaults={
                    "identificacion": ruc,
                    "contacto": contacto,
                    "telefono": telefono,
                    "observaciones": MARCA,
                },
            )[0]
            for nombre, ruc, contacto, telefono in plan["proveedores"]
        ]
        tipos = {
            codigo: TipoDispositivo.objects.get_or_create(
                codigo=codigo, defaults={"nombre": nombre}
            )[0]
            for nombre, codigo in plan["tipos"]
        }
        componentes = {
            codigo: CatalogoComponente.objects.get_or_create(
                codigo=codigo,
                defaults={"nombre": nombre, "es_critico": critico, "descripcion": MARCA},
            )[0]
            for nombre, codigo, critico in plan["componentes"]
        }

        empleados = self._personas(plan, empresa, departamentos)
        activos = self._activos(plan, actor, tipos, departamentos, sedes, proveedores, empleados)
        mantenimientos = self._mantenimientos(plan, actor, activos, componentes)

        return {
            "sedes": len(sedes),
            "departamentos": len(departamentos),
            "proveedores": len(proveedores),
            "tipos": len(tipos),
            "componentes": len(componentes),
            "personas": len(empleados),
            "activos": len(activos),
            "mantenimientos": mantenimientos,
        }

    def _personas(self, plan, empresa, departamentos):
        """Cada persona es a la vez una cuenta y un empleado custodio.

        Son la misma persona y el sistema las guarda por separado —la cuenta
        entra al sistema, el empleado responde por un equipo—, así que se
        enlazan: si no, el inventario diría que el equipo es de «Carlos Muñoz»
        y la auditoría que lo movió `cmunozvera`, sin nada que los una.
        """
        empleados = []
        for nombres, apellidos, codigo_area, cargo, rol in plan["personas"]:
            empleado = Empleado.objects.filter(nombres=nombres, apellidos=apellidos).first()
            if empleado is None:
                usuario = User.objects.filter(first_name=nombres, last_name=apellidos).first()
                if usuario is None:
                    usuario = User.objects.create_user(
                        username=generar_username(nombres, apellidos),
                        email=f"{generar_username(nombres, apellidos)}@grupolaar.com",
                        password=self.clave,
                        first_name=nombres,
                        last_name=apellidos,
                    )
                    # Nacen obligadas a cambiarla: la clave se imprime en una
                    # consola, y una consola se comparte, se pega en un chat y
                    # se queda en el historial de la terminal.
                    usuario.must_change_password = True
                    usuario.save(update_fields=["must_change_password"])
                empleado = Empleado.objects.create(
                    nombres=nombres,
                    apellidos=apellidos,
                    correo=usuario.email,
                    cargo=cargo,
                    departamento=departamentos[codigo_area],
                    usuario=usuario,
                )
            self._dar_acceso(empleado.usuario, empresa, rol)
            empleados.append(empleado)
        return empleados

    def _dar_acceso(self, usuario, empresa, nombre_rol):
        if usuario is None:
            return
        membresia, _ = MembresiaEmpresa.objects.get_or_create(
            usuario=usuario,
            empresa=empresa,
            defaults={"es_predeterminada": not usuario.membresias.exists()},
        )
        rol = Group.objects.filter(name=nombre_rol).first()
        if rol is not None:
            membresia.roles.add(rol)

    def _activos(self, plan, actor, tipos, departamentos, sedes, proveedores, empleados):
        creados = []
        for fila in plan["activos"]:
            (
                tipo,
                nombre,
                marca,
                modelo,
                serie,
                area,
                sede,
                custodio,
                estado,
                criticidad,
                uso,
                meses,
                costo,
                proveedor,
            ) = fila
            existente = Activo.objects.filter(numero_serie=serie).first()
            if existente is not None:
                creados.append(existente)
                continue
            adquisicion = _dia(meses * 30)
            creados.append(
                ActivoService.crear_activo(
                    actor=actor,
                    tipo=tipos[tipo],
                    nombre=nombre,
                    marca=marca,
                    modelo=modelo,
                    numero_serie=serie,
                    departamento=departamentos[area],
                    sede=sedes[sede],
                    custodio=empleados[custodio] if custodio is not None else None,
                    estado=estado,
                    criticidad=criticidad,
                    uso=uso,
                    fecha_adquisicion=adquisicion,
                    # Dos años de garantía desde la compra: así conviven equipos
                    # en garantía, por vencer y vencidos sin inventar fechas.
                    fecha_fin_garantia=adquisicion + datetime.timedelta(days=730),
                    costo_adquisicion=costo,
                    proveedor=proveedores[proveedor],
                    observaciones=NOTA,
                )
            )
        return creados

    def _mantenimientos(self, plan, actor, activos, componentes):
        registrados = 0
        for fila in plan["mantenimientos"]:
            (
                indice,
                tipo,
                ingreso,
                fuera,
                externo,
                causa,
                estado,
                mano_obra,
                consumos,
            ) = fila
            activo = activos[indice]
            fecha_ingreso = _dia(ingreso)
            if Mantenimiento.objects.filter(
                activo=activo, fecha_intervencion=fecha_ingreso, causa=causa
            ).exists():
                continue
            MantenimientoService.registrar(
                actor=actor,
                activo=activo,
                tipo=tipo,
                fecha_intervencion=fecha_ingreso,
                fecha_salida=(
                    fecha_ingreso + datetime.timedelta(days=fuera) if fuera is not None else None
                ),
                tipo_responsable=(
                    Mantenimiento.TipoResponsable.PROVEEDOR_EXTERNO
                    if externo
                    else Mantenimiento.TipoResponsable.TECNICO_INTERNO
                ),
                responsable="Tecnomega C.A." if externo else "Técnico interno de TI",
                causa=causa,
                descripcion=f"{causa}: revisión, diagnóstico y trabajo en sitio.",
                diagnostico=f"Se confirma la causa reportada: {causa.lower()}.",
                solucion="Se reemplazan las piezas indicadas y se prueba el equipo.",
                estado_final=estado,
                costo_mano_obra=mano_obra,
                componentes=[
                    {
                        "componente": componentes[codigo],
                        "cantidad": cantidad,
                        "costo_unitario": costo,
                    }
                    for codigo, cantidad, costo in consumos
                ],
            )
            registrados += 1
        return registrados

    # --- Retirada ----------------------------------------------------------

    def _eliminar(self):
        """Deshace la siembra, de las hojas hacia la raíz.

        Se usa `todas()` en cada modelo porque un comando no corre dentro de
        ninguna empresa: aquí hay que ver —y retirar— lo de todas.
        """
        series = [fila[4] for plan in (COURIER, SEGURIDAD) for fila in plan["activos"]]
        activos = Activo.objects.todas().filter(numero_serie__in=series)
        mantenimientos = Mantenimiento.objects.todas().filter(activo__in=activos)

        ComponenteUtilizado.objects.todas().filter(mantenimiento__in=mantenimientos).delete()
        mantenimientos.delete()
        Adjunto.objects.todas().filter(activo__in=activos).delete()
        MovimientoActivo.objects.todas().filter(activo__in=activos).delete()
        activos.delete()

        nombres = [
            (nombres, apellidos)
            for plan in (COURIER, SEGURIDAD)
            for nombres, apellidos, *_ in plan["personas"]
        ]
        for nombre, apellido in nombres:
            Empleado.objects.todas().filter(nombres=nombre, apellidos=apellido).delete()
            User.objects.filter(first_name=nombre, last_name=apellido).delete()

        # Los catálogos se retiran solo si nadie más los usa: si mientras tanto
        # se cargó un equipo real en «Tecnología», el área ya dejó de ser de
        # demostración y borrarla se llevaría por delante ese equipo.
        CatalogoComponente.objects.todas().filter(descripcion=MARCA).delete()
        Departamento.objects.todas().filter(
            descripcion=MARCA, activos__isnull=True, empleados__isnull=True
        ).delete()
        Proveedor.objects.todas().filter(observaciones=MARCA, activos__isnull=True).delete()
        Sede.objects.todas().filter(
            nombre__in=[fila[0] for plan in (COURIER, SEGURIDAD) for fila in plan["sedes"]],
            activos__isnull=True,
        ).delete()
        TipoDispositivo.objects.todas().filter(
            codigo__in=[fila[1] for plan in (COURIER, SEGURIDAD) for fila in plan["tipos"]],
            activos__isnull=True,
        ).delete()

        self.stdout.write(self.style.SUCCESS("Datos de demostración retirados."))

    # --- Salida ------------------------------------------------------------

    def _resumen(self, total):
        for empresa, cifras in total.items():
            self.stdout.write(self.style.SUCCESS(f"\n{empresa}"))
            for etiqueta, cantidad in cifras.items():
                self.stdout.write(f"  {etiqueta:<15} {cantidad}")
        self.stdout.write(
            self.style.WARNING(
                f"\nClave de las cuentas nuevas (se pide cambiarla al entrar): {self.clave}"
                "\nNo vuelve a mostrarse. Para fijar una conocida: DEMO_PASSWORD=...\n"
                "\nPara retirarlo todo antes de producción: "
                "python manage.py sembrar_datos_demo --eliminar"
            )
        )
