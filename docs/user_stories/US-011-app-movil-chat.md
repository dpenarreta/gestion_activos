# Historia de Usuario: US-011 - App móvil · Fase 3: Chat (canal general, directos, grupos, adjuntos y presencia)

- **ID:** US-011
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-12
- **Sprint / Módulo:** App móvil «Intranet LCE» · Fase 3 (Chat)
- **Estado:** Completada con pendientes
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-2 (push de cada mensaje), DEV-1

---

### 1. Definición de la Historia
- **Como:** colaborador con cuenta en la intranet
- **Quiero:** usar el chat de la empresa desde el celular: el canal general, mis mensajes directos y mis grupos, con adjuntos, estado y presencia, y recibir un aviso por cada mensaje nuevo
- **Para:** comunicarme con mis compañeros sin estar frente al computador. Es la misma conversación que en la web, porque usa la misma API (`/api/v1/chat/…`).

**Alcance decidido por el usuario (12/11/2026):**
- canal general;
- mensajes directos;
- grupos, solo para participar;
- adjuntos;
- estado y presencia;
- push de todos los mensajes, incluido el canal general.

Crear, editar o salir de un grupo se queda en la web.

---

### 2. Criterios de Aceptación (Gherkin / BDD)
- **CA-1 · Pestaña Chat:**
  - **Dado que** inicié sesión
  - **Cuando** abro la nueva pestaña «Chat»
  - **Entonces** veo mis conversaciones (canal general, directos y grupos) ordenadas por actividad.
  - **Y** cada una muestra su nombre (en un directo, el de la otra persona), el último mensaje, la hora y el número de no leídos.
  - **Y** la pestaña lleva una insignia con el total de no leídos, como la web.
  - **Y** el acceso «Chat» del Inicio abre la pestaña dentro de la app.
- **CA-2 · Leer una conversación:**
  - **Dado que** abro una conversación
  - **Cuando** carga
  - **Entonces** veo los mensajes con su autor, hora y adjuntos, del más antiguo al más nuevo, y al subir se cargan los anteriores (`?antes=`).
  - **Y** la conversación se marca como leída (`POST …/leer/`), lo que apaga su aviso en la campana, en la web y en la app.
- **CA-3 · Escribir:**
  - **Dado que** estoy en una conversación de la que participo
  - **Cuando** escribo y envío
  - **Entonces** el mensaje se envía una sola vez (sin doble envío) y aparece en la conversación.
  - **Y** si falla, queda marcado con «No se envió · Reintentar», sin perder el texto.
- **CA-4 · Mensajes nuevos en vivo:**
  - **Dado que** tengo la app abierta
  - **Cuando** alguien escribe
  - **Entonces** el mensaje aparece sin recargar a mano, con la misma consulta periódica de novedades que usa la web (`/chat/novedades/`), solo con la app en primer plano.
  - **Y** se actualizan la lista, los contadores y la insignia.
- **CA-5 · Mensajes directos:**
  - **Dado que** quiero escribirle a alguien
  - **Cuando** pulso «Nuevo mensaje», busco en el directorio (`/chat/directorio/?q=`) y elijo a una persona
  - **Entonces** se abre (o se crea) el directo con ella (`POST /chat/conversaciones/directa/`).
- **CA-6 · Grupos (participar):**
  - **Dado que** pertenezco a un grupo
  - **Cuando** lo abro
  - **Entonces** leo y escribo igual que en las demás conversaciones, y veo los participantes.
  - **Y** crear, editar o salir del grupo se ofrece con «Abrir en el navegador».
- **CA-7 · Adjuntos:**
  - **Dado que** quiero enviar un archivo
  - **Cuando** elijo una foto (cámara o galería) o un archivo
  - **Entonces** se valida antes de enviar con los mismos límites de tamaño y tipo que el servidor (`ArchivoGrande` y la validación de `MensajesView`), y se envía en multipart.
  - **Y** al tocar un adjunto recibido, una imagen se ve dentro de la app y otro archivo se abre con el sistema. Se descarga con la sesión (`/chat/archivos/{id}/`) y se borra de la caché al salir del visor o al cerrar sesión.
- **CA-8 · Presencia y estado:**
  - **Dado que** uso el chat
  - **Cuando** veo una persona en la lista, en un directo o entre los participantes
  - **Entonces** veo su estado (en línea, ausente, ocupado o lo que defina la API `/chat/presencia/`) con texto e ícono, no solo con color.
  - **Y** puedo ver y cambiar mi propio estado (`/chat/mi-estado/`) con las mismas opciones de la web.
- **CA-9 · Quién leyó:**
  - **Dado que** envié un mensaje
  - **Cuando** consulto sus lecturas (`/chat/conversaciones/{id}/lecturas/`)
  - **Entonces** veo quién lo leyó y cuándo, como en la web.
- **CA-10 · Push de cada mensaje (backend):**
  - **Dado que** llega un mensaje nuevo a una conversación de la que participo (también el canal general)
  - **Cuando** el servidor lo guarda
  - **Entonces** recibo un push genérico («Tiene una notificación nueva de Chat», sin el texto ni el autor, por la LOPDP de la US-009) aunque ya tuviera un aviso sin leer de esa conversación.
  - **Y** quien escribió no recibe push.
- **CA-11 · No molestar dentro de la conversación:**
  - **Dado que** tengo abierta esa misma conversación en primer plano
  - **Cuando** llega su push
  - **Entonces** la app no muestra la alerta del sistema (el mensaje ya aparece en pantalla). Los de otras conversaciones sí se muestran.
- **CA-12 · Notificaciones y push del chat:**
  - **Dado que** toco una notificación o un push del módulo `chat`
  - **Cuando** se abre
  - **Entonces** la app abre esa conversación (`MODULOS_EN_APP.chat`, a partir del `enlace`), en la empresa de la notificación.
- **CA-13 · Multiempresa:**
  - **Dado que** cambio de empresa
  - **Cuando** vuelvo al chat
  - **Entonces** veo las conversaciones de la empresa activa (`X-Empresa`).
- **CA-14 · Accesibilidad y marca:**
  - estados de carga, vacío y error con «Reintentar»;
  - cada mensaje nuevo recibido en la conversación abierta se anuncia al lector de pantalla;
  - 44 pt en iOS y 48 dp en Android;
  - el teclado no tapa el campo de escribir (Android con edge-to-edge);
  - marca LAARCOURIER (perfil, DEV-1).

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| Backend | DEV-2 | En `apps/chat/services.avisar`: push también para los destinatarios cuya notificación sin leer se actualiza (hoy solo reciben push los nuevos). Se reutiliza `apps.notificaciones.push` (genérico, con la empresa, sin el autor ni el texto). Pruebas |
| Móvil | DEV-1 | Pestaña Chat, conversación, envío, novedades periódicas, directos, participar en grupos, adjuntos, presencia y mi estado, lecturas, `MODULOS_EN_APP.chat`, supresión del aviso en la conversación abierta, Inicio, pruebas |

**Fuera de alcance:**
- crear, editar o salir de grupos;
- editar o borrar mensajes, si la web lo permite (a confirmar por DEV-1; si existe, va con «Abrir en el navegador»);
- llamadas;
- WebSocket (se usa la misma consulta periódica que la web).

---

### 4. Contrato
API existente (`backend/apps/chat/urls.py`): `conversaciones/`, `conversaciones/directa/`, `conversaciones/{id}/`, `…/mensajes/` (GET `?antes=`, POST multipart `texto`+`archivo`), `…/leer/`, `…/lecturas/`, `novedades/`, `directorio/`, `personas/{id}/contacto/`, `presencia/`, `mi-estado/` (GET/PUT), `areas/`, `archivos/{id}/`. DEV-1 anota aquí los nombres reales de los campos.

**Campos reales que consume la app** (DEV-1, 12/11/2026; verificados en `chat/views.py`, `chat/serializers.py`, `chat/services.lecturas`, `chat/estados.py` y `chat/presencia.py`; cliente en `mobile/src/api/servicios.js` → `chatService` y `directorioService`). Todas las rutas van bajo `/api/v1/chat/`; las de una conversación aceptan `X-Empresa` (la de la notificación que la abrió).

- **Persona** (`serializers.persona_dict`): `{id, nombre, correo, area, cargo}` (`area` y `cargo` pueden venir vacíos).
- **Fila de conversación** (`views.resumen`): `{id, tipo, nombre, otro, departamento, miembros, administra, no_leidos, ultimo}`.
  - `tipo`: `general` · `directa` · `grupo` · `area`. En un directo, `nombre` es el de la otra persona y `otro` es su Persona (si no, `null`).
  - `ultimo`: `{texto, autor, propio, fecha}` o `null`. `autor` es el nombre (texto, no objeto); `texto` va recortado a 120 y, si solo hay archivo, es «📎 nombre».
- `GET conversaciones/` → lista de filas (canal general primero, luego por actividad).
- `GET conversaciones/{id}/` → fila + `participantes: [Persona + administra]`.
- `POST conversaciones/directa/` cuerpo `{usuario}` → fila (abre o crea el directo).
- **Mensaje** (`serializers.mensaje_dict`): `{id, conversacion, autor: {id, nombre}|null, propio, texto, archivo, fecha}`; `archivo`: `{nombre, tamano, es_imagen, url}` o `null`, con `url` = `/chat/archivos/{id}/` (la app solo descarga esa forma, con la sesión).
- `GET …/mensajes/[?antes=ID]` → `{mensajes, hay_mas, ultimo_leido, lecturas}`; de a 50, del más antiguo al más nuevo.
- `POST …/mensajes/` multipart `texto` (hasta 4000) y `archivo` (opcional) → 201 con el Mensaje + `avisos: [{usuario, nombre, clave, texto, detalle, mensaje, desde, hasta, reemplazo}]` (quiénes están ausentes; vacío en el canal general).
  - Errores: 400 con `error.code = "archivo_grande"` y `error.details = {archivo: [texto], correos: [...], limite_mb: 10}`; los de validación, con `error.details.archivo` o `error.details.texto`.
- `POST …/leer/` cuerpo `{hasta}` (opcional) → `{ultimo_leido}`.
- `GET …/lecturas/` → `[{id, nombre, ultimo_leido, leido_en}]` de las demás personas.
- `GET novedades/[?desde=CURSOR]` → `{cursor, mensajes, no_leidos: {conversación: n}, total_no_leidos}`; cada mensaje lleva además `conversacion_tipo`. Sin `desde` solo da el punto de partida (`mensajes: []`). `no_leidos` trae solo las conversaciones con algo sin leer.
- `GET directorio/[?q=]` → `[Persona]` de la empresa, sin quien pregunta.
- `GET presencia/?ids=1,2` (hasta 200) → `{"id": {en_linea, ultima_conexion, estado}}`; `estado` es `null` o `{clave, texto, detalle, mensaje, desde, hasta, reemplazo: {id, nombre}|null}`, con `clave` `almuerzo` · `reunion` · `no_disponible` · `vacaciones` · `fuera_oficina` · `vacaciones_proximas`.
- `GET mi-estado/` → `{estado, mensaje, hasta, vacaciones_desde, vacaciones_hasta, mensaje_vacaciones, almuerzo_inicio ("HH:MM" o ""), almuerzo_minutos, vigente, vacaciones_sugeridas: {desde, hasta, aprobada, solicitud}|null}`; `vigente` con la forma de `estado` de la presencia.
- `PUT mi-estado/` cuerpo (todo opcional): `estado`, `mensaje` (hasta 140), `hasta` (momento ISO, o solo la fecha para `fuera_oficina`), `vacaciones_desde`, `vacaciones_hasta`, `quitar_vacaciones`, `almuerzo_inicio`, `almuerzo_minutos` → lo mismo que el `GET`.
- `GET archivos/{id}/` → el archivo (400 «ya no está disponible» o 404 si no).
- No los usa la app: `personas/{id}/contacto/`, `areas/` ni el `POST`/`PATCH` de grupos (se hacen en la web).

Cambio de backend: `chat.services.avisar` programa el push (`push.programar`) para TODAS las notificaciones afectadas (nuevas y actualizadas) de los destinatarios, sin el autor.

---

### 5. Decisiones Técnicas y Supuestos
- **Push del canal general (decisión del usuario, 12/11/2026):** se avisa cada mensaje de cualquier conversación. El aviso sigue siendo genérico (US-009). Se acepta el volumen; si resulta excesivo, se podrá agrupar por conversación más adelante.
- **Tiempo casi real con consultas periódicas:** se usa el mismo mecanismo de la web (`novedades`), solo en primer plano, con el intervalo de la web. Nada de WebSocket en esta fase.
- **Adjuntos:** se reutilizan el selector y la limpieza de caché de la US-010 (`src/permisos/adjunto.js` y `documentos.js`), generalizados si hace falta. Con la regla de la LOPDP: se borran al salir y al cerrar sesión.
- **Sin dependencias nativas nuevas:** si alguna hiciera falta, se consulta antes, porque obliga a recompilar.
- **B2: duplicado tras perder la respuesta de un envío (ronda 1 de QA, decisión del Tech Lead: se resuelve solo en la app, sin tocar el backend).**
  - **Qué hace la app:**
    - si el envío falla por red o por tiempo agotado, el mensaje queda como «Sin confirmar · Puede que se haya enviado; revise antes de reintentar», en vez de «No se envió»;
    - si después llega por el sondeo (`novedades`) o por la recarga un mensaje propio que coincide, el pendiente desaparece solo.
  - **Cuándo coinciden un pendiente y un mensaje:**
    - el mensaje es propio;
    - tiene el mismo texto recortado;
    - tiene el mismo nombre de archivo, o ninguno;
    - su id es mayor que el último que se conocía al escribirlo;
    - su fecha no es anterior al inicio del envío menos 2 minutos.
  - **Riesgo restante:** el servidor no tiene clave de idempotencia (`POST …/mensajes/` no acepta una clave por envío ni descarta repetidos). Se duplica en estos casos:
    - la persona pulsa «Reintentar» antes de que el sondeo traiga el mensaje que sí se guardó; el sondeo va cada 4 s con el chat a la vista;
    - el servidor cambió el nombre del archivo al guardarlo, así que no coincide y el pendiente no se reconoce;
    - la persona sale de la conversación antes de que llegue.
  - **Lo que lo mitiga:** el aviso pide revisar antes de reintentar, y el duplicado se ve en la conversación (la app no ofrece borrar mensajes).
  - **Solución completa:** una clave de idempotencia por envío en el backend (campo `cliente_id` único por autor), que la app ya podría mandar.
- **Pendiente O2 (ronda 2 de QA): «Copiar el mensaje».**
  - Iría en el modal «Quién leyó su mensaje» y como acción accesible de la burbuja propia.
  - No se hizo porque `mobile/package.json` no trae ningún portapapeles (ni `expo-clipboard` ni otro). Instalarlo es una dependencia nativa nueva, que exige consulta y recompilar.
  - Mientras tanto, en las burbujas sin acción al tocar el texto sigue siendo seleccionable (`selectable`), así que se puede copiar con el menú del sistema.
- **Pendiente O4 (ronda 2 de QA):** el número exacto de «avisos de otros módulos» del Inicio necesita que `/notificaciones/resumen/` devuelva los no leídos por módulo. Mientras tanto, la app resta las conversaciones con mensajes sin leer (aproximación).

---

### 6. Registro de Cierre
- **Estado final:** COMPLETADA CON PENDIENTES
- **Fecha de cierre:** 2026-11-12
- **QA-FUNC:** APROBADO CON OBSERVACIONES · **QA-TECH:** APROBADO CON OBSERVACIONES (8/10) · **QA-UX:** 8,5/10, R-01 corregido en la ronda 2
- **Criterios de aceptación:** 14/14 (CA-3 con el riesgo restante de B2, descrito en la sección 5).
- **Archivos principales:** `mobile/src/pantallas/chat/*`, `mobile/src/chat/*`, `mobile/src/accesibilidad/irAlBloque.js`, `mobile/src/utils/useMedianoche.js`, `mobile/src/utils/busqueda.js`, `mobile/src/tema/controles.js`, `mobile/src/componentes/comunes.js`, `backend/apps/chat/services.py`, `backend/apps/notificaciones/services.py`. Incluye las 24 mejoras de UX de toda la app (auditoría auditor-ux-ui-movil) y dos rondas de correcciones.
- **Verificación ejecutada:** `npx jest` con 16 suites y 374 pruebas en verde; `npx expo export --platform android` correcto; `pytest apps/chat apps/notificaciones` con 111 pruebas en verde (ronda del backend); `npm audit --omit=dev` sin vulnerabilidades.
- **Pendientes:**
  - Validar en el dispositivo (SM-A075M y un iPhone):
    - TalkBack y VoiceOver: foco al error, encabezados y separadores de día;
    - la letra al 200 %;
    - `maintainVisibleContentPosition` con la lista invertida;
    - el teclado con edge-to-edge;
    - «Ampliar» en Android, sin que quede copia en la app de fotos;
    - B2 en real: modo avión y adjuntos con tildes.
  - O2: «Copiar el mensaje» necesita `expo-clipboard`, una dependencia nativa que obliga a recompilar.
  - O4: el contador exacto de «avisos de otros módulos» necesita que `/notificaciones/resumen/` excluya el chat (DEV-2).
  - B2: falta una clave de idempotencia en el servidor.
  - Desplegar el backend (push por mensaje) en SER-WEBAI, confirmar la salida a exp.host y hacer el commit (compartido con US-008, US-009, US-010 y US-012).
