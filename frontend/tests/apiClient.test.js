import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El interceptor por el que pasa cada petición del sistema.
 *
 * Es una pieza pequeña y sin pantalla, así que nadie la mira: pone la cabecera
 * de sesión, dice en qué empresa se pregunta, renueva el token cuando vence y
 * decide cuándo la sesión se acabó de verdad. Si se rompe, o la gente pierde la
 * sesión sin motivo o —peor— pide datos sin decir de qué empresa.
 *
 * Se prueba contra el `adapter` de axios y no mockeando el módulo entero: así
 * corre el interceptor de verdad, con sus reintentos y su cola, y lo único
 * simulado es el viaje por la red.
 */

vi.mock("../src/config/env", () => ({
  env: { apiBaseUrl: "http://api.local/api/v1" },
}));

const {
  apiClient,
  setTokens,
  setEmpresaActiva,
  getEmpresaActiva,
  getAccessToken,
} = await import("../src/api/client");

/** Respuesta que el adaptador devolverá, en el formato que axios espera. */
function respuesta(config, status, data = {}) {
  const salida = { status, statusText: "", data, headers: {}, config };
  return status >= 200 && status < 300
    ? Promise.resolve(salida)
    : Promise.reject(
        Object.assign(new Error("http"), { response: salida, config }),
      );
}

const LIMITE_DE_PETICIONES = 8;

let peticiones;
let guionPrincipal;
let guionRefresh;
let navegacion;

beforeEach(() => {
  localStorage.clear();
  peticiones = [];
  navegacion = [];

  // `pendingRefresh` vive en el módulo: se deja limpio entre pruebas dejando
  // que cada una monte su propio guion desde cero.
  guionPrincipal = () => respuesta({}, 200, {});
  guionRefresh = () =>
    respuesta({}, 200, { access: "nuevo", refresh: "refresh-nuevo" });

  // Tope de seguridad del propio banco de pruebas: si el interceptor perdiera
  // su límite de reintento, entraría en un bucle infinito y la suite se
  // colgaría en vez de fallar. Un CI colgado no dice qué se rompió.
  const sinBucle = (config) => {
    if (peticiones.length > LIMITE_DE_PETICIONES) {
      throw new Error(
        `Bucle de reintentos: más de ${LIMITE_DE_PETICIONES} peticiones para una sola llamada.`,
      );
    }
    peticiones.push(config);
  };

  apiClient.defaults.adapter = (config) => {
    sinBucle(config);
    return guionPrincipal(config);
  };
  axios.defaults.adapter = (config) => {
    sinBucle(config);
    return guionRefresh(config);
  };

  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname: "/admin/activos",
      assign: (destino) => navegacion.push(destino),
    },
  });
});

afterEach(() => {
  delete apiClient.defaults.adapter;
  delete axios.defaults.adapter;
});

// --- Lo que va en cada petición ---------------------------------------------

describe("Cabeceras de cada petición", () => {
  it("lleva la sesión cuando hay una", async () => {
    setTokens("token-de-acceso", "token-de-refresco");

    await apiClient.get("/activos/");

    expect(peticiones[0].headers.Authorization).toBe("Bearer token-de-acceso");
  });

  it("no inventa una cabecera de sesión cuando no hay token", async () => {
    await apiClient.get("/activos/");

    expect(peticiones[0].headers.Authorization).toBeUndefined();
  });

  it("dice en qué empresa se pregunta", async () => {
    setEmpresaActiva(3);

    await apiClient.get("/activos/");

    expect(peticiones[0].headers["X-Empresa"]).toBe("3");
  });

  it("sin empresa elegida no manda la cabecera", async () => {
    // El backend resuelve la predeterminada de la cuenta; mandar una vacía
    // haría que pidiera una empresa con id «».
    await apiClient.get("/activos/");

    expect(peticiones[0].headers["X-Empresa"]).toBeUndefined();
  });
});

describe("Cuando el navegador no deja guardar nada", () => {
  /* Ocurre de verdad: una ventana privada, datos de sitio bloqueados o un
     navegador con almacenamiento deshabilitado hacen que `localStorage` lance
     al leerlo. Si eso reventara, la aplicación no abriría en vez de trabajar en
     la empresa predeterminada. */
  it("leer la empresa activa no revienta", async () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("almacenamiento bloqueado");
      },
    });

    try {
      expect(getEmpresaActiva()).toBeNull();
      expect(() => setEmpresaActiva(3)).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });
});

// --- Renovación de la sesión ------------------------------------------------

describe("Cuando el token vence", () => {
  it("renueva y reintenta la petición con el token nuevo", async () => {
    setTokens("vencido", "refresco-bueno");
    let primeraVez = true;
    guionPrincipal = (config) => {
      if (primeraVez) {
        primeraVez = false;
        return respuesta(config, 401);
      }
      return respuesta(config, 200, { ok: true });
    };

    const salida = await apiClient.get("/activos/");

    expect(salida.data).toEqual({ ok: true });
    // La original, la de refresco y el reintento.
    expect(peticiones).toHaveLength(3);
    expect(peticiones[1].url).toContain("/auth/token/refresh/");
    expect(peticiones[2].headers.Authorization).toBe("Bearer nuevo");
    expect(getAccessToken()).toBe("nuevo");
  });

  it("solo lo intenta una vez: si el reintento vuelve a fallar, cierra la sesión", async () => {
    setTokens("vencido", "refresco-bueno");
    guionPrincipal = (config) => respuesta(config, 401);

    await expect(apiClient.get("/activos/")).rejects.toBeTruthy();

    expect(navegacion).toEqual(["/login"]);
    expect(getAccessToken()).toBeNull();
    // Sin el tope, cada 401 dispararía otro refresco y otro reintento: la
    // original, el refresco y un solo reintento, y nada más.
    expect(peticiones).toHaveLength(3);
    expect(peticiones.filter((p) => p.url?.includes("refresh")).length).toBe(1);
  });

  it("si el refresco falla, limpia la sesión y lleva al login", async () => {
    setTokens("vencido", "refresco-caducado");
    guionPrincipal = (config) => respuesta(config, 401);
    guionRefresh = (config) => respuesta(config, 401, { detail: "expirado" });

    await expect(apiClient.get("/activos/")).rejects.toBeTruthy();

    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem("gestion_activos_refresh_token")).toBeNull();
    expect(navegacion).toEqual(["/login"]);
  });

  it("sin token de refresco no intenta renovar nada", async () => {
    setTokens("vencido", null);
    guionPrincipal = (config) => respuesta(config, 401);

    await expect(apiClient.get("/activos/")).rejects.toBeTruthy();

    expect(peticiones.filter((p) => p.url?.includes("refresh"))).toHaveLength(
      0,
    );
    expect(navegacion).toEqual(["/login"]);
  });

  it("dos peticiones que vencen a la vez comparten un solo refresco", async () => {
    /* Sin la cola, abrir una pantalla que pide cuatro cosas dispararía cuatro
       refrescos simultáneos; el backend revoca la sesión al detectar la
       reutilización de un refresh ya rotado, así que el usuario quedaría fuera
       justo por haber abierto una pantalla completa. */
    setTokens("vencido", "refresco-bueno");
    const vencidas = new Set();
    guionPrincipal = (config) => {
      if (!vencidas.has(config.url)) {
        vencidas.add(config.url);
        return respuesta(config, 401);
      }
      return respuesta(config, 200, {});
    };

    await Promise.all([apiClient.get("/activos/"), apiClient.get("/alertas/")]);

    expect(peticiones.filter((p) => p.url?.includes("refresh"))).toHaveLength(
      1,
    );
  });
});

// --- Lo que no debe disparar una renovación ---------------------------------

describe("Lo que el interceptor deja pasar", () => {
  it("un login rechazado no intenta renovar ni redirige", async () => {
    /* Es el bucle clásico: el 401 del propio login dispara un refresco, que
       vuelve a fallar, que redirige al login… donde el usuario ya estaba. */
    guionPrincipal = (config) =>
      respuesta(config, 401, { detail: "credenciales" });

    await expect(
      apiClient.post("/auth/login/", { identifier: "ana", password: "mala" }),
    ).rejects.toBeTruthy();

    expect(peticiones.filter((p) => p.url?.includes("refresh"))).toHaveLength(
      0,
    );
    expect(navegacion).toEqual([]);
  });

  it("un error de red no toca la sesión", async () => {
    setTokens("bueno", "refresco-bueno");
    guionPrincipal = () => Promise.reject(new Error("sin conexión"));

    await expect(apiClient.get("/activos/")).rejects.toThrow("sin conexión");

    expect(getAccessToken()).toBe("bueno");
    expect(navegacion).toEqual([]);
  });

  it("un 403 corriente se propaga tal cual", async () => {
    setTokens("bueno", "refresco-bueno");
    guionPrincipal = (config) =>
      respuesta(config, 403, { error: { code: "permission_denied" } });

    await expect(apiClient.get("/activos/")).rejects.toBeTruthy();

    expect(navegacion).toEqual([]);
    expect(getAccessToken()).toBe("bueno");
  });

  it("el cambio de contraseña obligatorio lleva a su pantalla, no al login", async () => {
    /* Red de seguridad para una pestaña ya abierta: un administrador puede
       activarlo desde otra sesión, y el `user` en memoria no se entera. */
    setTokens("bueno", "refresco-bueno");
    guionPrincipal = (config) =>
      respuesta(config, 403, { error: { code: "password_change_required" } });

    await expect(apiClient.get("/activos/")).rejects.toBeTruthy();

    expect(navegacion).toEqual(["/change-password-required"]);
    expect(getAccessToken()).toBe("bueno");
  });

  it("estando ya en el login no vuelve a navegar al login", async () => {
    window.location.pathname = "/login";
    setTokens("vencido", null);
    guionPrincipal = (config) => respuesta(config, 401);

    await expect(apiClient.get("/activos/")).rejects.toBeTruthy();

    expect(navegacion).toEqual([]);
  });
});
