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
const listarCategorias = vi.fn();
const listarTipos = vi.fn();
const listarDepartamentos = vi.fn();
const listarSedes = vi.fn();

vi.mock("../src/api/activosService", () => ({
  activosService: { list: (...args) => listarActivos(...args) },
  categoriasActivoService: { list: (...args) => listarCategorias(...args) },
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
    responsables_resumen: "María Fernanda Salazar Ruiz",
    departamento_nombre: "Tecnología",
    estado: "en_uso",
    estado_display: "Asignado",
    esta_operativo: true,
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
    responsables_resumen: "",
    departamento_nombre: "Logística",
    estado: "dado_de_baja",
    estado_display: "Dado de baja",
    esta_operativo: false,
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

/** Despliega el panel de filtros, que desde ahora arranca plegado. */
function abrirFiltros() {
  fireEvent.click(screen.getByRole("button", { name: /Filtros/ }));
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
  listarCategorias.mockResolvedValue({
    results: [
      { id: 10, nombre: "Hardware" },
      { id: 11, nombre: "Software" },
    ],
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
      await screen.findByText("Todavía no hay activos registrados."),
    ).toBeInTheDocument();
  });

  // Auditoría UX/UI, fase 2 (28/10/2026): con filtros, el vacío es de los
  // filtros y se ofrece quitarlos ahí mismo.
  it("vacío por los filtros lo dice y deja limpiarlos", async () => {
    listarActivos.mockResolvedValue({ results: [], count: 0 });

    pintar("/admin/activos?estado=en_reparacion");

    expect(
      await screen.findByText("Ningún resultado con estos filtros."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));

    await waitFor(() =>
      expect(listarActivos).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ estado: "en_reparacion" }),
      ),
    );
  });

  it("las dos búsquedas se distinguen por su nombre", async () => {
    pintar();

    expect(
      screen.getByRole("search", { name: "Buscar por código con el escáner" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("search", { name: "Filtrar el inventario" }),
    ).toBeInTheDocument();
    await screen.findAllByRole("row");
  });

  it("si el inventario no carga lo dice", async () => {
    listarActivos.mockRejectedValue(new Error("500"));

    pintar();

    expect(
      await screen.findByText("No se pudo cargar el inventario."),
    ).toBeInTheDocument();
    // Y deja reintentar sin recargar la página.
    listarActivos.mockResolvedValue({ results: [], count: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByText("Todavía no hay activos registrados."),
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
    abrirFiltros();
    fireEvent.change(screen.getByLabelText("Filtrar por tipo"), {
      target: { value: "2" },
    });

    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ tipo: "2" }));
  });

  it("se filtra por de quién es el equipo", async () => {
    /* «Qué es nuestro» y «qué hay que devolverle al partner» son las dos
       preguntas que se hacen al cerrar una concesión o al valorar el parque. */
    pintar();

    await screen.findByText("Laptop Jefatura TI");
    abrirFiltros();
    fireEvent.change(screen.getByLabelText("Filtrar por propiedad"), {
      target: { value: "concesion" },
    });

    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ propiedad: "concesion" }),
    );
  });

  it("volver a «toda» suelta también al partner elegido", async () => {
    /* El partner solo acota dentro de lo suyo: dejarlo puesto daría una lista
       siempre vacía y sin nada visible que lo explicara. */
    pintar("/admin/activos?propiedad=concesion&concesionario=5");

    await screen.findByText("Laptop Jefatura TI");
    expect(ultimaConsulta()).toMatchObject({ concesionario: "5" });

    fireEvent.change(screen.getByLabelText("Filtrar por propiedad"), {
      target: { value: "" },
    });

    await waitFor(() => expect(ultimaConsulta().concesionario).toBeUndefined());
  });

  it("la antigüedad se pide por tramos y viaja como dos límites en meses", async () => {
    /* El usuario pregunta «cuáles son viejos», no «cuáles tienen entre 36 y 60
       meses»; el tramo se traduce aquí. */
    pintar();

    await screen.findByText("Laptop Jefatura TI");
    abrirFiltros();
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
    abrirFiltros();
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

// --- La pistola mal configurada ---------------------------------------------

describe("Cuando el lector envía otra distribución de teclado", () => {
  it("avisa de que hay que reconfigurar la pistola", async () => {
    /* El backend repara el código y encuentra el equipo, pero lo dice:
       callarlo dejaría la pistola mal configurada, y el mismo problema
       reaparecería en la carga masiva, donde no hay nadie que lo repare. */
    listarActivos.mockResolvedValue({
      results: ACTIVOS,
      count: 2,
      next: null,
      previous: null,
      advertencia_lector: {
        codigo: "distribucion_de_teclado",
        recibido: "GA'LAP'000007",
        interpretado: "GA-LAP-000007",
        mensaje:
          "El lector envió «GA'LAP'000007» y se interpretó como «GA-LAP-000007».",
      },
    });

    pintar();

    expect(
      await screen.findByText(/Revise la configuración del lector/),
    ).toBeInTheDocument();
  });

  it("un listado normal no dice nada del lector", async () => {
    pintar();

    await screen.findByText("Laptop Jefatura TI");
    expect(
      screen.queryByText(/Revise la configuración del lector/),
    ).not.toBeInTheDocument();
  });
});

// --- Llegar a la ficha y actuar sin entrar en ella ---------------------------

describe("Lo que se puede hacer desde una fila", () => {
  it("el nombre del equipo lleva a su ficha", async () => {
    /* Antes el único camino era un botón al final de la fila: el nombre, que
       es lo que uno mira, no llevaba a ninguna parte. */
    pintar();

    const enlace = await screen.findByRole("link", {
      name: "Laptop Jefatura TI",
    });
    expect(enlace).toHaveAttribute("href", "/admin/activos/7");
  });

  it("quien asigna puede hacerlo desde el listado, en un clic", async () => {
    /* Lleva a la ficha con el diálogo ya abierto: la acción se confirma donde
       está el contexto del equipo, pero sin los tres clics de antes. */
    permisos.add("activos.asignar");

    pintar();
    await screen.findByText("Laptop Jefatura TI");

    expect(
      screen.getByRole("link", {
        name: /Asignar o trasladar Laptop Jefatura TI/,
      }),
    ).toHaveAttribute("href", "/admin/activos/7?accion=asignar");
  });

  it("no se ofrece asignar un equipo que ya salió del parque", async () => {
    /* El servidor lo rechaza, pero después de que alguien abriera el
       formulario y eligiera custodio. */
    permisos.add("activos.asignar");

    pintar();
    await screen.findByText("Impresora Bodega");

    expect(
      screen.queryByRole("link", {
        name: /Asignar o trasladar Impresora Bodega/,
      }),
    ).not.toBeInTheDocument();
  });

  it("sin permisos no aparece ninguna acción rápida", async () => {
    pintar();
    await screen.findByText("Laptop Jefatura TI");

    expect(
      screen.queryByRole("link", { name: /Asignar o trasladar/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Cambiar el estado/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Imprimir la etiqueta/ }),
    ).not.toBeInTheDocument();
  });

  it("la búsqueda de la cabecera llega con su texto ya aplicado", async () => {
    /* El buscador global manda aquí lo que no era la etiqueta de nadie, y el
       campo tiene que mostrarlo: en blanco parecería que no se buscó nada. */
    pintar("/admin/activos?q=jefatura");

    await screen.findByText("Laptop Jefatura TI");
    expect(ultimaConsulta()).toEqual(
      expect.objectContaining({ q: "jefatura" }),
    );
  });
});

// --- Qué se está filtrando ---------------------------------------------------

describe("Los filtros se pliegan y dicen qué se aplicó", () => {
  it("arrancan plegados: la tabla es a lo que se viene", async () => {
    pintar();
    await screen.findByText("Laptop Jefatura TI");

    expect(screen.queryByLabelText("Filtrar por tipo")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filtros/ })).toBeInTheDocument();
  });

  it("se abren al pedirlo", async () => {
    pintar();
    await screen.findByText("Laptop Jefatura TI");

    fireEvent.click(screen.getByRole("button", { name: /Filtros/ }));

    expect(screen.getByLabelText("Filtrar por tipo")).toBeInTheDocument();
  });

  it("si se llega ya filtrado desde otra pantalla, se abren solos", async () => {
    /* Quien llega aquí desde «garantías vencidas» del panel tiene que poder
       ver y corregir qué se aplicó, no adivinarlo. */
    pintar("/admin/activos?garantia=vencida");
    await screen.findByText("Laptop Jefatura TI");

    expect(screen.getByLabelText("Filtrar por garantía")).toBeInTheDocument();
  });

  it("cada filtro aplicado se nombra y se puede quitar solo", async () => {
    /* Con nueve desplegables, mirar cuál quedó en algo distinto de «todos»
       obliga a repasarlos uno a uno: es la causa más común de «el inventario
       no me muestra un equipo que sé que está». */
    pintar("/admin/activos?garantia=vencida&estado=en_uso");
    await screen.findByText("Laptop Jefatura TI");

    expect(screen.getByTitle("Quitar el filtro Garantía")).toHaveTextContent(
      "Vencida",
    );
    expect(screen.getByTitle("Quitar el filtro Estado")).toHaveTextContent(
      "Asignado",
    );

    fireEvent.click(screen.getByTitle("Quitar el filtro Garantía"));

    await waitFor(() =>
      expect(ultimaConsulta()).toEqual(
        expect.objectContaining({ estado: "en_uso" }),
      ),
    );
    expect(ultimaConsulta().garantia).toBeUndefined();
  });

  it("«limpiar todo» deja el listado sin filtros", async () => {
    pintar("/admin/activos?garantia=vencida&estado=en_uso");
    await screen.findByText("Laptop Jefatura TI");

    fireEvent.click(screen.getByRole("button", { name: "Limpiar todo" }));

    await waitFor(() => {
      const consulta = ultimaConsulta();
      expect(consulta.garantia).toBeUndefined();
      expect(consulta.estado).toBeUndefined();
    });
  });

  it("sin filtros no hay nada que explicar", async () => {
    pintar();
    await screen.findByText("Laptop Jefatura TI");

    expect(
      screen.queryByRole("button", { name: "Limpiar todo" }),
    ).not.toBeInTheDocument();
  });
});
