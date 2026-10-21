import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Encender y apagar módulos: apagado, el módulo no se ofrece ni se abre para
 * nadie, salvo el superusuario y el administrador (`configuracion.modulos`).
 */

const permisos = { lista: [] };

vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { permissions: permisos.lista },
    isAuthenticated: true,
  }),
}));

const servicio = { modulos: vi.fn(), cambiarModulo: vi.fn() };
vi.mock("../src/api/empresasService", () => ({ empresasService: servicio }));

const { SelectorModulo } =
  await import("../src/components/admin/SelectorModulo/SelectorModulo");
const { ModuloApagado } =
  await import("../src/components/admin/ModuloApagado/ModuloApagado");
const { ModulosPage } =
  await import("../src/pages/Admin/Configuracion/ModulosPage");
const { EstadoModulosProvider } = await import("../src/modulos/EstadoModulos");
const { UnsavedChangesProvider } =
  await import("../src/context/UnsavedChangesContext");

function estado(apagados = [], veApagados = false) {
  const ids = [
    "institucional",
    "dashboards",
    "soporte",
    "matriz",
    "sedes",
    "activos",
  ];
  return {
    modulos: ids.map((id) => ({
      id,
      nombre: id,
      activo: !apagados.includes(id),
    })),
    ve_apagados: veApagados,
    puede_gestionar: veApagados,
  };
}

function pintar(contenido, ruta = "/admin/dashboard") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <UnsavedChangesProvider>
        <EstadoModulosProvider>{contenido}</EstadoModulosProvider>
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

async function abrirSelector() {
  fireEvent.click(
    await screen.findByRole("button", { name: /Cambiar de módulo/ }),
  );
  return screen.getByRole("menu", { name: "Módulos" });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  permisos.lista = ["activos.ver", "matriz.cargar", "soporte.atender"];
});

describe("Módulos apagados", () => {
  it("el selector no ofrece un módulo apagado aunque se tengan sus permisos", async () => {
    servicio.modulos.mockResolvedValue(estado(["matriz"]));
    pintar(<SelectorModulo />);
    await waitFor(() => expect(servicio.modulos).toHaveBeenCalled());
    const menu = await abrirSelector();
    await waitFor(() =>
      expect(
        within(menu).queryByText("Matriz de obligaciones"),
      ).not.toBeInTheDocument(),
    );
    expect(within(menu).getByText("Mesa de ayuda")).toBeInTheDocument();
  });

  it("el administrador lo sigue viendo, marcado como apagado", async () => {
    servicio.modulos.mockResolvedValue(estado(["matriz"], true));
    pintar(<SelectorModulo />);
    const menu = await abrirSelector();
    const opcion = (
      await within(menu).findByText("Matriz de obligaciones")
    ).closest("button");
    expect(within(opcion).getByText("Apagado")).toBeInTheDocument();
  });

  it("entrar por la dirección a un módulo apagado muestra el aviso y no la pantalla", async () => {
    servicio.modulos.mockResolvedValue(estado(["matriz"]));
    pintar(
      <ModuloApagado>
        <p>Pantalla de la Matriz</p>
      </ModuloApagado>,
      "/admin/matriz",
    );
    expect(
      await screen.findByRole("heading", {
        name: "El módulo Matriz de obligaciones está apagado",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Pantalla de la Matriz")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Mesa de ayuda/ }),
    ).toBeInTheDocument();
  });

  it("el administrador entra, con la franja de apagado", async () => {
    servicio.modulos.mockResolvedValue(estado(["matriz"], true));
    pintar(
      <ModuloApagado>
        <p>Pantalla de la Matriz</p>
      </ModuloApagado>,
      "/admin/matriz",
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/está apagado/);
    expect(screen.getByText("Pantalla de la Matriz")).toBeInTheDocument();
  });

  it("Configuración → Módulos enciende y apaga", async () => {
    servicio.modulos.mockResolvedValue(estado([], true));
    servicio.cambiarModulo.mockResolvedValue(estado(["soporte"], true));
    pintar(<ModulosPage />, "/admin/configuracion/modulos");
    const interruptor = await screen.findByRole("switch", {
      name: "Mesa de ayuda: encendido",
    });
    servicio.modulos.mockResolvedValue(estado(["soporte"], true));
    fireEvent.click(interruptor);
    await waitFor(() =>
      expect(servicio.cambiarModulo).toHaveBeenCalledWith("soporte", false),
    );
    expect(
      await screen.findByRole("switch", { name: "Mesa de ayuda: apagado" }),
    ).not.toBeChecked();
  });
});
