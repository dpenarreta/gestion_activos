/*
 * Tema claro/oscuro antes del primer pintado.
 *
 * Vivía en línea dentro de index.html. Se sacó a un archivo (auditoría de
 * seguridad, 29/10/2026) para que la Content-Security-Policy del sitio
 * (deploy/iis/web.config) pueda decir `script-src 'self'` sin 'unsafe-inline':
 * con un script en línea permitido, cualquier HTML inyectado podría ejecutar
 * el suyo y leer el token de sesión de localStorage.
 *
 * Se carga en el <head> SIN defer ni async, a propósito: tiene que correr antes
 * de que el navegador pinte el <body>, o la página parpadea en claro antes de
 * pasar a oscuro. Por eso tampoco es un módulo (los módulos siempre se difieren).
 */
(function () {
  try {
    var STORAGE_KEY = "admin.appearance.mode";
    var mode = window.localStorage.getItem(STORAGE_KEY);
    if (["light", "dark", "system"].indexOf(mode) === -1) mode = "system";
    var resolved =
      mode === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : mode;
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.setAttribute("data-bs-theme", resolved);
  } catch {
    // Sin localStorage/matchMedia disponible: se mantiene el modo
    // claro por defecto (sin atributo), sin bloquear la carga.
  }
})();
