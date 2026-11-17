/**
 * Las familias de color de la app (US-026, 17/11/2026: los hexadecimales que
 * estaban fuera de `src/tema`): el color de cada módulo (notificaciones y
 * botones redondos) y el de cada estado del chat, en claro y en oscuro. Quién
 * usa cada uno: `notificaciones/coloresDeModulo.js` y `chat/formato.js`.
 */

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

// En claro, el texto de la etiqueta del módulo va en blanco sobre su color.
for (const familia of Object.values(COLORES_DE_MODULO)) familia.sobreEtiqueta = "#FFFFFF";

/**
 * Los mismos módulos en el modo oscuro (US-026, 17/11/2026): la misma familia
 * de color, con el fondo en su -950, el ícono en su -200 y la etiqueta en su
 * -300 con letra negra.
 *
 * Ronda QA (en el teléfono): con el ícono en -300 el contraste ya pasaba
 * (8,0 a 11,2:1) pero el ícono morado sobre el círculo morado oscuro se veía
 * apagado; en -200 queda entre 10,3:1 (azul) y 12,5:1 (lima). `borde` (el
 * -300) rodea el círculo de los botones redondos: el -950 casi no se separa
 * del fondo oscuro y el anillo da ≥ 9:1 sobre #121212 y #1C1C1C. La etiqueta:
 * negro sobre el -300, ≥ 10,5:1.
 */
export const COLORES_DE_MODULO_OSCURO = {
  institucional: { icono: "#FDE68A", fondo: "#451A03", etiqueta: "#FCD34D", borde: "#FCD34D" },
  dashboards: { icono: "#BFDBFE", fondo: "#172554", etiqueta: "#93C5FD", borde: "#93C5FD" },
  soporte: { icono: "#DDD6FE", fondo: "#2E1065", etiqueta: "#C4B5FD", borde: "#C4B5FD" },
  gestionHumana: { icono: "#A7F3D0", fondo: "#022C22", etiqueta: "#6EE7B7", borde: "#6EE7B7" },
  matriz: { icono: "#FECDD3", fondo: "#4C0519", etiqueta: "#FDA4AF", borde: "#FDA4AF" },
  ordenes: { icono: "#FED7AA", fondo: "#431407", etiqueta: "#FDBA74", borde: "#FDBA74" },
  activos: { icono: "#99F6E4", fondo: "#042F2E", etiqueta: "#5EEAD4", borde: "#5EEAD4" },
  chat: { icono: "#BAE6FD", fondo: "#082F49", etiqueta: "#7DD3FC", borde: "#7DD3FC" },
  auditoria: { icono: "#C7D2FE", fondo: "#1E1B4B", etiqueta: "#A5B4FC", borde: "#A5B4FC" },
  permisos: { icono: "#F5D0FE", fondo: "#4A044E", etiqueta: "#F0ABFC", borde: "#F0ABFC" },
  vacaciones: { icono: "#D9F99D", fondo: "#1A2E05", etiqueta: "#BEF264", borde: "#BEF264" },
  perfil: { icono: "#A5F3FC", fondo: "#083344", etiqueta: "#67E8F9", borde: "#67E8F9" },
  sistema: { icono: "#E1E1E1", fondo: "#262626", etiqueta: "#C4C4C4", borde: "#C4C4C4" },
};
for (const [clave, familia] of Object.entries(COLORES_DE_MODULO_OSCURO)) {
  familia.nombre = COLORES_DE_MODULO[clave].nombre;
  familia.sobreEtiqueta = "#000000";
}

/**
 * El color de cada estado (16/11/2026, a pedido del usuario): disponible en
 * verde, almuerzo en naranja, no disponible en rojo, vacaciones en cian con
 * la playa… Tonos -700, ≥ 4,5:1 sobre blanco y sobre su `fondo`, para el
 * ícono y para el texto. Siempre con su ícono y su nombre (CA-8).
 */
export const COLOR_DE_ESTADO = {
  disponible: { color: "#15803D", fondo: "#DCFCE7" },
  almuerzo: { color: "#C2410C", fondo: "#FFEDD5" },
  reunion: { color: "#1D4ED8", fondo: "#DBEAFE" },
  no_disponible: { color: "#B91C1C", fondo: "#FEE2E2" },
  vacaciones: { color: "#0E7490", fondo: "#CFFAFE" },
  fuera_oficina: { color: "#7E22CE", fondo: "#F3E8FF" },
};

/** Los mismos estados en el modo oscuro (US-026, 17/11/2026): tonos -300
 * sobre su -950 (entre 8,5:1 y 10,6:1) y ≥ 9:1 sobre la superficie #1C1C1C. */
export const COLOR_DE_ESTADO_OSCURO = {
  disponible: { color: "#86EFAC", fondo: "#052E16" },
  almuerzo: { color: "#FDBA74", fondo: "#431407" },
  reunion: { color: "#93C5FD", fondo: "#172554" },
  no_disponible: { color: "#FCA5A5", fondo: "#450A0A" },
  vacaciones: { color: "#67E8F9", fondo: "#083344" },
  fuera_oficina: { color: "#D8B4FE", fondo: "#3B0764" },
};

/** Lo que no tiene estado conocido. */
export const ESTADO_NEUTRO = { color: "#444444", fondo: "#EBEBEB" };
export const ESTADO_NEUTRO_OSCURO = { color: "#C4C4C4", fondo: "#262626" };
