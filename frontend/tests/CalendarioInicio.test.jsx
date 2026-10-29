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
      screen.getByRole("heading", { name: /octubre de 2026/i }),
    ).toBeInTheDocument();
    // Pide las 6 semanas que dibuja: del lunes 28/09 al domingo 08/11.
    expect(servicio.calendario).toHaveBeenCalledWith(
      "2026-09-28",
      "2026-11-08",
    );
    // Un evento de dos días se marca en los dos.
    expect(
      await screen.findByRole("gridcell", {
        name: "23 de octubre: Feria de salud",
      }),
    ).toBeInTheDocument();
    // Los cumpleaños van en su pestaña: no saturan lo importante.
    expect(screen.queryByText("Cumpleaños de Rosa")).toBeNull();
    expect(
      screen.getByRole("gridcell", { name: "19 de octubre" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Celebraciones/ }));
    expect(screen.getByText("Cumpleaños de Rosa")).toBeInTheDocument();
    expect(
      screen.getByRole("gridcell", { name: "22 de octubre" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Todo/ }));
    expect(
      screen.getByRole("gridcell", {
        name: "19 de octubre: Cumpleaños de Rosa",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("gridcell", { name: "22 de octubre: Feria de salud" }),
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
      screen.getByRole("heading", { name: /noviembre de 2026/i }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(servicio.calendario).toHaveBeenLastCalledWith(
        "2026-10-26",
        "2026-12-06",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));
    expect(
      screen.getByRole("heading", { name: /octubre de 2026/i }),
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
    // Treinta días: hoy y mañana, y lo que viene si están vacíos.
    expect(servicio.calendario).toHaveBeenCalledWith(
      "2026-10-19",
      "2026-11-18",
    );
    // Primero lo importante; la pestaña de celebraciones dice cuántas hay.
    expect(await screen.findByText("Charla de seguridad")).toBeInTheDocument();
    expect(screen.queryByText("Cumpleaños de Rosa")).toBeNull();
    const celebraciones = screen.getByRole("tab", { name: /Celebraciones/ });
    expect(celebraciones).toHaveTextContent("1");
    expect(
      screen.getByRole("tab", { name: /Eventos y feriados/ }),
    ).toHaveAttribute("aria-selected", "true");
    fireEvent.click(celebraciones);
    expect(screen.getByText("Cumpleaños de Rosa")).toBeInTheDocument();
    expect(screen.queryByText("Charla de seguridad")).toBeNull();
    expect(screen.getByText("Sin celebraciones.")).toBeInTheDocument();
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
      within(ventana).getByRole("heading", { name: /octubre de 2026/i }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Cerrar calendario" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("en el mes ampliado, el día dice qué tiene al tocarlo (sin globo)", async () => {
    pintar(<CalendarioMes hoy={HOY} />);
    const dia = await screen.findByRole("gridcell", {
      name: "22 de octubre: Feria de salud",
    });
    // El globo nativo no se ve con teclado ni con el dedo: se quitó.
    expect(dia).not.toHaveAttribute("title");
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
      screen.getByRole("region", { name: "Calendario" }),
    ).toBeInTheDocument();
  });

  it("sin permiso no se ofrece gestionar el calendario", async () => {
    pintar(<InicioInstitucional />);
    await screen.findByRole("region", { name: "Calendario" });
    expect(
      screen.queryByRole("link", { name: /Gestionar calendario/ }),
    ).toBeNull();
  });
});

async function irAOtrasFechas() {
  fireEvent.click(await screen.findByRole("tab", { name: /Otras fechas/ }));
}

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
    await irAOtrasFechas();
    const fila = (await screen.findByText("Cumpleaños de Rosa")).closest("tr");
    expect(within(fila).getByText("Cada año")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Agregar fecha/ }));
    const ventana = screen.getByRole("dialog", {
      name: "Agregar al calendario",
    });
    fireEvent.change(within(ventana).getByLabelText(/^Título/), {
      target: { value: "Cumpleaños de Beto" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Tipo/), {
      target: { value: "cumpleanos" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Fecha/), {
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
    await irAOtrasFechas();
    fireEvent.click(
      await screen.findByRole("button", { name: "Borrar Cumpleaños de Rosa" }),
    );
    expect(servicio.eliminarEvento).not.toHaveBeenCalled();
    // Borrar pide confirmación (auditoría UX/UI, 28/10/2026).
    const pregunta = await screen.findByRole("dialog", {
      name: /Quitar «Cumpleaños de Rosa»/,
    });
    fireEvent.click(within(pregunta).getByRole("button", { name: "Quitar" }));
    await waitFor(() =>
      expect(servicio.eliminarEvento).toHaveBeenCalledWith(1),
    );
  });
});

describe("Si el calendario no carga (auditoría UX/UI)", () => {
  it("el resumen lo dice en vez de «Sin eventos» y se reintenta", async () => {
    servicio.calendario.mockRejectedValueOnce(new Error("caída"));
    pintar(<CalendarioInicio hoy={HOY} />);
    expect(
      await screen.findByText("No pudimos cargar el calendario."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Sin eventos.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    // Ya cargó: ahora sí puede decir que hoy no hay eventos importantes.
    expect(await screen.findAllByText("Sin eventos.")).toHaveLength(2);
    expect(screen.queryByText("No pudimos cargar el calendario.")).toBeNull();
  });

  it("en el mes, tampoco dice «sin eventos» si no cargó; hoy va marcado", async () => {
    servicio.calendario.mockRejectedValueOnce(new Error("caída"));
    pintar(<CalendarioMes hoy={HOY} />);
    expect(
      await screen.findByText("No pudimos cargar el calendario."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Sin eventos este día.")).toBeNull();
    expect(
      screen.getByRole("gridcell", { name: "19 de octubre" }),
    ).toHaveAttribute("aria-current", "date");
  });
});

describe("Con el teclado (auditoría UX/UI)", () => {
  it("la grilla es una sola parada de Tab y se recorre con las flechas", async () => {
    pintar(<CalendarioMes hoy={HOY} />);
    const hoy = await screen.findByRole("gridcell", { name: "19 de octubre" });
    const conTab = screen
      .getAllByRole("gridcell")
      .filter((d) => d.getAttribute("tabindex") === "0");
    expect(conTab).toEqual([hoy]);

    hoy.focus();
    fireEvent.keyDown(hoy, { key: "ArrowRight" });
    expect(
      screen.getByRole("gridcell", { name: "20 de octubre" }),
    ).toHaveFocus();
    fireEvent.keyDown(document.activeElement, { key: "ArrowDown" });
    expect(
      screen.getByRole("gridcell", { name: "27 de octubre" }),
    ).toHaveFocus();
    fireEvent.keyDown(document.activeElement, { key: "Home" });
    expect(
      screen.getByRole("gridcell", { name: "26 de octubre" }),
    ).toHaveFocus();
    // AvPág: el mismo día del mes siguiente.
    fireEvent.keyDown(document.activeElement, { key: "PageDown" });
    expect(
      await screen.findByRole("heading", { name: /noviembre de 2026/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("gridcell", { name: "26 de noviembre" }),
    ).toHaveFocus();
  });

  it("las pestañas se cambian con las flechas y dicen qué panel controlan", async () => {
    pintar(<CalendarioMes hoy={HOY} />);
    const eventos = await screen.findByRole("tab", {
      name: /Eventos y feriados/,
    });
    expect(eventos).toHaveAttribute("tabindex", "0");
    const panel = screen.getByRole("tabpanel");
    expect(eventos).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", eventos.id);
    eventos.focus();
    fireEvent.keyDown(eventos, { key: "ArrowRight" });
    const celebraciones = screen.getByRole("tab", { name: /Celebraciones/ });
    expect(celebraciones).toHaveFocus();
    expect(celebraciones).toHaveAttribute("aria-selected", "true");
    // El contador se lee con su palabra.
    expect(celebraciones).toHaveTextContent(/fechas?/);
  });
});

describe("Hoy y mañana vacíos", () => {
  it("muestra las próximas fechas del mes", async () => {
    pintar(<CalendarioInicio hoy={HOY} />);
    // OCTUBRE: el 19 solo hay un cumpleaños (otra pestaña); la feria es el 22.
    expect(await screen.findByText("Próximas fechas")).toBeInTheDocument();
    expect(screen.getByText("Feria de salud")).toBeInTheDocument();
    expect(screen.getByText(/Jueves, 22 de octubre/)).toBeInTheDocument();
  });
});

describe("Feriados por año", () => {
  const anio = new Date().getFullYear();
  const FERIADOS = [
    {
      id: 10,
      titulo: "Navidad",
      tipo: "feriado",
      fecha: "2019-12-25",
      fecha_fin: null,
      descripcion: "",
      cada_anio: true,
    },
    {
      id: 11,
      titulo: "Carnaval",
      tipo: "feriado",
      fecha: `${anio}-02-16`,
      fecha_fin: `${anio}-02-17`,
      descripcion: "",
      cada_anio: false,
    },
    {
      id: 12,
      titulo: "Difuntos",
      tipo: "feriado",
      fecha: `${anio}-11-02`,
      fecha_fin: null,
      descripcion: "",
      cada_anio: false,
    },
    {
      id: 13,
      titulo: "Difuntos",
      tipo: "feriado",
      fecha: `${anio + 1}-11-02`,
      fecha_fin: null,
      descripcion: "",
      cada_anio: false,
    },
    {
      id: 14,
      titulo: "Aniversario",
      tipo: "evento",
      fecha: `${anio}-05-10`,
      fecha_fin: null,
      descripcion: "",
      cada_anio: false,
    },
  ];

  beforeEach(() => {
    permisos.lista = ["calendario.gestionar"];
    servicio.eventos.mockResolvedValue(FERIADOS);
  });

  it("una sola pestaña «Feriados» con una pestaña interna por año", async () => {
    pintar(<GestionCalendarioPage />);
    expect(
      await screen.findByRole("tab", { name: /^Feriados/ }),
    ).toHaveAttribute("aria-selected", "true");
    const actual = await screen.findByRole("tab", { name: `Año ${anio}` });
    expect(actual).toHaveAttribute("aria-selected", "true");
    for (const a of [anio - 1, anio + 1]) {
      expect(screen.getByRole("tab", { name: `Año ${a}` })).toBeInTheDocument();
    }
    expect(screen.queryByRole("tab", { name: `Año ${anio + 2}` })).toBeNull();
    expect(await screen.findByText("Carnaval")).toBeInTheDocument();
    const navidad = screen.getByText("Navidad").closest("tr");
    // Se repite cada año: se muestra con el año de la pestaña, no el de 2019.
    expect(within(navidad).getByText(`25/12/${anio}`)).toBeInTheDocument();
    expect(screen.getAllByText("Difuntos")).toHaveLength(1);
    // Los eventos van en «Otras fechas», no entre los feriados.
    expect(screen.queryByText("Aniversario")).toBeNull();
    await irAOtrasFechas();
    expect(await screen.findByText("Aniversario")).toBeInTheDocument();
    expect(screen.queryByText("Carnaval")).toBeNull();
  });

  it("«Agregar feriado» del año siguiente ya viene como feriado de ese año", async () => {
    pintar(<GestionCalendarioPage />);
    fireEvent.click(
      await screen.findByRole("tab", { name: `Año ${anio + 1}` }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: `Agregar feriado de ${anio + 1}` }),
    );
    const ventana = screen.getByRole("dialog", {
      name: `Agregar feriado de ${anio + 1}`,
    });
    expect(within(ventana).getByLabelText(/^Tipo/)).toHaveValue("feriado");
    expect(within(ventana).getByLabelText(/^Fecha/)).toHaveValue(
      `${anio + 1}-01-01`,
    );
  });

  it("copia al año siguiente los feriados que faltan, sin duplicar ni los fijos", async () => {
    servicio.guardarEvento.mockResolvedValue({});
    pintar(<GestionCalendarioPage />);
    await screen.findByText("Carnaval");
    fireEvent.click(
      screen.getByRole("button", {
        name: `Copiar los feriados de ${anio} a ${anio + 1}`,
      }),
    );
    const pregunta = await screen.findByRole("dialog", {
      name: `¿Copiar 1 feriado de ${anio} a ${anio + 1}?`,
    });
    fireEvent.click(within(pregunta).getByRole("button", { name: "Copiar" }));
    await waitFor(() =>
      expect(servicio.guardarEvento).toHaveBeenCalledTimes(1),
    );
    expect(servicio.guardarEvento).toHaveBeenCalledWith(null, {
      titulo: "Carnaval",
      tipo: "feriado",
      fecha: `${anio + 1}-02-16`,
      fecha_fin: `${anio + 1}-02-17`,
      descripcion: "",
      cada_anio: false,
    });
    expect(await screen.findByText(/Se copió 1 feriado a/)).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: `Año ${anio + 1}` }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("al quitar un feriado que se repite avisa que sale de todos los años", async () => {
    pintar(<GestionCalendarioPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Borrar Navidad" }),
    );
    const pregunta = await screen.findByRole("dialog", {
      name: /Quitar «Navidad»/,
    });
    expect(
      within(pregunta).getByText(/se quitará de todos los años/),
    ).toBeInTheDocument();
  });

  it("sin feriados pendientes, «Copiar» queda desactivado", async () => {
    servicio.eventos.mockResolvedValue([FERIADOS[0]]);
    pintar(<GestionCalendarioPage />);
    await screen.findByText("Navidad");
    expect(
      screen.getByRole("button", {
        name: `Copiar los feriados de ${anio} a ${anio + 1}`,
      }),
    ).toBeDisabled();
  });
});

describe("Agregar un año de feriados", () => {
  const anio = new Date().getFullYear();
  beforeEach(() => {
    permisos.lista = ["calendario.gestionar"];
    servicio.eventos.mockResolvedValue([]);
  });

  it("«Agregar año» crea la pestaña del año siguiente al último y la abre", async () => {
    pintar(<GestionCalendarioPage />);
    await screen.findByText(`Todavía no hay feriados de ${anio}.`);
    fireEvent.click(screen.getByRole("button", { name: /Agregar año/ }));
    expect(
      screen.getByRole("tab", { name: `Año ${anio + 2}` }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByText(`Todavía no hay feriados de ${anio + 2}.`),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Agregar feriado de ${anio + 2}` }),
    ).toBeInTheDocument();
  });
});
