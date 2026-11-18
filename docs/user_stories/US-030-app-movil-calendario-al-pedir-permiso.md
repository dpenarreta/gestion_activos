# Historia de Usuario: US-030 - App móvil: calendario para elegir las fechas al pedir un permiso

- **ID:** US-030
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-17
- **Sprint / Módulo:** App móvil «Intranet LCE» · Solicitud de permisos (y vacaciones)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-1 (móvil). El backend no cambia.

---

### 1. Definición de la Historia
- **Como:** persona que pide un permiso o vacaciones desde la app.
- **Quiero:** además de los campos «Desde» y «Hasta», un calendario a la vista donde toco el día de salida y el de regreso, y que los campos y el conteo de días se actualicen solos.
- **Para:** elegir el período de un vistazo, sin abrir dos selectores, y ver enseguida cuántos días pido.

Pedido del usuario (17/11/2026): «adicional al desplegable debe haber un calendario para seleccionar fechas y estas cuenten y se actualicen en el desplegable».

---

### 2. Criterios de Aceptación
- **CA-1 · Calendario a la vista:**
  - En «Nueva solicitud», para un permiso por días, debajo de «Desde» y «Hasta» se muestra un calendario mensual en español (lunes a domingo, nombre del mes y año).
  - Se puede pasar al mes anterior o al siguiente con botones accesibles.
  - Abre en el mes de «Desde» o, sin fecha, en el mes actual.
- **CA-2 · Elegir el rango:**
  - El primer toque fija «Desde» (y «Hasta» el mismo día); el segundo toque, si es el mismo día o posterior, fija «Hasta».
  - Si el segundo toque es anterior a «Desde», ese día pasa a ser el nuevo «Desde».
  - Con un rango ya completo, un toque nuevo empieza otra selección.
  - El rango se resalta: los extremos marcados y los días intermedios sombreados, con el color de la marca y sin depender solo del color (forma o borde en los extremos).
- **CA-3 · Sincronizado con los campos:**
  - Si la persona cambia «Desde» o «Hasta» con su selector, el calendario lo refleja y salta al mes de la fecha.
  - Lo que se elige en el calendario aparece en los campos.
  - Se respetan las mismas reglas que hoy aplican los campos: el `minimo` de «Hasta», `fijarDesde`, la validación de fechas al revés y la evaluación de restricciones del servidor con su pausa.
- **CA-4 · Conteo:**
  - El resumen («N días de calendario…») se actualiza al instante con cada toque, como hoy con los campos.
  - El calendario muestra el mismo número de forma visible.
- **CA-5 · Permiso por horas:** con un permiso por horas, el calendario elige un solo día («Desde», que también es «Hasta» por horas), con las mismas reglas que hoy.
- **CA-6 · Días distinguibles:**
  - Hoy se marca.
  - Los sábados y domingos se distinguen con un tono suave, sin que eso los haga no elegibles.
  - Si la pantalla ya tiene un mínimo de fecha (por ejemplo, no antes de hoy en algún tipo), los días fuera de rango se ven deshabilitados y no se pueden tocar.
- **CA-7 · Accesibilidad y tema:**
  - Cada día es un botón de al menos 44 de área, con un nombre completo: «Martes 18 de noviembre de 2026», más «inicio del período», «fin del período», «dentro del período», «hoy» o «no disponible» según corresponda.
  - Hay un anuncio del rango elegido.
  - Se usan los hooks de tema de la US-026, sin colores fijos, y el calendario funciona en modo oscuro.
  - Con la letra al 200 % no se corta: las celdas crecen o el texto se ajusta.
- **CA-8 · Reutilización y pruebas:**
  - Si ya existe una cuadrícula de mes reutilizable (`CalendarioInicio`, `CalendarioMatriz`), se extrae o reutiliza una pieza común en lugar de duplicarla.
  - Hay pruebas de: elegir rango, elegir al revés, reiniciar, sincronización con los campos, cambio de mes, permiso por horas, días fuera de mínimo, accesibilidad y modo oscuro.
  - `npx jest` completo queda en verde.

### 3. Alcance
- **Móvil:**
  - `src/pantallas/permisos/NuevaSolicitud.js`;
  - un componente de calendario de rango, nuevo o extraído;
  - las pruebas.
- **Backend y web:** sin cambios.

### 4. Decisiones y Supuestos
- Es un pedido explícito del usuario para la app. La web conserva sus campos y no se toca.
- Los feriados no se marcan: el conteo de días que cuentan lo sigue diciendo el servidor en las restricciones.

### 5. Registro de Cierre
- **Fecha:** 2026-11-17.
- **QA:** QA-FUNC 🟢 (8 de 8) y QA-TECH 🟢, los dos con observaciones (solo P3).
- **Ajustes tras QA:**
  - `key` por modo.
  - `tocarRef` en `useLayoutEffect`.
  - Pista fija para no romper el `memo` de `Dia`.
  - `finDeSemana` calculado una vez.
  - `MESES` único en `utils/calendario.js`.
  - `isoUtc`/`deIsoUtc`.
  - «Elegir este día».
  - Círculo proporcional a la letra.
  - En Android solo se anuncia el inicio, para no pisar la región viva del resumen.
  - Celdas más anchas (unos 50 dp en 360 dp).
  - Pruebas de toques con pausa, febrero de 2028 y reloj fijo.
- **Prueba en el teléfono:** del 20/11 al 24/11 elegido en el calendario. Los campos pasan a 20/11 y 24/11, «Del 20/11/2026 al 24/11/2026: 5 días», el rango queda resaltado, hoy marcado y los fines de semana sombreados. Se salió sin enviar.
- **Verificación:** `npx jest` 38 suites y 1165 pruebas en verde; `npx expo export --platform android` compila.
- **Pendientes:**
  - Ver con la letra al 200 % y en iOS.
  - TalkBack con el anuncio del período.
  - Pantallas de 320 dp.
