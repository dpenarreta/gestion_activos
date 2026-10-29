import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * La aplicación instalable (§20).
 *
 * Dos cosas distintas se prueban aquí. La primera es el registro: cuándo se
 * hace y —sobre todo— cuándo no, porque en desarrollo un armazón guardado
 * devuelve el de la sesión anterior después de cada cambio y eso es media hora
 * persiguiendo un fallo que no existe.
 *
 * La segunda es el manifiesto y el service worker como **archivos**. No los
 * ejecuta ningún navegador aquí, así que lo que se sostiene es lo que se puede
 * leer de ellos: que el manifiesto declare lo que un teléfono necesita para
 * ofrecer la instalación, y que el service worker no guarde ni una respuesta
 * de la API. Eso último es la decisión que manda sobre todas las demás: un
 * inventario que enseña lo de ayer es peor que uno que dice «no hay conexión»,
 * porque el segundo se nota y el primero no.
 */

const RAIZ = path.resolve(__dirname, "..");
const leer = (relativa) => fs.readFileSync(path.join(RAIZ, relativa), "utf8");

const { registrarServiceWorker } = await import(
  "../src/pwa/registrarServiceWorker"
);

// --- Cuándo se registra y cuándo no -----------------------------------------

describe("El registro del service worker", () => {
  let registrar;
  let navegador;

  beforeEach(() => {
    registrar = vi.fn(() => Promise.resolve({ scope: "/" }));
    navegador = { serviceWorker: { register: registrar } };
  });

  const https = { protocol: "https:", hostname: "activos.grupolaar.com" };

  it("se registra en producción y sobre HTTPS", async () => {
    await registrarServiceWorker({
      navegador,
      ubicacion: https,
      enProduccion: true,
    });

    expect(registrar).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("en desarrollo no, o se serviría el armazón de la sesión anterior", async () => {
    await registrarServiceWorker({
      navegador,
      ubicacion: https,
      enProduccion: false,
    });

    expect(registrar).not.toHaveBeenCalled();
  });

  it("sobre HTTP no: el navegador tampoco lo permitiría", async () => {
    await registrarServiceWorker({
      navegador,
      ubicacion: { protocol: "http:", hostname: "activos.interno" },
      enProduccion: true,
    });

    expect(registrar).not.toHaveBeenCalled();
  });

  it("salvo en localhost, que cuenta como seguro y sirve para probarlo", async () => {
    await registrarServiceWorker({
      navegador,
      ubicacion: { protocol: "http:", hostname: "localhost" },
      enProduccion: true,
    });

    expect(registrar).toHaveBeenCalled();
  });

  it("un navegador sin soporte no rompe nada", async () => {
    const resultado = await registrarServiceWorker({
      navegador: {},
      ubicacion: https,
      enProduccion: true,
    });

    expect(resultado).toBeNull();
  });

  it("y si el navegador lo rechaza, se calla", async () => {
    /* Modo privado, una política de la empresa: la aplicación funciona igual,
       solo que sin instalarse. Alarmar por eso sería pedirle a quien está
       delante que arregle algo que no le toca. */
    registrar.mockRejectedValue(new Error("no permitido"));

    const resultado = await registrarServiceWorker({
      navegador,
      ubicacion: https,
      enProduccion: true,
    });

    expect(resultado).toBeNull();
  });
});

// --- El manifiesto ----------------------------------------------------------

describe("El manifiesto", () => {
  const manifiesto = JSON.parse(leer("public/manifest.webmanifest"));

  it("declara lo que un teléfono exige para ofrecer la instalación", () => {
    /* Sin `name`, `start_url`, `display` y un icono de 192 y otro de 512, el
       navegador sencillamente no ofrece instalarla, y no dice por qué. */
    expect(manifiesto.name).toBeTruthy();
    expect(manifiesto.short_name.length).toBeLessThanOrEqual(12);
    expect(manifiesto.start_url).toBe("/admin");
    expect(manifiesto.display).toBe("standalone");

    const tamanos = manifiesto.icons.map((icono) => icono.sizes);
    expect(tamanos).toContain("192x192");
    expect(tamanos).toContain("512x512");
  });

  it("trae un icono recortable, que es el que Android usa de verdad", () => {
    /* Sin uno `maskable`, Android mete el cuadrado dentro de un círculo blanco
       y el resultado parece un icono mal puesto. */
    const recortable = manifiesto.icons.find((icono) =>
      (icono.purpose ?? "").includes("maskable"),
    );
    expect(recortable).toBeTruthy();
  });

  it("arranca en el panel y no en la raíz", () => {
    /* La raíz decide a dónde mandar según la sesión; abrir directamente en
       `/admin` deja a cada quien en su primera pantalla. */
    expect(manifiesto.start_url).toBe("/admin");
    expect(manifiesto.scope).toBe("/");
  });

  it("los iconos que nombra existen", () => {
    const rutas = [
      ...manifiesto.icons.map((icono) => icono.src),
      ...manifiesto.shortcuts.flatMap((atajo) =>
        (atajo.icons ?? []).map((icono) => icono.src),
      ),
    ];
    for (const ruta of new Set(rutas)) {
      expect(
        fs.existsSync(path.join(RAIZ, "public", ruta)),
        `falta ${ruta}`,
      ).toBe(true);
    }
  });

  it("los atajos llevan a donde se usa el teléfono", () => {
    /* Un inventario físico se hace con el escáner; quien recibe un equipo mira
       lo suyo. Son los dos usos que justifican llevarla en el bolsillo. */
    const destinos = manifiesto.shortcuts.map((atajo) => atajo.url);
    expect(destinos).toContain("/admin/activos/escaner");
    expect(destinos).toContain("/admin/mis-equipos");
  });

  it("el documento no lleva scripts en línea", () => {
    /* La CSP del sitio no admite 'unsafe-inline' en scripts (auditoría de
       seguridad, 29/10/2026). El tema inicial va en un archivo de public/, y
       sin defer ni async: tiene que correr antes de pintar. */
    const html = leer("index.html");
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    expect(html).toMatch(/<script src="\/tema-inicial\.js"><\/script>/);
    expect(leer("public/tema-inicial.js")).toContain("admin.appearance.mode");
  });

  it("el documento lo enlaza, junto al color de la barra", () => {
    const html = leer("index.html");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('href="/manifest.webmanifest"');
    expect(html).toContain('name="theme-color"');
  });
});

// --- El service worker ------------------------------------------------------

describe("El service worker", () => {
  const codigo = leer("public/sw.js");

  it("no guarda ni responde nada de la API", () => {
    /* La decisión que manda sobre el resto: enseñar el inventario de ayer es
       peor que decir «no hay conexión», porque lo segundo se nota. */
    expect(codigo).toMatch(/pathname\.startsWith\("\/api\//);
    expect(codigo).toMatch(/if \(esLaApi\(url\)\) return;/);
  });

  it("solo interviene en lecturas", () => {
    /* Un POST reintentado desde aquí podría registrar dos veces la misma
       entrega. */
    expect(codigo).toMatch(/peticion\.method !== "GET"/);
  });

  it("va a la red primero al navegar, para que un despliegue nuevo se vea", () => {
    expect(codigo).toMatch(/peticion\.mode === "navigate"/);
    expect(codigo).toMatch(/fetch\(peticion\)\.catch/);
  });

  it("cae en la página que explica la falta de conexión", () => {
    expect(codigo).toContain("/sin-conexion.html");
    expect(fs.existsSync(path.join(RAIZ, "public", "sin-conexion.html"))).toBe(
      true,
    );
  });

  it("borra las versiones anteriores del armazón al activarse", () => {
    /* Sin esto el teléfono acumula una copia del armazón por despliegue. */
    expect(codigo).toMatch(/caches\.delete/);
    expect(codigo).toMatch(/nombre !== CACHE/);
  });

  it("no guarda respuestas con error", () => {
    /* Guardar un 404 lo vuelve permanente hasta el siguiente despliegue. */
    expect(codigo).toMatch(/respuesta\.ok/);
  });
});

describe("La página de sin conexión", () => {
  const html = leer("public/sin-conexion.html");

  it("no depende de nada que haga falta descargar", () => {
    /* Es la única página que tiene que poder dibujarse justamente cuando no
       hay red: una hoja de estilos o una tipografía externa la dejarían en
       blanco. */
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    /* Su único script es propio y el service worker lo guarda con la página:
       sale de la caché igual que ella (auditoría de seguridad, 29/10/2026). */
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
      (coincidencia) => coincidencia[1],
    );
    expect(scripts).toEqual(["/sin-conexion.js"]);
    expect(leer("public/sw.js")).toContain('"/sin-conexion.js"');
  });

  it("no lleva scripts en línea ni manejadores onclick", () => {
    /* La CSP del sitio (deploy/iis/web.config) no admite 'unsafe-inline' en
       scripts: lo escrito en la página no se ejecutaría y el botón no haría
       nada justo cuando hace falta. */
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("dice qué pasa y por qué no se enseña el inventario guardado", () => {
    expect(html).toContain("No hay conexión");
    expect(html).toMatch(/ayer sería peor/);
  });

  it("vuelve sola en cuanto regresa la red", () => {
    /* Para no dejar a alguien pulsando un botón en un pasillo. */
    expect(leer("public/sin-conexion.js")).toMatch(
      /addEventListener\("online"/,
    );
  });
});
