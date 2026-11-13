# Intranet LCE (app móvil)

App de la intranet del grupo para Android e iOS. Habla solo con la API del
backend (`/api/v1`), la misma que usa la web. Por eso lo que se hace en un lado
aparece en el otro. Empezó con la US-009 el 12/11/2026.

- **Fase 1 (US-009):** inicio de sesión, Inicio (saludo, cargo, noticias del
  carrusel y accesos), Notificaciones (lista, detalle y push) y selector de
  empresa.
- **Fase 2 (US-010):** pestaña «Permisos» con Mis solicitudes, Por aprobar
  y Mis vacaciones. Permite pedir permisos con la evaluación del servidor y un
  documento (foto, imagen o PDF), ver el detalle con el historial y el
  documento, cancelar lo propio pendiente, y aprobar o rechazar lo que se
  tiene pendiente. Escalar, anular una aprobada, ver todas y configurar los
  tipos se hacen en la web.
- **Fase 3 (US-011):** canal general del chat.

Los módulos que todavía no están en la app se abren en el navegador del
teléfono. Las notificaciones de un módulo pasan a abrirse en la app cuando se
añade ese módulo a `src/notificaciones/modulosEnApp.js` (`MODULOS_EN_APP`).

## Stack

Expo SDK 58 (React Native 0.88), Expo Router y JavaScript. Usa
`expo-secure-store` para los tokens, `expo-notifications` para los avisos y EAS
Build para compilar. Las pruebas usan jest-expo y Testing Library.

Desde la US-010 usa además estas librerías nativas, que exigen un development
build nuevo:
- `expo-image-picker` (cámara y galería);
- `expo-document-picker` (PDF);
- `expo-file-system` (descarga del documento y `File.preview` para abrir el
  PDF con el visor del sistema);
- `@react-native-community/datetimepicker` (fechas y horas).

## Estructura

```
mobile/
├── app.config.js          Nombre, identificadores, plugins y projectId de EAS
├── eas.json               Perfiles development, preview y production
├── .env.example           EXPO_PUBLIC_API_URL, EXPO_PUBLIC_URL_WEB, EAS_PROJECT_ID
├── jest.config.js / jest.setup.js   Pruebas y dobles de los módulos nativos
├── __tests__/             Cliente HTTP, enlaces y mapa, login, notificaciones y push
└── src/
    ├── app/               Rutas de Expo Router (cada archivo es una pantalla)
    │   ├── _layout.js         Sesión y guard: login o la parte autenticada
    │   ├── login.js
    │   └── (app)/             Solo con sesión: contador, toque del push y consentimiento
    │       ├── (tabs)/            Inicio, Permisos y Notificaciones (con insignia), y Cuenta
    │       ├── notificacion/[id].js
    │       └── permisos/          nueva.js y solicitud/[id].js
    ├── api/               Cliente HTTP, almacén seguro, servicios y mensajes de error
    ├── sesion/            SesionContext: login, cierre, empresa activa
    ├── notificaciones/    Push, contador, MODULOS_EN_APP y destino de cada notificación
    ├── permisos/          Resumen (insignia), formato, documento adjunto y descargado
    ├── navegador/         Validar y armar el enlace a la web y abrirlo
    ├── pantallas/         Las pantallas en sí (permisos/: pestaña, detalle y nueva solicitud)
    ├── componentes/       Botón, estados de carga, vacío y error, íconos
    └── tema/              Colores de la identidad visual (contraste AA)
```

## Desarrollo

Requisitos: Node 20 o superior y el backend local corriendo
(`runserver 0.0.0.0:8010`, para que acepte conexiones de la red y no solo de
`127.0.0.1`).

1. Instale las dependencias:

   ```sh
   cd mobile
   npm install
   ```

2. Copie `.env.example` como `.env` y apúntelo a la IP del PC en la red local.
   El teléfono no entiende «localhost»:

   ```sh
   EXPO_PUBLIC_API_URL=http://192.168.1.50:8010/api/v1
   EXPO_PUBLIC_URL_WEB=http://192.168.1.50:5174
   ```

   La IP se ve con `ipconfig`. Hacen falta además tres cosas:
   - El PC y el teléfono deben estar en la misma red.
   - El firewall de Windows debe permitir el puerto 8010.
   - En el `.env` del backend, `ALLOWED_HOSTS` debe incluir esa IP.

3. Arranque Metro:

   ```sh
   npx expo start
   ```

   - **Expo Go:** escanee el QR. Sirve para el login, el Inicio y las
     notificaciones. **No sirve para el push en Android:** Expo Go no lo admite
     desde el SDK 53. La app lo detecta y sigue sin avisos.
   - **Development build** (recomendado para probar el push): compílelo una vez
     con `npx eas-cli@latest build --profile development --platform android`,
     instálelo en el teléfono y luego use `npx expo start --dev-client`.

En redes con inspección TLS (antivirus corporativo), `npm` y `expo` pueden
fallar con `SELF_SIGNED_CERT_IN_CHAIN`. Para que Node use los certificados de
Windows, ejecute antes `set NODE_OPTIONS=--use-system-ca` (o
`export NODE_OPTIONS=--use-system-ca` en Git Bash).

## Verificación

```sh
npx jest                              # pruebas
npx expo export --platform android    # que el bundle compila (borre luego dist/)
npx expo-doctor                       # dependencias y configuración
npm audit --omit=dev                  # vulnerabilidades conocidas
```

`package.json` fuerza con `overrides` versiones corregidas de `glob`,
`minimatch` y `deepmerge`. Son dependencias de compilación y pruebas (Metro,
Jest), no de la app. `deepmerge` queda en la 4.1.2 porque todas las versiones
desde la 4.2.0 tienen el aviso y no hay una posterior corregida. Si una
actualización del SDK rompe algo por estos `overrides`, quítelos y vuelva a
correr las cuatro verificaciones.

## Builds con EAS

| Perfil | Para qué | Resultado |
| --- | --- | --- |
| `development` | Desarrollo con `expo-dev-client` (push incluido) | APK o IPA interno |
| `preview` | Pruebas internas contra producción | APK instalable y build interno de iOS |
| `production` | Tiendas | AAB (Play) e IPA (App Store), versión autoincrementada |

```sh
npx eas-cli@latest login               # con la cuenta de Expo de la empresa
npx eas-cli@latest init                # crea el proyecto y da el projectId
npx eas-cli@latest build --profile preview --platform android
```

Las URL de `preview` y `production` están fijadas en `eas.json` (producción:
`https://intranet.laarcourier.com`).

## Marca LAARCOURIER

Desde el 12/11/2026 la app usa la marca LAARCOURIER (Brand Book 2026), igual
que la web (`backend/apps/branding/migrations/0004_marca_laarcourier.py`):

- **Colores** (`src/tema/colores.js`, con los contrastes medidos):
  - amarillo #FCE200, negro #000000 y gris #E1E1E1;
  - botones, cabeceras y barra de pestañas en #1E1E1E, con el amarillo como
    acento;
  - enlaces en #6B5B00.

  El amarillo nunca va como texto sobre fondo claro.
- **Fuente:** Poppins (`@expo-google-fonts/poppins`, solo JS). Se cargan los
  pesos 400, 500, 600 y 700 en `src/app/_layout.js`. Los estilos se crean con
  `crearEstilos` (`src/tema/tipografia.js`), que elige la familia según el
  peso.
- **Logotipo LAARCOURIER** (`assets/marca/`, copiado de
  `frontend/src/assets/marca/`, sin alterar): el positivo en el login y el
  negativo en la cabecera del Inicio. Siempre en su proporción (709 × 118) y
  con al menos 113 px de ancho.
- **Ícono «LCE»:** `assets/icon.png`, `android-icon-*.png`, `splash-icon.png`
  y `favicon.png` se generan desde `frontend/src/assets/marca/lce.png`, sobre
  #1E1E1E. El ícono y el logotipo nunca van juntos.

## Lo que falta para publicar en las tiendas

Nada de esto va en el repositorio, que es público. Se configura en las cuentas
de la empresa y en EAS:

1. **Cuentas de desarrollador de la empresa:** Apple Developer Program y Google
   Play Console.
2. **Identificadores:** confirmar `com.grupolaar.intranetlce` en
   `app.config.js` (iOS `bundleIdentifier` y Android `package`) antes del primer
   envío. Después de publicar ya no se pueden cambiar.
3. **projectId de EAS:** `eas init` lo genera. Como la configuración es
   `app.config.js`, no se escribe solo: cárguelo en la variable `EAS_PROJECT_ID`
   del entorno de EAS (`eas env:create`) o del `.env` local. Sin él, la app
   funciona igual pero no obtiene el token push (`registrarDispositivo`
   devuelve `sin_proyecto` y deja un aviso en la consola de desarrollo).
4. **Credenciales del push en EAS:**
   - **Android, en el build:** el `google-services.json` del proyecto de
     Firebase de la empresa. **Nunca se versiona** (está en `.gitignore`).
     Súbalo a EAS como variable de entorno de tipo archivo:

     ```sh
     npx eas-cli@latest env:create --name GOOGLE_SERVICES_JSON --type file \
       --value ./google-services.json --environment production --environment preview \
       --environment development --visibility secret
     ```

     `app.config.js` lo lee en `android.googleServicesFile`. Sin la variable,
     el build sale igual pero sin push en Android.
   - **Android, en el envío:** la clave de la cuenta de servicio de Firebase
     (FCM v1), con `eas credentials`. Con ella los servidores de Expo envían a
     FCM.
   - **iOS:** la clave APNs (.p8), que EAS puede generar con la cuenta de Apple.
5. **Íconos y pantalla de inicio con la marca:** por ahora son los de la
   plantilla de Expo (`assets/`).
6. **Fichas de las tiendas:** textos, capturas y la política de privacidad.
   Debe mencionar a Expo, Google y Apple como encargados del envío de avisos;
   está pendiente de validar con Protección de datos (US-009, sección 5).

## Decisiones

- **Sesión igual que en la web:**
  - Hay un solo refresh a la vez: el refresh rota, y reutilizar uno revoca la
    sesión.
  - Todas las peticiones llevan el User-Agent `IntranetLCE/<versión>
    (android|ios)`.
  - Solo un 401 del refresh cierra la sesión, con «Su sesión terminó; inicie
    sesión de nuevo».
  - La red caída, un 5xx o un 429 son temporales: no cierran la sesión.
- **Cerrar sesión a mano:**
  - Primero da de baja el push y luego llama a `/auth/logout/`. Las dos
    pueden renovar el access una vez, para que un access vencido no deje la
    Session abierta.
  - Si el servidor no responde, el teléfono queda sin sesión igual y avisa:
    «No se pudo cerrar la sesión en el servidor; ciérrela desde Sesiones en
    la web». Además (`src/sesion/cierrePendiente.js`):
    - Llama a `Notifications.unregisterForNotificationsAsync()`. El SDK 58 no
      lo documenta, pero en su código nativo, en iOS, es
      `unregisterForRemoteNotifications()`, que es local y sirve sin red. En
      Android es `FirebaseMessaging.deleteToken()`, que sin red falla.
    - Guarda una baja pendiente `{refresh, token}` en el almacén seguro. Se
      envía al abrir la app, al volver al frente y al iniciar sesión: renueva
      con ese refresh, da de baja el token y hace el logout de la sesión
      vieja. Un 401 del refresh significa que la sesión ya terminó.
    - En el siguiente login se envía antes de registrar el teléfono, porque
      en iOS el token suele repetirse. Después, `getExpoPushTokenAsync` vuelve
      a registrar el dispositivo.
    - El registro del dispositivo puede fallar, incluido el 409
      `dispositivo_en_conflicto`. No se muestra a la persona: se reintenta al
      abrir la app o cuando rota el token.
- **El permiso de avisos:**
  - Se pide solo tras iniciar sesión o desde «Cuenta», nunca en cada
    arranque.
  - Antes de la pregunta del sistema, la app explica para qué es.
  - «Cuenta» muestra el estado y abre los ajustes del teléfono.
- **Push de otra empresa:** si trae `data.empresa`, el detalle se pide con esa
  empresa en `X-Empresa`. Si es una empresa de la persona, la app pasa a ella.
- **Tokens solo en `expo-secure-store`** (Keychain o Keystore), nunca en
  AsyncStorage.
- **El push es genérico:** solo trae `{notificacion_id, modulo}`, y el
  contenido se lee en la app con sesión. El dispositivo se registra con el
  modelo genérico (`Device.modelName`), nunca con el nombre que la persona le
  puso al teléfono.
- **Cambio de contraseña obligatorio y aviso de privacidad pendiente:** se
  completan en la web. La app lo explica y ofrece abrirla.
- **Solicitud de permisos (US-010, 12/11/2026):**
  - Las reglas viven en el servidor. La app muestra lo que devuelve
    `/licencias/tipos/{id}/evaluar/` y desactiva «Enviar» si `bloquea`; no
    recalcula días ni fines de semana.
  - El documento se valida antes de enviar: PDF, JPG o PNG de hasta 10 MB. Se
    envía en `multipart` (`{uri, name, type}` en `FormData`) y el servidor
    vuelve a comprobar la firma del contenido. La foto se pide comprimida y,
    en iOS, en formato compatible, para que llegue como JPG y no como HEIC.
  - «Ver documento» lo descarga con la sesión (Bearer y `X-Empresa`) a
    `cache/permisos-documentos/`. Una imagen se ve dentro de la app; un PDF se
    abre con el visor del sistema (`File.preview`). No hay enlace público. Al
    cerrar sesión se borran esa carpeta y las copias que dejan la cámara y el
    selector de archivos.
  - `MODULOS_EN_APP.licencias`:
    - `?solicitud=ID` (solo dígitos) abre el detalle, con la empresa de la
      notificación;
    - el aviso de fines de semana marcados abre «Mis vacaciones»;
    - el resto abre la pestaña «Permisos».
  - En los permisos por días se pregunta «¿Quién aprueba por usted?»: el jefe
    inmediato u otra persona del directorio (`/organizacion/mi-reemplazo/`,
    igual que la web). Se guarda con «Enviar» y antes de crear la solicitud;
    si no se puede guardar, la solicitud no sale.
