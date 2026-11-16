# Historia de Usuario: US-024 - App móvil: crear, editar y salir de grupos del chat

- **ID:** US-024
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-16
- **Sprint / Módulo:** App móvil «Intranet LCE» · Chat (continúa la US-011)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-1 (móvil). El backend no cambia.

---

### 1. Definición de la Historia
- **Como:** persona que usa el chat de la app.
- **Quiero:** crear grupos desde el teléfono y, si administro uno, editarlo; y salir de un grupo personalizado.
- **Para:** no tener que abrir la web para organizar las conversaciones.

Pedido del usuario (16/11/2026): «en el chat también se deben de poder crear grupos desde la app». Por su regla («lo que se puede en la web, se puede en la app»), entran también editar y salir, que hoy la app manda al navegador (`textoGestionEnLaWeb`, «Crear un grupo» en `ListaChats`).

---

### 2. Criterios de Aceptación
- **CA-1 · Crear un grupo personalizado (todas las personas, como en la web):**
  - Se entra desde «Crear un grupo», en Conversaciones y en «Mis grupos». Esa opción deja de ser el botón redondo al navegador.
  - Se pide un nombre (obligatorio, hasta 120) y al menos una persona, buscada en el directorio del chat (`directorioService.buscar`).
  - Las personas elegidas se ven y se pueden quitar.
  - Envía `POST /chat/conversaciones/` con `{nombre, participantes}`.
  - Al crear, abre la conversación nueva.
- **CA-2 · Crear un grupo por área (solo con `chat.grupos_por_area`):**
  - La opción «Por área» aparece solo con ese permiso.
  - Se elige el área con `GET /chat/areas/`, que sin el permiso devuelve una lista vacía.
  - Envía `{nombre, departamento}`.
  - Los miembros los da el área.
- **CA-3 · Editar (solo quien administra):**
  - En «Participantes», quien administra puede renombrar el grupo.
  - En un grupo personalizado, además agrega y quita personas.
  - Envía `PATCH /chat/conversaciones/{id}/` con `{nombre?, agregar?, quitar?}`.
  - No se puede quitar a sí mismo; el servidor lo ignora.
  - Quitar a alguien pide confirmación.
  - En un grupo por área, solo cambia el nombre.
- **CA-4 · Salir (solo de un grupo personalizado):**
  - «Salir del grupo» pide confirmación y envía `POST /chat/conversaciones/{id}/salir/`.
  - Después vuelve a la lista y el grupo ya no aparece.
- **CA-5 · Errores y red:** como en los formularios de la app.
  - Los 400 se muestran junto a su campo («Póngale un nombre al grupo.», «Elija al menos a una persona.»).
  - Un 403 se explica.
  - Hay candado contra el doble envío y se confirma antes de reenviar tras «puede haberse guardado».
  - Se pregunta antes de descartar un grupo a medio crear.
- **CA-6 · Empresa:** todo usa la empresa de la conversación (`X-Empresa`, el `empresa` de la ruta), como el resto del chat.
- **CA-7 · Accesibilidad y marca:** AA, áreas táctiles de 48 dp, etiquetas, y nada que dependa solo del color. Lo que siga en la web va con `BotonRedondo`.

---

### 3. Alcance
| Capa | Sub-Agente | Entregables |
|---|---|---|
| Móvil | DEV-1 | Servicios en `chatService`; pantalla «Crear un grupo» (ruta en la pila); edición y salida en `Participantes`; enganches en `ListaChats`/«Mis grupos» y en la barra del Chat si corresponde; pruebas Jest |

**Fuera de alcance:** cambios en el backend.

---

### 4. Contrato (ya existe, `backend/apps/chat/`)
| Operación | Ruta | Acceso |
|---|---|---|
| Crear | `POST /chat/conversaciones/` `{nombre, participantes[] \| departamento}` | todos; por área con `chat.grupos_por_area` |
| Editar | `PATCH /chat/conversaciones/{id}/` `{nombre?, agregar[]?, quitar[]?}` | quien administra |
| Salir | `POST /chat/conversaciones/{id}/salir/` | miembros de un grupo personalizado |
| Áreas | `GET /chat/areas/` | `chat.grupos_por_area` (si no, `[]`) |

---

### 5. Decisiones
- **Paridad con la web** (regla del usuario): crear, editar y salir, con los mismos permisos.
- **La web no tenía editar ni salir** (hallazgo de DEV-1, verificado por el Tech Lead): `chatService.editarGrupo` y `chatService.salir` existen en `frontend/src/api/chatService.js`, pero ningún componente los usa. Decisión del usuario (16/11/2026): igualar la web con la app. El pedido pasó a la otra sesión (DEV-4).

---

### 6. Registro de Cierre
- **Estado final:** COMPLETADA CON PENDIENTES
- **Fecha de cierre:** 2026-11-16
- **QA:**
  - QA-FUNC y QA-UX aprobaron con observaciones; QA-UX sin P1 y con 4 P2.
  - QA-TECH rechazó por un P2: un grupo del que se salía reaparecía por consultas que ya estaban en curso.
  - Una ronda corrigió el P2, las observaciones O-1 a O-4, los P3 de QA-TECH, H-01 a H-16 de UX («Información del grupo», «Nuevo grupo» con fichas y pie fijo, foco y textos sin género) y la carrera en `ChatContext`.
  - La revalidación de QA-TECH aprobó con observaciones.
  - El Tech Lead corrigió además P3-2 (cerrar el editor ante un 403 o un 404) y P3-4 (la lista ya no se queda en «Cargando»), y dejó un texto genérico para quien no se pudo agregar.
- **Paridad con la web:** la otra sesión desplegó editar y salir en la web (d12104b) y que `quitar` acepte personas inactivas (bb938bb).
- **Verificación:** `jest`, 32 suites y 926 pruebas en verde; el bundle de Android compila.
- **Pendientes:**
  - Probar en el dispositivo:
    - crear un grupo personalizado y uno por área;
    - renombrar, agregar, quitar y salir con un usuario de dos empresas;
    - el foco con TalkBack.
  - P3-1: el grupo sigue en la lista unos 400 ms tras salir.
  - P3-3: la duda de reenvío se comparte entre personas al quitar.
  - H-11: «Salió de X» solo se anuncia; no se muestra en la lista.
