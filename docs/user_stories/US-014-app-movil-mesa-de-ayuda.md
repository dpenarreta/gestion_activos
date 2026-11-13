# Historia de Usuario: US-014 - App móvil · Fase 4: Mesa de ayuda (crear, seguir y gestionar tickets)

- **ID:** US-014
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-13
- **Sprint / Módulo:** App móvil «Intranet LCE» · Mesa de ayuda (`backend/apps/soporte`, web «Soporte TI»)
- **Estado:** En Progreso
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-1 (dev-mobile). Sin cambios de backend ni de web.

---

### 1. Definición de la Historia
- **Como:** colaborador que pide ayuda a TI, técnico de la mesa (N1/N2…), coordinador o aprobador.
- **Quiero:** crear tickets (propios y a nombre de otra persona), seguirlos, aprobarlos y gestionarlos desde el teléfono igual que en la web: bandeja, cola, conversación, notas internas, historial, datos, prioridad, estados (en curso, esperar al usuario, atendido, cerrar, reabrir), asignar, escalar y adjuntos.
- **Para:** atender y dar seguimiento a la mesa sin estar frente al computador.

Pedido del usuario (13/11/2026). Alcance elegido por el usuario (AskUserQuestion, 13/11/2026):
- Llamadas de voz: **no** en esta fase (WebRTC nativo y sin TURN).
- Extras incluidos: **tomar de la cola**, **aprobar tickets**, **lado de quien pide** (Mis tickets, responder, «¿Quedó resuelto?», encuesta) y **respuestas predefinidas** («/»).
- Alta: **igual que la web**, describir primero y la app sugiere hasta 3 casos.
- Escritorio (reportes, configuración, formulario, Mi horario, horas fuera de horario): **se abren en el navegador**.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

**Entrada y navegación**
- **CA-1 · Acceso:** Dado que la persona entra a la app, cuando abre Inicio, entonces ve «Mesa de ayuda» en «En la app» (sustituye el acceso web «Soporte TI»). Al tocarlo abre la sección con sus vistas según permisos (`GET soporte/tickets/bandeja/` → `puede`, `tecnico`): «Mis tickets» siempre; «Bandeja del equipo» solo con `atender`, `ver_todos`, `asignar` o `registrar`; «Aprobaciones» solo si `GET soporte/aprobaciones/` trae algo. La Mesa no es una pestaña nueva (la barra ya tiene 5).
- **CA-2 · Para hoy:** Dado que hay tickets asignados a mí que necesitan acción, tickets míos que esperan mi respuesta o aprobaciones pendientes, cuando veo Inicio, entonces «Para hoy» los cuenta (plural correcto) y lleva a la vista correspondiente. Si la persona no es del equipo, no se llama a endpoints del equipo (sin 403 visibles).
- **CA-3 · Módulo apagado o sin permiso:** Dado que la API responde 403 `modulo_apagado` o `permission_denied`, cuando se abre la sección o una acción, entonces se muestra un mensaje claro («La Mesa de ayuda no está activa en su empresa» / «No tiene permiso para…») y nunca una pantalla rota.

**Quien pide ayuda**
- **CA-4 · Crear ticket (describir primero):** Dado que tengo `soporte.crear` (o `mesa_crear`), cuando escribo la descripción (≥12 caracteres), entonces la app sugiere «¿Es alguno de estos?» con hasta 3 «Categoría › Caso» usando la misma lógica que `frontend/src/pages/Soporte/Publico/sugerirCaso.js`; puedo elegir uno o escoger categoría y caso de la lista. Completo impacto/urgencia (lenguaje llano, opcionales), los campos configurables visibles de la categoría (tipos, obligatorios, opciones) y hasta 3 adjuntos (cámara, galería o archivo). Al enviar (`POST soporte/solicitar/` o `mesa/solicitar/`, multipart), veo el número, la posición en cola o el aviso de aprobación, y el aviso de fuera de horario.
- **CA-5 · Faltan datos del perfil:** Dado que a «Mi perfil» le faltan nombre, área o agencia, cuando abro «Nuevo ticket» (o el servidor responde 400 `faltan_datos`), entonces la app explica qué falta y ofrece completarlo en el navegador (la ficha de contacto no se edita en la app); los errores por campo de `validar_envio` se muestran junto a cada campo, con foco del lector.
- **CA-6 · Mis tickets:** Dado que tengo tickets, cuando abro «Mis tickets» (`GET soporte/mis-tickets/`), entonces veo cada uno con número, caso, prioridad en lenguaje llano, estado en el vocabulario de quien pide y «qué sigue»; ordenados: primero los que piden algo de mí, luego abiertos, al final cerrados. Se refresca al volver a la pantalla, al tirar hacia abajo y cada 30 s mientras está visible.
- **CA-7 · Ficha de quien pide:** Dado un ticket mío, cuando lo abro (`GET soporte/mis-tickets/{id}/`, sondeo cada 10 s con `?sondeo=1` mientras está visible), entonces veo estado, posición o técnico que atiende, plazos, «Lo que nos contó» (con adjuntos), la conversación (sin internos) y puedo responder con texto y hasta 3 adjuntos si `puede_responder`. Si `puede_confirmar`: «¿Quedó resuelto?» → «Sí» (`{confirmar:true}`) o «No, sigue el problema» (lleva a responder, que reabre). Si `puede_encuestar`: encuesta 1-5, «¿se resolvió?» y comentario (`POST …/encuesta/`). Con el ticket cerrado no se puede responder y se indica crear uno nuevo.

**Equipo de la mesa**
- **CA-8 · Bandeja:** Dado que soy del equipo, cuando abro la bandeja, entonces veo la cabecera del técnico (en horario, «X de N», «N en la cola para usted», nivel) y las vistas «Asignados a mí» (`ambito=mios`), «Cola» (`cola`), «Todos» (`todos`, solo con `ver_todos`/`asignar`), con búsqueda (n.º, solicitante, descripción; espera de 300 ms), filtro de estado (Abiertos por defecto; no en Cola), prioridad y «Solo vencidos». Cada fila: número, solicitante·agencia, caso·categoría, prioridad, estado (y «Escalado por SLA»), técnico o posición, y el vencimiento con su estado (`sla.estado`) en texto, no solo color. Paginación con carga al llegar al final (`page`, 20). Se refresca al volver, al tirar y cada 30 s.
- **CA-9 · Tomar de la cola:** Dado que soy técnico, cuando toco «Tomar siguiente» (`POST tickets/tomar-siguiente/`) o «Tomar este ticket» (`POST tickets/{id}/tomar/`, solo si `permisos.tomar`), entonces el ticket pasa a «Asignado» a mí y se abre su ficha; si la cola está vacía (404) se dice «No hay tickets en la cola para usted»; si no puedo tomarlo, se muestra `permisos.motivo_no_tomar`.
- **CA-10 · Ficha del técnico:** Dado un ticket del equipo, cuando lo abro (`GET tickets/{id}/`, sondeo 10 s con `?sondeo=1`), entonces veo un resumen arriba (estado, prioridad, vence, quién atiende) y las secciones Acciones, Datos (plazos, quién pide con teléfono y correo, clasificación: impacto, urgencia, nivel, canal, reaperturas, creado), Solicitud (descripción, datos adicionales, adjuntos), Conversación, Aprobaciones, Encuesta e Historial (`movimientos`). El orden prioriza lo que se usa: resumen → acciones → conversación; los datos y el historial pueden ir plegados o en pestañas internas accesibles.
- **CA-11 · Conversación y notas internas:** Dado que `permisos.responder`, cuando escribo, entonces elijo «Al usuario» o «Nota interna» (control visible, por defecto «Al usuario»), adjunto hasta 3 archivos y envío (`POST tickets/{id}/responder/`, multipart `texto`, `interno`, `adjuntos[]`). En el hilo cada mensaje lleva su marca Usuario / Equipo / Nota interna, con la nota visualmente distinta y anunciada al lector. Escribir «/» al inicio sugiere respuestas predefinidas (`GET soporte/config/respuestas/`, por atajo y título) y elegir una inserta su texto.
- **CA-12 · Cambiar estado / atendido:** Dado `permisos.acciones`, cuando elijo una acción («Poner en curso», «Esperar al usuario (pausa el plazo)», «Marcar como atendido», «Cerrar», «Reabrir»), entonces se pide confirmación con su campo de nota (obligatoria para «Esperar al usuario») y se envía `POST tickets/{id}/cambiar-estado/ {estado, nota}`. Solo se muestran las acciones que trae `permisos.acciones`.
- **CA-13 · Ajustar prioridad:** Dado `permisos.prioridad`, cuando ajusto la prioridad (directa P1–P4 o por impacto × urgencia) con justificación obligatoria (≤1000), entonces se envía `POST tickets/{id}/prioridad/` y la ficha muestra la nueva prioridad y su movimiento en el historial.
- **CA-14 · Asignar:** Dado `permisos.asignar`, cuando elijo «Asignar a», entonces veo los técnicos (`GET tickets/tecnicos/`: nombre · nivel · abiertos), elijo uno, puedo añadir nota y se envía `POST tickets/{id}/asignar/`.
- **CA-15 · Escalar:** Dado `permisos.escalar`, cuando toco «Escalar al siguiente nivel» con motivo obligatorio (≤2000), entonces se envía `POST tickets/{id}/escalar/`. Si la respuesta trae `visible:false`, la app vuelve a la bandeja y anuncia «Ticket escalado; ya no está en su bandeja».
- **CA-16 · Registrar a nombre de otra persona:** Dado `soporte.registrar`, cuando abro «Registrar ticket», entonces busco a la persona (`GET tickets/personas/?q=`, mínimo 2 letras, espera 300 ms, máximo 8 visibles y «Hay más…»), veo sus datos, completo teléfono/área/agencia si le faltan (solo para este ticket), elijo el canal (teléfono por defecto; `tickets/formulario/` → `canales`), el mismo formulario de CA-4 con sugerencia, adjuntos y «Asignármelo» (si soy técnico), y se envía `POST tickets/registrar/`. Al crear se abre la ficha del ticket.
- **CA-17 · Aprobaciones:** Dado que tengo aprobaciones pendientes (`GET soporte/aprobaciones/`), cuando abro «Aprobaciones», entonces veo cada una con ticket, quien pide, área·agencia, caso, prioridad y descripción, y puedo «Aprobar» o «No aprobar» (nota obligatoria al rechazar, ≤500; se advierte que rechazar cierra el ticket) con `POST aprobaciones/{id}/decidir/`.

**Transversales**
- **CA-18 · Adjuntos:** Dado un adjunto del ticket, cuando lo toco, entonces se descarga con la sesión (la `url` relativa a `/api/v1`) y se ve en la app: imagen en `VisorDeImagen`, PDF/Word/Excel con el visor del sistema (`abrirConElSistema`), y el archivo temporal se borra al salir (LOPDP, igual que US-010/US-011). Al subir: máximo 3 por envío, 10 MB cada uno, solo `.pdf .jpg .jpeg .png .webp .docx .xlsx`, validado en la app antes de enviar con mensaje claro; los errores del servidor se muestran tal cual.
- **CA-19 · Notificaciones:** Dado un aviso del módulo `soporte`, cuando lo toco (campana o push), entonces la app abre: `/admin/soporte/tickets/{id}` → ficha del técnico; `/admin/ayuda/tickets/{id}` → ficha de quien pide; `/admin/aprobaciones` → Aprobaciones; cualquier otro → la sección Mesa de ayuda. Con la empresa de la notificación como `X-Empresa`.
- **CA-20 · Escritorio en el navegador:** Dado que tengo `reportes`, `configurar`, `formulario`, `mi_horario` o `aprobar_horas`, cuando abro la Mesa, entonces veo «Más opciones en el navegador» con esos accesos (ícono de salida) que abren la web.
- **CA-21 · Fuera de horario:** Dado que la ficha trae `registrar_horas: true`, cuando la abro, entonces se avisa «Está fuera de su horario: registre las horas en el navegador» con el acceso a la web.
- **CA-22 · Red inestable:** Dado que un envío (respuesta, acción, alta) falla por red, cuando ocurre, entonces el formulario conserva lo escrito y los adjuntos, el botón tiene candado contra doble toque mientras envía y el error dice que puede haberse enviado y que revise antes de reintentar (sin clave de idempotencia en el servidor). Un sondeo fallido no borra lo que se ve.
- **CA-23 · Accesibilidad y marca:** áreas táctiles ≥ 48 dp, etiquetas en todos los controles de ícono, estados y prioridades anunciados en texto, encabezados en las secciones, letra al 200 % sin cortes, foco al primer error, colores de marca LAARCOURIER (amarillo solo como fondo con contenido negro). Reutilizar `BotonIcono`, `Desplegable`, `CONTROLES`, `irAlBloque`, `useMedianoche` y piezas existentes.

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| App móvil | DEV-1 `dev-mobile` | Servicios API de soporte; rutas `src/app/(app)/soporte/...`; pantallas en `src/pantallas/soporte/` (MesaDeAyuda, MisTickets, NuevoTicket, MiTicket, Bandeja, TicketDetalle, RegistrarTicket, Aprobaciones y piezas); sugerencia de caso portada a `src/soporte/sugerirCaso.js` con sus pruebas; formato de estados/prioridades/SLA; entrada `soporte` en `MODULOS_EN_APP`; acceso en Inicio y «Para hoy»; pruebas jest de cada criterio |
| Backend / Web | — | Sin cambios. Si se detecta un hueco del contrato, se anota como pendiente para DEV-2 |

**Fuera de alcance:** llamadas de voz; reportes, configuración, editor del formulario, Mi horario y horas fuera de horario (se abren en el navegador); editar «Mi perfil» desde la app; vinculación de activos (no existe); tiempo real (se mantiene el sondeo de la web).

---

### 4. Contrato
Todo bajo `/api/v1/soporte/`, cabecera `X-Empresa`. Inventario completo del 13/11/2026 (archivos `backend/apps/soporte/urls.py`, `views.py`, `serializers.py`, `services.py`).

| Operación | Ruta | Acceso | Entrada | Salida | Errores |
|---|---|---|---|---|---|
| Datos del alta | `GET solicitar/`, `GET mesa/solicitar/` | autenticado | — | `{disponible, campos[], agencias[], areas[], categorias[{casos[]}], impactos[], urgencias[], mis_datos{faltan[]}, puede_crear}` | 403 `modulo_apagado` |
| Crear propio | `POST solicitar/` (`crear`) / `mesa/solicitar/` (`mesa_crear`) | permiso | multipart `caso, descripcion≤5000, impacto?, urgencia?, adicionales (JSON), adjuntos[]` | 201 `{id, numero, posicion, estado, fuera_de_horario}` | 400 `faltan_datos {faltan, mis_datos}`, errores por `clave`; 403; throttle 5/min |
| Mis tickets | `GET mis-tickets/` | autenticado | — | arreglo (≤100) `{id, numero, categoria, caso, estado, estado_display, atrasado, puede_encuestar, prioridad, prioridad_display, posicion, actualizado, creado, atendido_en}` | |
| Ficha propia | `GET mis-tickets/{id}/[?sondeo=1]` | dueño | — | seguimiento (`plazos`, `mensajes`, `adjuntos`, `encuesta`, `puede_responder/confirmar/encuestar`, `cierre_automatico`) | 404 |
| Responder / confirmar | `POST mis-tickets/{id}/` | dueño | `{confirmar:true}` o multipart `texto, adjuntos[]` | seguimiento | 400 cerrado |
| Encuesta | `POST mis-tickets/{id}/encuesta/` | dueño | `{calificacion 1-5, resuelto, comentario?≤2000}` | 201 seguimiento | 400 |
| Adjunto propio | `GET mis-tickets/{id}/adjuntos/{aid}/` | dueño | — | archivo | 404 |
| Cabecera bandeja | `GET tickets/bandeja/` | equipo | — | `{tecnico, cola_total, categorias_sin_tecnicos, puede{crear, mesa_crear, mesa_mis_tickets, ver_todos, asignar, registrar, aprobar_horas}}` | 403 |
| Lista | `GET tickets/` | equipo | `ambito, estado, abiertos, categoria, prioridad, vencidos, q, page, page_size` | paginado `TicketLista` (`sla{estado, vence, respuesta{...}}`) | |
| Ficha | `GET tickets/{id}/[?sondeo=1]` | equipo | — | `TicketDetalle` (`mensajes` con `interno`, `movimientos`, `permisos{acciones, tomar, motivo_no_tomar, responder, escalar, asignar, prioridad}`, `registrar_horas`) | 404 |
| Tomar | `POST tickets/{id}/tomar/`, `POST tickets/tomar-siguiente/` | técnico | — | detalle | 400/404 |
| Estado | `POST tickets/{id}/cambiar-estado/` | asignado o `asignar` | `{estado, nota?}` | detalle | 400 transición |
| Prioridad | `POST tickets/{id}/prioridad/` | asignado o `asignar` | `{prioridad?, impacto?, urgencia?, justificacion}` | detalle | 400 |
| Técnicos | `GET tickets/tecnicos/` | `asignar` | — | `[{id, nombre, nivel, abiertos}]` | |
| Asignar | `POST tickets/{id}/asignar/` | `asignar` | `{tecnico, nota?}` | detalle o `{visible:false}` | 400 |
| Escalar | `POST tickets/{id}/escalar/` | asignado o coordinador | `{motivo}` | detalle o `{visible:false}` | 400 |
| Responder / nota | `POST tickets/{id}/responder/` | asignado, coordinador, `ver_todos` | multipart `texto≤10000, interno, adjuntos[]` | detalle | 400 cerrado |
| Adjunto | `GET tickets/{id}/adjuntos/{aid}/` | equipo | — | archivo | |
| Alta interna | `GET tickets/formulario/`, `GET tickets/personas/?q=`, `POST tickets/registrar/` | `registrar` | + `solicitante, canal, asignarme, telefono, sede, area` | 201 detalle | 400 `faltan_datos {faltan, solicitante}` |
| Respuestas predefinidas | `GET config/respuestas/` | equipo | — | `[{id, atajo, titulo, texto}]` | |
| Etiquetas | `GET etiquetas/` | autenticado | — | `{estados, prioridades}` (nombres de la empresa) | |
| Aprobaciones | `GET aprobaciones/`, `POST aprobaciones/{id}/decidir/` | aprobador | `{aprobar, nota?≤500}` | `[...]` / `{numero, estado}` | 400 nota |

Adjuntos: ≤3 por envío, 10 MB, `.pdf .jpg .jpeg .png .webp .docx .xlsx` (firma validada en el servidor).

---

### 5. Decisiones Técnicas y Supuestos
- **Sin pestaña nueva** (Tech Lead): la barra ya tiene 5 (límite de Material/HIG). La Mesa entra desde Inicio («En la app» y «Para hoy») y desde las notificaciones; ruta de pila `/soporte`.
- **Una sola sección con vistas por permiso** en lugar de pantallas separadas por rol: quien pide ve «Mis tickets» y «Nuevo ticket»; el equipo ve además la bandeja, «Registrar ticket» y «Tomar siguiente»; el aprobador ve «Aprobaciones».
- **Sondeo como la web** (30 s listas, 10 s fichas, solo con la pantalla enfocada y la app en primer plano): no hay tiempo real en el servidor.
- **Sugerencia de caso en el cliente:** se porta la lógica de `sugerirCaso.js` (raíces de 5 letras, sin tildes ni palabras vacías) con pruebas equivalentes; si la web la cambia, hay que sincronizarla (anotado).
- **Datos del perfil:** la app no edita la ficha de contacto; ante `faltan_datos` ofrece completarla en el navegador.
- **Nombres por empresa:** el equipo ve `estado_display`/`prioridad_display` tal como vienen (ya personalizados); quien pide ve el vocabulario de `mis-tickets`.
- **Sin cambios de backend** (Tech Lead): el contrato actual cubre todo el alcance. Riesgo conocido: sin clave de idempotencia en los POST (igual que el chat) → candado y mensaje de CA-22.
- **Llamadas fuera** (usuario): ni botón ni sondeo de llamadas en la app.

---

### 6. Registro de Cierre
*(Lo completa el Tech Lead al finalizar).*

- **Estado final:** COMPLETADA CON PENDIENTES
- **Fecha de cierre:** 2026-11-13
- **QA-FUNC:** 🟡 APROBADO CON OBSERVACIONES (22/23 CA; CA-23 se valida en el dispositivo). Todas sus observaciones G-1 a G-11 se corrigieron en la ronda 1. G-1 se corrigió solo en la app.
- **QA-TECH:** primera auditoría 🔴 RECHAZADO (3 P2: push sin filtrar en `ResumenSoporteContext`, paginación por `items.length`, novedades del sondeo sin anunciar). Revalidación 🟡 APROBADO CON OBSERVACIONES, 8,5/10. Sus 4 P3 se corrigieron en la ronda 2.
- **QA-UX móvil:** primera auditoría 7/7/7,5 (UX/UI/accesibilidad) con 8 P2. Revalidación 7,5/8/8: 6 P2 resueltos, H-05 resuelto en el código y H-03 parcial. En la ronda 2 se corrigieron el H-03 y los 11 P3 nuevos. La medida de la cabecera de la Bandeja queda para el dispositivo.
- **Decisiones del Tech Lead durante la auditoría:**
  - **G-1:** el servidor devuelve mensajes con formato `[ErrorDetail(string='…')]` desde `backend/apps/core/exceptions.py:149`. Se resolvió solo en la app, con `limpiarMensaje` en `api/errores.js`, porque otra sesión trabajaba en el backend.
  - **G-5:** una encuesta pendiente no cuenta en «Para hoy».
  - **N-10:** el nivel 2 de la bandeja usa pestañas de texto con subrayado; los filtros activos van con fondo `realce` y contorno.
- **Criterios de aceptación:** CA-1 a CA-22 ✅ (con pruebas). CA-23 ⚠️: se cumple en el código y falta validarlo en el dispositivo.
- **Archivos principales (`mobile/`):**
  - `src/soporte/`: `sugerirCaso`, `formato`, `adjuntos`, `useSondeo`, `ResumenSoporteContext`, `avisoPendiente`.
  - `src/pantallas/soporte/`: `MesaDeAyuda`, `MisTickets`, `Bandeja`, `Aprobaciones`, `NuevoTicket`, `MiTicket`, `TicketDetalle`, `RegistrarTicket`, `FormularioDelTicket`, `piezas`.
  - `src/app/(app)/soporte/*`.
  - `src/componentes/Selectores.js`.
  - `src/componentes/comunes.js`: `Segmentos` común y las variantes `aviso`, `peligro` y `expandido` de `Boton`.
  - `src/api/servicios.js` (`soporteService`) y `src/api/errores.js`.
  - `src/notificaciones/modulosEnApp.js` (`rutaDeSoporte`) y `src/pantallas/Inicio.js`.
  - `src/utils/busqueda.js` (`ESPERA_BUSCAR_MS`).
  - Pruebas en `__tests__/soporte{Servicios,Mesa,Fichas,Altas}.test.js`.
  - Sin cambios en backend ni en web.
- **Verificación ejecutada (Tech Lead, 13/11/2026):**
  - `cd mobile && NODE_OPTIONS=--use-system-ca npx jest`: 20 suites y **497 passed** (antes 374).
  - `npx expo export --platform android`: bundle hbc de 3,6 MB, exportado.
- **Pendientes:**
  1. **Validar en el teléfono** (Samsung SM-A075M y un iPhone):
     - la cabecera de la Bandeja en 360×800 debe dejar ver un ticket sin desplazar (objetivo: unos 400 dp);
     - Aprobaciones con el teclado abierto;
     - TalkBack y VoiceOver: anuncios del sondeo, «Más acciones» y nota interna;
     - letra al 200 %;
     - visor de PDF, DOCX e imágenes, y borrado del temporal;
     - push de «Ticket asignado» con otra empresa activa;
     - dos técnicos que toman a la vez.
  2. **DEV-2:** `apps/core/exceptions.py:149` debe unir los textos de un `ValidationError` con lista en lugar de usar `str(...)`. Afecta también a la web.
  3. **DEV-2:** contadores de servidor para «Para hoy» (tickets que necesitan acción y aprobaciones pendientes), para no traer las listas completas. También excluir el chat y la mesa del conteo de «avisos de otros módulos» (O4 de la US-011).
  4. **Sin clave de idempotencia en los POST de soporte.** Se mitiga con el candado y el aviso «puede haberse enviado».
  5. **`sugerirCaso` está copiado de la web:** si la web cambia la lógica, hay que sincronizarlo.
  6. **Fuera de alcance por decisión del usuario:** las llamadas de voz y las funciones de escritorio, que se abren en el navegador.
  7. **Prettier:** falta pasarlo solo sobre los archivos tocados antes del commit.
