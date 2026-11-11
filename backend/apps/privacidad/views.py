"""Endpoints de derechos sobre datos personales (`/api/v1/privacidad/`),
portados de las rutas `/api/data-requests` de Nexo.

Dos lados:

- **El titular** (`mis-solicitudes/`, `mis-datos/`): toda cuenta con sesión,
  sin permiso. Ve y descarga solo lo suyo; una solicitud ajena responde 404.
- **Quien atiende** (`solicitudes/`): la bandeja y el detalle piden
  `privacidad.ver` o `privacidad.atender`; cambiar el estado y descargar los
  datos de un titular, `privacidad.atender`.

Las vistas solo resuelven parámetros y delegan en `services.py` y
`mis_datos.py`. Los errores salen en el contrato uniforme
`{"error": {"code", "message", "details"}}`. Los 400 de este módulo no pasan
por el registro automático de fallos de validación (`apps.core.exceptions`),
que copia el cuerpo de la petición a la auditoría: el cuerpo es la descripción
de la solicitud, que no debe quedar en un registro que no se borra.

El módulo no se apaga (no está en `apps.empresas.modulos`): ejercer un derecho
no puede depender de que una empresa tenga encendido un módulo.
"""

from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle, UserRateThrottle
from rest_framework.views import APIView

from apps.core.pagination import DefaultPagination
from apps.core.request_meta import get_request_context
from apps.core.responses import error_response
from apps.descargas.middleware import marcar
from apps.permissions.permissions import Requiere

from . import access, consentimiento, mis_datos, serializers, services, textos
from .models import SolicitudDerechos
from .services import PrivacidadError

#: La descarga no se copia al registro de descargas: una copia de los datos
#: personales completos de alguien, guardada un año y abierta a quien audita
#: descargas, sería justo lo que esta función existe para controlar. Queda el
#: registro (quién, cuándo, la huella), como con el rol de pagos.
SIN_COPIA = "Datos personales del titular (LOPDP): no se guarda copia"

FORMATOS = {"json", "xlsx"}


def _primer_mensaje(detalle) -> str | None:
    if isinstance(detalle, str):
        return detalle
    if isinstance(detalle, dict):
        for valor in detalle.values():
            mensaje = _primer_mensaje(valor)
            if mensaje:
                return mensaje
    if isinstance(detalle, (list, tuple)):
        for valor in detalle:
            mensaje = _primer_mensaje(valor)
            if mensaje:
                return mensaje
    return None


class PrivacidadView(APIView):
    permission_classes = [IsAuthenticated]

    @property
    def context(self) -> dict:
        return get_request_context(self.request)

    def handle_exception(self, exc):
        if isinstance(exc, PrivacidadError):
            return error_response(exc.code, exc.message, exc.status, exc.details)
        return super().handle_exception(exc)

    def validated(self, serializer_class, data=None):
        serializer = serializer_class(data=self.request.data if data is None else data)
        if not serializer.is_valid():
            detalles = {
                campo: [str(e) for e in errores] for campo, errores in serializer.errors.items()
            }
            raise PrivacidadError(_primer_mensaje(detalles) or "Datos inválidos.", details=detalles)
        return serializer.validated_data


def _formato(request) -> str:
    formato = (request.query_params.get("formato") or "json").lower()
    if formato not in FORMATOS:
        raise PrivacidadError(
            "Formato inválido: use json o xlsx.", details={"formato": ["Use json o xlsx."]}
        )
    return formato


def _archivo(request, *, titular, solicitud, formato: str) -> HttpResponse:
    """El archivo de «mis datos», anotado para el registro de descargas
    (`apps.descargas`: el middleware guarda su huella con esta referencia)."""
    contenido = mis_datos.armar(titular=titular, lector=request.user)
    if formato == "xlsx":
        cuerpo, tipo = mis_datos.a_excel(contenido), mis_datos.CONTENT_TYPE_XLSX
    else:
        cuerpo, tipo = mis_datos.a_json(contenido), "application/json; charset=utf-8"
    referencia = {"titular": titular.pk, "formato": formato}
    if solicitud is not None:
        referencia["solicitud"] = solicitud.numero
    marcar(request, modulo="privacidad", sin_copia=SIN_COPIA, **referencia)
    services.registrar_descarga(
        actor=request.user,
        titular=titular,
        solicitud=solicitud,
        formato=formato,
        context=get_request_context(request),
    )
    sufijo = f"-{solicitud.numero}" if solicitud is not None else ""
    nombre = f"mis-datos-{titular.username}{sufijo}.{formato}"
    respuesta = HttpResponse(cuerpo, content_type=tipo)
    respuesta["Content-Disposition"] = f'attachment; filename="{nombre}"'
    respuesta["Cache-Control"] = "no-store"
    respuesta["X-Content-Type-Options"] = "nosniff"
    return respuesta


# ── El titular ────────────────────────────────────────────────────────────────


class ResumenView(PrivacidadView):
    """`GET /privacidad/me/`: qué puede hacer la persona (pedir siempre; ver y
    atender la bandeja según sus permisos), el plazo vigente y los tipos y
    estados con su nombre."""

    def get(self, request):
        return Response(services.resumen_de_acceso(request.user))


class MisSolicitudesView(PrivacidadView):
    """`GET /privacidad/mis-solicitudes/`: las solicitudes propias en la
    empresa activa, de la más nueva a la más vieja.

    `POST /privacidad/mis-solicitudes/`: pide `{"tipo", "descripcion"}`
    (obligatoria en RECTIFICACION). 201 si la crea; 200 con la misma si ya
    había una abierta idéntica (doble clic)."""

    def get(self, request):
        return Response(
            [serializers.del_titular(s) for s in services.mias(request.user).order_by("-id")]
        )

    def post(self, request):
        datos = self.validated(serializers.CrearSolicitudSerializer)
        solicitud, creada = services.crear_solicitud(
            actor=request.user,
            tipo=datos["tipo"],
            descripcion=datos.get("descripcion") or "",
            context=self.context,
        )
        return Response(
            serializers.del_titular(solicitud, con_historial=True),
            status=status.HTTP_201_CREATED if creada else status.HTTP_200_OK,
        )


class MiSolicitudView(PrivacidadView):
    """`GET /privacidad/mis-solicitudes/<id>/`: la solicitud propia con cada
    cambio de estado y su respuesta."""

    def get(self, request, pk):
        solicitud = services.obtener_propia(request.user, pk)
        return Response(serializers.del_titular(solicitud, con_historial=True))


class MisDatosView(PrivacidadView):
    """`GET /privacidad/mis-datos/?formato=json|xlsx`: descarga lo que la
    intranet guarda de la persona (ver `mis_datos`). Limitada
    (`privacidad_datos`): arma consultas sobre todo el sistema."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "privacidad_datos"

    def get(self, request):
        formato = _formato(request)
        return _archivo(request, titular=request.user, solicitud=None, formato=formato)


class SeccionesView(PrivacidadView):
    """`GET /privacidad/mis-datos/secciones/`: qué incluye la descarga y qué
    no, con el motivo, para mostrarlo antes de pedirla."""

    def get(self, request):
        return Response(mis_datos.descripcion_de_secciones())


# ── Quien atiende ─────────────────────────────────────────────────────────────


class BandejaView(PrivacidadView):
    """`GET /privacidad/solicitudes/?estado=&tipo=&vencidas=1&q=&page=`: las
    solicitudes de la empresa activa, paginadas, las abiertas primero por fecha
    límite (`privacidad.ver` o `privacidad.atender`). Responde además los
    totales de abiertas y vencidas, para el encabezado."""

    permission_classes = [IsAuthenticated, Requiere(*access.ALL_CODENAMES)]

    def get(self, request):
        filtros = self.validated(serializers.FiltrosBandejaSerializer, data=request.query_params)
        consulta = services.bandeja(
            request.user,
            estado=filtros.get("estado") or "",
            tipo=filtros.get("tipo") or "",
            vencidas=filtros.get("vencidas", False),
            q=filtros.get("q") or "",
        )
        paginador = DefaultPagination()
        pagina = paginador.paginate_queryset(consulta, request, view=self)
        respuesta = paginador.get_paginated_response([serializers.de_bandeja(s) for s in pagina])
        abiertas = services.bandeja(request.user).exclude(estado__in=SolicitudDerechos.FINALES)
        respuesta.data["totales"] = {
            "abiertas": abiertas.count(),
            "vencidas": services.bandeja(request.user, vencidas=True).count(),
        }
        return respuesta


class SolicitudView(PrivacidadView):
    """`GET /privacidad/solicitudes/<id>/`: el detalle con el titular y el
    historial (quién movió cada estado)."""

    permission_classes = [IsAuthenticated, Requiere(*access.ALL_CODENAMES)]

    def get(self, request, pk):
        solicitud = services.obtener_de_bandeja(request.user, pk)
        datos = serializers.de_bandeja(solicitud, con_historial=True)
        datos["puede_descargar_datos"] = access.puede_atender(request.user) and (
            solicitud.tipo == SolicitudDerechos.Tipo.ACCESO and not solicitud.cerrada
        )
        return Response(datos)


class CambiarEstadoView(PrivacidadView):
    """`POST /privacidad/solicitudes/<id>/estado/` (`privacidad.atender`):
    `{"estado", "respuesta", "estado_esperado"}`. La respuesta es obligatoria al
    cerrar (RESUELTA, RECHAZADA) y al reabrir; si `estado_esperado` no coincide
    con el actual, 409. Avisa al titular por la campana y por correo."""

    permission_classes = [IsAuthenticated, Requiere(access.ATENDER)]

    def post(self, request, pk):
        services.obtener_de_bandeja(request.user, pk)
        datos = self.validated(serializers.CambiarEstadoSerializer)
        solicitud = services.cambiar_estado(
            actor=request.user,
            solicitud_id=pk,
            estado=datos["estado"],
            respuesta=datos.get("respuesta") or "",
            estado_esperado=datos.get("estado_esperado"),
            context=self.context,
        )
        solicitud = services.obtener_de_bandeja(request.user, solicitud.pk)
        return Response(serializers.de_bandeja(solicitud, con_historial=True))


class DatosDelTitularView(PrivacidadView):
    """`GET /privacidad/solicitudes/<id>/datos/?formato=json|xlsx`
    (`privacidad.atender`): los datos del titular, para responder su solicitud
    de ACCESO. Solo de una de ACCESO abierta: lo que justifica abrir los datos
    de otra persona es tener que responderle. Sin el chat ni el Escritorio, y
    con los datos de salud según el permiso de quien descarga (ver
    `mis_datos`). Queda en la auditoría y en el registro de descargas."""

    permission_classes = [IsAuthenticated, Requiere(access.ATENDER)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "privacidad_datos"

    def get(self, request, pk):
        solicitud = services.obtener_de_bandeja(request.user, pk)
        if solicitud.tipo != SolicitudDerechos.Tipo.ACCESO:
            raise PrivacidadError(
                "Los datos del titular se descargan solo para responder una solicitud de acceso.",
                code="no_es_de_acceso",
                status=409,
            )
        if solicitud.cerrada:
            raise PrivacidadError(
                "La solicitud ya está cerrada. Reábrala si necesita volver a responderla.",
                code="solicitud_cerrada",
                status=409,
            )
        formato = _formato(request)
        return _archivo(request, titular=solicitud.titular, solicitud=solicitud, formato=formato)


# ── Consentimiento del tratamiento de datos ───────────────────────────────────


class ConsentimientoView(PrivacidadView):
    """`GET /privacidad/consentimiento/`: el aviso vigente y si la persona lo
    aceptó. `POST` con `{"version"}`: lo acepta (toda cuenta con sesión). 201
    al registrarla, 200 si ya lo había aceptado; 409 si el aviso cambió."""

    def get(self, request):
        return Response(consentimiento.estado_propio(request.user))

    def post(self, request):
        datos = self.validated(serializers.AceptarAvisoSerializer)
        antes = consentimiento.acepto(request.user)
        aceptacion = consentimiento.aceptar(
            usuario=request.user, version=datos["version"], context=self.context
        )
        return Response(
            consentimiento.de_aceptacion(aceptacion, con_texto=False),
            status=status.HTTP_200_OK if antes else status.HTTP_201_CREATED,
        )


class AvisoView(PrivacidadView):
    """`GET /privacidad/consentimiento/aviso/` (`privacidad.ver` o
    `.atender`): el aviso con su versión, la versión exigida y cuántos lo
    aceptaron. `PUT` (`privacidad.textos` desde US-004) con
    `{"texto", "pedir_aceptacion_de_nuevo"}`: se mantiene para la pantalla de
    hoy y hace lo mismo que `PUT /privacidad/textos/aviso_privacidad/`, que es
    donde se edita desde US-004 (CA-7)."""

    def get_permissions(self):
        if self.request.method == "PUT":
            return [IsAuthenticated(), Requiere(access.TEXTOS)()]
        return [IsAuthenticated(), Requiere(*access.ALL_CODENAMES)()]

    def get(self, request):
        return Response(consentimiento.resumen_del_aviso(request.user))

    def put(self, request):
        datos = self.validated(serializers.GuardarAvisoSerializer)
        consentimiento.guardar_aviso(
            actor=request.user,
            texto=datos["texto"],
            pedir_de_nuevo=datos.get("pedir_aceptacion_de_nuevo", False),
            context=self.context,
        )
        return Response(consentimiento.resumen_del_aviso(request.user))


class PersonasConsentimientoView(PrivacidadView):
    """`GET /privacidad/consentimiento/personas/?q=&estado=ACEPTADO|PENDIENTE`:
    las personas de la empresa con su estado frente al aviso vigente,
    paginadas."""

    permission_classes = [IsAuthenticated, Requiere(*access.ALL_CODENAMES)]

    def get(self, request):
        filtros = self.validated(
            serializers.FiltrosConsentimientoSerializer, data=request.query_params
        )
        consulta, aviso = consentimiento.listado(
            request.user, q=filtros.get("q") or "", estado=filtros.get("estado") or ""
        )
        paginador = DefaultPagination()
        pagina = paginador.paginate_queryset(consulta, request, view=self)
        ultimas = consentimiento.ultimas_aceptaciones(u.pk for u in pagina)
        return paginador.get_paginated_response(
            [consentimiento.de_persona(u, aviso, ultimas) for u in pagina]
        )


class PersonaConsentimientoView(PrivacidadView):
    """`GET /privacidad/consentimiento/personas/<id>/`: el historial de
    aceptaciones de una persona, con el texto de cada una."""

    permission_classes = [IsAuthenticated, Requiere(*access.ALL_CODENAMES)]

    def get(self, request, pk):
        return Response(consentimiento.historial(request.user, pk))


class RestablecerConsentimientoView(PrivacidadView):
    """`POST /privacidad/consentimiento/personas/<id>/restablecer/`
    (`privacidad.atender`): la persona vuelve a aceptar al entrar."""

    permission_classes = [IsAuthenticated, Requiere(access.ATENDER)]

    def post(self, request, pk):
        marcadas = consentimiento.restablecer(
            actor=request.user, usuario_id=pk, context=self.context
        )
        datos = consentimiento.historial(request.user, pk)
        datos["restablecidas"] = marcadas
        return Response(datos)


class RestablecerTodosView(PrivacidadView):
    """`POST /privacidad/consentimiento/restablecer-todos/` con
    `{"confirmar": true}` (`privacidad.atender`): toda la empresa vuelve a
    aceptar al entrar."""

    permission_classes = [IsAuthenticated, Requiere(access.ATENDER)]

    def post(self, request):
        datos = self.validated(serializers.ConfirmarSerializer)
        if not datos["confirmar"]:
            raise PrivacidadError(
                "Confirme que quiere restablecer el consentimiento de todas las personas.",
                details={"confirmar": ["Hace falta confirmarlo."]},
            )
        marcadas = consentimiento.restablecer_todos(actor=request.user, context=self.context)
        return Response({"restablecidas": marcadas})


# ── Textos de protección de datos y sus aceptaciones (US-004) ─────────────────


class TextosView(PrivacidadView):
    """`GET /privacidad/textos/` (`privacidad.ver`, `.atender` o `.textos`):
    el catálogo de la empresa activa, agrupado por módulo y sección:
    `{"puede_editar", "modulos": [{"modulo", "secciones": [{"seccion",
    "textos": [...]}]}]}`. Cada texto: `textos.de_texto`."""

    permission_classes = [IsAuthenticated, Requiere(*access.VER_TEXTOS)]

    def get(self, request):
        return Response(
            {
                "puede_editar": access.puede_editar_textos(request.user),
                "modulos": textos.catalogo(),
            }
        )


class TextoView(PrivacidadView):
    """`PUT /privacidad/textos/<clave>/` (`privacidad.textos`) con
    `{"texto", "titulo"?, "motivo"?, "pedir_de_nuevo"?}`: guarda el texto
    (20 a 6000 caracteres; el título solo en el acuerdo de confidencialidad;
    `pedir_de_nuevo` solo cuenta en el aviso general). Devuelve el texto como
    en el catálogo. 404 si la clave no existe."""

    permission_classes = [IsAuthenticated, Requiere(access.TEXTOS)]

    def put(self, request, clave):
        datos_catalogo = textos.entrada(clave)
        datos = self.validated(serializers.GuardarTextoSerializer)
        texto = textos.guardar(
            clave,
            texto=datos["texto"],
            titulo=datos.get("titulo"),
            motivo=datos.get("motivo") or "",
            pedir_de_nuevo=datos.get("pedir_de_nuevo"),
            actor=request.user,
            context=self.context,
        )
        return Response(textos.de_texto(datos_catalogo, texto))


class TextoVigenteView(PrivacidadView):
    """`GET /privacidad/textos/<clave>/vigente/` (toda cuenta con sesión):
    `{"clave", "version", "texto", "titulo"}`, el texto que se le muestra
    para aceptarlo o leerlo, con las variables (`{plazo}`) ya reemplazadas.
    404 si la clave no existe o si es el aviso general y la empresa no tiene."""

    def get(self, request, clave):
        datos = textos.vigente(clave)
        if datos is None:
            raise PrivacidadError("Texto no encontrado.", code="not_found", status=404)
        return Response(datos)


class VersionesTextoView(PrivacidadView):
    """`GET /privacidad/textos/<clave>/versiones/` (`privacidad.ver`,
    `.atender` o `.textos`): cada versión, de la más nueva a la más vieja,
    con quién la guardó, cuándo y por qué."""

    permission_classes = [IsAuthenticated, Requiere(*access.VER_TEXTOS)]

    def get(self, request, clave):
        textos.entrada(clave)
        return Response(textos.versiones(clave))


class AceptacionesView(PrivacidadView):
    """`GET /privacidad/aceptaciones/?clave=&modulo=&seccion=&persona=&estado=
    vigente|retirada|restablecida&page=&page_size=` (`privacidad.ver` o `.atender`): las
    aceptaciones de la empresa activa, de la más reciente, paginadas."""

    permission_classes = [IsAuthenticated, Requiere(*access.ALL_CODENAMES)]

    def get(self, request):
        filtros = self.validated(serializers.FiltrosAceptacionesSerializer, request.query_params)
        consulta = textos.aceptaciones(**_filtros_de_aceptaciones(filtros))
        paginador = DefaultPagination()
        pagina = paginador.paginate_queryset(consulta, request, view=self)
        return paginador.get_paginated_response([textos.de_aceptacion(a) for a in pagina])


class AceptacionView(PrivacidadView):
    """`GET /privacidad/aceptaciones/<id>/`: una aceptación con el texto y el
    título exactos que se aceptaron. La de otra empresa, 404."""

    permission_classes = [IsAuthenticated, Requiere(*access.ALL_CODENAMES)]

    def get(self, request, pk):
        return Response(textos.de_aceptacion(textos.obtener_aceptacion(pk), con_texto=True))


class _ExcelDeAceptacionesThrottle(UserRateThrottle):
    """Límite propio del Excel de aceptaciones (QA-TECH, 11/11/2026): no
    comparte el cupo de la descarga de «mis datos». La tasa se puede fijar en
    `DEFAULT_THROTTLE_RATES["privacidad_aceptaciones_excel"]`; si no está,
    30 por hora."""

    scope = "privacidad_aceptaciones_excel"
    POR_DEFECTO = "30/hour"

    def get_rate(self):
        from django.conf import settings

        tasas = settings.REST_FRAMEWORK.get("DEFAULT_THROTTLE_RATES", {})
        return tasas.get(self.scope) or self.POR_DEFECTO


class AceptacionesExcelView(PrivacidadView):
    """`GET /privacidad/aceptaciones/excel/?…` (los filtros del listado): las
    aceptaciones en Excel. Queda en la auditoría y en el registro de
    descargas (lleva IP y navegador de las personas)."""

    permission_classes = [IsAuthenticated, Requiere(*access.ALL_CODENAMES)]
    throttle_classes = [_ExcelDeAceptacionesThrottle]

    def get(self, request):
        filtros = _filtros_de_aceptaciones(
            self.validated(serializers.FiltrosAceptacionesSerializer, request.query_params)
        )
        consulta = textos.aceptaciones(**filtros)
        cuerpo = textos.a_excel(consulta)
        usados = {k: v for k, v in filtros.items() if v}
        marcar(request, modulo="privacidad", tipo="aceptaciones", **usados)
        services._audit(
            request.user,
            "aceptaciones.exportadas",
            nuevo={"filtros": usados},
            context=self.context,
        )
        respuesta = HttpResponse(cuerpo, content_type=mis_datos.CONTENT_TYPE_XLSX)
        respuesta["Content-Disposition"] = (
            'attachment; filename="aceptaciones-proteccion-datos.xlsx"'
        )
        respuesta["Cache-Control"] = "no-store"
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta


def _filtros_de_aceptaciones(filtros: dict) -> dict:
    return {
        campo: filtros.get(campo) or ""
        for campo in ("clave", "modulo", "seccion", "persona", "estado")
    }
