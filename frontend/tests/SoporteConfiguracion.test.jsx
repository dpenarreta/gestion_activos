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
 * Configuración → Mesa de ayuda (auditoría UX/UI, 30/10/2026): un solo modo
 * de guardar con aviso, casillas en lugar de selectores múltiples, casos que
 * se editan en su ventana, tiempos en horas y minutos y la alerta de las
 * categorías sin técnicos.
 */

const datos = {
  categorias: [],
  niveles: [],
  tecnicos: [],
  sla: [],
  respuestas: [],
};
const servicio = {
  config: {
    listar: vi.fn((recurso) => Promise.resolve(datos[recurso] ?? [])),
    crear: vi.fn(() => Promise.resolve({})),
    actualizar: vi.fn(() => Promise.resolve({})),
    eliminar: vi.fn(() => Promise.resolve({})),
    personas: vi.fn(() =>
      Promise.resolve([
        { id: 1, nombre: "Diana Ruiz" },
        { id: 2, nombre: "Jorge Andrade" },
      ]),
    ),
  },
};
vi.mock("../src/api/soporteService", () => ({ soporteService: servicio }));
vi.mock("../src/api/client", () => ({
  apiClient: {
    get: vi.fn(() =>
      Promise.resolve({ data: [{ id: 7, nombre: "Talento Humano" }] }),
    ),
  },
}));

const { CategoriasSoporte, EquipoSoporte, SlaSoporte } =
  await import("../src/pages/Soporte/Configuracion/ConfiguracionSoporte");

function pintar(elemento) {
  return render(<MemoryRouter>{elemento}</MemoryRouter>);
}

const CASO = {
  id: 11,
  codigo: "",
  nombre: "No enciende",
  tipo: "incidente",
  prioridad: "alta",
  nivel_inicial: null,
  minutos_plazo: null,
  aprueba_jefe_area: false,
  aprueban: [],
  activo: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  datos.categorias = [
    {
      id: 3,
      nombre: "Hardware",
      activa: true,
      tecnicos: [{ id: 1, nombre: "Jorge Andrade" }],
      casos: [CASO],
    },
    { id: 4, nombre: "Accesos", activa: true, tecnicos: [], casos: [] },
  ];
  datos.niveles = [
    { id: 1, orden: 1, nombre: "Mesa de ayuda", supervisores: [] },
  ];
  datos.tecnicos = [];
  datos.sla = [];
});

describe("Categorías y casos", () => {
  it("avisa de las categorías sin técnicos", async () => {
    pintar(<CategoriasSoporte />);
    expect(
      await screen.findByText(
        /«Accesos» no tiene técnicos: sus tickets no se reparten\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Equipo" })).toHaveAttribute(
      "href",
      "/admin/configuracion/soporte",
    );
  });

  it("un caso se edita en su ventana y se guarda con un botón", async () => {
    pintar(<CategoriasSoporte />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Editar el caso No enciende" }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Editar el caso «No enciende»",
    });
    // Cambiar un valor no guarda nada todavía.
    fireEvent.change(within(ventana).getByLabelText("Prioridad base"), {
      target: { value: "critica" },
    });
    fireEvent.change(within(ventana).getByLabelText("Horas"), {
      target: { value: "1" },
    });
    fireEvent.change(within(ventana).getByLabelText("Minutos"), {
      target: { value: "30" },
    });
    fireEvent.click(within(ventana).getByLabelText("Talento Humano"));
    expect(servicio.config.actualizar).not.toHaveBeenCalled();

    fireEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(servicio.config.actualizar).toHaveBeenCalledWith(
        "casos",
        11,
        expect.objectContaining({
          prioridad: "critica",
          minutos_plazo: 90,
          aprueban: [7],
        }),
      ),
    );
    expect(
      await screen.findByText("Caso «No enciende» guardado."),
    ).toBeInTheDocument();
  });

  it("desactivar una categoría pregunta y dice qué pasa", async () => {
    pintar(<CategoriasSoporte />);
    const tarjeta = (
      await screen.findByRole("heading", { name: "Hardware" })
    ).closest("section");
    fireEvent.click(
      within(tarjeta).getByRole("button", {
        name: "Desactivar la categoría Hardware",
      }),
    );
    const pregunta = await screen.findByRole("dialog", {
      name: "¿Desactivar «Hardware»?",
    });
    expect(pregunta).toHaveTextContent("Los tickets abiertos siguen igual.");
    expect(servicio.config.actualizar).not.toHaveBeenCalled();
  });
});

describe("Equipo", () => {
  it("los supervisores se eligen con casillas y se guardan con un botón", async () => {
    pintar(<EquipoSoporte />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Cambiar los supervisores de Mesa de ayuda",
      }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Supervisores de Mesa de ayuda",
    });
    fireEvent.click(within(ventana).getByLabelText("Diana Ruiz"));
    fireEvent.click(within(ventana).getByLabelText("Jorge Andrade"));
    fireEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(servicio.config.actualizar).toHaveBeenCalledWith("niveles", 1, {
        supervisores: [1, 2],
      }),
    );
  });
});

describe("Reglas de tiempo", () => {
  it("se escriben en horas y minutos y se pueden editar", async () => {
    datos.sla = [
      {
        id: 5,
        categoria: 3,
        categoria_nombre: "Hardware",
        area: null,
        prioridad: "alta",
        prioridad_display: "P2 · Alta",
        minutos: 120,
        minutos_respuesta: 15,
      },
    ];
    pintar(<SlaSoporte />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Editar la regla Hardware · P2 · Alta",
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Editar la regla" }),
    ).toBeInTheDocument();
    const solucion = screen.getByRole("group", { name: /Solucionar en/ });
    expect(within(solucion).getByLabelText("Horas")).toHaveValue(2);
    fireEvent.change(within(solucion).getByLabelText("Minutos"), {
      target: { value: "45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(servicio.config.actualizar).toHaveBeenCalledWith(
        "sla",
        5,
        expect.objectContaining({ minutos: 165, minutos_respuesta: 15 }),
      ),
    );
  });

  it("valida los plazos antes de enviarlos", async () => {
    pintar(<SlaSoporte />);
    const respuesta = await screen.findByRole("group", {
      name: /Responder en/,
    });
    const solucion = screen.getByRole("group", { name: /Solucionar en/ });
    fireEvent.change(within(solucion).getByLabelText("Minutos"), {
      target: { value: "30" },
    });
    fireEvent.change(within(respuesta).getByLabelText("Horas"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar regla" }));
    expect(servicio.config.crear).not.toHaveBeenCalled();
    expect(
      screen.getByText("Debe ser menor que el plazo de solución."),
    ).toBeInTheDocument();
  });

  it("sin plazo de solución no se agrega", async () => {
    pintar(<SlaSoporte />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Agregar regla" }),
    );
    expect(servicio.config.crear).not.toHaveBeenCalled();
    expect(screen.getByText("Ponga el plazo de solución.")).toBeInTheDocument();
  });
});
