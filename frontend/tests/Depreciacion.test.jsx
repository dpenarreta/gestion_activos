import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Depreciación (§22.3): qué vale hoy el parque.
 *
 * Es depreciación de gestión, no contabilidad —eso lo lleva el ERP—, y toda la
 * pantalla gira alrededor de una distinción que se confunde sola: la vida
 * contable no es la vida útil de la política de renovación. Un equipo se
 * deprecia en tres años y se reemplaza a los cuatro o cinco; confundirlas
 * dejaría que la contabilidad decidiera cuándo se compra.
 */

const listar = vi.fn();
const crear = vi.fn();
const actualizar = vi.fn();
const eliminar = vi.fn();
const listarTipos = vi.fn();

vi.mock("../src/api/politicasService", () => ({
  depreciacionService: {
    list: (...args) => listar(...args),
    create: (...args) => crear(...args),
    update: (...args) => actualizar(...args),
    remove: (...args) => eliminar(...args),
  },
  politicasService: {
    list: vi.fn(() => Promise.resolve({ results: [], count: 0 })),
    sugerencias: vi.fn(),
    reevaluar: vi.fn(),
  },
}));

vi.mock("../src/api/activosService", () => ({
  tiposDispositivoService: { list: (...args) => listarTipos(...args) },
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { DepreciacionPanel } =
  await import("../src/pages/Admin/Politicas/DepreciacionPanel");
const { PoliticasPage } =
  await import("../src/pages/Admin/Politicas/PoliticasPage");
const { UnsavedChangesProvider } =
  await import("../src/context/UnsavedChangesContext");

const GLOBAL = {
  id: 1,
  nombre: "Equipos de cómputo",
  es_global: true,
  tipo_dispositivo: null,
  tipo_dispositivo_nombre: null,
  meses_vida_contable: 36,
  porcentaje_residual: "0.00",
  activa: true,
};

const DE_TIPO = {
  id: 2,
  nombre: "Servidores",
  es_global: false,
  tipo_dispositivo: 5,
  tipo_dispositivo_nombre: "Servidor",
  meses_vida_contable: 60,
  porcentaje_residual: "10.00",
  activa: true,
};

function pintar() {
  return render(
    <MemoryRouter>
      <DepreciacionPanel />
    </MemoryRouter>,
  );
}

/** Abre el diálogo de alta y espera a que esté en pantalla. */
async function abrirAlta() {
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Nueva política de depreciación",
    }),
  );
  return screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  listar.mockResolvedValue({ results: [GLOBAL, DE_TIPO], count: 2 });
  listarTipos.mockResolvedValue({
    results: [{ id: 5, nombre: "Servidor" }],
  });
  crear.mockResolvedValue({ id: 3 });
  actualizar.mockResolvedValue({ id: 1 });
  eliminar.mockResolvedValue({});
});

// --- Lo que la tabla dice ---------------------------------------------------

describe("El listado de políticas de depreciación", () => {
  it("dice la vida contable en años, no en un número suelto de meses", async () => {
    pintar();

    const fila = (await screen.findByText("Servidores")).closest("tr");
    expect(fila).toHaveTextContent("5 años");
    expect(fila).toHaveTextContent("10.00 %");
  });

  it("sin valor residual lo dice en vez de un cero ambiguo", async () => {
    /* Es el caso normal en equipo de cómputo: se deprecia por completo. */
    pintar();

    const fila = (await screen.findByText("Equipos de cómputo")).closest("tr");
    expect(within(fila).getByText("Sin residual")).toBeInTheDocument();
  });

  it("advierte que la vida contable no es la de renovación", async () => {
    /* Es la confusión que el módulo entero intenta evitar. */
    pintar();

    expect(
      await screen.findByText(
        /No es la vida útil de la política de renovación/,
      ),
    ).toBeInTheDocument();
  });

  it("sin política global avisa de lo que eso implica", async () => {
    listar.mockResolvedValue({ results: [DE_TIPO], count: 1 });

    pintar();

    expect(
      await screen.findByText(/No hay una política global/),
    ).toHaveTextContent("saldrá con esas columnas vacías");
  });

  it("sin ninguna política dice que nadie mostrará valor en libros", async () => {
    listar.mockResolvedValue({ results: [], count: 0 });

    pintar();

    expect(
      await screen.findByText(/Ningún equipo mostrará valor en libros/),
    ).toBeInTheDocument();
  });

  it("sin permiso se consulta, no se cambia", async () => {
    pintar();

    await screen.findByText("Equipos de cómputo");
    expect(
      screen.queryByRole("button", { name: "Nueva política de depreciación" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Editar" }),
    ).not.toBeInTheDocument();
  });

  it("si no cargan, lo dice", async () => {
    listar.mockRejectedValue(new Error("500"));

    pintar();

    expect(
      await screen.findByText(
        "No se pudo cargar el listado de políticas de depreciación.",
      ),
    ).toBeInTheDocument();
  });
});

// --- El formulario ----------------------------------------------------------

describe("Al definir una política de depreciación", () => {
  beforeEach(() => permisos.add("politicas.editar"));

  it("una vida de cero meses no se puede guardar", async () => {
    /* La cuota mensual sería una división por cero. Para dejar de depreciar un
       tipo está la casilla de activa, que es reversible. */
    pintar();
    const dialogo = await abrirAlta();

    fireEvent.change(within(dialogo).getByLabelText("Vida contable (meses)"), {
      target: { value: "0" },
    });

    expect(
      within(dialogo).getByText(/debe ser de al menos un mes/),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByRole("button", { name: "Confirmar" }),
    ).toBeDisabled();
  });

  it("un residual del cien por ciento tampoco", async () => {
    /* Un equipo que conserva todo su valor no se deprecia nunca: sería una
       política que existe y no hace nada. */
    pintar();
    const dialogo = await abrirAlta();

    fireEvent.change(within(dialogo).getByLabelText("Valor residual (%)"), {
      target: { value: "100" },
    });

    expect(within(dialogo).getByText(/entre 0 y 99,99/)).toBeInTheDocument();
    expect(
      within(dialogo).getByRole("button", { name: "Confirmar" }),
    ).toBeDisabled();
  });

  it("propone 36 meses, que es lo del equipo de cómputo", async () => {
    pintar();
    const dialogo = await abrirAlta();

    expect(within(dialogo).getByLabelText("Vida contable (meses)")).toHaveValue(
      36,
    );
  });

  it("no ofrece crear una segunda política global", async () => {
    pintar();
    const dialogo = await abrirAlta();

    expect(
      within(dialogo).getByRole("option", { name: /ya existe una/ }),
    ).toBeDisabled();
  });

  it("guarda el tipo vacío como nulo, que es lo que significa global", async () => {
    listar.mockResolvedValue({ results: [DE_TIPO], count: 1 });

    pintar();
    const dialogo = await abrirAlta();

    fireEvent.change(within(dialogo).getByLabelText("Nombre"), {
      target: { value: "General" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0]).toMatchObject({
      nombre: "General",
      tipo_dispositivo: null,
      meses_vida_contable: 36,
      activa: true,
    });
  });

  it("editar guarda sobre la política abierta y rehace el listado", async () => {
    pintar();

    await screen.findByText("Equipos de cómputo");
    const llamadasPrevias = listar.mock.calls.length;
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]);

    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Vida contable (meses)"), {
      target: { value: "48" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(actualizar).toHaveBeenCalled());
    expect(actualizar.mock.calls[0][0]).toBe(1);
    expect(actualizar.mock.calls[0][1].meses_vida_contable).toBe(48);
    await waitFor(() =>
      expect(listar.mock.calls.length).toBeGreaterThan(llamadasPrevias),
    );
  });

  it("si el servidor la rechaza, el diálogo conserva lo escrito", async () => {
    crear.mockRejectedValue({
      response: {
        data: { error: { message: "Ya existe una política global." } },
      },
    });
    listar.mockResolvedValue({ results: [DE_TIPO], count: 1 });

    pintar();
    const dialogo = await abrirAlta();

    fireEvent.change(within(dialogo).getByLabelText("Nombre"), {
      target: { value: "General" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText("Ya existe una política global."),
    ).toBeInTheDocument();
    expect(within(dialogo).getByLabelText("Nombre")).toHaveValue("General");
  });

  it("eliminar dice a qué pasan a depreciarse esos equipos", async () => {
    pintar();

    await screen.findByText("Servidores");
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[1]);

    expect(
      await screen.findByText(/Los activos de Servidor pasarán a depreciarse/),
    ).toBeInTheDocument();
  });

  it("eliminar la global advierte que nadie mostrará valor en libros", async () => {
    pintar();

    await screen.findByText("Equipos de cómputo");
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[0]);

    expect(
      await screen.findByText(/dejarán de mostrar valor en libros/),
    ).toBeInTheDocument();
  });
});

// --- Las dos reglas, juntas -------------------------------------------------

describe("Las políticas del parque", () => {
  function pintarPagina(seccion) {
    return render(
      <MemoryRouter
        initialEntries={[
          seccion === "depreciacion"
            ? "/admin/politicas/depreciacion"
            : "/admin/politicas",
        ]}
      >
        <UnsavedChangesProvider>
          <Routes>
            <Route path="/admin/politicas" element={<PoliticasPage />} />
            <Route
              path="/admin/politicas/depreciacion"
              element={<PoliticasPage seccion="depreciacion" />}
            />
          </Routes>
        </UnsavedChangesProvider>
      </MemoryRouter>,
    );
  }

  it("renovación y depreciación viven a un clic una de otra", async () => {
    /* Las dos parten de «cuánto dura un equipo» y se responden con números
       distintos a propósito: en pantallas separadas se confundirían más. */
    pintarPagina();

    expect(
      await screen.findByRole("tab", { name: "Renovación" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tab", { name: "Depreciación" }),
    ).toBeInTheDocument();
  });

  it("cada pestaña muestra lo suyo", async () => {
    pintarPagina("depreciacion");

    expect(
      await screen.findByRole("tab", { name: "Depreciación" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByText("Cuánto vale en libros cada tipo de equipo"),
    ).toBeInTheDocument();
  });
});
