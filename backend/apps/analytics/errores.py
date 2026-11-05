"""El error del motor de KPI, traducido por las vistas al contrato uniforme
`{"error": {"code", "message", "details"}}` de la intranet."""


class AnalyticsError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str = "validation_error",
        status: int = 400,
        details: dict | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.details = details


def not_found(message: str) -> AnalyticsError:
    return AnalyticsError(message, code="not_found", status=404)


def forbidden(message: str) -> AnalyticsError:
    return AnalyticsError(message, code="permission_denied", status=403)
