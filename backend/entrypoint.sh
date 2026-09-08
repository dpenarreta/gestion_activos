#!/bin/sh
# Entrypoint del contenedor de producción: espera la base de datos, aplica
# migraciones y recolecta estáticos con las variables de entorno reales del
# contenedor (nunca con valores ficticios en tiempo de build — este proyecto
# falla rápido si falta una variable obligatoria, ver
# config/settings/base.py::_fail_fast_on_missing_env), y recién ahí arranca
# gunicorn.
set -e

python scripts/wait_for_db.py
python manage.py collectstatic --noinput
python manage.py migrate --noinput

exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers "${GUNICORN_WORKERS:-3}"
