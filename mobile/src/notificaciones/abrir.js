import { rutaEnApp } from "./modulosEnApp";

/** Si la notificación está leída. La API manda `leida`; `leida_en` por si
 * acaso (es lo que dice el contrato de US-009). */
export function estaLeida(notificacion) {
  if (typeof notificacion?.leida === "boolean") return notificacion.leida;
  return Boolean(notificacion?.leida_en);
}

/** El ícono del módulo: la API lo manda como `icono`; el contrato lo nombra
 * `modulo_icono`. */
export function iconoDe(notificacion) {
  return notificacion?.icono || notificacion?.modulo_icono || "bell";
}

/**
 * A dónde lleva tocar una notificación (CA-7 y CA-8): a la pantalla de su
 * módulo si ya está en la app, o a su detalle, que ofrece abrirla en el
 * navegador. El detalle es también el destino del push.
 */
export function destinoDeNotificacion(notificacion, mapa) {
  return rutaEnApp(notificacion, mapa) ?? `/notificacion/${notificacion.id}`;
}
