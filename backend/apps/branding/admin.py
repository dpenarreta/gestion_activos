from django.contrib import admin

from .models import SiteTheme


@admin.register(SiteTheme)
class SiteThemeAdmin(admin.ModelAdmin):
    list_display = ("site_name", "short_name", "updated_at")

    def has_add_permission(self, request):
        # Singleton: una única fila, sembrada por migración de datos.
        return not SiteTheme.objects.exists()
