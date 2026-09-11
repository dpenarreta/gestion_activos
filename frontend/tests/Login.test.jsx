import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * La entrada al sistema, con la sesión que la sostiene.
 *
 * Dos cosas se prueban juntas porque separadas no dicen nada: que el
 * formulario acepte usuario o correo indistintamente —quien entra una vez al
 * mes no recuerda cuál de los dos le tocó— y que el mensaje de un intento
 * fallido sea el que manda el backend, que es siempre el mismo. Distinguir
 * «no existe» de «contraseña incorrecta» convertiría el login en un detector
 * de cuentas válidas.
 */

const login = vi.fn();
const me = vi.fn();
const logout = vi.fn();

vi.mock("../src/api/authService", () => ({
  authService: {
    login: (...args) => login(...args),
    me: (...args) => me(...args),
    logout: (...args) => logout(...args),
    logoutAll: vi.fn(),
  },
}));

let tokenGuardado = null;
const setTokens = vi.fn((acceso) => {
  tokenGuardado = acceso;
});

vi.mock("../src/api/client", () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
  getAccessToken: () => tokenGuardado,
  getRefreshToken: () => null,
  setTokens: (...args) => setTokens(...args),
}));

const { AuthProvider } = await import("../src/context/AuthContext");
const { Login } = await import("../src/pages/Login/Login");

const USUARIO = {
  id: 1,
  username: "acevallos",
  must_change_password: false,
  permissions: [],
};

/** Deja ver a dónde lleva el login. */
function Destino() {
  return <p>Destino: {useLocation().pathname}</p>;
}

function pintar() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Destino />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

function entrar(identificador = "acevallos", clave = "Contraseña.2026") {
  fireEvent.change(screen.getByLabelText(/usuario o correo/i), {
    target: { value: identificador },
  });
  fireEvent.change(screen.getByLabelText(/contraseña/i), {
    target: { value: clave },
  });
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenGuardado = null;
  login.mockResolvedValue({ access: "acceso", refresh: "refresco" });
  me.mockResolvedValue(USUARIO);
});

describe("Iniciar sesión", () => {
  it("pide un identificador, no un nombre de usuario específico", () => {
    /* El nombre de usuario se compone solo y no todo el mundo lo recuerda; el
       correo sí. */
    pintar();

    expect(screen.getByLabelText(/usuario o correo/i)).toBeRequired();
    expect(screen.getByLabelText(/contraseña/i)).toBeRequired();
  });

  it("guarda la sesión y entra", async () => {
    pintar();

    entrar();

    await waitFor(() => expect(login).toHaveBeenCalled());
    expect(login.mock.calls[0][0]).toEqual({
      identifier: "acevallos",
      password: "Contraseña.2026",
    });
    expect(setTokens).toHaveBeenCalledWith("acceso", "refresco");
    // Al panel y no a la portada: quien entra viene a trabajar, y la portada
    // solo ofrecía un botón para seguir hasta aquí.
    expect(await screen.findByText("Destino: /admin")).toBeInTheDocument();
  });

  it("con el correo también entra", async () => {
    pintar();

    entrar("ana@example.com");

    await waitFor(() => expect(login).toHaveBeenCalled());
    expect(login.mock.calls[0][0].identifier).toBe("ana@example.com");
  });

  it("a quien tiene que cambiar la contraseña lo lleva ahí, no al panel", async () => {
    /* Entrar al sistema con la contraseña que le dictó un administrador
       dejaría esa clave en uso indefinidamente. */
    me.mockResolvedValue({ ...USUARIO, must_change_password: true });

    pintar();

    entrar();

    expect(
      await screen.findByText("Destino: /change-password-required"),
    ).toBeInTheDocument();
  });

  it("un intento fallido muestra el mensaje del backend, que es siempre el mismo", async () => {
    /* No dice si la cuenta existe, si la contraseña era incorrecta o si está
       deshabilitada: cualquiera de las tres distinciones convertiría el
       formulario en un detector de cuentas. */
    login.mockRejectedValue({
      response: {
        data: { error: { message: "Credenciales inválidas." } },
      },
    });

    pintar();

    entrar("acevallos", "mala");

    expect(
      await screen.findByText("Credenciales inválidas."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Destino:/)).not.toBeInTheDocument();
  });

  it("sin respuesta del servidor tampoco se queda callado", async () => {
    login.mockRejectedValue(new Error("network"));

    pintar();

    entrar();

    expect(
      await screen.findByText("No se pudo iniciar sesión."),
    ).toBeInTheDocument();
  });

  it("un fallo no deja tokens a medias", async () => {
    /* Guardar el acceso y fallar al leer el perfil dejaría una sesión que
       parece válida y no lo es. */
    login.mockRejectedValue(new Error("network"));

    pintar();

    entrar();

    await screen.findByText("No se pudo iniciar sesión.");
    expect(setTokens).not.toHaveBeenCalled();
  });

  it("ofrece recuperar la contraseña desde aquí", () => {
    pintar();

    expect(
      screen.getByRole("link", { name: /¿Olvidaste tu contraseña\?/ }),
    ).toHaveAttribute("href", "/forgot-password");
  });
});

describe("La sesión que ya venía guardada", () => {
  it("con un token persistido se recupera el perfil sin volver a entrar", async () => {
    tokenGuardado = "acceso-viejo";

    pintar();

    await waitFor(() => expect(me).toHaveBeenCalled());
    expect(login).not.toHaveBeenCalled();
  });

  it("si el token ya no vale, se limpia en vez de dejar media sesión", async () => {
    /* Un token caducado con un perfil vacío dejaría la interfaz creyendo que
       hay alguien dentro. */
    tokenGuardado = "acceso-caducado";
    me.mockRejectedValue(new Error("401"));

    pintar();

    await waitFor(() => expect(setTokens).toHaveBeenCalledWith(null, null));
  });

  it("sin token no se pregunta por el perfil", async () => {
    pintar();

    await screen.findByLabelText(/usuario o correo/i);
    expect(me).not.toHaveBeenCalled();
  });
});
