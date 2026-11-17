import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { almacen } from "../src/api/almacen";
import { temaService } from "../src/api/servicios";
import { FALTA_CONTRASENA, FALTA_USUARIO, Login, TEXTO_RECORDAR_USUARIO } from "../src/pantallas/Login";
import { textosDeAcceso, TEXTOS_ACCESO_POR_DEFECTO } from "../src/sesion/textosDeAcceso";
import {
  DIAS_RECORDADO,
  leerUsuarioRecordado,
  recordarUsuario,
} from "../src/sesion/usuarioRecordado";

const mockSesion = { iniciarSesion: jest.fn(), aviso: null };
jest.mock("../src/sesion/SesionContext", () => ({
  useSesion: () => mockSesion,
}));
jest.mock("../src/api/servicios", () => ({
  temaService: { actual: jest.fn() },
}));

const DIA_MS = 24 * 60 * 60 * 1000;

// Cada prueba empieza sin usuario recordado ni textos guardados, y con el
// tema sin responder (como sin red).
beforeEach(async () => {
  await almacen.guardarUsuarioRecordado(null);
  await almacen.guardarTextosDeAcceso(null);
  temaService.actual.mockReset();
  temaService.actual.mockImplementation(() => new Promise(() => {}));
});

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
      `Usuario, correo o código de empleado. Error: ${FALTA_USUARIO}`,
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

describe("US-028 · CA-4: título y subtítulo del tema", () => {
  it("sin tema (o mientras llega) muestra los textos de siempre", async () => {
    await render(<Login />);
    expect(screen.getByTestId("titulo-acceso").props.children).toBe("Acceso al sistema");
    expect(screen.getByTestId("subtitulo-acceso").props.children).toBe("Ingrese con su usuario corporativo.");
  });

  it("usa acceso_titulo y acceso_subtitulo del tema y los guarda para la próxima vez", async () => {
    temaService.actual.mockResolvedValue({
      site_name: "Intranet",
      acceso_titulo: "Bienvenido a LAARCOURIER",
      acceso_subtitulo: "Use su cuenta de la empresa.",
    });
    await render(<Login />);
    expect(await screen.findByText("Bienvenido a LAARCOURIER")).toBeTruthy();
    expect(screen.getByText("Use su cuenta de la empresa.")).toBeTruthy();
    expect(temaService.actual).toHaveBeenCalledTimes(1);
    expect(almacen.textosDeAcceso()).toEqual({
      acceso_titulo: "Bienvenido a LAARCOURIER",
      acceso_subtitulo: "Use su cuenta de la empresa.",
    });
  });

  it("si el pedido falla, muestra el último texto guardado desde el primer dibujo (no salta)", async () => {
    await almacen.guardarTextosDeAcceso({ acceso_titulo: "Título guardado", acceso_subtitulo: "Subtítulo guardado" });
    temaService.actual.mockRejectedValue(new Error("sin red"));
    await render(<Login />);
    expect(screen.getByTestId("titulo-acceso").props.children).toBe("Título guardado");
    expect(screen.getByTestId("subtitulo-acceso").props.children).toBe("Subtítulo guardado");
    await act(async () => {});
    expect(screen.getByTestId("titulo-acceso").props.children).toBe("Título guardado");
    expect(screen.queryByText("Acceso al sistema")).toBeNull();
  });

  it("si faltan los campos o el título viene vacío, los de siempre; un subtítulo vaciado a propósito no se muestra (como la web)", () => {
    expect(textosDeAcceso(null)).toEqual({
      titulo: TEXTOS_ACCESO_POR_DEFECTO.acceso_titulo,
      subtitulo: TEXTOS_ACCESO_POR_DEFECTO.acceso_subtitulo,
    });
    expect(textosDeAcceso({ site_name: "x" })).toEqual({
      titulo: "Acceso al sistema",
      subtitulo: "Ingrese con su usuario corporativo.",
    });
    expect(textosDeAcceso({ acceso_titulo: "  ", acceso_subtitulo: 3 })).toEqual({
      titulo: "Acceso al sistema",
      subtitulo: "Ingrese con su usuario corporativo.",
    });
    expect(textosDeAcceso({ acceso_titulo: "Hola", acceso_subtitulo: "" }).subtitulo).toBe("");
  });

  it("con el subtítulo vaciado en la web, la pantalla no lo dibuja", async () => {
    temaService.actual.mockResolvedValue({ acceso_titulo: "Hola", acceso_subtitulo: "" });
    await render(<Login />);
    expect(await screen.findByText("Hola")).toBeTruthy();
    expect(screen.queryByTestId("subtitulo-acceso")).toBeNull();
  });

  it("el tema se pide sin token ni renovación: el endpoint es público", () => {
    const servicios = jest.requireActual("../src/api/servicios");
    const { api } = jest.requireActual("../src/api/api");
    const get = jest.spyOn(api, "get").mockResolvedValue({});
    servicios.temaService.actual();
    expect(get).toHaveBeenCalledWith("/theme/current/", { sinToken: true, sinRenovar: true });
    get.mockRestore();
  });
});

describe("US-028 · CA-5: recordar el usuario 30 días", () => {
  it("al entrar con éxito recuerda el identificador escrito, nunca la contraseña", async () => {
    mockSesion.iniciarSesion.mockResolvedValue(undefined);
    await render(<Login />);
    expect(screen.getByTestId("recordar-usuario").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByText(TEXTO_RECORDAR_USUARIO)).toBeTruthy();
    expect(TEXTO_RECORDAR_USUARIO).toContain(`${DIAS_RECORDADO} días`);
    await fireEvent.changeText(screen.getByTestId("campo-usuario"), "  ana.perez ");
    await fireEvent.changeText(screen.getByTestId("campo-contrasena"), "secreta");
    await fireEvent.press(screen.getByTestId("boton-entrar"));
    await act(async () => {});

    const guardado = almacen.usuarioRecordado();
    expect(guardado.usuario).toBe("ana.perez");
    expect(guardado.vence).toBeGreaterThan(Date.now() + 29 * DIA_MS);
    expect(guardado.vence).toBeLessThanOrEqual(Date.now() + 30 * DIA_MS);
    const SecureStore = require("expo-secure-store");
    for (const valor of SecureStore.__datos.values()) expect(String(valor)).not.toContain("secreta");
  });

  it("tras cerrar sesión, el campo sale ya lleno", async () => {
    await recordarUsuario("ana.perez");
    await render(<Login />);
    expect(screen.getByTestId("campo-usuario").props.value).toBe("ana.perez");
    expect(screen.getByTestId("campo-contrasena").props.value).toBe("");
  });

  it("si falla el ingreso no lo recuerda", async () => {
    mockSesion.iniciarSesion.mockRejectedValueOnce(new Error("401"));
    await render(<Login />);
    await llenar();
    await fireEvent.press(screen.getByTestId("boton-entrar"));
    await act(async () => {});
    expect(almacen.usuarioRecordado()).toBeNull();
  });

  it("con «Recordar mi usuario» desmarcado, al entrar lo olvida (como la web)", async () => {
    await recordarUsuario("ana.perez");
    mockSesion.iniciarSesion.mockResolvedValue(undefined);
    await render(<Login />);
    await fireEvent.press(screen.getByTestId("recordar-usuario"));
    expect(screen.getByTestId("recordar-usuario").props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.changeText(screen.getByTestId("campo-contrasena"), "secreta");
    await fireEvent.press(screen.getByTestId("boton-entrar"));
    await act(async () => {});
    expect(almacen.usuarioRecordado()).toBeNull();
  });

  it("vencidos los 30 días se olvida; cada ingreso vuelve a contarlos", async () => {
    await recordarUsuario("ana.perez", Date.now() - 31 * DIA_MS);
    expect(leerUsuarioRecordado()).toBe("");
    await act(async () => {});
    expect(almacen.usuarioRecordado()).toBeNull();

    await recordarUsuario("ana.perez", Date.now() - 29 * DIA_MS);
    expect(leerUsuarioRecordado()).toBe("ana.perez");
    await recordarUsuario("ana.perez");
    expect(almacen.usuarioRecordado().vence).toBeGreaterThan(Date.now() + 29 * DIA_MS);
  });

  it("cerrar la sesión en el teléfono no borra el usuario recordado ni los textos; al arrancar se leen", async () => {
    await recordarUsuario("ana.perez");
    await almacen.guardarTextosDeAcceso({ acceso_titulo: "T" });
    await almacen.borrarSesion();
    expect(leerUsuarioRecordado()).toBe("ana.perez");
    expect(almacen.textosDeAcceso()).toEqual({ acceso_titulo: "T" });
    await almacen.cargar();
    expect(leerUsuarioRecordado()).toBe("ana.perez");
    expect(almacen.textosDeAcceso()).toEqual({ acceso_titulo: "T" });
  });
});
