/**
 * El color de cada módulo en las notificaciones (16/11/2026, paleta pedida
 * por el usuario): el ícono en su color, sobre su fondo claro, en un cuadro
 * redondeado, y una etiqueta con el nombre del módulo.
 *
 * Ajustes de contraste (WCAG 2.1 AA) sobre la paleta pedida, dentro de la
 * misma familia de color:
 * - Ícono ámbar: #B45309 (amber-700) y no #D97706, que sobre #FEF3C7 da
 *   2,86:1 (un ícono necesita 3:1). Los demás íconos van en su -600 (≥ 3,1:1).
 * - Etiquetas con texto blanco: el -600 pedido donde da 4,5:1 (azul, violeta,
 *   rosa, índigo); en ámbar, esmeralda, naranja, teal y celeste el -600 da
 *   entre 3,2 y 4,1:1, así que van en su -700 (≥ 5:1).
 */
export const COLORES_DE_MODULO = {
  institucional: {
    nombre: "Institucional",
    icono: "#B45309",
    fondo: "#FEF3C7",
    etiqueta: "#B45309",
  },
  dashboards: {
    nombre: "Dashboards",
    icono: "#2563EB",
    fondo: "#DBEAFE",
    etiqueta: "#2563EB",
  },
  soporte: {
    nombre: "Mesa de ayuda",
    icono: "#7C3AED",
    fondo: "#EDE9FE",
    etiqueta: "#7C3AED",
  },
  gestionHumana: {
    nombre: "Gestión Humana",
    icono: "#059669",
    fondo: "#D1FAE5",
    etiqueta: "#047857",
  },
  matriz: {
    nombre: "Matriz de obligaciones",
    icono: "#E11D48",
    fondo: "#FFE4E6",
    etiqueta: "#E11D48",
  },
  ordenes: {
    nombre: "Órdenes de trabajo",
    icono: "#EA580C",
    fondo: "#FFEDD5",
    etiqueta: "#C2410C",
  },
  activos: {
    nombre: "Gestión de Activos",
    icono: "#0D9488",
    fondo: "#CCFBF1",
    etiqueta: "#0F766E",
  },
  chat: {
    nombre: "Chat",
    icono: "#0284C7",
    fondo: "#E0F2FE",
    etiqueta: "#0369A1",
  },
  auditoria: {
    nombre: "Auditoría",
    icono: "#4F46E5",
    fondo: "#E0E7FF",
    etiqueta: "#4F46E5",
  },
  // Colores propios dentro de Institucional (16/11/2026, a pedido del
  // usuario), que no repiten los de otros módulos. Ícono sobre su fondo
  // ≥ 4:1 y blanco sobre la etiqueta ≥ 4,9:1.
  permisos: {
    nombre: "Solicitud de permisos",
    icono: "#C026D3",
    fondo: "#FAE8FF",
    etiqueta: "#A21CAF",
  },
  vacaciones: {
    nombre: "Mis vacaciones",
    icono: "#4D7C0F",
    fondo: "#ECFCCB",
    etiqueta: "#4D7C0F",
  },
  perfil: {
    nombre: "Mi perfil",
    icono: "#0E7490",
    fondo: "#CFFAFE",
    etiqueta: "#0E7490",
  },
  // Lo que no es de ningún módulo conocido («Sistema»).
  sistema: {
    nombre: "Sistema",
    icono: "#444444",
    fondo: "#EBEBEB",
    etiqueta: "#444444",
  },
};

/** De qué familia es cada clave de módulo del backend
 * (`apps/notificaciones/modulos.py`, MODULOS). */
const FAMILIA = {
  licencias: "permisos",
  procesos: "institucional",
  capacitacion: "institucional",
  privacidad: "institucional",
  dashboards: "dashboards",
  soporte: "soporte",
  novedades: "gestionHumana",
  tareas: "gestionHumana",
  proyectos: "gestionHumana",
  llamados: "gestionHumana",
  kpi: "gestionHumana",
  mejora_continua: "gestionHumana",
  reuniones: "gestionHumana",
  escritorio: "gestionHumana",
  matriz: "matriz",
  ordenes: "ordenes",
  activos: "activos",
  solicitudes: "activos",
  mantenimientos: "activos",
  alertas: "activos",
  chat: "chat",
  descargas: "auditoria",
};

/** Los colores de una notificación según su módulo (`modulo`, o el prefijo
 * de su `tipo`). */
export function coloresDe(notificacion) {
  const clave =
    notificacion?.modulo || String(notificacion?.tipo ?? "").split(".")[0];
  return COLORES_DE_MODULO[FAMILIA[clave]] ?? COLORES_DE_MODULO.sistema;
}

/**
 * Los mismos colores para los íconos del resto de la app (16/11/2026, a
 * pedido del usuario: «aplica los nuevos colores a todos los iconos»): la
 * familia por su nombre (`institucional`, `soporte`, `chat`…).
 */
export function coloresDeFamilia(familia) {
  return COLORES_DE_MODULO[familia] ?? COLORES_DE_MODULO.sistema;
}
