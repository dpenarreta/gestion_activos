import { notificacionesService } from "../api/servicios";
import { volverAlModulo } from "../navegacion/abrir";
import { esRutaDeModulo } from "../navegacion/modulos";
import { destinoDeNotificacion, estaLeida } from "./abrir";
import { rutaEnApp } from "./modulosEnApp";

/**
 * Lo que pasa al tocar un aviso de la campana: lo usan la lista de
 * Notificaciones y «Para hoy» del Inicio (US-027, 17/11/2026), para que los
 * dos hagan exactamente lo mismo.
 *
 * - Sin leer: `alMarcarLeida` lo muestra leído enseguida en la pantalla que
 *   lo llama. Si va a otra pantalla de la app, se marca aquí en el servidor y
 *   después se recarga el contador; si va al detalle, lo marca el detalle.
 * - Si lleva a un módulo, vuelve a los de debajo (`volverAlModulo`, US-016)
 *   en lugar de apilar otra copia; si no, abre la pantalla encima.
 */
export function abrirNotificacion({
  notificacion,
  router,
  mapa,
  recargarContador,
  alMarcarLeida,
}) {
  if (!estaLeida(notificacion)) {
    alMarcarLeida?.(notificacion);
    if (rutaEnApp(notificacion, mapa)) {
      notificacionesService
        .leer(notificacion.id)
        .then(() => recargarContador?.())
        .catch(() => {});
    }
  }
  const destino = destinoDeNotificacion(notificacion, mapa);
  if (esRutaDeModulo(destino)) volverAlModulo(router, destino);
  else router.push(destino);
}
