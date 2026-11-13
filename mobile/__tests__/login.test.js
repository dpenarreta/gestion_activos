import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { FALTA_CONTRASENA, FALTA_USUARIO, Login } from "../src/pantallas/Login";

const mockSesion = { iniciarSesion: jest.fn(), aviso: null };
jest.mock("../src/sesion/SesionContext", () => ({
  useSesion: () => mockSesion,
}));

/** Un error del contrato `{"error": {"code", "message", "details"}}`. */
function errorDelContrato(status, code, message) {
  const error = new Error(message);
  error.response = { status, data: { error: { code, message, details: {} } } };
  return error;
}

async function llenar() {
  await fireEvent.changeText(screen.getByTestId("campo-usuario"), "ana.perez");
  await fireEvent.changeText(screen.getByTestId("campo-contrasena"), "secreta");
}

describe("pantalla de login", () => {
  beforeEach(() => {
    mockSesion.iniciarSesion = jest.fn();
    mockSesion.aviso = null;
  });

  it("muestra el mensaje del contrato de errores, sin detalles técnicos", async () => {
    mockSesion.iniciarSesion.mockRejectedValueOnce(
      errorDelContrato(401, "invalid_credentials", "Usuario o contraseña incorrectos."),
    );
    await render(<Login />);
    await llenar();

    await fireEvent.press(screen.getByTestId("boton-entrar"));

    expect(await screen.findByText("Usuario o contraseña incorrectos.")).toBeTruthy();
    expect(screen.queryByText(/invalid_credentials|401/)).toBeNull();
    expect(mockSesion.iniciarSesion).toHaveBeenCalledWith("ana.perez", "secreta");
  });

  it("muestra el aviso del límite de intentos (429)", async () => {
    mockSesion.iniciarSesion.mockRejectedValueOnce(
      errorDelContrato(429, "throttled", "Demasiados intentos. Espere unos minutos."),
    );
    await render(<Login />);
    await llenar();
    await fireEvent.press(screen.getByTestId("boton-entrar"));

    expect(await screen.findByText("Demasiados intentos. Espere unos minutos.")).toBeTruthy();
  });

  it("no permite un segundo envío mientras el primero no termina", async () => {
    let terminar;
    mockSesion.iniciarSesion.mockImplementation(
      () =>
        new Promise((resolver) => {
          terminar = resolver;
        }),
    );
    await render(<Login />);
    await llenar();

    const boton = screen.getByTestId("boton-entrar");
    await fireEvent.press(boton);
    await fireEvent.press(boton);
    await fireEvent(screen.getByTestId("campo-contrasena"), "submitEditing");

    expect(mockSesion.iniciarSesion).toHaveBeenCalledTimes(1);
    expect(boton.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    terminar();
  });

  it("sin usuario o contraseña marca cada campo y no llama a la API", async () => {
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    await render(<Login />);
    await fireEvent.press(screen.getByTestId("boton-entrar"));

    expect(screen.getByText(FALTA_USUARIO)).toBeTruthy();
    expect(screen.getByText(FALTA_CONTRASENA)).toBeTruthy();
    expect(screen.getByTestId("campo-usuario").props["aria-invalid"]).toBe(true);
    expect(screen.getByTestId("campo-usuario").props.accessibilityLabel).toBe(
      `Usuario o correo. Error: ${FALTA_USUARIO}`,
    );
    expect(screen.getByLabelText(`Contraseña. Error: ${FALTA_CONTRASENA}`)).toBeTruthy();
    expect(anuncio).toHaveBeenCalledWith(`${FALTA_USUARIO} ${FALTA_CONTRASENA}`);
    expect(mockSesion.iniciarSesion).not.toHaveBeenCalled();

    // Al escribir, el error de ese campo se va; el del otro sigue.
    await fireEvent.changeText(screen.getByTestId("campo-usuario"), "ana");
    expect(screen.queryByText(FALTA_USUARIO)).toBeNull();
    expect(screen.getByText(FALTA_CONTRASENA)).toBeTruthy();
  });

  it("anuncia el error de la API al lector de pantalla", async () => {
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    mockSesion.iniciarSesion.mockRejectedValueOnce(
      errorDelContrato(401, "invalid_credentials", "Usuario o contraseña incorrectos."),
    );
    await render(<Login />);
    await llenar();
    await fireEvent.press(screen.getByTestId("boton-entrar"));

    await screen.findByText("Usuario o contraseña incorrectos.");
    expect(anuncio).toHaveBeenCalledWith("Usuario o contraseña incorrectos.");
  });

  it("con un 400 de validación muestra el mensaje, no «identifier: …»", async () => {
    const error = new Error("400");
    error.response = {
      status: 400,
      data: {
        error: {
          code: "invalid",
          message: "Usuario o contraseña incorrectos.",
          details: { identifier: ["Este campo es requerido."] },
        },
      },
    };
    mockSesion.iniciarSesion.mockRejectedValueOnce(error);
    await render(<Login />);
    await llenar();
    await fireEvent.press(screen.getByTestId("boton-entrar"));

    expect(await screen.findByText("Usuario o contraseña incorrectos.")).toBeTruthy();
    expect(screen.queryByText(/identifier/)).toBeNull();
  });

  it("dice por qué volvió al login cuando la sesión terminó", async () => {
    mockSesion.aviso = "Su sesión terminó; inicie sesión de nuevo.";
    await render(<Login />);
    expect(screen.getByText("Su sesión terminó; inicie sesión de nuevo.")).toBeTruthy();
  });

  it("muestra y oculta la contraseña", async () => {
    await render(<Login />);
    expect(screen.getByTestId("campo-contrasena").props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByLabelText("Mostrar contraseña"));
    expect(screen.getByTestId("campo-contrasena").props.secureTextEntry).toBe(false);
    expect(screen.getByLabelText("Ocultar contraseña")).toBeTruthy();
  });
});

describe("enlace «¿Olvidó su contraseña?» (Samsung 720×1600, letra grande)", () => {
  it("el texto puede encoger y bajar de línea: nunca se corta", async () => {
    const { StyleSheet } = require("react-native");
    await render(<Login />);
    const texto = screen.getByTestId("enlace-olvido-texto");
    expect(texto.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(texto.props.style)).toMatchObject({ flexShrink: 1 });
    const enlace = screen.getByRole("link", { name: /¿Olvidó su contraseña\?/ });
    expect(StyleSheet.flatten(enlace.props.style)).toMatchObject({ flexDirection: "row", flexWrap: "wrap" });
  });
});
