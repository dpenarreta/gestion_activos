import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    modulos: () =>
      Promise.resolve([
        { id: "activos", nombre: "Gestión de Activos" },
        { id: "soporte", nombre: "Mesa de ayuda" },
      ]),
  },
}));

vi.mock("../src/hooks/usePermission", () => ({
  // El registro general se ve con `auditoria.ver`, que se da por sentado
  // salvo que la prueba lo quite.
  usePermission: (codename) =>
    (codename === "auditoria.ver" && !permisos.includes("-auditoria.ver")) ||
    permisos.includes(codename),
}));

const descargado = vi.fn();
vi.mock("../src/utils/descargas", () => ({
  descargarBlob: (...args) => descargado(...args),
}));

const { AuditoriaList } =
  await import("../src/pages/Admin/Auditoria/AuditoriaList");

/* «Activo modificado» también es una opción del filtro «Acción»: se busca en
   la celda de la tabla (revisión final UX/UI, 28/10/2026). */
const EN_LA_TABLA = { selector: "td" };

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

    const fila = (
      await screen.findByText("Activo modificado", EN_LA_TABLA)
    ).closest("tr");
    expect(fila).toHaveTextContent("dpenarreta");
    expect(fila).toHaveTextContent("activos");
    expect(fila).toHaveTextContent("Activo #42");
    expect(fila).toHaveTextContent("Éxito");
  });

  it("la acción se lee en palabras y conserva su código a mano", async () => {
    /* `role.created` en crudo solo lo entiende quien lee código; el código
       sigue en el `title` porque es lo que se escribe en el filtro «Acción»
       (auditoría UX/UI, fase 2). */
    pintar();

    const celda = await screen.findByText("Activo modificado", EN_LA_TABLA);
    expect(celda).toHaveAttribute("title", "activo.updated");
    expect(
      screen.getByText("Inicio de sesión fallido", EN_LA_TABLA),
    ).toHaveAttribute("title", "login.failed");
    const fila = celda.closest("tr");
    expect(fila).not.toHaveTextContent("activo.updated");
  });

  it("un evento sin autor se atribuye al sistema, no se deja en blanco", async () => {
    /* Pasa de verdad: lo dispara una tarea, o el intento llegó sin sesión
       válida. Una celda vacía se leería como un dato que falta. */
    pintar();

    const fila = (
      await screen.findByText("Inicio de sesión fallido", EN_LA_TABLA)
    ).closest("tr");
    expect(fila).toHaveTextContent("Sistema");
    expect(fila).toHaveTextContent("Fallido");
  });

  it("el detalle enseña el antes y el después del cambio", async () => {
    pintar();

    const fila = (
      await screen.findByText("Activo modificado", EN_LA_TABLA)
    ).closest("tr");
    fireEvent.click(
      within(fila).getByRole("button", {
        name: /^Ver detalle de Activo modificado/,
      }),
    );

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

    await screen.findByText("Activo modificado", EN_LA_TABLA);
    expect(
      screen.queryByRole("button", { name: /^Ver/ }),
    ).not.toBeInTheDocument();
  });

  it("sin permiso de exportar no se ofrece el botón", async () => {
    permisos = ["auditoria.ver"];
    pintar();

    await screen.findByText("Activo modificado", EN_LA_TABLA);
    expect(screen.queryByText(/Exportar/)).not.toBeInTheDocument();
  });

  it("la acción se filtra eligiéndola por su nombre y se envía el código", async () => {
    /* Antes había que escribir `activo.updated` (revisión final UX/UI,
       28/10/2026). */
    pintar();
    await screen.findByText("Activo modificado", EN_LA_TABLA);
    listar.mockClear();

    const accion = screen.getByLabelText("Acción");
    expect(accion.tagName).toBe("SELECT");
    expect(
      within(accion).getByRole("option", { name: "Rol creado" }),
    ).toHaveValue("role.created");

    fireEvent.change(accion, { target: { value: "role.created" } });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));

    await waitFor(() =>
      expect(listar).toHaveBeenCalledWith(
        expect.objectContaining({ action: "role.created" }),
      ),
    );
  });

  it("el detalle nombra los campos en palabras y conserva el código", async () => {
    pintar();

    const fila = (
      await screen.findByText("Activo modificado", EN_LA_TABLA)
    ).closest("tr");
    const ver = within(fila).getByRole("button", {
      name: /^Ver detalle de Activo modificado, dpenarreta/,
    });
    expect(ver).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(ver);

    const detalle = document.getElementById(ver.getAttribute("aria-controls"));
    expect(detalle).not.toBeNull();
    expect(ver).toHaveAttribute("aria-expanded", "true");
    const etiquetas = within(detalle).getAllByText("Estado");
    expect(etiquetas).toHaveLength(2);
    expect(etiquetas[0]).toHaveAttribute("title", "estado");
  });

  it("los filtros se envían al confirmar, no en cada tecla", async () => {
    pintar();
    await screen.findByText("Activo modificado", EN_LA_TABLA);
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
    await screen.findByText("Activo modificado", EN_LA_TABLA);

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

    // Se reintenta sin recargar la página.
    listar.mockResolvedValue({
      results: EVENTOS,
      count: 2,
      next: null,
      previous: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByText("Activo modificado", EN_LA_TABLA),
    ).toBeInTheDocument();
  });

  it("sin eventos lo dice", async () => {
    listar.mockResolvedValue({
      results: [],
      count: 0,
      next: null,
      previous: null,
    });
    pintar();

    expect(
      await screen.findByText(
        "Todavía no hay eventos registrados en este módulo.",
      ),
    ).toBeInTheDocument();
  });

  it("si los filtros no encuentran nada, lo distingue y deja limpiarlos", async () => {
    pintar();
    await screen.findByText("Activo modificado", EN_LA_TABLA);
    listar.mockResolvedValue({
      results: [],
      count: 0,
      next: null,
      previous: null,
    });

    fireEvent.change(screen.getByLabelText("Usuario"), {
      target: { value: "nadie" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));

    expect(
      await screen.findByText("Ningún resultado con estos filtros."),
    ).toBeInTheDocument();

    listar.mockResolvedValue({
      results: EVENTOS,
      count: 2,
      next: null,
      previous: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));

    expect(
      await screen.findByText("Activo modificado", EN_LA_TABLA),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Usuario")).toHaveValue("");
  });
});

describe("Una sola auditoría, filtrada por módulo", () => {
  it("el filtro ofrece los módulos con eventos y filtra al elegir uno", async () => {
    pintar();
    const selector = await screen.findByLabelText("Módulo");
    await waitFor(() =>
      expect(
        within(selector).getByRole("option", { name: "Mesa de ayuda" }),
      ).toBeInTheDocument(),
    );
    expect(
      within(selector).getByRole("option", { name: "Todos los módulos" }),
    ).toBeInTheDocument();
    // Sin el permiso de la Matriz no se ofrece su historial.
    expect(
      within(selector).queryByRole("option", { name: /Matriz/ }),
    ).toBeNull();

    fireEvent.change(selector, { target: { value: "soporte" } });
    await waitFor(() =>
      expect(listar).toHaveBeenLastCalledWith(
        expect.objectContaining({ module: "soporte" }),
      ),
    );
    // No hay pestañas: es una sola pantalla.
    expect(screen.queryByRole("navigation", { name: "Auditoría" })).toBeNull();
  });

  it("con el permiso de la Matriz su historial es una opción más", async () => {
    permisos = ["auditoria.ver", "matriz.ver_auditoria"];
    pintar();
    const selector = await screen.findByLabelText("Módulo");
    expect(
      within(selector).getByRole("option", {
        name: "Matriz de obligaciones · historial de períodos",
      }),
    ).toBeInTheDocument();
  });
});

/*
 * En el teléfono (auditoría UX/UI, fase 3, 28/10/2026): cada evento en una
 * tarjeta, con su detalle desplegable dentro, en vez de siete columnas que
 * solo se leían desplazándose de lado.
 */
describe("En el teléfono", () => {
  const original = window.matchMedia;

  beforeEach(() => {
    window.matchMedia = vi.fn((consulta) => ({
      matches: consulta.includes("max-width: 880px"),
      media: consulta,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    window.matchMedia = original;
  });

  it("cada evento es una tarjeta y su detalle se abre dentro", async () => {
    pintar();

    const lista = await screen.findByRole("list", { name: "Eventos" });
    const [primera, segunda] = within(lista).getAllByRole("listitem");
    expect(primera).toHaveTextContent("Activo modificado");
    expect(primera).toHaveTextContent("dpenarreta");
    expect(primera).toHaveTextContent("Activo #42");
    expect(primera).toHaveTextContent("Éxito");
    expect(segunda).toHaveTextContent("Sistema");
    expect(segunda).toHaveTextContent("Fallido");

    const ver = within(primera).getByRole("button", {
      name: /^Ver detalle de /,
    });
    expect(ver).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(ver);

    expect(ver).toHaveAttribute("aria-expanded", "true");
    expect(within(primera).getByText("asignado")).toBeInTheDocument();
  });
});
