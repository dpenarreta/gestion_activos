import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { MODULOS_EN_APP, rutaEnApp } from "../src/notificaciones/modulosEnApp";
import { destinoDeNotificacion } from "../src/notificaciones/abrir";
import {
  abrirEnNavegador,
  esRutaInterna,
  urlWeb,
  urlWebDeNotificacion,
} from "../src/navegador/enlaceWeb";

const BASE = "https://intranet.laarcourier.com";

describe("MODULOS_EN_APP", () => {
  it("desde la Fase 3 trae «licencias» y «chat»; lo demás va al detalle con «Abrir en el navegador»", () => {
    expect(Object.keys(MODULOS_EN_APP)).toEqual(["licencias", "chat"]);
    expect(rutaEnApp({ id: 4, modulo: "soporte", enlace: "/admin/ayuda/4" })).toBeNull();
    expect(destinoDeNotificacion({ id: 4, modulo: "soporte" })).toBe("/notificacion/4");
  });

  it("con un módulo ficticio en el mapa, lleva a su pantalla", () => {
    const mapa = {
      ficticio: "/ficticio",
      conId: (n) => `/con-id/${n.id}`,
    };
    expect(rutaEnApp({ id: 1, modulo: "ficticio" }, mapa)).toBe("/ficticio");
    expect(destinoDeNotificacion({ id: 7, modulo: "conId" }, mapa)).toBe("/con-id/7");
    expect(destinoDeNotificacion({ id: 8, modulo: "soporte" }, mapa)).toBe("/notificacion/8");
  });

  it("no confunde propiedades heredadas con módulos", () => {
    expect(rutaEnApp({ id: 1, modulo: "toString" }, {})).toBeNull();
  });
});

describe("enlace a la web", () => {
  it.each([
    ["/admin/ayuda/5", true],
    ["/admin/ayuda?vista=mios", true],
    ["", false],
    [null, false],
    ["admin/ayuda", false],
    ["//otro.com/x", false],
    ["/\\otro.com", false],
    ["https://otro.com", false],
    ["/con espacio", false],
    ["javascript:alert(1)", false],
  ])("%p es ruta interna: %p", (ruta, esperado) => {
    expect(esRutaInterna(ruta)).toBe(esperado);
  });

  it("arma la URL con la web base y la empresa", () => {
    expect(urlWeb("/admin/ayuda/5", { base: BASE })).toBe(`${BASE}/admin/ayuda/5`);
    expect(urlWeb("/admin/ayuda/5", { empresa: 2, base: BASE })).toBe(
      `${BASE}/admin/ayuda/5?empresa=2`,
    );
    expect(urlWeb("/admin/ayuda?vista=mios#t", { empresa: "3", base: BASE })).toBe(
      `${BASE}/admin/ayuda?vista=mios&empresa=3#t`,
    );
    // Una empresa que no es un número no se pega a la URL.
    expect(urlWeb("/x", { empresa: "1&y=2", base: BASE })).toBe(`${BASE}/x`);
  });

  it("toma el enlace y la empresa de la notificación; sin enlace válido no hay URL", () => {
    expect(urlWebDeNotificacion({ enlace: "/admin/ordenes/9", empresa: { id: 4 } }, BASE)).toBe(
      `${BASE}/admin/ordenes/9?empresa=4`,
    );
    expect(urlWebDeNotificacion({ enlace: "" }, BASE)).toBeNull();
    expect(urlWebDeNotificacion({ enlace: "//malo.com" }, BASE)).toBeNull();
  });

  it("abre en el navegador del sistema y, si falla, dentro de la app", async () => {
    await abrirEnNavegador(`${BASE}/a`);
    expect(Linking.openURL).toHaveBeenCalledWith(`${BASE}/a`);

    Linking.openURL.mockRejectedValueOnce(new Error("sin navegador"));
    await abrirEnNavegador(`${BASE}/b`);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(`${BASE}/b`);
  });
});
