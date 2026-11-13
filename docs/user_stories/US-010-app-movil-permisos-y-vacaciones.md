# Historia de Usuario: US-010 - App móvil · Fase 2: Solicitud de permisos y Mis vacaciones

- **ID:** US-010
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-12
- **Sprint / Módulo:** App móvil «Intranet LCE» · Fase 2 (Institucional · Solicitud de permisos y Mis vacaciones)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-1 (y DEV-2 solo si aparece un hueco en la API)

---

### 1. Definición de la Historia
- **Como:** colaborador con cuenta en la intranet, y como jefe o aprobador de permisos
- **Quiero:** pedir permisos, ver los míos y mis días de vacaciones desde el celular, y aprobar o rechazar los que tengo pendientes al tocar el aviso
- **Para:** no depender del computador para algo tan frecuente; lo que haga en la app se ve igual en la web, porque es la misma API (`/api/v1/licencias/…` y `/api/v1/organizacion/vacaciones/mias/`)

Base: la US-009 (app, sesión, notificaciones y push). Las reglas del módulo están en `docs/solicitud-de-permisos.md`; **todas se validan en el servidor** y la app solo las muestra.

---

### 2. Criterios de Aceptación (Gherkin / BDD)
- **CA-1 · Acceso:**
  - **Dado que** inicié sesión
  - **Cuando** abro la nueva pestaña «Permisos»
  - **Entonces** veo tres secciones: «Mis solicitudes», «Por aprobar» (con insignia si `resumen.por_aprobar` > 0) y «Mis vacaciones».
  - **Y** en el Inicio, los accesos «Solicitud de permisos» y «Mis vacaciones» abren esas pantallas dentro de la app, ya no el navegador.
- **CA-2 · Mis vacaciones:**
  - **Dado que** tengo períodos de vacaciones
  - **Cuando** abro «Mis vacaciones»
  - **Entonces** veo, por período, los días que me corresponden, los gozados (con su detalle) y los pendientes, y el total pendiente, con los mismos datos que la web.
  - **Y** sin períodos veo un estado vacío claro; si hay error, un error con «Reintentar».
- **CA-3 · Mis solicitudes:**
  - **Dado que** tengo solicitudes
  - **Cuando** abro «Mis solicitudes»
  - **Entonces** las veo con el tipo, las fechas (y las horas si son por horas), el estado (pendiente, aprobada, rechazada o cancelada, con color e ícono además del texto) y de quién está pendiente.
  - **Y** puedo refrescar deslizando hacia abajo.
- **CA-4 · Nueva solicitud, con la evaluación del servidor:**
  - **Dado que** `resumen.puede_solicitar` es verdadero
  - **Cuando** elijo un tipo (`/licencias/tipos/`) y las fechas
  - **Entonces** la app pide `/licencias/tipos/{id}/evaluar/?desde=&hasta=` y muestra cada regla con su estado (✔ cumple, ✖ no cumple, ⚠ atención, ℹ informa), con texto y no solo color, incluido el reparto entre períodos y los fines de semana que se marcarán.
  - **Y** si alguna regla bloquea (`bloquea: true`), el botón «Enviar» queda desactivado con la explicación.
  - **Y** si el tipo es por horas, se elige un solo día y las horas «desde» y «hasta».
  - **Y** si el tipo pide motivo se muestra el campo; si es médico (`es_medico`), avisa «No escriba diagnósticos.».
- **CA-5 · Sin rol asignado:**
  - **Dado que** `puede_solicitar` es falso
  - **Cuando** abro «Nueva solicitud»
  - **Entonces** el botón está desactivado con la explicación del servidor («sin rol asignado no se solicita ningún permiso»).
- **CA-6 · Documento de respaldo:**
  - **Dado que** el tipo pide documento (opcional u obligatorio; obligatorio en los médicos)
  - **Cuando** lo adjunto
  - **Entonces** puedo tomar una foto o elegir una imagen o un PDF del teléfono. La app avisa antes de enviar si pasa de 10 MB o no es PDF o imagen, y lo envía como `multipart`. El servidor sigue verificando la firma del contenido.
  - **Y** si es obligatorio y falta, no deja enviar.
- **CA-7 · Envío y errores:**
  - **Dado que** completé la solicitud
  - **Cuando** pulso «Enviar»
  - **Entonces** se crea una sola vez (sin doble envío) y voy a su detalle con un mensaje de éxito.
  - **Y** si el servidor responde 400, veo `error.message` y los errores por campo junto a cada campo (`details`).
- **CA-8 · Detalle de una solicitud:**
  - **Dado que** abro una solicitud que puedo ver
  - **Cuando** carga
  - **Entonces** veo:
    - el tipo, las fechas, las horas y los días;
    - el solicitante (`solicitante.nombre`);
    - el estado y el paso actual;
    - de quién está pendiente;
    - el motivo, si el servidor lo devuelve;
    - el documento: «Ver documento» abre el archivo dentro de la app (imagen) o con el visor del sistema (PDF), descargado con la sesión, nunca con una URL pública;
    - el historial (quién, qué, cuándo y con qué comentario).
  - **Y** si no la puedo ver, el servidor responde 404 y la app dice «No se encontró la solicitud».
- **CA-9 · Cancelar la mía pendiente:**
  - **Dado que** la solicitud es mía y está pendiente (`puedo.cancelar`)
  - **Cuando** pulso «Cancelar solicitud» y confirmo
  - **Entonces** queda cancelada y el detalle se actualiza.
  - **Y** anular una aprobada (`cancelar_pide_comentario`, permiso `licencias.anular_aprobadas`) no se hace en la app: se ofrece «Abrir en el navegador».
- **CA-10 · Por aprobar:**
  - **Dado que** tengo solicitudes pendientes de mí (`vista=por_aprobar`)
  - **Cuando** abro «Por aprobar»
  - **Entonces** las veo con el solicitante, el tipo y las fechas.
  - **Y** desde el detalle puedo:
    - **Aprobar**, con confirmación y comentario opcional;
    - **Rechazar**, con un comentario obligatorio (la app no deja enviar sin él y el servidor también lo exige).
  - **Y** si el servidor rechaza la aprobación porque los días ya no alcanzan (paso 6 de la documentación), veo su mensaje y la solicitud sigue pendiente.
  - **Y** tras aprobar o rechazar, la lista y la insignia se actualizan.
- **CA-11 · Lo que se queda en la web:**
  - **Dado que** necesito escalar, ver todas las solicitudes (`licencias.ver_todas`), anular una aprobada o configurar flujos
  - **Cuando** estoy en la app
  - **Entonces** veo «Abrir en el navegador» (`/admin/institucional/permisos?solicitud=ID` o la pantalla que corresponda), con el texto de la US-009.
- **CA-12 · Notificaciones y push de permisos:**
  - **Dado que** llega una notificación del módulo `licencias` (enlace `/admin/institucional/permisos?solicitud=ID`)
  - **Cuando** la toco en la lista o en el push
  - **Entonces** la app abre el detalle de esa solicitud dentro de la app (`MODULOS_EN_APP.licencias`, a partir del `?solicitud=` del enlace), en la empresa de la notificación.
  - **Y** si el enlace no trae solicitud, se abre la pestaña «Permisos».
- **CA-13 · Multiempresa:**
  - **Dado que** cambio de empresa
  - **Cuando** vuelvo a «Permisos»
  - **Entonces** las listas, el resumen y las vacaciones se recargan con la empresa activa (`X-Empresa`).
- **CA-14 · Accesibilidad y estados:**
  - Toda pantalla tiene estados de carga, vacío y error con «Reintentar».
  - Los errores se anuncian al lector de pantalla.
  - Las áreas táctiles miden 44 pt en iOS y 48 dp en Android.
  - Los selectores de fecha y hora son accesibles.
  - El estado nunca se transmite solo con color.

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| Móvil | DEV-1 | Pestaña «Permisos» (Mis solicitudes / Por aprobar / Mis vacaciones), nueva solicitud con evaluación, adjunto (cámara, galería o PDF), detalle con historial y documento, cancelar, aprobar y rechazar, `MODULOS_EN_APP.licencias`, accesos del Inicio dentro de la app, pruebas jest |
| Backend | DEV-2 | Solo si DEV-1 encuentra un hueco real en la API: se coordina con el Tech Lead antes de tocar nada |

**Fuera de alcance:**
- Escalar.
- Vista «todas» (`licencias.ver_todas`).
- Anular aprobadas.
- Configurar flujos.
- Vacaciones de otras personas (`vacaciones.ver_todas`).
- Calendario de rango visual (se usan selectores de fecha nativos).
- Chat (US-011).

---

### 4. Contrato (API existente, sin cambios previstos)

| Operación | Ruta | Acceso | Entrada | Salida | Errores |
|---|---|---|---|---|---|
| Tipos para solicitar | `GET /licencias/tipos/` | Autenticado | — | tipos con `descuento`, `unidad`, `tipo_ausencia`, `es_medico`, `pide_motivo`, `adjunto` y restricciones | 401 |
| Evaluar | `GET /licencias/tipos/{id}/evaluar/?desde=&hasta=` | Autenticado | fechas ISO | `{reglas:[{clave, estado, texto, detalle}], bloquea}` | 400, 404 |
| Resumen | `GET /licencias/solicitudes/resumen/` | Autenticado | — | `{por_aprobar, puede_solicitar}` | 401 |
| Listar | `GET /licencias/solicitudes/?vista=mias\|por_aprobar` | Autenticado | — | lista (máximo 300) | 401 |
| Detalle | `GET /licencias/solicitudes/{id}/` | Quien la puede ver | — | detalle con `puedo`, historial, `solicitante`, `dias_a_devolver`… | 404 |
| Crear | `POST /licencias/solicitudes/` (multipart) | Autenticado y con rol | `flujo, desde, hasta, hora_desde?, hora_hasta?, motivo?, adjunto?` | 201 con el detalle | 400 por campo |
| Aprobar, rechazar o cancelar | `POST /licencias/solicitudes/{id}/aprobar\|rechazar\|cancelar/` | Según `puedo` | `{comentario}` | detalle | 400, 403, 404 |
| Documento | `GET /licencias/solicitudes/{id}/adjunto/` | Quien la puede ver | — | archivo (`Content-Disposition`) | 404 |
| Mis vacaciones | `GET /organizacion/vacaciones/mias/` | Autenticado | — | períodos con días, gozados y pendientes | 401 |

DEV-1 debe leer los serializers reales (`backend/apps/licencias/serializers.py`, `backend/apps/organizacion/views.py` `MisVacacionesView`) y anotar aquí cualquier desviación de nombres.

**Desviaciones encontradas en el código real (DEV-1, 12/11/2026).** La app usa los nombres reales; nada de esto exige cambiar el backend:

- **Tipos** (`FlujoParaSolicitarSerializer`):
  - Pide `licencias.solicitar`; sin él responde 403.
  - Trae `id, nombre, descripcion, adjunto ("no" | "opcional" | "obligatorio"), pide_motivo, descuenta_vacaciones, descuento, unidad, tipo_ausencia, es_medico` y `pasos: [{nombre, aprobadores: [texto]}]`.
  - **No trae las restricciones:** solo llegan por `evaluar`.
- **Evaluar:** `estado` vale `ok`, `falla`, `aviso` o `info` (✔, ✖, ⚠ e ℹ). `bloquea` es verdadero si alguna regla vale `falla`.
- **Resumen:** `puede_solicitar` es `user_has_permission(usuario, "licencias.solicitar")` (`restricciones.tiene_rol`); no comprueba si la cuenta tiene un rol.
- **Listar:**
  - Devuelve una lista plana, sin paginar (`[:300]`).
  - `vista` admite también `todas`, con `licencias.ver_todas`.
  - Con `licencias.ver_por_aprobar`, `por_aprobar` devuelve todo lo pendiente de la empresa.
- **Detalle** (`DetalleSolicitudSerializer`):
  - `flujo` es el **nombre** del tipo, no su id.
  - El historial se llama `acciones`: `[{id, accion, accion_display, actor, paso, comentario, detalle, created_at}]`.
  - `pendiente_de` trae `[{id, nombre, ausencia}]`.
  - `puedo` trae `{resolver, escalar, cancelar, cancelar_pide_comentario}`; aprobar y rechazar dependen de `resolver`.
  - `evaluacion` solo llega mientras está pendiente y sin la regla `adjunto`.
  - Trae además `cargo`, `area`, `feriados`, `dias_a_devolver`, `ausencias_a_borrar`, `tiene_adjunto` y `adjunto_nombre`.
  - **No trae el tipo MIME del documento:** la app decide entre imagen y PDF por la extensión de `adjunto_nombre`.
- **Crear:** `flujo` es el id del tipo.
- **Errores:**
  - Las reglas que fallan (`restricciones.exigir`) llegan en `error.message`, con `details: null`.
  - El paso 6 («ya no le alcanzan los días…») y «La solicitud ya está cerrada.» también llegan en `error.message`.
  - Los errores por campo van en `details`:
    - como texto, si salen de `services.crear` o `rechazar`;
    - como lista, si salen del serializer.
- **Aprobar, rechazar o cancelar:** el comentario es opcional en el servidor, salvo para rechazar (no vacío) y para anular una aprobada. La app copia de la web el mínimo de 10 caracteres para rechazar.
- **Mis vacaciones:**
  - Totales: `persona, correspondientes, gozados, pendientes, reservados, disponibles, periodos_con_pendientes, regla: {sabados, domingos}`.
  - En curso: `en_curso: [{id, tipo, desde, hasta, dias, paso}]`.
  - Por período: `periodos: [{id, nombre, desde, hasta, correspondientes, gozados, pendientes, reservados, disponibles, sabados, domingos, nota, goces: [{id, desde, hasta, dias, descripcion, por_defecto}]}]`.
- **Quién aprueba por usted mientras no está** (US-001 de la web; en la app por decisión del Tech Lead, 12/11/2026). No estaba en la tabla:
  - `GET /organizacion/mi-reemplazo/` devuelve `{modo: "jefe" | "persona", persona: {id, nombre} | null, jefe: {id, nombre} | null}`. Sin empresa activa responde 403.
  - `PUT /organizacion/mi-reemplazo/` recibe `{modo, persona_id?}` y devuelve lo mismo que el `GET`. Responde 400 por campo (`persona_id` o `modo`) si falta la persona, si es uno mismo o si no es una cuenta activa de la empresa.
  - La persona se busca en `GET /chat/directorio/?q=`, que devuelve `[{id, nombre, correo, area, cargo}]` (hasta 30) sin quien pregunta.
  - Se pide solo en los tipos por días. Con «Otra persona» es obligatorio elegirla.
  - Se guarda con «Enviar» y antes de crear la solicitud, y solo si cambió. Si falla, la solicitud no sale; si la solicitud falla después, se avisa de que el reemplazo sí quedó guardado.
- **Avisos del módulo `licencias`:** casi todos enlazan a `/admin/institucional/permisos?solicitud=ID`. El de los fines de semana marcados por defecto (`licencias.fines_de_semana`) enlaza a `/admin/institucional/vacaciones`, y la app lo abre en «Mis vacaciones».

---

### 5. Decisiones Técnicas y Supuestos
- **Alcance móvil (Tech Lead, 12/11/2026):** se replica lo que hace a diario la mayoría: pedir, consultar, cancelar lo propio pendiente y aprobar o rechazar lo que se tiene pendiente, que es lo que trae el push. Lo administrativo y lo poco frecuente (escalar, ver todas, anular aprobadas, configurar) se abre en el navegador, como manda la regla de la US-009.
- **Las reglas viven en el servidor:** la app no recalcula días, reparto entre períodos ni fines de semana. Muestra lo que devuelve `evaluar` y lo que responde `crear`.
- **Documento:** con `expo-image-picker` (cámara y galería) y `expo-document-picker` (PDF). La foto se comprime si pasa de 10 MB. Se descarga para verla con el token en la cabecera, a la caché de la app (`expo-file-system`), y se borra al cerrar sesión. Nunca se genera un enlace público.
- **Privacidad médica:** la app no muestra nada que la API no devuelva. La regla de no revelar ausencias médicas a terceros la aplica el backend (`apps/ausencias/access.py`). En el formulario se repite el aviso «No escriba diagnósticos».
- **Fechas:** selector nativo (`@react-native-community/datetimepicker` o el que recomiende el SDK de Expo instalado), en la zona del teléfono. Se envían como `AAAA-MM-DD` y `HH:MM`.
- **Push:** no hace falta nada nuevo en el backend. Los avisos `licencias.*` ya pasan por `notificar()` (US-009) y su `enlace` trae `?solicitud=ID`.

---

### 6. Registro de Cierre

- **Estado final:** COMPLETADA CON PENDIENTES
- **Fecha de cierre:** 2026-11-12
- **Auditorías:**
  - QA-FUNC 🟢 APROBADO CON OBSERVACIONES (13 de 14; D-1 resuelto: «Por aprobar» siempre visible, como la web).
  - QA-TECH 🟢 APROBADO CON OBSERVACIONES (8,5/10; los P3 se corrigieron).
  - QA-UX 🟢 sin Críticos (ronda 2: 8/10). El Alto A-1, del calendario de iOS, se corrigió en la ronda 2 sin revalidar en un iPhone.
- **Decisiones durante la historia (Tech Lead, 12/11/2026):**
  - La app replica «Quién aprueba por usted mientras no está» (US-001) en los permisos por días, igual que la web.
  - Marca LAARCOURIER aplicada en toda la app por pedido del usuario: paleta #1E1E1E y #FCE200, Poppins, logotipo, ícono LCE sobre negro y splash.
- **Criterios de aceptación:** CA-1 a CA-14 ✅
- **Archivos principales:**
  - `mobile/src/pantallas/permisos/*`, `mobile/src/permisos/*`, `mobile/src/componentes/SelectorFecha.js`;
  - `mobile/src/tema/{colores,tipografia}.js`, `mobile/assets/**`, `mobile/app.config.js`;
  - `docs/equipo/perfil.md` (regla de la marca).
- **Verificación ejecutada por el Tech Lead:**
  - `npx jest`: 12 suites, 192 passed.
  - `npx expo export --platform android`: Exported.
  - `npm audit --omit=dev`: 0 vulnerabilities.
  - Búsqueda de secretos: nada.
  - Compilación nativa e instalación en un Android físico (SM-A075M): BUILD SUCCESSFUL.
- **Pendientes:**
  1. Probar en el teléfono contra producción (datos reales, por decisión del usuario): cámara, PDF, visor, selectores de fecha y hora, teclado con edge-to-edge y TalkBack.
  2. iPhone sin probar: el calendario inline (A-1), VoiceOver y el gesto de volver con `usePreventRemove`.
  3. Huecos de la API, sin bloquear: el detalle no trae `adjunto_tipo`; el resumen no dice si la persona aprueba sin pendientes.
  4. La US-012 (otra sesión) cambia la anulación de aprobadas; el texto de la app ya es neutral. Revisar el contrato cuando se despliegue.
  5. `useAlturaCabecera` importa una ruta interna de `expo-router`: revisarla al actualizar el SDK.
  6. Compilar en Windows exige `LongPathsEnabled=1`, ninja 1.12.1 en `android-sdk/cmake/3.22.1/bin` (respaldo `ninja-1.10.2.exe.bak`) y la copia de ruta corta `C:\l\m`.
