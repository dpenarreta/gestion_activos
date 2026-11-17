# Historia de Usuario: US-029 - App móvil: botón flotante para crear tickets de soporte

- **ID:** US-029
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-17
- **Sprint / Módulo:** App móvil «Intranet LCE» · Mesa de ayuda (transversal)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-1 (móvil). El backend no cambia.

---

### 1. Definición de la Historia
- **Como:** cualquier persona que puede pedir soporte.
- **Quiero:** un botón flotante, como la burbuja de escanear de Gestión de Activos, que me lleve al formulario para crear un ticket de soporte desde cualquier pantalla.
- **Para:** reportar un problema en el momento, sin tener que buscar la Mesa de ayuda.

Decisiones del usuario (17/11/2026, por preguntas):
- **Dónde:** en todas las pantallas de la app, salvo en Gestión de Activos (allí está la burbuja de escanear) y en el propio formulario del ticket.
- **Qué abre:** el formulario de ticket propio («Nuevo ticket» de la Mesa de ayuda), el mismo de la web.
- **Quién lo ve:** quien tiene permiso para pedir soporte, igual que la web (regla «permisos app = web»). Hoy son todos los usuarios, por `PERMISOS_BASE`.

---

### 2. Criterios de Aceptación
- **CA-1 · Visible por permiso:**
  - Con el permiso con que la web deja crear un ticket propio, la burbuja aparece; sin ese permiso, no aparece.
  - Si el módulo de soporte está apagado en la empresa activa, tampoco aparece.
  - DEV-1 confirma el permiso exacto en el código, el mismo que ya decide «Nuevo ticket» en la barra de la Mesa de ayuda.
- **CA-2 · Dónde aparece:**
  - Aparece en todas las pantallas autenticadas: módulos, fichas, listas, conversaciones, formularios y Cuenta.
  - No aparece:
    - en ninguna pantalla de Gestión de Activos (el módulo `activos` y sus pantallas: ficha, escáner, alta, edición, mantenimientos, solicitudes);
    - en el formulario de Nuevo ticket ni en el de registrar ticket;
    - en el Login ni antes de iniciar sesión;
    - en el visor de imágenes ni en el escáner a pantalla completa.
- **CA-3 · Aspecto y posición:**
  - Es igual que la burbuja de escanear (`BotonFlotante`): círculo amarillo de la marca, ícono de soporte (por ejemplo `headset` o `lifebuoy`), sombra, mismo tamaño y misma posición abajo a la derecha, sobre la barra de funcionalidades.
  - Respeta el modo claro y oscuro (US-026) y no tapa la barra inferior.
  - Cuando aparece el teclado, se oculta para no tapar el campo de escribir.
  - Donde haya otro botón flotante propio (por ejemplo, el «nuevo mensaje» del chat), se coloca de forma que no se superpongan: se apila encima o se desplaza. DEV-1 propone y documenta la solución.
- **CA-4 · Acción:**
  - Tocar la burbuja abre el formulario de ticket propio en la pila, con «Atrás» para volver a donde estaba.
  - Al crear el ticket, se sigue el flujo actual del formulario (abre el ticket creado y lo anuncia).
- **CA-5 · Accesibilidad:**
  - Botón con la etiqueta «Crear un ticket de soporte» y una pista.
  - Área táctil de al menos 48 dp en Android y 44 pt en iOS.
  - No queda en el orden del lector de pantalla por encima del contenido principal de forma molesta.
- **CA-6 · Pruebas:**
  - Visible con permiso y oculta sin permiso o con el módulo apagado.
  - Oculta en Activos y en el formulario del ticket.
  - Navega al formulario al tocarla.
  - Se oculta con el teclado.
  - No se superpone con la burbuja del chat.
  - Se ve en modo oscuro.
  - `npx jest` completo en verde.

### 3. Alcance
- **Móvil:**
  - un componente de la burbuja (reutilizar `BotonFlotante` y `ESPACIO_BOTON_FLOTANTE`);
  - montarlo una vez en el layout autenticado (`src/app/(app)/_layout.js`), con la lógica de en qué ruta se oculta;
  - las pruebas.
- **Backend y web:** sin cambios.

### 4. Registro de Cierre
- **Fecha:** 2026-11-17.
- **QA:**
  - QA-FUNC 🟢 con observaciones (6 de 6).
  - QA-TECH 🔴 en la primera ronda, por un P2: un solo contexto juntaba `visible` con la posición y provocaba re-render global. Tras la corrección pasó a 🟢 con observaciones (solo P3).
- **Ajustes:**
  - Contextos `VisibleContext`, `PosicionContext` y `AccionesContext`, con una prueba de que las pantallas no se vuelven a pintar.
  - `ocultar()` de la barra solo cuando no hay funcionalidades.
  - Margen del sistema con la barra en 0.
  - `moduloApagado` con tres estados: desconocido hasta la primera respuesta y `false` a los 10 s.
  - Prueba que recorre `src/app/(app)` para que ninguna ruta de Activos muestre la burbuja.
- **Prueba en el teléfono:**
  - Visible en Inicio, Chat (apilada sobre «Nuevo mensaje»), Conversación (sobre la fila de escribir) y Órdenes.
  - Oculta en Gestión de Activos y en Nuevo ticket.
  - Al tocarla abre el formulario.
- **Verificación:** `npx jest` 37 suites y 1124 pruebas en verde; `npx expo export --platform android` compila.
- **Pendientes (P3):**
  - Al recargar permisos sin cambiar de empresa, `moduloApagado` vuelve a «desconocido» (parpadeo breve).
  - Apoyo fijo sin barra y sin margen del sistema (hoy no ocurre).
  - Configurar ESLint en mobile/.
  - Verificar en iOS y con barra de gestos.
