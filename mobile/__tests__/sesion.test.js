import { act, render, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

import {
  AVISO_CIERRE_SIN_SERVIDOR,
  AVISO_SESION_TERMINADA,
  SesionProvider,
  useSesion,
} from "../src/sesion/SesionContext";

const SecureStore = require("expo-secure-store");
const API = "https://intranet.laarcourier.com/api/v1";

/**
 * Un backend falso. `estado.vigente` es el único access que acepta; con otro
 * responde 401. `estado.refresh` dice qué hace el refresh: `ok`, `401` o
 * `red`. Registra cada petición para revisarla.
 */
function backend(opciones = {}) {
  const estado = {
    vigente: "access-viejo",
    refresh: "ok",
    sinRed: false,
    codigo401: "token_not_valid",
    otrosValidos: new Set(),
    ...opciones,
  };
  const pedidas = [];
  global.fetch = jest.fn(async (url, init) => {
    const ruta = url.replace(API, "").split("?")[0];
    const cuerpo = init.body ? JSON.parse(init.body) : undefined;
    pedidas.push({ ruta, headers: init.headers, cuerpo });
    if (estado.sinRed) throw new TypeError("Network request failed");
    const responder = (status, datos) => ({
      status,
      ok: status >= 200 && status < 300,
      text: async () => (datos === undefined ? "" : JSON.stringify(datos)),
    });
    if (ruta === "/auth/login/") {
      // Otra sesión: su access vale aparte del de la sesión anterior.
      estado.otrosValidos.add("access-login");
      return responder(200, { access: "access-login", refresh: "refresh-login" });
    }
    if (ruta === "/auth/token/refresh/") {
      if (estado.refresh === "red") throw new TypeError("Network request failed");
      if (estado.refresh === "401") {
        return responder(401, { error: { code: "authentication_failed", message: "La sesión ya no es válida." } });
      }
      estado.vigente = "access-nuevo";
      return responder(200, { access: "access-nuevo", refresh: "refresh-nuevo" });
    }
    const access = (init.headers.Authorization || "").replace("Bearer ", "");
    if (access !== estado.vigente && !estado.otrosValidos.has(access)) {
      return responder(401, { error: { code: estado.codigo401, message: "No autorizado." } });
    }
    switch (ruta) {
      case "/empresas/mias/":
        return responder(200, {
          empresas: [
            { id: 1, nombre: "Laar Courier", roles: [] },
            { id: 5, nombre: "Otra", roles: [] },
          ],
          activa: { id: Number(init.headers["X-Empresa"] || 1), nombre: "X" },
          multiempresa: true,
        });
      case "/auth/me/":
        return responder(200, { id: 1, username: "ana", first_name: "Ana", consentimiento: { pendiente: false } });
      case "/notificaciones/dispositivos/baja/":
      case "/auth/logout/":
        return responder(204);
      default:
        return responder(200, {});
    }
  });
  return { estado, pedidas, de: (ruta) => pedidas.filter((p) => p.ruta === ruta) };
}

/** Sesión guardada en el teléfono, con token push. */
function sesionGuardada() {
  SecureStore.__datos.set("ilce_access", "access-viejo");
  SecureStore.__datos.set("ilce_refresh", "refresh-viejo");
  SecureStore.__datos.set("ilce_empresa", "1");
  SecureStore.__datos.set("ilce_push_token", "ExponentPushToken[telefono]");
}

let sesion;
function Espia() {
  sesion = useSesion();
  return null;
}

async function montar() {
  await render(
    <SesionProvider>
      <Espia />
    </SesionProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  SecureStore.__datos.clear();
  sesion = null;
  // Sin permiso: al abrir no se registra ni se pregunta nada.
  Notifications.getPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: false });
});

describe("cerrar sesión a mano", () => {
  it("con el access vencido renueva una vez y llama a la baja y al logout", async () => {
    const servidor = backend();
    sesionGuardada();
    await montar();
    await waitFor(() => expect(sesion.estado).toBe("autenticado"));

    servidor.estado.vigente = "otro"; // el access guardado venció
    servidor.estado.refresh = "ok";
    await act(async () => {
      await sesion.cerrarSesion();
    });

    expect(servidor.de("/auth/token/refresh/")).toHaveLength(1);
    const bajas = servidor.de("/notificaciones/dispositivos/baja/");
    expect(bajas[bajas.length - 1]).toMatchObject({
      cuerpo: { token: "ExponentPushToken[telefono]" },
      headers: expect.objectContaining({ Authorization: "Bearer access-nuevo" }),
    });
    // El refresh se lee después de la baja: ya rotó.
    expect(servidor.de("/auth/logout/")).toEqual([
      expect.objectContaining({
        cuerpo: { refresh: "refresh-nuevo" },
        headers: expect.objectContaining({ Authorization: "Bearer access-nuevo" }),
      }),
    ]);
    expect(sesion.estado).toBe("anonimo");
    expect(sesion.aviso).toBeNull();
    expect(SecureStore.__datos.size).toBe(0);
  });

  it("si al renovar la sesión ya terminó, no dice «Su sesión terminó»: la cerró la persona", async () => {
    const servidor = backend();
    sesionGuardada();
    await montar();
    await waitFor(() => expect(sesion.estado).toBe("autenticado"));

    servidor.estado.vigente = "otro";
    servidor.estado.refresh = "401";
    await act(async () => {
      await sesion.cerrarSesion();
    });

    expect(sesion.estado).toBe("anonimo");
    expect(sesion.aviso).toBeNull();
    expect(SecureStore.__datos.size).toBe(0);
  });

  it("sin red el teléfono queda sin sesión y avisa que la cierre desde la web", async () => {
    const servidor = backend();
    sesionGuardada();
    await montar();
    await waitFor(() => expect(sesion.estado).toBe("autenticado"));

    servidor.estado.sinRed = true;
    await act(async () => {
      await sesion.cerrarSesion();
    });

    expect(servidor.de("/auth/logout/")).toHaveLength(1);
    expect(sesion.estado).toBe("anonimo");
    expect(sesion.aviso).toBe(AVISO_CIERRE_SIN_SERVIDOR);
    expect(SecureStore.__datos.has("ilce_access")).toBe(false);
    expect(SecureStore.__datos.has("ilce_refresh")).toBe(false);
  });
});

describe("cerrar sesión a mano: renovar una sola vez", () => {
  it("sin token push no hay baja, y es el logout el que renueva", async () => {
    const servidor = backend();
    sesionGuardada();
    SecureStore.__datos.delete("ilce_push_token");
    await montar();
    await waitFor(() => expect(sesion.estado).toBe("autenticado"));

    servidor.estado.vigente = "otro";
    await act(async () => {
      await sesion.cerrarSesion();
    });

    expect(servidor.de("/notificaciones/dispositivos/baja/")).toHaveLength(0);
    expect(servidor.de("/auth/token/refresh/")).toHaveLength(1);
    // El reintento tras renovar va con el access nuevo. El cuerpo repite el
    // refresh que había: `LogoutView` revoca la sesión del access y no lo lee.
    const logouts = servidor.de("/auth/logout/");
    expect(logouts).toHaveLength(2);
    expect(logouts[1].headers.Authorization).toBe("Bearer access-nuevo");
    expect(sesion.aviso).toBeNull();
  });

  it("tras una baja, el logout va sin renovar: un 401 ahí no dispara otro refresh", async () => {
    const servidor = backend();
    sesionGuardada();
    await montar();
    await waitFor(() => expect(sesion.estado).toBe("autenticado"));

    // La baja pasa con el access vigente, pero el logout encuentra un 401.
    const fetchOriginal = global.fetch;
    global.fetch = jest.fn(async (url, init) =>
      url.endsWith("/auth/logout/")
        ? { status: 401, ok: false, text: async () => JSON.stringify({ error: { code: "authentication_failed" } }) }
        : fetchOriginal(url, init),
    );
    await act(async () => {
      await sesion.cerrarSesion();
    });

    expect(servidor.de("/auth/token/refresh/")).toHaveLength(0);
    expect(sesion.estado).toBe("anonimo");
    expect(sesion.aviso).toBeNull();
  });
});

describe("cerrar sesión sin red (O-A)", () => {
  it("deja de recibir push localmente y guarda una baja pendiente", async () => {
    const servidor = backend();
    sesionGuardada();
    await montar();
    await waitFor(() => expect(sesion.estado).toBe("autenticado"));

    servidor.estado.sinRed = true;
    await act(async () => {
      await sesion.cerrarSesion();
    });

    expect(sesion.aviso).toBe(AVISO_CIERRE_SIN_SERVIDOR);
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(JSON.parse(SecureStore.__datos.get("ilce_cierre_pendiente"))).toEqual({
      refresh: "refresh-viejo",
      token: "ExponentPushToken[telefono]",
    });
    // La sesión del teléfono sí se borró.
    expect(SecureStore.__datos.has("ilce_access")).toBe(false);
    expect(SecureStore.__datos.has("ilce_push_token")).toBe(false);
  });

  it("al volver a entrar envía la baja y el logout pendientes y después registra el teléfono de nuevo", async () => {
    const servidor = backend();
    sesionGuardada();
    await montar();
    await waitFor(() => expect(sesion.estado).toBe("autenticado"));
    servidor.estado.sinRed = true;
    await act(async () => {
      await sesion.cerrarSesion();
    });

    // Vuelve la red y la persona entra otra vez, con el permiso concedido.
    servidor.estado.sinRed = false;
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: "ExponentPushToken[nuevo]" });
    await act(async () => {
      await sesion.iniciarSesion("ana", "secreta");
    });
    await waitFor(() => expect(servidor.de("/notificaciones/dispositivos/")).toHaveLength(1));

    const orden = servidor.pedidas.map((p) => p.ruta);
    const pendienteRefresh = servidor
      .de("/auth/token/refresh/")
      .find((p) => p.cuerpo.refresh === "refresh-viejo");
    expect(pendienteRefresh).toBeTruthy();
    const ultimaBaja = servidor.de("/notificaciones/dispositivos/baja/").pop();
    expect(ultimaBaja.cuerpo).toEqual({ token: "ExponentPushToken[telefono]" });
    expect(servidor.de("/auth/logout/").pop().cuerpo).toEqual({ refresh: "refresh-nuevo" });
    // La baja pendiente va antes del registro nuevo.
    expect(orden.lastIndexOf("/notificaciones/dispositivos/baja/")).toBeLessThan(
      orden.indexOf("/notificaciones/dispositivos/"),
    );
    expect(servidor.de("/notificaciones/dispositivos/")[0].cuerpo).toMatchObject({
      token: "ExponentPushToken[nuevo]",
      plataforma: expect.any(String),
    });
    expect(SecureStore.__datos.has("ilce_cierre_pendiente")).toBe(false);
    expect(SecureStore.__datos.get("ilce_push_token")).toBe("ExponentPushToken[nuevo]");
  });

  it("si la sesión anterior ya terminó en el servidor (refresh 401), olvida la baja pendiente", async () => {
    backend({ refresh: "401" });
    SecureStore.__datos.set(
      "ilce_cierre_pendiente",
      JSON.stringify({ refresh: "refresh-viejo", token: "ExponentPushToken[telefono]" }),
    );
    await montar();

    await waitFor(() => expect(SecureStore.__datos.has("ilce_cierre_pendiente")).toBe(false));
    expect(sesion.estado).toBe("anonimo");
  });

  it("sin red al abrir, la baja pendiente se conserva para otro intento", async () => {
    const servidor = backend({ sinRed: true });
    SecureStore.__datos.set(
      "ilce_cierre_pendiente",
      JSON.stringify({ refresh: "refresh-viejo", token: "ExponentPushToken[telefono]" }),
    );
    await montar();

    await waitFor(() => expect(servidor.de("/auth/token/refresh/")).toHaveLength(1));
    expect(SecureStore.__datos.has("ilce_cierre_pendiente")).toBe(true);
  });
});

describe("fin de sesión forzado por el servidor", () => {
  it("da de baja el push con el access anterior, sin renovar otra vez, borra todo y avisa", async () => {
    // Revocada: el access no vale y el refresh tampoco.
    const servidor = backend({ vigente: "ninguno", refresh: "401", codigo401: "authentication_failed" });
    sesionGuardada();
    await montar();

    await waitFor(() => expect(sesion.estado).toBe("anonimo"));
    expect(sesion.aviso).toBe(AVISO_SESION_TERMINADA);
    const bajas = servidor.de("/notificaciones/dispositivos/baja/");
    expect(bajas).toHaveLength(1);
    expect(bajas[0].headers.Authorization).toBe("Bearer access-viejo");
    // Una sola renovación: la del /me; la baja va sin renovar.
    expect(servidor.de("/auth/token/refresh/")).toHaveLength(1);
    expect(SecureStore.__datos.size).toBe(0);
  });

  it("con session_idle_timeout no intenta renovar", async () => {
    const servidor = backend({ vigente: "ninguno", codigo401: "session_idle_timeout" });
    sesionGuardada();
    await montar();

    await waitFor(() => expect(sesion.estado).toBe("anonimo"));
    expect(servidor.de("/auth/token/refresh/")).toHaveLength(0);
    expect(sesion.aviso).toBe(AVISO_SESION_TERMINADA);
  });

  it("si el refresh falla por red, no cierra: queda «sin conexión» con la sesión guardada", async () => {
    backend({ vigente: "otro", refresh: "red" });
    sesionGuardada();
    await montar();

    await waitFor(() => expect(sesion.estado).toBe("sin_conexion"));
    expect(SecureStore.__datos.get("ilce_refresh")).toBe("refresh-viejo");
  });
});

describe("cambio de empresa", () => {
  it("manda la nueva empresa en X-Empresa y avisa a las pantallas", async () => {
    const servidor = backend();
    sesionGuardada();
    await montar();
    await waitFor(() => expect(sesion.estado).toBe("autenticado"));
    const version = sesion.versionEmpresa;

    await act(async () => {
      await sesion.cambiarEmpresa(5);
    });

    expect(sesion.versionEmpresa).toBe(version + 1);
    expect(SecureStore.__datos.get("ilce_empresa")).toBe("5");
    const ultimaMe = servidor.de("/auth/me/").pop();
    expect(ultimaMe.headers["X-Empresa"]).toBe("5");
  });

  it("desde un push solo cambia si la empresa es de la persona", async () => {
    backend();
    sesionGuardada();
    await montar();
    await waitFor(() => expect(sesion.estado).toBe("autenticado"));

    let resultado;
    await act(async () => {
      resultado = await sesion.cambiarEmpresaSiEsSuya("99");
    });
    expect(resultado).toBe(false);
    expect(SecureStore.__datos.get("ilce_empresa")).toBe("1");

    await act(async () => {
      resultado = await sesion.cambiarEmpresaSiEsSuya("5");
    });
    expect(resultado).toBe(true);
    expect(SecureStore.__datos.get("ilce_empresa")).toBe("5");
  });
});
