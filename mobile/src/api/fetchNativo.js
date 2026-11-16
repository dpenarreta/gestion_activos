import { fetch as fetchDeWhatwg } from "whatwg-fetch";

/**
 * El `fetch` de React Native (el polyfill `whatwg-fetch` sobre su
 * `XMLHttpRequest`), y no el que pone Expo como global (16/11/2026).
 *
 * Desde Expo 58, `expo/src/winter/runtime.native.ts` reemplaza el `fetch`
 * global por `expo/fetch`, que no acepta los archivos con `uri` en un
 * `FormData` (`{uri, name, type}`, el formato de React Native): falla con
 * «Unsupported FormDataPart implementation» antes de salir del teléfono. Así
 * dejaron de subir el respaldo de los permisos, los archivos del chat, los
 * adjuntos de la Mesa de ayuda y los de activos (hallazgo de las pruebas con
 * datos de la US-023).
 *
 * El polyfill de React Native sí envía esas partes con su `uri`, y es el mismo
 * con el que la app se escribió y se probó. Se importa directo del paquete
 * para no depender de en qué orden Expo y React Native instalan sus globales.
 */
export const fetchNativo = fetchDeWhatwg;
