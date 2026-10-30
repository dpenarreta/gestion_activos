"""Las vacaciones de cada persona (19/10/2026): por período (año de
servicio), cuántos días le corresponden, cuántos gozó y cuántos le quedan.

Por ahora es solo de consulta: los datos se cargan desde Talento Humano (más
adelante, desde la nómina). Cada persona ve las suyas; con
`vacaciones.ver_todas` se consultan las de cualquiera de la empresa.
"""

from .models import PeriodoVacaciones


def _nombre(usuario):
    return usuario.get_full_name().strip() or usuario.username


POR_DEFECTO = "Marcado por defecto"


def resumen(usuario) -> dict:
    """Por período: lo que corresponde, lo gozado, lo reservado por las
    solicitudes de vacaciones en aprobación y lo disponible para pedir, con
    los mismos cálculos que usa Solicitud de permisos (`restricciones`), para
    que las dos pantallas digan lo mismo; y los sábados y domingos que lleva
    cada período frente a los que pide la regla (auditoría UX/UI,
    30/10/2026)."""
    from apps.licencias import restricciones
    from apps.licencias.models import SolicitudPermiso

    calculados = {c.periodo.pk: c for c in restricciones._periodos(usuario)}
    sabados, domingos = restricciones._regla()
    periodos = []
    for periodo in (
        PeriodoVacaciones.objects.filter(usuario=usuario)
        .prefetch_related("goces")
        .order_by("desde")
    ):
        goces = list(periodo.goces.all())
        gozados = sum(g.dias for g in goces)
        calculo = calculados.get(periodo.pk)
        reservados = max((calculo.usados if calculo else gozados) - gozados, 0)
        pendientes = max(periodo.dias_correspondientes - gozados, 0)
        periodos.append(
            {
                "id": periodo.id,
                "nombre": f"{periodo.desde.year} – {periodo.hasta.year}",
                "desde": periodo.desde,
                "hasta": periodo.hasta,
                "correspondientes": periodo.dias_correspondientes,
                "gozados": gozados,
                "pendientes": pendientes,
                "reservados": min(reservados, pendientes),
                "disponibles": calculo.saldo if calculo else pendientes,
                # Los que lleva, contando lo reservado en aprobación.
                "sabados": calculo.lleva(restricciones.SABADO) if calculo else 0,
                "domingos": calculo.lleva(restricciones.DOMINGO) if calculo else 0,
                "nota": periodo.nota,
                "goces": [
                    {
                        "id": g.id,
                        "desde": g.desde,
                        "hasta": g.hasta,
                        "dias": g.dias,
                        "descripcion": g.descripcion,
                        "por_defecto": g.descripcion.startswith(POR_DEFECTO),
                    }
                    for g in goces
                ],
            }
        )
    en_curso = [
        {
            "id": s.id,
            "tipo": s.flujo.nombre,
            "desde": s.desde,
            "hasta": s.hasta,
            "dias": s.dias,
            "paso": s.paso_actual.nombre if s.paso_actual else "",
        }
        for s in SolicitudPermiso.objects.filter(
            solicitante=usuario,
            estado=SolicitudPermiso.Estado.PENDIENTE,
            flujo__descuenta_vacaciones=True,
        )
        .select_related("flujo", "paso_actual")
        .order_by("desde")
    ]
    return {
        "persona": {"id": usuario.id, "nombre": _nombre(usuario)},
        "correspondientes": sum(p["correspondientes"] for p in periodos),
        "gozados": sum(p["gozados"] for p in periodos),
        "pendientes": sum(p["pendientes"] for p in periodos),
        "reservados": sum(p["reservados"] for p in periodos),
        "disponibles": sum(p["disponibles"] for p in periodos),
        "periodos_con_pendientes": sum(1 for p in periodos if p["pendientes"] > 0),
        "regla": {"sabados": sabados, "domingos": domingos},
        "en_curso": en_curso,
        "periodos": periodos,
    }


def personas(texto: str = "") -> list[dict]:
    """Las personas de la empresa con sus días pendientes, para elegir."""
    from apps.chat.services import buscar_personas

    lista = list(buscar_personas(texto, limite=50))
    # Quiénes tienen períodos cargados; el detalle lo calcula `resumen` (sumar
    # aquí con un join contaría los días de cada período una vez por goce).
    con_periodos = set(
        PeriodoVacaciones.objects.filter(usuario__in=lista).values_list("usuario", flat=True)
    )
    # Solo el saldo de cada una (no el resumen completo): la lista se pide en
    # cada búsqueda y son hasta 50 personas (auditoría UX/UI, 30/10/2026).
    from apps.licencias import restricciones

    resultado = []
    for persona in lista:
        calculados = restricciones._periodos(persona) if persona.id in con_periodos else []
        resultado.append(
            {
                "id": persona.id,
                "nombre": _nombre(persona),
                "pendientes": sum(
                    max(
                        c.periodo.dias_correspondientes
                        - sum(g.dias for g in c.periodo.goces.all()),
                        0,
                    )
                    for c in calculados
                ),
                "disponibles": sum(c.saldo for c in calculados),
                "periodos": len(calculados),
            }
        )
    return resultado
