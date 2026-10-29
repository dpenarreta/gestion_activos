import json
from urllib.parse import quote

from django.http import FileResponse, Http404, HttpResponse
from rest_framework import serializers, status
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context
from apps.descargas.middleware import marcar
from apps.permissions.authorization import user_has_permission
from apps.permissions.permissions import Requiere

from . import auditado, aviso, fuente, services
from .models import AVISO_DIAS_MAXIMO

MODULO = "roles_pago"
#: Por qué las descargas del rol de pagos no guardan copia (apps.descargas).
SIN_COPIA = "Rol de pagos: no se guarda; se vuelve a generar desde nómina"


def _ip(request):
    return get_request_context(request).get("ip_address") or None


#: Consultar el propio rol: solo quien está en la lista de habilitados
#: (`roles_pago.consultar`, persona por persona; 22/10/2026).
PROPIO = Requiere("roles_pago.consultar")
#: La pantalla la abre quien está habilitado o quien gestiona algo de ella
#: (la lista, el historial, los textos o las observaciones).
PANTALLA = Requiere(
    "roles_pago.consultar",
    "roles_pago.habilitar",
    "roles_pago.historial",
    "roles_pago.configurar",
    "roles_pago.observaciones",
    "roles_pago.descarga_masiva",
    "roles_pago.seguimiento",
)


class EstadoView(APIView):
    """Lo que necesita la pantalla: el código de la sesión, los términos
    vigentes, el correo guardado (enmascarado) y qué puede hacer."""

    permission_classes = [IsAuthenticated, PANTALLA]

    def get(self, request):
        config = services.configuracion()
        guardado = services.correo_guardado(request.user)
        return Response(
            {
                "codigo": services.codigo_de(request.user),
                "terminos": config.terminos,
                "version": config.version,
                "consentimiento_correo": config.consentimiento_correo,
                "correo_guardado": services.enmascarar(guardado),
                "disponible": fuente.disponible(),
                "puede_consultar_otros": services.consulta_otros(request.user),
                "puede_configurar": user_has_permission(request.user, "roles_pago.configurar"),
                "puede_ver_historial": services.ve_historial(request.user),
                # Si está en la lista de habilitados: sin eso, la pantalla solo
                # ofrece lo que gestiona.
                "habilitado": services.habilitado(request.user),
                "puede_habilitar": services.gestiona_habilitados(request.user),
                "puede_ver_observaciones": services.atiende_observaciones(request.user),
                "puede_descarga_masiva": services.descarga_masiva_permitida(request.user),
                "puede_seguimiento": services.hace_seguimiento(request.user),
                # Cuándo abrió cada uno de sus roles y cuándo dio su
                # conformidad, con fecha, hora e IP.
                "mis_roles": services.mis_roles(request.user),
                # Correcciones de Talento Humano que debe volver a confirmar.
                "por_confirmar": services.por_confirmar(request.user),
            }
        )


class _Consulta(serializers.Serializer):
    anio = serializers.IntegerField()
    mes = serializers.IntegerField()
    acepto = serializers.BooleanField()
    version = serializers.IntegerField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    codigo = serializers.CharField(required=False, allow_blank=True, max_length=40)


class ConsultarView(APIView):
    """Acepta los términos, confirma la contraseña y devuelve el PDF (que no
    se guarda). Los intentos se limitan (`rol_pagos`)."""

    permission_classes = [IsAuthenticated, PROPIO]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "rol_pagos"

    def post(self, request):
        entrada = _Consulta(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        try:
            consulta, contenido = services.consultar(
                request.user,
                anio=datos["anio"],
                mes=datos["mes"],
                acepto=datos["acepto"],
                version=datos["version"],
                password=datos["password"],
                codigo=datos.get("codigo"),
                ip=_ip(request),
                navegador=request.META.get("HTTP_USER_AGENT", ""),
            )
        except Exception as error:
            # El intento fallido queda en la auditoría (sin la contraseña).
            record_audit_event(
                actor=request.user,
                action="roles_pago.consulta.rechazada",
                target=request.user,
                module=MODULO,
                result="failure",
                new_values={
                    "anio": datos["anio"],
                    "mes": datos["mes"],
                    "codigo": datos.get("codigo") or services.codigo_de(request.user),
                    "motivo": str(getattr(error, "detail", error))[:200],
                },
                context=get_request_context(request),
            )
            raise
        record_audit_event(
            actor=request.user,
            action="roles_pago.consulta.realizada",
            target=consulta,
            module=MODULO,
            new_values={
                "anio": consulta.anio,
                "mes": consulta.mes,
                "codigo": consulta.codigo_empleado,
                "version_terminos": consulta.version_terminos,
            },
            context=get_request_context(request),
        )
        # Si lo descarga, queda el registro pero no la copia (los términos
        # dicen que el documento no se guarda); se vuelve a generar.
        marcar(
            request,
            sin_copia=SIN_COPIA,
            tipo="rol_pagos",
            consulta=consulta.pk,
            codigo=consulta.codigo_empleado,
            anio=consulta.anio,
            mes=consulta.mes,
        )
        respuesta = HttpResponse(contenido, content_type="application/pdf")
        respuesta["Content-Disposition"] = (
            f'inline; filename="rol-de-pagos-{consulta.anio}-{consulta.mes:02d}.pdf"'
        )
        respuesta["X-Consulta-Rol"] = str(consulta.pk)
        respuesta["Access-Control-Expose-Headers"] = "X-Consulta-Rol, X-Rol-Aceptado"
        # Ya lo aceptó: es el rol guardado y la pantalla no vuelve a preguntar.
        if consulta.aceptacion is not None:
            constancia = services.constancia_de_conformidad(consulta.aceptacion.consulta)
            constancia.pop("conformidad_en", None)
            respuesta["X-Rol-Aceptado"] = json.dumps(constancia, ensure_ascii=True)
        respuesta["Cache-Control"] = "no-store, private"
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta


class _Envio(serializers.Serializer):
    consulta = serializers.IntegerField()
    correo = serializers.CharField(required=False, allow_blank=True, max_length=254)
    guardar = serializers.BooleanField(default=False)
    acepto_guardar = serializers.BooleanField(default=False)


class EnviarView(APIView):
    """Vuelve a generar el PDF de la consulta reciente y lo envía al correo
    personal (el escrito ahora o el guardado)."""

    permission_classes = [IsAuthenticated, PROPIO]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "rol_pagos_envio"

    def post(self, request):
        entrada = _Envio(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        destino = services.enviar(
            request.user,
            datos["consulta"],
            correo=datos.get("correo", ""),
            guardar=datos["guardar"],
            acepto_guardar=datos["acepto_guardar"],
        )
        record_audit_event(
            actor=request.user,
            action="roles_pago.envio",
            target=request.user,
            module=MODULO,
            new_values={
                "consulta": datos["consulta"],
                "a": destino,
                # Sin «correo» en el nombre: la auditoría enmascara esas claves.
                "guardo_el_destino": bool(datos["guardar"] and datos["acepto_guardar"]),
            },
            context=get_request_context(request),
        )
        return Response({"enviado_a": destino})


class _Conformidad(serializers.Serializer):
    consulta = serializers.IntegerField()
    conformidad = serializers.CharField(max_length=20)
    observacion = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class ConformidadView(APIView):
    """Si la persona está de acuerdo con su rol de pagos (o al cerrar el
    visor sin responder, que cuenta como conforme)."""

    permission_classes = [IsAuthenticated, PROPIO]

    def post(self, request):
        entrada = _Conformidad(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        consulta = services.registrar_conformidad(
            request.user,
            datos["consulta"],
            datos["conformidad"],
            datos.get("observacion", ""),
            ip=_ip(request),
            navegador=request.META.get("HTTP_USER_AGENT", ""),
        )
        record_audit_event(
            actor=request.user,
            action="roles_pago.conformidad",
            target=consulta,
            module=MODULO,
            new_values={
                "conformidad": consulta.conformidad,
                "anio": consulta.anio,
                "mes": consulta.mes,
                "con_observacion": bool(consulta.observacion),
            },
            context=get_request_context(request),
        )
        return Response(services.constancia_de_conformidad(consulta))


class CorreoPersonalView(APIView):
    """Retirar el correo personal guardado."""

    permission_classes = [IsAuthenticated, PROPIO]

    def delete(self, request):
        services.guardar_correo(request.user, None)
        record_audit_event(
            actor=request.user,
            action="roles_pago.correo_personal.retirado",
            target=request.user,
            module=MODULO,
            context=get_request_context(request),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class _Configuracion(serializers.Serializer):
    terminos = serializers.CharField(max_length=4000)
    consentimiento_correo = serializers.CharField(max_length=2000)
    # El aviso del primer día hábil (aviso del rol de pagos, 29/10/2026).
    # Opcionales: lo que no llegue se queda como está.
    aviso_activo = serializers.BooleanField(required=False)
    aviso_titulo = serializers.CharField(required=False, allow_blank=True, max_length=150)
    aviso_mensaje = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    aviso_titulo_vencido = serializers.CharField(required=False, allow_blank=True, max_length=150)
    aviso_mensaje_vencido = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    aviso_dias_habiles = serializers.IntegerField(
        required=False,
        min_value=1,
        max_value=AVISO_DIAS_MAXIMO,
        error_messages={
            "min_value": "Debe ser al menos 1 día hábil.",
            "max_value": f"No puede pasar de {AVISO_DIAS_MAXIMO} días hábiles.",
        },
    )

    def validate(self, datos):
        # Encendido, el aviso necesita sus dos títulos (los que llegan o, si
        # no llegan, los guardados).
        config = services.configuracion()
        activo = datos.get("aviso_activo", config.aviso_activo)
        if activo:
            errores = {}
            for campo in ("aviso_titulo", "aviso_titulo_vencido"):
                if not str(datos.get(campo, getattr(config, campo)) or "").strip():
                    errores[campo] = "Con el aviso encendido, escriba el título."
            if errores:
                raise serializers.ValidationError(errores)
        return datos


def _textos(config) -> dict:
    return {
        "terminos": config.terminos,
        "version": config.version,
        "consentimiento_correo": config.consentimiento_correo,
        **{campo: getattr(config, campo) for campo in services.CAMPOS_AVISO},
    }


def _aviso_auditado(config) -> dict:
    """Lo que la auditoría guarda del aviso: los valores tal cual (no hay
    datos personales en estos textos)."""
    return {campo: getattr(config, campo) for campo in services.CAMPOS_AVISO}


class ConfiguracionView(APIView):
    """Los textos (términos, consentimiento del correo y el aviso del primer
    día hábil), con `roles_pago.configurar`. Cambiar los términos sube su
    versión."""

    permission_classes = [IsAuthenticated]

    def _sin_permiso(self, request):
        if user_has_permission(request.user, "roles_pago.configurar"):
            return None
        return Response(
            {"detail": "No tiene el permiso requerido: roles_pago.configurar."},
            status=status.HTTP_403_FORBIDDEN,
        )

    def get(self, request):
        return self._sin_permiso(request) or Response(_textos(services.configuracion()))

    def put(self, request):
        negado = self._sin_permiso(request)
        if negado:
            return negado
        entrada = _Configuracion(data=request.data)
        entrada.is_valid(raise_exception=True)
        actual = services.configuracion()
        anterior = {"version": actual.version, **_aviso_auditado(actual)}
        datos = dict(entrada.validated_data)
        config = services.guardar_configuracion(
            datos.pop("terminos"), datos.pop("consentimiento_correo"), **datos
        )
        record_audit_event(
            actor=request.user,
            action="roles_pago.configuracion",
            target=config,
            module=MODULO,
            previous_values=anterior,
            new_values={"version": config.version, **_aviso_auditado(config)},
            context=get_request_context(request),
        )
        return Response(_textos(config))


class AvisoView(APIView):
    """El aviso del rol de pagos al iniciar sesión (aviso del rol de pagos,
    29/10/2026). Lo pide toda persona con sesión al entrar: solo
    `IsAuthenticated` (y no `PANTALLA`, que daría 403 a quien no tiene nada
    del rol de pagos); a quien no le corresponde se le dice `mostrar: false`.
    Con el límite de peticiones por defecto."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        datos = aviso.aviso_del_mes(request.user)
        if datos is None:
            return Response({"mostrar": False})
        return Response({"mostrar": True, **datos})


# --- Observaciones (Talento Humano) -------------------------------------------------------


class ObservacionesView(APIView):
    """Las observaciones a los roles de pagos (`roles_pago.observaciones`)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk=None):
        if pk is not None:
            return Response(services.observacion(request.user, pk))
        return Response(services.observaciones(request.user, request.query_params.get("estado")))


class _Correccion(serializers.Serializer):
    nota = serializers.CharField(max_length=2000)


class CorregirObservacionView(APIView):
    """Talento Humano corrigió el rol y pide a la persona que vuelva a
    confirmar."""

    permission_classes = [IsAuthenticated]

    parser_classes = [JSONParser, MultiPartParser]

    def post(self, request, pk):
        entrada = _Correccion(data=request.data)
        entrada.is_valid(raise_exception=True)
        archivos = request.FILES.getlist("archivos")
        observacion = services.corregir(request.user, pk, entrada.validated_data["nota"], archivos)
        record_audit_event(
            actor=request.user,
            action="roles_pago.observacion.corregida",
            target=observacion,
            module=MODULO,
            new_values={
                "observacion": observacion.pk,
                "persona": observacion.usuario_id,
                "adjuntos": [a.name for a in archivos],
            },
            context=get_request_context(request),
        )
        return Response(services.observacion(request.user, pk))


class AdjuntoObservacionView(APIView):
    """Descargar un adjunto de una respuesta a una observación: la persona de
    la observación y Talento Humano. Siempre como descarga y sin adivinar el
    tipo; queda en la auditoría."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        from apps.adjuntos.validators import tipo_por_extension

        adjunto = services.adjunto_de_observacion(request.user, pk)
        try:
            fichero = adjunto.archivo.open("rb")
        except FileNotFoundError as error:
            raise Http404("El archivo ya no está disponible en el servidor.") from error
        record_audit_event(
            actor=request.user,
            action="roles_pago.observacion.adjunto_descargado",
            target=adjunto.mensaje.observacion,
            module=MODULO,
            new_values={"adjunto": adjunto.pk, "nombre": adjunto.nombre_original},
            context=get_request_context(request),
        )
        respuesta = FileResponse(
            fichero,
            as_attachment=True,
            filename=adjunto.nombre_original,
            # Derivado de la extensión y no del guardado: los adjuntos anteriores
            # a la auditoría de seguridad (29/10/2026) tienen el que mandó el
            # navegador, que podía ser «text/html».
            content_type=tipo_por_extension(adjunto.nombre_original),
        )
        respuesta["Content-Disposition"] = (
            f"attachment; filename*=UTF-8''{quote(adjunto.nombre_original)}"
        )
        respuesta["Cache-Control"] = "no-store, private"
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta


class ResumenObservacionesView(APIView):
    """Cuántas observaciones hay por atender (para la insignia del menú)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .models import ObservacionRolPagos

        if not services.atiende_observaciones(request.user):
            return Response({"abiertas": 0})
        return Response(
            {
                "abiertas": ObservacionRolPagos.objects.filter(
                    estado=ObservacionRolPagos.Estado.ABIERTA
                ).count()
            }
        )


class HistorialView(APIView):
    """El historial de un código de empleado: consultas, conformidades y
    observaciones, por período (`roles_pago.historial`)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        codigo = request.query_params.get("codigo", "")
        resultado = services.historial(request.user, codigo)
        record_audit_event(
            actor=request.user,
            action="roles_pago.historial.consultado",
            target=request.user,
            module=MODULO,
            new_values={"codigo": resultado["codigo"]},
            context=get_request_context(request),
        )
        return Response(resultado)


class _RolDelHistorial(serializers.Serializer):
    codigo = serializers.CharField(max_length=40)
    anio = serializers.IntegerField()
    mes = serializers.IntegerField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class RolDelHistorialView(APIView):
    """Ver (y descargar) un rol desde el historial: se vuelve a generar, no
    se guarda, y queda en la auditoría. Con `roles_pago.historial` y la
    contraseña de quien lo abre."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "rol_pagos"

    def post(self, request):
        entrada = _RolDelHistorial(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        try:
            contenido = services.rol_desde_historial(
                request.user,
                datos["codigo"],
                datos["anio"],
                datos["mes"],
                datos["password"],
                ip=_ip(request),
            )
        except Exception as error:
            record_audit_event(
                actor=request.user,
                action="roles_pago.historial.rol_rechazado",
                target=request.user,
                module=MODULO,
                result="failure",
                new_values={
                    "codigo": datos["codigo"],
                    "anio": datos["anio"],
                    "mes": datos["mes"],
                    "motivo": str(getattr(error, "detail", error))[:200],
                },
                context=get_request_context(request),
            )
            raise
        record_audit_event(
            actor=request.user,
            action="roles_pago.historial.rol_visto",
            target=request.user,
            module=MODULO,
            new_values={"codigo": datos["codigo"], "anio": datos["anio"], "mes": datos["mes"]},
            context=get_request_context(request),
        )
        marcar(
            request,
            sin_copia=SIN_COPIA,
            tipo="rol_pagos",
            codigo=datos["codigo"],
            anio=datos["anio"],
            mes=datos["mes"],
        )
        respuesta = HttpResponse(contenido, content_type="application/pdf")
        respuesta["Content-Disposition"] = (
            f'inline; filename="rol-de-pagos-{datos["codigo"]}-{datos["anio"]}-{datos["mes"]:02d}.pdf"'
        )
        respuesta["Cache-Control"] = "no-store, private"
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta


class _Habilitar(serializers.Serializer):
    usuario = serializers.IntegerField()
    habilitado = serializers.BooleanField()
    codigo = serializers.CharField(max_length=40, required=False, allow_blank=True)


class HabilitadosView(APIView):
    """Rol de pagos → Usuarios habilitados (`roles_pago.habilitar`): quiénes
    consultan su rol de pagos y con qué código de empleado (22/10/2026)."""

    permission_classes = [IsAuthenticated, Requiere("roles_pago.habilitar")]

    def get(self, request):
        return Response(services.habilitados(request.user, request.query_params.get("q", "")))

    def post(self, request):
        from apps.chat.services import personas_de_la_empresa

        entrada = _Habilitar(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        usuario = personas_de_la_empresa().filter(pk=datos["usuario"]).first()
        if usuario is None:
            raise serializers.ValidationError({"usuario": "No es una persona de la empresa."})
        return Response(
            services.habilitar(
                request.user,
                usuario,
                habilitado_=datos["habilitado"],
                codigo=datos.get("codigo"),
            )
        )


class MisObservacionesView(APIView):
    """Las observaciones de la persona a sus roles de pagos, en todos sus
    estados; solo las suyas (22/10/2026)."""

    permission_classes = [IsAuthenticated, PROPIO]

    def get(self, request):
        return Response(services.mis_observaciones(request.user))


class _DescargaMasiva(serializers.Serializer):
    unidad = serializers.IntegerField()
    anio = serializers.IntegerField()
    mes = serializers.IntegerField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class DescargaMasivaView(APIView):
    """Rol de pagos → Descarga masiva (`roles_pago.descarga_masiva`,
    22/10/2026). GET: las áreas para elegir. POST: el ZIP sin clave con un PDF
    por persona del área en ese mes; pide la contraseña y queda en la
    auditoría."""

    permission_classes = [IsAuthenticated, Requiere(services.PERMISO_MASIVA)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "rol_pagos"

    def get_throttles(self):
        # Ver la lista de áreas no gasta los intentos de descarga.
        return super().get_throttles() if self.request.method == "POST" else []

    def get(self, request):
        return Response(services.areas_para_descarga(request.user))

    def post(self, request):
        entrada = _DescargaMasiva(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        periodo = {"unidad": datos["unidad"], "anio": datos["anio"], "mes": datos["mes"]}
        try:
            zip_ = services.descarga_masiva(
                request.user,
                datos["unidad"],
                datos["anio"],
                datos["mes"],
                datos["password"],
                ip=_ip(request),
            )
        except Exception as error:
            record_audit_event(
                actor=request.user,
                action="roles_pago.descarga_masiva_rechazada",
                target=request.user,
                module=MODULO,
                result="failure",
                new_values={
                    **periodo,
                    "motivo": str(getattr(error, "detail", error))[:200],
                },
                context=get_request_context(request),
            )
            raise
        record_audit_event(
            actor=request.user,
            action="roles_pago.descarga_masiva",
            target=zip_["unidad"],
            module=MODULO,
            new_values={
                **periodo,
                "area": zip_["unidad"].nombre,
                "incluidos": zip_["incluidos"],
                "omitidos": zip_["omitidos"],
            },
            context=get_request_context(request),
        )
        marcar(
            request,
            sin_copia=SIN_COPIA,
            tipo="rol_pagos_masivo",
            area=zip_["unidad"].nombre,
            anio=datos["anio"],
            mes=datos["mes"],
            incluidos=zip_["incluidos"],
        )
        respuesta = HttpResponse(zip_["contenido"], content_type="application/zip")
        respuesta["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(zip_['nombre'])}"
        respuesta["X-Incluidos"] = str(zip_["incluidos"])
        respuesta["X-Omitidos"] = str(zip_["omitidos"])
        respuesta["Access-Control-Expose-Headers"] = "X-Incluidos, X-Omitidos"
        respuesta["Cache-Control"] = "no-store, private"
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta


class SeguimientoView(APIView):
    """Rol de pagos → Roles sin abrir (`roles_pago.seguimiento`, 26/10/2026):
    de las personas habilitadas, quiénes no han abierto su rol de un mes, con
    cómo contactarlas."""

    permission_classes = [IsAuthenticated, Requiere(services.PERMISO_SEGUIMIENTO)]

    def get(self, request):
        try:
            anio = int(request.query_params.get("anio", ""))
            mes = int(request.query_params.get("mes", ""))
        except ValueError:
            raise serializers.ValidationError({"mes": "Elija un año y un mes válidos."}) from None
        resultado = services.seguimiento(request.user, anio, mes)
        record_audit_event(
            actor=request.user,
            action="roles_pago.seguimiento.consultado",
            target=request.user,
            module=MODULO,
            new_values={"anio": anio, "mes": mes, "sin_abrir": len(resultado["sin_abrir"])},
            context=get_request_context(request),
        )
        return Response(resultado)


def _anio_mes(datos, con_mes=True):
    try:
        anio = int(datos.get("anio", ""))
        mes = int(datos.get("mes", "")) if con_mes else None
    except (TypeError, ValueError):
        raise serializers.ValidationError({"mes": "Elija un año y un mes válidos."}) from None
    return anio, mes


class SeguimientoResumenView(APIView):
    """Por mes del año: cuántos abrieron, aceptaron, observaron y cuántos
    están pendientes (`roles_pago.seguimiento`)."""

    permission_classes = [IsAuthenticated, Requiere(services.PERMISO_SEGUIMIENTO)]

    def get(self, request):
        anio, _ = _anio_mes(request.query_params, con_mes=False)
        return Response(services.resumen_seguimiento(request.user, anio))


class SeguimientoExportarView(APIView):
    """El listado del mes en Excel (`estado`: pendientes, sin_abrir,
    sin_aceptar, con_observacion, aceptados o todos)."""

    permission_classes = [IsAuthenticated, Requiere(services.PERMISO_SEGUIMIENTO)]

    def get(self, request):
        anio, mes = _anio_mes(request.query_params)
        estado = request.query_params.get("estado", "pendientes")
        nombre, contenido = services.exportar_seguimiento(request.user, anio, mes, estado)
        record_audit_event(
            actor=request.user,
            action="roles_pago.seguimiento.exportado",
            target=request.user,
            module=MODULO,
            new_values={"anio": anio, "mes": mes, "estado": estado},
            context=get_request_context(request),
        )
        respuesta = HttpResponse(
            contenido,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        respuesta["Content-Disposition"] = f'attachment; filename="{nombre}"'
        return respuesta


class SeguimientoRecordarView(APIView):
    """Una notificación en la campana a cada persona pendiente del mes."""

    permission_classes = [IsAuthenticated, Requiere(services.PERMISO_SEGUIMIENTO)]

    def post(self, request):
        anio, mes = _anio_mes(request.data)
        enviadas = services.recordar(
            request.user, anio, mes, request.data.get("estado", "pendientes")
        )
        return Response({"enviadas": enviadas})


class _Auditado(serializers.Serializer):
    codigo = serializers.CharField(max_length=40)
    periodos = serializers.ListField(child=serializers.DictField(), allow_empty=False)
    password = serializers.CharField(trim_whitespace=False)


class AuditadoView(APIView):
    """Rol de pagos → Descargar rol auditado (`roles_pago.historial`,
    26/10/2026). GET: la persona del código y los meses con movimientos. POST:
    el PDF de un mes, o un ZIP con un PDF por mes; arriba el rol y abajo la
    constancia de todo lo que pasó con él. Sin clave."""

    permission_classes = [IsAuthenticated, Requiere("roles_pago.historial")]
    throttle_scope = "rol_pagos"

    def get_throttles(self):
        return [ScopedRateThrottle()] if self.request.method == "POST" else super().get_throttles()

    def get(self, request):
        from apps.users.models import User

        codigo = (request.query_params.get("codigo") or "").strip()
        if not codigo:
            raise serializers.ValidationError({"codigo": "Escriba el código de empleado."})
        persona = User.objects.filter(codigo_empleado__iexact=codigo).first()
        return Response(
            {
                "codigo": codigo,
                "persona": (
                    {"id": persona.id, "nombre": services._nombre(persona), "correo": persona.email}
                    if persona
                    else None
                ),
                "con_movimientos": auditado.meses_del_codigo(codigo),
            }
        )

    def post(self, request):
        entrada = _Auditado(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        try:
            resultado = auditado.generar(
                request.user, datos["codigo"], datos["periodos"], datos["password"]
            )
        except Exception as error:
            record_audit_event(
                actor=request.user,
                action="roles_pago.auditado.rechazado",
                target=request.user,
                module=MODULO,
                result="failure",
                new_values={
                    "codigo": datos["codigo"],
                    "motivo": str(getattr(error, "detail", error))[:200],
                },
                context=get_request_context(request),
            )
            raise
        record_audit_event(
            actor=request.user,
            action="roles_pago.auditado.descargado",
            target=request.user,
            module=MODULO,
            new_values={
                "codigo": datos["codigo"].strip(),
                "periodos": resultado["periodos"],
                "incluidos": resultado["incluidos"],
            },
            context=get_request_context(request),
        )
        marcar(
            request,
            sin_copia=SIN_COPIA,
            tipo="rol_pagos_auditado",
            codigo=datos["codigo"].strip(),
            periodos=resultado["periodos"],
        )
        respuesta = HttpResponse(resultado["contenido"], content_type=resultado["tipo"])
        respuesta["Content-Disposition"] = (
            f"attachment; filename*=UTF-8''{quote(resultado['nombre'])}"
        )
        respuesta["X-Incluidos"] = str(resultado["incluidos"])
        respuesta["X-Omitidos"] = str(resultado["omitidos"])
        respuesta["Access-Control-Expose-Headers"] = "X-Incluidos, X-Omitidos"
        respuesta["Cache-Control"] = "no-store, private"
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta
