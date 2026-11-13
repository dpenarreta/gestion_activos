// Cada peso por su ruta: importar el paquete entero mete en el bundle las 18
// variantes de Poppins (unos 3 MB).
import { Poppins_400Regular } from "@expo-google-fonts/poppins/400Regular";
import { Poppins_500Medium } from "@expo-google-fonts/poppins/500Medium";
import { Poppins_600SemiBold } from "@expo-google-fonts/poppins/600SemiBold";
import { Poppins_700Bold } from "@expo-google-fonts/poppins/700Bold";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { comportamientoDelAviso } from "../chat/avisoEnPrimerPlano";
import { Boton, Cargando } from "../componentes/comunes";
import { SesionProvider, useSesion } from "../sesion/SesionContext";
import { colores } from "../tema/colores";
import { crearEstilos, usarFuenteDelSistema } from "../tema/tipografia";

// Con la app abierta, el push también se muestra (y el contador se refresca
// en `ContadorProvider`), salvo el del chat de la conversación que se está
// viendo (CA-11 de la US-011, `src/chat/avisoEnPrimerPlano.js`).
Notifications.setNotificationHandler({
  handleNotification: comportamientoDelAviso,
});

/**
 * La pantalla de inicio nativa (marca LAARCOURIER) sigue hasta que están
 * Poppins y la sesión. Nunca se queda colgada: si algo tarda más de
 * `ESPERA_MAXIMA_SPLASH_MS`, se oculta igual y se ve el «Abriendo…» de la app.
 */
const ESPERA_MAXIMA_SPLASH_MS = 8000;
let splashOculta = false;

function ocultarSplash() {
  if (splashOculta) return;
  splashOculta = true;
  SplashScreen.hideAsync().catch(() => {});
}

SplashScreen.preventAutoHideAsync().catch(() => {
  // Si no se pudo retener, el sistema la oculta solo.
});
const respaldoSplash = setTimeout(ocultarSplash, ESPERA_MAXIMA_SPLASH_MS);

function Navegacion({ fuentesListas }) {
  const { estado, reintentar } = useSesion();
  const listo = estado !== "cargando" && fuentesListas;

  useEffect(() => {
    if (!listo) return;
    clearTimeout(respaldoSplash);
    ocultarSplash();
  }, [listo]);

  // La pantalla de carga sigue hasta que está Poppins (marca LAARCOURIER):
  // si no, el primer cuadro sale con la fuente del sistema y salta.
  if (estado === "cargando" || !fuentesListas) {
    return (
      <SafeAreaView style={estilos.pantalla}>
        <Cargando texto="Abriendo Intranet LCE…" />
      </SafeAreaView>
    );
  }

  if (estado === "sin_conexion") {
    return (
      <SafeAreaView style={estilos.pantalla}>
        <View style={estilos.centro}>
          <Text style={estilos.titulo} accessibilityRole="header">
            No se pudo comprobar su sesión
          </Text>
          <Text style={estilos.texto}>
            No hay conexión con el servidor. Revise su conexión e intente de nuevo.
          </Text>
          <Boton titulo="Reintentar" icono="refresh" onPress={reintentar} />
        </View>
      </SafeAreaView>
    );
  }

  const autenticado = estado === "autenticado";
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={autenticado}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!autenticado}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [fuentesCargadas, errorFuentes] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });
  // Si la fuente no carga, la app sigue con la del sistema antes que no abrir.
  // Sin Poppins, los estilos vuelven a la fuente del sistema antes de pintar
  // ninguna pantalla (no a una familia que no existe).
  if (errorFuentes) usarFuenteDelSistema();
  const fuentesListas = fuentesCargadas || Boolean(errorFuentes);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SesionProvider>
        <Navegacion fuentesListas={fuentesListas} />
      </SesionProvider>
    </SafeAreaProvider>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo, justifyContent: "center" },
  centro: { padding: 24, gap: 16, alignItems: "stretch" },
  titulo: { fontSize: 22, fontWeight: "700", color: colores.tinta, textAlign: "center" },
  texto: { fontSize: 16, color: colores.tintaSuave, textAlign: "center" },
});
