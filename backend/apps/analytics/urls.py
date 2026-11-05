"""Rutas del motor de KPI, montadas en `/api/v1/analytics/` (parte del módulo
Gestión Humana: se apagan con él, ver `apps.empresas.modulos`).

En Nexo vivían en tres raíces: `/kpis/`, `/analytics/` y `/predictive/`.
Aquí van bajo una sola, conservando el resto del camino: `kpis/…`,
`<user_id>/`, `insights/…` y `predictive/…`. Las rutas literales van antes
de las que llevan `<int:…>` por legibilidad (no colisionan: el conversor
`int` no acepta texto)."""

from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.MeView.as_view(), name="analytics-me"),
    # --- KPI (Nexo: /kpis/) ---
    path("kpis/me/range/", views.KpiMeRangeView.as_view(), name="kpis-me-range"),
    # Exportación a Excel (05/11/2026): mismo ámbito y permisos que su pantalla.
    path("kpis/me/export/", views.KpiMeExportView.as_view(), name="kpis-me-export"),
    path("kpis/team/export/", views.TeamKpiExportView.as_view(), name="kpis-team-export"),
    path(
        "kpis/executive/export/",
        views.ExecutiveDashboardExportView.as_view(),
        name="kpis-executive-export",
    ),
    path("kpis/me/", views.KpiMeView.as_view(), name="kpis-me"),
    path("kpis/team-capacity/", views.TeamCapacityView.as_view(), name="kpis-team-capacity"),
    path("kpis/team/", views.TeamKpiView.as_view(), name="kpis-team"),
    path("kpis/executive/", views.ExecutiveDashboardView.as_view(), name="kpis-executive"),
    path("kpis/<int:user_id>/", views.KpiUserView.as_view(), name="kpis-user"),
    # --- Analytics (Nexo: /analytics/) ---
    path("insights/<int:user_id>/", views.InsightsView.as_view(), name="analytics-insights"),
    path("equilibrio/<int:user_id>/", views.EquilibrioView.as_view(), name="analytics-equilibrio"),
    path("benchmarks/<int:user_id>/", views.BenchmarkView.as_view(), name="analytics-benchmarks"),
    path("simulate/<int:user_id>/", views.SimulateKpiView.as_view(), name="analytics-simulate"),
    path(
        "operational-risk/team/",
        views.TeamOperationalRiskView.as_view(),
        name="analytics-operational-risk-team",
    ),
    path(
        "operational-risk/<int:user_id>/",
        views.OperationalRiskView.as_view(),
        name="analytics-operational-risk",
    ),
    path(
        "recommendations/team/",
        views.TeamRecommendationsView.as_view(),
        name="analytics-recommendations-team",
    ),
    path("history/<int:user_id>/", views.HistoryView.as_view(), name="analytics-history"),
    path(
        "target-time/<int:user_id>/",
        views.TargetTimePrecisionView.as_view(),
        name="analytics-target-time",
    ),
    path("data-quality/", views.DataQualityView.as_view(), name="analytics-data-quality"),
    path("diagnostics/", views.AnalyticsDiagnosticsView.as_view(), name="analytics-diagnostics"),
    # --- Inteligencia Preventiva (Nexo: /predictive/) ---
    path(
        "predictive/predictions/<int:user_id>/",
        views.PredictionBundleView.as_view(),
        name="predictive-predictions",
    ),
    path(
        "predictive/trend/<int:user_id>/", views.TrendEngineView.as_view(), name="predictive-trend"
    ),
    path(
        "predictive/alerts/<int:user_id>/",
        views.PreventiveAlertsView.as_view(),
        name="predictive-alerts",
    ),
    path(
        "predictive/team-alerts/",
        views.TeamPreventiveAlertsView.as_view(),
        name="predictive-team-alerts",
    ),
    path(
        "predictive/team-subutilization/",
        views.TeamSubutilizationView.as_view(),
        name="predictive-team-subutilization",
    ),
    path(
        "predictive/project-delay/<int:project_id>/",
        views.ProjectDelayView.as_view(),
        name="predictive-project-delay",
    ),
    path(
        "predictive/simulate/redistribute/",
        views.SimulateRedistributeLoadView.as_view(),
        name="predictive-simulate-redistribute",
    ),
    path(
        "predictive/simulate/project/<int:project_id>/",
        views.SimulateAddParticipantsView.as_view(),
        name="predictive-simulate-project",
    ),
    path(
        "predictive/simulate/<int:user_id>/",
        views.SimulateAdjustTargetTimeView.as_view(),
        name="predictive-simulate-user",
    ),
    # --- Ajustes del motor (Nexo: /settings/) ---
    path(
        "settings/analytics-config/",
        views.AnalyticsConfigView.as_view(),
        name="analytics-settings-config",
    ),
    path(
        "settings/workload-config/",
        views.WorkloadConfigView.as_view(),
        name="analytics-settings-workload",
    ),
    path(
        "settings/prediction-window/",
        views.PredictionWindowView.as_view(),
        name="analytics-settings-prediction-window",
    ),
    path(
        "settings/normalization-curves/",
        views.NormalizationCurvesView.as_view(),
        name="analytics-settings-curves",
    ),
    path(
        "settings/role-targets/",
        views.RoleTargetsView.as_view(),
        name="analytics-settings-role-targets",
    ),
    path(
        "settings/role-compatibility/",
        views.RoleCompatibilityView.as_view(),
        name="analytics-settings-role-compatibility",
    ),
    path(
        "settings/kpi-start-date/",
        views.KpiStartDateView.as_view(),
        name="analytics-settings-kpi-start-date",
    ),
    # --- Bundle de una persona (Nexo: /analytics/<user_id>/) ---
    path("<int:user_id>/", views.AnalyticsBundleView.as_view(), name="analytics-bundle"),
]
