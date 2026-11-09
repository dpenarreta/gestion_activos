from django.contrib import admin

from .models import UsoNova


@admin.register(UsoNova)
class UsoNovaAdmin(admin.ModelAdmin):
    """Solo lectura: el registro de uso no se edita."""

    list_display = ("creado", "usuario", "funcion", "proveedor", "modelo", "resultado", "exito")
    list_filter = ("funcion", "proveedor", "resultado", "exito")
    date_hierarchy = "creado"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
