from django.contrib import admin

from .models import CargaArchivo, RegistroCartera


@admin.register(CargaArchivo)
class CargaArchivoAdmin(admin.ModelAdmin):
    list_display = ('id', 'nombre_original', 'estado', 'fecha_carga', 'fecha_corte', 'total_filas_excel')
    list_filter = ('estado',)
    readonly_fields = ('id', 'fecha_carga')


@admin.register(RegistroCartera)
class RegistroCarteraAdmin(admin.ModelAdmin):
    list_display = ('cliente', 'ruc_cliente', 'numero_documento', 'saldo', 'fecha_vencimiento', 'recuperador', 'causal')
    list_filter = ('causal', 'recuperador', 'ciudad')
    search_fields = ('cliente', 'ruc_cliente', 'numero_documento')
