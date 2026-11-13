import { Tabs } from "expo-router/js-tabs";
import { View } from "react-native";

import { BarraDeFuncionalidades } from "../../../navegacion/BarraDeFuncionalidades";
import { CabeceraDeModulos } from "../../../navegacion/CabeceraDeModulos";
import { ProveedorDeModulos, PublicarEstadoDeModulos } from "../../../navegacion/EstadoDeModulos";
import { colores } from "../../../tema/colores";

/**
 * La navegación por módulos (US-016, 13/11/2026), como la app de Uber:
 *
 * - arriba, en la cabecera negra, las pestañas de los MÓDULOS (Institucional
 *   · Chat · Mesa de ayuda; los futuros, a la derecha), con Avisos y Cuenta a
 *   la derecha (`CabeceraDeModulos`);
 * - abajo, la barra flotante con las FUNCIONALIDADES del módulo activo
 *   (`BarraDeFuncionalidades`).
 *
 * Todo sale del catálogo `navegacion/modulos.js`. Institucional son dos
 * pantallas: el Inicio (`index`, `/`, por donde se entra) y los permisos
 * (`/permisos?seccion=`); Chat (`/chat?vista=`), la Mesa (`/soporte?vista=`)
 * y la Matriz (`/matriz?vista=`, US-019), una cada uno. La vista va en la
 * ruta: los enlaces y los push siguen igual (CA-8).
 *
 * `backBehavior="firstRoute"` (CA-9): en Android, Atrás desde otro módulo
 * vuelve a Institucional › Inicio y desde ahí sale de la app.
 *
 * Avisos (`/notificaciones`) y Cuenta (`/cuenta`) dejan de ser pestañas:
 * son pantallas del Stack, con cabecera y «Volver».
 *
 * Ronda 2 (P1 del SM-A075M): la cabecera se pinta UNA vez, aquí, fuera de
 * las pantallas (`headerShown: false`). Con una `header` por pantalla, las
 * pantallas sin foco seguían montadas y se quedaban con los toques. La
 * `tabBar` le publica el estado de las pestañas (`PublicarEstadoDeModulos`)
 * y cada pantalla envuelve su contenido en `SoloConFoco`.
 */
export default function ModulosLayout() {
  return (
    <ProveedorDeModulos>
      <View style={estilos.marco}>
        <CabeceraDeModulos />
        <Tabs
          backBehavior="firstRoute"
          tabBar={(props) => (
            <>
              <PublicarEstadoDeModulos state={props.state} descriptors={props.descriptors} />
              <BarraDeFuncionalidades {...props} />
            </>
          )}
          screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colores.fondo } }}
        >
          <Tabs.Screen name="index" options={{ title: "Inicio" }} />
          <Tabs.Screen name="permisos" options={{ title: "Solicitud de permisos" }} />
          <Tabs.Screen name="chat" options={{ title: "Chat" }} />
          <Tabs.Screen name="soporte" options={{ title: "Mesa de ayuda" }} />
          {/* US-019: `/matriz?vista=bandeja|calendario`. */}
          <Tabs.Screen name="matriz" options={{ title: "Matriz de obligaciones" }} />
        </Tabs>
      </View>
    </ProveedorDeModulos>
  );
}

const estilos = { marco: { flex: 1, backgroundColor: colores.fondo } };
