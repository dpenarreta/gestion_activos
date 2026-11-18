# Historia de Usuario: US-031 - App móvil: tarjeta de contacto desde la búsqueda, la conversación y la lista de chats

- **ID:** US-031
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-18
- **Sprint / Módulo:** App móvil «Intranet LCE» · Chat
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-1 (móvil). El backend no cambia: la tarjeta ya existe (`/chat/contacto/[id]`, `chatService.contacto`).

---

### 1. Definición de la Historia
- **Como:** persona que usa el chat de la app.
- **Quiero:** ver la tarjeta de contacto de alguien (correo corporativo, teléfono, extensión y área) al buscarlo para escribirle, desde la conversación y desde la lista de chats.
- **Para:** saber con quién hablo y cómo localizarlo sin salir del chat.

Decisiones del usuario (18/11/2026, por pregunta):
- **Al buscar a quién escribir:** en «Nuevo mensaje», cada persona tiene un botón de información que abre su tarjeta sin abrir el chat.
- **Más visible en la conversación:** tocar el nombre de la persona en la barra superior también abre la tarjeta, además del ícono que ya existe.
- **Desde la lista de chats:** tocar las iniciales (el avatar) de una persona en la lista de conversaciones abre su tarjeta.

---

### 2. Criterios de Aceptación
- **CA-1 · «Nuevo mensaje»:**
  - Cada fila de persona tiene, a la derecha, un botón «Ver la tarjeta de {nombre}» (ícono de tarjeta o de información) de al menos 48 dp en Android y 44 pt en iOS.
  - Abre `/chat/contacto/[id]` sin iniciar la conversación.
  - Tocar el resto de la fila sigue abriendo o creando el chat, como hoy.
  - Si el mismo buscador de personas se usa en otros sitios (por ejemplo, al crear un grupo), el botón solo se agrega donde tenga sentido; DEV-1 documenta la decisión.
- **CA-2 · Título de la conversación:**
  - En una conversación directa, el título con el nombre en la barra superior es tocable y abre la tarjeta.
  - Tiene el rol `button`, la etiqueta «Ver el contacto de {nombre}» y un área táctil suficiente.
  - En grupos, tocar el título abre «Información del grupo», lo mismo que hace hoy su ícono.
  - El ícono de la derecha se mantiene.
- **CA-3 · Lista de chats:**
  - En una conversación directa, tocar el avatar (las iniciales) abre la tarjeta de esa persona; tocar el resto de la fila abre la conversación, como hoy.
  - En grupos, canal general y canales de área, el avatar no cambia de comportamiento: abre la conversación.
  - El avatar tocable tiene su propio nombre accesible y área táctil.
- **CA-4 · La misma tarjeta:**
  - Las tres entradas abren la misma pantalla `Contacto`, con la empresa activa (o la del chat), sin duplicar lógica.
  - Respeta las reglas de visibilidad que ya tiene, por ejemplo el teléfono personal solo si lo autorizó.
- **CA-5 · Tema, accesibilidad y pruebas:**
  - Modo claro y oscuro (US-026), sin colores fijos.
  - Pruebas de las tres entradas: navegación con los parámetros correctos, que tocar la fila no cambió, que los grupos no se ven afectados y el render en oscuro.
  - `npx jest` completo en verde.

### 3. Alcance
- **Móvil:**
  - `src/pantallas/chat/NuevoMensaje.js` y el buscador de personas que use;
  - `src/pantallas/chat/Conversacion.js` (título de la cabecera);
  - `src/pantallas/chat/ListaChats.js` y sus piezas;
  - las pruebas.
- **Backend y web:** sin cambios.

### 4. Registro de Cierre
- **Fecha:** 2026-11-18.
- **QA:** QA-FUNC 🟢 (5 de 5) y QA-TECH 🟢, los dos con observaciones (solo P3).
- **Ajustes tras QA:**
  - `maxFontSizeMultiplier={1.5}` en el título de la conversación.
  - Se quitó un color redundante del botón de tarjeta.
  - Pruebas de doble toque en el título y en Participantes.
  - `FilaConversacion` en `memo` con callbacks estables y `renderItem` en `useCallback`.
- **Decisiones:**
  - El buscador de grupos (`BuscadorDePersonas`) no lleva botón de tarjeta: ahí tocar agrega a la persona.
  - En el canal general, el título abre los participantes, igual que su ícono.
- **Prueba en el teléfono:**
  - El avatar de un directo en la lista abre la tarjeta y el resto de la fila abre la conversación.
  - El título de la conversación abre la tarjeta y Atrás vuelve a la conversación.
  - «Nuevo mensaje» muestra el botón de tarjeta en cada persona.
- **Verificación:** `npx jest` 38 suites y 1185 pruebas en verde; `npx expo export --platform android` compila.
- **Pendientes:**
  - TalkBack y VoiceOver: orden del foco entre el avatar o la tarjeta y la fila.
  - Letra grande en iOS.
  - Un directo con una persona desactivada ofrece la tarjeta, que termina en error (comportamiento anterior del backend).
