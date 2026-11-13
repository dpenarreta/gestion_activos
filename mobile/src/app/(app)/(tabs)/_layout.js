import { Tabs } from "expo-router";
import { Image } from "react-native";

import { useChat } from "../../../chat/ChatContext";
import { textoSinLeer } from "../../../chat/formato";
import { Icono } from "../../../componentes/Icono";
import { useContador } from "../../../notificaciones/ContadorContext";
import { useResumenPermisos } from "../../../permisos/ResumenPermisosContext";
import { colores } from "../../../tema/colores";
import { familia } from "../../../tema/tipografia";

const LOGOTIPO_NEGATIVO = require("../../../../assets/marca/laarcourier-negativo.png");

/** El logotipo LAARCOURIER en negativo (blanco) en la cabecera negra del
 * Inicio: 150 × 25 pt, por encima del mínimo de 3 cm (~113 px) del Brand
 * Book, sin deformar (709 × 118) y con el aire de la cabecera como área de
 * protección. El ícono LCE no aparece junto a él. */
function LogotipoEnCabecera() {
  return (
    <Image
      source={LOGOTIPO_NEGATIVO}
      style={{ width: 150, height: 25 }}
      resizeMode="contain"
      accessible
      accessibilityRole="header"
      accessibilityLabel="LAARCOURIER · Inicio"
    />
  );
}

export default function PestanasLayout() {
  const { noLeidas } = useContador();
  const insignia = noLeidas > 0 ? (noLeidas > 99 ? "99+" : noLeidas) : undefined;
  // US-010: lo que la persona tiene por aprobar (`resumen.por_aprobar`).
  const { porAprobar } = useResumenPermisos();
  const insigniaPermisos = porAprobar > 0 ? (porAprobar > 99 ? "99+" : porAprobar) : undefined;
  // US-011: los mensajes sin leer de todas las conversaciones, como el botón
  // «Chat» de la web.
  const { totalNoLeidos } = useChat();
  const insigniaChat = totalNoLeidos > 0 ? (totalNoLeidos > 99 ? "99+" : totalNoLeidos) : undefined;

  return (
    <Tabs
      screenOptions={{
        // Marca LAARCOURIER: barra y cabecera #1E1E1E; la pestaña activa en
        // amarillo #FCE200 (12,7:1) y las demás en #C8C8C8 (10,0:1).
        tabBarStyle: { backgroundColor: colores.cabecera, borderTopColor: colores.acento },
        tabBarActiveTintColor: colores.acento,
        tabBarInactiveTintColor: colores.tintaInactivaOscuro,
        headerStyle: { backgroundColor: colores.cabecera },
        headerTintColor: colores.sobreCabecera,
        headerTitleStyle: { fontFamily: familia(600) },
        tabBarLabelStyle: { fontSize: 12, fontFamily: familia(500) },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Inicio",
          headerTitle: () => <LogotipoEnCabecera />,
          tabBarAccessibilityLabel: "Inicio",
          tabBarIcon: ({ color, size }) => <Icono nombre="home-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="permisos"
        options={{
          title: "Permisos",
          tabBarBadge: insigniaPermisos,
          tabBarBadgeStyle: { backgroundColor: colores.malTexto, color: colores.sobrePrimario },
          tabBarAccessibilityLabel:
            porAprobar > 0
              ? `Permisos, ${porAprobar} por aprobar`
              : "Permisos: solicitudes y vacaciones",
          tabBarIcon: ({ color, size }) => (
            <Icono nombre="calendar-check-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarBadge: insigniaChat,
          tabBarBadgeStyle: { backgroundColor: colores.malTexto, color: colores.sobrePrimario },
          tabBarAccessibilityLabel:
            totalNoLeidos > 0 ? `Chat, ${textoSinLeer(totalNoLeidos)}` : "Chat: canal general, directos y grupos",
          tabBarIcon: ({ color, size }) => (
            <Icono nombre="chat-processing-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="notificaciones"
        options={{
          // La cabecera dice «Notificaciones»; la pestaña, «Avisos», que cabe
          // sin cortarse con cinco pestañas en 360 dp (auditoría UX, H-01).
          title: "Notificaciones",
          tabBarLabel: "Avisos",
          tabBarBadge: insignia,
          // Blanco sobre `malTexto`: 7,6:1 (el rojo por defecto no llega a AA).
          tabBarBadgeStyle: { backgroundColor: colores.malTexto, color: colores.sobrePrimario },
          // La insignia se ve; el número se oye. WCAG 2.5.3: el nombre
          // accesible empieza por lo que se ve, «Avisos» (N-03).
          tabBarAccessibilityLabel:
            noLeidas > 0 ? `Avisos: notificaciones, ${noLeidas} sin leer` : "Avisos: notificaciones",
          tabBarIcon: ({ color, size }) => (
            <Icono nombre={noLeidas > 0 ? "bell-badge-outline" : "bell-outline"} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="cuenta"
        options={{
          title: "Cuenta",
          tabBarAccessibilityLabel: "Cuenta: empresa y cerrar sesión",
          tabBarIcon: ({ color, size }) => (
            <Icono nombre="account-circle-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
