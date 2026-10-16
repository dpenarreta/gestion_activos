from django.urls import path

from . import plantilla_base_views, views

urlpatterns = [
    path('plantilla-base/layout', plantilla_base_views.PlantillaBaseLayoutView.as_view(), name='plantilla-base-layout'),
    path('plantilla-base/reset', plantilla_base_views.PlantillaBaseResetView.as_view(), name='plantilla-base-reset'),
    path('validar-archivo', views.ValidarArchivoView.as_view(), name='validar-archivo'),
    path('conectar-fuente-bd', views.ConectarFuenteBDView.as_view(), name='conectar-fuente-bd'),
    path('actualizar-fuente-bd-ahora', views.ActualizarFuenteBDAhoraView.as_view(), name='actualizar-fuente-bd-ahora'),
    path('analizar-columnas', views.AnalizarColumnasView.as_view(), name='analizar-columnas'),
    path('recomendar-graficas', views.RecomendarGraficasView.as_view(), name='recomendar-graficas'),
    path('agregar-grafica', views.AgregarGraficaView.as_view(), name='agregar-grafica'),
    path('plantilla/archivo-actual', views.ArchivoActualDashboardView.as_view(), name='plantilla-archivo-actual'),
    path('plantilla/sugerir', views.SugerirMapeoPlantillaView.as_view(), name='plantilla-sugerir'),
    path('plantilla/previsualizar', views.PrevisualizarMapeoPlantillaView.as_view(), name='plantilla-previsualizar'),
    path(
        'plantilla/previsualizar-componente', views.PrevisualizarMapeoComponenteView.as_view(),
        name='plantilla-previsualizar-componente',
    ),
    path('plantilla/valores-columna', views.ValoresColumnaPlantillaView.as_view(), name='plantilla-valores-columna'),
    path('plantilla/duplicados-columna', views.DuplicadosColumnaPlantillaView.as_view(), name='plantilla-duplicados-columna'),
    path('plantilla/aplicar', views.AplicarMapeoPlantillaView.as_view(), name='plantilla-aplicar'),
    path('procesar', views.ProcesarView.as_view(), name='procesar'),
    path('resumen/<uuid:carga_id>', views.ResumenView.as_view(), name='resumen'),
    path('top-clientes/<uuid:carga_id>', views.TopClientesView.as_view(), name='top-clientes'),
    path('pareto-ciudades/<uuid:carga_id>', views.ParetoCiudadesView.as_view(), name='pareto-ciudades'),
    path('recuperadores/<uuid:carga_id>', views.RecuperadoresView.as_view(), name='recuperadores'),
    path('causales/<uuid:carga_id>', views.CausalesView.as_view(), name='causales'),
    path('recuperadores-causales/<uuid:carga_id>', views.RecuperadoresCausalesView.as_view(), name='recuperadores-causales'),
    path('detalle/<uuid:carga_id>', views.DetalleView.as_view(), name='detalle'),
    path('exportar/<uuid:carga_id>', views.ExportarView.as_view(), name='exportar'),
    path('archivo/<uuid:carga_id>', views.ArchivoView.as_view(), name='archivo'),
    path('historico/cargas', views.HistoricoCargasView.as_view(), name='historico-cargas'),
    path('historico/tabla', views.HistoricoTablaView.as_view(), name='historico-tabla'),
    path('historico/cargas/<uuid:carga_id>/archivo', views.HistoricoArchivoView.as_view(), name='historico-archivo'),
    path('historico/cargas/<uuid:carga_id>/incluir', views.HistoricoCargaIncluidaView.as_view(), name='historico-carga-incluir'),
]
