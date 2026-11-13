/**
 * Configuración de la app «Intranet LCE» (US-009, 12/11/2026).
 *
 * Es `app.config.js` y no `app.json` para leer del entorno lo que cambia entre
 * desarrollo y producción sin tocar el código: la URL de la API y de la web
 * (`EXPO_PUBLIC_*`, ver `.env.example`) y el projectId de EAS. Aquí no va
 * ningún secreto: el repositorio es público y todo lo que se escribe en este
 * archivo termina dentro del binario que se publica en las tiendas.
 */

// Identificadores de la app en las tiendas: a confirmar con la cuenta de la
// empresa (Apple Developer y Google Play Console) antes del primer build de
// producción. Cambiarlos después de publicar crea una app distinta.
const IDENTIFICADOR = "com.grupolaar.intranetlce";

// El projectId lo crea `eas init` en la cuenta de Expo de la empresa. Sin él,
// la app funciona igual pero no obtiene el token push (ver README). No es un
// secreto: identifica el proyecto, no da acceso a nada.
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || undefined;

module.exports = () => ({
  expo: {
    name: "Intranet LCE",
    slug: "intranet-lce",
    scheme: "intranetlce",
    version: "1.0.0",
    orientation: "portrait",
    // Ícono «LCE» de la marca LAARCOURIER (Brand Book 2026, 12/11/2026),
    // generado desde `frontend/src/assets/marca/lce.png`: el LCE sobre
    // #1E1E1E. El logotipo LAARCOURIER no va en el ícono: los dos no se
    // combinan en una misma composición.
    icon: "./assets/icon.png",
    // Fase 1 solo en tema claro: los colores están medidos para contraste AA
    // sobre fondo claro (ver src/tema/colores.js).
    userInterfaceStyle: "light",
    ios: {
      bundleIdentifier: IDENTIFICADOR,
      supportsTablet: false,
      // Sin cifrado propio: solo HTTPS del sistema. Evita la pregunta de
      // exportación en cada envío a App Store Connect.
      infoPlist: { ITSAppUsesNonExemptEncryption: false },
    },
    android: {
      package: IDENTIFICADOR,
      // Credenciales de Firebase (FCM) para el push en Android. El archivo
      // nunca se versiona (el repo es público): EAS lo inyecta en el build
      // como variable de entorno de tipo archivo, `GOOGLE_SERVICES_JSON`, que
      // trae la ruta del archivo (ver README). Sin ella, el build sale igual
      // pero sin push en Android.
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON || undefined,
      adaptiveIcon: {
        backgroundColor: "#1E1E1E",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
      // Android 13+ pide este permiso para mostrar avisos.
      permissions: ["android.permission.POST_NOTIFICATIONS"],
      // El documento de un permiso se elige con los selectores del sistema y
      // se descarga a la caché propia: la app no necesita leer ni escribir
      // el almacenamiento compartido (revisión técnica de la US-010).
      blockedPermissions: [
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
      ],
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "expo-web-browser",
      [
        "expo-notifications",
        {
          // Color del ícono pequeño del aviso en Android: #1E1E1E de la marca.
          color: "#1E1E1E",
          // El servidor manda los push con `channelId: "default"` (contrato
          // de US-009); la app crea ese canal al pedir el permiso.
          defaultChannel: "default",
        },
      ],
      // US-010: foto o imagen del documento de respaldo de un permiso. Solo
      // cámara y fotos; nada de micrófono.
      [
        "expo-image-picker",
        {
          photosPermission:
            "Intranet LCE usa sus fotos solo para adjuntar el documento de respaldo de un permiso.",
          cameraPermission:
            "Intranet LCE usa la cámara solo para fotografiar el documento de respaldo de un permiso.",
          microphonePermission: false,
        },
      ],
      "@react-native-community/datetimepicker",
      // Pantalla de inicio de la marca (12/11/2026): el ícono LCE sobre
      // #1E1E1E. La app la oculta cuando cargan Poppins y la sesión
      // (`src/app/_layout.js`).
      [
        "expo-splash-screen",
        {
          image: "./assets/splash-icon.png",
          backgroundColor: "#1E1E1E",
          imageWidth: 200,
          resizeMode: "contain",
        },
      ],
    ],
    extra: {
      eas: EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : {},
    },
  },
});
