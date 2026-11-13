import { Platform } from "react-native";

/**
 * La marca LAARCOURIER (Brand Book 2026, decisión del usuario, 12/11/2026),
 * igual que la web (`branding/0004_marca_laarcourier`): amarillo #FCE200,
 * negro #000000 y gris #E1E1E1; primario y botones #1E1E1E con texto
 * blanco; títulos #000000; texto #1E1E1E; enlaces #6B5B00; fondo #F4F4F4.
 *
 * El amarillo es acento sobre negro (pestaña activa, subrayados, íconos
 * activos) o fondo con texto negro. **Nunca va como texto sobre fondo claro**:
 * #FCE200 sobre blanco da 1,3:1.
 *
 * Contrastes medidos (WCAG 2.1, texto normal pide 4,5:1; bordes de controles,
 * 3:1):
 * - `tinta` #1E1E1E sobre blanco: 16,7:1; sobre `fondo` #F4F4F4: 15,2:1.
 * - `titulo` #000000 sobre `fondo`: 19,1:1.
 * - Blanco sobre `primario` #1E1E1E (botones, cabeceras): 16,7:1.
 * - `acento` #FCE200 sobre #1E1E1E (pestaña activa): 12,7:1; negro sobre
 *   `acento`: 16,0:1.
 * - `tintaInactivaOscuro` #C8C8C8 sobre #1E1E1E (pestaña inactiva): 10,0:1.
 * - `enlace` #6B5B00 sobre blanco: 6,7:1; sobre `fondo`: 6,1:1.
 * - `tintaSuave` #444444: 9,7:1 sobre blanco y 8,9:1 sobre `fondo`.
 * - `tintaTenue` #5E5E5E: 6,5:1 sobre blanco y 5,9:1 sobre `fondo`.
 * - `realce` #FFF9D1 (seleccionado o presionado): `tinta` encima 15,7:1 y
 *   `tintaSuave` 9,2:1. `hundido` #EBEBEB: `tinta` 14,0:1 y `tintaSuave` 8,2:1.
 * - `bordeControl` #767676 (contorno de campos y chips, WCAG 1.4.11): 4,5:1
 *   sobre blanco y 4,1:1 sobre `fondo`. `borde` #DADADA solo separa tarjetas.
 * - Semánticos, sin cambios respecto de la identidad anterior:
 *   - `bienTexto` #146C43 sobre `bienFondo` #E3F5EC: 5,7:1 (6,5:1 sobre blanco);
 *   - `avisoTexto` #B8481F sobre `avisoFondo` #FFF1EA: 4,8:1;
 *   - `malTexto` #A91E1E sobre `malFondo` #FDEAEA: 6,3:1 (6,6:1 sobre `fondo`);
 *   - blanco sobre `malTexto` (insignias): 7,3:1;
 *   - `infoTexto` #164B86 sobre `infoFondo` #EAF2FB: 7,8:1.
 */
export const colores = {
  // Marca.
  marcaAmarillo: "#FCE200",
  marcaNegro: "#000000",
  marcaGris: "#E1E1E1",

  // Interfaz.
  primario: "#1E1E1E",
  sobrePrimario: "#ffffff",
  cabecera: "#1E1E1E",
  sobreCabecera: "#ffffff",
  acento: "#FCE200",
  tintaInactivaOscuro: "#C8C8C8",
  // Lo presionado sobre la cabecera y la barra oscuras (US-016, H-12): el
  // texto blanco sigue en 13,3:1 y el #C8C8C8 en 7,9:1.
  presionadoOscuro: "#2E2E2E",
  enlace: "#6B5B00",
  realce: "#FFF9D1",

  fondo: "#F4F4F4",
  superficie: "#ffffff",
  hundido: "#EBEBEB",
  borde: "#DADADA",
  bordeFuerte: "#C4C4C4",
  bordeControl: "#767676",
  titulo: "#000000",
  tinta: "#1E1E1E",
  tintaSuave: "#444444",
  tintaTenue: "#5E5E5E",

  bienFondo: "#e3f5ec",
  bienTexto: "#146c43",
  avisoFondo: "#fff1ea",
  avisoTexto: "#b8481f",
  malFondo: "#fdeaea",
  malTexto: "#a91e1e",
  infoFondo: "#eaf2fb",
  infoTexto: "#164b86",
};

/** El mínimo de las áreas táctiles: 48 dp en Android (Material) y 44 pt en
 * iOS (Human Interface Guidelines). */
export const AREA_TACTIL = Platform.OS === "android" ? 48 : 44;
