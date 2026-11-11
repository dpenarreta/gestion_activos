# Historia de Usuario: US-007 - Imágenes del carrusel institucional: límite de 5 MB bien medido e imágenes verticales

- **ID:** US-007
- **Tipo:** Bug + Historia de Usuario
- **Fecha:** 2026-11-11
- **Sprint / Módulo:** Institucional › Noticias / carrusel de inicio (`backend/apps/organizacion/noticias.py`, `frontend/src/pages/Institucional/GestionNoticiasPage.jsx`, `CarruselNoticias.jsx`)
- **Estado:** COMPLETADA
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-2, DEV-4

---

### 1. Definición
- **Comportamiento actual (bug):**
  - Al subir una imagen de unos 5,04 MB aparece «La imagen pesa 5.0 MB y el máximo es 5 MB».
  - El límite son 5 × 1 048 576 bytes. El mensaje redondea a un decimal, así que parece que rechaza una imagen de 5 MB justos.
- **Comportamiento actual (orientación):**
  - El carrusel tiene un marco fijo de 16:10 con `object-fit: cover`.
  - Una imagen vertical (un afiche, por ejemplo) queda recortada arriba y abajo.
  - La ayuda pide 1600 × 1000.
- **Comportamiento esperado:**
  - Una imagen apenas por encima del límite se optimiza en el navegador antes de subirla y se acepta.
  - Si aun así excede, el mensaje dice el peso real sin redondear hacia abajo.
  - El carrusel muestra completas tanto las imágenes horizontales como las verticales.
- **Pasos para reproducir:** Institucional → Gestionar noticias → «Agregar imagen» con un JPG de 5 024 xxx bytes.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · Optimizar antes de subir**
  - **Dado que:** elijo una imagen JPG, PNG o WebP que pesa más de 5 MB o mide más de 2400 px por el lado mayor.
  - **Cuando:** la selecciono.
  - **Entonces:**
    - El navegador la reduce: lado mayor de hasta 2400 px, conservando la proporción y en JPG o WebP de buena calidad.
    - Si así queda en 5 MB o menos, se usa la versión optimizada y se informa «Se optimizó la imagen: de 5,04 MB a 1,2 MB».
    - Los PNG con transparencia se conservan como PNG o WebP, nunca JPG con fondo negro.

- **CA-2 · Mensaje de tamaño honesto**
  - **Dado que:** una imagen sigue pesando más del límite después de optimizarla, o llega al servidor sin optimizar.
  - **Entonces:**
    - El mensaje muestra el peso con dos decimales, redondeado hacia arriba («5,04 MB»), nunca «5.0 MB».
    - Se corrige igual en los demás validadores con el mismo patrón: adjuntos, documentos institucionales, mejora continua y Nova.

- **CA-3 · Horizontales y verticales en el carrusel**
  - **Dado que:** el carrusel de inicio tiene imágenes horizontales y verticales.
  - **Entonces:**
    - Cada imagen se ve completa, sin recortes (`contain`).
    - El espacio sobrante se rellena con la misma imagen desenfocada y oscurecida de fondo, así que no quedan bandas vacías.
    - El alto de la fila no cambia.
    - El texto alternativo sigue igual.

- **CA-4 · Ayuda actualizada**
  - **Entonces:**
    - La ayuda del formulario y el bloque «Medidas de las imágenes» dicen: «JPG, PNG o WebP, hasta 5 MB. Horizontales o verticales; recomendado 1600 × 1000 px (horizontal) o 1000 × 1600 px (vertical). Las imágenes grandes se optimizan solas.»
    - La vista previa del formulario muestra la imagen como se verá en el carrusel.

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| Backend | DEV-2 | Mensaje de tamaño con dos decimales y redondeo hacia arriba en `noticias.py` y en los validadores con el mismo patrón (`adjuntos/validators.py`, `organizacion/documentos.py`, `mejora_continua/services.py`, `nova/conocimiento.py`), con una función común. Pruebas. |
| Web | DEV-4 | Utilidad reutilizable para optimizar imágenes en el navegador (canvas o `createImageBitmap`) usada en «Agregar imagen». Carrusel con `contain` y fondo desenfocado. Textos de ayuda y vista previa. Pruebas. |

**Fuera de alcance:** que el servidor recomprima las imágenes; otros formularios de subida de imágenes, salvo que usen el mismo componente.

---

### 4. Decisiones Técnicas y Supuestos
- **Optimizar en el navegador.** Es lo que resuelve el caso real: una foto de 5 MB para un carrusel de 1600 px es mucho más grande de lo necesario. Subir el límite solo movería el problema.
- **El límite sigue en 5 MB binarios (5 242 880 bytes)**, en el servidor como única regla.
- **Imágenes verticales con `contain` y fondo desenfocado**, para no cambiar el alto del carrusel ni recortar los afiches.

---

### 5. Registro de Cierre
- **Estado final:** COMPLETADA
- **Fecha de cierre:** 2026-11-11
- **QA-FUNC:** APROBADO · **QA-TECH:** APROBADO · **QA-UX:** APROBADO
- **Criterios de aceptación:** CA-1 a CA-4 cumplidos. Las imágenes se optimizan en el navegador (lado mayor 2400 px; los PNG con transparencia no pasan a JPG). El peso se muestra con dos decimales redondeando hacia arriba, con una función común en el servidor (`core/archivos.py`). Carrusel con `contain` y fondo desenfocado; la ayuda está actualizada.
- **Archivos principales:** `backend/apps/core/archivos.py` (usado en noticias, adjuntos, documentos, mejora continua, Nova y chat); `frontend/src/utils/imagenes.js`, `utils/formato.js`, `pages/Institucional/{CarruselNoticias,GestionNoticiasPage}.jsx`, `Institucional.css`.
- **Verificación ejecutada:** Verificación final del 11/11/2026, con nada más corriendo: `pytest` de las 18 apps tocadas con `-n 4`: 3958 passed, 8 skipped. `makemigrations --check`: sin cambios. `vitest run`: 3141 passed. `vite build`: correcto. eslint sobre los archivos tocados: limpio, salvo tres `autoFocus` que ya existían en dashboards.
- **Pendientes:** Ninguno.
