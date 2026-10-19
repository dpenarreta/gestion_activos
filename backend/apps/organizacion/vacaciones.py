"""Las vacaciones de cada persona (19/10/2026): por período (año de
servicio), cuántos días le corresponden, cuántos gozó y cuántos le quedan.

Por ahora es solo de consulta: los datos se cargan desde Talento Humano (más
adelante, desde la nómina). Cada persona ve las suyas; con
`vacaciones.ver_todas` se consultan las de cualquiera de la empresa.
"""

from .models import PeriodoVacaciones


def _nombre(usuario):
    return usuario.get_full_name().strip() or usuario.username


def resumen(usuario) -> dict:
    periodos = []
    for periodo in (
        PeriodoVacaciones.objects.filter(usuario=usuario)
        .prefetch_related("goces")
        .order_by("desde")
    ):
        goces = list(periodo.goces.all())
        gozados = sum(g.dias for g in goces)
        periodos.append(
            {
                "id": periodo.id,
                "nombre": f"{periodo.desde.year} – {periodo.hasta.year}",
                "desde": periodo.desde,
                "hasta": periodo.hasta,
                "correspondientes": periodo.dias_correspondientes,
                "gozados": gozados,
                "pendientes": max(periodo.dias_correspondientes - gozados, 0),
                "nota": periodo.nota,
                "goces": [
                    {
                        "id": g.id,
                        "desde": g.desde,
                        "hasta": g.hasta,
                        "dias": g.dias,
                        "descripcion": g.descripcion,
                    }
                    for g in goces
                ],
            }
        )
    return {
        "persona": {"id": usuario.id, "nombre": _nombre(usuario)},
        "correspondientes": sum(p["correspondientes"] for p in periodos),
        "gozados": sum(p["gozados"] for p in periodos),
        "pendientes": sum(p["pendientes"] for p in periodos),
        "periodos_con_pendientes": sum(1 for p in periodos if p["pendientes"] > 0),
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
    resultado = []
    for persona in lista:
        datos = resumen(persona) if persona.id in con_periodos else None
        resultado.append(
            {
                "id": persona.id,
                "nombre": _nombre(persona),
                "pendientes": datos["pendientes"] if datos else 0,
                "periodos": len(datos["periodos"]) if datos else 0,
            }
        )
    return resultado
