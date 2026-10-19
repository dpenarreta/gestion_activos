"""Carga el catálogo de servicios TI del flujo ITIL (§6.4) en una empresa.

    python manage.py cargar_catalogo_ti --empresa LC

Crea las seis categorías y sus servicios con código, tipo, prioridad base,
nivel de entrada y, en las solicitudes, el tiempo de entrega. Se puede correr
de nuevo: actualiza lo que ya existe por su código y no borra nada.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa
from apps.organizacion.models import Departamento
from apps.soporte.models import CasoAyuda, Categoria, NivelSoporte

#: Un día hábil del horario por defecto de la mesa (08:00 a 17:30).
DIA = 570

INC, SOL, CON = "incidente", "solicitud", "consulta"
P1, P2, P3, P4 = "critica", "alta", "media", "baja"

#: (código, servicio, tipo, nivel de entrada, prioridad base, plazo de entrega en minutos)
CATALOGO = {
    "Sistema de tracking y guías": [
        (
            "TRK-01",
            "Falla general del sistema de tracking o de generación de guías",
            INC,
            2,
            P1,
            None,
        ),
        ("TRK-02", "Error en una guía, rastreo o estado de envío puntual", INC, 1, P3, None),
        ("TRK-03", "Falla en integración o API con clientes corporativos", INC, 2, P2, None),
        ("TRK-04", "Creación o modificación de usuario o perfil en tracking", SOL, 1, P3, DIA),
        ("TRK-05", "Solicitud de reporte o consulta de datos", SOL, 2, P3, 3 * DIA),
    ],
    "ERP y facturación electrónica": [
        (
            "ERP-01",
            "ERP no disponible o proceso crítico bloqueado (cierre, pagos)",
            INC,
            2,
            P1,
            None,
        ),
        (
            "ERP-02",
            "Error en emisión o autorización de comprobantes electrónicos (SRI)",
            INC,
            2,
            P2,
            None,
        ),
        ("ERP-03", "Error funcional puntual en un módulo del ERP", INC, 2, P3, None),
        ("ERP-04", "Creación de usuario o cambio de permisos en ERP", SOL, 2, P3, 2 * DIA),
        ("ERP-05", "Nuevo reporte o parametrización", SOL, 2, P4, None),
    ],
    "Correo electrónico y ofimática": [
        ("COR-01", "Caída general del correo", INC, 2, P1, None),
        ("COR-02", "Problema de correo u ofimática de un usuario", INC, 1, P3, None),
        ("COR-03", "Creación o baja de cuenta de correo y licencia", SOL, 1, P3, DIA),
        ("COR-04", "Listas de distribución, buzones compartidos o carpetas", SOL, 1, P3, 2 * DIA),
    ],
    "Dispositivos de campo": [
        ("CAM-01", "Handheld o escáner con falla (afecta despacho o entregas)", INC, 1, P2, None),
        ("CAM-02", "Impresora de etiquetas con falla", INC, 1, P2, None),
        ("CAM-03", "Celular de mensajero: app, configuración o datos", INC, 1, P3, None),
        (
            "CAM-04",
            "Entrega, configuración o reposición de dispositivo de campo",
            SOL,
            2,
            P3,
            3 * DIA,
        ),
    ],
    "Puesto de trabajo, accesos y seguridad": [
        ("PUE-01", "Falla de PC, laptop, periférico o impresora de oficina", INC, 1, P3, None),
        ("PUE-02", "Instalación de software autorizado", SOL, 1, P4, 2 * DIA),
        ("PUE-03", "Preparación de equipo para nuevo colaborador", SOL, 2, P3, 3 * DIA),
        ("ACC-01", "Reseteo de contraseña o desbloqueo de cuenta", SOL, 1, P3, 120),
        ("ACC-02", "Alta, baja o cambio de accesos (red, carpetas, VPN)", SOL, 1, P3, DIA),
        ("SEG-01", "Correo sospechoso, virus o incidente de seguridad", INC, 2, P2, None),
    ],
    "Red, conectividad, telefonía y consultas": [
        ("RED-01", "Sucursal o centro de distribución sin internet o red", INC, 2, P2, None),
        ("RED-02", "Lentitud o falla de wifi o red de un usuario o grupo", INC, 1, P3, None),
        ("TEL-01", "Caída de la central telefónica o del call center", INC, 2, P1, None),
        ("TEL-02", "Extensión, softphone o diadema con falla", INC, 1, P3, None),
        ("CON-01", "Consulta de uso de sistemas o herramientas", CON, 1, P4, None),
    ],
}


#: Quién aprueba cada solicitud (§6.4). «jefe» es el responsable del área de
#: quien pide; lo demás se busca por el nombre del área de la empresa.
APROBACIONES = {
    "TRK-04": ["jefe"],
    "TRK-05": ["jefe"],
    "ERP-04": ["jefe", "Financ"],
    "ERP-05": ["jefe"],
    "COR-03": ["Talento Humano"],
    "COR-04": ["jefe"],
    "CAM-04": ["Operaciones"],
    "PUE-02": ["jefe"],
    "PUE-03": ["Talento Humano"],
    "ACC-02": ["jefe"],
}


class Command(BaseCommand):
    help = "Carga el catálogo de servicios TI del flujo ITIL en la mesa de una empresa."

    def add_arguments(self, parser):
        parser.add_argument("--empresa", required=True, help="Código de la empresa (p. ej. LC).")

    def handle(self, *args, **opciones):
        empresa = Empresa.objects.filter(codigo__iexact=opciones["empresa"]).first()
        if empresa is None:
            raise CommandError(f"No existe la empresa {opciones['empresa']}.")
        creados = actualizados = 0
        sin_area = set()
        with usando_empresa(empresa), transaction.atomic():
            niveles = {n.orden: n for n in NivelSoporte.objects.all()}
            for nombre_categoria, servicios in CATALOGO.items():
                categoria, _ = Categoria.objects.get_or_create(nombre=nombre_categoria)
                for codigo, nombre, tipo, nivel, prioridad, plazo in servicios:
                    caso = CasoAyuda.objects.filter(categoria=categoria, codigo=codigo).first()
                    if caso is None:
                        caso = CasoAyuda(categoria=categoria, codigo=codigo)
                        creados += 1
                    else:
                        actualizados += 1
                    caso.nombre = nombre
                    caso.tipo = tipo
                    caso.prioridad = prioridad
                    # Si la empresa todavía no tiene ese nivel, entra por el primero.
                    caso.nivel_inicial = niveles.get(nivel) if nivel > 1 else None
                    caso.minutos_plazo = plazo
                    aprueban = APROBACIONES.get(codigo, [])
                    caso.aprueba_jefe_area = "jefe" in aprueban
                    caso.save()
                    areas = []
                    for nombre_area in (a for a in aprueban if a != "jefe"):
                        area = Departamento.objects.filter(nombre__icontains=nombre_area).first()
                        if area is None:
                            sin_area.add(nombre_area)
                        else:
                            areas.append(area)
                    caso.aprueban.set(areas)
        self.stdout.write(
            f"Catálogo cargado en {empresa.nombre}: {creados} servicio(s) nuevo(s), "
            f"{actualizados} actualizado(s)."
        )
        if sin_area:
            self.stdout.write(
                "Sin área para aprobar: " + ", ".join(sorted(sin_area)) + ". Créela en "
                "Configuración > Catálogos > Áreas y vuelva a correr el comando, o asígnela "
                "en el caso."
            )
