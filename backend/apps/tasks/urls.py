"""Rutas de Tareas y Equipo, montadas en `/api/v1/tasks/`.

Las de Nexo que vivían fuera de `/tasks/` (`/activity-reasons/`,
`/settings/activity-reasons/`, `/activities/day-schedule/` y `/team/`) quedan
aquí dentro, para que el módulo de Gestión Humana tenga un solo prefijo (lo
que se apaga junto con el módulo, ver `apps.empresas.modulos`)."""

from django.urls import path

from . import views

urlpatterns = [
    path("", views.TaskListCreateView.as_view(), name="tasks-list"),
    path("me/", views.MeView.as_view(), name="tasks-me"),
    path("assignable-users/", views.AssignableUsersView.as_view(), name="tasks-assignable-users"),
    path("settings/", views.SettingsView.as_view(), name="tasks-settings"),
    path(
        "target-time/bulk-validate/",
        views.TargetTimeBulkValidateView.as_view(),
        name="tasks-target-time-bulk-validate",
    ),
    path(
        "end-date/bulk-approve/",
        views.EndDateBulkApproveView.as_view(),
        name="tasks-end-date-bulk-approve",
    ),
    path(
        "validations/pending/",
        views.PendingValidationsView.as_view(),
        name="tasks-validations-pending",
    ),
    path("close-month/", views.CloseMonthView.as_view(), name="tasks-close-month"),
    path("repository/", views.RepositoryListView.as_view(), name="tasks-repository"),
    path(
        "repository/<int:year>/<int:month>/",
        views.RepositoryDetailView.as_view(),
        name="tasks-repository-detail",
    ),
    path("import/", views.TaskImportView.as_view(), name="tasks-import"),
    path("template/", views.TaskTemplateView.as_view(), name="tasks-template"),
    path(
        "activity-reasons/",
        views.ActivityReasonListCreateView.as_view(),
        name="tasks-activity-reasons",
    ),
    path(
        "activity-reasons/<int:pk>/",
        views.ActivityReasonDetailView.as_view(),
        name="tasks-activity-reason-detail",
    ),
    path(
        "activities/day-schedule/",
        views.DayScheduleView.as_view(),
        name="tasks-activities-day-schedule",
    ),
    path("team/", views.TeamListView.as_view(), name="tasks-team"),
    path(
        "team/<int:user_id>/tasks/",
        views.TeamMemberTasksView.as_view(),
        name="tasks-team-member-tasks",
    ),
    path("<int:pk>/", views.TaskDetailView.as_view(), name="tasks-detail"),
    path("<int:pk>/comments/", views.TaskCommentsView.as_view(), name="tasks-comments"),
    path("<int:pk>/activities/", views.TaskActivitiesView.as_view(), name="tasks-activities"),
    path(
        "<int:pk>/activities/retroactive/",
        views.TaskRetroactiveActivityView.as_view(),
        name="tasks-activities-retroactive",
    ),
    path(
        "<int:task_id>/activities/<int:activity_id>/",
        views.ActivityDetailView.as_view(),
        name="tasks-activity-detail",
    ),
    path(
        "<int:task_id>/activities/<int:activity_id>/comments/",
        views.ActivityCommentsView.as_view(),
        name="tasks-activity-comments",
    ),
    path("<int:pk>/target-time/", views.TargetTimeView.as_view(), name="tasks-target-time"),
    path("<int:pk>/end-date/", views.EndDateView.as_view(), name="tasks-end-date"),
    path("<int:pk>/correct/", views.CorrectTaskView.as_view(), name="tasks-correct"),
]
