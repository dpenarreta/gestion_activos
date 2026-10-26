from urllib.parse import quote

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, Q
from django.http import FileResponse, Http404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.pagination import DefaultPagination
from apps.core.request_meta import get_client_ip, get_request_context
from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.permissions.authorization import user_has_permission

from . import (
    avisos_inicio,
    calendario,
    confidencialidad,
    contacto,
    cuentas,
    departamentos_del_organigrama,
    herramientas,
    noticias,
    organigrama,
    perfiles_cargo,
    roles_de_cargo,
    textos_legales,
    vacaciones,
)
from .models import (
    Cargo,
    Concesionario,
    DatosDeContacto,
    Departamento,
    DocumentoInstitucional,
    Empleado,
    EventoCalendario,
    Herramienta,
    NivelJerarquico,
    NoticiaInicio,
    Proveedor,
    Sede,
    UnidadOrganizacional,
)
from .permissions import (
    AceptacionesPermission,
    AcuerdoPermission,
    ArmarOAsignarPermission,
    AsignarCargosPermission,
    AvisoInicioPermission,
    TextosLegalesPermission,
    CalendarioPermission,
    DocumentosPermission,
    GestionarHerramientasPermission,
    HerramientasPermission,
    InstitucionalPermission,
    NoticiasPermission,
    OrganizacionPermission,
    PerfilCargoPermission,
    VacacionesDeTodosPermission,
    VerOrganigramaPermission,
)
from .serializers import (
    AccesoHerramientaSerializer,
    AcuerdoConfidencialidadSerializer,
    AjustesCarruselSerializer,
    AniversarioSerializer,
    AsignacionSerializer,
    AvisoInicioSerializer,
    CargoSerializer,
    ConcesionarioSerializer,
    CumpleanosSerializer,
    DepartamentoSerializer,
    DocumentoInstitucionalSerializer,
    EmpleadoSerializer,
    EventoCalendarioSerializer,
    HerramientaSerializer,
    MisDatosSerializer,
    MisHerramientasSerializer,
    NivelJerarquicoSerializer,
    NoticiaInicioSerializer,
    PerfilCargoSerializer,
    ProveedorSerializer,
    SedeSerializer,
    UnidadOrganizacionalSerializer,
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

    def perform_create(self, serializer, **extra):
        instancia = serializer.save(**extra)
        record_audit_event(
            actor=self.request.user,
            action=f"{self.accion_auditoria}.created",
            target=instancia,
            module=MODULO,
            new_values=serializer.data,
            context=get_request_context(self.request),
        )

    def perform_update(self, serializer, **extra):
        anteriores = self.get_serializer(serializer.instance).data
        instancia = serializer.save(**extra)
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
    """Solo lectura desde el 21/10/2026: cada departamento es una unidad del
    organigrama y se crea, renombra o desactiva desde ahí (ver
    `departamentos_del_organigrama.py`). Se sigue listando porque activos,
    empleados, Mesa de ayuda y chat eligen de esta lista."""

    serializer_class = DepartamentoSerializer
    accion_auditoria = "departamento"
    http_method_names = ["get", "head", "options"]

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

    @action(detail=False, methods=["get"])
    def personas(self, request):
        """Quién puede responder por una sede: las cuentas activas que trabajan
        en la empresa activa. Va por aquí y no por la lista de usuarios porque
        quien edita catálogos no tiene por qué poder administrar usuarios."""
        usuarios = get_user_model().objects.filter(is_active=True)
        empresa = empresa_actual()
        if empresa is not None and empresa is not SIN_EMPRESA:
            usuarios = usuarios.filter(membresias__empresa=empresa)
        return Response(
            [
                {"id": u.id, "nombre": u.get_full_name() or u.username}
                for u in usuarios.distinct().order_by("first_name", "last_name", "username")
            ]
        )

    def get_queryset(self):
        queryset = (
            Sede.objects.annotate(total_activos=Count("activos", distinct=True))
            .prefetch_related("responsables")
            .order_by("nombre")
        )
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
        """Impide cerrar una sede que todavía tiene equipos dentro.

        Cerrarla los dejaría en un sitio que el formulario ya no ofrece:
        seguirían apareciendo ahí, pero nadie podría moverlos ni corregir el
        sitio de los que quedaron.
        """
        instancia = self.get_object()
        pide_desactivar = request.data.get("activa") in {False, "false"}
        if pide_desactivar and instancia.activa:
            pendientes = instancia.activos.operativos().count()
            if pendientes:
                return Response(
                    {
                        "error": {
                            "code": "sede_con_activos",
                            "message": (
                                f"No se puede cerrar «{instancia.nombre}»: todavía hay "
                                f"{pendientes} activo(s) ahí. Muévalos primero."
                            ),
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        return super().update(request, *args, **kwargs)


class ProveedorViewSet(_CatalogoOrganizacionalViewSet):
    """A quién se le compra: equipos y piezas de repuesto.

    Sin `DELETE`, como el resto: los activos y los repuestos usados apuntan
    aquí con `PROTECT`, y un proveedor con el que se dejó de trabajar sigue
    siendo el que vendió lo que hay en el inventario. Se desactiva.
    """

    serializer_class = ProveedorSerializer
    accion_auditoria = "proveedor"

    def get_queryset(self):
        queryset = Proveedor.objects.annotate(
            total_activos=Count("activos", distinct=True),
            total_repuestos=Count("repuestos_vendidos", distinct=True),
        ).order_by("nombre")
        params = self.request.query_params
        busqueda = params.get("q")
        if busqueda:
            queryset = queryset.filter(
                Q(nombre__icontains=busqueda)
                | Q(identificacion__icontains=busqueda)
                | Q(contacto__icontains=busqueda)
            )
        estado = params.get("activo")
        if estado in {"true", "false"}:
            queryset = queryset.filter(activo=estado == "true")
        return queryset

    def update(self, request, *args, **kwargs):
        """Impide desactivar a un proveedor con equipos comprados vigentes.

        Desactivarlo dejaría esos activos apuntando a alguien que el formulario
        ya no ofrece: no se podría corregir la compra ni volver a registrarle
        una, y es justo a quien hay que llamar cuando el equipo falla.
        """
        instancia = self.get_object()
        pide_desactivar = request.data.get("activo") in {False, "false"}
        if pide_desactivar and instancia.activo:
            pendientes = instancia.activos.operativos().count()
            if pendientes:
                return Response(
                    {
                        "error": {
                            "code": "proveedor_con_activos",
                            "message": (
                                f"No se puede desactivar «{instancia.nombre}»: {pendientes} "
                                "activo(s) en uso se le compraron. Cámbieles el proveedor "
                                "primero."
                            ),
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        return super().update(request, *args, **kwargs)


class ConcesionarioViewSet(_CatalogoOrganizacionalViewSet):
    """De quién son los equipos que no compramos nosotros.

    Sin `DELETE`, como el resto: los activos en concesión apuntan aquí con
    `PROTECT` y un partner con el que se dejó de operar sigue siendo el dueño
    de los equipos que hay que devolverle. Se desactiva.
    """

    serializer_class = ConcesionarioSerializer
    accion_auditoria = "concesionario"

    def get_queryset(self):
        queryset = Concesionario.objects.annotate(
            total_activos=Count("activos", distinct=True),
        ).order_by("nombre")
        params = self.request.query_params
        busqueda = params.get("q")
        if busqueda:
            queryset = queryset.filter(
                Q(nombre__icontains=busqueda)
                | Q(identificacion__icontains=busqueda)
                | Q(contacto__icontains=busqueda)
            )
        estado = params.get("activo")
        if estado in {"true", "false"}:
            queryset = queryset.filter(activo=estado == "true")
        return queryset

    def update(self, request, *args, **kwargs):
        """Impide desactivar a un partner que todavía tiene equipos aquí.

        Desactivarlo dejaría esos activos apuntando a alguien que el formulario
        ya no ofrece: no se podría corregir de quién son ni registrar otro
        equipo suyo, y es a quien hay que devolvérselos cuando termine la
        concesión.
        """
        instancia = self.get_object()
        pide_desactivar = request.data.get("activo") in {False, "false"}
        if pide_desactivar and instancia.activo:
            pendientes = instancia.activos.operativos().count()
            if pendientes:
                return Response(
                    {
                        "error": {
                            "code": "concesionario_con_activos",
                            "message": (
                                f"No se puede desactivar «{instancia.nombre}»: {pendientes} "
                                "equipo(s) en uso son suyos. Cámbieles el concesionario "
                                "primero."
                            ),
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        return super().update(request, *args, **kwargs)


class EmpleadoViewSet(_CatalogoOrganizacionalViewSet):
    serializer_class = EmpleadoSerializer
    accion_auditoria = "empleado"

    def _con_cuenta(self, serializer):
        """Crea o ata la cuenta del empleado antes de guardarlo (ver
        `cuentas.py`). Lo que no tenía usuario lo recibe al editarse."""
        password = serializer.validated_data.pop("password", None)
        instancia = serializer.instance
        if instancia is not None and (
            instancia.usuario_id or "correo" not in serializer.validated_data
        ):
            return {}
        datos = serializer.validated_data
        usuario = cuentas.cuenta_para_empleado(
            actor=self.request.user,
            nombres=datos.get("nombres", getattr(instancia, "nombres", "")),
            apellidos=datos.get("apellidos", getattr(instancia, "apellidos", "")),
            correo=datos["correo"],
            password=password,
            context=get_request_context(self.request),
        )
        return {"usuario": usuario}

    def perform_create(self, serializer):
        with transaction.atomic():
            super().perform_create(serializer, **self._con_cuenta(serializer))

    def perform_update(self, serializer):
        with transaction.atomic():
            super().perform_update(serializer, **self._con_cuenta(serializer))

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


class MisDatosView(APIView):
    """«Mi perfil»: toda persona con sesión ve y actualiza su teléfono, área,
    agencia y cargo en la empresa activa (y su nombre). No pide permisos: es de
    ella."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({**contacto.de(request.user), **contacto.opciones()})

    def put(self, request):
        entrada = MisDatosSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        contacto.guardar(
            request.user,
            nombres=datos["nombres"],
            apellidos=datos["apellidos"],
            telefono=datos["telefono"],
            departamento=datos["area"],
            sede=datos["agencia"],
            cargo=datos["cargo"],
            acepta_telefono=datos["acepta_telefono"],
            ip=get_client_ip(request),
        )
        return Response({**contacto.de(request.user), **contacto.opciones()})


# --- Organigrama (módulo Institucional) ---------------------------------------

MODULO_INSTITUCIONAL = "institucional"


class OrganigramaView(APIView):
    """El organigrama de la empresa activa: niveles, unidades, cargos y quién
    ocupa cada uno. Completo con `institucional.ver` (o quien lo arma o asigna
    cargos); con solo `institucional.ver_area`, el de su área (21/10/2026)."""

    permission_classes = [IsAuthenticated, VerOrganigramaPermission]

    def get(self, request):
        completo = any(
            user_has_permission(request.user, f"institucional.{p}")
            for p in ("ver", "editar", "asignar", "perfil_cargo")
        )
        if completo:
            return Response({**organigrama.arbol(), "alcance": {"tipo": "empresa"}})
        return Response(organigrama.arbol_de_area(request.user))


class _EstructuraViewSet(viewsets.ModelViewSet):
    """Niveles, unidades y cargos: se crean, editan y borran (si nada depende
    de ellos), y cada cambio queda en la auditoría."""

    permission_classes = [IsAuthenticated, InstitucionalPermission]
    entidad = ""

    def _auditar(self, accion, objeto, nuevos=None, anteriores=None):
        record_audit_event(
            actor=self.request.user,
            action=f"institucional.{self.entidad}.{accion}",
            target=objeto,
            module=MODULO_INSTITUCIONAL,
            previous_values=anteriores or {},
            new_values=nuevos or {},
            context=get_request_context(self.request),
        )

    def perform_create(self, serializer):
        objeto = serializer.save()
        self._auditar("created", objeto, serializer.data)

    def perform_update(self, serializer):
        anteriores = self.get_serializer(serializer.instance).data
        objeto = serializer.save()
        self._auditar("updated", objeto, serializer.data, anteriores)

    def destroy(self, request, *args, **kwargs):
        objeto = self.get_object()
        motivo = organigrama.no_se_puede_borrar(objeto)
        if motivo:
            return Response({"detail": motivo}, status=status.HTTP_409_CONFLICT)
        self._auditar("deleted", objeto, anteriores=self.get_serializer(objeto).data)
        objeto.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NivelJerarquicoViewSet(_EstructuraViewSet):
    """Los niveles ordenan el organigrama. Los roles ya no salen de aquí sino
    de los cargos (ver `roles_de_cargo`)."""

    serializer_class = NivelJerarquicoSerializer
    entidad = "nivel"

    def get_queryset(self):
        return NivelJerarquico.objects.order_by("orden", "nombre")


class UnidadOrganizacionalViewSet(_EstructuraViewSet):
    """Cada unidad es también el departamento del sistema: se crea, renombra y
    desactiva con ella (ver `departamentos_del_organigrama.py`)."""

    serializer_class = UnidadOrganizacionalSerializer
    entidad = "unidad"

    def perform_update(self, serializer):
        super().perform_update(serializer)
        # El rol de un cargo con homónimos lleva el nombre de su unidad: si la
        # unidad se renombra, se renombran con ella.
        for cargo in serializer.instance.cargos.select_related("rol", "unidad", "empresa"):
            roles_de_cargo.asegurar_rol(cargo, con_homonimos=False)

    def destroy(self, request, *args, **kwargs):
        unidad = self.get_object()
        respuesta = super().destroy(request, *args, **kwargs)
        if respuesta.status_code == status.HTTP_204_NO_CONTENT:
            departamentos_del_organigrama.al_borrar(unidad)
        return respuesta

    def get_queryset(self):
        return UnidadOrganizacional.objects.select_related("nivel", "padre").order_by(
            "orden", "nombre"
        )


class CargoViewSet(_EstructuraViewSet):
    """Cada cargo es un rol del sistema (ver `roles_de_cargo`): se crea, se
    renombra y se borra con él."""

    serializer_class = CargoSerializer
    entidad = "cargo"

    def perform_create(self, serializer):
        with transaction.atomic():
            super().perform_create(serializer)
            roles_de_cargo.asegurar_rol(serializer.instance)

    def perform_update(self, serializer):
        with transaction.atomic():
            super().perform_update(serializer)
            roles_de_cargo.asegurar_rol(serializer.instance)

    def destroy(self, request, *args, **kwargs):
        cargo = self.get_object()
        respuesta = super().destroy(request, *args, **kwargs)
        if respuesta.status_code == status.HTTP_204_NO_CONTENT:
            roles_de_cargo.borrar_rol(cargo)
        return respuesta

    def get_queryset(self):
        return Cargo.objects.select_related("unidad", "jefe").order_by("nombre")


class PerfilCargoView(APIView):
    """El perfil de un cargo (objetivo, funciones, competencias y KPIs):
    leerlo y, con `institucional.perfil_cargo`, escribirlo."""

    permission_classes = [IsAuthenticated, PerfilCargoPermission]

    def _cargo(self, pk):
        cargo = Cargo.objects.filter(pk=pk).first()
        if cargo is None:
            from django.http import Http404

            raise Http404("No se encontró el cargo.")
        return cargo

    def get(self, request, pk):
        return Response(perfiles_cargo.de(self._cargo(pk), con_herramientas=True))

    def put(self, request, pk):
        cargo = self._cargo(pk)
        entrada = PerfilCargoSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        anteriores = perfiles_cargo.de(cargo, con_herramientas=True)
        perfiles_cargo.guardar(cargo, entrada.validated_data)
        nuevo = perfiles_cargo.de(cargo, con_herramientas=True)
        record_audit_event(
            actor=request.user,
            action="institucional.cargo.perfil",
            target=cargo,
            module=MODULO_INSTITUCIONAL,
            previous_values={k: anteriores[k] for k in (*perfiles_cargo.CAMPOS, "herramientas")},
            new_values={k: nuevo[k] for k in (*perfiles_cargo.CAMPOS, "herramientas")},
            context=get_request_context(request),
        )
        return Response(nuevo)


def _xlsx(contenido, nombre):
    from django.http import HttpResponse

    respuesta = HttpResponse(
        contenido,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    respuesta["Content-Disposition"] = f'attachment; filename="{nombre}"'
    return respuesta


class PlantillaPersonasView(APIView):
    """La plantilla .xlsx de carga masiva: la estructura por unidad, sin
    personas."""

    permission_classes = [IsAuthenticated, ArmarOAsignarPermission]

    def get(self, request):
        from . import carga_personas

        return _xlsx(carga_personas.construir_plantilla(), "plantilla-carga-organigrama.xlsx")


class ExportarOrganigramaView(APIView):
    """El organigrama completo en .xlsx: estructura, quién ocupa cada plaza
    (con nombre y correo) y el resumen por unidad. Queda en la auditoría."""

    permission_classes = [IsAuthenticated, ArmarOAsignarPermission]

    def get(self, request):
        from django.utils import timezone

        from . import carga_personas

        record_audit_event(
            actor=request.user,
            action="institucional.organigrama.exportado",
            target=None,
            module=MODULO_INSTITUCIONAL,
            context=get_request_context(request),
        )
        return _xlsx(
            carga_personas.construir_plantilla(con_personas=True),
            f"organigrama-completo-{timezone.localdate():%Y-%m-%d}.xlsx",
        )


class CargaPersonasView(APIView):
    """Sube la plantilla llena: sin `confirmar=true` solo valida y devuelve el
    reporte; con él, lo aplica (todo o nada)."""

    permission_classes = [IsAuthenticated, AsignarCargosPermission]
    parser_classes = [MultiPartParser]

    def post(self, request):
        from . import carga_personas

        reporte = carga_personas.leer(request.FILES.get("archivo"))
        confirmar = str(request.data.get("confirmar", "")).lower() == "true"
        if not reporte["valido"]:
            return Response(carga_personas.publico(reporte), status=status.HTTP_400_BAD_REQUEST)
        if not confirmar:
            return Response({**carga_personas.publico(reporte), "aplicado": False})
        resultado = carga_personas.aplicar(reporte)
        record_audit_event(
            actor=request.user,
            action="institucional.personas.carga_masiva",
            target=None,
            module=MODULO_INSTITUCIONAL,
            new_values={
                "cargos": resultado["cargos"],
                "personas": resultado["personas"],
                "con_cuenta": resultado["con_cuenta"],
                "sin_cuenta": resultado["sin_cuenta"],
            },
            context=get_request_context(request),
        )
        return Response({**resultado, "aplicado": True})


class AsignacionesView(APIView):
    """Quién está en qué cargo, y ponerlo o sacarlo. Escribe en el mismo dato
    que la persona elige en «Mi perfil»: el último que lo cambia manda."""

    permission_classes = [IsAuthenticated, AsignarCargosPermission]

    def get(self, request):
        from apps.chat.services import buscar_personas

        personas = list(buscar_personas(request.query_params.get("q", ""), limite=50))
        cargos = {
            fila.usuario_id: fila.cargo
            for fila in DatosDeContacto.objects.filter(
                usuario__in=personas, cargo__isnull=False
            ).select_related("cargo__unidad")
        }
        return Response(
            [
                {
                    "id": p.id,
                    "nombre": p.get_full_name().strip() or p.username,
                    "correo": p.email,
                    "cargo": (
                        {
                            "id": cargos[p.id].id,
                            "nombre": organigrama.nombre_con_unidad(cargos[p.id]),
                        }
                        if p.id in cargos
                        else None
                    ),
                }
                for p in personas
            ]
        )

    def post(self, request):
        from apps.chat.services import personas_de_la_empresa

        entrada = AsignacionSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        usuario = personas_de_la_empresa().filter(pk=entrada.validated_data["usuario"]).first()
        if usuario is None:
            return Response(
                {"usuario": ["Esa persona no está registrada en esta empresa."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        cargo = entrada.validated_data["cargo"]
        anterior = (
            DatosDeContacto.objects.filter(usuario=usuario)
            .values_list("cargo_id", flat=True)
            .first()
        )
        organigrama.asignar(usuario, cargo)
        roles_de_cargo.sincronizar(_empresa_activa(), [usuario])
        record_audit_event(
            actor=request.user,
            action="institucional.cargo.asignado",
            target=usuario,
            module=MODULO_INSTITUCIONAL,
            previous_values={"cargo": anterior},
            new_values={"cargo": cargo.id if cargo else None},
            context=get_request_context(request),
        )
        return Response({"usuario": usuario.id, "cargo": cargo.id if cargo else None})


class DocumentoInstitucionalViewSet(viewsets.ModelViewSet):
    """Códigos de conducta y reglamentos de la empresa activa.

    Toda persona con sesión ve los vigentes y los abre; quien tiene
    `codigos.publicar` ve también los retirados, los publica, los
    edita y los borra. Abrir uno queda en la auditoría: es la constancia de que
    la persona tuvo acceso a la norma.
    """

    permission_classes = [IsAuthenticated, DocumentosPermission]
    serializer_class = DocumentoInstitucionalSerializer

    def _gestiona(self) -> bool:
        from apps.permissions.authorization import user_has_permission

        return user_has_permission(self.request.user, "codigos.publicar")

    def get_queryset(self):
        queryset = DocumentoInstitucional.objects.select_related("subido_por")
        if not self._gestiona():
            queryset = queryset.filter(activo=True)
        return queryset.order_by("categoria", "titulo")

    def _auditar(self, accion, documento, nuevos=None):
        record_audit_event(
            actor=self.request.user,
            action=f"institucional.documento.{accion}",
            target=documento,
            module=MODULO_INSTITUCIONAL,
            new_values=nuevos or {},
            context=get_request_context(self.request),
        )

    def _uno_predeterminado(self, documento):
        """Marcar uno desmarca al que lo era: se abre primero uno solo."""
        if documento.predeterminado:
            DocumentoInstitucional.objects.exclude(pk=documento.pk).filter(
                predeterminado=True
            ).update(predeterminado=False)

    def perform_create(self, serializer):
        documento = serializer.save(subido_por=self.request.user)
        self._uno_predeterminado(documento)
        confidencialidad.documentos_cambiaron()
        self._auditar("publicado", documento, {"titulo": documento.titulo})

    def perform_update(self, serializer):
        anterior = serializer.instance.archivo.name if serializer.instance.archivo else ""
        documento = serializer.save()
        self._uno_predeterminado(documento)
        confidencialidad.documentos_cambiaron()
        if "archivo" in serializer.validated_data and anterior:
            # Se reemplazó el archivo: el viejo no queda huérfano en el disco.
            documento.archivo.storage.delete(anterior)
        self._auditar("editado", documento, {"titulo": documento.titulo})

    def perform_destroy(self, documento):
        self._auditar("borrado", documento, {"titulo": documento.titulo})
        documento.borrar_archivo()
        documento.delete()
        confidencialidad.documentos_cambiaron()

    @action(detail=True, methods=["get"])
    def archivo(self, request, pk=None):
        documento = self.get_object()
        if not confidencialidad.aceptado(request.user):
            # Sin el acuerdo aceptado no se entrega el contenido, aunque se
            # pida directo a la API.
            return Response(
                {
                    "error": {
                        "code": "acuerdo_pendiente",
                        "message": "Acepte el acuerdo de confidencialidad para ver los documentos.",
                    }
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            fichero = documento.archivo.open("rb")
        except FileNotFoundError as error:
            raise Http404("El archivo ya no está disponible en el servidor.") from error
        self._auditar("abierto", documento)
        respuesta = FileResponse(
            fichero,
            filename=documento.nombre_original,
            content_type=documento.content_type or "application/octet-stream",
        )
        # El visor del sistema lo pide como blob; servido como adjunto y sin
        # adivinar el tipo, el navegador no lo ejecuta por su cuenta.
        respuesta["Content-Disposition"] = (
            f"attachment; filename*=UTF-8''{quote(documento.nombre_original)}"
        )
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta


class ConfidencialidadView(APIView):
    """El acuerdo de confidencialidad: verlo (con si la persona ya lo aceptó
    para la versión vigente de los documentos) y, con
    `codigos.acuerdo`, cambiar su título y texto."""

    permission_classes = [IsAuthenticated, AcuerdoPermission]

    def get(self, request):
        return Response(confidencialidad.estado(request.user))

    def put(self, request):
        entrada = AcuerdoConfidencialidadSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        vigente = confidencialidad.acuerdo()
        anteriores = {"titulo": vigente.titulo, "texto": vigente.texto}
        vigente.titulo = entrada.validated_data["titulo"].strip()
        vigente.texto = entrada.validated_data["texto"].strip()
        vigente.save(update_fields=["titulo", "texto", "updated_at"])
        record_audit_event(
            actor=request.user,
            action="institucional.confidencialidad.editada",
            target=vigente,
            module=MODULO_INSTITUCIONAL,
            previous_values=anteriores,
            new_values={"titulo": vigente.titulo, "texto": vigente.texto},
            context=get_request_context(request),
        )
        return Response(confidencialidad.estado(request.user))


class AceptarConfidencialidadView(APIView):
    """Aceptar el acuerdo: toda persona con sesión. Queda con su fecha."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        aceptacion = confidencialidad.aceptar(request.user)
        record_audit_event(
            actor=request.user,
            action="institucional.confidencialidad.aceptada",
            target=request.user,
            module=MODULO_INSTITUCIONAL,
            new_values={
                "version_documentos": aceptacion.version_documentos,
                "aceptado_en": aceptacion.aceptado_en.isoformat(),
            },
            context=get_request_context(request),
        )
        return Response(confidencialidad.estado(request.user))


class AceptacionesConfidencialidadView(APIView):
    """Quién aceptó el acuerdo y cuándo (pide `codigos.ver_aceptaciones`)."""

    permission_classes = [IsAuthenticated, AceptacionesPermission]

    def get(self, request):
        from .models import AceptacionConfidencialidad

        vigente = confidencialidad.acuerdo().version_documentos
        filas = AceptacionConfidencialidad.objects.select_related("usuario").order_by(
            "-aceptado_en"
        )[:500]
        return Response(
            [
                {
                    "id": fila.id,
                    "persona": fila.usuario.get_full_name().strip() or fila.usuario.username,
                    "correo": fila.usuario.email,
                    "aceptado_en": fila.aceptado_en,
                    "version": fila.version_documentos,
                    "vigente": fila.version_documentos == vigente,
                }
                for fila in filas
            ]
        )


class NoticiaInicioViewSet(viewsets.ModelViewSet):
    """El carrusel de Inicio: toda persona con sesión ve las imágenes vigentes
    hoy; quien tiene `noticias.gestionar` ve todas (también las programadas y
    vencidas), las sube, las edita y las borra."""

    permission_classes = [IsAuthenticated, NoticiasPermission]
    serializer_class = NoticiaInicioSerializer

    def _gestiona(self) -> bool:
        from apps.permissions.authorization import user_has_permission

        return user_has_permission(self.request.user, "noticias.gestionar")

    def get_queryset(self):
        # El listado muestra lo vigente hoy (es lo que ve el Inicio); quien
        # gestiona pide `?todas=1` y abre, edita o borra cualquiera.
        todas = self.action != "list" or self.request.query_params.get("todas") == "1"
        if self._gestiona() and todas:
            queryset = NoticiaInicio.objects.all()
        else:
            queryset = noticias.vigentes()
        return queryset.order_by("orden", "-publicar_desde", "id")

    def _auditar(self, accion, noticia):
        record_audit_event(
            actor=self.request.user,
            action=f"institucional.noticia.{accion}",
            target=noticia,
            module=MODULO_INSTITUCIONAL,
            new_values={
                "titulo": noticia.titulo,
                "publicar_desde": str(noticia.publicar_desde),
                "publicar_hasta": str(noticia.publicar_hasta),
            },
            context=get_request_context(self.request),
        )

    def perform_create(self, serializer):
        self._auditar("publicada", serializer.save(subido_por=self.request.user))

    def perform_update(self, serializer):
        anterior = serializer.instance.imagen.name if serializer.instance.imagen else ""
        noticia = serializer.save()
        if "imagen" in serializer.validated_data and anterior:
            noticia.imagen.storage.delete(anterior)
        self._auditar("editada", noticia)

    def perform_destroy(self, noticia):
        self._auditar("borrada", noticia)
        noticia.borrar_imagen()
        noticia.delete()

    @action(detail=True, methods=["get"])
    def imagen(self, request, pk=None):
        noticia = self.get_object()
        try:
            fichero = noticia.imagen.open("rb")
        except FileNotFoundError as error:
            raise Http404("La imagen ya no está disponible en el servidor.") from error
        respuesta = FileResponse(
            fichero, content_type=noticia.content_type or "application/octet-stream"
        )
        respuesta["X-Content-Type-Options"] = "nosniff"
        respuesta["Cache-Control"] = "private, max-age=300"
        return respuesta


class AjustesCarruselView(APIView):
    """Cada cuántos segundos cambia el carrusel: lo leen todos (lo usa el
    Inicio); cambiarlo pide `noticias.gestionar`."""

    permission_classes = [IsAuthenticated, NoticiasPermission]

    def get(self, request):
        return Response({"segundos": noticias.ajustes().segundos})

    def put(self, request):
        entrada = AjustesCarruselSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        actual = noticias.ajustes()
        anterior = actual.segundos
        actual.segundos = entrada.validated_data["segundos"]
        actual.save(update_fields=["segundos", "updated_at"])
        record_audit_event(
            actor=request.user,
            action="institucional.carrusel.ajustado",
            target=actual,
            module=MODULO_INSTITUCIONAL,
            previous_values={"segundos": anterior},
            new_values={"segundos": actual.segundos},
            context=get_request_context(request),
        )
        return Response({"segundos": actual.segundos})


class EventoCalendarioViewSet(viewsets.ModelViewSet):
    """Las fechas del calendario de Inicio, para gestionarlas: verlas es de
    todos; agregar, editar y borrar pide `calendario.gestionar`."""

    permission_classes = [IsAuthenticated, CalendarioPermission]
    serializer_class = EventoCalendarioSerializer

    def get_queryset(self):
        return EventoCalendario.objects.order_by("fecha", "titulo")

    def _auditar(self, accion, evento):
        record_audit_event(
            actor=self.request.user,
            action=f"institucional.calendario.{accion}",
            target=evento,
            module=MODULO_INSTITUCIONAL,
            new_values={"titulo": evento.titulo, "fecha": str(evento.fecha), "tipo": evento.tipo},
            context=get_request_context(self.request),
        )

    def perform_create(self, serializer):
        self._auditar("agregado", serializer.save(creado_por=self.request.user))

    def perform_update(self, serializer):
        self._auditar("editado", serializer.save())

    def perform_destroy(self, evento):
        self._auditar("borrado", evento)
        evento.delete()


class CalendarioView(APIView):
    """Lo que hay en el calendario entre `desde` y `hasta` (el mes que se
    mira), con los cumpleaños y demás fechas anuales en cada año del rango."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        import datetime

        try:
            desde = datetime.date.fromisoformat(request.query_params.get("desde", ""))
            hasta = datetime.date.fromisoformat(request.query_params.get("hasta", ""))
        except ValueError:
            return Response(
                {"detail": "Indique desde y hasta como AAAA-MM-DD."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if hasta < desde or (hasta - desde).days > calendario.DIAS_MAXIMOS:
            return Response(
                {"detail": "El rango debe ir hacia adelante y no pasar de 400 días."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(calendario.apariciones(desde, hasta))


def _aviso_inicio():
    return avisos_inicio.actual()


def _datos_del_aviso(aviso):
    return {
        "activo": aviso.activo,
        "titulo": aviso.titulo,
        "contenido": aviso.contenido,
        "tiene_imagen": bool(aviso.imagen),
        "version": aviso.version,
        "actualizado": aviso.updated_at,
    }


class AvisoInicioView(APIView):
    """El aviso que se muestra al entrar al sistema: lo leen todos; cambiarlo
    pide `configuracion.aviso_inicio`."""

    permission_classes = [IsAuthenticated, AvisoInicioPermission]

    def get(self, request):
        return Response(_datos_del_aviso(_aviso_inicio()))

    def put(self, request):
        entrada = AvisoInicioSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        aviso = _aviso_inicio()
        avisos_inicio.guardar(aviso, datos)
        record_audit_event(
            actor=request.user,
            action="configuracion.aviso_inicio.actualizado",
            target=aviso,
            module="configuracion",
            new_values={"activo": aviso.activo, "titulo": aviso.titulo},
            context=get_request_context(request),
        )
        return Response(_datos_del_aviso(aviso))


class ImagenAvisoInicioView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        aviso = _aviso_inicio()
        if not aviso.imagen:
            raise Http404("El aviso no tiene imagen.")
        try:
            fichero = aviso.imagen.open("rb")
        except FileNotFoundError as error:
            raise Http404("La imagen ya no está disponible en el servidor.") from error
        respuesta = FileResponse(
            fichero, content_type=aviso.content_type or "application/octet-stream"
        )
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta


class MisVacacionesView(APIView):
    """Mis vacaciones: por período, los días que me corresponden, los que
    gocé y los que me quedan. Toda persona con sesión ve las suyas."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(vacaciones.resumen(request.user))


class VacacionesDeTodosView(APIView):
    """Las vacaciones de cualquier persona de la empresa (pide
    `vacaciones.ver_todas`): sin `usuario`, la lista de personas con sus días
    pendientes; con `usuario`, el detalle de esa persona."""

    permission_classes = [IsAuthenticated, VacacionesDeTodosPermission]

    def get(self, request):
        from apps.chat.services import personas_de_la_empresa

        usuario = request.query_params.get("usuario", "")
        if not usuario.isdigit():
            return Response(vacaciones.personas(request.query_params.get("q", "")))
        persona = personas_de_la_empresa().filter(pk=int(usuario)).first()
        if persona is None:
            raise Http404("Esa persona no está en esta empresa.")
        return Response(vacaciones.resumen(persona))


def _empresa_activa():
    actual = empresa_actual()
    return None if actual in (None, SIN_EMPRESA) else actual


class MiCumpleanosView(APIView):
    """Mi cumpleaños en el calendario de Inicio: mostrarlo (aceptando que sea
    público, con día y mes) o retirarlo, cuando quiera."""

    permission_classes = [IsAuthenticated]

    def put(self, request):
        entrada = CumpleanosSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        resultado = contacto.guardar_cumpleanos(
            request.user, mostrar=datos["mostrar"], dia=datos.get("dia"), mes=datos.get("mes")
        )
        record_audit_event(
            actor=request.user,
            action=(
                "organizacion.cumpleanos.publicado"
                if datos["mostrar"]
                else "organizacion.cumpleanos.retirado"
            ),
            target=request.user,
            module="institucional",
            new_values={"mostrar": datos["mostrar"]},
            context=get_request_context(request),
        )
        return Response(resultado)


class MiAniversarioView(APIView):
    """Mi aniversario en la empresa en el calendario de Inicio: mostrarlo
    (aceptando que sea público, con día y mes de ingreso y, si quiere, el
    año) o retirarlo, cuando quiera."""

    permission_classes = [IsAuthenticated]

    def put(self, request):
        entrada = AniversarioSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        resultado = contacto.guardar_aniversario(
            request.user,
            mostrar=datos["mostrar"],
            dia=datos.get("dia"),
            mes=datos.get("mes"),
            anio=datos.get("anio"),
        )
        record_audit_event(
            actor=request.user,
            action=(
                "organizacion.aniversario.publicado"
                if datos["mostrar"]
                else "organizacion.aniversario.retirado"
            ),
            target=request.user,
            module="institucional",
            new_values={"mostrar": datos["mostrar"]},
            context=get_request_context(request),
        )
        return Response(resultado)


# --- Mis herramientas -------------------------------------------------------------------


class HerramientaViewSet(viewsets.ModelViewSet):
    """El catálogo de herramientas y licencias. Una con personas que la usan
    no se borra: se desactiva."""

    permission_classes = [IsAuthenticated, HerramientasPermission]
    serializer_class = HerramientaSerializer
    #: El catálogo completo, sin páginas: se elige de él en «Mis herramientas»
    #: y en el perfil de cada cargo.
    pagination_class = None

    def get_queryset(self):
        return Herramienta.objects.order_by("tipo", "orden", "nombre")

    def _auditar(self, accion, objeto):
        record_audit_event(
            actor=self.request.user,
            action=f"institucional.herramienta.{accion}",
            target=objeto,
            module=MODULO_INSTITUCIONAL,
            new_values={"nombre": objeto.nombre, "tipo": objeto.tipo, "activa": objeto.activa},
            context=get_request_context(self.request),
        )

    def perform_create(self, serializer):
        self._auditar("creada", serializer.save())

    def perform_update(self, serializer):
        self._auditar("editada", serializer.save())

    @action(detail=True, methods=["get", "post"], url_path="usuarios")
    def usuarios(self, request, pk=None):
        """Quiénes tienen acceso a la herramienta; con POST se da acceso a
        una persona (se refleja en sus «Mis herramientas»)."""
        herramienta = self.get_object()
        if request.method == "GET":
            if not user_has_permission(request.user, "herramientas.gestionar"):
                raise PermissionDenied("No tiene el permiso requerido: herramientas.gestionar.")
            return Response(herramientas.usuarios_de(herramienta))
        entrada = AccesoHerramientaSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        from apps.users.models import User

        usuario = User.objects.filter(pk=entrada.validated_data["usuario"]).first()
        if usuario is None:
            raise Http404("No se encontró la persona.")
        lista = herramientas.dar_acceso(herramienta, usuario, entrada.validated_data["cuenta"])
        self._auditar_acceso("dado", herramienta, usuario)
        return Response(lista)

    @action(detail=True, methods=["delete"], url_path=r"usuarios/(?P<usuario_id>\d+)")
    def quitar_usuario(self, request, pk=None, usuario_id=None):
        herramienta = self.get_object()
        lista = herramientas.quitar_acceso(herramienta, int(usuario_id))
        from apps.users.models import User

        self._auditar_acceso("quitado", herramienta, User.objects.filter(pk=usuario_id).first())
        return Response(lista)

    @action(detail=False, methods=["get"], url_path="personas")
    def personas(self, request):
        """Personas de la empresa para darles acceso (`q` filtra)."""
        if not user_has_permission(request.user, "herramientas.gestionar"):
            raise PermissionDenied("No tiene el permiso requerido: herramientas.gestionar.")
        from apps.chat.services import buscar_personas

        return Response(
            [
                {"id": u.id, "nombre": u.get_full_name().strip() or u.username, "correo": u.email}
                for u in buscar_personas(request.query_params.get("q", ""), limite=20)
            ]
        )

    def _auditar_acceso(self, accion, herramienta, usuario):
        record_audit_event(
            actor=self.request.user,
            action=f"institucional.herramienta.acceso_{accion}",
            target=herramienta,
            module=MODULO_INSTITUCIONAL,
            new_values={
                "herramienta": herramienta.nombre,
                "persona": usuario.email if usuario else None,
            },
            context=get_request_context(self.request),
        )

    def destroy(self, request, *args, **kwargs):
        herramienta = self.get_object()
        if herramienta.usos.exists():
            return Response(
                {"detail": "Hay personas que la usan: desactívela en vez de borrarla."},
                status=status.HTTP_409_CONFLICT,
            )
        self._auditar("borrada", herramienta)
        return super().destroy(request, *args, **kwargs)


class MisHerramientasView(APIView):
    """«Mi perfil» → Mis herramientas: las que uso (con su cuenta) y el
    catálogo para elegir."""

    permission_classes = [IsAuthenticated]

    def _respuesta(self, request, mias=None):
        cargo = herramientas.cargo_de(request.user)
        return Response(
            {
                "mias": herramientas.mias(request.user) if mias is None else mias,
                "catalogo": herramientas.catalogo(),
                # Con las que debe venir configurado su equipo, según su cargo.
                "cargo": {"id": cargo.id, "nombre": cargo.nombre} if cargo else None,
                "base": herramientas.base_de(cargo),
            }
        )

    def get(self, request):
        return self._respuesta(request)

    def put(self, request):
        entrada = MisHerramientasSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        mias = herramientas.guardar_mias(request.user, entrada.validated_data["herramientas"])
        record_audit_event(
            actor=request.user,
            action="institucional.mis_herramientas.guardadas",
            target=request.user,
            module=MODULO_INSTITUCIONAL,
            new_values={"herramientas": [h["nombre"] for h in mias]},
            context=get_request_context(request),
        )
        return self._respuesta(request, mias)


class UsoHerramientasView(APIView):
    """Quién usa cada herramienta: para las requisiciones de desactivación,
    reasignación o licencias nuevas."""

    permission_classes = [IsAuthenticated, GestionarHerramientasPermission]

    def get(self, request):
        return Response(herramientas.uso())


class TextosLegalesView(APIView):
    """Configuración → Textos legales (26/10/2026): los textos de tratamiento
    de datos personales que aceptan las personas. Cambiar uno sube su versión
    y queda en la auditoría con el texto anterior y el nuevo."""

    permission_classes = [IsAuthenticated, TextosLegalesPermission]

    def get(self, request, clave=None):
        if clave is None:
            return Response(textos_legales.todos())
        if clave not in textos_legales.TEXTOS:
            raise Http404()
        return Response(textos_legales.de(clave))

    def put(self, request, clave=None):
        if clave not in textos_legales.TEXTOS:
            raise Http404()
        texto = (request.data.get("texto") or "").strip()
        if len(texto) < 20:
            raise ValidationError({"texto": "Escriba el texto completo (al menos 20 caracteres)."})
        if len(texto) > 4000:
            raise ValidationError({"texto": "Como máximo 4000 caracteres."})
        vigente, anterior = textos_legales.guardar(clave, texto)
        if vigente.texto != anterior:
            record_audit_event(
                actor=request.user,
                action="configuracion.texto_legal.actualizado",
                target=vigente,
                module="configuracion",
                previous_values={"texto": anterior, "version": vigente.version - 1},
                new_values={"texto": vigente.texto, "version": vigente.version},
                context=get_request_context(request),
            )
        return Response(textos_legales.de(clave))
