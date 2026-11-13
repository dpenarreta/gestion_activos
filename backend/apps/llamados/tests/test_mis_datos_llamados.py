"""Los llamados de atención en la descarga de datos personales (LOPDP) y el
nombre del módulo en la campana (US-013, integrados el 13/11/2026)."""

from apps.llamados.tests.conftest import cliente, emitir, usuario
from apps.notificaciones.modulos import describir, modulo_de
from apps.privacidad import mis_datos


def _seccion(contenido, clave):
    return next(s for s in contenido["secciones"] if s["clave"] == clave)


def test_la_descarga_trae_los_emitidos_y_anulados_sin_quien_los_pidio(e):
    emitido = emitir(e).json()
    anulado = emitir(e, descripcion="Registrado por error.").json()
    cliente(e, "carolina").post(
        f"/api/v1/llamados/llamados/{anulado['id']}/anular/", {"motivo": "Error."}, format="json"
    )
    pendiente = emitir(e, quien="julia", descripcion="Pendiente de revisión.").json()

    ana = usuario(e, "ana")
    contenido = mis_datos.armar(titular=ana, lector=ana)
    filas = _seccion(contenido, "llamados_de_atencion")["registros"]

    numeros = {f["numero"] for f in filas}
    assert numeros == {emitido["numero"], anulado["numero"]}
    assert pendiente.get("numero") not in numeros
    for fila in filas:
        assert {"fecha_del_hecho", "causa", "nivel", "descripcion", "monto", "estado"} <= set(fila)
        assert not {"solicitado_por", "emitido_por", "adjunto", "correo"} & set(fila)
    # Se puede convertir a JSON y a Excel sin errores.
    assert mis_datos.a_json(contenido)
    assert mis_datos.a_excel(contenido)


def test_la_descarga_de_otra_persona_no_trae_estos_llamados(e):
    emitir(e)
    olga = usuario(e, "olga")
    contenido = mis_datos.armar(titular=olga, lector=olga)
    assert _seccion(contenido, "llamados_de_atencion")["registros"] == []


def test_la_campana_nombra_el_modulo_de_los_llamados():
    nombre, icono = describir(modulo_de("llamados.emitido"))
    assert nombre == "Gestión Humana · Llamados de atención"
    assert icono == "exclamation-octagon"
