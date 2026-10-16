from django.urls import path

from . import dashboard_views

urlpatterns = [
    path('', dashboard_views.DashboardCreateView.as_view(), name='dashboards-create'),
    path('authorized', dashboard_views.DashboardsAuthorizedView.as_view(), name='dashboards-authorized'),
    path('<slug:dashboard_id>/layout', dashboard_views.DashboardLayoutView.as_view(), name='dashboard-layout'),
    path('<slug:dashboard_id>/layout/reset', dashboard_views.DashboardLayoutResetView.as_view(), name='dashboard-layout-reset'),
    path('<slug:dashboard_id>/componentes-presentacionales', dashboard_views.DashboardComponentePresentacionalView.as_view(), name='dashboard-componente-presentacional'),
    path('<slug:dashboard_id>/versions', dashboard_views.DashboardVersionsView.as_view(), name='dashboard-versions'),
    path('<slug:dashboard_id>/pestanas', dashboard_views.DashboardTabsView.as_view(), name='dashboard-pestanas'),
    path('<slug:dashboard_id>/fuente-bd', dashboard_views.DashboardFuenteBDView.as_view(), name='dashboard-fuente-bd'),
    path('<slug:dashboard_id>/borrar-datos', dashboard_views.DashboardBorrarDatosView.as_view(), name='dashboard-borrar-datos'),
    path('<slug:dashboard_id>/acceso', dashboard_views.DashboardAccesoView.as_view(), name='dashboard-acceso'),
    path('<slug:dashboard_id>/dueno', dashboard_views.DashboardDuenoView.as_view(), name='dashboard-dueno'),
    path('<slug:dashboard_id>/interpretacion', dashboard_views.DashboardInterpretacionView.as_view(), name='dashboard-interpretacion'),
    path('<slug:dashboard_id>/hallazgos-ia', dashboard_views.DashboardHallazgosIAView.as_view(), name='dashboard-hallazgos-ia'),
    path('<slug:dashboard_id>/deudor', dashboard_views.DashboardConsultaDeudorView.as_view(), name='dashboard-consulta-deudor'),
    path('<slug:dashboard_id>/descargar-datos', dashboard_views.DashboardDescargarDatosView.as_view(), name='dashboard-descargar-datos'),
    path('<slug:dashboard_id>/', dashboard_views.DashboardDetailView.as_view(), name='dashboard-detail'),
]
