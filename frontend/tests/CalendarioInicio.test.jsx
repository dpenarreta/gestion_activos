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
 * El calendario de Inicio: el mes con eventos, cumpleaños y feriados
 * marcados, cambiar de mes y ver lo de un día; se gestiona con
 * `calendario.gestionar`, con su propio botón junto al de noticias.
 */

const permisos = { lista: [] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { first_name: "Ana", permissions: permisos.lista } }),
}));
vi.mock("../src/api/misDatosService", () => ({
  misDatosService: { obtener: vi.fn(() => Promise.resolve({ cargo: null })) },
}));

const servicio = {
  calendario: vi.fn(),
  eventos: vi.fn(),
  guardarEvento: vi.fn(),
  eliminarEvento: vi.fn(),
  noticias: vi.fn(),
  carrusel: vi.fn(),
  imagenNoticia: vi.fn(),
};
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: servicio,
}));

const { CalendarioInicio, CalendarioMes } =
  await import("../src/pages/Institucional/CalendarioInicio");
const { InicioInstitucional } =
  await import("../src/pages/Institucional/InicioInstitucional");
const { GestionCalendarioPage } =
  await import("../src/pages/Institucional/GestionCalendarioPage");
const { UnsavedChangesProvider } =
  await import("../src/context/UnsavedChangesContext");

const HOY = new Date(2026, 9, 19); // 19 de octubre de 2026
const OCTUBRE = [
  {
    id: 1,
    titulo: "Cumpleaños de Rosa",
    tipo: "cumpleanos",
    descripcion: "",
    fecha: "2026-10-19",
    fecha_fin: "2026-10-19",
  },
  {
    id: 2,
    titulo: "Feria de salud",
    tipo: "evento",
    descripcion: "En el patio",
    fecha: "2026-10-22",
    fecha_fin: "2026-10-23",
  },
];

function pintar(elemento) {
  return render(
    <MemoryRouter>
      <UnsavedChangesProvider>{elemento}</UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = [];
  servicio.calendario.mockResolvedValue(OCTUBRE);
  servicio.noticias.mockResolvedValue([]);
  servicio.carrusel.mockResolvedValue({ segundos: 6 });
});

describe("El calendario del mes (ampliado)", () => {
  it("muestra el mes con sus fechas marcadas y lo de hoy", async () => {
    pintar(<CalendarioMes hoy={HOY} />);
    expect(
      screen.getByRole("heading", { name: /octubre de 2026/ }),
    ).toBeInTheDocument();
    // Pide las 6 semanas que dibuja: del lunes 28/09 al domingo 08/11.
    expect(servicio.calendario).toHaveBeenCalledWith(
      "2026-09-28",
      "2026-11-08",
    );
    expect(await screen.findByText("Cumpleaños de Rosa")).toBeInTheDocument();
    // Un evento de dos días se marca en los dos.
    expect(
      screen.getByRole("gridcell", { name: "23 de octubre: Feria de salud" }),
    ).toBeInTheDocument();
  });

  it("al tocar un día lista lo que hay en él", async () => {
    pintar(<CalendarioMes hoy={HOY} />);
    fireEvent.click(
      await screen.findByRole("gridcell", {
        name: "22 de octubre: Feria de salud",
      }),
    );
    expect(screen.getByText("Feria de salud")).toBeInTheDocument();
    expect(screen.getByText("En el patio")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("gridcell", { name: "20 de octubre" }));
    expect(screen.getByText("Sin eventos este día.")).toBeInTheDocument();
  });

  it("cambia de mes y vuelve a hoy", async () => {
    pintar(<CalendarioMes hoy={HOY} />);
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }));
    expect(
      screen.getByRole("heading", { name: /noviembre de 2026/ }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(servicio.calendario).toHaveBeenLastCalledWith(
        "2026-10-26",
        "2026-12-06",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));
    expect(
      screen.getByRole("heading", { name: /octubre de 2026/ }),
    ).toBeInTheDocument();
  });
});

describe("El calendario recogido", () => {
  it("muestra en texto lo de hoy y lo de mañana", async () => {
    servicio.calendario.mockResolvedValue([
      OCTUBRE[0],
      {
        id: 3,
        titulo: "Charla de seguridad",
        tipo: "evento",
        descripcion: "Sala 2",
        fecha: "2026-10-20",
        fecha_fin: "2026-10-20",
      },
    ]);
    pintar(<CalendarioInicio hoy={HOY} />);
    expect(servicio.calendario).toHaveBeenCalledWith(
      "2026-10-19",
      "2026-10-20",
    );
    expect(await screen.findByText("Cumpleaños de Rosa")).toBeInTheDocument();
    expect(screen.getByText("Charla de seguridad")).toBeInTheDocument();
    expect(screen.getByText(/^Hoy/)).toBeInTheDocument();
    expect(screen.getByText(/^Mañana/)).toBeInTheDocument();
    // Las fechas del mes van recogidas: no se dibuja la cuadrícula.
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("sin eventos lo dice, y «Ver calendario» lo amplía al mes", async () => {
    servicio.calendario.mockResolvedValue([]);
    pintar(<CalendarioInicio hoy={HOY} />);
    expect(await screen.findAllByText("Sin eventos.")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /Ver calendario/ }));
    const ventana = screen.getByRole("dialog", { name: "Calendario" });
    expect(within(ventana).getByRole("grid")).toBeInTheDocument();
    expect(
      within(ventana).getByRole("heading", { name: /octubre de 2026/ }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Cerrar calendario" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("en el mes ampliado, el día dice qué tiene al pasar sobre él", async () => {
    pintar(<CalendarioMes hoy={HOY} />);
    const dia = await screen.findByRole("gridcell", {
      name: "22 de octubre: Feria de salud",
    });
    expect(dia).toHaveAttribute(
      "title",
      "Evento: Feria de salud — En el patio",
    );
    fireEvent.click(dia);
    expect(
      screen.getByText(/del 22 de octubre al 23 de octubre/),
    ).toBeInTheDocument();
  });
});

describe("En el Inicio", () => {
  it("van noticias y calendario, cada uno con su botón de gestionar", async () => {
    permisos.lista = ["noticias.gestionar", "calendario.gestionar"];
    pintar(<InicioInstitucional />);
    expect(
      await screen.findByRole("link", { name: /Gestionar noticias/ }),
    ).toHaveAttribute("href", "/admin/institucional/noticias");
    expect(
      screen.getByRole("link", { name: /Gestionar calendario/ }),
    ).toHaveAttribute("href", "/admin/institucional/calendario");
    expect(
      screen.getByText("No hay noticias publicadas por ahora."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Próximos eventos" }),
    ).toBeInTheDocument();
  });

  it("sin permiso no se ofrece gestionar el calendario", async () => {
    pintar(<InicioInstitucional />);
    await screen.findByRole("region", { name: "Próximos eventos" });
    expect(
      screen.queryByRole("link", { name: /Gestionar calendario/ }),
    ).toBeNull();
  });
});

describe("Gestionar calendario", () => {
  beforeEach(() => {
    permisos.lista = ["calendario.gestionar"];
    servicio.eventos.mockResolvedValue([
      { ...OCTUBRE[0], fecha_fin: null, cada_anio: true },
    ]);
  });

  it("lista las fechas y agrega un cumpleaños que se repite cada año", async () => {
    servicio.guardarEvento.mockResolvedValue({});
    pintar(<GestionCalendarioPage />);
    const fila = (await screen.findByText("Cumpleaños de Rosa")).closest("tr");
    expect(within(fila).getByText("Cada año")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Agregar fecha/ }));
    const ventana = screen.getByRole("dialog", {
      name: "Agregar al calendario",
    });
    fireEvent.change(within(ventana).getByLabelText("Título"), {
      target: { value: "Cumpleaños de Beto" },
    });
    fireEvent.change(within(ventana).getByLabelText("Tipo"), {
      target: { value: "cumpleanos" },
    });
    fireEvent.change(within(ventana).getByLabelText("Fecha"), {
      target: { value: "2026-11-03" },
    });
    // Elegir «Cumpleaños» marca «se repite cada año».
    expect(within(ventana).getByLabelText(/Se repite cada año/)).toBeChecked();
    fireEvent.click(within(ventana).getByRole("button", { name: "Agregar" }));

    await waitFor(() =>
      expect(servicio.guardarEvento).toHaveBeenCalledWith(undefined, {
        titulo: "Cumpleaños de Beto",
        tipo: "cumpleanos",
        fecha: "2026-11-03",
        fecha_fin: null,
        descripcion: "",
        cada_anio: true,
      }),
    );
    expect(await screen.findByText("Fecha agregada.")).toBeInTheDocument();
  });

  it("borra una fecha", async () => {
    servicio.eliminarEvento.mockResolvedValue({});
    pintar(<GestionCalendarioPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Borrar Cumpleaños de Rosa" }),
    );
    await waitFor(() =>
      expect(servicio.eliminarEvento).toHaveBeenCalledWith(1),
    );
  });
});
