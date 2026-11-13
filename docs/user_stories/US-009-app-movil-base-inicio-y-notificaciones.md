# Historia de Usuario: US-009 - App móvil «Intranet LCE»: base, inicio de sesión, Inicio y notificaciones con push

- **ID:** US-009
- **Tipo:** Historia de Usuario (incluye la base técnica de la app)
- **Fecha:** 2026-11-12
- **Sprint / Módulo:** App móvil · Fase 1 (Institucional · Inicio y Notificaciones)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-3, DEV-2, DEV-1

---

### 1. Definición de la Historia
- **Como:** colaborador del grupo con cuenta en la intranet
- **Quiero:** una app en mi celular («Intranet LCE») donde iniciar sesión con mi misma cuenta, ver el Inicio y recibir y consultar mis notificaciones
- **Para:** enterarme a tiempo de lo que el sistema me avisa, sin estar frente al computador; y que lo que haga en la web o en el celular sea lo mismo, porque usan la misma API y la misma base

La app replica solo algunos módulos y funciones. Fase 1: esta historia. Fase 2 (US-010): solicitud de permisos y Mis vacaciones. Fase 3 (US-011): canal general del chat.

---

### 2. Criterios de Aceptación (Gherkin / BDD)
- **CA-1 · Inicio de sesión:**
  - **Dado que** tengo una cuenta activa
  - **Cuando** abro la app e ingreso mi usuario y contraseña
  - **Entonces** entro al Inicio. Se crea una `Session` igual que en la web (aparece en «Sesiones» con el dispositivo «Intranet LCE · Android/iOS») y los tokens se guardan solo en el almacén seguro del teléfono (Keychain o Keystore).
- **CA-2 · Credenciales incorrectas o bloqueo:**
  - **Dado que** escribo mal la contraseña o la API limita los intentos (throttle `login`)
  - **Cuando** envío el formulario
  - **Entonces** veo el mensaje del contrato de errores (`error.message`) sin detalles técnicos, y el botón no permite enviar dos veces.
- **CA-3 · Sesión igual que en la web:**
  - **Dado que** inicié sesión
  - **Cuando** el access token vence
  - **Entonces** la app lo renueva con el refresh sin que lo note.
  - **Y cuando** la sesión se revoca, pasan 4 h sin uso o vence el refresh de 7 días (`session_revoked`, `session_idle_timeout`, `token_not_valid`)
  - **Entonces** la app borra los tokens, da de baja el push de ese dispositivo y vuelve al login con un aviso claro («Su sesión terminó; inicie sesión de nuevo»).
- **CA-4 · Cerrar sesión:**
  - **Dado que** estoy en la app
  - **Cuando** pulso «Cerrar sesión»
  - **Entonces** se llama a `logout`, el token push de ese dispositivo deja de recibir avisos y se borran los datos locales.
- **CA-5 · Inicio:**
  - **Dado que** entré
  - **Cuando** veo el Inicio
  - **Entonces** me saluda por mi nombre y mi cargo (sin decir «no tiene cargo» mientras carga o si falla), muestra las noticias vigentes del carrusel institucional y los accesos.
  - **Y** los accesos que aún no existen en la app (Solicitud de permisos, Mis vacaciones, Chat, Soporte TI, Mi perfil) se marcan «Abrir en el navegador» y abren `https://intranet.laarcourier.com/<ruta web>` en el navegador del sistema.
  - **Y** cada bloque tiene estados de carga, vacío y error con «Reintentar».
- **CA-6 · Lista de notificaciones:**
  - **Dado que** tengo notificaciones en la campana (las mismas de la web)
  - **Cuando** abro la pestaña «Notificaciones»
  - **Entonces** las veo paginadas, de la más reciente a la más antigua, con el nombre y el ícono del módulo, título, resumen, fecha y si están leídas. Se pueden filtrar por no leídas y hay «Marcar todas como leídas».
  - **Y** el contador de no leídas de la pestaña coincide con el de la campana web, y lo que marco leído en un lado aparece leído en el otro.
- **CA-7 · Notificación de un módulo que no está en la app:**
  - **Dado que** toco una notificación cuyo módulo no está en la app (en la Fase 1, todos)
  - **Cuando** se abre
  - **Entonces** se marca leída y veo su detalle con el texto «Este módulo aún no está en la app. Le recomendamos abrirlo y validarlo desde el navegador.» y un botón «Abrir en el navegador», que abre `https://intranet.laarcourier.com` + `enlace` (+ `?empresa=ID` si la notificación es de una empresa).
  - **Y** si `enlace` está vacío, no se muestra el botón.
- **CA-8 · Notificación de un módulo que sí está en la app:**
  - **Dado que** el módulo figura en el mapa `MODULOS_EN_APP` de la app (vacío en la Fase 1; `licencias` en la US-010, `chat` en la US-011)
  - **Cuando** toco la notificación (en la lista o en el push)
  - **Entonces** la app navega a su pantalla. El mapa se prueba con un módulo ficticio para que la Fase 2 solo tenga que añadir entradas.
- **CA-9 · Registro del dispositivo para el push:**
  - **Dado que** inicié sesión y acepté el permiso de notificaciones del sistema operativo
  - **Cuando** la app obtiene el Expo push token
  - **Entonces** lo registra en `POST /api/v1/notificaciones/dispositivos/`, unido a mi usuario y a mi `Session`. Si el token ya existía (de otra cuenta o sesión), pasa a la actual: un teléfono nunca recibe avisos de dos cuentas.
  - **Y** si rechazo el permiso, la app funciona igual, sin push, y lo explica una sola vez.
- **CA-10 · Envío del push genérico:**
  - **Dado que** el sistema llama a `notificar()` para un usuario con dispositivos activos
  - **Cuando** la notificación se guarda (después del commit)
  - **Entonces** cada dispositivo recibe un push con el título «Intranet LCE», el cuerpo «Tiene una notificación nueva de {nombre del módulo}» y los datos `{notificacion_id, modulo, empresa}`. Nunca lleva título, resumen, enlace ni datos personales.
  - **Y** tocar el push abre la app en el detalle de esa notificación (CA-7 o CA-8).
- **CA-11 · El push nunca tumba lo que lo dispara:**
  - **Dado que** Expo no responde, tarda o devuelve error
  - **Cuando** se envía el push
  - **Entonces** la notificación de la campana ya quedó guardada, la operación de origen termina sin error ni demora perceptible (envío fuera del request, timeout corto) y el fallo queda en el log `apps.notificaciones`.
  - **Y** un `DeviceNotRegistered` desactiva ese token.
- **CA-12 · Revocar la sesión corta el push:**
  - **Dado que** una sesión se revoca (logout, logout-all, usuario deshabilitado, cambio de contraseña o cierre desde «Sesiones»)
  - **Cuando** luego hay una notificación para ese usuario
  - **Entonces** los dispositivos de esa sesión no reciben push.
- **CA-13 · Multiempresa:**
  - **Dado que** trabajo en más de una empresa
  - **Cuando** uso la app
  - **Entonces** puedo cambiar de empresa como en la web (cabecera `X-Empresa`) y el Inicio y las notificaciones responden a la empresa elegida, como la campana web.
- **CA-14 · Protección de datos:**
  - **Dado que** el token push identifica un dispositivo
  - **Cuando** consulto «Mis datos»
  - **Entonces** aparece declarado en `apps/privacidad/mis_datos.py` (dispositivos registrados para avisos).
- **CA-15 · Errores del dispositivo:**
  - **Dado que** el token no tiene el formato de Expo, la plataforma no es `android`/`ios` o no hay sesión
  - **Cuando** se registra
  - **Entonces** la API responde 400 o 401 con el contrato `{"error": {"code", "message", "details"}}`.
  - **Y** nadie puede dar de baja un token ajeno: la baja de un token que no es suyo responde 204 sin efecto.

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| Datos | DEV-3 | Modelo `DispositivoPush` en `apps/notificaciones` con su migración, aplicada en local |
| Backend | DEV-2 | Endpoints de alta y baja del dispositivo; `apps/notificaciones/push.py` (cliente de Expo: lotes, timeout, sin reintentos agresivos, desactivar `DeviceNotRegistered`); enganche en `notificar()` con `transaction.on_commit`; desactivar dispositivos al revocar una `Session`; dispositivo «Intranet LCE · …» en la sesión; `mis_datos.py`; ajustes por entorno (`PUSH_HABILITADO`, `EXPO_ACCESS_TOKEN` opcional, `EXPO_PUSH_URL`); pruebas pytest |
| Móvil | DEV-1 | Proyecto `mobile/` (Expo, Expo Router, JavaScript); cliente HTTP con refresh, `X-Empresa` y errores; login; Inicio; Notificaciones (lista, detalle, abrir en el navegador, mapa `MODULOS_EN_APP`); registro del push y manejo del toque; selector de empresa; cerrar sesión; `app.config.js` y `eas.json` (Android e iOS, nombre «Intranet LCE»); pruebas con jest-expo y Testing Library; README de la app |
| Docs | Tech Lead | `docs/equipo/perfil.md` (stack móvil y DEV-1), índice de historias y backlog |

**Fuera de alcance:**
- Solicitud de permisos y Mis vacaciones (US-010).
- Chat (US-011).
- Calendario del Inicio.
- Huella o Face ID.
- Modo sin conexión.
- Publicación en las tiendas: requiere las cuentas de desarrollador de la empresa y las credenciales de FCM y APNs en EAS, que se gestionan fuera del repositorio.
- Push en la web.

---

### 4. Contrato

| Operación | Ruta / Modelo / Acción | Acceso | Entrada | Salida | Errores |
|---|---|---|---|---|---|
| Iniciar sesión | `POST /api/v1/auth/login/` (existente) | Público, throttle `login` | `{identifier, password}` + `User-Agent: IntranetLCE/<versión> (<android\|ios>)` | `{access, refresh, …}` (igual que la web) | 400 o 401 con el contrato, 429 |
| Renovar | `POST /api/v1/auth/token/refresh/` (existente) | Público | `{refresh}` | `{access, refresh}` | 401 |
| Usuario | `GET /api/v1/auth/me/` y `GET /api/v1/empresas/mias/` (existentes) | Autenticado | — | usuario y permisos; empresas del usuario | 401 |
| Cerrar sesión | `POST /api/v1/auth/logout/` (existente) | Autenticado | `{refresh}` | 204/200 | — |
| Notificaciones | `GET /api/v1/notificaciones/?page=&estado=no_leidas` (existente) | Autenticado + `X-Empresa` | — | paginado `{count, next, results:[{id, empresa, modulo, modulo_nombre, icono, titulo, resumen, enlace, leida, created_at}]}` | 401 |
| Contador | `GET /api/v1/notificaciones/resumen/` (existente) | Autenticado | — | no leídas | 401 |
| Leer | `POST /api/v1/notificaciones/{id}/leer/` y `…/leer-todas/` (existentes) | Autenticado, solo las propias | — | notificación o cantidad | 404 si es ajena |
| Detalle | `GET /api/v1/notificaciones/{id}/` (existente) | Autenticado, solo las propias | — | notificación | 404 |
| Registrar dispositivo | `POST /api/v1/notificaciones/dispositivos/` **(nuevo)** | Autenticado, throttle | `{token: "ExponentPushToken[…]", plataforma: "android"\|"ios", nombre?: str≤100}` | 201 (o 200 si ya existía): `{id, plataforma, nombre, creado: bool}` | 400 `validation_error`, 401, 409 `dispositivo_en_conflicto` (tres choques seguidos), 429 |
| Dar de baja | `POST /api/v1/notificaciones/dispositivos/baja/` **(nuevo)** | Autenticado | `{token}` | 204 (idempotente; sin efecto si no es suyo) | 401 |
| Modelo | `notificaciones.DispositivoPush` **(nuevo, no es por empresa)** | — | `usuario` FK, `session` FK (`authentication.Session`, CASCADE), `token` (único, ≤200), `plataforma` (`android`/`ios`), `nombre` (≤100, opcional), `activo` (bool), `ultimo_envio_en` (nulo), + timestamps de `BaseModel` | — | — |
| Push (salida) | `POST https://exp.host/--/api/v2/push/send` | Servidor → Expo | lotes ≤100 `{to, title:"Intranet LCE", body:"Tiene una notificación nueva de {módulo}", data:{notificacion_id, modulo, empresa}, sound:"default", channelId:"default"}` | tickets | timeout 5 s; `DeviceNotRegistered` → `activo=False` |
| Mapa de la app | `MODULOS_EN_APP` (en `mobile/`) | — | `modulo` → ruta de la app | — | lo que no está → «Abrir en el navegador» |

---

### 5. Decisiones Técnicas y Supuestos
- **Stack (12/11/2026, decisión del usuario):** React Native + Expo (SDK estable vigente) con Expo Router y JavaScript, igual que la web, para reutilizar criterios y textos. Se distribuye en Android e iOS por las tiendas con EAS Build. La carpeta es `mobile/` dentro del repo.
- **Sesión (decisión del usuario):** igual que la web. Cierre a las 4 h sin uso y refresh de 7 días; no cambia nada del backend. Sin biometría.
- **Push genérico (decisión del usuario, LOPDP):** el push pasa por Expo, FCM y APNs. Por eso solo lleva el nombre del módulo y los IDs; el contenido se lee dentro de la app con sesión. `nombre` del dispositivo es opcional y la app manda solo el modelo genérico de la plataforma, nunca el nombre que el usuario le puso al teléfono.
- **Push fuera del request:** `transaction.on_commit` y un hilo daemon con timeout de 5 s. No hay cola de tareas en el proyecto (Celery no está) y `notificar()` ya es «nunca tumba lo que lo dispara». Los recibos de Expo (receipts) quedan para después: la Fase 1 trata solo los errores del ticket.
- **Un token, una sesión:** el token es único. Registrarlo de nuevo lo mueve al usuario y la sesión actuales. Al revocar una `Session` se desactivan sus dispositivos (o se borran en CASCADE) y el envío exige que la sesión siga activa.
- **Enlace al navegador:** `URL_WEB` de la configuración de la app (por defecto `https://intranet.laarcourier.com`) + `enlace`. `enlace_interno()` ya garantiza que es una ruta interna y no un sitio ajeno; la app lo vuelve a validar (debe empezar por «/» y no por «//»). La web ya lee `?empresa=ID` al abrir.
- **API de la app:** `EXPO_PUBLIC_API_URL`, por defecto `https://intranet.laarcourier.com/api/v1`. En desarrollo se usa la IP del PC y el puerto 8010. No hay ningún secreto en `mobile/`: el `EXPO_ACCESS_TOKEN`, si se usa, va solo en el `.env` del servidor.
- **Tokens en el teléfono:** `expo-secure-store`, nunca AsyncStorage.
- **Supuesto:** SER-WEBAI tiene salida HTTPS a `exp.host`. A validar en el despliegue; si no la tiene, `PUSH_HABILITADO=False` deja la app funcionando sin push.
- **Supuesto:** el consentimiento LOPDP pendiente que exige la web al entrar se maneja así en la app: si `me` indica que falta, la app pide completarlo en el navegador.
- **Push e inactividad (Tech Lead, 12/11/2026):** el envío excluye las sesiones revocadas o vencidas (refresh de 7 días), pero no las que llevan 4 h sin uso. Si el push se cortara a las 4 h sin abrir la app, perdería su razón de ser. Al tocarlo pasadas las 4 h, la app pide iniciar sesión de nuevo, como la web. El push es genérico, así que no expone nada mientras tanto.
- **Contrato ajustado por DEV-2:** `creado` es booleano. La baja sin `token` responde 400. Un token nuevo en la misma sesión apaga el anterior. `ultimo_envio_en` solo se actualiza con el ticket `ok`. Una sesión revocada llega como 401 `authentication_failed` (el manejador central usa el `default_code`), así que la app trata cualquier 401 tras un refresh fallido como fin de sesión.
- **Contrato real (DEV-1, verificado contra el backend):** login con `{identifier, password}` (no `username`); filtro `?estado=no_leidas`; marcar todas en `leer-todas/`; la notificación trae `icono` y `leida` (booleano); las empresas del selector salen de `/empresas/mias/`, como en la web. `empresa` se añadió al serializer de la notificación para el enlace `?empresa=ID`.
- **Push con la empresa (Tech Lead, 12/11/2026, QA-FUNC B3):** `data` lleva también `empresa` (un id, no es dato personal). Así el toque abre el detalle en la empresa correcta aunque la app esté en otra.
- **Token movido entre cuentas (riesgo aceptado, Tech Lead, 12/11/2026):** quien conociera el Expo token de otro teléfono podría pasarlo a su cuenta y recibir avisos genéricos sin contenido. El token solo sale del propio dispositivo y el aviso no trae datos, así que el riesgo es bajo.
- **A validar con Protección de datos:** mencionar a Expo, Google y Apple como encargados del envío de avisos en los textos de privacidad (lo edita TI en `privacidad.textos`).

---

### 6. Registro de Cierre

- **Estado final:** COMPLETADA CON PENDIENTES
- **Fecha de cierre:** 2026-11-12
- **Auditorías:** QA-FUNC 🟢 APROBADO CON OBSERVACIONES (ronda 2). QA-TECH 🟢 APROBADO CON OBSERVACIONES (8,5/10). QA-UX 🟢 sin Críticos ni Altos (8,5/10). La ronda 1 bloqueó (CA-4: cierre de sesión con el access vencido; hilo daemon del push; carrusel sin pausa; googleServicesFile; npm audit; errores sin anunciar). Se corrigió en dos rondas.
- **Criterios de aceptación:** CA-1 a CA-15 ✅
- **Archivos principales:**
  - `backend/apps/notificaciones/{models.py, migrations/0002_dispositivopush.py, push.py, services.py, views.py, serializers.py, urls.py, tests/test_push.py, tests/test_campana.py}`
  - `backend/apps/authentication/services.py`
  - `backend/apps/privacidad/mis_datos.py` (sección `dispositivos_para_avisos`)
  - `backend/config/settings/base.py`, `backend/conftest.py`, `backend/.env.example`
  - `mobile/**`
  - `docs/equipo/perfil.md`
- **Verificación ejecutada por el Tech Lead:**
  - `pytest apps/notificaciones apps/authentication apps/privacidad apps/users apps/matriz -q -n 4` → 470 passed
  - `makemigrations --check --dry-run` → No changes detected
  - `mobile: npx jest` → 9 suites, 109 passed
  - `npx expo export --platform android` → Exported
  - `npm audit --omit=dev` → 0 vulnerabilities
  - Búsqueda de secretos en `mobile/` → nada
- **Pendientes:**
  1. Prueba en teléfonos reales con una build de EAS: sesión «Intranet LCE · Android/iOS», push con la app cerrada, cambio de empresa desde el push, cierre sin red, teclado en Android con edge-to-edge, `aria-invalid` y posible doble lectura de las alertas en iOS.
  2. Cuentas de Google Play y Apple de la empresa. Confirmar `com.grupolaar.intranetlce`. `EAS_PROJECT_ID`. Credenciales FCM v1, APNs y `GOOGLE_SERVICES_JSON` en EAS. Íconos con la marca LCE (hoy son los de la plantilla de Expo).
  3. Despliegue a SER-WEBAI: `notificaciones.0002` con `ga_migraciones`. Comprobar la salida HTTPS a `exp.host` (`Test-NetConnection exp.host -Port 443`); si no hay salida, `PUSH_HABILITADO=False`.
  4. Protección de datos: validar la mención de Expo, Google y Apple como encargados en los textos de privacidad.
  5. P3 aceptados: `deepmerge` forzado a 4.1.2 (solo desarrollo, explicado en el README); imágenes del carrusel con el access vencido (a verificar en dispositivo); `session_revoked` llega como `authentication_failed` (manejador central).
  6. US-011 (chat): el chat actualiza una notificación sin leer que ya existe sin volver a enviar push.
