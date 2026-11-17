# Historia de Usuario: US-027 - App móvil: «Para hoy» contraído con los avisos sin leer

- **ID:** US-027
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-17
- **Sprint / Módulo:** App móvil «Intranet LCE» · Inicio (Institucional)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-1 (móvil). El backend no cambia: se usan los endpoints de notificaciones que ya consume la campana.

---

### 1. Definición de la Historia
- **Como:** cualquier persona que abre el Inicio de la app.
- **Quiero:** que «Para hoy» aparezca contraído, mostrando cuántos avisos tengo por revisar, y que al expandirlo vea cada aviso con su módulo, título y resumen.
- **Para:** ver de un vistazo si hay algo pendiente sin que el bloque ocupe la pantalla, y entrar directo a lo que me interesa.

Decisión del usuario (17/11/2026, por pregunta): al expandirse se lista **cada aviso sin leer de la campana**, en lugar de las líneas agrupadas de hoy.

---

### 2. Criterios de Aceptación (Gherkin / BDD)
- **CA-1 · Contraído por defecto:**
  - **Dado que** tengo avisos sin leer
  - **Cuando** abro el Inicio
  - **Entonces** «Para hoy» aparece contraído, con el texto «N avisos por revisar» («1 aviso por revisar» en singular) y un chevron que indica que se puede expandir.
  - Todo el encabezado es tocable (al menos 48 dp en Android y 44 pt en iOS), con `accessibilityRole="button"` y `accessibilityState={{ expanded }}`.
- **CA-2 · Sin avisos:** con 0 avisos sin leer, el bloque no se muestra, igual que hoy cuando no hay nada.
- **CA-3 · Expandido:**
  - **Cuando** toco el encabezado
  - **Entonces** se despliega la lista de los avisos sin leer, los más recientes primero, hasta 10.
  - Cada fila muestra el módulo (con el ícono y el color de su familia, como en la campana), el título y el resumen, más la fecha relativa si la campana ya la muestra.
  - Al final hay un enlace «Ver todos los avisos» que abre Notificaciones.
  - Al volver a tocar el encabezado, el bloque se contrae.
- **CA-4 · Abrir un aviso:**
  - Tocar una fila hace lo mismo que tocarla en la campana: abre su destino en la app (`MODULOS_EN_APP`) o el detalle del aviso, y lo marca leído con la misma lógica.
  - Al volver al Inicio, el contador y la lista se actualizan.
- **CA-5 · Datos:**
  - Se usan los mismos servicios que la campana (lista de no leídas y resumen o contador), sin endpoints nuevos.
  - Se carga al entrar al Inicio, al volver a él y al deslizar para actualizar.
  - Mientras carga, el encabezado no salta. Si falla, no se rompe el Inicio: se ofrece «Reintentar» dentro del bloque expandido.
- **CA-6 · Lo que reemplaza:**
  - Las líneas agrupadas actuales (tickets, solicitudes por aprobar, mensajes, avisos de otros módulos) dejan de mostrarse en «Para hoy».
  - Los pendientes que generan aviso en la campana siguen apareciendo, ahora como avisos.
  - Revisar si `ResumenSoporteContext` u otras cargas quedan sin uso en el Inicio y, si es así, dejar de pedirlas allí sin romper otras pantallas que las usen.
- **CA-7 · Modo claro y oscuro, y accesibilidad:**
  - Se respeta la US-026: hooks de tema, sin colores fijos, prueba en oscuro.
  - Cada fila tiene un nombre accesible completo: «Módulo. Título. Resumen».
  - El estado no depende solo del color.
- **CA-8 · Pruebas:** casos para contraído y expandido, singular y plural, oculto con 0, el máximo de 10 más «Ver todos», tocar una fila (navega y marca leído), error con reintento y el render en oscuro.

### 3. Alcance por capa
- **Móvil:** `src/pantallas/Inicio.js` y, si hace falta, un componente nuevo en `src/pantallas/` o `src/componentes/`, más sus pruebas.
- **Backend:** sin cambios.

### 4. Decisiones Técnicas y Supuestos
- El estado expandido no se guarda: el bloque siempre abre contraído.
- Se reutiliza la lógica de navegación y de marcar leído de `ListaNotificaciones` y `notificaciones/`, sin duplicarla.

### 5. Registro de Cierre
- **Fecha:** 2026-11-17.
- **QA:** QA-FUNC 🟢 (8 de 8) y QA-TECH 🟢, los dos con observaciones, solo P3. Se probó en el teléfono: contraído con «2 avisos por revisar» y expandido con módulo, hora, título y resumen.
- **Ajustes tras QA:**
  - Se vacía al cambiar de empresa.
  - Se invalidan las cargas en curso al marcar leído y no se recarga dos veces.
  - Se piden 10 avisos (`page_size=10`).
  - Deslizar para actualizar recarga también el contador.
  - Se reserva el espacio del encabezado mientras carga.
  - Con 0 avisos y la carga fallida no se muestra nada.
- **Verificación:** `npx jest` 36 suites y 1087 pruebas en verde.
- **Pendientes:**
  - «Para hoy» dejó de ser `header` para el lector de pantalla, por el CA-1.
  - Actualizar el comentario de `ResumenSoporteContext`.
