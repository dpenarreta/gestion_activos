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
 * Hay dos paletas con los mismos nombres (US-026, 17/11/2026): `paletaClara`
 * (la de siempre) y `paletaOscura`. Las pantallas las leen con
 * `useColores()` / `useEstilos()` (`./apariencia`), según el modo elegido
 * (Claro, Oscuro o Sistema). `colores` sigue exportado y es la clara: para
 * las pruebas y lo que no depende del render.
 *
 * Contrastes medidos de la clara (WCAG 2.1, texto normal pide 4,5:1; bordes de
 * controles, 3:1):
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
 *   - blanco (`sobreInsignia`) sobre `insignia` (= `malTexto`, los números
 *     rojos de pendientes): 7,3:1;
 *   - `infoTexto` #164B86 sobre `infoFondo` #EAF2FB: 7,8:1.
 */
export const paletaClara = {
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
  // Lo pendiente sin llamar tanto la atención (avisos sin leer, 16/11/2026):
  // a pedido del usuario, un gris (plomo) suave en vez del amarillo, que
  // desentonaba. Se distingue del blanco de las leídas; el estado no depende
  // de este color: también lo dicen el punto, la negrita y «Sin leer».
  realceSuave: "#EAEAEA",
  bordeRealce: "#C4C4C4",

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

  // US-026: lo que antes iba en hexadecimal fijo en las pantallas.
  /** Las insignias y contadores rojos de pendientes (campana, pestañas,
   * barra, chat, «No leídas») y su número. */
  insignia: "#a91e1e",
  sobreInsignia: "#ffffff",
  /** El círculo de las iniciales (chat): el negro de la marca con las
   * iniciales en `acento`. */
  avatar: "#1E1E1E",
  /** Las burbujas propias del chat: el negro de la marca con texto blanco
   * (16,7:1), lo suave en #C8C8C8 (10,0:1) y el visto de todos en `acento`. */
  burbujaPropia: "#1E1E1E",
  sobreBurbujaPropia: "#ffffff",
  sobreBurbujaPropiaSuave: "#C8C8C8",
  /** El punto de «sin leer» de las notificaciones (16/11/2026): ámbar dorado
   * con borde ámbar oscuro (sobre el gris, el amarillo solo no llega al 3:1). */
  puntoNuevo: "#F59E0B",
  bordePuntoNuevo: "#B45309",
  /** La sombra de lo que flota (botón flotante, barra inferior). */
  sombra: "#000000",
};

/**
 * La paleta oscura (US-026, 17/11/2026), tomada del modo oscuro de la web con
 * la marca LAARCOURIER (`frontend/src/styles/marca.css`, la última capa, sobre
 * `identidad-base.css`): todo en negro y grises, sin azules, y el amarillo como
 * color de acción con letra negra.
 *
 * De la web:
 * - `fondo` #121212 (`--mz-bg`), `superficie` #1C1C1C (`--mz-raised`),
 *   `borde` #2E2E2E, `bordeFuerte` #3D3D3D;
 * - `tinta` y `titulo` #F2F2F2 (`--mz-ink`; en oscuro el título es la tinta),
 *   `tintaSuave` #C4C4C4, `tintaTenue` #9A9A9A;
 * - `primario` (la acción) y `enlace`: el amarillo #FCE200 con letra negra
 *   (`--mz-action` y `--mz-on-action`); `realce` #2E2A0C (`--mz-blue-100`);
 * - la cabecera y la barra van en el negro del menú (`--mz-side-bg` #000000)
 *   con el amarillo de acento;
 * - semánticos de `identidad-base.css`: bien #5FD39C sobre #0F2A1F, aviso
 *   #FF9A71 sobre #301A10, mal #FF8080 sobre #301212, info #7FB3EC sobre
 *   #0F2338. Info sigue azul (como en la clara de la app) para no
 *   confundirse con el amarillo de la acción: la web oscura lo pone amarillo.
 *
 * Ajustes propios de la app (lo mínimo, para AA):
 * - `hundido` #262626 y no #121212: la web dibuja un borde alrededor de lo
 *   hundido en oscuro; en la app los chips y separadores no lo llevan y con
 *   el color del fondo desaparecían.
 * - `bordeControl` #767676 y no #6E6E6E: #6E6E6E sobre `hundido` da 2,97:1.
 *
 * Contrastes medidos (WCAG 2.1):
 * - `tinta` #F2F2F2: 16,7:1 sobre `fondo`, 15,2:1 sobre `superficie`, 13,5:1
 *   sobre `hundido` y 12,9:1 sobre `realce`.
 * - `tintaSuave` #C4C4C4: 10,7:1 sobre `fondo`, 9,8:1 sobre `superficie`,
 *   8,7:1 sobre `hundido`, 8,3:1 sobre `realce`.
 * - `tintaTenue` #9A9A9A: 6,7:1 sobre `fondo`, 6,1:1 sobre `superficie`,
 *   5,4:1 sobre `hundido` y 5,1:1 sobre `realce`.
 * - `primario`/`enlace` #FCE200: 14,3:1 sobre `fondo`, 13,0:1 sobre
 *   `superficie`, 11,5:1 sobre `hundido`, 11,0:1 sobre `realce`; negro sobre
 *   el amarillo (botones): 16,0:1.
 * - Cabecera #000000: blanco 21:1, `acento` 16,0:1, #C8C8C8 12,6:1; con lo
 *   presionado (#2E2E2E), blanco 13,6:1 y #C8C8C8 8,1:1.
 * - `bordeControl` #767676: 4,1:1 sobre `fondo`, 3,8:1 sobre `superficie`,
 *   3,3:1 sobre `hundido` y 3,2:1 sobre `realce`.
 * - bien 8,2:1, aviso 7,9:1, mal 7,1:1 e info 7,3:1 sobre su fondo (y 9,2,
 *   8,2, 7,0 y 7,8:1 sobre `superficie`).
 * - Insignias: `sobreInsignia` negro sobre `insignia` #FF8080: 8,7:1 (blanco
 *   daba 2,6:1); el rojo sobre la cabecera negra, 8,7:1.
 * - Burbuja propia #2E2A0C: #F2F2F2 12,9:1, #C8C8C8 8,6:1, `acento` 11,0:1.
 * - Punto de sin leer #F59E0B: 7,1:1 sobre `realceSuave` #262626.
 */
export const paletaOscura = {
  marcaAmarillo: "#FCE200",
  marcaNegro: "#000000",
  marcaGris: "#E1E1E1",

  primario: "#FCE200",
  sobrePrimario: "#000000",
  cabecera: "#000000",
  sobreCabecera: "#ffffff",
  acento: "#FCE200",
  tintaInactivaOscuro: "#C8C8C8",
  presionadoOscuro: "#2E2E2E",
  enlace: "#FCE200",
  realce: "#2E2A0C",
  realceSuave: "#262626",
  bordeRealce: "#4A4A4A",

  fondo: "#121212",
  superficie: "#1C1C1C",
  hundido: "#262626",
  borde: "#2E2E2E",
  bordeFuerte: "#3D3D3D",
  bordeControl: "#767676",
  titulo: "#F2F2F2",
  tinta: "#F2F2F2",
  tintaSuave: "#C4C4C4",
  tintaTenue: "#9A9A9A",

  bienFondo: "#0F2A1F",
  bienTexto: "#5FD39C",
  avisoFondo: "#301A10",
  avisoTexto: "#FF9A71",
  malFondo: "#301212",
  malTexto: "#FF8080",
  infoFondo: "#0F2338",
  infoTexto: "#7FB3EC",

  // Ronda QA: el número va en negro. Blanco sobre #FF8080 daba 2,6:1.
  insignia: "#FF8080",
  sobreInsignia: "#000000",
  avatar: "#000000",
  burbujaPropia: "#2E2A0C",
  sobreBurbujaPropia: "#F2F2F2",
  sobreBurbujaPropiaSuave: "#C8C8C8",
  puntoNuevo: "#F59E0B",
  bordePuntoNuevo: "#B45309",
  sombra: "#000000",
};

/** La paleta clara, para lo que no depende del render (pruebas, constantes).
 * Las pantallas usan `useColores()`. */
export const colores = paletaClara;

/**
 * La paleta del modo que se ve ahora, para los módulos de formato (tonos de
 * estado, tipos del calendario…) que devuelven colores ya resueltos y se
 * llaman durante el render de componentes que ya escuchan la apariencia. La
 * fija solo `ProveedorDeApariencia`; sin él, la clara.
 *
 * Regla (ronda QA, P3-1): `TONOS`, `ESTADOS`/`estadoDe`/`ESTADOS_REGLA` de
 * permisos, `TIPOS_EN_CALENDARIO`/`tipoDe` y las funciones que los esparcen
 * (`tonoDeEstado`, `estadoDeLaOrden`, `prioridadDe`…) se leen en el render.
 * Todo `memo`, `useMemo` o `useCallback` que los lea debe estar en un
 * componente que consuma el contexto (`useEstilos`, `useColores` o
 * `useApariencia`) y, en un `useMemo`/`useCallback`, tener `esquema` (o
 * `colores`) entre sus dependencias; si no, al cambiar de modo se queda con
 * los colores del anterior. Nunca se guardan en constantes del módulo.
 */
let activa = paletaClara;

export function paletaActiva() {
  return activa;
}

/** Solo para `ProveedorDeApariencia`. */
export function fijarPaletaActiva(paleta) {
  activa = paleta ?? paletaClara;
}

/** El mínimo de las áreas táctiles: 48 dp en Android (Material) y 44 pt en
 * iOS (Human Interface Guidelines). */
export const AREA_TACTIL = Platform.OS === "android" ? 48 : 44;
