/**
 * Las reglas de la burbuja de soporte (US-029, 17/11/2026): dónde se ve,
 * quién la ve y a qué altura va. Es código puro (sin React) para probarlo
 * solo; el componente es `BurbujaDeSoporte`.
 *
 * Decisiones del usuario (17/11/2026):
 * - en todas las pantallas autenticadas, salvo en Gestión de Activos (allí
 *   está la burbuja de «Escanear») y en los formularios del propio ticket;
 * - abre «Nuevo ticket» de la Mesa de ayuda, el mismo de la web;
 * - la ve quien puede crear un ticket a su nombre, como en la web (regla
 *   «permisos app = web»): hoy, todos (`PERMISOS_BASE`).
 */
import { rutaDeAltaPropia } from "../soporte/formato";
import { esRutaDeModulo } from "./modulos";

/** Adónde lleva: «Nuevo ticket» a nombre propio (US-014, CA-4). */
export const RUTA_DEL_TICKET_PROPIO = "/soporte/nuevo";

/**
 * Los caminos donde la burbuja no va (CA-2). Cada uno vale por sí y por todo
 * lo que cuelga de él (`/activos` y `/activos/12/editar`):
 * - Gestión de Activos entero: el módulo (`/activos?vista=…`), la ficha, el
 *   escáner, el alta, la edición, los mantenimientos y las solicitudes de
 *   equipos (US-022 y US-023);
 * - los dos formularios del ticket: el propio y el de registrar a nombre de
 *   otra persona;
 * - el inicio de sesión (fuera del layout autenticado ya no se monta; se
 *   deja por si un enlace la abriera dentro).
 *
 * El visor de imágenes, las ventanas y el escáner de series son `Modal`: se
 * pintan en su propia ventana, por encima de la burbuja, y la tapan solos.
 */
export const CAMINOS_SIN_BURBUJA = Object.freeze([
  "/activos",
  "/mantenimientos",
  "/solicitudes",
  RUTA_DEL_TICKET_PROPIO,
  "/soporte/registrar",
  "/login",
]);

/** El camino sin parámetros, sin ancla y sin la barra final. */
function caminoLimpio(ruta) {
  if (typeof ruta !== "string" || !ruta) return "";
  return ruta.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
}

/** Si la ruta es de las que no llevan burbuja (CA-2). */
export function rutaSinBurbuja(ruta) {
  const camino = caminoLimpio(ruta);
  if (!camino) return true;
  return CAMINOS_SIN_BURBUJA.some((c) => camino === c || camino.startsWith(`${c}/`));
}

/**
 * Si la persona puede pedir soporte desde la app (CA-1): el mismo permiso que
 * muestra «Nuevo ticket» en la barra de la Mesa (`soporte.crear` o, sin él,
 * `soporte.mesa_crear`) y la Mesa encendida en la empresa activa. El módulo
 * apagado lo dice el servidor (`modulo_apagado`, `ResumenSoporteContext`).
 */
export function puedePedirSoporte({ permisos, moduloApagado } = {}) {
  // Solo con la Mesa encendida CONOCIDA (`false`): mientras no se sabe
  // (`null`), no se pinta, para que no aparezca y desaparezca con la Mesa
  // apagada (QA-TECH). El resumen nunca deja `null` para siempre
  // (`ResumenSoporteContext`, `ESPERA_MODULO_MS`).
  return rutaDeAltaPropia(permisos ?? []) !== null && moduloApagado === false;
}

/** Todo junto: si la burbuja se pinta. Con el teclado abierto se aparta para
 * no tapar el campo de escribir (CA-3). */
export function muestraLaBurbuja({ ruta, permisos, moduloApagado, teclado } = {}) {
  return !teclado && !rutaSinBurbuja(ruta) && puedePedirSoporte({ permisos, moduloApagado });
}

/** Lo que mide la burbuja (la de `BotonFlotante`) y su margen. */
export const TAMANO_BURBUJA = 60;
export const MARGEN_BURBUJA = 16;
/** El aire entre la burbuja y lo que tiene debajo (otra burbuja o un pie
 * fijo). */
export const SEPARACION_BURBUJA = 12;

/** Lo que se supone que mide la barra de funcionalidades hasta medirla: un
 * botón de 48 y sus márgenes. Solo vale para el primer cuadro. */
export const ALTURA_BARRA_SUPUESTA = 70;

/**
 * La distancia de la burbuja al borde inferior de la pantalla (CA-3).
 *
 * - En las pantallas de los módulos (las pestañas) va sobre la barra de
 *   funcionalidades: su alto medido (que ya incluye el margen del sistema).
 * - En las demás (fichas, conversaciones, formularios, Cuenta), sobre el
 *   margen del sistema (la barra de gestos de Android o el indicador de
 *   inicio de iOS).
 * - `apoyo`: lo que la pantalla con foco tiene fijo abajo a la derecha (la
 *   burbuja de «Nuevo mensaje» del chat, la fila de escribir de una
 *   conversación, el pie de «Nuevo grupo»), medido desde el mismo borde. La
 *   burbuja se apila encima, con `SEPARACION_BURBUJA` de aire: nunca se
 *   superponen.
 */
export function distanciaAlBorde({ ruta, alturaBarra, apoyo, margenSistema } = {}) {
  const enModulo = esRutaDeModulo(caminoLimpio(ruta));
  const sistema = Math.max(0, Number(margenSistema) || 0);
  const barra = alturaBarra == null ? ALTURA_BARRA_SUPUESTA + sistema : Math.max(0, Number(alturaBarra) || 0);
  const base = enModulo ? barra : 0;
  const fijo = Math.max(0, Number(apoyo) || 0);
  if (fijo > 0) return base + fijo + SEPARACION_BURBUJA;
  // En un módulo sin barra (alto 0) también va sobre el margen del sistema.
  return base + (enModulo && base > 0 ? 0 : sistema) + MARGEN_BURBUJA;
}
