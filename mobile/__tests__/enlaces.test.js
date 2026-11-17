import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Alert } from "react-native";

import { MODULOS_EN_APP, rutaEnApp } from "../src/notificaciones/modulosEnApp";
import { destinoDeNotificacion } from "../src/notificaciones/abrir";
import {
  abrirEnNavegador,
  esRutaInterna,
  urlWeb,
  urlWebDeNotificacion,
} from "../src/navegador/enlaceWeb";
import { confirmarSalida, TEXTO_SALIR, TITULO_SALIR } from "../src/navegador/confirmarSalida";

const BASE = "https://intranet.laarcourier.com";

describe("MODULOS_EN_APP", () => {
  it("desde la US-022 trae también «activos», «mantenimientos», «alertas» y «solicitudes», y desde la US-025 «ordenes»; lo demás va al detalle con «Abrir en el navegador»", () => {
    expect(Object.keys(MODULOS_EN_APP)).toEqual([
      "licencias",
      "chat",
      "soporte",
      "matriz",
      "activos",
      "mantenimientos",
      "alertas",
      "solicitudes",
      "ordenes",
    ]);
    // Tanda B de la US-022: «solicitudes» va al detalle de la solicitud de equipo.
    expect(rutaEnApp({ id: 4, modulo: "solicitudes", enlace: "/admin/solicitudes/4" })).toBe("/solicitudes/4");
    expect(destinoDeNotificacion({ id: 4, modulo: "solicitudes", enlace: "/admin/solicitudes/4" })).toBe("/solicitudes/4");
    // US-025: «ordenes» va a la ficha de la orden; lo que no está en la app
    // (Dashboards) sigue yendo al detalle.
    expect(destinoDeNotificacion({ id: 4, modulo: "ordenes", enlace: "/admin/ordenes/lista/9" })).toBe("/ordenes/9");
    expect(destinoDeNotificacion({ id: 4, modulo: "dashboards" })).toBe("/notificacion/4");
    // US-014: la Mesa de ayuda ya no va al detalle de la notificación.
    expect(destinoDeNotificacion({ id: 4, modulo: "soporte", enlace: "/admin/soporte/tickets/9" })).toBe(
      "/soporte/ticket/9",
    );
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

  it("antes de salir de la app pregunta; si se queda, no abre nada ni es un error (16/11/2026)", async () => {
    confirmarSalida.mockResolvedValueOnce(false);
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    expect(await abrirEnNavegador(`${BASE}/c`)).toBeNull();
    expect(Linking.openURL).not.toHaveBeenCalledWith(`${BASE}/c`);
    // Quedarse no muestra «No se pudo abrir».
    expect(alerta).not.toHaveBeenCalled();
    alerta.mockRestore();
  });
});

describe("confirmarSalida", () => {
  const { confirmarSalida: real } = jest.requireActual("../src/navegador/confirmarSalida");

  it("pregunta con «Quedarme en la app» y «Abrir el navegador»", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation((titulo, texto, botones) => {
      botones.find((b) => b.text === "Abrir el navegador").onPress();
    });
    await expect(real()).resolves.toBe(true);
    expect(alerta).toHaveBeenCalledWith(TITULO_SALIR, TEXTO_SALIR, expect.any(Array), expect.objectContaining({ cancelable: true }));
    alerta.mockRestore();
  });

  it("quedarse, tocar fuera o Atrás es no salir", async () => {
    let alerta = jest.spyOn(Alert, "alert").mockImplementation((t, x, botones) => {
      botones.find((b) => b.text === "Quedarme en la app").onPress();
    });
    await expect(real()).resolves.toBe(false);
    alerta.mockRestore();
    alerta = jest.spyOn(Alert, "alert").mockImplementation((t, x, b, opciones) => opciones.onDismiss());
    await expect(real()).resolves.toBe(false);
    alerta.mockRestore();
  });
});
