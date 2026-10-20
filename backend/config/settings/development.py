from .base import *  # noqa: F401,F403

DEBUG = True

# Rol de pagos: sin procedimiento configurado, en desarrollo se consultan datos
# de ejemplo (marcados así en el PDF). Se apaga con NOMINA_ROL_DEMO=False.
NOMINA_ROL_DEMO = env.bool("NOMINA_ROL_DEMO", default=True)  # noqa: F405

INSTALLED_APPS += []  # noqa: F405 — punto de extensión para apps solo de desarrollo
