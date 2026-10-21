from django.http import HttpResponse
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context
from apps.permissions.authorization import user_has_permission
from apps.permissions.permissions import Requiere

from . import fuente, services

MODULO = "roles_pago"


def _ip(request):
    return get_request_context(request).get("ip_address") or None


#: Consultar el propio rol (21/10/2026: antes bastaba la sesión). Quien
#: consulta el de todos también puede con el suyo.
PROPIO = Requiere("roles_pago.consultar", "roles_pago.consultar_todos")


class EstadoView(APIView):
    """Lo que necesita la pantalla: el código de la sesión, los términos
    vigentes, el correo guardado (enmascarado) y qué puede hacer."""

    permission_classes = [IsAuthenticated, PROPIO]

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
        respuesta = HttpResponse(contenido, content_type="application/pdf")
        respuesta["Content-Disposition"] = (
            f'inline; filename="rol-de-pagos-{consulta.anio}-{consulta.mes:02d}.pdf"'
        )
        respuesta["X-Consulta-Rol"] = str(consulta.pk)
        respuesta["Access-Control-Expose-Headers"] = "X-Consulta-Rol"
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


class ConfiguracionView(APIView):
    """Los textos (términos y consentimiento del correo), con
    `roles_pago.configurar`. Cambiar los términos sube su versión."""

    permission_classes = [IsAuthenticated]

    def put(self, request):
        if not user_has_permission(request.user, "roles_pago.configurar"):
            return Response(
                {"detail": "No tiene el permiso requerido: roles_pago.configurar."},
                status=status.HTTP_403_FORBIDDEN,
            )
        entrada = _Configuracion(data=request.data)
        entrada.is_valid(raise_exception=True)
        anterior = {"version": services.configuracion().version}
        datos = entrada.validated_data
        config = services.guardar_configuracion(datos["terminos"], datos["consentimiento_correo"])
        record_audit_event(
            actor=request.user,
            action="roles_pago.configuracion",
            target=config,
            module=MODULO,
            previous_values=anterior,
            new_values={"version": config.version},
            context=get_request_context(request),
        )
        return Response({"version": config.version})


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

    def post(self, request, pk):
        entrada = _Correccion(data=request.data)
        entrada.is_valid(raise_exception=True)
        observacion = services.corregir(request.user, pk, entrada.validated_data["nota"])
        record_audit_event(
            actor=request.user,
            action="roles_pago.observacion.corregida",
            target=observacion,
            module=MODULO,
            new_values={"observacion": observacion.pk, "persona": observacion.usuario_id},
            context=get_request_context(request),
        )
        return Response(services.observacion(request.user, pk))


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
                request.user, datos["codigo"], datos["anio"], datos["mes"], datos["password"]
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
        respuesta = HttpResponse(contenido, content_type="application/pdf")
        respuesta["Content-Disposition"] = (
            f'inline; filename="rol-de-pagos-{datos["codigo"]}-{datos["anio"]}-{datos["mes"]:02d}.pdf"'
        )
        respuesta["Cache-Control"] = "no-store, private"
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta
