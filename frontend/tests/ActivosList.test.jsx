import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El inventario: la pantalla que más se abre y desde la que se llega a todo.
 *
 * Lo que se prueba aquí no es que pinte una tabla, sino las tres cosas que se
 * rompen en silencio: que los filtros que vienen en la URL se apliquen de
 * verdad —el panel y las sugerencias enlazan aquí ya filtrados, y si el filtro
 * se ignora el usuario ve el parque entero creyendo que ve el subconjunto—,
 * que la exportación se lleve los filtros vigentes en vez del inventario
 * completo, y que las acciones dependan del permiso.
 */

const listarActivos = vi.fn();
const exportarActivos = vi.fn();
const listarTipos = vi.fn();
const listarDepartamentos = vi.fn();
const listarSedes = vi.fn();

vi.mock("../src/api/activosService", () => ({
  activosService: { list: (...args) => listarActivos(...args) },
  exportacionService: { activos: (...args) => exportarActivos(...args) },
  tiposDispositivoService: { list: (...args) => listarTipos(...args) },
}));

vi.mock("../src/api/organizacionService", () => ({
  departamentosService: { list: (...args) => listarDepartamentos(...args) },
  sedesService: { list: (...args) => listarSedes(...args) },
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const descargar = vi.fn();
vi.mock("../src/utils/descargas", () => ({
  descargarBlob: (...args) => descargar(...args),
}));

const { ActivosList } = await import("../src/pages/Admin/Activos/ActivosList");

const ACTIVOS = [
  {
    id: 7,
    codigo_barras: "GA-LAP-000007",
    nombre: "Laptop Jefatura TI",
    marca: "Dell",
    modelo: "Latitude 5440",
    numero_serie: "DL5440-0011",
    tipo_nombre: "Laptop",
    custodio_nombre: "María Fernanda Salazar Ruiz",
    departamento_nombre: "Tecnología",
    estado: "en_uso",
    estado_display: "Asignado",
    estado_garantia: "vigente",
    total_mantenimientos: 2,
    requiere_renovacion: true,
    nivel_renovacion: "evaluar",
  },
  {
    id: 8,
    codigo_barras: "GA-IMP-000008",
    nombre: "Impresora Bodega",
    marca: "HP",
    modelo: "M404",
    numero_serie: "HP404-0022",
    tipo_nombre: "Impresora",
    custodio_nombre: null,
    departamento_nombre: "Logística",
    estado: "en_bodega",
    estado_display: "En bodega",
    estado_garantia: "vencida",
    total_mantenimientos: 0,
    requiere_renovacion: false,
    nivel_renovacion: "ninguno",
  },
];

function pintar(ruta = "/admin/activos") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <ActivosList />
    </MemoryRouter>,
  );
}

/** Los filtros con los que se hizo la última consulta al backend. */
function ultimaConsulta() {
  return listarActivos.mock.calls.at(-1)[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  listarActivos.mockResolvedValue({
    results: ACTIVOS,
    count: 2,
    next: null,
    previous: null,
  });
  listarTipos.mockResolvedValue({
    results: [
      { id: 1, nombre: "Laptop" },
      { id: 2, nombre: "Impresora" },
    ],
  });
  listarDepartamentos.mockResolvedValue({
    results: [{ id: 3, nombre: "Tecnología" }],
  });
  listarSedes.mockResolvedValue({
    results: [{ id: 4, nombre: "Matriz Quito" }],
  });
});

// --- Lo que la tabla muestra ------------------------------------------------

describe("El listado de activos", () => {
  it("muestra cada equipo con lo que hace falta para reconocerlo", async () => {
    pintar();

    expect(await screen.findByText("Laptop Jefatura TI")).toBeInTheDocument();
    const fila = screen.getByText("GA-LAP-000007").closest("tr");
    expect(fila).toHaveTextContent("Dell Latitude 5440 · DL5440-0011");
    expect(fila).toHaveTextContent("María Fernanda Salazar Ruiz");
    expect(fila).toHaveTextContent("Tecnología");
  });

  it("dice «Sin asignar» en vez de dejar la celda vacía", async () => {
    /* Una celda en blanco se lee como un dato que falta por capturar; que no
       tenga custodio es información, no una omisión. */
    pintar();

    await screen.findByText("Impresora Bodega");
    const fila = screen.getByText("GA-IMP-000008").closest("tr");
    expect(fila).toHaveTextContent("Sin asignar");
  });

  it("marca la sugerencia de renovación solo en los equipos que la tienen", async () => {
    pintar();

    await screen.findByText("Laptop Jefatura TI");
    expect(screen.getByText("GA-IMP-000008").closest("tr")).toHaveTextContent(
      "—",
    );
  });

  it("cada fila lleva a su ficha", async () => {
    pintar();

    await screen.findByText("Laptop Jefatura TI");
    const fila = screen.getByText("GA-LAP-000007").closest("tr");
    expect(fila.querySelector("a")).toHaveAttribute("href", "/admin/activos/7");
  });

  it("sin resultados lo dice, en vez de una tabla vacía sin explicación", async () => {
    listarActivos.mockResolvedValue({ results: [], count: 0 });

    pintar();

    expect(
      await screen.findByText("Sin activos que coincidan con los filtros"),
    ).toBeInTheDocument();
  });

  it("si el inventario no carga lo dice", async () => {
    listarActivos.mockRejectedValue(new Error("500"));

    pintar();

    expect(
      await screen.findByText("No se pudo cargar el inventario."),
    ).toBeInTheDocument();
  });
});

// --- Los filtros ------------------------------------------------------------

describe("Los filtros", () => {
  it("arranca con lo que venga en la URL: se entra aquí ya filtrado", async () => {
    /* El panel principal y las sugerencias de renovación enlazan a este
       listado con el filtro puesto. Si se ignorara, el usuario vería el parque
       entero creyendo que ve los cuatro equipos del indicador. */
    pintar("/admin/activos?estado=en_mantenimiento&nivel_renovacion=evaluar");

    await screen.findByText("Laptop Jefatura TI");
    expect(ultimaConsulta()).toMatchObject({
      estado: "en_mantenimiento",
      nivel_renovacion: "evaluar",
      page: 1,
    });
    // Y el desplegable lo refleja: un filtro activo que no se ve no se puede
    // quitar.
    expect(screen.getByLabelText("Filtrar por estado")).toHaveValue(
      "en_mantenimiento",
    );
  });

  it("los filtros vacíos no viajan al backend", async () => {
    pintar();

    await screen.findByText("Laptop Jefatura TI");
    expect(ultimaConsulta()).toEqual({ page: 1 });
  });

  it("cambiar un filtro vuelve a consultar", async () => {
    pintar();

    await screen.findByText("Laptop Jefatura TI");
    fireEvent.change(screen.getByLabelText("Filtrar por tipo"), {
      target: { value: "2" },
    });

    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ tipo: "2" }));
  });

  it("la antigüedad se pide por tramos y viaja como dos límites en meses", async () => {
    /* El usuario pregunta «cuáles son viejos», no «cuáles tienen entre 36 y 60
       meses»; el tramo se traduce aquí. */
    pintar();

    await screen.findByText("Laptop Jefatura TI");
    fireEvent.change(screen.getByLabelText("Filtrar por antigüedad"), {
      target: { value: "60-" },
    });

    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ antiguedad_min_meses: "60" }),
    );
    expect(ultimaConsulta().antiguedad_max_meses).toBeUndefined();
  });

  it("la búsqueda se envía al confirmar, no en cada tecla", async () => {
    pintar();

    await screen.findByText("Laptop Jefatura TI");
    const llamadasPrevias = listarActivos.mock.calls.length;

    const campo = screen.getByLabelText("Buscar activos");
    fireEvent.change(campo, { target: { value: "DL5440" } });
    expect(listarActivos.mock.calls).toHaveLength(llamadasPrevias);

    fireEvent.submit(campo.closest("form"));
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ q: "DL5440" }),
    );
  });

  it("un código escaneado busca solo, sin pulsar nada", async () => {
    /* La pistola cierra la lectura con Enter: el técnico no tiene una mano
       libre para el botón. */
    pintar();

    await screen.findByText("Laptop Jefatura TI");
    const campo = screen.getByPlaceholderText(/Escanee una etiqueta/);
    fireEvent.change(campo, { target: { value: "GA-LAP-000007" } });
    fireEvent.submit(campo.closest("form"));

    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ q: "GA-LAP-000007" }),
    );
  });

  it("los desplegables se llenan con los catálogos", async () => {
    pintar();

    await screen.findByText("Laptop Jefatura TI");
    expect(
      await screen.findByRole("option", { name: "Matriz Quito" }),
    ).toBeInTheDocument();
    // Solo las sedes abiertas: filtrar por una bodega cerrada no devuelve nada
    // y alarga un desplegable que se consulta a diario.
    expect(listarSedes).toHaveBeenCalledWith(
      expect.objectContaining({ activa: "true" }),
    );
  });

  it("si un catálogo falla, la pantalla sigue sirviendo", async () => {
    /* El inventario es lo que se viene a ver; quedarse sin el desplegable de
       sedes no justifica una pantalla en blanco. */
    listarSedes.mockRejectedValue(new Error("500"));

    pintar();

    expect(await screen.findByText("Laptop Jefatura TI")).toBeInTheDocument();
  });
});

// --- Acciones y permisos ----------------------------------------------------

describe("Las acciones dependen del permiso", () => {
  it("sin permisos solo se puede mirar y escanear", async () => {
    pintar();

    await screen.findByText("Laptop Jefatura TI");
    expect(screen.getByRole("link", { name: /Escanear/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Nuevo activo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Carga masiva/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Exportar/ }),
    ).not.toBeInTheDocument();
  });

  it("quien puede crear ve el alta y la carga masiva", async () => {
    permisos.add("activos.crear");

    pintar();

    await screen.findByText("Laptop Jefatura TI");
    expect(
      screen.getByRole("link", { name: "Nuevo activo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Carga masiva/ }),
    ).toBeInTheDocument();
  });

  it("el botón de exportar dice cuántos se lleva", async () => {
    permisos.add("activos.exportar");

    pintar();

    expect(
      await screen.findByRole("button", { name: /Exportar \(2\)/ }),
    ).toBeInTheDocument();
  });

  it("sin nada que exportar el botón no se puede pulsar", async () => {
    permisos.add("activos.exportar");
    listarActivos.mockResolvedValue({ results: [], count: 0 });

    pintar();

    expect(
      await screen.findByRole("button", { name: /Exportar \(0\)/ }),
    ).toBeDisabled();
  });

  it("exporta lo que se está viendo, no el inventario entero", async () => {
    /* Es el punto del botón: quien filtró por área y estado espera ese
       archivo. Mandar el inventario completo obligaría a filtrar otra vez en
       Excel, sobre columnas que ya no traen los mismos nombres. */
    permisos.add("activos.exportar");
    exportarActivos.mockResolvedValue(new Blob(["x"]));

    pintar("/admin/activos?estado=en_bodega");

    fireEvent.click(await screen.findByRole("button", { name: /Exportar/ }));

    await waitFor(() =>
      expect(exportarActivos).toHaveBeenCalledWith({ estado: "en_bodega" }),
    );
    expect(descargar).toHaveBeenCalledWith(
      expect.any(Blob),
      "inventario-activos.xlsx",
    );
  });

  it("si la exportación falla lo dice y el botón vuelve a servir", async () => {
    permisos.add("activos.exportar");
    exportarActivos.mockRejectedValue(new Error("500"));

    pintar();

    fireEvent.click(await screen.findByRole("button", { name: /Exportar/ }));

    expect(
      await screen.findByText("No se pudo exportar el inventario."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exportar/ })).toBeEnabled();
  });
});
