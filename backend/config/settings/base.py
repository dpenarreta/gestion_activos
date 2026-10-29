"""
Configuración base de Django, común a todos los entornos.

Todo valor configurable (claves, URLs, puertos, CORS, correo, expiración de
tokens, algoritmos, nombre del sistema, conexión a SQL Server) se lee
exclusivamente desde variables de entorno. Nada de esto debe modificarse
tocando código fuente.
"""

from datetime import timedelta
from pathlib import Path

import environ
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env")

REQUIRED_ENV_VARS = [
    "SECRET_KEY",
    "JWT_SECRET_KEY",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
]


def _fail_fast_on_missing_env() -> None:
    """Detiene el arranque si falta una variable de entorno obligatoria.

    Nunca se imprimen valores, solo los nombres de las variables ausentes,
    para no filtrar información sensible en logs de arranque.
    """
    missing = [name for name in REQUIRED_ENV_VARS if env.str(name, default=None) is None]
    if missing:
        raise ImproperlyConfigured(
            "No se puede iniciar la aplicación: faltan variables de entorno "
            f"obligatorias: {', '.join(missing)}. Defina estos valores en su "
            "archivo .env (ver .env.example) antes de continuar."
        )


_fail_fast_on_missing_env()

# --- Núcleo ---
SECRET_KEY = env.str("SECRET_KEY")
DEBUG = env.bool("DEBUG", default=False)
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

SYSTEM_NAME = env.str("SYSTEM_NAME", default="Gestión de Activos")
FRONTEND_URL = env.str("FRONTEND_URL", default="http://localhost:5173")
BACKEND_PORT = env.int("BACKEND_PORT", default=8000)
# URL pública por la que se accede a esta API (no necesariamente FRONTEND_URL
# ni BACKEND_PORT: en producción suele ser un dominio detrás de un proxy).
PUBLIC_API_URL = env.str("PUBLIC_API_URL", default=f"http://localhost:{BACKEND_PORT}")

# Nombre de ambiente legible, explícito (no se deriva de DEBUG ni de
# DJANGO_SETTINGS_MODULE). production.py lo fuerza a "production".
ENVIRONMENT_NAME = env.str("ENVIRONMENT_NAME", default="development")

# Versión de la aplicación: el archivo VERSION en la raíz del repo es la
# fuente de verdad; APP_VERSION queda como override operativo puntual.
try:
    _VERSION_FILE_CONTENTS = (BASE_DIR.parent / "VERSION").read_text().strip()
except OSError:
    _VERSION_FILE_CONTENTS = ""
APP_VERSION = env.str("APP_VERSION", default=None) or _VERSION_FILE_CONTENTS or "0.0.0-dev"

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "drf_spectacular",
    "corsheaders",
    "apps.core",
    "apps.empresas",
    "apps.permissions",
    "apps.authentication",
    "apps.users",
    "apps.roles",
    "apps.branding",
    "apps.organizacion",
    "apps.activos",
    "apps.mantenimientos",
    "apps.politicas",
    "apps.alertas",
    "apps.adjuntos",
    "apps.reportes",
    "apps.solicitudes",
    "apps.matriz",
    "apps.cartera",
    "apps.ordenes",
    "apps.correos",
    "apps.notificaciones",
    "apps.chat",
    "apps.soporte",
    "apps.licencias",
    "apps.proyectos",
    "apps.descargas",
    "apps.sugerencias",
    "apps.nomina",
    "apps.capacitacion",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Después de la autenticación: necesita saber quién pregunta para
    # resolver a qué empresa pertenece.
    "apps.empresas.middleware.EmpresaActivaMiddleware",
    "apps.core.csp.ContentSecurityPolicyMiddleware",
    "apps.core.middleware.RequestIDMiddleware",
    "apps.core.middleware.AccessLogMiddleware",
    # La huella de cada archivo que entrega la API, para cotejar las
    # descargas (apps.descargas).
    "apps.descargas.middleware.ArchivosServidosMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        # Solo para lo que Django realmente renderiza server-side: admin y
        # emails transaccionales. La UI de usuario vive en el frontend React.
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# --- Base de datos: SQL Server, exclusivamente por variables de entorno ---
DATABASES = {
    "default": {
        "ENGINE": "mssql",
        "NAME": env.str("DB_NAME"),
        "USER": env.str("DB_USER"),
        "PASSWORD": env.str("DB_PASSWORD"),
        "HOST": env.str("DB_HOST", default="localhost"),
        "PORT": env.str("DB_PORT", default="1433"),
        "OPTIONS": {
            "driver": env.str("DB_DRIVER", default="ODBC Driver 18 for SQL Server"),
            "extra_params": (
                "TrustServerCertificate=yes;"
                if env.bool("DB_TRUST_SERVER_CERTIFICATE", default=True)
                else ""
            ),
        },
        "CONN_MAX_AGE": 600,
    }
}

AUTH_USER_MODEL = "users.User"

# --- Hashing de contraseñas: Argon2 como algoritmo primario ---
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
]

# Reglas de las contraseñas (26/10/2026): mínimo 8 caracteres, con al menos
# una mayúscula, un número y un signo especial, y que no sea la clave temporal
# (ver apps/authentication/validators.py).
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
    {"NAME": "apps.authentication.validators.ComplejidadValidator"},
    {"NAME": "apps.authentication.validators.NoClaveTemporalValidator"},
]

# La clave temporal con la que nacen las cuentas que se crean sin escribir
# contraseña (26/10/2026). Solo sirve para el primer inicio de sesión: toda
# cuenta nueva queda obligada a cambiarla por una propia. Va **solo** en el
# .env de cada entorno, nunca en el código: quien lee el repositorio no debe
# conocerla. Sin ella, el alta vuelve a pedir que se escriba una.
CLAVE_INICIAL_USUARIOS = env.str("CLAVE_INICIAL_USUARIOS", default="")

# --- Internacionalización ---
LANGUAGE_CODE = env.str("LANGUAGE_CODE", default="es")
# La hora local de las empresas, no UTC. Todo lo que se configura con un reloj
# —la hora del respaldo, la del resumen de alertas— se interpreta en esta zona:
# con UTC, «02:30» en pantalla eran las 21:30 en Ecuador, y el sistema no
# respaldaba a la hora que decía. En la base las fechas se guardan igual en UTC
# (`USE_TZ`); esto solo cambia cómo se leen los relojes.
TIME_ZONE = env.str("TIME_ZONE", default="America/Guayaquil")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# --- Archivos subidos (adjuntos y evidencias, §18) ---
# Deliberadamente NO se define MEDIA_URL ni se sirven estos archivos como
# estáticos: se entregan por `apps.adjuntos.views.AdjuntoViewSet.descargar`,
# que exige permiso y deja traza. Aquí se guardan facturas, actas firmadas y
# fotos de los equipos de la empresa; una URL adivinable bastaría para
# sacarlas todas sin pasar por el login.
#
# En Docker debe ser un volumen: sin él, cada despliegue se lleva por delante
# lo que la gente haya subido (ver docker-compose.prod.yml).
MEDIA_ROOT = env.str("MEDIA_ROOT", default=str(BASE_DIR / "media"))

# Dónde ve esta máquina la carpeta en la que SQL Server escribe los `.bak` (con
# Docker, el volumen montado en docker-compose.yml). Hace falta para que la
# pantalla de Respaldos pueda borrar también la copia de la base; vacío, solo
# borra los adjuntos y el manifiesto. Relativa a `backend/` o absoluta.
RESPALDOS_SQL_LOCAL = env.str("RESPALDOS_SQL_LOCAL", default="")

# Un archivo mayor a esto se escribe en un temporal en vez de mantenerse en
# memoria. El límite real de tamaño lo pone `apps.adjuntos.validators`; esto
# solo evita que varias subidas simultáneas de 10 MB convivan en RAM.
FILE_UPLOAD_MAX_MEMORY_SIZE = env.int("FILE_UPLOAD_MAX_MEMORY_SIZE", default=2 * 1024 * 1024)
DATA_UPLOAD_MAX_MEMORY_SIZE = env.int("DATA_UPLOAD_MAX_MEMORY_SIZE", default=12 * 1024 * 1024)

# Permisos del archivo en disco: solo el usuario que corre el proceso. Sin
# esto, el `umask` del sistema decide, y en algunos entornos deja los
# archivos legibles por cualquier cuenta de la máquina.
FILE_UPLOAD_PERMISSIONS = 0o600
FILE_UPLOAD_DIRECTORY_PERMISSIONS = 0o700

# --- Identidad institucional (branding estático/editable, sin biblioteca de medios) ---
# logo_url/favicon_url en apps.branding.SiteTheme son URLs de texto (propias
# o externas) — esta base no incluye un pipeline de carga de archivos
# para mantenerse desacoplado de cualquier módulo de negocio.
BRANDING_LOGO_MAX_URL_LENGTH = 500

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Sesión de cookie del Django admin ---
# Distinto del concepto de "sesión" de la API (JWT + apps.authentication.models.Session):
# esto solo afecta la cookie de sesión del panel de administración de Django.
SESSION_COOKIE_AGE = env.int("SESSION_COOKIE_AGE", default=1209600)

# --- Encabezados de seguridad (aplican en todos los ambientes) ---
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = env.str("X_FRAME_OPTIONS", default="DENY")
SECURE_REFERRER_POLICY = env.str("SECURE_REFERRER_POLICY", default="same-origin")
# Content-Security-Policy: se puede sobreescribir por entorno para el servidor
# que sirva el frontend compilado, que tiene otros orígenes que declarar.
CONTENT_SECURITY_POLICY = env.str("CONTENT_SECURITY_POLICY", default="")

# --- CSRF ---
# La API (todo bajo /api/) usa JWT Bearer sin cookies de sesión, así que CSRF
# no aplica a esos endpoints. El Django admin sí usa cookies de sesión y
# sigue protegido por CsrfViewMiddleware (ya en MIDDLEWARE).
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

# --- Django REST Framework ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("apps.authentication.authentication.SessionAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    # Cuántos proxies de confianza hay delante de Django. En producción, uno:
    # IIS con ARR, que agrega a X-Forwarded-For la IP de quien se le conectó.
    # Con esto DRF (throttling) y `apps.core.request_meta.get_client_ip`
    # (auditoría, bloqueo del login) toman esa IP y no la que el cliente quiera
    # escribir en la cabecera (auditoría de seguridad, 29/10/2026).
    "NUM_PROXIES": env.int("NUM_PROXIES", default=1),
    # Deliberadamente sin `DEFAULT_PAGINATION_CLASS` global: cada listado
    # decide si pagina (ver `apps.users.pagination.UserAdminPagination` y
    # `pagination_class` explícito en `AuditLogViewSet`) — `RoleViewSet`
    # devuelve una lista plana a propósito (son pocos roles, y el frontend
    # espera un array, no `{results, count, ...}`).
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": env.str("DEFAULT_THROTTLE_RATE_ANON", default="100/hour"),
        "user": env.str("DEFAULT_THROTTLE_RATE_USER", default="1000/hour"),
        "login": env.str("LOGIN_THROTTLE_RATE", default="10/min"),
        "password_reset": env.str("PASSWORD_RESET_THROTTLE_RATE", default="5/hour"),
        # Holgado a propósito: una sesión de trabajo renueva su token cada pocos
        # minutos y varias pestañas lo hacen a la vez. Lo que corta no es el uso
        # normal sino el goteo de quien prueba tokens.
        "refresh": env.str("REFRESH_THROTTLE_RATE", default="60/min"),
        # El correo de prueba de alertas dispara un envío real: se limita
        # aparte para que no sirva como generador de correo saliente.
        "alertas_prueba": env.str("ALERTAS_PRUEBA_THROTTLE_RATE", default="10/hour"),
        "correo_prueba": env.str("CORREO_PRUEBA_THROTTLE_RATE", default="10/hour"),
        # Cartera: cada interpretación o hallazgo con IA es una llamada de pago.
        "ia": env.str("IA_THROTTLE_RATE", default="20/hour"),
        # Mesa de ayuda: el formulario público y las respuestas desde el enlace
        # de seguimiento, sin sesión. Frena el spam sin estorbar a una persona.
        # Chat: mensajes por minuto de cada persona; frena el spam y los bucles.
        "chat": env.str("CHAT_THROTTLE_RATE", default="60/min"),
        # Rol de pagos: cada consulta confirma la contraseña de la cuenta; se
        # limita como el inicio de sesión. Y los envíos al correo personal.
        "rol_pagos": env.str("ROL_PAGOS_THROTTLE_RATE", default="10/min"),
        "rol_pagos_envio": env.str("ROL_PAGOS_ENVIO_THROTTLE_RATE", default="10/hour"),
        # Registro de descargas: cada «Descargar» manda su copia. Holgado para
        # quien baja muchos adjuntos seguidos; frena a quien lo use de bodega.
        "descargas": env.str("DESCARGAS_THROTTLE_RATE", default="120/min"),
        # Lo que la pantalla consulta sola cada pocos segundos (novedades del
        # chat, la campana): va aparte del límite general por persona. Si no,
        # el sondeo del chat (cada 4 s, ~900 por hora) agotaba él solo los 1000
        # por hora y todo lo demás empezaba a responder 429 (19/10/2026).
        "sondeo": env.str("SONDEO_THROTTLE_RATE", default="2400/hour"),
        "soporte_formulario": env.str("SOPORTE_FORMULARIO_THROTTLE_RATE", default="5/min"),
    },
}

# --- Documentación OpenAPI (drf-spectacular) ---
SPECTACULAR_SETTINGS = {
    "TITLE": f"{SYSTEM_NAME} API",
    "DESCRIPTION": "API del backend, versionada bajo /api/v1/.",
    "VERSION": APP_VERSION,
    "SERVE_PUBLIC": True,
    # El esquema describe cada endpoint de la API: es un mapa para quien la
    # quiera atacar. Solo para el personal (`is_staff`), no para cualquiera
    # (auditoría de seguridad, 29/10/2026).
    "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAdminUser"],
    "SERVERS": [{"url": PUBLIC_API_URL}],
    "SCHEMA_PATH_PREFIX": "/api/v1/",
}

# --- JWT: clave, algoritmo y expiración configurables por entorno ---
# La rotación y revocación de refresh tokens las gestiona
# apps.authentication.models.Session (permite registrar dispositivo/IP y
# detectar reutilización), por eso se desactiva aquí el mecanismo genérico
# de rotación/blacklist de simplejwt.
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(
        minutes=env.int("JWT_ACCESS_TOKEN_LIFETIME_MINUTES", default=15)
    ),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("JWT_REFRESH_TOKEN_LIFETIME_DAYS", default=7)),
    "ROTATE_REFRESH_TOKENS": False,
    "BLACKLIST_AFTER_ROTATION": False,
    "ALGORITHM": env.str("JWT_ALGORITHM", default="HS256"),
    "SIGNING_KEY": env.str("JWT_SECRET_KEY"),
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

# --- Cierre de sesión por inactividad ---
# El refresh token dura días: sin esto, una sesión abierta en un equipo
# compartido sigue sirviendo mañana. Con esto, cuatro horas sin usarla la
# cierran, y cualquier petición dentro de esas cuatro horas reinicia la cuenta.
SESSION_IDLE_TIMEOUT = timedelta(minutes=env.int("SESSION_IDLE_TIMEOUT_MINUTES", default=240))
# Cada cuánto se reescribe la marca de actividad. Sin este margen habría un
# UPDATE por cada petición de cada usuario; con un minuto, el corte se puede
# adelantar como mucho un minuto sobre el plazo, que en cuatro horas no cambia
# nada de lo que el plazo protege.
SESSION_ACTIVITY_WRITE_EVERY = timedelta(
    seconds=env.int("SESSION_ACTIVITY_WRITE_EVERY_SECONDS", default=60)
)

# --- Protección contra fuerza bruta en el login ---
LOGIN_MAX_FAILED_ATTEMPTS = env.int("LOGIN_MAX_FAILED_ATTEMPTS", default=5)
LOGIN_LOCKOUT_MINUTES = env.int("LOGIN_LOCKOUT_MINUTES", default=15)
# El bloqueo de arriba es por identificador **y IP**: así nadie bloquea la
# cuenta de otro desde su equipo. Este, más alto, cuenta los fallos de todas
# las IP juntas y frena el ataque repartido entre muchas (auditoría de
# seguridad, 29/10/2026).
LOGIN_MAX_FAILED_ATTEMPTS_GLOBAL = env.int("LOGIN_MAX_FAILED_ATTEMPTS_GLOBAL", default=20)

# --- Recuperación de contraseña ---
PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES = env.int(
    "PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES", default=60
)

# --- Módulo administrativo de usuarios ---
ADMIN_USERS_PAGE_SIZE = env.int("ADMIN_USERS_PAGE_SIZE", default=20)

# --- Paginación genérica (roles, auditoría, y futuros listados) ---
DEFAULT_PAGE_SIZE = env.int("DEFAULT_PAGE_SIZE", default=20)

# --- CORS ---
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[FRONTEND_URL])

# `X-Empresa` dice en qué empresa se está trabajando. Sin declararla, el
# navegador la descarta en la comprobación previa y todas las peticiones
# llegarían a la empresa predeterminada: el selector cambiaría de nombre en
# pantalla y no cambiaría los datos, que es la peor forma de fallar.
CORS_ALLOW_HEADERS = (
    "accept",
    "authorization",
    "content-type",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
    "x-empresa",
)

# --- Caché de los agregados del parque ---
# El panel y el centro de alertas recorren el inventario entero para resumirlo,
# y ese trabajo es CPU de Python: medido con 10.000 activos, cada llamada
# cuesta cientos de milisegundos y con cinco usuarios simultáneos se acumula
# hasta varios segundos (ver docs/rendimiento.md). Son cifras agregadas que no
# cambian de un segundo a otro, así que se cachean unos minutos.
#
# `LocMemCache` es por proceso: con varios workers cada uno tendrá el suyo, lo
# que multiplica el trabajo por el número de workers pero no rompe nada. Un
# despliegue con Redis solo tiene que cambiar este bloque.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "gestion-activos",
    }
}

#: Segundos que se conserva el resumen del parque. En cero, se recalcula
#: siempre: útil en desarrollo, caro en producción.
CACHE_AGREGADOS_SEGUNDOS = env.int("CACHE_AGREGADOS_SEGUNDOS", default=120)

# --- Correo ---
EMAIL_BACKEND = env.str("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env.str("EMAIL_HOST", default="localhost")
EMAIL_PORT = env.int("EMAIL_PORT", default=25)
EMAIL_HOST_USER = env.str("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env.str("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=False)
# Sin límite, un servidor que acepta la conexión y no responde deja el envío
# esperando para siempre: una petición colgada y, en la tarea programada, una
# pasada que no termina y bloquea las siguientes (respaldos incluidos).
EMAIL_TIMEOUT = env.int("EMAIL_TIMEOUT", default=20)
DEFAULT_FROM_EMAIL = env.str(
    "DEFAULT_FROM_EMAIL", default=f"no-reply@{SYSTEM_NAME.lower().replace(' ', '-')}.local"
)

# --- Logging estructurado ---
from .logging import build_logging_config  # noqa: E402

LOGGING = build_logging_config(debug=DEBUG)

# --- Matriz de obligaciones -------------------------------------------------
# Prefijo de los códigos de período: OBL-0001, OBL-0002…
PERIOD_CODE_PREFIX = env.str("PERIOD_CODE_PREFIX", default="OBL")
# Tamaño máximo de cada evidencia PDF, en MB (§11.4).
DOCUMENT_MAX_UPLOAD_MB = env.int("DOCUMENT_MAX_UPLOAD_MB", default=10)
# Intentos de cada aviso de la Matriz antes de dejarlo fallido (§12.3).
NOTIFICATION_MAX_ATTEMPTS = env.int("NOTIFICATION_MAX_ATTEMPTS", default=3)
# Cuántos días antes del vencimiento del último período se crea el siguiente (§11.3).
PERIOD_GENERATION_LEAD_DAYS = env.int("PERIOD_GENERATION_LEAD_DAYS", default=30)

# --- Cartera: dashboards de cartera (portado de cms_dashboards) -------------
# Conexión externa de SOLO LECTURA para «Conectar vista de base de datos» y el
# procedimiento del Dashboard Directorio (dbo.sp_Reporte_Seguimiento_Cartera).
# No es una segunda entrada de DATABASES a propósito: se usa por pyodbc directo
# (`apps/cartera/services/db_source.py`) para una consulta por carga, y así
# ninguna migración ni consulta del ORM puede apuntar por error a esa base. Sin
# EXTERNAL_DB_HOST, la función queda deshabilitada con un error claro.
EXTERNAL_DB_HOST = env.str("EXTERNAL_DB_HOST", default="")
EXTERNAL_DB_PORT = env.str("EXTERNAL_DB_PORT", default="1433")
EXTERNAL_DB_NAME = env.str("EXTERNAL_DB_NAME", default="")
EXTERNAL_DB_USER = env.str("EXTERNAL_DB_USER", default="")
EXTERNAL_DB_PASSWORD = env.str("EXTERNAL_DB_PASSWORD", default="")
EXTERNAL_DB_ENCRYPT = env.str("EXTERNAL_DB_ENCRYPT", default="yes")
EXTERNAL_DB_TRUST_SERVER_CERTIFICATE = env.str("EXTERNAL_DB_TRUST_SERVER_CERTIFICATE", default="no")
# Lista blanca de vistas/procedimientos que se pueden consultar en esa base,
# separados por comas (sin distinguir mayúsculas; «dbo.» es opcional). Vacía =
# se acepta cualquier vista o procedimiento propio, nunca uno del sistema, y
# los que empiezan por «sp_» solo si están aquí (auditoría de seguridad,
# 29/10/2026; ver apps/cartera/services/db_source.py::validar_nombre_fuente).
EXTERNAL_DB_OBJETOS_PERMITIDOS = env.list("EXTERNAL_DB_OBJETOS_PERMITIDOS", default=[])

# Una sola empresa (23/10/2026; ver apps.empresas.una_sola): no se crean otras y
# toda cuenta nueva entra a la única. True vuelve a permitir varias.
MULTIEMPRESA = env.bool("MULTIEMPRESA", default=False)

# Consultar rol de pagos (apps.nomina): el procedimiento almacenado de la base
# externa que recibe año, mes y código de empleado. Sin él, en desarrollo se
# usan datos de ejemplo (NOMINA_ROL_DEMO, por defecto igual a DEBUG).
NOMINA_ROL_PROCEDIMIENTO = env.str("NOMINA_ROL_PROCEDIMIENTO", default="")

# Onboarding (apps.capacitacion): días para completarlo desde que se asigna.
CAPACITACION_DIAS_PLAZO = env.int("CAPACITACION_DIAS_PLAZO", default=15)
NOMINA_ROL_DEMO = env.bool("NOMINA_ROL_DEMO", default=DEBUG)
# El driver ODBC es el mismo de la base propia (el módulo de origen lo llama así).
DB_ODBC_DRIVER = env.str("DB_DRIVER", default="ODBC Driver 18 for SQL Server")
# Tamaño máximo del Excel de cartera (25 MiB, como el origen).
UPLOAD_MAX_SIZE_BYTES = env.int("UPLOAD_MAX_SIZE_BYTES", default=25 * 1024 * 1024)
# Temporales (se limpian a las 24 h con `clean_temp_uploads`) y archivos
# aplicados a un dashboard (permanentes, para reconfigurar sin recargar).
CARTERA_TEMP_UPLOADS_DIR = Path(MEDIA_ROOT) / "cartera" / "uploads_temp"
CARTERA_ARCHIVOS_DIR = Path(MEDIA_ROOT) / "cartera" / "archivos_dashboard"
# Filas por lote al insertar en SQL Server.
CARTERA_BULK_BATCH_SIZE = 2000
# IA opcional (Gemini): sin clave, la interpretación responde con un error claro.
GEMINI_API_KEY = env.str("GEMINI_API_KEY", default="")
GEMINI_MODEL = env.str("GEMINI_MODEL", default="gemini-flash-latest")
GEMINI_MODELOS_RESPALDO = env.list(
    "GEMINI_MODELOS_RESPALDO", default=["gemini-3.6-flash", "gemini-3.5-flash-lite"]
)

# --- Mantenimiento de sedes (órdenes de trabajo) ---
# El IVA con el que se calcula el total de cada orden (materiales + mano de
# obra). Ecuador: 15 % desde abril de 2024.
ORDENES_IVA_PORCENTAJE = env.int("ORDENES_IVA_PORCENTAJE", default=15)

# --- Mesa de ayuda ---
# Días que un ticket atendido espera la confirmación de quien lo pidió antes de
# cerrarse solo (si responde antes, se reabre).
SOPORTE_DIAS_CIERRE_AUTOMATICO = env.int("SOPORTE_DIAS_CIERRE_AUTOMATICO", default=3)
