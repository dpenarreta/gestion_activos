"""Rutas del Escritorio, montadas en `/api/v1/escritorio/` (parte del módulo
Gestión Humana: se apagan con él, ver `apps.empresas.modulos`).

Las tres raíces de Nexo (`/api/desk-notes`, `/api/desk-reminders`, `/api/desk`)
quedan como `notes/`, `reminders/` y `today/`/`search/` bajo una sola, con los
mismos nombres de acción (`replies`, `history`, `attachment`,
`convert-to-reminder`, `convert-to-task`, `recipients`, `unread-count`)."""

from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.MeView.as_view(), name="escritorio-me"),
    path("today/", views.TodayView.as_view(), name="escritorio-today"),
    path("search/", views.SearchView.as_view(), name="escritorio-search"),
    path("notes/", views.NoteListCreateView.as_view(), name="escritorio-notes"),
    path("notes/recipients/", views.RecipientsView.as_view(), name="escritorio-recipients"),
    path("notes/unread-count/", views.UnreadCountView.as_view(), name="escritorio-unread"),
    path("notes/<int:pk>/", views.NoteDetailView.as_view(), name="escritorio-note"),
    path(
        "notes/<int:pk>/replies/", views.NoteRepliesView.as_view(), name="escritorio-note-replies"
    ),
    path(
        "notes/<int:pk>/history/", views.NoteHistoryView.as_view(), name="escritorio-note-history"
    ),
    path(
        "notes/<int:pk>/attachment/",
        views.NoteAttachmentView.as_view(),
        name="escritorio-note-attachment",
    ),
    path(
        "notes/<int:pk>/convert-to-reminder/",
        views.NoteToReminderView.as_view(),
        name="escritorio-note-to-reminder",
    ),
    path("reminders/", views.ReminderListCreateView.as_view(), name="escritorio-reminders"),
    path("reminders/<int:pk>/", views.ReminderDetailView.as_view(), name="escritorio-reminder"),
    path(
        "reminders/<int:pk>/history/",
        views.ReminderHistoryView.as_view(),
        name="escritorio-reminder-history",
    ),
    path(
        "reminders/<int:pk>/attachment/",
        views.ReminderAttachmentView.as_view(),
        name="escritorio-reminder-attachment",
    ),
    path(
        "reminders/<int:pk>/convert-to-task/",
        views.ReminderToTaskView.as_view(),
        name="escritorio-reminder-to-task",
    ),
]
