/*
 * La conducta de sin-conexion.html. Vivía en línea en la página; se sacó a un
 * archivo (auditoría de seguridad, 29/10/2026) para que la CSP del sitio no
 * necesite 'unsafe-inline'. El service worker lo guarda con la página (ARMAZON
 * en sw.js): esta es justo la pantalla que se ve cuando no hay red.
 */
(function () {
  // El tema que la persona eligió en la intranet (utils/appearance.js); con
  // «sistema» o sin nada guardado manda el del equipo (prefers-color-scheme).
  try {
    var modo = window.localStorage.getItem("admin.appearance.mode");
    if (modo === "light" || modo === "dark") {
      document.documentElement.setAttribute("data-theme", modo);
    }
  } catch (e) {
    // Sin almacenamiento disponible se queda el tema del equipo.
  }

  function recargar() {
    location.reload();
  }

  var estado = document.getElementById("estado");
  var boton = document.getElementById("reintentar");
  if (boton) {
    boton.addEventListener("click", function () {
      // Sin esta señal, si sigue sin red la página vuelve igual y parece que
      // el botón no hizo nada.
      if (estado) estado.textContent = "Comprobando…";
      boton.setAttribute("aria-disabled", "true");
      try {
        window.sessionStorage.setItem(
          "sin-conexion.intento",
          new Date().toLocaleTimeString("es-EC", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
      } catch (e) {
        // Sin almacenamiento solo se pierde la hora del último intento.
      }
      recargar();
    });
  }
  try {
    var ultimo = window.sessionStorage.getItem("sin-conexion.intento");
    if (ultimo && estado)
      estado.textContent =
        "Último intento: " + ultimo + ". Sigue sin conexión.";
  } catch (e) {
    // Ídem.
  }

  // Reintenta solo en cuanto el sistema avisa de que volvió la red, para no
  // dejar a alguien pulsando el botón en un pasillo.
  window.addEventListener("online", recargar);
})();
