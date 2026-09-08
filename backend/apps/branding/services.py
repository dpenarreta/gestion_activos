"""Lógica de negocio de la identidad institucional / tema visual.

Las vistas delegan aquí — nunca aplican reglas de negocio ni acceden al ORM
directamente.
"""

from apps.core.audit import record_audit_event

from .catalog import DEFAULT_THEME
from .color_contrast import evaluate_theme_contrast
from .models import SiteTheme


class SiteThemeService:
    @staticmethod
    def get_current() -> SiteTheme:
        theme = SiteTheme.objects.first()
        if theme is None:
            # Defensivo: en circunstancias normales la migración de siembra
            # ya crea la fila única; esto solo cubre una BD sin sembrar.
            theme = SiteTheme.objects.create(**DEFAULT_THEME)
        return theme

    @staticmethod
    def update(*, actor, context: dict | None = None, **fields) -> tuple[SiteTheme, list[dict]]:
        """Guarda los cambios (auditados) y devuelve, además del tema, la
        lista de advertencias de contraste — el guardado nunca se bloquea
        por contraste insuficiente, a diferencia de un formato hex inválido
        (que el serializer ya rechazó antes de llegar aquí)."""
        theme = SiteThemeService.get_current()
        previous_values = {}
        new_values = {}
        for field, value in fields.items():
            old = getattr(theme, field)
            if old != value:
                previous_values[field] = old
                new_values[field] = value
                setattr(theme, field, value)

        if new_values:
            theme.save()
            record_audit_event(
                actor=actor,
                action="theme.updated",
                target=theme,
                module="configuracion",
                previous_values=previous_values,
                new_values=new_values,
                context=context,
            )

        contrast_results = evaluate_theme_contrast(theme)
        warnings = [result for result in contrast_results if not result["passes"]]
        return theme, warnings

    @staticmethod
    def reset_to_defaults(*, actor, context: dict | None = None) -> SiteTheme:
        theme = SiteThemeService.get_current()
        previous_values = {field: getattr(theme, field) for field in DEFAULT_THEME}
        for field, value in DEFAULT_THEME.items():
            setattr(theme, field, value)
        theme.save()
        record_audit_event(
            actor=actor,
            action="theme.reset",
            target=theme,
            module="configuracion",
            previous_values=previous_values,
            new_values=DEFAULT_THEME,
            context=context,
        )
        return theme
