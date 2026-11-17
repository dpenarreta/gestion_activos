# Historia de Usuario: US-028 - App móvil: paridad con la web (Mi perfil, Mesa de ayuda, acceso y Activos)

- **ID:** US-028
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-17
- **Sprint / Módulo:** App móvil «Intranet LCE» · varios módulos
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-1 (móvil). No se esperan cambios de backend; si un endpoint público no expone lo necesario, se informa antes de tocar nada.

---

### 1. Definición de la Historia
- **Como:** cualquier persona que usa la app.
- **Quiero:** que la app muestre y permita lo mismo que la web en lo que la web cambió desde el 10/11/2026.
- **Para:** que la app de pruebas esté siempre al día con la última versión de la web (regla «permisos y funcionalidades app = web»).

**Origen:** la auditoría de paridad del 17/11/2026 no encontró roturas de contrato.

**Elección del usuario:** se implementan Mi perfil y Mesa de ayuda, la pantalla de acceso y Gestión de Activos. Mis vacaciones (cancelar aprobadas y los textos de fines de semana) queda fuera por ahora.

---

### 2. Criterios de Aceptación

**Mi perfil y Mesa de ayuda**
- **CA-1 · Línea fija y extensión:**
  - La ficha de Mi perfil muestra si la persona tiene línea fija y su extensión, igual que «Mis datos» de la web (commit 2ed5676; `frontend/src/pages/MisDatos/MisDatosPage.jsx`).
  - Sin dato, se aplica la misma regla que la web: no se muestra, o se muestra «—».
- **CA-2 · Cédula:** Mi perfil muestra la cédula de nómina como la web (c33d146, `MisDatosPage.jsx:493-501`), solo si el servidor la envía.
- **CA-3 · Extensión al crear un ticket:** al crear un ticket propio, «Sus datos» muestra la extensión junto a los teléfonos, como `frontend/src/pages/Ayuda/NuevoTicket.jsx:47-50`.

**Pantalla de acceso**
- **CA-4 · Textos personalizables:**
  - El título y el subtítulo del Login salen de `acceso_titulo` y `acceso_subtitulo` del tema (`/theme/current/`, commit 45884ab; `backend/apps/branding/serializers.py`).
  - Si faltan, vienen vacíos o el pedido falla, se usan los textos de hoy: «Acceso al sistema» e «Ingrese con su usuario corporativo.».
  - Hay que confirmar que el endpoint responde sin sesión. Si exige sesión, DEV-1 lo informa antes de seguir.
  - El texto no debe saltar de forma molesta: cache local del último texto recibido.
- **CA-5 · Recordar el usuario 30 días:**
  - Al entrar con éxito, la app recuerda el identificador escrito durante 30 días (5440074; `frontend/src/utils/usuarioRecordado.js`).
  - Tras «Cerrar sesión», el campo sale ya lleno.
  - Se guarda en el almacenamiento local de la app y nunca la contraseña.
  - Se sigue la misma regla de la web para olvidarlo: vencimiento y, si la web tiene un «No soy yo» o similar, lo mismo.

**Gestión de Activos**
- **CA-6 · Enlaces a la web:** `ACTIVOS_EN_LA_WEB` suma Categorías, Componentes y Políticas, cada uno con el mismo permiso con que los muestra el menú web (`frontend/src/.../staticAdminMenu.js`), como botón redondo con confirmación de salida.
- **CA-7 · Acta AEE-LC-01:**
  - En la ficha del activo, en el movimiento de asignación, quien tiene `activos.acta_entrega` ve un acceso al acta, igual que `ActivoDetalle.jsx`.
  - Si el acta es una descarga (Word o PDF), se abre con el visor interno o con la descarga que la app ya usa para adjuntos, según la regla del visor (memoria «Visor interno para PDF y presentaciones»). Si no es posible, se abre en el navegador con confirmación.

**General**
- **CA-8:**
  - Se respeta el modo claro y oscuro (US-026): hooks de tema, sin colores fijos.
  - Se respeta la accesibilidad.
  - Hay pruebas para cada criterio y `npx jest` completo queda en verde.

### 3. Alcance por capa
- **Móvil:**
  - `src/pantallas/MiPerfil.js`;
  - `src/pantallas/soporte/NuevoTicket.js` (o el archivo equivalente);
  - `src/pantallas/Login.js` y `src/api/almacen.js`;
  - `src/activos/formato.js` y la ficha del activo;
  - `src/api/servicios.js`;
  - las pruebas.
- **Backend y web:** sin cambios.

### 4. Decisiones Técnicas y Supuestos
- El «perfil confirmado» (campos bloqueados) es trabajo sin commit de otra sesión: queda fuera hasta que se publique.

### 5. Registro de Cierre
- **Fecha:** 2026-11-17.
- **QA:** QA-FUNC 🟢 (8 de 8) y QA-TECH 🟢, los dos con observaciones, solo P3. En el teléfono, Mi perfil muestra la cédula y «¿Tiene línea fija?».
- **Decisión del Tech Lead:** un subtítulo de acceso vacío no se muestra, igual que la web (`PantallaAcceso.jsx`).
- **Ajustes tras QA:**
  - Mientras se abre el acta, el nombre accesible coincide con el texto visible.
  - El candado se mantiene hasta responder la confirmación de salida.
  - Prueba de que la caché `activos-adjuntos` se borra al arrancar (ya ocurría).
- **Verificación:** `npx jest` 36 suites y 1087 pruebas en verde; `npx expo export --platform android` compila.
- **Pendientes:**
  - Ver en el teléfono el Login con los textos del tema y la casilla «Recordar» (requiere cerrar sesión).
  - Ver el PDF real del acta en Android e iOS.
  - Llavero de iOS tras desinstalar.
  - Backend: `views_acta_entrega.py` con un `movimiento` no numérico daría 500 (DEV-2, fuera de alcance).
