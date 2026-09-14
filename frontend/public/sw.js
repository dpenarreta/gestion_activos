/*
 * Service worker: lo justo para que la aplicación se instale y arranque.
 *
 * La decisión que manda sobre todas las demás es **qué NO se guarda**: ninguna
 * respuesta de la API. Un inventario que enseña lo de ayer es peor que uno que
 * dice «no hay conexión», porque el segundo se nota y el primero no: alguien
 * lee que el equipo está en Quito, viaja, y estaba en Guayaquil desde el
 * martes. Aquí se guarda el armazón —el HTML, el JavaScript, los estilos, los
 * iconos— y nada más.
 *
 * Lo que esto compra hoy es concreto: la aplicación se instala en el teléfono,
 * abre desde la pantalla de inicio sin barra de direcciones y arranca aunque la
 * bodega no tenga señal, para decirlo con sus palabras en vez de con el dinosaurio
 * del navegador. Trabajar sin conexión —capturar lecturas y sincronizarlas
 * después— es otra cosa, y necesita decidir antes qué pasa cuando dos personas
 * inventarían el mismo equipo.
 */

// Sube con cada despliegue que cambie el armazón. Al activarse, borra las
// versiones anteriores: sin esto, el teléfono acumula una copia por despliegue.
const VERSION = "v1";
const CACHE = `activos-armazon-${VERSION}`;

const SIN_CONEXION = "/sin-conexion.html";

//: Lo que se guarda al instalar. Los archivos con hash en el nombre no van
//: aquí: los pone la caché sobre la marcha, y su nombre cambia solo.
const ARMAZON = [
  "/",
  SIN_CONEXION,
  "/manifest.webmanifest",
  "/iconos/icono-192.png",
  "/iconos/icono-512.png",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARMAZON)));
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(
          nombres
            .filter(
              (nombre) =>
                nombre.startsWith("activos-armazon-") && nombre !== CACHE,
            )
            .map((viejo) => caches.delete(viejo)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Si la petición va al backend. Nada de esto se guarda ni se responde de caché. */
function esLaApi(url) {
  return url.pathname.startsWith("/api/");
}

/** Los archivos que Vite publica con un hash en el nombre. */
function tieneHashEnElNombre(url) {
  return url.pathname.startsWith("/assets/");
}

self.addEventListener("fetch", (evento) => {
  const peticion = evento.request;

  // Solo lecturas: un POST que se reintentara desde aquí podría registrar dos
  // veces la misma entrega.
  if (peticion.method !== "GET") return;

  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;
  if (esLaApi(url)) return; // que lo resuelva la red, y si falla, que falle.

  // Navegación: siempre a la red primero, para que un despliegue nuevo se vea
  // al instante. Sin conexión, la página que lo explica.
  if (peticion.mode === "navigate") {
    evento.respondWith(
      fetch(peticion).catch(() =>
        caches
          .match(SIN_CONEXION)
          .then((respuesta) => respuesta ?? Response.error()),
      ),
    );
    return;
  }

  if (tieneHashEnElNombre(url)) {
    evento.respondWith(
      caches.match(peticion).then(
        (guardada) =>
          guardada ??
          fetch(peticion).then((respuesta) => {
            // Solo lo que salió bien: guardar un 404 lo vuelve permanente.
            if (respuesta.ok) {
              const copia = respuesta.clone();
              caches.open(CACHE).then((cache) => cache.put(peticion, copia));
            }
            return respuesta;
          }),
      ),
    );
    return;
  }

  // El resto del armazón —iconos, manifiesto—: lo guardado si está, y si no,
  // la red.
  evento.respondWith(
    caches.match(peticion).then((guardada) => guardada ?? fetch(peticion)),
  );
});
