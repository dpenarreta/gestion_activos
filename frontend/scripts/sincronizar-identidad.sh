#!/usr/bin/env sh
# Copia la identidad base de la Matriz Administrativa de Obligaciones a este
# frontend. Uso (desde frontend/):
#
#   sh scripts/sincronizar-identidad.sh [ruta/a/identidad-base.css]
#
# Sin argumento la busca en el repositorio vecino `matriz_admin`, que es donde
# se genera (`docs/identidad-base/generar.sh`).
#
# La copia es literal salvo por una línea: el `@import` de Google Fonts. La CSP
# del proyecto solo admite fuentes del propio origen (`font-src 'self'`), así
# que en producción esa línea no cargaría nada y además pediría las fuentes a un
# tercero en cada visita. Las mismas tres familias vienen empaquetadas con
# `@fontsource` y se importan en `src/main.jsx`.
#
# No edite `src/styles/identidad-base.css` a mano: lo que cambie aquí se pierde
# en la siguiente sincronización. Las adaptaciones a este sistema van en
# `src/styles/identidad-puente.css`.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
ORIGEN="${1:-$DIR/../../matriz_admin/docs/identidad-base/identidad-base.css}"
DESTINO="$DIR/src/styles/identidad-base.css"

if [ ! -f "$ORIGEN" ]; then
  echo "No se encontró la identidad base en: $ORIGEN" >&2
  exit 1
fi

grep -v '^@import url("https://fonts.googleapis.com' "$ORIGEN" > "$DESTINO"
echo "Sincronizado: $DESTINO"
