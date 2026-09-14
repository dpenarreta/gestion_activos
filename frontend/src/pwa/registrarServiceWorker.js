/**
 * Registra el service worker que hace instalable la aplicación.
 *
 * Solo en producción y solo sobre HTTPS (o `localhost`, que el navegador trata
 * como seguro). En desarrollo estorbaría: Vite sirve los módulos sin hash y un
 * armazón guardado devolvería el de la sesión anterior después de cada cambio,
 * que es media hora de perseguir un fallo que no existe.
 *
 * Falla en silencio a propósito. Que el navegador no quiera registrarlo —modo
 * privado, una política de la empresa, un `file://`— no rompe nada: la
 * aplicación funciona igual, solo que sin instalarse. Avisar de eso sería
 * alarmar por algo que a quien está delante no le toca arreglar.
 */
export function registrarServiceWorker({
  navegador = typeof navigator !== "undefined" ? navigator : undefined,
  ubicacion = typeof window !== "undefined" ? window.location : undefined,
  enProduccion = import.meta.env.PROD,
} = {}) {
  if (!enProduccion || !navegador?.serviceWorker || !ubicacion) {
    return Promise.resolve(null);
  }
  if (ubicacion.protocol !== "https:" && !esLocal(ubicacion.hostname)) {
    return Promise.resolve(null);
  }
  return navegador.serviceWorker
    .register("/sw.js", { scope: "/" })
    .catch(() => null);
}

function esLocal(hostname) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}
