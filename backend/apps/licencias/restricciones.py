"""Las restricciones de cada tipo de permiso (20/10/2026).

Cada flujo trae las suyas, configurables, y quien solicita las ve al elegir
las fechas, cada una con si la cumple:

- **Mínimo y máximo de días seguidos** por solicitud (bloquean).
- **Se descuenta de las vacaciones**: los días salen de sus períodos con días
  pendientes, del más antiguo al más nuevo, y al aprobarse quedan como
  gozados en esos períodos. No se piden más de los que alcanzan (bloquea).
- **Fines de semana por período** (vacaciones): de los 15 días de cada
  período anual, al menos N sábados y N domingos. Un período no se completa
  solo con días de semana: cuando sus días pendientes llegan a ser justo los
  fines de semana que le faltan, esos días se **marcan por defecto** en los
  sábados y domingos libres siguientes a la solicitud, y se avisa a la persona.
- **Otras indicaciones**: texto libre, una por línea (solo se informan).
- **Rol asignado**: quien no tiene ningún rol (ni global ni en la empresa) no
  puede solicitar ningún tipo de permiso. La cuenta de superusuario sí.

Las solicitudes pendientes reservan sus días (y sus fines de semana marcados)
aunque todavía no se aprueben, para que dos solicitudes no cuenten los mismos.

Contra los flanqueos (ver docs/solicitud-de-permisos.md):

- Las fechas no se cruzan con otra solicitud suya pendiente o aprobada (de
  cualquier tipo) ni con días que ya constan como vacaciones gozadas.
- Todo se valida en el servidor al crear, no solo en la pantalla, y la
  creación bloquea a la persona (`select_for_update`) para que dos envíos a la
  vez no cuenten los mismos días.
- Al aprobarse el último paso se vuelve a comprobar que los días alcanzan y
  que no se cruzan con lo gozado: si cambió algo entretanto, no se aprueba.
"""

import datetime

from rest_framework.exceptions import ValidationError

from apps.notificaciones import services as campana
from apps.organizacion.models import GoceVacaciones, PeriodoVacaciones

from .models import FlujoPermiso, SolicitudPermiso

SABADO, DOMINGO = 5, 6
NOMBRE_DIA = {SABADO: "sábado", DOMINGO: "domingo"}
ENLACE_VACACIONES = "/admin/institucional/vacaciones"


def _fecha(d) -> str:
    return d.strftime("%d/%m/%Y")


def _dia_y_fecha(d) -> str:
    return f"{NOMBRE_DIA.get(d.weekday(), '')} {_fecha(d)}".strip()


def _dias(desde, hasta):
    actual = desde
    while actual <= hasta:
        yield actual
        actual += datetime.timedelta(days=1)


def _plural(n, uno, varios) -> str:
    return f"{n} {uno if n == 1 else varios}"


def _rango(desde, hasta) -> str:
    if desde == hasta:
        return f"el {_fecha(desde)}"
    return f"del {_fecha(desde)} al {_fecha(hasta)}"


def _tramos(dias):
    """Días en orden → [(desde, hasta, cuántos)] de días seguidos."""
    tramos = []
    for d in sorted(dias):
        if tramos and d == tramos[-1][1] + datetime.timedelta(days=1):
            tramos[-1] = (tramos[-1][0], d, tramos[-1][2] + 1)
        else:
            tramos.append((d, d, 1))
    return tramos


# --- Los períodos y lo que ya tienen tomado ---------------------------------------------


class _Periodo:
    """Un período con lo que ya se le descontó: sus goces y lo que reservan
    las solicitudes pendientes."""

    def __init__(self, periodo, sabados, domingos):
        self.periodo = periodo
        self.pide = {SABADO: sabados, DOMINGO: domingos}
        self.tomados = set()
        self.usados = 0
        for goce in periodo.goces.all():
            self.usados += goce.dias
            self.tomados.update(_dias(goce.desde, goce.hasta))

    @property
    def nombre(self) -> str:
        return f"{self.periodo.desde.year} – {self.periodo.hasta.year}"

    @property
    def saldo(self) -> int:
        return max(self.periodo.dias_correspondientes - self.usados, 0)

    def lleva(self, dia_semana) -> int:
        return sum(1 for d in self.tomados if d.weekday() == dia_semana)

    def faltan(self, dia_semana=None) -> int:
        if dia_semana is not None:
            return max(self.pide[dia_semana] - self.lleva(dia_semana), 0)
        return self.faltan(SABADO) + self.faltan(DOMINGO)

    def admite(self, dia) -> bool:
        """Si ese día puede salir de este período sin dejarlo sin lugar para
        los fines de semana que le faltan."""
        if self.saldo <= 0:
            return False
        if dia.weekday() in self.pide and self.faltan(dia.weekday()) > 0:
            return True
        return self.saldo - 1 >= self.faltan()

    def tomar(self, dia):
        self.tomados.add(dia)
        self.usados += 1


def _regla():
    """Los sábados y domingos que pide el tipo de permiso de vacaciones (si
    hay varios, el más exigente)."""
    sabados = domingos = 0
    for flujo in FlujoPermiso.objects.filter(activo=True, descuenta_vacaciones=True):
        sabados = max(sabados, flujo.sabados_por_periodo)
        domingos = max(domingos, flujo.domingos_por_periodo)
    return sabados, domingos


def _repartir(periodos, dias, ocupadas=frozenset()):
    """Reparte los días (en orden) entre los períodos, del más antiguo al más
    nuevo, y marca los fines de semana de los períodos que se completan.

    Devuelve `(reparto, marcas, sobran)`: los días de la solicitud por
    período, los fines de semana marcados por defecto por período y los días
    que no caben en ninguno.
    """
    reparto, marcas, sobran = {}, {}, []
    for dia in dias:
        destino = next((p for p in periodos if p.admite(dia)), None)
        if destino is None:
            sobran.append(dia)
            continue
        destino.tomar(dia)
        reparto.setdefault(destino, []).append(dia)
    if not reparto:
        return reparto, marcas, sobran

    # Los períodos que la solicitud alcanzó o pasó de largo y que quedaron con
    # solo los fines de semana que les faltan: esos días se marcan por defecto
    # en los sábados y domingos libres que siguen a la solicitud.
    ultimo = max(periodos.index(p) for p in reparto)
    ocupados = set(dias).union(ocupadas, *(p.tomados for p in periodos))
    for p in periodos[: ultimo + 1]:
        if not (0 < p.saldo <= p.faltan()):
            continue
        faltan = {SABADO: p.faltan(SABADO), DOMINGO: p.faltan(DOMINGO)}
        elegidos = []
        dia = max(dias)
        while len(elegidos) < p.saldo and any(faltan.values()):
            dia += datetime.timedelta(days=1)
            if faltan.get(dia.weekday()) and dia not in ocupados:
                elegidos.append(dia)
                faltan[dia.weekday()] -= 1
                ocupados.add(dia)
        for d in elegidos:
            p.tomar(d)
        if elegidos:
            marcas[p] = elegidos
    return reparto, marcas, sobran


def _vigentes(usuario):
    """Sus solicitudes pendientes o aprobadas, de cualquier tipo."""
    return SolicitudPermiso.objects.filter(
        solicitante=usuario,
        estado__in=[SolicitudPermiso.Estado.PENDIENTE, SolicitudPermiso.Estado.APROBADA],
    ).select_related("flujo")


def _fechas_de_otras(usuario, excluir=None) -> set:
    """Los días de sus otras solicitudes vigentes: ahí no se marcan fines de
    semana por defecto."""
    fechas = set()
    for s in _vigentes(usuario).exclude(pk=getattr(excluir, "pk", None)):
        fechas.update(_dias(s.desde, s.hasta))
    return fechas


def _cruces(usuario, desde, hasta, excluir=None):
    """Sus solicitudes vigentes que se cruzan con esas fechas."""
    return list(
        _vigentes(usuario)
        .filter(desde__lte=hasta, hasta__gte=desde)
        .exclude(pk=getattr(excluir, "pk", None))
        .order_by("desde")
    )


def _gozados_en(usuario, desde, hasta):
    """Los goces de vacaciones ya registrados que se cruzan con esas fechas."""
    return list(
        GoceVacaciones.objects.filter(
            periodo__usuario=usuario, desde__lte=hasta, hasta__gte=desde
        ).order_by("desde")
    )


def _periodos(usuario, antes_de=None):
    """Los períodos del usuario con lo que ya tienen tomado y lo reservado por
    sus solicitudes pendientes que se descuentan de vacaciones. Con
    `antes_de`, solo las pendientes anteriores a esa solicitud (en el orden en
    que se pidieron: la primera en pedir es la primera en descontar)."""
    sabados, domingos = _regla()
    periodos = [
        _Periodo(p, sabados, domingos)
        for p in PeriodoVacaciones.objects.filter(usuario=usuario)
        .prefetch_related("goces")
        .order_by("desde")
    ]
    pendientes = SolicitudPermiso.objects.filter(
        solicitante=usuario,
        estado=SolicitudPermiso.Estado.PENDIENTE,
        flujo__descuenta_vacaciones=True,
    ).order_by("created_at", "id")
    for solicitud in pendientes:
        if antes_de is not None and solicitud.pk == antes_de.pk:
            break
        _repartir(periodos, list(_dias(solicitud.desde, solicitud.hasta)))
    return periodos


# --- Evaluar una solicitud --------------------------------------------------------------


SIN_ROL = (
    "No tiene permiso para solicitar permisos ni vacaciones.",
    "Su rol no incluye «Solicitar permisos y vacaciones». Pida a quien administra "
    "los roles que se lo asigne.",
)


def tiene_rol(usuario) -> bool:
    """Si la cuenta puede solicitar: `licencias.solicitar` (21/10/2026; antes
    bastaba con tener cualquier rol). Lo tienen todos los roles de nivel."""
    from apps.permissions.authorization import user_has_permission

    return user_has_permission(usuario, "licencias.solicitar")


def _regla_dict(clave, estado, texto, detalle=""):
    return {"clave": clave, "estado": estado, "texto": texto, "detalle": detalle}


def evaluar(usuario, flujo, desde, hasta) -> dict:
    """Las restricciones del tipo de permiso para esas fechas, cada una con
    su estado: «ok», «falla» (no deja enviar), «aviso» o «info»."""
    if not tiene_rol(usuario):
        return {"reglas": [_regla_dict("rol", "falla", *SIN_ROL)], "bloquea": True}
    if hasta < desde:
        return {
            "reglas": [_regla_dict("fechas", "falla", "«Hasta» no puede ser antes de «Desde».")],
            "bloquea": True,
        }
    dias = list(_dias(desde, hasta))
    total = len(dias)
    elegidos = f"Ha elegido {_plural(total, 'día', 'días')}."
    reglas = []

    # Solo aparecen si fallan: no se piden días ya pedidos o ya gozados.
    cruces = _cruces(usuario, desde, hasta)
    if cruces:
        reglas.append(
            _regla_dict(
                "cruce",
                "falla",
                "Las fechas se cruzan con otra solicitud suya.",
                "; ".join(
                    f"{s.flujo.nombre} {_rango(s.desde, s.hasta)} "
                    f"({s.get_estado_display().lower()})"
                    for s in cruces
                )
                + ".",
            )
        )
    if flujo.descuenta_vacaciones:
        gozados = _gozados_en(usuario, desde, hasta)
        if gozados:
            reglas.append(
                _regla_dict(
                    "gozado",
                    "falla",
                    "Esos días ya constan como vacaciones gozadas.",
                    "; ".join(_rango(g.desde, g.hasta) for g in gozados) + ".",
                )
            )

    if flujo.dias_minimos:
        reglas.append(
            _regla_dict(
                "minimo",
                "ok" if total >= flujo.dias_minimos else "falla",
                f"Mínimo {flujo.dias_minimos} días seguidos por solicitud.",
                elegidos,
            )
        )
    if flujo.dias_maximos:
        reglas.append(
            _regla_dict(
                "maximo",
                "ok" if total <= flujo.dias_maximos else "falla",
                f"Máximo {flujo.dias_maximos} días seguidos por solicitud.",
                elegidos,
            )
        )

    if flujo.descuenta_vacaciones:
        periodos = _periodos(usuario)
        disponibles = sum(p.saldo for p in periodos)
        reparto, marcas, sobran = _repartir(periodos, dias, _fechas_de_otras(usuario))
        if sobran:
            detalle = (
                f"Tiene {_plural(disponibles, 'día pendiente', 'días pendientes')}; "
                f"para estas fechas le alcanzan {total - len(sobran)} de {total}"
                + (
                    ", porque la regla reserva días para los fines de semana."
                    if disponibles >= total
                    else "."
                )
            )
        else:
            detalle = (
                f"Tiene {_plural(disponibles, 'día pendiente', 'días pendientes')}. Saldrían "
                + "; ".join(f"{len(d)} del período {p.nombre}" for p, d in reparto.items())
                + "."
            )
        reglas.append(
            _regla_dict(
                "saldo",
                "falla" if sobran else "ok",
                "Se descuenta de sus vacaciones pendientes.",
                detalle,
            )
        )
        if flujo.sabados_por_periodo or flujo.domingos_por_periodo:
            reglas.extend(_reglas_de_fines_de_semana(flujo, periodos, reparto, marcas))

    if flujo.adjunto == FlujoPermiso.Adjunto.OBLIGATORIO:
        reglas.append(_regla_dict("adjunto", "info", "Debe adjuntar un documento de respaldo."))
    notas = [linea.strip() for linea in flujo.restricciones.splitlines() if linea.strip()]
    for i, nota in enumerate(notas):
        reglas.append(_regla_dict(f"nota-{i}", "info", nota))

    return {"reglas": reglas, "bloquea": any(r["estado"] == "falla" for r in reglas)}


def _reglas_de_fines_de_semana(flujo, periodos, reparto, marcas):
    partes = []
    if flujo.sabados_por_periodo:
        partes.append(_plural(flujo.sabados_por_periodo, "sábado", "sábados"))
    if flujo.domingos_por_periodo:
        partes.append(_plural(flujo.domingos_por_periodo, "domingo", "domingos"))
    texto = f"De cada período anual deben salir al menos {' y '.join(partes)}."
    reglas = []
    for p in periodos:
        if p not in reparto and p not in marcas:
            continue
        # Lo que lleva con los días de la solicitud, sin los marcados.
        marcados = marcas.get(p, [])
        sabados = p.lleva(SABADO) - sum(1 for d in marcados if d.weekday() == SABADO)
        domingos = p.lleva(DOMINGO) - sum(1 for d in marcados if d.weekday() == DOMINGO)
        cuenta = (
            f"Período {p.nombre}, con esta solicitud: "
            f"{sabados} de {p.pide[SABADO]} sábados y "
            f"{domingos} de {p.pide[DOMINGO]} domingos"
        )
        if p in marcas:
            estado = "aviso"
            detalle = (
                f"{cuenta}. El período se completa y los fines de semana que faltaban se "
                "marcarán por defecto como vacaciones: "
                + ", ".join(_dia_y_fecha(d) for d in marcas[p])
                + "."
            )
        elif p.faltan():
            estado = "aviso"
            detalle = (
                f"{cuenta}; le quedan {_plural(p.saldo, 'día', 'días')} de este período. "
                "Si al completarlo no tomó los que faltan, se marcarán por defecto."
            )
        else:
            estado = "ok"
            detalle = f"{cuenta}."
        reglas.append(_regla_dict(f"fines-{p.periodo.pk}", estado, texto, detalle))
    if not reglas:
        reglas.append(_regla_dict("fines", "info", texto))
    return reglas


def exigir(usuario, flujo, desde, hasta):
    """Al crear una solicitud: las restricciones que bloquean se cumplen."""
    resultado = evaluar(usuario, flujo, desde, hasta)
    fallas = [r for r in resultado["reglas"] if r["estado"] == "falla"]
    if fallas:
        raise ValidationError(
            {"detail": " ".join(f"{r['texto']} {r['detalle']}".strip() for r in fallas)}
        )


# --- Al aprobarse: los días pasan a gozados ----------------------------------------------


def registrar_goce(solicitud):
    """Una solicitud aprobada que se descuenta de vacaciones queda como
    gozada en sus períodos, con los fines de semana marcados por defecto si
    alguno se completó (y se le avisa a la persona)."""
    if not solicitud.flujo.descuenta_vacaciones:
        return
    usuario = solicitud.solicitante
    # Que nada más descuente días de esta persona mientras se registra.
    type(usuario).objects.select_for_update().filter(pk=usuario.pk).first()
    gozados = _gozados_en(usuario, solicitud.desde, solicitud.hasta)
    if gozados:
        raise ValidationError(
            {
                "detail": "No se puede aprobar: esos días ya constan como vacaciones gozadas ("
                + "; ".join(_rango(g.desde, g.hasta) for g in gozados)
                + "). Recházela para que se pida de nuevo."
            }
        )
    periodos = _periodos(usuario, antes_de=solicitud)
    reparto, marcas, sobran = _repartir(
        periodos,
        list(_dias(solicitud.desde, solicitud.hasta)),
        _fechas_de_otras(usuario, excluir=solicitud),
    )
    if sobran:
        raise ValidationError(
            {
                "detail": "No se puede aprobar: ya no le alcanzan los días de vacaciones "
                f"para estas fechas (faltan {len(sobran)}). Recházela para que se pida de nuevo."
            }
        )
    referencia = f"{solicitud.flujo.nombre} (solicitud n.º {solicitud.pk})"
    for p, dias in reparto.items():
        for desde, hasta, cuantos in _tramos(dias):
            GoceVacaciones.objects.create(
                periodo=p.periodo,
                desde=desde,
                hasta=hasta,
                dias=cuantos,
                descripcion=referencia[:200],
            )
    marcados = []
    for p, dias in marcas.items():
        for d in dias:
            GoceVacaciones.objects.create(
                periodo=p.periodo,
                desde=d,
                hasta=d,
                dias=1,
                descripcion=f"Marcado por defecto: {NOMBRE_DIA[d.weekday()]} (regla de fines de semana)",
            )
            marcados.append(d)
    if marcados:
        campana.notificar(
            [solicitud.solicitante],
            tipo="licencias.fines_de_semana",
            titulo="Se marcaron fines de semana de vacaciones por defecto",
            resumen=(
                "Para completar los sábados y domingos que pide cada período: "
                + ", ".join(_dia_y_fecha(d) for d in sorted(marcados))
                + "."
            ),
            enlace=ENLACE_VACACIONES,
        )
