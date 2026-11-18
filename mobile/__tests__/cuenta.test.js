import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import React from "react";
import { AccessibilityInfo, Alert, View } from "react-native";

import { Cuenta } from "../src/pantallas/Cuenta";
import { coloresClarosEn, olvidarApariencia, renderEnOscuro } from "./utilidades/modoOscuro";

const mockSesion = {
  usuario: {
    username: "ana",
    first_name: "Ana",
    last_name: "Pérez",
    email: "ana@grupolaar.com",
  },
  empresas: [
    { id: 1, nombre: "Laar Courier", roles: ["Colaborador"] },
    { id: 5, nombre: "Laar Express", roles: [] },
  ],
  empresaActiva: { id: 1, nombre: "Laar Courier" },
  cambiarEmpresa: jest.fn(),
  cerrarSesion: jest.fn(async () => {}),
};
jest.mock("../src/sesion/SesionContext", () => ({
  useSesion: () => mockSesion,
}));

jest.mock("../src/api/servicios", () => ({
  dispositivosService: {
    registrar: jest.fn(async () => ({})),
    baja: jest.fn(),
  },
  // US-011: «Mi estado» en el chat.
  chatService: {
    miEstado: jest.fn(async () => ({ estado: "disponible", vigente: null })),
  },
  // 16/11/2026: «Mi perfil» (solo lectura) dentro de la cuenta.
  inicioService: { misDatos: jest.fn(async () => ({})) },
}));

const mockRouter = { push: jest.fn() };
// La cabecera de la pila: «Cerrar sesión» va en `headerRight` (17/11/2026).
const mockCabecera = { headerRight: null, avisar: null };
const mockNavegacion = {
  setOptions: (opciones) => {
    if ("headerRight" in opciones) {
      mockCabecera.headerRight = opciones.headerRight;
      mockCabecera.avisar?.();
    }
  },
};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useNavigation: () => mockNavegacion,
}));

/** La pantalla con lo que pone en la cabecera, como la dibuja la pila. */
function CuentaConCabecera() {
  const [, forzar] = React.useState(0);
  React.useLayoutEffect(() => {
    mockCabecera.avisar = () => forzar((n) => n + 1);
    return () => {
      mockCabecera.avisar = null;
    };
  }, []);
  return (
    <>
      <View testID="cabecera">{mockCabecera.headerRight ? mockCabecera.headerRight() : null}</View>
      <Cuenta />
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Cuenta", () => {
  it("al cambiar de empresa deshabilita las opciones, muestra la espera y anuncia el resultado", async () => {
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    let terminar;
    mockSesion.cambiarEmpresa.mockReturnValue(
      new Promise((r) => {
        terminar = r;
      }),
    );
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    await render(<CuentaConCabecera />);

    await act(async () => {
      fireEvent.press(screen.getByTestId("empresa-5"));
    });
    expect(
      screen.getByTestId("empresa-5").props.accessibilityState,
    ).toMatchObject({ busy: true, disabled: true });
    expect(
      screen.getByTestId("empresa-1").props.accessibilityState,
    ).toMatchObject({ disabled: true });

    await act(async () => terminar(true));
    expect(mockSesion.cambiarEmpresa).toHaveBeenCalledWith(5);
    expect(anuncio).toHaveBeenCalledWith("Ahora trabaja en Laar Express.");
  });

  it("con los avisos activados ofrece abrir los ajustes del teléfono", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    await render(<CuentaConCabecera />);

    expect(
      await screen.findByText(
        "El permiso de avisos está concedido en este teléfono.",
      ),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Abrir los ajustes del teléfono" }),
    );
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it("mientras consulta el permiso muestra un indicador en el bloque «Avisos»", async () => {
    let responder;
    Notifications.getPermissionsAsync.mockReturnValue(
      new Promise((r) => {
        responder = r;
      }),
    );
    await render(<CuentaConCabecera />);
    expect(
      screen.getByLabelText("Consultando el estado de los avisos…"),
    ).toBeTruthy();
    await act(async () => responder({ status: "denied" }));
    expect(
      screen.queryByLabelText("Consultando el estado de los avisos…"),
    ).toBeNull();
  });

  it("sin decidir, «Activar los avisos» va directo a la pregunta del sistema", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    Notifications.getPermissionsAsync.mockResolvedValue({
      status: "undetermined",
      canAskAgain: true,
    });
    Notifications.requestPermissionsAsync.mockResolvedValue({
      status: "granted",
    });
    await render(<CuentaConCabecera />);

    await fireEvent.press(
      await screen.findByRole("button", { name: "Activar los avisos" }),
    );

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(
      alerta.mock.calls.some(([titulo]) => titulo === "¿Activar los avisos?"),
    ).toBe(false);
  });

  it("si cerrar sesión falla, el botón no queda girando", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockSesion.cerrarSesion.mockRejectedValueOnce(new Error("inesperado"));
    await render(<CuentaConCabecera />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Cerrar sesión" }),
    );
    await act(async () => {
      await alerta.mock.calls[0][2]
        .find((b) => b.text === "Cerrar sesión")
        .onPress();
    });

    expect(
      screen.getByRole("button", { name: "Cerrar sesión" }).props
        .accessibilityState,
    ).toMatchObject({
      busy: false,
      disabled: false,
    });
  });

  it("«Cerrar sesión» pide confirmación antes de cerrar", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<CuentaConCabecera />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Cerrar sesión" }),
    );
    expect(mockSesion.cerrarSesion).not.toHaveBeenCalled();

    const botones = alerta.mock.calls[0][2];
    await act(async () => {
      await botones.find((b) => b.text === "Cerrar sesión").onPress();
    });
    expect(mockSesion.cerrarSesion).toHaveBeenCalledTimes(1);
  });
});

describe("«Cerrar sesión» en la cabecera (17/11/2026)", () => {
  it("va en la barra de «Mi perfil» (headerRight) y ya no al final ni dentro de la pantalla", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    await render(<CuentaConCabecera />);
    const boton = await screen.findByRole("button", { name: "Cerrar sesión" });
    expect(screen.getAllByRole("button", { name: "Cerrar sesión" })).toHaveLength(1);
    expect(within(screen.getByTestId("cabecera")).getByRole("button", { name: "Cerrar sesión" })).toBe(boton);
  });
});

describe("«Mi estado» arriba (17/11/2026)", () => {
  it("el bloque del chat va antes del perfil", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    await render(<CuentaConCabecera />);
    await screen.findByRole("header", { name: "Chat" });
    const textos = [];
    const recorrer = (nodo) => {
      if (nodo == null) return;
      if (typeof nodo === "string") return textos.push(nodo);
      if (Array.isArray(nodo)) return nodo.forEach(recorrer);
      (nodo.children ?? []).forEach(recorrer);
    };
    recorrer(screen.toJSON());
    const chat = textos.indexOf("Chat");
    const datos = textos.indexOf("Mis datos");
    expect(chat).toBeGreaterThan(-1);
    if (datos > -1) expect(chat).toBeLessThan(datos);
    // Lo primero con letras de la pantalla (debajo de la cabecera) es «Chat».
    const cabecera = textos.indexOf("Cerrar sesión");
    const primero = textos.findIndex((t, i) => i > cabecera && /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(t));
    expect(textos[primero]).toBe("Chat");
  });
});

describe("Cuenta con una sola empresa (16/11/2026)", () => {
  it("no muestra el bloque «Empresa»", async () => {
    const antes = mockSesion.empresas;
    mockSesion.empresas = [{ id: 1, nombre: "Laar Courier", roles: [] }];
    await render(<CuentaConCabecera />);
    expect(screen.queryByRole("header", { name: "Empresa" })).toBeNull();
    expect(screen.queryByText("Laar Courier")).toBeNull();
    mockSesion.empresas = antes;
  });
});

describe("US-026: modo oscuro", () => {
  afterEach(olvidarApariencia);

  it("la Cuenta en oscuro (CA-5)", async () => {
    const vista = await renderEnOscuro(<Cuenta />);
    expect(await screen.findByTestId("empresa-5")).toBeTruthy();
    expect(coloresClarosEn(vista.toJSON())).toEqual([]);
  });
});
