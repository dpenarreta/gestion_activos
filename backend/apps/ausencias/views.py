"""Endpoints de las ausencias (`/api/v1/ausencias/`), portados de
`/api/v1/settings/leave-records/` y `/special-status/` de Nexo.

En Nexo solo el superusuario los usaba. Aquí:

- `leave-records/` (GET): cualquiera con sesión ve lo que le toca
  (`access.visible_user_ids`): lo suyo con detalle; lo de su equipo o de la
  empresa, enmascarado salvo con `ausencias.medicas_ver`.
- `leave-records/` (POST) y `leave-records/<id>/` (DELETE): según el tipo y
  quién lo registró (`access.can_create` / `can_delete`).
- `special-status/`: solo `ausencias.estados_gestionar`.

Las vistas resuelven parámetros y delegan en `services.py`. Errores en el
contrato uniforme `{"error": {"code", "message", "details"}}`."""

from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.request_meta import get_request_context
from apps.core.responses import error_response
from apps.permissions.permissions import Requiere

from . import access
from .serializers import (
    LeaveRecordCreateSerializer,
    LeaveRecordQuerySerializer,
    SpecialStatusCreateSerializer,
)
from .services import (
    AusenciasError,
    LeaveRecordService,
    SpecialStatusService,
    access_summary,
    serialize_leave_record,
    serialize_special_status,
)


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


class AusenciasView(APIView):
    permission_classes = [IsAuthenticated]

    @property
    def context(self) -> dict:
        return get_request_context(self.request)

    def handle_exception(self, exc):
        if isinstance(exc, AusenciasError):
            return error_response(exc.code, exc.message, exc.status, exc.details)
        response = super().handle_exception(exc)
        if isinstance(exc, ValidationError) and isinstance(response.data, dict):
            error = response.data.get("error")
            if isinstance(error, dict):
                error["message"] = _primer_mensaje(exc.detail) or error.get("message")
        return response

    def validated(self, serializer_class, data=None):
        serializer = serializer_class(data=self.request.data if data is None else data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data


class MeView(AusenciasView):
    """`GET /ausencias/me/`: qué puede ver y hacer la persona."""

    def get(self, request):
        return Response(access_summary(request.user))


class LeaveRecordListView(AusenciasView):
    """`GET /ausencias/leave-records/?user_id=&month=YYYY-MM&type=` y
    `POST` (un registro por día laborable del rango)."""

    def get(self, request):
        filtros = self.validated(LeaveRecordQuerySerializer, data=request.query_params)
        return Response(
            LeaveRecordService.list_for(
                request.user,
                user_id=filtros.get("user_id"),
                month=filtros.get("month"),
                leave_type=filtros.get("type"),
            )
        )

    def post(self, request):
        data = self.validated(LeaveRecordCreateSerializer)
        records = LeaveRecordService.create_range(
            actor=request.user,
            user_id=data["user_id"],
            leave_type=data["type"],
            start_date=data["start_date"],
            end_date=data["end_date"],
            is_full_day=data["is_full_day"],
            duration_minutes=data.get("duration_minutes"),
            observation=data.get("observation"),
            context=self.context,
        )
        return Response(
            {
                "records": [serialize_leave_record(r, request.user) for r in records],
                "businessDaysCount": len(records),
            },
            status=status.HTTP_201_CREATED,
        )


class LeaveRecordDetailView(AusenciasView):
    """`DELETE /ausencias/leave-records/<id>/`."""

    def delete(self, request, pk):
        LeaveRecordService.delete(actor=request.user, pk=pk, context=self.context)
        return Response({"ok": True})


class SpecialStatusBaseView(AusenciasView):
    permission_classes = [IsAuthenticated, Requiere(access.ESTADOS_GESTIONAR)]


class SpecialStatusListView(SpecialStatusBaseView):
    """`GET /ausencias/special-status/?user_id=` y `POST`."""

    def get(self, request):
        user_id = request.query_params.get("user_id")
        if user_id is not None and not str(user_id).isdigit():
            raise AusenciasError(
                "El usuario no es válido.", details={"user_id": ["Debe ser un número."]}
            )
        return Response(SpecialStatusService.list(user_id=int(user_id) if user_id else None))

    def post(self, request):
        data = self.validated(SpecialStatusCreateSerializer)
        record = SpecialStatusService.create(actor=request.user, data=data, context=self.context)
        return Response(serialize_special_status(record), status=status.HTTP_201_CREATED)


class SpecialStatusDetailView(SpecialStatusBaseView):
    """`PATCH /ausencias/special-status/<id>/` (finalizar: nunca extiende) y
    `DELETE`."""

    def patch(self, request, pk):
        record = SpecialStatusService.finalize(actor=request.user, pk=pk, context=self.context)
        return Response(serialize_special_status(record))

    def delete(self, request, pk):
        SpecialStatusService.delete(actor=request.user, pk=pk, context=self.context)
        return Response({"ok": True})
