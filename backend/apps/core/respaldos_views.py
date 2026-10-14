"""Cuándo se respalda solo: la política y el estado de lo último que se hizo.

Una sola fila para todo el despliegue, así que no hay listado ni identificador:
se lee y se corrige, como el tema del sitio. Quien puede tocar la configuración
del sistema puede tocar esto; no lleva permiso propio porque decidir cada cuánto
se respalda es exactamente ese oficio.
"""

import datetime
import re

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import respaldos_archivo
from apps.core.audit import record_audit_event
from apps.core.management.commands.respaldar import fecha_del_ultimo_respaldo
from apps.core.models import MAXIMO_HORAS, PoliticaDeRespaldo
from apps.core.request_meta import get_request_context
from apps.permissions.permissions import HasModulePermission

MODULO = "core"

#: Cada cuánto corre la tarea del sistema (ver docs/respaldos.md). Si se
#: registra con otro intervalo, cambiar aquí también: la pantalla lo usa para
#: decir cuánto tarda en empezar un «Respaldar ahora».
TAREA_CADA_MINUTOS = 5


class PoliticaDeRespaldoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PoliticaDeRespaldo
        fields = [
            "activo",
            "dias",
            "horas",
            "destino",
            "conservar",
            "ultimo_programado",
            "solicitado_en",
            "ultima_ejecucion",
            "ultimo_error",
        ]
        read_only_fields = [
            "ultimo_programado",
            "solicitado_en",
            "ultima_ejecucion",
            "ultimo_error",
        ]

    def validate_conservar(self, value):
        if value < 1:
            raise serializers.ValidationError(
                "Hay que conservar al menos uno: cero sería no respaldar."
            )
        return value

    def validate_dias(self, value):
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError(
                "Elija al menos un día. Para no respaldar, apague el respaldo automático."
            )
        dias = set()
        for dia in value:
            if isinstance(dia, bool) or not isinstance(dia, int) or not 0 <= dia <= 6:
                raise serializers.ValidationError("Cada día va de 0 (lunes) a 6 (domingo).")
            dias.add(dia)
        return sorted(dias)

    def validate_horas(self, value):
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError("Indique al menos una hora.")
        horas = set()
        for hora in value:
            # Se exige HH:MM exacto y se guarda así: la tarea compara texto
            # contra el reloj, y «2:00» o «02:00:00» serían la misma hora
            # escrita de tres formas.
            if not isinstance(hora, str) or not re.fullmatch(r"\d{2}:\d{2}", hora):
                raise serializers.ValidationError(f"«{hora}» no es una hora HH:MM.")
            try:
                datetime.time.fromisoformat(hora)
            except ValueError:
                raise serializers.ValidationError(f"«{hora}» no es una hora válida.") from None
            horas.add(hora)
        if len(horas) > MAXIMO_HORAS:
            raise serializers.ValidationError(
                f"Como mucho {MAXIMO_HORAS} horas por día: un respaldo completo "
                "tarda minutos y bloquea la base mientras dura."
            )
        return sorted(horas)

    def validate_destino(self, value):
        limpio = (value or "").strip()
        if not limpio:
            raise serializers.ValidationError("Hace falta una carpeta donde escribir.")
        return limpio


class RespaldosPermission(HasModulePermission):
    """Leer la política es parte de ver la configuración; cambiarla, no.

    Se separa de `configuracion.editar` porque no es la misma
    responsabilidad: quien cuida la imagen del sistema cambia el logo y los
    colores, y quien toca esto decide de cuándo se puede volver si algo se
    pierde —apagar el respaldo automático no se nota hasta el día que hace
    falta—.
    """

    view_permission = "configuracion.ver"
    write_permission = "configuracion.respaldos"


class PoliticaDeRespaldoView(APIView):
    """Lee y corrige cuándo se respalda."""

    permission_classes = [IsAuthenticated, RespaldosPermission]

    def get(self, request):
        politica = PoliticaDeRespaldo.vigente()
        datos = PoliticaDeRespaldoSerializer(politica).data
        # Lo último que hay en disco, que no es lo mismo que lo último que hizo
        # la tarea: un respaldo a mano también cuenta para saber de cuándo se
        # puede volver, y es la pregunta que se hace al abrir esta pantalla.
        ultimo = fecha_del_ultimo_respaldo(politica.destino)
        datos["ultimo_en_disco"] = ultimo.isoformat() if ultimo else None
        proximo = politica.proximo_turno(timezone.localtime())
        datos["proximo"] = timezone.localtime(proximo).isoformat() if proximo else None
        # Cada cuánto pasa la tarea: es lo que tarda, como mucho, un «Respaldar
        # ahora» en empezar, y la pantalla lo dice en vez de prometer «ya».
        datos["tarea_cada_minutos"] = TAREA_CADA_MINUTOS
        datos["zona_horaria"] = settings.TIME_ZONE
        return Response(datos)

    def patch(self, request):
        politica = PoliticaDeRespaldo.vigente()
        anterior = PoliticaDeRespaldoSerializer(politica).data

        entrada = PoliticaDeRespaldoSerializer(politica, data=request.data, partial=True)
        entrada.is_valid(raise_exception=True)
        politica = entrada.save()

        cambios = {
            campo: valor for campo, valor in entrada.data.items() if anterior.get(campo) != valor
        }
        if cambios:
            record_audit_event(
                actor=request.user,
                action="respaldo.politica_changed",
                target=politica,
                module=MODULO,
                previous_values={campo: anterior.get(campo) for campo in cambios},
                new_values=cambios,
                context=get_request_context(request),
            )
        return Response(self.get(request).data, status=status.HTTP_200_OK)


class RespaldarAhoraView(APIView):
    """«Respaldar ahora»: deja la orden y la tarea la cumple en su siguiente
    pasada.

    No respalda dentro de la petición: un respaldo tarda minutos y bloquea, y
    una petición que espera tanto acaba cortada por el navegador o el proxy con
    el respaldo a medias. Pedirlo dos veces no hace dos respaldos: la orden es
    una sola hasta que la tarea la cumple.
    """

    permission_classes = [IsAuthenticated, RespaldosPermission]

    def post(self, request):
        politica = PoliticaDeRespaldo.vigente()
        if politica.solicitado_en is None:
            politica.solicitado_en = timezone.now()
            politica.solicitado_por = request.user
            politica.save(update_fields=["solicitado_en", "solicitado_por"])
            record_audit_event(
                actor=request.user,
                action="respaldo.solicitado",
                target=politica,
                module=MODULO,
                new_values={"solicitado_en": politica.solicitado_en.isoformat()},
                context=get_request_context(request),
            )
        return Response(PoliticaDeRespaldoView().get(request).data, status=status.HTTP_202_ACCEPTED)


class RespaldosEnDiscoView(APIView):
    """Los respaldos que hay en disco, del más reciente al más antiguo."""

    permission_classes = [IsAuthenticated, RespaldosPermission]

    def get(self, request):
        politica = PoliticaDeRespaldo.vigente()
        return Response(
            {
                "respaldos": respaldos_archivo.listar(politica.destino),
                # Sin la carpeta de los `.bak` montada, borrar deja la copia de
                # la base en el servidor: la pantalla lo avisa antes de borrar.
                "borra_la_base": respaldos_archivo.carpeta_sql_local() is not None,
            }
        )


class BorrarRespaldoView(APIView):
    """Borra un respaldo entero: base, adjuntos y manifiesto.

    Es un borrado físico —no hay una «baja lógica» de un archivo que se borra
    para recuperar espacio—, así que queda auditado con lo que contenía. El más
    reciente no se borra nunca (ver `respaldos_archivo`).
    """

    permission_classes = [IsAuthenticated, RespaldosPermission]

    def delete(self, request, marca):
        politica = PoliticaDeRespaldo.vigente()
        contenido = next(
            (
                r["contenido"]
                for r in respaldos_archivo.listar(politica.destino)
                if r["marca"] == marca
            ),
            None,
        )
        try:
            borrados = respaldos_archivo.borrar(marca, politica.destino)
        except respaldos_archivo.RespaldoNoEncontrado:
            return Response(
                {"error": {"message": "Ese respaldo ya no está en disco."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        except respaldos_archivo.RespaldoProtegido:
            return Response(
                {
                    "error": {
                        "message": (
                            "Es el respaldo más reciente y no se puede borrar: "
                            "es el que garantiza que hoy hay de dónde volver."
                        )
                    }
                },
                status=status.HTTP_409_CONFLICT,
            )

        record_audit_event(
            actor=request.user,
            action="respaldo.borrado",
            target=politica,
            module=MODULO,
            previous_values={"marca": marca, "archivos": borrados, "contenido": contenido},
            context=get_request_context(request),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
