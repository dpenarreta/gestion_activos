from django.db.models import Count, Q
from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.audit import record_audit_event
from apps.core.pagination import DefaultPagination
from apps.core.request_meta import get_request_context

from .models import Departamento, Empleado, Sede, Ubicacion
from .permissions import OrganizacionPermission
from .serializers import (
    DepartamentoSerializer,
    EmpleadoSerializer,
    SedeSerializer,
    UbicacionSerializer,
)

MODULO = "organizacion"


class _CatalogoOrganizacionalViewSet(viewsets.ModelViewSet):
    """Base común de departamentos y empleados.

    Ninguno admite `DELETE`: ambos son referenciados por activos y por el
    historial de movimientos, así que eliminarlos dejaría registros huérfanos o
    fallaría contra un `PROTECT`. Se desactivan con `activo = False`, igual que
    las cuentas de usuario del sistema.
    """

    permission_classes = [IsAuthenticated, OrganizacionPermission]
    pagination_class = DefaultPagination
    http_method_names = ["get", "post", "put", "patch", "head", "options"]
    accion_auditoria = ""

    def perform_create(self, serializer):
        instancia = serializer.save()
        record_audit_event(
            actor=self.request.user,
            action=f"{self.accion_auditoria}.created",
            target=instancia,
            module=MODULO,
            new_values=serializer.data,
            context=get_request_context(self.request),
        )

    def perform_update(self, serializer):
        anteriores = self.get_serializer(serializer.instance).data
        instancia = serializer.save()
        cambios = {
            campo: valor
            for campo, valor in serializer.data.items()
            if anteriores.get(campo) != valor
        }
        if cambios:
            record_audit_event(
                actor=self.request.user,
                action=f"{self.accion_auditoria}.updated",
                target=instancia,
                module=MODULO,
                previous_values={campo: anteriores.get(campo) for campo in cambios},
                new_values=cambios,
                context=get_request_context(self.request),
            )


class DepartamentoViewSet(_CatalogoOrganizacionalViewSet):
    serializer_class = DepartamentoSerializer
    accion_auditoria = "departamento"

    def get_queryset(self):
        queryset = (
            Departamento.objects.select_related("responsable")
            .annotate(
                total_activos=Count("activos", distinct=True),
                total_empleados=Count("empleados", distinct=True),
            )
            .order_by("nombre")
        )
        params = self.request.query_params
        busqueda = params.get("q")
        if busqueda:
            queryset = queryset.filter(
                Q(nombre__icontains=busqueda) | Q(codigo__icontains=busqueda)
            )
        estado = params.get("activo")
        if estado in {"true", "false"}:
            queryset = queryset.filter(activo=estado == "true")
        return queryset


class SedeViewSet(_CatalogoOrganizacionalViewSet):
    """Catálogo de edificios, locales o ciudades.

    Sin `DELETE`, como el resto: las ubicaciones apuntan aquí con `PROTECT` y
    una sede que se cierra sigue siendo la que aparece en el historial de los
    equipos que estuvieron ahí.
    """

    serializer_class = SedeSerializer
    accion_auditoria = "sede"

    def get_queryset(self):
        queryset = Sede.objects.annotate(
            total_ubicaciones=Count("ubicaciones", distinct=True),
            total_activos=Count("ubicaciones__activos", distinct=True),
        ).order_by("nombre")
        params = self.request.query_params
        busqueda = params.get("q")
        if busqueda:
            queryset = queryset.filter(
                Q(nombre__icontains=busqueda)
                | Q(ciudad__icontains=busqueda)
                | Q(direccion__icontains=busqueda)
            )
        estado = params.get("activa")
        if estado in {"true", "false"}:
            queryset = queryset.filter(activa=estado == "true")
        return queryset

    def update(self, request, *args, **kwargs):
        """Impide cerrar una sede que todavía tiene ubicaciones abiertas.

        Cerrarla las dejaría colgando de un sitio que ya no se ofrece: los
        equipos seguirían ahí y nadie podría moverlos ni corregirlos.
        """
        instancia = self.get_object()
        pide_desactivar = request.data.get("activa") in {False, "false"}
        if pide_desactivar and instancia.activa:
            abiertas = instancia.ubicaciones.filter(activa=True).count()
            if abiertas:
                return Response(
                    {
                        "error": {
                            "code": "sede_con_ubicaciones",
                            "message": (
                                f"No se puede cerrar «{instancia.nombre}»: todavía tiene "
                                f"{abiertas} ubicacion(es) abierta(s). Ciérrelas primero."
                            ),
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        return super().update(request, *args, **kwargs)


class UbicacionViewSet(_CatalogoOrganizacionalViewSet):
    """Catálogo de lugares físicos (§4.1).

    Tampoco admite `DELETE`: los activos apuntan aquí con `PROTECT`, y una
    ubicación que se cierra —una bodega que se muda— sigue siendo la que
    aparece en el historial de los equipos que estuvieron ahí. Se desactiva.
    """

    serializer_class = UbicacionSerializer
    accion_auditoria = "ubicacion"

    def get_queryset(self):
        queryset = (
            Ubicacion.objects.select_related("sede")
            .annotate(total_activos=Count("activos", distinct=True))
            .order_by("sede__nombre", "nombre")
        )
        params = self.request.query_params
        busqueda = params.get("q")
        if busqueda:
            queryset = queryset.filter(
                Q(nombre__icontains=busqueda)
                | Q(sede__nombre__icontains=busqueda)
                | Q(detalle__icontains=busqueda)
            )
        sede = params.get("sede")
        if sede and sede.isdigit():
            queryset = queryset.filter(sede_id=int(sede))
        tipo = params.get("tipo")
        if tipo in dict(Ubicacion.Tipo.choices):
            queryset = queryset.filter(tipo=tipo)
        estado = params.get("activa")
        if estado in {"true", "false"}:
            queryset = queryset.filter(activa=estado == "true")
        return queryset

    def update(self, request, *args, **kwargs):
        """Impide cerrar una ubicación que todavía tiene equipos dentro.

        Desactivarla los dejaría en un sitio que el formulario ya no ofrece:
        seguirían apareciendo ahí, pero nadie podría volver a poner un equipo
        en ese lugar ni corregir el de los que quedaron.
        """
        instancia = self.get_object()
        pide_desactivar = request.data.get("activa") in {False, "false"}
        if pide_desactivar and instancia.activa:
            pendientes = instancia.activos.operativos().count()
            if pendientes:
                return Response(
                    {
                        "error": {
                            "code": "ubicacion_con_activos",
                            "message": (
                                f"No se puede desactivar «{instancia.nombre_completo}»: "
                                f"todavía hay {pendientes} activo(s) ahí. Muévalos primero."
                            ),
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        return super().update(request, *args, **kwargs)


class EmpleadoViewSet(_CatalogoOrganizacionalViewSet):
    serializer_class = EmpleadoSerializer
    accion_auditoria = "empleado"

    def get_queryset(self):
        queryset = (
            Empleado.objects.select_related("departamento", "usuario")
            .annotate(total_activos=Count("activos_asignados", distinct=True))
            .order_by("apellidos", "nombres")
        )
        params = self.request.query_params
        busqueda = params.get("q")
        if busqueda:
            queryset = queryset.filter(
                Q(nombres__icontains=busqueda)
                | Q(apellidos__icontains=busqueda)
                | Q(codigo_empleado__icontains=busqueda)
                | Q(correo__icontains=busqueda)
            )
        departamento = params.get("departamento")
        if departamento and departamento.isdigit():
            queryset = queryset.filter(departamento_id=int(departamento))
        estado = params.get("activo")
        if estado in {"true", "false"}:
            queryset = queryset.filter(activo=estado == "true")
        return queryset

    def update(self, request, *args, **kwargs):
        """Impide desactivar a un empleado que todavía custodia equipos.

        Sin esta barrera, los activos quedarían a nombre de alguien marcado
        como inactivo y el inventario dejaría de responder quién responde por
        ellos, que es justamente lo que RF-01 busca resolver.
        """
        instancia = self.get_object()
        pide_desactivar = request.data.get("activo") in {False, "false"}
        if pide_desactivar and instancia.activo:
            pendientes = instancia.activos_asignados.operativos().count()
            if pendientes:
                return Response(
                    {
                        "error": {
                            "code": "empleado_con_activos",
                            "message": (
                                f"No se puede desactivar a {instancia.nombre_completo}: "
                                f"aún custodia {pendientes} activo(s). Reasígnelos primero."
                            ),
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        return super().update(request, *args, **kwargs)
