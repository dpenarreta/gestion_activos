/*
 * Comprueba en un navegador de verdad que la aplicación se instala y que, sin
 * red, dice lo que tiene que decir.
 *
 * Existe porque esto no se puede probar con Vitest ni con el resto de las
 * pruebas de extremo a extremo: el service worker solo se registra sobre la
 * **compilación** —en desarrollo estorba y está apagado a propósito—, así que
 * hace falta construir, servir el resultado y mirar. Son tres pasos que nadie
 * recuerda en el orden correcto, y por eso están aquí.
 *
 *   npm run build
 *   npm run preview -- --port 4179 --strictPort   (en otra terminal)
 *   npm run pwa:verificar
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:4179";

const comprobaciones = [];
function comprobar(que, seCumple, detalle = "") {
  comprobaciones.push({ que, seCumple, detalle });
}

const navegador = await chromium.launch();
const contexto = await navegador.newContext();
const pagina = await contexto.newPage();

try {
  await pagina.goto(`${BASE}/admin`, { waitUntil: "load" });

  const estado = await pagina.evaluate(async () => {
    const registro = await navigator.serviceWorker.getRegistration();
    if (!registro) return "sin registro";
    await navigator.serviceWorker.ready;
    return registro.active ? "activo" : "registrado sin activar";
  });
  comprobar("El service worker queda activo", estado === "activo", estado);

  const manifiesto = await pagina.evaluate(async () => {
    const enlace = document.querySelector('link[rel="manifest"]');
    if (!enlace) return null;
    return (await fetch(enlace.href)).json();
  });
  comprobar(
    "El manifiesto se sirve y declara sus iconos",
    Boolean(manifiesto?.icons?.length >= 2),
    manifiesto
      ? `${manifiesto.name}, ${manifiesto.icons.length} iconos`
      : "no se pudo leer",
  );
  comprobar(
    "Arranca en el panel",
    manifiesto?.start_url === "/admin",
    String(manifiesto?.start_url),
  );

  // Y ahora lo que de verdad importa: qué pasa sin red.
  await contexto.setOffline(true);
  await pagina.goto(`${BASE}/admin/activos`, { waitUntil: "load" });

  const titulo = await pagina.title();
  comprobar(
    "Sin red sale la página que lo explica, no el error del navegador",
    titulo.startsWith("Sin conexión"),
    titulo,
  );

  const api = await pagina.evaluate(async () => {
    try {
      const respuesta = await fetch("/api/v1/activos/");
      return `respondió ${respuesta.status} — ¡se está sirviendo de caché!`;
    } catch {
      return "falló, que es lo correcto";
    }
  });
  comprobar(
    "La API no se sirve nunca de la caché",
    api.startsWith("falló"),
    api,
  );
} finally {
  await navegador.close();
}

let todoBien = true;
for (const { que, seCumple, detalle } of comprobaciones) {
  console.log(
    `${seCumple ? "  OK  " : " FALLA"} ${que}${detalle ? ` (${detalle})` : ""}`,
  );
  todoBien &&= seCumple;
}
console.log(
  todoBien
    ? "\nLa aplicación es instalable."
    : "\nHay comprobaciones sin pasar.",
);
process.exit(todoBien ? 0 : 1);
