import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { ChatProvider } from "../../chat/ChatContext";
import { estadoDeLaBandeja } from "../../matriz/formato";
import { BurbujaDeSoporte, ProveedorDeLaBurbuja } from "../../navegacion/BurbujaDeSoporte";
import { ContadorProvider } from "../../notificaciones/ContadorContext";
import { escucharRotacionDelToken } from "../../notificaciones/push";
import { useAbrirAlTocarPush } from "../../notificaciones/useAbrirAlTocarPush";
import { AccionPendiente } from "../../pantallas/AccionPendiente";
import { ResumenPermisosProvider } from "../../permisos/ResumenPermisosContext";
import { useSesion } from "../../sesion/SesionContext";
import { ResumenSoporteProvider } from "../../soporte/ResumenSoporteContext";
import { useColores } from "../../tema/apariencia";
import { familia } from "../../tema/tipografia";

/**
 * US-016: aunque se entre por un enlace o un push a una pantalla del Stack
 * (`/notificaciones`, `/soporte/nuevo`…), debajo quedan los módulos: «Volver»
 * lleva a ellos y no fuera de la app. En expo-router 58 es `anchor`
 * (`initialRouteName` está obsoleto y avisa en Metro); `layoutAnchor.js` lo lee
 * igual: la ruta de este layout que va debajo de la que se abre.
 */
export const unstable_settings = { anchor: "(tabs)" };

/** Una función y no una constante: la familia depende de si Poppins cargó,
 * y los colores, del modo (US-026; en oscuro, el negro del menú de la web). */
function cabecera(colores) {
  return {
    headerBackTitle: "Volver",
    headerStyle: { backgroundColor: colores.cabecera },
    headerTintColor: colores.sobreCabecera,
    headerTitleStyle: { fontFamily: familia(600) },
  };
}

/** «Información del grupo» si se abrió desde un grupo (`?grupo=1`); si no,
 * «Participantes» (el canal general). */
function tituloDeParticipantes(grupo) {
  return (Array.isArray(grupo) ? grupo[0] : grupo) === "1" ? "Información del grupo" : "Participantes";
}

/** El título de la lista de un estado de la Matriz («Incumplidas»…). */
function tituloDeLaLista(estado) {
  return estadoDeLaBandeja(Array.isArray(estado) ? estado[0] : estado)?.titulo ?? "Matriz de obligaciones";
}

export default function AppLayout() {
  const colores = useColores();
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
            {/* US-029: la burbuja de soporte y lo que la apila sobre la barra,
                el chat o el pie de cada pantalla. */}
            <ProveedorDeLaBurbuja>
              {/* Las cabeceras son negras (marca, en los dos modos): la barra de
                  estado, en blanco. */}
              <StatusBar style="light" />
              <View style={estilos.marco}>
                <Stack>
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  {/* US-016: Avisos y Cuenta salen de la barra y se abren desde la
                      cabecera de los módulos, con su cabecera y «Volver». */}
                  <Stack.Screen name="notificaciones" options={{ ...cabecera(colores), title: "Notificaciones" }} />
                  <Stack.Screen name="cuenta" options={{ ...cabecera(colores), title: "Mi perfil" }} />
                  <Stack.Screen name="notificacion/[id]" options={{ ...cabecera(colores), title: "Notificación" }} />
                  <Stack.Screen name="permisos/nueva" options={{ ...cabecera(colores), title: "Nueva solicitud" }} />
                  <Stack.Screen name="permisos/solicitud/[id]" options={{ ...cabecera(colores), title: "Solicitud de permiso" }} />
                  <Stack.Screen name="chat/conversacion/[id]" options={{ ...cabecera(colores), title: "Conversación" }} />
                  {/* US-024 (UX H-01): de un grupo, «Información del grupo». */}
                  <Stack.Screen
                    name="chat/participantes/[id]"
                    options={({ route }) => ({ ...cabecera(colores), title: tituloDeParticipantes(route?.params?.grupo) })}
                  />
                  <Stack.Screen name="chat/contacto/[id]" options={{ ...cabecera(colores), title: "Contacto" }} />
                  <Stack.Screen name="chat/nuevo" options={{ ...cabecera(colores), title: "Nuevo mensaje" }} />
                  {/* US-024: crear un grupo en la app (antes, en la web). */}
                  <Stack.Screen name="chat/grupo-nuevo" options={{ ...cabecera(colores), title: "Nuevo grupo" }} />
                  <Stack.Screen name="chat/mi-estado" options={{ ...cabecera(colores), title: "Mi estado" }} />
                  <Stack.Screen name="soporte/nuevo" options={{ ...cabecera(colores), title: "Nuevo ticket" }} />
                  <Stack.Screen name="soporte/registrar" options={{ ...cabecera(colores), title: "Registrar ticket" }} />
                  <Stack.Screen name="soporte/mi-ticket/[id]" options={{ ...cabecera(colores), title: "Mi ticket" }} />
                  <Stack.Screen name="soporte/ticket/[id]" options={{ ...cabecera(colores), title: "Ticket" }} />
                  {/* US-019: la Matriz de obligaciones. */}
                  <Stack.Screen
                    name="matriz/estado/[estado]"
                    options={({ route }) => ({ ...cabecera(colores), title: tituloDeLaLista(route?.params?.estado) })}
                  />
                  <Stack.Screen name="matriz/dia/[fecha]" options={{ ...cabecera(colores), title: "Vencimientos del día" }} />
                  <Stack.Screen name="matriz/periodo/[id]" options={{ ...cabecera(colores), title: "Obligación" }} />
                  {/* US-022: Gestión de Activos (la ficha, el escáner, la bitácora
                      de mantenimientos y las solicitudes de equipos). */}
                  <Stack.Screen name="activos/[id]" options={{ ...cabecera(colores), title: "Activo" }} />
                  <Stack.Screen name="activos/escanear" options={{ ...cabecera(colores), title: "Escanear" }} />
                  {/* US-023: registrar un activo y editar su ficha técnica. */}
                  <Stack.Screen name="activos/nuevo" options={{ ...cabecera(colores), title: "Registrar activo" }} />
                  <Stack.Screen name="activos/[id]/editar" options={{ ...cabecera(colores), title: "Editar activo" }} />
                  <Stack.Screen name="mantenimientos/nuevo" options={{ ...cabecera(colores), title: "Registrar mantenimiento" }} />
                  <Stack.Screen name="mantenimientos/[id]" options={{ ...cabecera(colores), title: "Mantenimiento" }} />
                  <Stack.Screen name="solicitudes/nueva" options={{ ...cabecera(colores), title: "Nueva solicitud de equipo" }} />
                  <Stack.Screen name="solicitudes/[id]" options={{ ...cabecera(colores), title: "Solicitud de equipo" }} />
                  {/* US-025: Órdenes de trabajo (la ficha y el alta). */}
                  <Stack.Screen name="ordenes/[id]" options={{ ...cabecera(colores), title: "Orden de trabajo" }} />
                  <Stack.Screen name="ordenes/nueva" options={{ ...cabecera(colores), title: "Nueva orden" }} />
                </Stack>
                {/* US-029: después de la pila, una sola vez: encima de todas las
                    pantallas y, para el lector, tras su contenido (CA-5). Se
                    oculta sola en Activos y en los formularios del ticket. */}
                <BurbujaDeSoporte />
              </View>
            </ProveedorDeLaBurbuja>
          </ResumenSoporteProvider>
        </ChatProvider>
      </ResumenPermisosProvider>
    </ContadorProvider>
  );
}

/** El marco de la pila y la burbuja de soporte (US-029). Sin colores: no
 * depende del modo, así que no pasa por `useEstilos`. */
const estilos = StyleSheet.create({ marco: { flex: 1 } });
