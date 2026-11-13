import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { AccessibilityInfo, Alert } from "react-native";

import { Cuenta } from "../src/pantallas/Cuenta";

const mockSesion = {
  usuario: { username: "ana", first_name: "Ana", last_name: "Pérez", email: "ana@grupolaar.com" },
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
  dispositivosService: { registrar: jest.fn(async () => ({})), baja: jest.fn() },
  // US-011: «Mi estado» en el chat.
  chatService: { miEstado: jest.fn(async () => ({ estado: "disponible", vigente: null })) },
}));

const mockRouter = { push: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));

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
    await render(<Cuenta />);

    await act(async () => {
      fireEvent.press(screen.getByTestId("empresa-5"));
    });
    expect(screen.getByTestId("empresa-5").props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(screen.getByTestId("empresa-1").props.accessibilityState).toMatchObject({ disabled: true });

    await act(async () => terminar(true));
    expect(mockSesion.cambiarEmpresa).toHaveBeenCalledWith(5);
    expect(anuncio).toHaveBeenCalledWith("Ahora trabaja en Laar Express.");
  });

  it("con los avisos activados ofrece abrir los ajustes del teléfono", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    await render(<Cuenta />);

    expect(await screen.findByText("El permiso de avisos está concedido en este teléfono.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Abrir los ajustes del teléfono" }));
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it("mientras consulta el permiso muestra un indicador en el bloque «Avisos»", async () => {
    let responder;
    Notifications.getPermissionsAsync.mockReturnValue(
      new Promise((r) => {
        responder = r;
      }),
    );
    await render(<Cuenta />);
    expect(screen.getByLabelText("Consultando el estado de los avisos…")).toBeTruthy();
    await act(async () => responder({ status: "denied" }));
    expect(screen.queryByLabelText("Consultando el estado de los avisos…")).toBeNull();
  });

  it("sin decidir, «Activar los avisos» va directo a la pregunta del sistema", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "undetermined", canAskAgain: true });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: "granted" });
    await render(<Cuenta />);

    await fireEvent.press(await screen.findByRole("button", { name: "Activar los avisos" }));

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(alerta.mock.calls.some(([titulo]) => titulo === "¿Activar los avisos?")).toBe(false);
  });

  it("si cerrar sesión falla, el botón no queda girando", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockSesion.cerrarSesion.mockRejectedValueOnce(new Error("inesperado"));
    await render(<Cuenta />);

    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
    await act(async () => {
      await alerta.mock.calls[0][2].find((b) => b.text === "Cerrar sesión").onPress();
    });

    expect(screen.getByRole("button", { name: "Cerrar sesión" }).props.accessibilityState).toMatchObject({
      busy: false,
      disabled: false,
    });
  });

  it("«Cerrar sesión» pide confirmación antes de cerrar", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<Cuenta />);

    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(mockSesion.cerrarSesion).not.toHaveBeenCalled();

    const botones = alerta.mock.calls[0][2];
    await act(async () => {
      await botones.find((b) => b.text === "Cerrar sesión").onPress();
    });
    expect(mockSesion.cerrarSesion).toHaveBeenCalledTimes(1);
  });
});
