import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { ChatProvider } from "../../chat/ChatContext";
import { estadoDeLaBandeja } from "../../matriz/formato";
import { ContadorProvider } from "../../notificaciones/ContadorContext";
import { escucharRotacionDelToken } from "../../notificaciones/push";
import { useAbrirAlTocarPush } from "../../notificaciones/useAbrirAlTocarPush";
import { AccionPendiente } from "../../pantallas/AccionPendiente";
import { ResumenPermisosProvider } from "../../permisos/ResumenPermisosContext";
import { useSesion } from "../../sesion/SesionContext";
import { ResumenSoporteProvider } from "../../soporte/ResumenSoporteContext";
import { colores } from "../../tema/colores";
import { familia } from "../../tema/tipografia";

/**
 * US-016: aunque se entre por un enlace o un push a una pantalla del Stack
 * (`/notificaciones`, `/soporte/nuevo`…), debajo quedan los módulos: «Volver»
 * lleva a ellos y no fuera de la app. En expo-router 58 es `anchor`
 * (`initialRouteName` está obsoleto y avisa en Metro); `layoutAnchor.js` lo lee
 * igual: la ruta de este layout que va debajo de la que se abre.
 */
export const unstable_settings = { anchor: "(tabs)" };

/** Una función y no una constante: la familia depende de si Poppins cargó. */
function cabecera() {
  return {
    headerBackTitle: "Volver",
    headerStyle: { backgroundColor: colores.cabecera },
    headerTintColor: colores.sobreCabecera,
    headerTitleStyle: { fontFamily: familia(600) },
  };
}

/** El título de la lista de un estado de la Matriz («Incumplidas»…). */
function tituloDeLaLista(estado) {
  return estadoDeLaBandeja(Array.isArray(estado) ? estado[0] : estado)?.titulo ?? "Matriz de obligaciones";
}

export default function AppLayout() {
  const { usuario } = useSesion();
  // Lo que la web exige antes de entrar (cambio de contraseña obligatorio o
  // aviso de privacidad sin aceptar) se completa en la web: la app no
  // replica esos flujos (US-009, supuesto de la sección 5).
  const pendiente = Boolean(usuario?.must_change_password || usuario?.consentimiento?.pendiente);
  useAbrirAlTocarPush(!pendiente);

  // Si FCM o APNs rotan el token, se registra de nuevo.
  useEffect(() => {
    const suscripcion = escucharRotacionDelToken();
    return () => suscripcion.remove();
  }, []);

  if (pendiente) return <AccionPendiente />;

  return (
    <ContadorProvider>
      <ResumenPermisosProvider>
        {/* US-011: el chat (insignia, novedades) para toda la parte autenticada. */}
        <ChatProvider>
          {/* US-014: lo pendiente de la Mesa de ayuda («Para hoy»). */}
          <ResumenSoporteProvider>
            {/* Las cabeceras son #1E1E1E (marca): la barra de estado, en blanco. */}
            <StatusBar style="light" />
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              {/* US-016: Avisos y Cuenta salen de la barra y se abren desde la
                  cabecera de los módulos, con su cabecera y «Volver». */}
              <Stack.Screen name="notificaciones" options={{ ...cabecera(), title: "Notificaciones" }} />
              <Stack.Screen name="cuenta" options={{ ...cabecera(), title: "Cuenta" }} />
              <Stack.Screen name="notificacion/[id]" options={{ ...cabecera(), title: "Notificación" }} />
              <Stack.Screen name="permisos/nueva" options={{ ...cabecera(), title: "Nueva solicitud" }} />
              <Stack.Screen name="permisos/solicitud/[id]" options={{ ...cabecera(), title: "Solicitud de permiso" }} />
              <Stack.Screen name="chat/conversacion/[id]" options={{ ...cabecera(), title: "Conversación" }} />
              <Stack.Screen name="chat/participantes/[id]" options={{ ...cabecera(), title: "Participantes" }} />
              <Stack.Screen name="chat/nuevo" options={{ ...cabecera(), title: "Nuevo mensaje" }} />
              <Stack.Screen name="chat/mi-estado" options={{ ...cabecera(), title: "Mi estado" }} />
              <Stack.Screen name="soporte/nuevo" options={{ ...cabecera(), title: "Nuevo ticket" }} />
              <Stack.Screen name="soporte/registrar" options={{ ...cabecera(), title: "Registrar ticket" }} />
              <Stack.Screen name="soporte/mi-ticket/[id]" options={{ ...cabecera(), title: "Mi ticket" }} />
              <Stack.Screen name="soporte/ticket/[id]" options={{ ...cabecera(), title: "Ticket" }} />
              {/* US-019: la Matriz de obligaciones. */}
              <Stack.Screen
                name="matriz/estado/[estado]"
                options={({ route }) => ({ ...cabecera(), title: tituloDeLaLista(route?.params?.estado) })}
              />
              <Stack.Screen name="matriz/dia/[fecha]" options={{ ...cabecera(), title: "Vencimientos del día" }} />
              <Stack.Screen name="matriz/periodo/[id]" options={{ ...cabecera(), title: "Obligación" }} />
            </Stack>
          </ResumenSoporteProvider>
        </ChatProvider>
      </ResumenPermisosProvider>
    </ContadorProvider>
  );
}
