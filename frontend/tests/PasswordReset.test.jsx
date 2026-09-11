import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Las tres pantallas de contraseña: pedir el enlace, establecer la nueva y el
 * cambio obligatorio.
 *
 * La primera tiene una regla que no se ve mirando la pantalla: pase lo que
 * pase —cuenta existente, cuenta inexistente, servidor caído— responde
 * exactamente lo mismo. Cualquier diferencia convertiría el formulario en un
 * detector de cuentas válidas, y esa comprobación es justo la que se pierde
 * al «mejorar» un mensaje de error.
 */

const requestPasswordReset = vi.fn();
const confirmPasswordReset = vi.fn();
const changePassword = vi.fn();

vi.mock("../src/api/authService", () => ({
  authService: {
    requestPasswordReset: (...args) => requestPasswordReset(...args),
    confirmPasswordReset: (...args) => confirmPasswordReset(...args),
    changePassword: (...args) => changePassword(...args),
  },
}));

const refreshUser = vi.fn(() => Promise.resolve());
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ refreshUser }),
}));

const { ForgotPassword } =
  await import("../src/pages/PasswordReset/ForgotPassword");
const { ResetPassword } =
  await import("../src/pages/PasswordReset/ResetPassword");
const { ChangePasswordRequired } =
  await import("../src/pages/PasswordReset/ChangePasswordRequired");

const GENERICO =
  "Si el dato ingresado corresponde a una cuenta, se enviará un enlace de recuperación.";

/** Deja ver a dónde navega la pantalla al terminar. */
function Destino() {
  return <p>Destino: {useLocation().pathname}</p>;
}

function pintar(elemento, ruta = "/") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path={ruta.split("?")[0]} element={elemento} />
        <Route path="*" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requestPasswordReset.mockResolvedValue({ detail: GENERICO });
  confirmPasswordReset.mockResolvedValue({});
  changePassword.mockResolvedValue({});
});

// --- Pedir el enlace --------------------------------------------------------

describe("Pedir un enlace de recuperación", () => {
  it("responde lo mismo exista o no la cuenta", async () => {
    /* Es una regla de seguridad, no una preferencia de redacción: dos
       respuestas distintas convertirían el formulario en un detector de
       cuentas válidas. */
    pintar(<ForgotPassword />, "/forgot-password");

    fireEvent.change(screen.getByLabelText("Usuario o correo"), {
      target: { value: "acevallos" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Enviar enlace de recuperación" }),
    );

    expect(await screen.findByText(GENERICO)).toBeInTheDocument();
    expect(requestPasswordReset).toHaveBeenCalledWith("acevallos");
  });

  it("y también cuando el servidor falla", async () => {
    /* Un mensaje de error distinto al del caso normal delataría, por
       diferencia, qué cuentas existen. */
    requestPasswordReset.mockRejectedValue(new Error("500"));

    pintar(<ForgotPassword />, "/forgot-password");

    fireEvent.change(screen.getByLabelText("Usuario o correo"), {
      target: { value: "no-existe" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Enviar enlace de recuperación" }),
    );

    expect(await screen.findByText(GENERICO)).toBeInTheDocument();
  });

  it("enviado, el formulario deja de estar: no se reenvía por inercia", async () => {
    pintar(<ForgotPassword />, "/forgot-password");

    fireEvent.change(screen.getByLabelText("Usuario o correo"), {
      target: { value: "acevallos" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Enviar enlace de recuperación" }),
    );

    await screen.findByText(GENERICO);
    expect(screen.queryByLabelText("Usuario o correo")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Volver a iniciar sesión" }),
    ).toBeInTheDocument();
  });
});

// --- Establecer la nueva ----------------------------------------------------

describe("Establecer la nueva contraseña", () => {
  const RUTA = "/reset-password";

  function llenar(clave = "Contraseña.2026", confirmacion = clave) {
    fireEvent.change(screen.getByLabelText("Nueva contraseña"), {
      target: { value: clave },
    });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña"), {
      target: { value: confirmacion },
    });
  }

  it("manda el token que venía en el enlace", async () => {
    render(
      <MemoryRouter initialEntries={[`${RUTA}?token=abc123`]}>
        <Routes>
          <Route path={RUTA} element={<ResetPassword />} />
        </Routes>
      </MemoryRouter>,
    );

    llenar();
    fireEvent.click(
      screen.getByRole("button", { name: "Restablecer contraseña" }),
    );

    await waitFor(() => expect(confirmPasswordReset).toHaveBeenCalled());
    expect(confirmPasswordReset.mock.calls[0][0]).toMatchObject({
      token: "abc123",
      new_password: "Contraseña.2026",
      new_password_confirm: "Contraseña.2026",
    });
  });

  it("hecho, invita a entrar en vez de dejar el formulario", async () => {
    pintar(<ResetPassword />, RUTA);

    llenar();
    fireEvent.click(
      screen.getByRole("button", { name: "Restablecer contraseña" }),
    );

    expect(
      await screen.findByText(/Tu contraseña fue actualizada correctamente/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Iniciar sesión" }),
    ).toBeInTheDocument();
  });

  it("las reglas que incumple la contraseña se dicen todas juntas", async () => {
    /* El backend las devuelve por campo; mostrar solo la primera obligaría a
       descubrirlas de a una, con un intento cada vez. */
    confirmPasswordReset.mockRejectedValue({
      response: {
        data: {
          error: {
            details: {
              new_password: [
                "Debe tener al menos 12 caracteres.",
                "No puede parecerse a su nombre de usuario.",
              ],
            },
          },
        },
      },
    });

    pintar(<ResetPassword />, RUTA);

    llenar("corta");
    fireEvent.click(
      screen.getByRole("button", { name: "Restablecer contraseña" }),
    );

    const aviso = await screen.findByText(/Debe tener al menos 12 caracteres/);
    expect(aviso).toHaveTextContent(
      "No puede parecerse a su nombre de usuario.",
    );
  });

  it("un enlace vencido ofrece pedir otro, sin dejar al usuario parado", async () => {
    confirmPasswordReset.mockRejectedValue({
      response: { data: { error: { message: "El enlace ya no es válido." } } },
    });

    pintar(<ResetPassword />, RUTA);

    llenar();
    fireEvent.click(
      screen.getByRole("button", { name: "Restablecer contraseña" }),
    );

    expect(
      await screen.findByText("El enlace ya no es válido."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Solicitar un nuevo enlace" }),
    ).toHaveAttribute("href", "/forgot-password");
  });

  it("sin motivo del servidor, uno genérico en vez del silencio", async () => {
    confirmPasswordReset.mockRejectedValue(new Error("network"));

    pintar(<ResetPassword />, RUTA);

    llenar();
    fireEvent.click(
      screen.getByRole("button", { name: "Restablecer contraseña" }),
    );

    expect(
      await screen.findByText("No se pudo restablecer la contraseña."),
    ).toBeInTheDocument();
  });
});

// --- El cambio obligatorio --------------------------------------------------

describe("El cambio de contraseña obligatorio", () => {
  const RUTA = "/change-password-required";

  function llenar() {
    fireEvent.change(screen.getByLabelText("Contraseña actual"), {
      target: { value: "la-temporal" },
    });
    fireEvent.change(screen.getByLabelText("Nueva contraseña"), {
      target: { value: "Contraseña.2026" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña"), {
      target: { value: "Contraseña.2026" },
    });
  }

  it("dice por qué se está pidiendo", async () => {
    /* Sin explicación parece un fallo de la sesión, no una decisión de un
       administrador. */
    pintar(<ChangePasswordRequired />, RUTA);

    expect(
      screen.getByText(/Un administrador solicitó que establezca una nueva/),
    ).toBeInTheDocument();
  });

  it("pide la actual: no basta con estar dentro", async () => {
    pintar(<ChangePasswordRequired />, RUTA);

    llenar();
    fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));

    await waitFor(() => expect(changePassword).toHaveBeenCalled());
    expect(changePassword.mock.calls[0][0]).toMatchObject({
      current_password: "la-temporal",
      new_password: "Contraseña.2026",
    });
  });

  it("cambiada, se relee la sesión antes de seguir", async () => {
    /* El usuario en memoria todavía dice «debe cambiar la contraseña»: sin
       releerlo, el sistema lo devolvería a esta misma pantalla. */
    pintar(<ChangePasswordRequired />, RUTA);

    llenar();
    fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));

    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
    expect(await screen.findByText("Destino: /admin")).toBeInTheDocument();
  });

  it("si la actual no es correcta, lo dice y no navega", async () => {
    changePassword.mockRejectedValue({
      response: {
        data: {
          error: { details: { current_password: ["Contraseña incorrecta."] } },
        },
      },
    });

    pintar(<ChangePasswordRequired />, RUTA);

    llenar();
    fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));

    expect(
      await screen.findByText("Contraseña incorrecta."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Destino:/)).not.toBeInTheDocument();
    expect(refreshUser).not.toHaveBeenCalled();
  });
});
