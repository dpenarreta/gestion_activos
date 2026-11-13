import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * US-015: la tarjeta «Contraseña» de la ficha. Ocultar los botones no es
 * seguridad (el servidor da 403), pero no se ofrece lo que se sabe que
 * fallaría: la propia cuenta y la de un superusuario.
 *
 * Ninguna prueba nombra la contraseña temporal real: el repositorio es
 * público y vive solo en el `.env` de cada servidor.
 */

const cambiarPassword = vi.fn();
const restablecerClaveTemporal = vi.fn();
const resetPassword = vi.fn();

vi.mock("../src/api/adminUsersService", () => ({
  adminUsersService: {
    cambiarPassword: (...args) => cambiarPassword(...args),
    restablecerClaveTemporal: (...args) => restablecerClaveTemporal(...args),
    resetPassword: (...args) => resetPassword(...args),
  },
}));

let sesion = { id: 1, is_superuser: false };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: sesion }),
}));

const { ContrasenaDeLaCuenta } =
  await import("../src/pages/Admin/Users/ContrasenaDeLaCuenta");

const ANA = { id: 7, nombre: "Ana Cevallos", esSuperusuario: false };
const CLAVE = "Nueva2026@x";

function pintar({
  usuario = ANA,
  puedeEnviarEnlace = false,
  puedeCambiar = true,
  puedeClaveTemporal = true,
} = {}) {
  return render(
    <ContrasenaDeLaCuenta
      usuario={usuario}
      puedeEnviarEnlace={puedeEnviarEnlace}
      puedeCambiar={puedeCambiar}
      puedeClaveTemporal={puedeClaveTemporal}
    />,
  );
}

function errorApi(status, data) {
  return { response: { status, data } };
}

const botonDeLaTarjeta = (nombre) =>
  screen.getByRole("button", { name: nombre });

async function abrirCambiar() {
  fireEvent.click(botonDeLaTarjeta("Cambiar contraseña"));
  return screen.findByRole("dialog", { name: /Cambiar contraseña/ });
}

function escribir(clave, repetida = clave) {
  fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), {
    target: { value: clave },
  });
  fireEvent.change(screen.getByLabelText(/^Repetir contraseña/), {
    target: { value: repetida },
  });
}

function enviarCambio() {
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Cambiar contraseña",
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sesion = { id: 1, is_superuser: false };
  cambiarPassword.mockResolvedValue(undefined);
  restablecerClaveTemporal.mockResolvedValue(undefined);
  resetPassword.mockResolvedValue({});
});

describe("Visibilidad de las acciones", () => {
  it("con los tres permisos muestra las tres acciones, en orden", () => {
    pintar({ puedeEnviarEnlace: true });
    const titulos = screen
      .getAllByRole("heading", { level: 4 })
      .map((h) => h.textContent);
    expect(titulos).toEqual([
      "Enviar enlace de recuperación",
      "Cambiar contraseña",
      "Dejar la contraseña temporal",
    ]);
    expect(botonDeLaTarjeta("Cambiar contraseña")).toBeInTheDocument();
    expect(
      botonDeLaTarjeta(/Dejar la contraseña temporal/),
    ).toBeInTheDocument();
  });

  it("solo muestra la acción del permiso que se tiene", () => {
    pintar({ puedeClaveTemporal: false });
    expect(botonDeLaTarjeta("Cambiar contraseña")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Dejar la contraseña temporal/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Enviar enlace de recuperación"),
    ).not.toBeInTheDocument();
  });

  it("sin ningún permiso no muestra la tarjeta", () => {
    pintar({ puedeCambiar: false, puedeClaveTemporal: false });
    expect(
      screen.queryByRole("heading", { name: "Contraseña" }),
    ).not.toBeInTheDocument();
  });

  it("sobre la propia cuenta no ofrece cambiar ni dejar la temporal", () => {
    sesion = { id: 7, is_superuser: false };
    pintar();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("sobre la propia cuenta conserva el enlace de recuperación", () => {
    sesion = { id: 7, is_superuser: false };
    pintar({ puedeEnviarEnlace: true });
    expect(botonDeLaTarjeta("Aplicar opciones")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cambiar contraseña" }),
    ).not.toBeInTheDocument();
  });

  it("no ofrece cambiar sobre un superusuario a quien no lo es", () => {
    pintar({ usuario: { ...ANA, esSuperusuario: true } });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("un superusuario sí puede actuar sobre otro", () => {
    sesion = { id: 1, is_superuser: true };
    pintar({ usuario: { ...ANA, esSuperusuario: true } });
    expect(botonDeLaTarjeta("Cambiar contraseña")).toBeInTheDocument();
  });

  it("la región de resultados está montada y vacía desde el principio", () => {
    pintar();
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
  });
});

describe("Enviar enlace de recuperación", () => {
  async function aplicar(etiqueta) {
    fireEvent.click(screen.getByLabelText(etiqueta));
    fireEvent.click(botonDeLaTarjeta("Aplicar opciones"));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
  }

  it("sin elegir opción no se puede aplicar, y dice por qué", () => {
    pintar({ puedeEnviarEnlace: true });
    const boton = botonDeLaTarjeta("Aplicar opciones");
    expect(boton).toBeDisabled();
    expect(boton).toHaveClass("btn-outline-primary");
    const ayuda = screen.getByText("Marque al menos una opción.");
    expect(boton.getAttribute("aria-describedby")).toBe(ayuda.id);
    fireEvent.click(screen.getByLabelText("Cerrar sus sesiones abiertas"));
    expect(screen.queryByText("Marque al menos una opción.")).toBeNull();
    expect(boton).not.toHaveAttribute("aria-describedby");
  });

  it("la confirmación lista las opciones marcadas", async () => {
    pintar({ puedeEnviarEnlace: true });
    fireEvent.click(screen.getByLabelText("Cerrar sus sesiones abiertas"));
    fireEvent.click(screen.getByLabelText("Pedir que la cambie al entrar"));
    fireEvent.click(botonDeLaTarjeta("Aplicar opciones"));

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Se aplicará lo marcado: deberá cambiar la contraseña en su próximo ingreso y se cerrarán todas sus sesiones. ¿Confirma?",
    );
  });

  it("sus casillas usan los mismos textos que la ventana de cambiar", () => {
    pintar({ puedeEnviarEnlace: true });
    expect(
      screen.getByLabelText("Pedir que la cambie al entrar"),
    ).toBeVisible();
    expect(screen.getByLabelText("Cerrar sus sesiones abiertas")).toBeVisible();
  });

  it("confirmada, envía solo lo marcado y lo confirma", async () => {
    pintar({ puedeEnviarEnlace: true });
    await aplicar("Cerrar sus sesiones abiertas");

    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith(7, {
        send_link: false,
        force_change_on_next_login: false,
        revoke_sessions: true,
      }),
    );
    expect(
      await screen.findByText("Listo: se cerraron todas sus sesiones."),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Cerrar sus sesiones abiertas"),
    ).not.toBeChecked();
  });

  it("si falla, dice el motivo del servidor", async () => {
    resetPassword.mockRejectedValue(
      errorApi(400, {
        error: { message: "El correo del usuario está vacío." },
      }),
    );
    pintar({ puedeEnviarEnlace: true });
    await aplicar("Enviar enlace de restablecimiento por correo");

    expect(
      await screen.findByText("El correo del usuario está vacío."),
    ).toBeInTheDocument();
  });
});

describe("Cambiar la contraseña", () => {
  it("muestra los requisitos (con el de la temporal), el aviso y las casillas marcadas", async () => {
    pintar();
    const dialogo = await abrirCambiar();

    const lista = within(dialogo).getByRole("list", {
      name: "Requisitos de la contraseña",
    });
    expect(lista).toHaveTextContent("No puede ser la contraseña temporal");
    const nueva = screen.getByLabelText(/^Nueva contraseña/);
    expect(nueva).toHaveAttribute("autocomplete", "new-password");
    expect(nueva.getAttribute("aria-describedby")).toContain(lista.id);
    expect(
      screen.getByLabelText("Pedir que la cambie al entrar"),
    ).toBeChecked();
    expect(screen.getByLabelText("Cerrar sus sesiones abiertas")).toBeChecked();
    expect(
      within(dialogo).getByRole("group", { name: "Al guardar" }),
    ).toBeInTheDocument();
    expect(
      screen
        .getByLabelText("Pedir que la cambie al entrar")
        .getAttribute("aria-describedby"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Recomendado: si lo desmarca, usted conocerá su contraseña.",
      ),
    ).toBeInTheDocument();
  });

  it("al abrir, el foco está en «Nueva contraseña»", async () => {
    pintar();
    await abrirCambiar();
    await waitFor(() =>
      expect(screen.getByLabelText(/^Nueva contraseña/)).toHaveFocus(),
    );
  });

  it("el botón de mostrar alterna el tipo, expone aria-pressed y queda activo", async () => {
    pintar();
    await abrirCambiar();

    const boton = screen.getByRole("button", {
      name: "Mostrar las contraseñas",
    });
    expect(boton).toHaveAttribute("aria-pressed", "false");
    expect(boton).not.toHaveClass("active");
    expect(boton).not.toHaveClass("btn-sm");
    expect(boton).toHaveClass("mz-tactil", "contrasena-mostrar");
    fireEvent.click(boton);
    expect(screen.getByLabelText(/^Nueva contraseña/)).toHaveAttribute(
      "type",
      "text",
    );
    expect(
      screen.getByRole("button", { name: "Mostrar las contraseñas" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(boton).toHaveClass("active");
  });

  it("al salir de «Repetir» dice si coinciden o no", async () => {
    pintar();
    await abrirCambiar();
    const repetir = screen.getByLabelText(/^Repetir contraseña/);

    fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), {
      target: { value: CLAVE },
    });
    fireEvent.change(repetir, { target: { value: "Otra2026@x" } });
    // Mientras escribe no se avisa.
    expect(screen.queryByText("No coinciden")).not.toBeInTheDocument();
    fireEvent.blur(repetir);
    expect(screen.getByText("No coinciden")).toHaveClass(
      "contrasena-coincidencia--no",
    );
    expect(repetir.getAttribute("aria-describedby")).toContain("-coinciden");

    fireEvent.change(repetir, { target: { value: CLAVE } });
    expect(screen.getByText("Coinciden")).toHaveClass(
      "contrasena-coincidencia--ok",
    );
  });

  it("si no cumple los requisitos, lo dice en «Nueva contraseña» y no envía", async () => {
    pintar();
    await abrirCambiar();
    escribir("corta");
    enviarCambio();

    expect(
      await screen.findByText(/no cumple los requisitos/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nueva contraseña/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(cambiarPassword).not.toHaveBeenCalled();
  });

  it("si las dos no coinciden, lo dice bajo el campo y no envía", async () => {
    pintar();
    await abrirCambiar();
    escribir(CLAVE, "Otra2026@x");
    enviarCambio();

    expect(
      await screen.findByText("Las dos contraseñas no coinciden."),
    ).toBeInTheDocument();
    expect(cambiarPassword).not.toHaveBeenCalled();
  });

  it("envía lo escrito y las casillas, y confirma con el nombre", async () => {
    pintar();
    await abrirCambiar();
    escribir(CLAVE);
    fireEvent.click(screen.getByLabelText("Cerrar sus sesiones abiertas"));
    enviarCambio();

    await waitFor(() =>
      expect(cambiarPassword).toHaveBeenCalledWith(7, {
        password: CLAVE,
        password_confirmacion: CLAVE,
        forzar_cambio: true,
        cerrar_sesiones: false,
      }),
    );
    expect(
      await screen.findByText(
        "Se cambió la contraseña de Ana Cevallos. Se le avisó por correo.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("muestra el error del servidor bajo el campo y deja la ventana abierta", async () => {
    cambiarPassword.mockRejectedValue(
      errorApi(400, {
        error: {
          code: "invalid",
          message: "Error en la solicitud.",
          details: { password: ["Esta contraseña es demasiado común."] },
        },
      }),
    );
    pintar();
    await abrirCambiar();
    escribir(CLAVE);
    enviarCambio();

    expect(
      await screen.findByText("Esta contraseña es demasiado común."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nueva contraseña/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Revise los campos marcados.",
    );
  });

  it("un 403 se muestra arriba, completo", async () => {
    cambiarPassword.mockRejectedValue(
      errorApi(403, {
        error: { code: "permission_denied", message: "No tiene permiso." },
      }),
    );
    pintar();
    await abrirCambiar();
    escribir(CLAVE);
    enviarCambio();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tiene permiso.",
    );
  });
});

describe("Dejar la contraseña temporal", () => {
  async function abrirConfirmacion() {
    fireEvent.click(botonDeLaTarjeta(/Dejar la contraseña temporal/));
    return screen.findByRole("dialog");
  }

  function confirmar(dialogo) {
    fireEvent.click(
      within(dialogo).getByRole("button", {
        name: "Dejar la contraseña temporal",
      }),
    );
  }

  it("pide confirmar, explica lo que pasará y no envía antes", async () => {
    pintar();
    const dialogo = await abrirConfirmacion();

    expect(dialogo).toHaveTextContent(
      "La contraseña de Ana Cevallos pasará a ser la contraseña temporal de la intranet, que es la misma para todos.",
    );
    expect(dialogo).toHaveTextContent(
      "cualquiera que la conozca podría usar su cuenta",
    );
    const items = within(dialogo)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toEqual([
      "Se cerrarán sus sesiones.",
      "Se anularán sus enlaces de recuperación.",
      "Se desbloqueará la cuenta.",
      "Recibirá un aviso por correo, sin la contraseña.",
    ]);
    expect(dialogo).toHaveTextContent(
      "Comuníquele la contraseña temporal por un canal seguro.",
    );
    expect(within(dialogo).getByRole("button", { name: "Volver" })).toHaveClass(
      "btn-outline-secondary",
    );
    expect(restablecerClaveTemporal).not.toHaveBeenCalled();
  });

  it("al confirmar envía y muestra el éxito sin enseñar ninguna clave", async () => {
    // La respuesta trae un valor inventado: la interfaz no debe pintarlo.
    restablecerClaveTemporal.mockResolvedValue({ clave: "ValorInventado#0" });
    pintar();
    const dialogo = await abrirConfirmacion();
    confirmar(dialogo);

    await waitFor(() =>
      expect(restablecerClaveTemporal).toHaveBeenCalledWith(7),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      /Ana Cevallos volvió a la temporal/,
    );
    expect(document.body.textContent).not.toContain("ValorInventado#0");
  });

  it("«Volver» no envía nada", async () => {
    pintar();
    await abrirConfirmacion();
    fireEvent.click(screen.getByRole("button", { name: "Volver" }));

    expect(restablecerClaveTemporal).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("con sin_clave_temporal dice que avise a TI", async () => {
    restablecerClaveTemporal.mockRejectedValue(
      errorApi(400, {
        error: { code: "sin_clave_temporal", message: "No configurada." },
      }),
    );
    pintar();
    confirmar(await abrirConfirmacion());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "El servidor no tiene una contraseña temporal configurada. Avise a TI.",
    );
  });

  it("otro error muestra el mensaje del servidor", async () => {
    restablecerClaveTemporal.mockRejectedValue(
      errorApi(403, {
        error: { code: "permission_denied", message: "No tiene permiso." },
      }),
    );
    pintar();
    confirmar(await abrirConfirmacion());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "No tiene permiso.",
    );
  });
});
