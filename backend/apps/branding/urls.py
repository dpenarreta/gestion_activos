from django.urls import path

from .views import ThemeAdminView, ThemeOptionsView, ThemeResetView

urlpatterns = [
    path("", ThemeAdminView.as_view(), name="admin-theme"),
    path("reset/", ThemeResetView.as_view(), name="admin-theme-reset"),
    path("options/", ThemeOptionsView.as_view(), name="admin-theme-options"),
]
