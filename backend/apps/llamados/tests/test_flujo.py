"""Emitir, solicitar, confirmar, rechazar y anular (US-013, CA-3 a CA-8).

- Gestión Humana emite a cualquier persona activa de la empresa; un nivel
  distinto del propuesto exige justificación; en una sanción el monto es
  obligatorio y parte del sugerido.
- Un jefe solicita solo para su equipo (directo o indirecto); queda
  `solicitado`, se avisa a quienes emiten y no a la persona.
- Confirmar lo deja `emitido` y notifica; rechazar exige motivo; anular (solo
  lo emitido) exige motivo y avisa a la persona si se le había notificado.
- Las transiciones inválidas responden 409 `estado_invalido`.
"""

import pytest
from django.core import mail
from django.core.files.storage import FileSystemStorage
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.exceptions import PermissionDenied

from apps.core.models import AuditLog
from apps.llamados import services
from apps.llamados.models import AccionLlamado, LlamadoAtencion
from apps.llamados.tests.conftest import (
    LLAMADOS,
    MIOS,
    PERSONAS,
    accion,
    cliente,
    codigo,
    detalles,
    emitir,
    hace,
    releer,
    usuario,
)
from apps.notificaciones.models import Notificacion

PDF = b"%PDF-1.4\n" + b"0" * 64


def _avisos(e, nombre, tipo=None):
    consulta = Notificacion.objects.filter(usuario=usuario(e, nombre))
    if tipo:
        consulta = consulta.filter(tipo=tipo)
    return list(consulta)


def _post(e, quien, llamado_id, nombre_accion, datos=None):
    return accion(e, quien, llamado_id, nombre_accion, datos)


# --- Emitir ----------------------------------------------------------------------------------


def test_emitir_el_primer_nivel_registra_avisa_y_no_envia_correo(e):
    respuesta = emitir(e)
    assert respuesta.status_code == 201, respuesta.content
    datos = respuesta.json()
    assert datos["estado"] == "emitido"
    assert datos["numero"].startswith("LLA-")
    assert datos["nivel_aplicado"]["nombre"] == "Primer llamado (verbal)"
    assert datos["emitido_por"]["nombre"] == "Carolina"
    assert datos["solicitado_por"] is None
    assert datos["correo"]["enviado"] is False
    assert datos["correo"]["estado"] == "no_aplica"
    assert mail.outbox == []
    assert [a["accion"] for a in datos["historial"]] == ["emitido"]
    avisos = _avisos(e, "ana", "llamados.emitido")
    assert len(avisos) == 1 and avisos[0].enlace == "/admin/perfil?seccion=llamados"
    assert LlamadoAtencion.objects.get(pk=datos["id"]).notificado_en is not None
    assert AuditLog.objects.filter(action="llamados.emitido", target_id=str(datos["id"])).exists()


def test_cambiar_el_nivel_exige_justificacion(e):
    _, escrito, _ = e["niveles"]
    sin = emitir(e, nivel=escrito.pk)
    assert sin.status_code == 400
    assert "justificacion_cambio" in detalles(sin)

    con = emitir(e, nivel=escrito.pk, justificacion_cambio="Ya se le advirtió verbalmente.")
    assert con.status_code == 201, con.content
    datos = con.json()
    assert datos["nivel_aplicado"]["id"] == escrito.pk
    assert datos["nivel_propuesto"]["nombre"] == "Primer llamado (verbal)"
    assert datos["justificacion_cambio"] == "Ya se le advirtió verbalmente."
    assert [a["accion"] for a in datos["historial"]][:2] == ["nivel_cambiado", "emitido"]


def test_la_sancion_economica_pide_monto_y_parte_del_sugerido(e):
    _, _, sancion = e["niveles"]
    justificacion = {"nivel": sancion.pk, "justificacion_cambio": "Falta grave."}
    # Sin monto: el sugerido.
    con_sugerido = emitir(e, **justificacion)
    assert con_sugerido.status_code == 201, con_sugerido.content
    assert con_sugerido.json()["monto"] == "25.00"
    # Con monto propio (coma decimal).
    propio = emitir(e, descripcion="Otro atraso.", monto="40,50", **justificacion)
    assert propio.json()["monto"] == "40.50"
    # Sin sugerido ni monto: 400.
    sancion.monto_sugerido = None
    sancion.save()
    sin = emitir(e, descripcion="Tercer atraso.", **justificacion)
    assert sin.status_code == 400 and "monto" in detalles(sin)
    cero = emitir(e, descripcion="Cuarto atraso.", monto="0", **justificacion)
    assert cero.status_code == 400 and "monto" in detalles(cero)


def test_un_nivel_que_no_es_sancion_no_guarda_monto(e):
    respuesta = emitir(e, monto="10")
    assert respuesta.status_code == 201
    assert respuesta.json()["monto"] is None


def test_datos_invalidos(e):
    futura = emitir(e, fecha_hecho=hace(-1))
    assert futura.status_code == 400 and "fecha_hecho" in detalles(futura)
    vacia = emitir(e, descripcion="   ")
    assert vacia.status_code == 400 and "descripcion" in detalles(vacia)
    a_si_misma = emitir(e, persona="carolina")
    assert a_si_misma.status_code == 400 and "persona" in detalles(a_si_misma)
    sin_causa = emitir(e, causa=999999)
    assert sin_causa.status_code == 400 and "causa" in detalles(sin_causa)
    e["causa"].activa = False
    e["causa"].save()
    inactiva = emitir(e)
    assert inactiva.status_code == 400 and "causa" in detalles(inactiva)


def test_el_doble_envio_no_registra_dos_veces(e):
    assert emitir(e).status_code == 201
    repetido = emitir(e)
    assert repetido.status_code == 409
    assert codigo(repetido) == "duplicado"
    assert LlamadoAtencion.objects.count() == 1


def test_el_correo_sale_solo_tras_el_commit(e):
    _, escrito, _ = e["niveles"]
    with e["tras_commit"](execute=False) as programados:
        respuesta = cliente(e, "carolina").post(
            LLAMADOS,
            {
                "persona": usuario(e, "ana").pk,
                "causa": e["causa"].pk,
                "fecha_hecho": hace(3),
                "descripcion": "Atraso.",
                "nivel": escrito.pk,
                "justificacion_cambio": "Ya advertida.",
            },
            format="json",
        )
    assert respuesta.status_code == 201
    assert respuesta.json()["correo"]["estado"] == "pendiente"
    assert mail.outbox == [] and len(programados) == 1
    programados[0]()  # el commit
    llamado = LlamadoAtencion.objects.get(pk=respuesta.json()["id"])
    assert llamado.correo_estado == "enviado" and len(mail.outbox) == 1
    assert AuditLog.objects.filter(action="llamados.correo", target_id=str(llamado.pk)).exists()
    programados[0]()  # un reintento no lo repite
    assert len(mail.outbox) == 1


def test_la_evidencia_se_borra_si_la_emision_falla(e, monkeypatch):
    borrados = []
    original = FileSystemStorage.delete

    def espia(self, nombre):
        borrados.append(nombre)
        return original(self, nombre)

    def falla(*args, **kwargs):
        raise RuntimeError("falla a mitad de la emisión")

    monkeypatch.setattr(FileSystemStorage, "delete", espia)
    monkeypatch.setattr(services, "_registrar", falla)
    archivo = SimpleUploadedFile("acta.pdf", PDF, content_type="application/pdf")
    with pytest.raises(RuntimeError):
        services.crear(
            usuario(e, "carolina"),
            modo="emitir",
            persona=usuario(e, "ana"),
            causa=e["causa"],
            fecha_hecho=services.hoy(),
            descripcion="Atraso con acta.",
            adjunto=archivo,
            adjunto_tipo="application/pdf",
        )
    assert LlamadoAtencion.objects.count() == 0
    assert len(borrados) == 1 and borrados[0].startswith("llamados/evidencias/")
    assert not FileSystemStorage().exists(borrados[0])


def test_la_evidencia_se_valida_y_se_ve_en_linea(e):
    archivo = SimpleUploadedFile("evidencia ñandú.pdf", PDF, content_type="application/pdf")
    respuesta = emitir(e, formato="multipart", adjunto=archivo)
    assert respuesta.status_code == 201, respuesta.content
    adjunto = respuesta.json()["adjunto"]
    assert adjunto["nombre"] == "evidencia ñandú.pdf" and adjunto["visor"] == "pdf"
    descarga = cliente(e, "carolina").get(f"{LLAMADOS}{respuesta.json()['id']}/adjunto/")
    assert descarga.status_code == 200
    assert descarga["Content-Disposition"].startswith("inline;")
    assert descarga["Content-Type"] == "application/pdf"
    assert descarga["X-Content-Type-Options"] == "nosniff"

    disfrazado = SimpleUploadedFile("acta.pdf", b"MZ\x90\x00" + b"0" * 64)
    malo = emitir(e, formato="multipart", descripcion="Otro.", adjunto=disfrazado)
    assert malo.status_code == 400 and "adjunto" in detalles(malo)


# --- Solicitar --------------------------------------------------------------------------------


def test_el_jefe_solicita_para_su_equipo_y_avisa_a_quienes_emiten(e):
    respuesta = emitir(e, quien="julia", monto="99", nivel=e["niveles"][2].pk)
    assert respuesta.status_code == 201, respuesta.content
    datos = respuesta.json()
    assert datos["estado"] == "solicitado"
    # Quien solicita no elige nivel ni monto: queda el propuesto.
    assert datos["nivel_aplicado"]["nombre"] == "Primer llamado (verbal)"
    assert datos["monto"] is None
    assert datos["solicitado_por"]["nombre"] == "Julia"
    assert datos["emitido_por"] is None
    assert len(_avisos(e, "carolina", "llamados.solicitado")) == 1
    assert _avisos(e, "victor") == []  # solo `ver`: no emite
    assert _avisos(e, "ana") == []  # a la persona, hasta que se confirme
    assert mail.outbox == []
    assert AuditLog.objects.filter(action="llamados.solicitado").exists()


def test_el_equipo_es_directo_o_indirecto(e):
    assert emitir(e, quien="gerardo", persona="olga").status_code == 201


def test_un_jefe_fuera_de_su_equipo_recibe_403(e):
    respuesta = emitir(e, quien="julia", persona="olga")
    assert respuesta.status_code == 403
    assert codigo(respuesta) == "fuera_de_su_equipo"
    assert emitir(e, quien="oscar", persona="ana").status_code == 403
    assert LlamadoAtencion.objects.count() == 0


def test_personas_segun_el_permiso(e):
    con_emitir = cliente(e, "carolina").get(PERSONAS).json()
    nombres = {p["nombre"] for p in con_emitir}
    assert {"Ana María Peñafiel", "Olga", "Julia"} <= nombres
    assert "Carolina" not in nombres
    del_equipo = cliente(e, "julia").get(PERSONAS).json()
    assert del_equipo == [
        {"id": usuario(e, "ana").pk, "nombre": "Ana María Peñafiel", "cargo": "Analista de Cartera"}
    ]
    buscadas = cliente(e, "carolina").get(PERSONAS, {"q": "peñaf"}).json()
    assert [p["nombre"] for p in buscadas] == ["Ana María Peñafiel"]
    assert cliente(e, "nadia").get(PERSONAS).status_code == 403
    # Con solo `ver`: toda la empresa, para el filtro de la lista.
    para_filtrar = {p["nombre"] for p in cliente(e, "victor").get(PERSONAS).json()}
    assert {"Ana María Peñafiel", "Olga", "Carolina"} <= para_filtrar
    assert "Victor" not in para_filtrar
    # Y un jefe puede pedir explícitamente esa lista solo si tiene `ver`.
    assert cliente(e, "julia").get(PERSONAS, {"modo": "ver"}).status_code == 403


def test_personas_carga_los_cargos_en_una_consulta(e, django_assert_max_num_queries):
    cliente(e, "carolina").get(PERSONAS)  # calienta permisos y sesión
    with django_assert_max_num_queries(12):
        filas = cliente(e, "carolina").get(PERSONAS).json()
    assert len(filas) >= 7


# --- Confirmar y rechazar ---------------------------------------------------------------------


def test_confirmar_emite_notifica_y_avisa_al_jefe(e):
    _, escrito, _ = e["niveles"]
    solicitado = emitir(e, quien="julia").json()
    respuesta = _post(
        e,
        "carolina",
        solicitado["id"],
        "confirmar",
        {
            "nivel": escrito.pk,
            "justificacion_cambio": "Ya tuvo una advertencia verbal no registrada.",
            "descripcion": "Llegó tarde tres veces; se le advirtió.",
        },
    )
    assert respuesta.status_code == 200, respuesta.content
    datos = releer(e, solicitado["id"])
    assert datos["estado"] == "emitido"
    assert datos["emitido_por"]["nombre"] == "Carolina"
    assert datos["solicitado_por"]["nombre"] == "Julia"
    assert datos["descripcion"] == "Llegó tarde tres veces; se le advirtió."
    assert datos["correo"]["enviado"] is True
    assert len(mail.outbox) == 1
    assert len(_avisos(e, "ana", "llamados.emitido")) == 1
    assert len(_avisos(e, "julia", "llamados.confirmado")) == 1
    acciones = [a["accion"] for a in datos["historial"]]
    assert acciones[0] == "solicitado" and "confirmado" in acciones and acciones[-1] == "correo"


def test_el_detalle_trae_la_propuesta_vigente(e):
    """QA-TECH P2: entre la solicitud y la confirmación se emitió otro de la
    misma causa. El detalle trae la propuesta de hoy (sin contar el propio);
    confirmar con el nivel viejo cuenta como cambio y sin justificación es 400."""
    verbal, escrito, _ = e["niveles"]
    solicitado = emitir(e, quien="julia").json()
    detalle = cliente(e, "carolina").get(f"{LLAMADOS}{solicitado['id']}/").json()
    assert detalle["propuesta_vigente"]["nivel"]["id"] == verbal.pk
    assert detalle["propuesta_vigente"]["cambio"] is False

    assert emitir(e, descripcion="Otro atraso ya emitido.").status_code == 201
    detalle = cliente(e, "carolina").get(f"{LLAMADOS}{solicitado['id']}/").json()
    vigente = detalle["propuesta_vigente"]
    assert vigente["nivel"]["id"] == escrito.pk and vigente["cambio"] is True
    assert detalle["nivel_propuesto"]["id"] == verbal.pk  # el de la solicitud

    viejo = _post(e, "carolina", solicitado["id"], "confirmar", {"nivel": verbal.pk})
    assert viejo.status_code == 400 and "justificacion_cambio" in detalles(viejo)
    vigente_ok = _post(e, "carolina", solicitado["id"], "confirmar", {"nivel": escrito.pk})
    assert vigente_ok.status_code == 200
    assert vigente_ok.json()["propuesta_vigente"] is None  # ya no se confirma

    # Quien no puede confirmar no la recibe.
    otro = emitir(e, quien="julia", descripcion="Otra solicitud.").json()
    assert cliente(e, "victor").get(f"{LLAMADOS}{otro['id']}/").json()["propuesta_vigente"] is None


def test_emisores_por_rol_de_la_membresia(e):
    from django.contrib.auth.models import Group, Permission

    from apps.empresas.models import MembresiaEmpresa

    rol = Group.objects.create(name="Gestión Humana (prueba)")
    rol.permissions.add(
        Permission.objects.get(content_type__app_label="permissions", codename="llamados.emitir")
    )
    MembresiaEmpresa.objects.get(usuario=usuario(e, "olga")).roles.add(rol)
    nombres = {u.username for u in services.emisores()}
    assert {"carolina", "olga"} <= nombres
    assert "victor" not in nombres and "julia" not in nombres


def test_confirmar_con_otro_nivel_exige_justificacion(e):
    _, escrito, _ = e["niveles"]
    solicitado = emitir(e, quien="julia").json()
    respuesta = _post(e, "carolina", solicitado["id"], "confirmar", {"nivel": escrito.pk})
    assert respuesta.status_code == 400
    assert "justificacion_cambio" in detalles(respuesta)
    assert LlamadoAtencion.objects.get(pk=solicitado["id"]).estado == "solicitado"


def test_solo_quien_emite_confirma(e):
    solicitado = emitir(e, quien="julia").json()
    for quien in ("julia", "victor", "nadia", "ana"):
        assert _post(e, quien, solicitado["id"], "confirmar").status_code in (403, 404), quien
    assert _post(e, "carolina", solicitado["id"], "confirmar").status_code == 200


def _dirigido_a_carolina(e, estado="solicitado"):
    """Un llamado que se le reasigna a mano a Carolina (Gestión Humana)."""
    if estado == "solicitado":
        datos = emitir(e, quien="gerardo", persona="julia", descripcion="Para Carolina.").json()
    else:
        datos = emitir(e, persona="julia", descripcion="Para Carolina.").json()
    llamado = LlamadoAtencion.objects.get(pk=datos["id"])
    llamado.persona = usuario(e, "carolina")
    llamado.save(update_fields=["persona"])
    return llamado


@pytest.mark.parametrize(
    ("estado", "hacer", "argumentos"),
    [
        ("solicitado", "confirmar", {}),
        ("solicitado", "rechazar", {"motivo": "No procede."}),
        ("emitido", "anular", {"motivo": "Error."}),
    ],
)
def test_nadie_decide_sobre_lo_suyo(e, estado, hacer, argumentos):
    """P1 de QA-TECH: ni confirmar, ni rechazar, ni anular lo propio. Por la
    API ni siquiera lo ve (404); el servicio lo niega igual (403)."""
    llamado = _dirigido_a_carolina(e, estado)
    respuesta = _post(e, "carolina", llamado.pk, hacer, argumentos)
    assert respuesta.status_code == 404
    with pytest.raises(PermissionDenied):
        getattr(services, hacer)(
            llamado,
            usuario(e, "carolina"),
            **({"motivo": argumentos["motivo"]} if "motivo" in argumentos else {}),
        )
    llamado.refresh_from_db()
    assert llamado.estado == estado
    assert services.puede_decidir(usuario(e, "carolina"), llamado) == {
        "confirmar": False,
        "rechazar": False,
        "anular": False,
        "reenviar": False,
    }


def test_gestion_humana_no_ve_lo_suyo_en_la_lista(e):
    llamado = _dirigido_a_carolina(e, "emitido")
    lista = {f["id"] for f in cliente(e, "carolina").get(LLAMADOS).json()}
    assert llamado.pk not in lista
    assert cliente(e, "carolina").get(f"{LLAMADOS}{llamado.pk}/").status_code == 404
    # Lo ve en Mi perfil, sin solicitante ni evidencia.
    mios = cliente(e, "carolina").get(MIOS).json()
    assert [m["id"] for m in mios] == [llamado.pk]
    assert "adjunto" not in mios[0] and "solicitado_por" not in mios[0]
    # Los demás de Gestión Humana sí lo ven.
    assert llamado.pk in {f["id"] for f in cliente(e, "victor").get(LLAMADOS).json()}


def test_rechazar_exige_motivo_y_avisa_al_jefe(e):
    solicitado = emitir(e, quien="julia").json()
    sin = _post(e, "carolina", solicitado["id"], "rechazar", {"motivo": " "})
    assert sin.status_code == 400 and "motivo" in detalles(sin)
    respuesta = _post(
        e, "carolina", solicitado["id"], "rechazar", {"motivo": "No hay evidencia suficiente."}
    )
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert datos["estado"] == "rechazado" and datos["motivo"] == "No hay evidencia suficiente."
    assert len(_avisos(e, "julia", "llamados.rechazado")) == 1
    assert _avisos(e, "ana") == []
    assert AuditLog.objects.filter(action="llamados.rechazado").exists()


def test_transiciones_invalidas(e):
    emitido = emitir(e).json()
    assert codigo(_post(e, "carolina", emitido["id"], "confirmar")) == "estado_invalido"
    assert _post(e, "carolina", emitido["id"], "rechazar", {"motivo": "x"}).status_code == 409
    solicitado = emitir(e, quien="julia", descripcion="Otra falta.").json()
    anular = _post(e, "carolina", solicitado["id"], "anular", {"motivo": "x"})
    assert anular.status_code == 409 and codigo(anular) == "estado_invalido"
    _post(e, "carolina", solicitado["id"], "rechazar", {"motivo": "Sin sustento."})
    assert _post(e, "carolina", solicitado["id"], "confirmar").status_code == 409


# --- Anular -----------------------------------------------------------------------------------


def test_anular_exige_motivo_avisa_y_deja_de_contar(e):
    emitido = emitir(e).json()
    sin = _post(e, "carolina", emitido["id"], "anular", {"motivo": ""})
    assert sin.status_code == 400 and "motivo" in detalles(sin)
    respuesta = _post(
        e, "carolina", emitido["id"], "anular", {"motivo": "Se registró a otra persona."}
    )
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert datos["estado"] == "anulado" and datos["motivo"] == "Se registró a otra persona."
    assert datos["anulado_por"]["nombre"] == "Carolina"
    assert len(_avisos(e, "ana", "llamados.anulado")) == 1
    assert AuditLog.objects.filter(action="llamados.anulado").exists()
    assert _post(e, "carolina", emitido["id"], "anular", {"motivo": "otra vez"}).status_code == 409
    assert AccionLlamado.objects.filter(llamado_id=emitido["id"], accion="anulado").count() == 1


def test_anular_sin_aviso_previo_no_avisa(e):
    emitido = emitir(e).json()
    LlamadoAtencion.objects.filter(pk=emitido["id"]).update(notificado_en=None)
    Notificacion.objects.all().delete()
    _post(e, "carolina", emitido["id"], "anular", {"motivo": "Error de registro."})
    assert _avisos(e, "ana") == []


# --- Ver, buscar y Mi perfil ------------------------------------------------------------------


def test_permisos_de_la_lista_y_el_detalle(e):
    propio = emitir(e, quien="julia").json()
    ajeno = emitir(e, persona="olga").json()
    assert cliente(e, "nadia").get(LLAMADOS).status_code == 403
    assert emitir(e, quien="nadia").status_code == 403
    assert emitir(e, quien="victor").status_code == 403  # `ver` no emite

    de_julia = cliente(e, "julia").get(LLAMADOS).json()
    assert [f["id"] for f in de_julia] == [propio["id"]]
    assert cliente(e, "julia").get(f"{LLAMADOS}{ajeno['id']}/").status_code == 404
    assert cliente(e, "julia").get(f"{LLAMADOS}{propio['id']}/").status_code == 200

    de_victor = {f["id"] for f in cliente(e, "victor").get(LLAMADOS).json()}
    assert de_victor == {propio["id"], ajeno["id"]}
    detalle = cliente(e, "victor").get(f"{LLAMADOS}{ajeno['id']}/").json()
    assert detalle["puede"] == {
        "confirmar": False,
        "rechazar": False,
        "anular": False,
        "reenviar": False,
    }
    for campo in (
        "persona",
        "causa",
        "nivel_aplicado",
        "nivel_propuesto",
        "estado",
        "fecha_hecho",
        "descripcion",
        "monto",
        "justificacion_cambio",
        "motivo",
        "solicitado_por",
        "emitido_por",
        "adjunto",
        "historial",
        "correo",
    ):
        assert campo in detalle, campo
    assert {"accion", "usuario", "fecha", "comentario"} <= set(detalle["historial"][0])
    assert {"enviado", "fecha", "asunto", "cuerpo"} <= set(detalle["correo"])


def test_filtros_de_la_lista(e):
    verbal, escrito, _ = e["niveles"]
    a = emitir(e, fecha_hecho=hace(40)).json()
    b = emitir(e, persona="olga", fecha_hecho=hace(5)).json()
    c = emitir(e, quien="julia", descripcion="Pendiente.", fecha_hecho=hace(2)).json()
    lista = cliente(e, "carolina")

    def ids(**filtros):
        respuesta = lista.get(LLAMADOS, filtros)
        assert respuesta.status_code == 200, respuesta.content
        return {f["id"] for f in respuesta.json()}

    assert ids(persona=usuario(e, "olga").pk) == {b["id"]}
    assert ids(estado="solicitado") == {c["id"]}
    assert ids(estado="emitido,solicitado") == {a["id"], b["id"], c["id"]}
    assert ids(desde=hace(10)) == {b["id"], c["id"]}
    assert ids(hasta=hace(10)) == {a["id"]}
    assert ids(causa=e["causa"].pk) == {a["id"], b["id"], c["id"]}
    # La solicitud de Julia ya propone el segundo nivel: Ana tiene el primero.
    assert ids(nivel=verbal.pk) == {a["id"], b["id"]}
    assert ids(nivel=escrito.pk) == {c["id"]}
    assert ids(q="peñafiel") == {a["id"], c["id"]}
    assert lista.get(LLAMADOS, {"estado": "otro"}).status_code == 400
    assert lista.get(LLAMADOS, {"desde": "12/11/2026"}).status_code == 400


def test_mios_sin_solicitados_ni_rechazados_ni_solicitante(e):
    emitido = emitir(e).json()
    anulado = emitir(e, descripcion="Registrado por error.").json()
    _post(e, "carolina", anulado["id"], "anular", {"motivo": "Error."})
    pendiente = emitir(e, quien="julia", descripcion="Pendiente de revisión.").json()
    rechazado = emitir(e, quien="julia", descripcion="Sin sustento.").json()
    _post(e, "carolina", rechazado["id"], "rechazar", {"motivo": "No procede."})

    mios = cliente(e, "ana").get(MIOS).json()
    assert {m["id"] for m in mios} == {emitido["id"], anulado["id"]}
    assert pendiente["id"] not in {m["id"] for m in mios}
    marcado = next(m for m in mios if m["id"] == anulado["id"])
    assert marcado["anulado"] is True and marcado["estado"] == "anulado"
    for fila in mios:
        assert "solicitado_por" not in fila and "emitido_por" not in fila
        assert {"fecha_hecho", "causa", "nivel", "descripcion", "monto"} <= set(fila)
    # Nadie ve los de otro.
    assert cliente(e, "olga").get(MIOS).json() == []
    assert cliente(e, "nadia").get(MIOS).status_code == 200
