import * as Notifications from "expo-notifications";
import { Alert, Platform } from "react-native";

import { almacen } from "../src/api/almacen";
import { dispositivosService } from "../src/api/servicios";
import {
  darDeBajaDispositivo,
  empresaDelPush,
  idDeNotificacionDelPush,
  registrarDispositivo,
} from "../src/notificaciones/push";

jest.mock("../src/api/servicios", () => ({
  dispositivosService: {
    registrar: jest.fn(async () => ({ id: 1, creado: true })),
    baja: jest.fn(async () => null),
  },
}));

const SecureStore = require("expo-secure-store");

/** Responde las alertas como lo haría la persona: `respuestas[titulo]` es el
 * texto del botón que pulsa. */
function responderAlertas(respuestas) {
  return jest.spyOn(Alert, "alert").mockImplementation((titulo, _texto, botones) => {
    const boton = botones?.find((b) => b.text === respuestas[titulo]);
    boton?.onPress?.();
  });
}

const alertas = (espia, titulo) => espia.mock.calls.filter(([t]) => t === titulo).length;

beforeEach(async () => {
  jest.clearAllMocks();
  SecureStore.__datos.clear();
  await almacen.cargar();
  await almacen.guardarTokens("access", "refresh");
  Platform.OS = "android";
  Notifications.getPermissionsAsync.mockResolvedValue({ status: "undetermined", canAskAgain: true });
  Notifications.requestPermissionsAsync.mockResolvedValue({ status: "granted" });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("registro del push", () => {
  it("antes de pedir el permiso lo explica; con «Ahora no» no pregunta al sistema", async () => {
    const espia = responderAlertas({ "¿Activar los avisos?": "Ahora no" });

    const resultado = await registrarDispositivo({ pedirPermiso: true });

    expect(resultado).toEqual({ estado: "pospuesto" });
    expect(alertas(espia, "¿Activar los avisos?")).toBe(1);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(dispositivosService.registrar).not.toHaveBeenCalled();
  });

  it("con el permiso denegado no registra nada y lo explica una sola vez", async () => {
    const espia = responderAlertas({ "¿Activar los avisos?": "Continuar" });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: "denied" });

    const primera = await registrarDispositivo({ pedirPermiso: true });
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: false });
    const segunda = await registrarDispositivo({ pedirPermiso: true });

    expect(primera).toEqual({ estado: "denegado" });
    expect(segunda).toEqual({ estado: "denegado" });
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(dispositivosService.registrar).not.toHaveBeenCalled();
    expect(alertas(espia, "Avisos desactivados")).toBe(1);
    // El canal «default» se crea antes de pedir el permiso (Android 13+).
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith("default", expect.any(Object));
  });

  it("al abrir la app con sesión guardada no pregunta nada", async () => {
    const espia = responderAlertas({});
    const resultado = await registrarDispositivo();

    expect(resultado).toEqual({ estado: "sin_decidir" });
    expect(espia).not.toHaveBeenCalled();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("con el permiso concedido registra el token, la plataforma y el modelo genérico", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });

    const resultado = await registrarDispositivo();

    expect(resultado.estado).toBe("registrado");
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "proyecto-de-prueba" });
    expect(dispositivosService.registrar).toHaveBeenCalledWith({
      token: "ExponentPushToken[prueba]",
      plataforma: "android",
      nombre: "Pixel 7",
    });
    expect(almacen.pushToken()).toBe("ExponentPushToken[prueba]");
  });

  it("no guarda el token si la sesión se cerró mientras se registraba", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    dispositivosService.registrar.mockImplementationOnce(async () => {
      await almacen.guardarTokens(null, null);
      return { id: 1, creado: true };
    });

    await expect(registrarDispositivo()).resolves.toEqual({ estado: "sin_sesion" });
    expect(almacen.pushToken()).toBeNull();
  });

  it("un 409 dispositivo_en_conflicto es un fallo más: sin aviso, sin guardar el token", async () => {
    const espia = responderAlertas({});
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    const conflicto = new Error("409");
    conflicto.response = {
      status: 409,
      data: {
        error: {
          code: "dispositivo_en_conflicto",
          message: "No se pudo registrar el teléfono para avisos. Intente de nuevo en un momento.",
        },
      },
    };
    dispositivosService.registrar.mockRejectedValueOnce(conflicto);
    jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(registrarDispositivo()).resolves.toEqual({ estado: "error" });
    expect(espia).not.toHaveBeenCalled();
    expect(almacen.pushToken()).toBeNull();

    // Se reintenta en el siguiente arranque (o al rotar el token) y entonces entra.
    await expect(registrarDispositivo()).resolves.toMatchObject({ estado: "registrado" });
    expect(almacen.pushToken()).toBe("ExponentPushToken[prueba]");
  });

  it("con explicar: false (el botón de Cuenta) pregunta directo al sistema", async () => {
    const espia = responderAlertas({});
    await registrarDispositivo({ pedirPermiso: true, explicar: false });
    expect(alertas(espia, "¿Activar los avisos?")).toBe(0);
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("si Expo no da el token (Expo Go, sin red) la app sigue sin push", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    Notifications.getExpoPushTokenAsync.mockRejectedValueOnce(new Error("sin FCM"));
    jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(registrarDispositivo()).resolves.toEqual({ estado: "error" });
    expect(dispositivosService.registrar).not.toHaveBeenCalled();
  });
});

describe("baja del push", () => {
  it("da de baja el token guardado y lo olvida aunque la API responda 401", async () => {
    await almacen.guardarPushToken("ExponentPushToken[abc]");
    const error = new Error("401");
    error.response = { status: 401 };
    dispositivosService.baja.mockRejectedValueOnce(error);

    await expect(darDeBajaDispositivo()).resolves.toBe("sin_sesion");

    // Al cerrar sesión a mano no se pasa `sinRenovar`: puede renovar.
    expect(dispositivosService.baja).toHaveBeenCalledWith("ExponentPushToken[abc]", undefined);
    expect(almacen.pushToken()).toBeNull();
  });

  it("sin red lo informa como temporal", async () => {
    await almacen.guardarPushToken("ExponentPushToken[abc]");
    const error = new Error("red");
    error.esDeRed = true;
    dispositivosService.baja.mockRejectedValueOnce(error);

    await expect(darDeBajaDispositivo()).resolves.toBe("temporal");
  });

  it("sin token registrado no llama a la API", async () => {
    await expect(darDeBajaDispositivo()).resolves.toBe("sin_token");
    expect(dispositivosService.baja).not.toHaveBeenCalled();
  });
});

describe("datos del push", () => {
  const con = (data) => ({ notification: { request: { content: { data } } } });

  it("lee solo un notificacion_id numérico", () => {
    expect(idDeNotificacionDelPush(con({ notificacion_id: 42, modulo: "soporte" }))).toBe("42");
    expect(idDeNotificacionDelPush(con({ notificacion_id: "../x" }))).toBeNull();
    expect(idDeNotificacionDelPush(con({}))).toBeNull();
    expect(idDeNotificacionDelPush(null)).toBeNull();
  });

  it("lee la empresa (id o null)", () => {
    expect(empresaDelPush(con({ notificacion_id: 1, empresa: 3 }))).toBe("3");
    expect(empresaDelPush(con({ notificacion_id: 1, empresa: null }))).toBeNull();
    expect(empresaDelPush(con({ notificacion_id: 1, empresa: "x" }))).toBeNull();
  });
});
