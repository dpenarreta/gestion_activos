# Historia de Usuario: US-032 - App móvil: secciones de «Mi perfil» en acordeón

- **ID:** US-032
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-18
- **Sprint / Módulo:** App móvil «Intranet LCE» · Mi perfil
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-1 (móvil). El backend no cambia.

---

### 1. Definición de la Historia
- **Como:** persona que abre «Mi perfil» en la app.
- **Quiero:** que las secciones «Mis datos», «Mi cargo» y «Mi línea de supervisión» se abran y se cierren como un acordeón al tocarlas, sin dejar de ver nunca su título y su descripción.
- **Para:** ver la pantalla completa de un vistazo y abrir solo lo que necesito.

Pedido del usuario (18/11/2026): «mis datos, mi cargo, mi línea de supervisión, todo esto va a tener un desplegable para abrir como acordeón si se pulsa sobre ese espacio; siempre se verá el título y la descripción o detalle de la sección».

---

### 2. Criterios de Aceptación
- **CA-1 · Encabezado siempre visible:**
  - Cada sección muestra siempre su ícono, su título y su descripción. Por ejemplo, «Mis datos» con «Con ellos se cargan sus pedidos de soporte: manténgalos al día.», y «Mi cargo: …» con «Lo que se espera de su cargo y cómo se mide.».
  - Lleva además un chevron que indica si está abierta o cerrada.
- **CA-2 · Abrir y cerrar:**
  - Tocar el encabezado (todo ese espacio) abre o cierra el contenido de esa sección.
  - Las secciones se abren por separado: abrir una no cierra las otras.
  - Al abrir la pantalla, las tres arrancan cerradas.
- **CA-3 · Lo que queda fuera del acordeón:**
  - El nombre, el código y el cargo de la cabecera de la pantalla siguen visibles.
  - El bloque «Chat» con «Mi estado» sigue arriba, sin acordeón.
  - El aviso «En la app su perfil solo se consulta» y el botón para editar en la web siguen dentro de «Mis datos», al abrirla.
- **CA-4 · Accesibilidad y tema:**
  - El encabezado tiene rol `button`, `accessibilityState={{ expanded }}`, al menos 48 dp en Android y 44 pt en iOS, y un nombre accesible con el título y la descripción.
  - Hay una pista distinta para abrir y para cerrar.
  - El estado no depende solo del color: lo indica el chevron.
  - Se usan los hooks de tema de la US-026, sin colores fijos, y funciona en modo oscuro.
- **CA-5 · Pruebas:** se prueba que arranca cerrada, que abre y cierra, que las secciones son independientes, que el título y la descripción se ven siempre, el render en oscuro, y que las pruebas existentes de Mi perfil y de Cuenta se ajustan y siguen en verde. `npx jest` completo queda en verde.

### 3. Alcance
- **Móvil:** `src/pantallas/MiPerfil.js` y, si conviene, un componente común de sección plegable que se pueda reutilizar, más las pruebas.
- **Backend y web:** sin cambios.

### 4. Decisiones
- Las tres secciones arrancan cerradas, porque el pedido es ver los títulos y descripciones y abrir lo que se necesite.
- El estado abierto o cerrado no se guarda.

### 5. Registro de Cierre
- **Fecha:** 2026-11-18.
- **QA:** QA-FUNC 🟢 (5 de 5) y QA-TECH 🟢, los dos con observaciones.
- **Decisión del Tech Lead (B-1):** el aviso «Le falta completar: …» se ve siempre, aunque «Mis datos» esté cerrada (prop `aviso` de `SeccionPlegable`, fuera del botón y del contenido).
- **Ajustes:**
  - Chevron en `primario`, como `Desplegable`.
  - El modo controlado solo vale con `onCambiar`.
  - En iOS se anuncia «Sección abierta» o «Sección cerrada».
  - JSDoc: el título no es `header` porque va dentro del botón del CA-4.
  - Pruebas del chevron, del aviso y de los modos.
- **Prueba en el teléfono:** las tres secciones arrancan cerradas, con su título y descripción; «Mis datos» se abre al tocarla y el chevron cambia.
- **Verificación:** `npx jest` 39 suites y 1200 pruebas en verde.
- **Pendientes:**
  - VoiceOver y TalkBack en dispositivo.
  - Letra al 200 %.
  - A futuro, unificar la cabecera de `SeccionPlegable` y `Desplegable`.
