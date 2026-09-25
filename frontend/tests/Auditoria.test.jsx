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
 * El registro de auditoría.
 *
 * Lo que se prueba aquí es que la pantalla no prometa más de lo que el
 * servidor va a conceder: los valores «antes/después» y la exportación van
 * detrás de sus propios permisos, y ofrecerlos a quien no los tiene enseña a
 * desconfiar de la pantalla. Lo demás es que los filtros lleguen tal como se
 * escribieron y que lo exportado sea lo que se está viendo.
 */

const listar = vi.fn();
const exportar = vi.fn();
let permisos = [];

vi.mock("../src/api/auditoriaService", () => ({
  auditoriaService: {
    list: (...args) => listar(...args),
    exportar: (...args) => exportar(...args),
  },
}));

vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.includes(codename),
}));

const descargado = vi.fn();
vi.mock("../src/utils/descargas", () => ({
  descargarBlob: (...args) => descargado(...args),
}));

const { AuditoriaList } =
  await import("../src/pages/Admin/Auditoria/AuditoriaList");

const EVENTOS = [
  {
    id: 1,
    actor_username: "dpenarreta",
    action: "activo.updated",
    module: "activos",
    target_type: "Activo",
    target_id: "42",
    result: "success",
    previous_values: { estado: "disponible" },
    new_values: { estado: "asignado" },
    ip_address: "10.0.0.5",
    browser: "Chrome",
    operating_system: "Windows",
    location: "",
    created_at: "2026-09-20T14:05:00Z",
    created_at_local: "2026-09-20T09:05:00-05:00",
  },
  {
    id: 2,
    actor_username: null,
    action: "login.failed",
    module: "authentication",
    target_type: "User",
    target_id: "",
    result: "failure",
    previous_values: {},
    new_values: {},
    ip_address: null,
    browser: "",
    operating_system: "",
    location: "",
    created_at: "2026-09-20T13:00:00Z",
    created_at_local: "2026-09-20T08:00:00-05:00",
  },
];

function pintar() {
  return render(
    <MemoryRouter>
      <AuditoriaList />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos = ["auditoria.ver", "auditoria.ver_detalle", "auditoria.exportar"];
  listar.mockResolvedValue({
    results: EVENTOS,
    count: 2,
    next: null,
    previous: null,
  });
  exportar.mockResolvedValue(new Blob(["x"]));
});

describe("El registro de auditoría", () => {
  it("lista qué se hizo, quién lo hizo y con qué resultado", async () => {
    pintar();

    const fila = (await screen.findByText("activo.updated")).closest("tr");
    expect(fila).toHaveTextContent("dpenarreta");
    expect(fila).toHaveTextContent("activos");
    expect(fila).toHaveTextContent("Activo #42");
    expect(fila).toHaveTextContent("Éxito");
  });

  it("un evento sin autor se atribuye al sistema, no se deja en blanco", async () => {
    /* Pasa de verdad: lo dispara una tarea, o el intento llegó sin sesión
       válida. Una celda vacía se leería como un dato que falta. */
    pintar();

    const fila = (await screen.findByText("login.failed")).closest("tr");
    expect(fila).toHaveTextContent("Sistema");
    expect(fila).toHaveTextContent("Fallido");
  });

  it("el detalle enseña el antes y el después del cambio", async () => {
    pintar();

    const fila = (await screen.findByText("activo.updated")).closest("tr");
    fireEvent.click(within(fila).getByRole("button", { name: "Ver" }));

    expect(await screen.findByText("Antes")).toBeInTheDocument();
    expect(screen.getByText("Después")).toBeInTheDocument();
    expect(screen.getByText("disponible")).toBeInTheDocument();
    expect(screen.getByText("asignado")).toBeInTheDocument();
  });

  it("sin permiso de detalle no se ofrece abrirlo", async () => {
    /* El servidor ya no manda esos valores; un botón que abre dos columnas
       vacías haría pensar que el evento no cambió nada. */
    permisos = ["auditoria.ver"];
    pintar();

    await screen.findByText("activo.updated");
    expect(
      screen.queryByRole("button", { name: "Ver" }),
    ).not.toBeInTheDocument();
  });

  it("sin permiso de exportar no se ofrece el botón", async () => {
    permisos = ["auditoria.ver"];
    pintar();

    await screen.findByText("activo.updated");
    expect(screen.queryByText(/Exportar/)).not.toBeInTheDocument();
  });

  it("los filtros se envían al confirmar, no en cada tecla", async () => {
    pintar();
    await screen.findByText("activo.updated");
    listar.mockClear();

    fireEvent.change(screen.getByLabelText("Usuario"), {
      target: { value: "dpenarreta" },
    });
    expect(listar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));

    await waitFor(() =>
      expect(listar).toHaveBeenCalledWith(
        expect.objectContaining({ actor_username: "dpenarreta", page: 1 }),
      ),
    );
  });

  it("lo que se exporta es lo que se está viendo", async () => {
    pintar();
    await screen.findByText("activo.updated");

    fireEvent.change(screen.getByLabelText("Resultado"), {
      target: { value: "failure" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    await waitFor(() =>
      expect(listar).toHaveBeenCalledWith(
        expect.objectContaining({ result: "failure" }),
      ),
    );

    fireEvent.click(screen.getByText(/Exportar/));

    await waitFor(() =>
      expect(exportar).toHaveBeenCalledWith(
        expect.objectContaining({ result: "failure" }),
      ),
    );
    await waitFor(() =>
      expect(descargado).toHaveBeenCalledWith(
        expect.anything(),
        "auditoria.csv",
      ),
    );
  });

  it("si el registro no carga lo dice", async () => {
    listar.mockRejectedValue({
      response: { data: { error: { message: "No autorizado." } } },
    });
    pintar();

    expect(await screen.findByText("No autorizado.")).toBeInTheDocument();
  });

  it("sin eventos para esos filtros lo dice", async () => {
    listar.mockResolvedValue({
      results: [],
      count: 0,
      next: null,
      previous: null,
    });
    pintar();

    expect(
      await screen.findByText("Sin eventos para esos filtros"),
    ).toBeInTheDocument();
  });
});
