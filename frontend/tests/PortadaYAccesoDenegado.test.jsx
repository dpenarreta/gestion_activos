import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Dónde aterriza cada quien.
 *
 * La portada existía para todo el mundo y, para quien ya tenía sesión, era un
 * saludo y un botón para seguir hasta el panel: un clic de más cada día por una
 * pantalla que no respondía ninguna pregunta. Ahora solo la ve quien tiene algo
 * que hacer en ella —entrar—.
 *
 * El reverso es el 403. Al llevar a la gente directamente al panel, quien no
 * tiene ningún permiso llega antes a la pared, así que la pared tiene que
 * decirle qué pasa: un botón «volver al inicio» lo devolvería exactamente aquí.
 */

const sesion = { autenticado: false, iniciando: false, permisos: [] };
const logout = vi.fn();

vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: sesion.autenticado,
    isInitializing: sesion.iniciando,
    user: { permissions: sesion.permisos },
    logout,
  }),
}));

vi.mock("../src/api/client", () => ({
  apiClient: { get: vi.fn(() => Promise.resolve({ data: {} })) },
}));

const { Home } = await import("../src/pages/Home/Home");
const { Forbidden } = await import("../src/pages/Errors/Forbidden");

/** Deja ver a dónde redirige la portada. */
function Destino() {
  return <p>Destino: {useLocation().pathname}</p>;
}

function pintar(elemento) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={elemento} />
        <Route path="*" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sesion.autenticado = false;
  sesion.iniciando = false;
  sesion.permisos = [];
});

describe("La portada", () => {
  it("con sesión abierta pasa de largo hacia el panel", async () => {
    /* Es la puerta que queda después de arreglar el login: una dirección
       guardada en favoritos, el logo del menú o volver desde un 404 acababan
       todos aquí. */
    sesion.autenticado = true;

    pintar(<Home />);

    expect(screen.getByText("Destino: /admin")).toBeInTheDocument();
  });

  it("sin sesión sí se dibuja, con lo único que hay que hacer en ella", () => {
    pintar(<Home />);

    expect(
      screen.getByRole("link", { name: "Iniciar sesión" }),
    ).toHaveAttribute("href", "/login");
    expect(screen.queryByText(/^Destino:/)).not.toBeInTheDocument();
  });

  it("mientras se recupera la sesión no parpadea", () => {
    /* Con un token guardado todavía no se sabe si hay sesión: pintar la portada
       la haría aparecer y desaparecer en cada recarga. */
    sesion.iniciando = true;

    const { container } = pintar(<Home />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("Acceso denegado", () => {
  it("a quien tiene permisos lo devuelve al panel", async () => {
    sesion.autenticado = true;
    sesion.permisos = ["activos.ver"];

    pintar(<Forbidden />);

    expect(
      screen.getByRole("link", { name: "Volver al panel" }),
    ).toHaveAttribute("href", "/admin");
  });

  it("a quien no tiene ninguno le dice qué pasa y le deja salir", () => {
    /* Para esta persona «volver al inicio» no es una salida: el panel la
       devolvería justo aquí, porque no hay ninguna pantalla que pueda abrir. */
    sesion.autenticado = true;
    sesion.permisos = [];

    pintar(<Forbidden />);

    expect(
      screen.getByText(/todavía no tiene ningún permiso asignado/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Volver al panel" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(logout).toHaveBeenCalled();
  });
});
