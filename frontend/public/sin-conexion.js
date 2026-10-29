/*
 * La conducta de sin-conexion.html. Vivía en línea en la página; se sacó a un
 * archivo (auditoría de seguridad, 29/10/2026) para que la CSP del sitio no
 * necesite 'unsafe-inline'. El service worker lo guarda con la página (ARMAZON
 * en sw.js): esta es justo la pantalla que se ve cuando no hay red.
 */
(function () {
  function recargar() {
    location.reload();
  }

  var boton = document.getElementById("reintentar");
  if (boton) boton.addEventListener("click", recargar);

  // Reintenta solo en cuanto el sistema avisa de que volvió la red, para no
  // dejar a alguien pulsando el botón en un pasillo.
  window.addEventListener("online", recargar);
})();
