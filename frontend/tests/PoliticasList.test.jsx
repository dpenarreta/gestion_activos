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
 * Políticas de renovación (§11): cuándo el sistema sugiere reemplazar un
 * equipo.
 *
 * La distinción que sostiene todo el módulo —y la más fácil de romper sin
 * notarlo— es que un umbral vacío significa «no evaluar este criterio» y un
 * cero significa «dispara siempre». Se muestra así en la tabla, se explica en
 * el formulario y se traduce a `null` al enviarlo. Si cualquiera de esos tres
 * eslabones se cae, la pantalla sigue pareciendo correcta mientras el
 * inventario entero se marca —o deja de marcarse— para reemplazo.
 */

const listar = vi.fn();
const crear = vi.fn();
const actualizarPolitica = vi.fn();
const eliminar = vi.fn();
const reevaluar = vi.fn();
const listarTipos = vi.fn();

vi.mock("../src/api/politicasService", () => ({
  politicasService: {
    list: (...args) => listar(...args),
    create: (...args) => crear(...args),
    update: (...args) => actualizarPolitica(...args),
    remove: (...args) => eliminar(...args),
    reevaluar: (...args) => reevaluar(...args),
  },
}));

vi.mock("../src/api/activosService", () => ({
  tiposDispositivoService: { list: (...args) => listarTipos(...args) },
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { PoliticasList } =
  await import("../src/pages/Admin/Politicas/PoliticasList");

const GLOBAL = {
  id: 1,
  nombre: "Política general",
  es_global: true,
  tipo_dispositivo: null,
  tipo_dispositivo_nombre: null,
  max_mantenimientos: 3,
  ventana_mantenimientos_meses: 12,
  max_componentes_criticos: 2,
  vida_util_meses: 48,
  vida_util_critica_meses: 60,
  activa: true,
};

const DE_TIPO = {
  id: 2,
  nombre: "Laptops corporativas",
  es_global: false,
  tipo_dispositivo: 5,
  tipo_dispositivo_nombre: "Laptop",
  max_mantenimientos: 4,
  ventana_mantenimientos_meses: null,
  // Sin límite de piezas críticas: no se evalúa ese criterio.
  max_componentes_criticos: null,
  vida_util_meses: 36,
  vida_util_critica_meses: null,
  activa: false,
};

function pintar() {
  return render(
    <MemoryRouter>
      <PoliticasList />
    </MemoryRouter>,
  );
}

/** Abre el diálogo de alta y espera a que esté en pantalla. */
async function abrirAlta() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Nueva política" }),
  );
  return screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  listar.mockResolvedValue({ results: [GLOBAL, DE_TIPO], count: 2 });
  listarTipos.mockResolvedValue({
    results: [
      { id: 5, nombre: "Laptop" },
      { id: 6, nombre: "Impresora" },
    ],
  });
  crear.mockResolvedValue({ id: 3 });
  actualizarPolitica.mockResolvedValue({ id: 1 });
  eliminar.mockResolvedValue({});
  reevaluar.mockResolvedValue({
    activos_evaluados: 16,
    con_sugerencia: 5,
    por_nivel: { recomendado: 2, evaluar: 3 },
  });
});

// --- Lo que la tabla dice ---------------------------------------------------

describe("El listado de políticas", () => {
  it("un umbral sin definir se lee «no evalúa», nunca como cero", async () => {
    /* Es la confusión que el módulo entero intenta evitar: un cero en «máx.
       piezas críticas» marcaría todos los equipos para reemplazo. */
    pintar();

    const fila = (await screen.findByText("Laptops corporativas")).closest(
      "tr",
    );
    expect(within(fila).getAllByText("no evalúa")).toHaveLength(2);
    expect(fila).not.toHaveTextContent("0");
  });

  it("el máximo de reparaciones viene con el periodo en que se cuentan", async () => {
    /* «3 mantenimientos» significa algo muy distinto en 12 meses que en toda
       la vida del equipo. */
    pintar();

    const global = (await screen.findByText("Política general")).closest("tr");
    expect(global).toHaveTextContent("en 12 meses");

    const deTipo = screen.getByText("Laptops corporativas").closest("tr");
    expect(deTipo).toHaveTextContent("histórico");
  });

  it("distingue la global de la de un tipo concreto", async () => {
    pintar();

    await screen.findByText("Política general");
    expect(
      screen.getByText("Política general").closest("tr"),
    ).toHaveTextContent("Global");
    expect(
      screen.getByText("Laptops corporativas").closest("tr"),
    ).toHaveTextContent("Laptop");
  });

  it("una política inactiva se distingue de una vigente", async () => {
    pintar();

    await screen.findByText("Laptops corporativas");
    expect(screen.getByText("Inactiva")).toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
  });

  it("sin política global avisa de lo que eso implica", async () => {
    /* Los tipos sin política propia dejan de evaluarse en silencio: la
       pantalla se ve normal y ninguna sugerencia vuelve a aparecer. */
    listar.mockResolvedValue({ results: [DE_TIPO], count: 1 });

    pintar();

    expect(
      await screen.findByText(/No hay una política global/),
    ).toBeInTheDocument();
  });

  it("con global, ese aviso no aparece", async () => {
    pintar();

    await screen.findByText("Política general");
    expect(
      screen.queryByText(/No hay una política global/),
    ).not.toBeInTheDocument();
  });

  it("sin ninguna política dice que nada se evaluará", async () => {
    listar.mockResolvedValue({ results: [], count: 0 });

    pintar();

    expect(
      await screen.findByText(/Ningún equipo mostrará sugerencias/),
    ).toBeInTheDocument();
  });

  it("si el listado no carga lo dice", async () => {
    listar.mockRejectedValue(new Error("500"));

    pintar();

    expect(
      await screen.findByText("No se pudo cargar el listado de políticas."),
    ).toBeInTheDocument();
  });
});

// --- Permisos ---------------------------------------------------------------

describe("Quién puede tocarlas", () => {
  it("sin permiso se consultan, pero no se cambian", async () => {
    pintar();

    await screen.findByText("Política general");
    expect(
      screen.queryByRole("button", { name: "Nueva política" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Editar" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reevaluar inventario" }),
    ).not.toBeInTheDocument();
  });

  it("con permiso aparecen el alta, la edición y la reevaluación", async () => {
    permisos.add("politicas.editar");

    pintar();

    await screen.findByText("Política general");
    expect(
      screen.getByRole("button", { name: "Nueva política" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(2);
  });
});

// --- El formulario ----------------------------------------------------------

describe("Al definir una política", () => {
  beforeEach(() => permisos.add("politicas.editar"));

  it("explica la diferencia entre vacío y cero donde se captura", async () => {
    pintar();
    await abrirAlta();

    expect(screen.getByText(/desactiva ese criterio/)).toBeInTheDocument();
  });

  it("una política sin ningún umbral no se puede guardar", async () => {
    /* No evaluaría nada: existiría en el listado aparentando cubrir un tipo
       que en realidad quedó sin criterio. */
    pintar();
    const dialogo = await abrirAlta();

    expect(
      within(dialogo).getByText(/Defina al menos un umbral/),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByRole("button", { name: "Confirmar" }),
    ).toBeDisabled();
  });

  it("el segundo nivel no puede ser anterior al primero", async () => {
    /* Al revés, «recomendar» absorbería a «evaluar» y el primer aviso —el que
       da tiempo a presupuestar— no llegaría nunca. */
    pintar();
    const dialogo = await abrirAlta();

    fireEvent.change(screen.getByLabelText("Evaluar reemplazo a los (meses)"), {
      target: { value: "60" },
    });
    fireEvent.change(
      screen.getByLabelText("Recomendar reemplazo a los (meses)"),
      { target: { value: "48" } },
    );

    expect(
      within(dialogo).getByText(/El segundo nivel debe ser posterior/),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByRole("button", { name: "Confirmar" }),
    ).toBeDisabled();
  });

  it("la ventana de conteo sin un máximo no significa nada", async () => {
    pintar();
    const dialogo = await abrirAlta();

    fireEvent.change(screen.getByLabelText("Contados en los últimos (meses)"), {
      target: { value: "12" },
    });

    expect(
      within(dialogo).getByText(/solo tiene sentido junto a un máximo/),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByRole("button", { name: "Confirmar" }),
    ).toBeDisabled();
  });

  it("los umbrales del documento se ofrecen como atajo, no como valor por defecto", async () => {
    /* Rellenar el que falta es distinto de imponerle a la empresa unos
       umbrales que no eligió. */
    pintar();
    await abrirAlta();

    expect(
      screen.getByLabelText("Evaluar reemplazo a los (meses)"),
    ).toHaveValue(null);

    fireEvent.click(
      screen.getByRole("button", { name: /Usar los umbrales del documento/ }),
    );

    expect(
      screen.getByLabelText("Evaluar reemplazo a los (meses)"),
    ).toHaveValue(48);
    expect(
      screen.getByLabelText("Recomendar reemplazo a los (meses)"),
    ).toHaveValue(60);
    expect(screen.getByLabelText("Máx. mantenimientos")).toHaveValue(3);
  });

  it("un umbral vacío viaja como nulo y uno lleno como número", async () => {
    /* La cadena vacía es lo que el formulario tiene; el backend entiende
       `null` como «criterio desactivado» y un 0 como «siempre». */
    pintar();
    const dialogo = await abrirAlta();

    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Impresoras" },
    });
    fireEvent.change(screen.getByLabelText("Se aplica a"), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByLabelText("Evaluar reemplazo a los (meses)"), {
      target: { value: "48" },
    });

    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0]).toEqual({
      nombre: "Impresoras",
      tipo_dispositivo: "6",
      vida_util_meses: 48,
      vida_util_critica_meses: null,
      max_mantenimientos: null,
      ventana_mantenimientos_meses: null,
      max_componentes_criticos: null,
      activa: true,
    });
  });

  it("no ofrece crear una segunda política global", async () => {
    /* Solo puede haber una: elegirla produciría un error de restricción justo
       al guardar. */
    pintar();
    await abrirAlta();

    expect(
      screen.getByRole("option", { name: /ya existe una/ }),
    ).toBeDisabled();
  });

  it("editar la global sí permite dejarla global", async () => {
    pintar();

    await screen.findByText("Política general");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]);

    expect(
      await screen.findByRole("option", {
        name: "Todos los tipos (política global)",
      }),
    ).toBeEnabled();
  });

  it("editar guarda sobre la política abierta y recarga el listado", async () => {
    pintar();

    await screen.findByText("Política general");
    const llamadasPrevias = listar.mock.calls.length;
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]);

    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(actualizarPolitica).toHaveBeenCalled());
    expect(actualizarPolitica.mock.calls[0][0]).toBe(1);
    await waitFor(() =>
      expect(listar.mock.calls.length).toBeGreaterThan(llamadasPrevias),
    );
  });

  it("si el servidor rechaza la política, el diálogo se queda con lo escrito", async () => {
    crear.mockRejectedValue({
      response: {
        data: { error: { message: "Ya existe una para ese tipo." } },
      },
    });

    pintar();
    const dialogo = await abrirAlta();

    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Impresoras" },
    });
    fireEvent.change(screen.getByLabelText("Evaluar reemplazo a los (meses)"), {
      target: { value: "48" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText("Ya existe una para ese tipo."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Impresoras");
  });
});

// --- Eliminar y reevaluar ---------------------------------------------------

describe("Las acciones que cambian el inventario", () => {
  beforeEach(() => permisos.add("politicas.editar"));

  it("eliminar la global advierte que las alertas se apagan", async () => {
    pintar();

    await screen.findByText("Política general");
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[0]);

    expect(
      await screen.findByText(/sus alertas se apagarán/),
    ).toBeInTheDocument();
  });

  it("eliminar la de un tipo dice a qué pasan a regirse sus equipos", async () => {
    pintar();

    await screen.findByText("Laptops corporativas");
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[1]);

    expect(
      await screen.findByText(/Los activos de Laptop pasarán a regirse/),
    ).toBeInTheDocument();
  });

  it("confirmada, se elimina y el listado se rehace", async () => {
    pintar();

    await screen.findByText("Laptops corporativas");
    const llamadasPrevias = listar.mock.calls.length;
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[1]);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(eliminar).toHaveBeenCalledWith(2));
    await waitFor(() =>
      expect(listar.mock.calls.length).toBeGreaterThan(llamadasPrevias),
    );
  });

  it("si no se puede eliminar, lo dice y cierra la pregunta", async () => {
    eliminar.mockRejectedValue(new Error("500"));

    pintar();

    await screen.findByText("Laptops corporativas");
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[1]);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText("No se pudo eliminar la política."),
    ).toBeInTheDocument();
  });

  it("reevaluar dice cuántos equipos quedaron en cada nivel", async () => {
    /* Es una acción sin pantalla propia: sin un resumen, no habría forma de
       saber si hizo algo. */
    pintar();

    fireEvent.click(
      await screen.findByRole("button", { name: "Reevaluar inventario" }),
    );

    expect(
      await screen.findByText(
        /16 activo\(s\) evaluados; 5 con sugerencia \(2 con reemplazo recomendado, 3 a evaluar\)/,
      ),
    ).toBeInTheDocument();
  });

  it("el resumen se puede cerrar", async () => {
    pintar();

    fireEvent.click(
      await screen.findByRole("button", { name: "Reevaluar inventario" }),
    );
    await screen.findByText(/16 activo\(s\) evaluados/);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(
      screen.queryByText(/16 activo\(s\) evaluados/),
    ).not.toBeInTheDocument();
  });

  it("si la reevaluación falla, lo dice", async () => {
    reevaluar.mockRejectedValue(new Error("500"));

    pintar();

    fireEvent.click(
      await screen.findByRole("button", { name: "Reevaluar inventario" }),
    );

    expect(
      await screen.findByText("No se pudo reevaluar el inventario."),
    ).toBeInTheDocument();
  });
});
