"""Configuración → Notificaciones → Plantillas de correo."""

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.http import Http404
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context
from apps.permissions.permissions import HasModulePermission

from . import catalogo, servicio
from .models import PlantillaCorreo

#: Tope de una plantilla: un diseño de correo real ronda las decenas de KB; el
#: tope evita que un pegado accidental (una imagen en base64) llene la base.
MAX_HTML = 300_000


class PlantillasPermission(HasModulePermission):
    view_permission = "configuracion.ver"
    write_permission = "configuracion.editar"


class SoloVer(HasModulePermission):
    """Para la vista previa: es POST porque recibe el borrador, pero mirar no
    es editar."""

    view_permission = "configuracion.ver"
    write_permission = "configuracion.ver"


class BorradorSerializer(serializers.Serializer):
    asunto = serializers.CharField(max_length=255)
    html = serializers.CharField(max_length=MAX_HTML, trim_whitespace=False)


def _plantilla_o_404(clave):
    plantilla = catalogo.obtener(clave)
    if plantilla is None:
        raise Http404("Ese correo no existe.")
    return plantilla


def _resumen(plantilla, propia):
    return {
        "clave": plantilla.clave,
        "nombre": plantilla.nombre,
        "modulo": plantilla.modulo,
        "descripcion": plantilla.descripcion,
        "personalizada": propia is not None,
        "actualizado_en": propia.updated_at if propia else None,
        "actualizado_por": (
            (propia.actualizado_por.get_full_name() or propia.actualizado_por.username)
            if propia and propia.actualizado_por
            else None
        ),
    }


class ListaDePlantillasView(APIView):
    permission_classes = [IsAuthenticated, PlantillasPermission]

    def get(self, request):
        propias = {p.clave: p for p in PlantillaCorreo.objects.select_related("actualizado_por")}
        return Response([_resumen(p, propias.get(p.clave)) for p in catalogo.PLANTILLAS])


class PlantillaView(APIView):
    """Ver, guardar (personalizar) y restablecer una plantilla."""

    permission_classes = [IsAuthenticated, PlantillasPermission]

    def get(self, request, clave):
        plantilla = _plantilla_o_404(clave)
        asunto, html, _ = servicio.vigente(clave)
        propia = (
            PlantillaCorreo.objects.select_related("actualizado_por").filter(clave=clave).first()
        )
        comunes = {v.nombre for v in catalogo.COMUNES} | {"razon"}
        return Response(
            {
                **_resumen(plantilla, propia),
                "asunto": asunto,
                "html": html,
                "asunto_por_defecto": plantilla.asunto,
                "html_por_defecto": plantilla.html,
                "variables": [
                    {
                        "nombre": v.nombre,
                        "descripcion": v.descripcion,
                        "ejemplo": v.ejemplo,
                        "html": v.html,
                        "comun": v.nombre in comunes,
                    }
                    for v in plantilla.todas_las_variables()
                ],
            }
        )

    def put(self, request, clave):
        _plantilla_o_404(clave)
        entrada = BorradorSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        anterior = servicio.guardar(clave=clave, actor=request.user, **datos)
        record_audit_event(
            actor=request.user,
            action="plantilla_correo.guardada",
            target_type="plantilla_correo",
            target_id=clave,
            module="configuracion",
            previous_values=anterior,
            new_values={"asunto": datos["asunto"], "bytes_html": len(datos["html"])},
            context=get_request_context(request),
        )
        return self.get(request, clave)

    def delete(self, request, clave):
        _plantilla_o_404(clave)
        if servicio.restablecer(clave):
            record_audit_event(
                actor=request.user,
                action="plantilla_correo.restablecida",
                target_type="plantilla_correo",
                target_id=clave,
                module="configuracion",
                context=get_request_context(request),
            )
        return self.get(request, clave)


class VistaPreviaView(APIView):
    """El borrador con los datos de ejemplo, sin guardar ni enviar nada."""

    permission_classes = [IsAuthenticated, SoloVer]

    def post(self, request, clave):
        _plantilla_o_404(clave)
        entrada = BorradorSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        correo = servicio.renderizar(
            clave, servicio.ejemplo(clave), asunto=datos["asunto"], html=datos["html"]
        )
        return Response(
            {
                **correo,
                "desconocidas": servicio.variables_desconocidas(
                    clave, datos["asunto"], datos["html"]
                ),
            }
        )


class PruebaDePlantillaView(APIView):
    """Envía la plantilla guardada, con datos de ejemplo, a quien la pide."""

    permission_classes = [IsAuthenticated, PlantillasPermission]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "correo_prueba"

    def post(self, request, clave):
        plantilla = _plantilla_o_404(clave)
        destino = request.user.email
        if not destino:
            return Response(
                {"detail": "Su cuenta no tiene un correo registrado al que enviar la prueba."},
                status=400,
            )
        correo = servicio.renderizar(clave, servicio.ejemplo(clave))
        error = None
        try:
            mensaje = EmailMultiAlternatives(
                subject=f"[PRUEBA] {correo['asunto']}",
                body=correo["texto"],
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[destino],
            )
            mensaje.attach_alternative(correo["html"], "text/html")
            mensaje.send(fail_silently=False)
        except Exception as fallo:  # noqa: BLE001
            error = str(fallo) or fallo.__class__.__name__
        record_audit_event(
            actor=request.user,
            action="plantilla_correo.prueba_enviada",
            target_type="plantilla_correo",
            target_id=plantilla.clave,
            module="configuracion",
            new_values={"destino": destino, "resultado": "fallido" if error else "enviado"},
            context=get_request_context(request),
        )
        if error:
            return Response(
                {"detail": "No se pudo enviar la prueba.", "motivo": error[:500]}, status=502
            )
        return Response({"detail": f"Se envió una prueba de «{plantilla.nombre}» a {destino}."})
