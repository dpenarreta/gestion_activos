"""Carga masiva de las personas del organigrama (20/10/2026).

Desde el organigrama se descarga un .xlsx con la estructura armada **por
unidad** (una hoja por departamento). Cada hoja muestra quién es el gerente del
área, y para cada cargo indica su nivel jerárquico, su nivel dentro del área,
a quién reporta y su cadena de mando completa, con una fila por plaza. Se
llenan Nombres, Apellidos y Correo institucional de quien ocupa cada plaza y
el archivo se vuelve a subir:

1. **Validar**: se revisa todo y se devuelve el reporte; no se guarda nada.
2. **Confirmar**: se vuelve a enviar el mismo archivo y se aplica, todo o nada.

Al aplicar, por cada cargo que aparece en el archivo:

- Si el correo es de una **cuenta de la empresa**, se le asigna el cargo (el
  mismo dato que «Mi perfil» y Asignación de cargos), con su rol de nivel.
- Si no, el nombre queda como **ocupante sin cuenta** del cargo
  (`OcupanteCargo`) y se ve en el organigrama. Cuando esa persona entra a la
  empresa con el mismo correo, se le asigna el cargo sola
  (`enlazar_al_entrar`).
- Los ocupantes sin cuenta se **reemplazan por unidad**: en cada hoja que trae
  al menos una persona, los de sus cargos pasan a ser los del archivo (volver a
  subirlo no duplica, y borrar a alguien de la hoja lo quita). Una hoja sin
  ninguna persona no toca nada: llenar una sola unidad no vacía las demás. Las
  personas con cuenta no se quitan de un cargo por no estar en el archivo: eso
  se hace en Asignación de cargos.

Se descargan dos archivos con el mismo formato (los dos se pueden subir):

- **Plantilla de carga masiva**: la estructura, sin personas.
- **Organigrama completo**: la estructura con quien ocupa hoy cada plaza (con
  cuenta o sin ella), una columna «Situación» y una hoja «Resumen» por unidad.

Lo que hace rechazar el archivo: un ID de cargo que no es de la empresa,
nombres sin apellidos (o al revés), un correo inválido o que no es
institucional, el mismo correo dos veces, o un correo que ya figura como
ocupante de otro cargo que no viene en el archivo. Más personas que plazas no
lo rechaza: se avisa.
"""

import io
import re
from pathlib import PurePath

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.empresas.models import MembresiaEmpresa

from . import organigrama
from .contacto import DOMINIOS_INSTITUCIONALES, es_institucional
from .models import Cargo, DatosDeContacto, OcupanteCargo, UnidadOrganizacional

TAMANO_MAXIMO = 5 * 1024 * 1024
HOJA_INSTRUCCIONES = "Instrucciones"
HOJA_RESUMEN = "Resumen"
COLUMNAS = [
    ("ID", 7),
    ("Nivel jerárquico", 18),
    ("Nivel en el área", 10),
    ("Cargo", 38),
    ("Reporta a", 30),
    ("Cadena de mando", 60),
    ("Plaza", 9),
    ("Nombres", 24),
    ("Apellidos", 24),
    ("Correo institucional", 32),
]
#: Las columnas que llena quien carga (las demás describen la estructura).
PRIMERA_DE_PERSONA = 8
CORREO = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_GRIS = PatternFill("solid", fgColor="E9EDF2")
_AMARILLO = PatternFill("solid", fgColor="FFF4CC")
_AZUL = PatternFill("solid", fgColor="1F4E79")
_BORDE = Border(bottom=Side(style="thin", color="C9D1DB"))


# --- La estructura, ordenada como se lee ----------------------------------------------


def _cadena(cargo) -> list:
    """Del cargo más alto de la empresa hasta este."""
    cadena, actual, vistos = [], cargo, set()
    while actual is not None and actual.pk not in vistos:
        vistos.add(actual.pk)
        cadena.append(actual)
        actual = actual.jefe
    return list(reversed(cadena))


def _bajar(hijos, padre, profundidad, ordenados):
    for c in hijos.get(padre, []):
        ordenados.append((c, profundidad))
        _bajar(hijos, c.pk, profundidad + 1, ordenados)


def _cargos_por_unidad():
    """Cada unidad con sus cargos en orden de mando: primero el gerente del
    área (el que reporta fuera de la unidad o a nadie) y debajo su cadena,
    con su profundidad dentro del área."""
    cargos = list(
        Cargo.objects.filter(activo=True).select_related("unidad__nivel", "jefe").order_by("nombre")
    )
    por_unidad = {}
    for cargo in cargos:
        por_unidad.setdefault(cargo.unidad_id, []).append(cargo)
    resultado = []
    unidades = UnidadOrganizacional.objects.filter(activa=True).select_related(
        "nivel", "departamento"
    )
    for unidad in unidades.order_by("nivel__orden", "orden", "nombre"):
        propios = por_unidad.get(unidad.id, [])
        if not propios:
            continue
        ids = {c.pk for c in propios}
        hijos = {}
        for c in propios:
            hijos.setdefault(c.jefe_id if c.jefe_id in ids else None, []).append(c)
        ordenados = []
        _bajar(hijos, None, 1, ordenados)
        resultado.append((unidad, ordenados))
    return resultado


def _ocupantes_actuales():
    """Cargo → [(nombres, apellidos, correo, situación)] de quienes lo ocupan
    hoy, con cuenta o sin ella."""
    actuales = {}
    for fila in (
        DatosDeContacto.objects.filter(cargo__isnull=False, usuario__is_active=True)
        .select_related("usuario")
        .order_by("usuario__first_name", "usuario__last_name")
    ):
        u = fila.usuario
        actuales.setdefault(fila.cargo_id, []).append(
            (u.first_name, u.last_name, u.email, "Con cuenta")
        )
    for o in OcupanteCargo.objects.order_by("apellidos", "nombres"):
        actuales.setdefault(o.cargo_id, []).append((o.nombres, o.apellidos, o.correo, "Sin cuenta"))
    return actuales


def _nombre_hoja(nombre, usados) -> str:
    base = re.sub(r"[\[\]\*\?/\\:]", " ", nombre).strip()[:31] or "Unidad"
    candidato, n = base, 2
    while candidato.lower() in usados or candidato in (HOJA_INSTRUCCIONES, HOJA_RESUMEN):
        candidato = f"{base[:26]} ({n})"
        n += 1
    usados.add(candidato.lower())
    return candidato


def construir_plantilla(con_personas: bool = False) -> bytes:
    """El .xlsx con una hoja por unidad. Sin personas es la plantilla de carga
    masiva; con personas, el organigrama completo (con «Situación» y la hoja
    «Resumen»)."""
    libro = Workbook()
    instrucciones = libro.active
    instrucciones.title = HOJA_INSTRUCCIONES
    _instrucciones(instrucciones)
    actuales = _ocupantes_actuales() if con_personas else {}
    columnas = COLUMNAS + ([("Situación", 13)] if con_personas else [])
    usados = set()
    por_unidad = _cargos_por_unidad()
    if con_personas:
        _resumen(libro.create_sheet(HOJA_RESUMEN, 0), por_unidad, actuales)
    for unidad, cargos in por_unidad:
        hoja = libro.create_sheet(_nombre_hoja(unidad.nombre, usados))
        gerente = next((c for c, p in cargos if p == 1), None)
        hoja["A1"] = unidad.nombre
        hoja["A1"].font = Font(bold=True, size=14)
        detalle = f"Nivel jerárquico: {unidad.nivel.nombre}"
        if unidad.departamento_id:
            detalle += f" · Departamento: {unidad.departamento.nombre}"
        hoja["A2"] = detalle
        if gerente is not None:
            hoja["A3"] = f"Gerente del área: {gerente.nombre}" + (
                f" · reporta a {gerente.jefe.nombre}" if gerente.jefe_id else ""
            )
            hoja["A3"].font = Font(bold=True)
        encabezado = 5
        for i, (titulo, ancho) in enumerate(columnas, start=1):
            celda = hoja.cell(row=encabezado, column=i, value=titulo)
            celda.font = Font(bold=True, color="FFFFFF")
            celda.fill = _AZUL
            celda.alignment = Alignment(vertical="center", wrap_text=True)
            hoja.column_dimensions[get_column_letter(i)].width = ancho
        fila = encabezado + 1
        for cargo, profundidad in cargos:
            cadena = " › ".join(c.nombre for c in _cadena(cargo))
            personas = actuales.get(cargo.pk, [])
            for plaza in range(1, max(cargo.plazas, len(personas), 1) + 1):
                persona = personas[plaza - 1] if plaza <= len(personas) else ("", "", "", "Vacante")
                if not con_personas:
                    persona = persona[:3]
                valores = [
                    cargo.pk,
                    unidad.nivel.nombre,
                    profundidad,
                    cargo.nombre,
                    cargo.jefe.nombre if cargo.jefe_id else "—",
                    cadena,
                    f"{plaza} de {cargo.plazas}",
                    *persona,
                ]
                for i, valor in enumerate(valores, start=1):
                    celda = hoja.cell(row=fila, column=i, value=valor)
                    celda.border = _BORDE
                    celda.fill = _AMARILLO if i >= PRIMERA_DE_PERSONA else _GRIS
                    if i == 4:
                        celda.alignment = Alignment(indent=profundidad - 1)
                        if profundidad == 1:
                            celda.font = Font(bold=True)
                fila += 1
        hoja.freeze_panes = hoja.cell(row=encabezado + 1, column=PRIMERA_DE_PERSONA)
        hoja.auto_filter.ref = f"A{encabezado}:{get_column_letter(len(columnas))}{fila - 1}"
    salida = io.BytesIO()
    libro.save(salida)
    return salida.getvalue()


def _resumen(hoja, por_unidad, actuales):
    """Una fila por unidad: su nivel, de qué unidad depende, su gerente de
    área y cuántas plazas tiene, ocupadas y vacantes."""
    titulos = [
        ("Unidad", 34),
        ("Nivel jerárquico", 20),
        ("Depende de", 30),
        ("Departamento", 24),
        ("Gerente del área", 32),
        ("Cargos", 9),
        ("Plazas", 9),
        ("Ocupadas", 10),
        ("Sin cuenta", 11),
        ("Vacantes", 10),
    ]
    hoja["A1"] = "Organigrama completo · resumen por unidad"
    hoja["A1"].font = Font(bold=True, size=14)
    for i, (titulo, ancho) in enumerate(titulos, start=1):
        celda = hoja.cell(row=3, column=i, value=titulo)
        celda.font = Font(bold=True, color="FFFFFF")
        celda.fill = _AZUL
        hoja.column_dimensions[get_column_letter(i)].width = ancho
    for fila, (unidad, cargos) in enumerate(por_unidad, start=4):
        plazas = sum(c.plazas for c, _ in cargos)
        personas = [p for c, _ in cargos for p in actuales.get(c.pk, [])]
        ocupadas = sum(min(len(actuales.get(c.pk, [])), c.plazas) for c, _ in cargos)
        gerente = next((c for c, p in cargos if p == 1), None)
        valores = [
            unidad.nombre,
            unidad.nivel.nombre,
            unidad.padre.nombre if unidad.padre_id else "—",
            unidad.departamento.nombre if unidad.departamento_id else "—",
            gerente.nombre if gerente else "—",
            len(cargos),
            plazas,
            len(personas),
            sum(1 for p in personas if p[3] == "Sin cuenta"),
            plazas - ocupadas,
        ]
        for i, valor in enumerate(valores, start=1):
            hoja.cell(row=fila, column=i, value=valor).border = _BORDE
    hoja.freeze_panes = "A4"


def _instrucciones(hoja):
    dominios = ", ".join(f"@{d}" for d in DOMINIOS_INSTITUCIONALES)
    lineas = [
        ("Carga masiva de personas del organigrama", True),
        ("", False),
        ("Cada hoja es una unidad del organigrama, ordenada por su cadena de mando:", False),
        ("arriba el gerente del área y debajo quienes le reportan, nivel por nivel.", False),
        ("", False),
        ("Qué llenar", True),
        ("• Las columnas amarillas: Nombres, Apellidos y Correo institucional.", False),
        ("• Una fila por plaza. Si el cargo tiene más personas, copie la fila", False),
        ("  completa (con su ID) y llene la copia.", False),
        (
            f"• El correo es opcional, pero si se escribe debe ser institucional ({dominios}).",
            False,
        ),
        ("  Con el correo, quien ya tiene cuenta recibe su cargo; quien no, queda", False),
        ("  registrado y recibe el cargo al entrar al sistema con ese correo.", False),
        ("• Deje en blanco las plazas vacantes.", False),
        ("", False),
        ("Qué no cambiar", True),
        ("• Las columnas grises describen la estructura. El ID identifica el cargo:", False),
        ("  no lo cambie. La estructura se edita en el sistema, no en este archivo.", False),
        ("", False),
        ("Al subirlo", True),
        ("• Primero se valida y se muestra qué se va a cargar; nada se guarda hasta", False),
        ("  confirmar. Si hay errores, se indican con su hoja y su fila.", False),
        ("• En cada hoja con al menos una persona, las personas sin cuenta de sus", False),
        ("  cargos se reemplazan por las del archivo. Las hojas vacías no cambian nada.", False),
        ("  Las personas con cuenta solo se quitan de un cargo en Asignación de cargos.", False),
    ]
    for i, (texto, negrita) in enumerate(lineas, start=1):
        celda = hoja.cell(row=i, column=1, value=texto)
        if negrita:
            celda.font = Font(bold=True, size=14 if i == 1 else 12)
    hoja.column_dimensions["A"].width = 90


# --- Leer y validar ----------------------------------------------------------------------


def _texto(valor) -> str:
    if valor is None:
        return ""
    if isinstance(valor, float) and valor.is_integer():
        valor = int(valor)
    return str(valor).strip()


def leer(archivo) -> dict:
    """Valida el archivo y devuelve el reporte con lo que se cargaría (`filas`
    por cargo) y los `errores` (si hay alguno, no se aplica nada)."""
    errores, avisos = [], []

    def error(texto):
        errores.append(texto)
        return _reporte(errores, avisos, {}, set())

    if archivo is None:
        return error("Adjunte el archivo .xlsx.")
    if PurePath(archivo.name).suffix.lower() != ".xlsx":
        return error("El archivo debe ser el .xlsx descargado del organigrama.")
    if archivo.size > TAMANO_MAXIMO:
        return error("El archivo pesa más de 5 MB.")
    cabecera = archivo.read(4)
    archivo.seek(0)
    if cabecera != b"PK\x03\x04":
        return error("El contenido no es un .xlsx válido.")
    try:
        libro = load_workbook(archivo, read_only=True, data_only=True)
    except Exception:  # noqa: BLE001 (cualquier archivo dañado)
        return error("No se pudo leer el archivo: ¿está dañado o protegido con contraseña?")

    cargos = {c.pk: c for c in Cargo.objects.filter(activo=True).select_related("unidad")}
    por_cargo: dict[int, list[dict]] = {}
    presentes: set[int] = set()
    correos: dict[str, str] = {}
    for hoja in libro.worksheets:
        if hoja.title in (HOJA_INSTRUCCIONES, HOJA_RESUMEN):
            continue
        de_la_hoja: set[int] = set()
        con_personas = False
        filas = list(hoja.iter_rows(values_only=True))
        encabezado = next((i for i, f in enumerate(filas[:15]) if f and _texto(f[0]) == "ID"), None)
        if encabezado is None:
            avisos.append(f"La hoja «{hoja.title}» no tiene la tabla de la plantilla: se omitió.")
            continue
        for numero, fila in enumerate(filas[encabezado + 1 :], start=encabezado + 2):
            fila = list(fila or []) + [None] * len(COLUMNAS)
            ident = _texto(fila[0])
            nombres = _texto(fila[PRIMERA_DE_PERSONA - 1])
            apellidos = _texto(fila[PRIMERA_DE_PERSONA])
            correo = _texto(fila[PRIMERA_DE_PERSONA + 1]).lower()
            donde = f"Hoja «{hoja.title}», fila {numero}"
            if not ident and not (nombres or apellidos or correo):
                continue
            if not ident.isdigit() or int(ident) not in cargos:
                errores.append(f"{donde}: el ID «{ident}» no es un cargo de la empresa.")
                continue
            cargo_id = int(ident)
            de_la_hoja.add(cargo_id)
            if not (nombres or apellidos or correo):
                continue  # plaza vacante
            con_personas = True
            if not nombres or not apellidos:
                errores.append(f"{donde}: escriba nombres y apellidos.")
                continue
            if correo:
                if not CORREO.match(correo):
                    errores.append(f"{donde}: «{correo}» no es un correo válido.")
                    continue
                if not es_institucional(correo):
                    errores.append(f"{donde}: «{correo}» no es un correo institucional.")
                    continue
                if correo in correos:
                    errores.append(f"{donde}: el correo «{correo}» ya está en {correos[correo]}.")
                    continue
                correos[correo] = donde.lower()
            por_cargo.setdefault(cargo_id, []).append(
                {"nombres": nombres[:150], "apellidos": apellidos[:150], "correo": correo}
            )
        # Una hoja sin ninguna persona no reemplaza nada.
        if con_personas:
            presentes |= de_la_hoja
    libro.close()

    # Un correo que ya ocupa (sin cuenta) un cargo que no viene en el archivo.
    if correos:
        for otro in OcupanteCargo.objects.filter(correo__in=list(correos)).exclude(
            cargo_id__in=presentes
        ):
            errores.append(
                f"El correo «{otro.correo}» ya figura en el cargo «{otro.cargo.nombre}», que no "
                "viene en el archivo."
            )
    for cargo_id, personas in por_cargo.items():
        cargo = cargos[cargo_id]
        if len(personas) > cargo.plazas:
            avisos.append(
                f"«{organigrama.nombre_con_unidad(cargo)}» tiene {cargo.plazas} "
                f"{'plaza' if cargo.plazas == 1 else 'plazas'} y se cargan {len(personas)} personas."
            )
    if not presentes and not errores:
        errores.append(
            "El archivo no trae ninguna persona: llene Nombres y Apellidos en la plantilla."
        )
    return _reporte(errores, avisos, por_cargo, presentes)


def _cuentas(correos):
    """Correo → cuenta activa de la empresa con ese correo."""
    if not correos:
        return {}
    miembros = MembresiaEmpresa.objects.filter(
        empresa=empresa_actual(), usuario__is_active=True
    ).select_related("usuario")
    return {
        m.usuario.email.lower(): m.usuario
        for m in miembros
        if m.usuario.email and m.usuario.email.lower() in correos
    }


def _reporte(errores, avisos, por_cargo, presentes) -> dict:
    personas = [p for lista in por_cargo.values() for p in lista]
    cuentas = _cuentas({p["correo"] for p in personas if p["correo"]}) if not errores else {}
    con_cuenta = sum(1 for p in personas if p["correo"] in cuentas)
    return {
        "valido": not errores,
        "errores": errores[:200],
        "total_errores": len(errores),
        "avisos": avisos,
        "cargos": len(presentes),
        "personas": len(personas),
        "con_cuenta": con_cuenta,
        "sin_cuenta": len(personas) - con_cuenta,
        "_por_cargo": por_cargo,
        "_presentes": presentes,
        "_cuentas": cuentas,
    }


def publico(reporte) -> dict:
    return {k: v for k, v in reporte.items() if not k.startswith("_")}


# --- Aplicar --------------------------------------------------------------------------------


@transaction.atomic
def aplicar(reporte) -> dict:
    """Aplica un reporte válido: asigna los cargos a quienes tienen cuenta y
    reemplaza los ocupantes sin cuenta de los cargos del archivo."""
    from .roles_de_nivel import sincronizar

    assert reporte["valido"]
    cuentas = reporte["_cuentas"]
    OcupanteCargo.objects.filter(cargo_id__in=reporte["_presentes"]).delete()
    asignados = []
    for cargo_id, personas in reporte["_por_cargo"].items():
        cargo = Cargo.objects.get(pk=cargo_id)
        for p in personas:
            usuario = cuentas.get(p["correo"]) if p["correo"] else None
            if usuario is not None:
                organigrama.asignar(usuario, cargo)
                asignados.append(usuario)
            else:
                OcupanteCargo.objects.create(cargo=cargo, **p)
    sincronizar(empresa_actual(), asignados)
    return publico(reporte)


# --- Cuando alguien sin cuenta entra a la empresa ------------------------------------------


@receiver(post_save, sender=MembresiaEmpresa, dispatch_uid="organizacion.enlazar_ocupante")
def enlazar_al_entrar(sender, instance, created, **kwargs):
    """Quien figuraba como ocupante sin cuenta recibe su cargo al entrar a la
    empresa con el mismo correo."""
    correo = (instance.usuario.email or "").strip().lower()
    if not created or not correo:
        return
    with usando_empresa(instance.empresa):
        ocupantes = list(OcupanteCargo.objects.filter(correo=correo).select_related("cargo"))
        if not ocupantes:
            return
        from .roles_de_nivel import sincronizar

        organigrama.asignar(instance.usuario, ocupantes[0].cargo)
        OcupanteCargo.objects.filter(pk__in=[o.pk for o in ocupantes]).delete()
        sincronizar(instance.empresa, [instance.usuario])
