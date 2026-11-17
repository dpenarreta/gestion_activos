# Historia de Usuario: US-026 - App móvil: modo claro y modo oscuro

- **ID:** US-026
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-17
- **Sprint / Módulo:** App móvil «Intranet LCE» · Apariencia (transversal)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-1 (móvil). El backend y la web no cambian.

---

### 1. Definición de la Historia
- **Como:** cualquier persona que usa la app.
- **Quiero:** usar la app en modo claro u oscuro, o que siga el modo del teléfono.
- **Para:** leer con comodidad de noche o con poca luz, con los mismos colores de la marca que ya tiene la web.

Decisiones del usuario (17/11/2026, por preguntas):
- **Opciones:** igual que la web: Claro, Oscuro y Sistema. Por defecto, Sistema (sigue al teléfono).
- **Dónde se cambia:** un botón en la cabecera, junto a la campana, visible en todos los módulos.
- **Colores:** se mantienen los del sistema web:
  - el modo claro es el de hoy (marca LAARCOURIER, `src/tema/colores.js`);
  - el oscuro toma la paleta oscura de la web (`frontend/src/styles/identidad-base.css`, `identidad-puente.css`, `appearance-tokens.css` y `marca.css`, bloques `:root[data-theme="dark"]`), sin perder la marca: el amarillo #FCE200 sigue siendo el acento sobre negro y nunca va como texto sobre fondo claro.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · Botón en la cabecera:**
  - **Dado que** estoy en cualquier pantalla con la cabecera de la app
  - **Cuando** toco el botón de apariencia (junto a la campana)
  - **Entonces** se abre un menú pequeño con Claro, Oscuro y Sistema, con la opción actual marcada (✓ y estado accesible `selected`).
  - El ícono del botón refleja el modo elegido (sol, luna, o automático para Sistema).
  - Su etiqueta accesible dice el modo actual: «Apariencia: Oscuro».
  - Tiene un área táctil de al menos 48 dp en Android y 44 pt en iOS.
- **CA-2 · Persistencia:**
  - La elección se guarda en el teléfono y se mantiene al cerrar y volver a abrir la app.
  - Si nunca se eligió nada, se usa Sistema.
  - La pantalla de inicio de sesión respeta la elección guardada, o el modo del teléfono si no hay elección.
- **CA-3 · Sistema:** con Sistema, la app cambia en vivo cuando el teléfono pasa de claro a oscuro o al revés, sin reiniciar (`Appearance` / `useColorScheme`).
- **CA-4 · Paleta oscura:**
  - Todos los tokens de `colores` tienen su valor oscuro: fondo, superficie, hundido, bordes, tinta, tintas suaves, títulos, enlace, realce, semánticos (bien, aviso, mal, info) y controles.
  - La cabecera y la barra inferior siguen oscuras con acento amarillo.
  - Los botones primarios mantienen la identidad.
  - Cada par texto/fondo cumple WCAG AA (texto 4,5:1, bordes de controles 3:1). Los contrastes medidos quedan documentados en `colores.js`, igual que hoy los del modo claro.
- **CA-5 · Cobertura total:**
  - Ninguna pantalla queda con fondos blancos o textos negros fijos en modo oscuro: Inicio, Institucional, Chat, Mesa de ayuda, Matriz, Permisos, Activos, Órdenes, Cuenta, Mi perfil, Notificaciones, Login, ventanas, menús, diálogos propios, burbujas y estados vacíos o de error.
  - Los colores fijos en hexadecimal fuera de `src/tema` pasan a tokens.
- **CA-6 · Elementos nativos:**
  - La barra de estado, el fondo de la navegación (para que no destelle blanco al cambiar de pantalla), el `RefreshControl`, los `ActivityIndicator`, los selectores de fecha y los `Alert` siguen el modo cuando la plataforma lo permite.
  - Cuando no se puede, quedan legibles.
- **CA-7 · Imágenes y marca:**
  - Los logos que existan en versión positiva y negativa usan la que corresponde al fondo.
  - Las fotos y las imágenes del chat no se alteran.
- **CA-8 · Sin regresiones:**
  - En modo claro la app se ve igual que hoy.
  - Las pruebas existentes siguen en verde, y se agregan pruebas del contexto de apariencia (persistencia, Sistema, cambio en vivo), del botón y de cada pantalla clave en oscuro.

---

### 3. Alcance por capa
- **Móvil:**
  - un contexto o proveedor de apariencia;
  - `src/tema` con las paletas clara y oscura y un hook para leer los colores;
  - las pantallas y componentes que hoy importan `colores` de forma estática pasan a leerlos según el modo;
  - el botón en la cabecera;
  - la persistencia en el teléfono;
  - las pruebas.
- **Backend y web:** sin cambios.

### 4. Decisiones Técnicas y Supuestos
- La preferencia se guarda en el teléfono, no en el servidor. La web también la guarda por navegador.
- Con tres opciones, el botón abre un menú en lugar de alternar, para que «Sistema» sea alcanzable sin pasos ocultos.
- Si algún color de la web oscura no alcanza el contraste AA en el móvil, se ajusta lo mínimo y se documenta.

---

### 5. Registro de Cierre
- **Fecha:** 2026-11-17.
- **QA:** QA-FUNC 🟢 y QA-TECH 🟢, los dos con observaciones y sin P1 ni P2. La auditoría UX se hizo en vivo en el teléfono, en claro y en oscuro: Inicio, Chat, Mesa, Matriz, Activos, Órdenes y Mi perfil.
- **Ajustes tras QA y la prueba en el teléfono:**
  - `expo-system-ui` y `expo-navigation-bar`, porque la barra de Android quedaba gris en oscuro. Se recompiló el dev client.
  - Tokens `insignia`/`sobreInsignia`.
  - Anillo e íconos más claros en los botones redondos en oscuro.
  - Tema de navegación desde `DarkTheme`.
  - Menú posicionado midiendo el botón.
  - Pruebas de que cerrar sesión conserva la preferencia y del ícono por modo.
- **Error encontrado en el teléfono y corregido:**
  - Al pasar de oscuro a claro, `Refresco` quitaba `colors` y Android cerraba la app (`SwipeRefreshLayout.setColorSchemeColors` con lista vacía).
  - Ahora los colores van siempre, en los dos modos.
  - Se verificó el cambio en vivo sin cierre.
- **Verificación:** `npx jest` 36 suites y 1087 pruebas en verde; `npx expo export --platform android` compila.
- **Pendientes:**
  - Verificar en iOS: «Sistema» tras recompilar, `File.preview` y Keychain.
  - Contador amarillo dentro de la pestaña activa del calendario de Inicio en oscuro.
