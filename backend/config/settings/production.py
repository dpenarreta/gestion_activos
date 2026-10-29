from .base import *  # noqa: F401,F403

# Cada valor crítico se fuerza aquí explícitamente, sin depender de que el
# .env compartido tenga el valor "correcto" — así los valores de desarrollo
# nunca se propagan a producción por descuido.
DEBUG = False
ENVIRONMENT_NAME = "production"

# --- HTTPS (auditoría de seguridad, 29/10/2026: revisado, sin cambio de valores) ---
# La redirección y HSTS ya se leen del entorno y por defecto quedan ENCENDIDOS:
# un servidor nuevo nace seguro y apagarlo es una decisión escrita en su .env.
# Hoy el sitio corre por http en la red interna, sin certificado, y por eso el
# backend\.env del servidor (lo genera scripts/deploy/instalar-servidor.ps1)
# trae SECURE_SSL_REDIRECT=False y SECURE_HSTS_SECONDS=0. No se invierte el
# valor por defecto (p. ej. con un HTTPS_ACTIVO=False): dejaría desprotegido a
# cualquier despliegue que olvide la variable.
#
# Para activar HTTPS cuando haya certificado, en este orden:
#   1. Binding https en IIS con el certificado, y que IIS mande
#      X-Forwarded-Proto=https a Django (variable HTTP_X_FORWARDED_PROTO en la
#      regla «API hacia Django», permitida en allowedServerVariables). Waitress
#      (scripts/serve_windows.py) ya la acepta de 127.0.0.1 y con ella Django
#      sabe que la petición fue segura; sin ella, la redirección entra en bucle.
#      La regla tiene que FIJAR el valor, no copiar el que mande el cliente.
#   2. En el .env del servidor: quitar SECURE_SSL_REDIRECT=False, dejar
#      SECURE_HSTS_SECONDS con un valor corto de prueba (p. ej. 300) y pasar
#      FRONTEND_URL, PUBLIC_API_URL, CORS_ALLOWED_ORIGINS y CSRF_TRUSTED_ORIGINS
#      a https://. Reiniciar el servicio y probar.
#   3. Comprobado que todo va por https, quitar SECURE_HSTS_SECONDS para volver
#      al año. HSTS solo se aplica a nombres de dominio, no a una IP: con el
#      sitio publicado por IP la cabecera no tiene efecto aunque se envíe.
# Las cookies Secure se quedan fijas en True: la API va con token en cabecera,
# no con cookie, así que por http no rompen nada (solo el admin de Django, que
# no se publica en la red, depende de ellas).
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)  # noqa: F405
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
# Un año y con `preload`: por debajo de ese plazo los navegadores no aceptan la
# inclusión en la lista precargada, y sin ella la primera visita de cada usuario
# sigue viajando en claro hasta la redirección.
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=60 * 60 * 24 * 365)  # noqa: F405
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# --- Estáticos servidos por el propio contenedor (sin nginx delante de
# Django): solo sirven el admin y, potencialmente, el schema de Redoc/
# Swagger. La UI de negocio vive en el frontend React, servido aparte. ---
MIDDLEWARE = (  # noqa: F405
    MIDDLEWARE[:1] + ["whitenoise.middleware.WhiteNoiseMiddleware"] + MIDDLEWARE[1:]  # noqa: F405
)
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
