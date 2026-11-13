import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { ChatProvider } from "../../chat/ChatContext";
import { ContadorProvider } from "../../notificaciones/ContadorContext";
import { escucharRotacionDelToken } from "../../notificaciones/push";
import { useAbrirAlTocarPush } from "../../notificaciones/useAbrirAlTocarPush";
import { AccionPendiente } from "../../pantallas/AccionPendiente";
import { ResumenPermisosProvider } from "../../permisos/ResumenPermisosContext";
import { useSesion } from "../../sesion/SesionContext";
import { colores } from "../../tema/colores";
import { familia } from "../../tema/tipografia";

/** Una función y no una constante: la familia depende de si Poppins cargó. */
function cabecera() {
  return {
    headerBackTitle: "Volver",
    headerStyle: { backgroundColor: colores.cabecera },
    headerTintColor: colores.sobreCabecera,
    headerTitleStyle: { fontFamily: familia(600) },
  };
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
          {/* Las cabeceras son #1E1E1E (marca): la barra de estado, en blanco. */}
          <StatusBar style="light" />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="notificacion/[id]" options={{ ...cabecera(), title: "Notificación" }} />
            <Stack.Screen name="permisos/nueva" options={{ ...cabecera(), title: "Nueva solicitud" }} />
            <Stack.Screen name="permisos/solicitud/[id]" options={{ ...cabecera(), title: "Solicitud de permiso" }} />
            <Stack.Screen name="chat/conversacion/[id]" options={{ ...cabecera(), title: "Conversación" }} />
            <Stack.Screen name="chat/participantes/[id]" options={{ ...cabecera(), title: "Participantes" }} />
            <Stack.Screen name="chat/nuevo" options={{ ...cabecera(), title: "Nuevo mensaje" }} />
            <Stack.Screen name="chat/mi-estado" options={{ ...cabecera(), title: "Mi estado" }} />
          </Stack>
        </ChatProvider>
      </ResumenPermisosProvider>
    </ContadorProvider>
  );
}
