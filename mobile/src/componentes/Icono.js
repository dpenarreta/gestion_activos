import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

/**
 * El backend y la web nombran los íconos como Bootstrap Icons
 * (`apps/notificaciones/modulos.py`); la app los dibuja con Material Community
 * Icons, que ya trae Expo. Lo que no esté aquí se ve como la campana.
 */
const EQUIVALENTES = {
  "pc-display": "monitor",
  inbox: "inbox",
  tools: "tools",
  "exclamation-triangle": "alert-outline",
  "journal-check": "book-check-outline",
  headset: "headset",
  buildings: "office-building-outline",
  "bar-chart-line": "chart-bar",
  "chat-dots": "chat-processing-outline",
  "calendar-check": "calendar-check-outline",
  mortarboard: "school-outline",
  download: "download",
  people: "account-group-outline",
  "list-check": "format-list-checks",
  kanban: "view-column-outline",
  "clipboard-check": "clipboard-check-outline",
  speedometer2: "speedometer",
  lightbulb: "lightbulb-outline",
  "camera-video": "video-outline",
  sticky: "note-outline",
  "shield-lock": "shield-lock-outline",
  bell: "bell-outline",
  sun: "white-balance-sunny",
  "journal-text": "book-open-variant",
  "person-vcard": "card-account-details-outline",
};

export function nombreDeIcono(bootstrap) {
  return EQUIVALENTES[bootstrap] || "bell-outline";
}

/** Siempre decorativo: el texto de al lado dice lo mismo. */
export function Icono({ nombre, bootstrap, size = 22, color }) {
  return (
    <MaterialCommunityIcons
      name={nombre || nombreDeIcono(bootstrap)}
      size={size}
      color={color}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
