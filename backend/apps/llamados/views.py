"""API de los llamados de atención (US-013, 12/11/2026). Base `/api/v1/llamados/`.

| Ruta | Método | Permiso |
|---|---|---|
| `causas/` | GET | `configurar` (todas; `?activas=1` solo las activas); `emitir`, `solicitar` o `ver` (solo las activas). Quien solo tiene `solicitar` no recibe `asunto` ni `cuerpo` |
| `causas/` y `causas/<id>/` | POST, PUT, PATCH, DELETE | `configurar` |
| `variables/` | GET | `configurar` o `emitir` |
| `vista-previa/` | POST | `configurar` |
| `propuesta/?persona=&causa=&fecha_hecho=&modo=` | GET | `emitir` o `solicitar` (en su equipo) |
| `personas/?q=&modo=` | GET | `emitir` (la empresa), `solicitar` (su equipo) o `ver` (la empresa, para el filtro) |
| `llamados/` | GET | `ver`, `emitir` (todos menos los dirigidos a uno mismo) o `solicitar` (los que pidió) |
| `llamados/` | POST | `emitir` (emite) o `solicitar` (solicita, solo a su equipo) |
| `llamados/<id>/` y `llamados/<id>/adjunto/` | GET | los mismos que la lista; otro, 404 |
| `llamados/<id>/confirmar/`, `rechazar/`, `anular/`, `reenviar-correo/` | POST | `emitir` (nunca sobre lo propio) |
| `mios/` | GET | toda persona con sesión (los suyos, emitidos o anulados) |

Errores con el contrato del proyecto (`{"error": {"code", "message",
"details"}}`): 400 `invalid` con el detalle por campo, 403 `permission_denied`
o `fuera_de_su_equipo`, 404 `not_found`, 409 `estado_invalido`, `en_uso` o
`duplicado`, y 409 `propuesta_cambio` al confirmar (con el nivel nuevo en
`details`).
"""

from urllib.parse import quote

from django.db.models import Count, Q
from django.http import FileResponse, Http404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import SAFE_METHODS, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context
from apps.core.responses import error_response
from apps.descargas.middleware import marcar
from apps.permissions.authorization import user_has_permission
from apps.permissions.permissions import HasActionPermission, Requiere

from . import serializers as s
from . import services
from .models import CausaLlamado, LlamadoAtencion

MODULO = "llamados"
LIMITE_LISTA = 500


def _auditar(request, accion, objetivo, **valores):
    record_audit_event(
        actor=request.user,
        action=f"llamados.{accion}",
        target=objetivo,
        module=MODULO,
        new_values=valores,
        context=get_request_context(request),
    )


def _primero_que_tenga(usuario, *codenames) -> str:
    for codename in codenames:
        if user_has_permission(usuario, codename):
            return codename
    return codenames[0]


# --- Causas -----------------------------------------------------------------------------------


class CausasPermission(HasActionPermission):
    """Leer las causas: quien configura, emite, solicita o ve. Cambiarlas:
    `llamados.configurar`."""

    def get_required_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return _primero_que_tenga(
                request.user,
                services.CONFIGURAR,
                services.EMITIR,
                services.SOLICITAR,
                services.VER,
            )
        return services.CONFIGURAR


class CausaViewSet(viewsets.ViewSet):
    """Las causas con sus niveles. Quien configura ve todas (activas o no) y
    todos sus niveles; con `?activas=1` (el formulario de emitir o solicitar),
    o sin `configurar`, solo las activas y sus niveles activos."""

    permission_classes = [IsAuthenticated, CausasPermission]

    def _configura(self, request) -> bool:
        return user_has_permission(request.user, services.CONFIGURAR)

    def _con_textos(self, request) -> bool:
        """Quien solo solicita no ve los textos de los correos (decisión del Tech
        Lead, 12/11/2026)."""
        return any(
            user_has_permission(request.user, c)
            for c in (services.CONFIGURAR, services.EMITIR, services.VER)
        )

    def _completa(self, causa) -> dict:
        usados = services.niveles_usados(causa)
        total = LlamadoAtencion.objects.filter(causa=causa).count()
        return s.causa_completa(causa, usados, total)

    def _causa(self, pk) -> CausaLlamado:
        causa = CausaLlamado.objects.filter(pk=pk).prefetch_related("niveles").first()
        if causa is None:
            raise Http404("No se encontró la causa.")
        return causa

    def _solo_activas(self, request) -> bool:
        return not self._configura(request) or request.query_params.get("activas") in (
            "1",
            "true",
        )

    def list(self, request):
        causas = CausaLlamado.objects.prefetch_related("niveles").order_by("nombre")
        solo_activas = self._solo_activas(request)
        if solo_activas:
            causas = causas.filter(activa=True)
        conteo = dict(
            LlamadoAtencion.objects.values("causa_id")
            .annotate(total=Count("pk"))
            .values_list("causa_id", "total")
        )
        usados = services.niveles_usados()
        return Response(
            [
                s.causa_completa(
                    c,
                    usados,
                    conteo.get(c.pk, 0),
                    solo_activos=solo_activas,
                    con_textos=self._con_textos(request),
                )
                for c in causas
            ]
        )

    def retrieve(self, request, pk=None):
        causa = self._causa(pk)
        if self._solo_activas(request):
            if not causa.activa:
                raise Http404("No se encontró la causa.")
            usados = services.niveles_usados(causa)
            total = LlamadoAtencion.objects.filter(causa=causa).count()
            return Response(
                s.causa_completa(
                    causa,
                    usados,
                    total,
                    solo_activos=True,
                    con_textos=self._con_textos(request),
                )
            )
        return Response(self._completa(causa))

    def _guardar(self, request, causa, parcial):
        entrada = s.CausaEntradaSerializer(data=request.data, partial=parcial)
        entrada.is_valid(raise_exception=True)
        datos = dict(entrada.validated_data)
        if "plazo_reincidencia_meses" in datos:
            datos["meses_reincidencia"] = datos.pop("plazo_reincidencia_meses")
        niveles = datos.pop("niveles", None)
        if niveles is not None:
            niveles = [dict(n) for n in niveles]
        if causa is None and niveles is None:
            raise ValidationError({"niveles": "Agregue al menos un nivel."})
        guardada = services.guardar_causa(causa, datos, niveles)
        guardada = self._causa(guardada.pk)
        _auditar(
            request,
            "causa.creada" if causa is None else "causa.editada",
            guardada,
            nombre=guardada.nombre,
            activa=guardada.activa,
            niveles=[n.nombre for n in guardada.niveles.all()],
        )
        return Response(
            self._completa(guardada),
            status=status.HTTP_201_CREATED if causa is None else status.HTTP_200_OK,
        )

    def create(self, request):
        return self._guardar(request, None, parcial=False)

    def update(self, request, pk=None):
        return self._guardar(request, self._causa(pk), parcial=False)

    def partial_update(self, request, pk=None):
        return self._guardar(request, self._causa(pk), parcial=True)

    def destroy(self, request, pk=None):
        causa = self._causa(pk)
        nombre, ident = causa.nombre, causa.pk
        services.borrar_causa(causa)
        record_audit_event(
            actor=request.user,
            action="llamados.causa.borrada",
            target_type="causallamado",
            target_id=ident,
            module=MODULO,
            new_values={"nombre": nombre},
            context=get_request_context(request),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class VariablesView(APIView):
    """Las variables de las plantillas: `[{clave, marcador, descripcion,
    ejemplo}]`. Se escriben `{{clave}}` (el `marcador`) o `{clave}`; para un
    bloque que solo sale si la variable tiene valor, `{{#monto}} … {{/monto}}`."""

    permission_classes = [IsAuthenticated, Requiere(services.CONFIGURAR, services.EMITIR)]

    def get(self, request):
        return Response(
            [
                {
                    "clave": v.nombre,
                    "marcador": v.marcador,
                    "descripcion": v.descripcion,
                    "ejemplo": v.ejemplo,
                }
                for v in services.VARIABLES
            ]
        )


class VistaPreviaView(APIView):
    """El correo de un nivel con las variables de ejemplo, tal como saldría."""

    permission_classes = [IsAuthenticated, Requiere(services.CONFIGURAR)]

    def post(self, request):
        entrada = s.VistaPreviaSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        asunto = entrada.validated_data["asunto"]
        cuerpo = entrada.validated_data["cuerpo"]
        correo = services.renderizar(asunto, cuerpo, services.ejemplo())
        return Response({**correo, "desconocidas": services.variables_desconocidas(asunto, cuerpo)})


# --- Propuesta y personas -------------------------------------------------------------------


class PropuestaView(APIView):
    """El nivel propuesto para una persona y una causa, con el monto sugerido.
    Con `emitir` trae además el historial de la persona en esa causa; a un jefe
    (`solicitar`) no se le muestra el historial."""

    permission_classes = [IsAuthenticated, Requiere(services.EMITIR, services.SOLICITAR)]

    def get(self, request):
        parametros = request.query_params
        modo = services.modo_para(request.user, parametros.get("modo"))
        persona = services.exigir_persona(request.user, modo, parametros.get("persona"))
        causa = services.causa_activa(parametros.get("causa"))
        fecha = None
        if parametros.get("fecha_hecho"):
            campo = s.serializers.DateField()
            try:
                fecha = campo.to_internal_value(parametros["fecha_hecho"])
            except s.serializers.ValidationError as error:
                raise ValidationError({"fecha_hecho": error.detail}) from None
        propuesta = services.proponer(persona, causa, fecha=fecha)
        nivel = propuesta.nivel
        respuesta = {
            "modo": modo,
            "persona": {"id": persona.pk, "nombre": services.nombre(persona)},
            "causa": {
                "id": causa.pk,
                "nombre": causa.nombre,
                "meses_reincidencia": causa.meses_reincidencia,
            },
            "nivel_propuesto": s.nivel_resumen(nivel),
            "monto_sugerido": s._monto(nivel.monto_sugerido),
            "es_ultimo_nivel": propuesta.es_ultimo,
            "cuenta_desde": propuesta.desde.isoformat(),
            "niveles": [s.nivel_resumen(n) for n in propuesta.niveles],
            "historial": [],
            **services.destinatarios_previstos(persona),
        }
        if modo == services.Modo.EMITIR:
            cuentan = {p.pk for p in propuesta.previos}
            respuesta["historial"] = [
                {
                    "id": h.pk,
                    "numero": h.numero,
                    "fecha_hecho": h.fecha_hecho.isoformat(),
                    "nivel": h.nivel_nombre,
                    "nivel_tipo": h.nivel_tipo,
                    "estado": h.estado,
                    "estado_display": LlamadoAtencion.Estado(h.estado).label,
                    "cuenta": h.pk in cuentan,
                }
                for h in services.historial_de(persona, causa)
            ]
        return Response(respuesta)


class PersonasView(APIView):
    """A quién puede dirigirse: con `emitir`, toda persona activa de la
    empresa; con `solicitar`, su equipo según el organigrama. `?q=` busca por
    nombre, apellido o usuario; `?modo=` fuerza `emitir` o `solicitar`.
    Devuelve `[{id, nombre, cargo}]`."""

    permission_classes = [
        IsAuthenticated,
        Requiere(services.EMITIR, services.SOLICITAR, services.VER),
    ]

    def get(self, request):
        from apps.organizacion.models import DatosDeContacto

        modo = services.modo_de_personas(request.user, request.query_params.get("modo"))
        personas = services.personas_para(request.user, modo)
        texto = (request.query_params.get("q") or "").strip()[:100]
        if texto:
            personas = personas.filter(
                Q(first_name__icontains=texto)
                | Q(last_name__icontains=texto)
                | Q(username__icontains=texto)
            )
        personas = list(personas.order_by("first_name", "last_name", "username")[:LIMITE_LISTA])
        # Los cargos de todos en una consulta (el gestor ya acota a la empresa).
        cargos = dict(
            DatosDeContacto.objects.filter(
                usuario_id__in=[p.pk for p in personas], cargo__isnull=False
            ).values_list("usuario_id", "cargo__nombre")
        )
        return Response(
            [
                {"id": p.pk, "nombre": services.nombre(p), "cargo": cargos.get(p.pk, "")}
                for p in personas
            ]
        )


# --- Llamados ---------------------------------------------------------------------------------


class LlamadosPermission(HasActionPermission):
    """Ver: `ver`, `emitir` o `solicitar`. Crear: `emitir` o `solicitar` (el
    servicio decide cuál usa). Confirmar, rechazar y anular: `emitir`."""

    def get_required_permission(self, request, view):
        accion = getattr(view, "action", None)
        if accion in ("confirmar", "rechazar", "anular", "reenviar_correo"):
            return services.EMITIR
        if accion == "create":
            return _primero_que_tenga(request.user, services.EMITIR, services.SOLICITAR)
        return _primero_que_tenga(request.user, services.VER, services.EMITIR, services.SOLICITAR)


class LlamadoViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated, LlamadosPermission]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def _llamado(self, request, pk) -> LlamadoAtencion:
        try:
            pk = int(pk)
        except (TypeError, ValueError):
            raise Http404("No se encontró el llamado de atención.") from None
        llamado = services.visibles(request.user).filter(pk=pk).first()
        if llamado is None:
            raise Http404("No se encontró el llamado de atención.")
        return llamado

    def _detalle(self, request, llamado, codigo=status.HTTP_200_OK):
        llamado = self._llamado(request, llamado.pk)
        return Response(s.llamado_detalle(llamado, request.user), status=codigo)

    def list(self, request):
        """Filtros: `persona`, `causa`, `nivel`, `estado` (uno o varios separados
        por coma), `desde` y `hasta` (fecha del hecho, AAAA-MM-DD), `q` (nombre
        de la persona o número) y `mias=1` (solo las que solicité)."""
        p = request.query_params
        consulta = services.visibles(request.user)
        errores = {}
        for campo in ("persona", "causa", "nivel"):
            if p.get(campo):
                try:
                    consulta = consulta.filter(**{f"{campo}_id": int(p[campo])})
                except ValueError:
                    errores[campo] = "Debe ser un número entero."
        if p.get("estado"):
            estados = [e.strip() for e in p["estado"].split(",") if e.strip()]
            validos = set(LlamadoAtencion.Estado.values)
            if any(e not in validos for e in estados):
                errores["estado"] = f"Estados válidos: {', '.join(sorted(validos))}."
            else:
                consulta = consulta.filter(estado__in=estados)
        fecha = s.serializers.DateField()
        for campo, filtro in (("desde", "fecha_hecho__gte"), ("hasta", "fecha_hecho__lte")):
            if p.get(campo):
                try:
                    consulta = consulta.filter(**{filtro: fecha.to_internal_value(p[campo])})
                except s.serializers.ValidationError:
                    errores[campo] = "Use una fecha AAAA-MM-DD."
        if p.get("q"):
            texto = p["q"].strip()[:100]
            consulta = consulta.filter(
                Q(numero__icontains=texto)
                | Q(persona__first_name__icontains=texto)
                | Q(persona__last_name__icontains=texto)
                | Q(persona__username__icontains=texto)
            )
        if p.get("mias") in ("1", "true"):
            consulta = consulta.filter(solicitado_por=request.user)
        if errores:
            raise ValidationError(errores)
        filas = consulta.order_by("-created_at", "-id")[:LIMITE_LISTA]
        return Response([s.llamado_fila(f) for f in filas])

    def retrieve(self, request, pk=None):
        return Response(s.llamado_detalle(self._llamado(request, pk), request.user))

    def create(self, request):
        entrada = s.NuevoLlamadoSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        modo = services.modo_para(request.user, datos.get("modo") or None)
        persona = services.exigir_persona(request.user, modo, datos.get("persona"))
        causa = services.causa_activa(datos.get("causa"))
        llamado = services.crear(
            request.user,
            modo=modo,
            persona=persona,
            causa=causa,
            fecha_hecho=datos["fecha_hecho"],
            descripcion=datos["descripcion"],
            nivel_id=datos.get("nivel"),
            justificacion=datos.get("justificacion_cambio", ""),
            monto=datos.get("monto"),
            adjunto=datos.get("adjunto"),
            adjunto_tipo=getattr(entrada, "_tipo", ""),
        )
        # El correo sale tras el commit: el estado se relee para no auditar uno
        # viejo (el resultado final queda además en `llamados.correo`).
        llamado.refresh_from_db()
        _auditar(
            request,
            "emitido" if modo == services.Modo.EMITIR else "solicitado",
            llamado,
            numero=llamado.numero,
            persona=llamado.persona_id,
            causa=llamado.causa_nombre,
            nivel=llamado.nivel_nombre,
            nivel_propuesto=llamado.nivel_propuesto.nombre if llamado.nivel_propuesto else "",
            monto=s._monto(llamado.monto),
            correo=llamado.correo_estado,
        )
        return self._detalle(request, llamado, status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def confirmar(self, request, pk=None):
        llamado = self._llamado(request, pk)
        entrada = s.ConfirmarSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        try:
            services.confirmar(
                llamado,
                request.user,
                nivel_id=datos.get("nivel"),
                justificacion=datos.get("justificacion_cambio", ""),
                monto=datos.get("monto"),
                descripcion=datos.get("descripcion"),
                nivel_esperado=datos.get("nivel_esperado"),
            )
        except services.PropuestaCambio as cambio:
            # El contrato de error lleva el mensaje y, en `details`, el nivel
            # nuevo para que la web vuelva a mostrar la revisión.
            nivel = cambio.nivel
            return error_response(
                code="propuesta_cambio",
                message=str(cambio.detail),
                status_code=status.HTTP_409_CONFLICT,
                details={
                    "nivel_propuesto": {
                        **s.nivel_resumen(nivel),
                    },
                    "monto_sugerido": s._monto(nivel.monto_sugerido),
                },
            )
        llamado.refresh_from_db()
        _auditar(
            request,
            "confirmado",
            llamado,
            numero=llamado.numero,
            persona=llamado.persona_id,
            nivel=llamado.nivel_nombre,
            nivel_propuesto=llamado.nivel_propuesto.nombre if llamado.nivel_propuesto else "",
            monto=s._monto(llamado.monto),
            correo=llamado.correo_estado,
        )
        return self._detalle(request, llamado)

    def _con_motivo(self, request, pk, hacer, nombre_accion):
        llamado = self._llamado(request, pk)
        entrada = s.MotivoSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        hacer(llamado, request.user, entrada.validated_data["motivo"])
        _auditar(
            request,
            nombre_accion,
            llamado,
            numero=llamado.numero,
            persona=llamado.persona_id,
            estado=llamado.estado,
        )
        return self._detalle(request, llamado)

    @action(detail=True, methods=["post"])
    def rechazar(self, request, pk=None):
        return self._con_motivo(request, pk, services.rechazar, "rechazado")

    @action(detail=True, methods=["post"])
    def anular(self, request, pk=None):
        return self._con_motivo(request, pk, services.anular, "anulado")

    @action(detail=True, methods=["post"], url_path="reenviar-correo")
    def reenviar_correo(self, request, pk=None):
        """Reenvía el correo de un emitido que no salió (`puede.reenviar`)."""
        llamado = self._llamado(request, pk)
        services.reenviar_correo(llamado, request.user)
        llamado.refresh_from_db()
        _auditar(
            request,
            "correo_reenviado",
            llamado,
            numero=llamado.numero,
            persona=llamado.persona_id,
            correo=llamado.correo_estado,
        )
        return self._detalle(request, llamado)

    @action(detail=True, methods=["get"])
    def adjunto(self, request, pk=None):
        """La evidencia, con la misma visibilidad que el llamado. El PDF y las
        imágenes se entregan en línea (visor interno); Word y Excel, o
        cualquiera con `?download=1`, como descarga."""
        llamado = self._llamado(request, pk)
        if not llamado.adjunto:
            raise Http404("Este llamado de atención no tiene evidencia.")
        try:
            fichero = llamado.adjunto.open("rb")
        except FileNotFoundError as error:
            raise Http404("El archivo ya no está disponible en el servidor.") from error
        en_linea = (
            s.visor_de(llamado.adjunto_tipo) is not None
            and request.query_params.get("download") != "1"
        )
        marcar(request, modulo=MODULO, llamado=llamado.pk)
        respuesta = FileResponse(
            fichero, content_type=llamado.adjunto_tipo or "application/octet-stream"
        )
        disposicion = "inline" if en_linea else "attachment"
        nombre = llamado.adjunto_nombre or "evidencia"
        respuesta["Content-Disposition"] = f"{disposicion}; filename*=UTF-8''{quote(nombre)}"
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta


class MiosView(APIView):
    """«Mis llamados de atención» de Mi perfil: los emitidos y los anulados de
    la persona (los anulados vienen marcados; la pantalla decide si los
    muestra). Nunca los solicitados ni los rechazados, ni quién lo solicitó."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        llamados = LlamadoAtencion.objects.filter(
            persona=request.user,
            estado__in=[LlamadoAtencion.Estado.EMITIDO, LlamadoAtencion.Estado.ANULADO],
        ).order_by("-fecha_hecho", "-id")
        return Response([s.mio(ll) for ll in llamados])
