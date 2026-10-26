from django.urls import path

from . import views

urlpatterns = [
    path("conversaciones/", views.ConversacionesView.as_view(), name="chat-conversaciones"),
    path("conversaciones/directa/", views.DirectaView.as_view(), name="chat-directa"),
    path("conversaciones/<int:pk>/", views.ConversacionView.as_view(), name="chat-conversacion"),
    path("conversaciones/<int:pk>/salir/", views.SalirView.as_view(), name="chat-salir"),
    path("conversaciones/<int:pk>/mensajes/", views.MensajesView.as_view(), name="chat-mensajes"),
    path("conversaciones/<int:pk>/leer/", views.LeerView.as_view(), name="chat-leer"),
    path("conversaciones/<int:pk>/lecturas/", views.LecturasView.as_view(), name="chat-lecturas"),
    path("novedades/", views.NovedadesView.as_view(), name="chat-novedades"),
    path("directorio/", views.DirectorioView.as_view(), name="chat-directorio"),
    path("personas/<int:pk>/contacto/", views.ContactoView.as_view(), name="chat-contacto"),
    path("presencia/", views.PresenciaView.as_view(), name="chat-presencia"),
    path("mi-estado/", views.MiEstadoView.as_view(), name="chat-mi-estado"),
    path("areas/", views.AreasView.as_view(), name="chat-areas"),
    path("archivos/<int:pk>/", views.ArchivoView.as_view(), name="chat-archivo"),
]
