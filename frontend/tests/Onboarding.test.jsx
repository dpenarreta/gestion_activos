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
 * Mi onboarding: el plan por empresa, área y cargo; revisar antes de
 * evaluarse; el puntaje con qué reforzar; y el aviso fijo mientras falte.
 */

const servicio = {
  miOnboarding: vi.fn(),
  marcarVisto: vi.fn(),
  archivo: vi.fn(),
  evaluacion: vi.fn(),
  responder: vi.fn(),
  guardarBorrador: vi.fn(),
};
vi.mock("../src/api/capacitacionService", () => ({
  capacitacionService: servicio,
}));

const { MiOnboardingPage } =
  await import("../src/pages/Institucional/MiOnboardingPage");
const { AvisoOnboarding } =
  await import("../src/components/admin/AvisoOnboarding/AvisoOnboarding");

const MATERIAL = {
  id: 1,
  titulo: "Seguridad de la información",
  descripcion: "",
  alcance: "empresa",
  de: "",
  formatos: ["Texto"],
  tiene_archivo: false,
  archivo_es_pdf: false,
  url: "",
  contenido: "No abra adjuntos desconocidos.",
  preguntas: 2,
  visto: false,
  aprobado: false,
  agotado: false,
  mejor_puntaje: null,
  intentos_restantes: 3,
};
const PLAN = {
  asignado: true,
  fecha_limite: "2026-11-04",
  completado_en: null,
  vencido: false,
  total: 2,
  aprobados: 0,
  promedio: null,
  materiales: [
    MATERIAL,
    {
      ...MATERIAL,
      id: 2,
      titulo: "Estándares de código",
      alcance: "cargo",
      de: "Analista Programador",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  servicio.miOnboarding.mockResolvedValue(PLAN);
  servicio.marcarVisto.mockResolvedValue({ visto: true });
});

describe("Mi onboarding", () => {
  it("muestra el plan por grupo y pide revisar antes de evaluarse", async () => {
    render(<MiOnboardingPage />);
    expect(
      await screen.findByText("0 de 2 materiales aprobados"),
    ).toBeInTheDocument();
    expect(screen.getByText(/De la empresa/)).toBeInTheDocument();
    expect(screen.getByText(/De su cargo/)).toBeInTheDocument();
    const evaluarme = screen.getAllByRole("button", { name: /Evaluarme/ });
    expect(evaluarme[0]).toBeDisabled();

    fireEvent.click(screen.getAllByRole("button", { name: /Revisar/ })[0]);
    await waitFor(() => expect(servicio.marcarVisto).toHaveBeenCalledWith(1));
    expect(
      await screen.findByText("No abra adjuntos desconocidos."),
    ).toBeInTheDocument();
  });

  it("al evaluarse muestra el puntaje y qué reforzar", async () => {
    servicio.miOnboarding.mockResolvedValue({
      ...PLAN,
      materiales: [{ ...MATERIAL, visto: true }],
      total: 1,
    });
    servicio.evaluacion.mockResolvedValue({
      material: { id: 1, titulo: MATERIAL.titulo, nota_minima: 70 },
      intentos_restantes: 3,
      preguntas: [
        {
          id: 10,
          tipo: "unica",
          puntos: "10.00",
          texto: "¿Qué hacer con un correo sospechoso?",
          opciones: [
            { id: 100, texto: "Abrirlo" },
            { id: 101, texto: "Reportarlo" },
          ],
        },
      ],
    });
    servicio.responder.mockResolvedValue({
      puntaje: 0,
      nota: "0.00",
      aprobado: false,
      nota_minima: 70,
      intentos_restantes: 2,
      a_reforzar: ["¿Qué hacer con un correo sospechoso?"],
    });
    render(<MiOnboardingPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Evaluarme/ }));
    const ventana = await screen.findByRole("dialog", {
      name: `Evaluación · ${MATERIAL.titulo}`,
    });
    const enviar = within(ventana).getByRole("button", {
      name: "Enviar respuestas",
    });
    expect(enviar).toBeDisabled();
    fireEvent.click(
      await within(ventana).findByRole("radio", { name: "Abrirlo" }),
    );
    fireEvent.click(enviar);
    await waitFor(() =>
      expect(servicio.responder).toHaveBeenCalledWith(1, { 10: 100 }, false),
    );
    expect(await within(ventana).findByText(/0 \/ 10\b/)).toBeInTheDocument();
    expect(
      within(ventana).getByRole("region", { name: "Oportunidades de mejora" }),
    ).toHaveTextContent("¿Qué hacer con un correo sospechoso?");
  });
});

/* Cargando y error con «Reintentar» (auditoría UX/UI, fase 2, 28/10/2026). */
describe("Mi onboarding: cargando y error", () => {
  it("dice «Cargando…» mientras llega el plan", async () => {
    servicio.miOnboarding.mockReturnValue(new Promise(() => {}));
    render(<MiOnboardingPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
  });

  it("un fallo se avisa y «Reintentar» vuelve a pedirlo", async () => {
    servicio.miOnboarding.mockRejectedValueOnce({
      response: { data: { error: { message: "Servidor no disponible." } } },
    });
    render(<MiOnboardingPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Servidor no disponible.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByText("0 de 2 materiales aprobados"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Tipos de pregunta", () => {
  it("opción múltiple, completar espacios y unir arman su respuesta", async () => {
    servicio.miOnboarding.mockResolvedValue({
      ...PLAN,
      materiales: [{ ...MATERIAL, visto: true }],
      total: 1,
    });
    servicio.evaluacion.mockResolvedValue({
      material: { id: 1, titulo: MATERIAL.titulo, nota_minima: 70 },
      intentos_restantes: 3,
      preguntas: [
        {
          id: 1,
          tipo: "multiple",
          puntos: "3.00",
          texto: "¿Cuáles son datos sensibles?",
          opciones: [
            { id: 11, texto: "Contraseñas" },
            { id: 12, texto: "Cédulas" },
            { id: 13, texto: "El menú" },
          ],
        },
        {
          id: 2,
          tipo: "completar",
          puntos: "3.00",
          texto: "El SRI exige el ____.",
          segmentos: ["El SRI exige el ", null, "."],
          huecos: 1,
        },
        {
          id: 3,
          tipo: "unir",
          puntos: "4.00",
          texto: "Una cada sigla",
          izquierda: [
            { id: 31, texto: "SRI" },
            { id: 32, texto: "IESS" },
          ],
          derecha: ["Seguridad Social", "Rentas Internas"],
        },
      ],
    });
    servicio.responder.mockResolvedValue({
      puntaje: 85,
      nota: "8.50",
      aprobado: true,
      nota_minima: 70,
      intentos_restantes: 2,
      a_reforzar: [],
    });
    render(<MiOnboardingPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Evaluarme/ }));
    const ventana = await screen.findByRole("dialog", {
      name: `Evaluación · ${MATERIAL.titulo}`,
    });
    const enviar = within(ventana).getByRole("button", {
      name: "Enviar respuestas",
    });
    fireEvent.click(
      await within(ventana).findByRole("checkbox", { name: "Contraseñas" }),
    );
    fireEvent.click(within(ventana).getByRole("checkbox", { name: "Cédulas" }));
    fireEvent.change(
      within(ventana).getByRole("textbox", {
        name: "Espacio 1 de la pregunta 2",
      }),
      { target: { value: "RUC" } },
    );
    fireEvent.change(
      within(ventana).getByRole("combobox", { name: "Respuesta para «SRI»" }),
      { target: { value: "Rentas Internas" } },
    );
    // Falta una pareja: todavía no se puede enviar.
    expect(enviar).toBeDisabled();
    fireEvent.change(
      within(ventana).getByRole("combobox", { name: "Respuesta para «IESS»" }),
      { target: { value: "Seguridad Social" } },
    );
    fireEvent.click(enviar);
    await waitFor(() =>
      expect(servicio.responder).toHaveBeenCalledWith(
        1,
        {
          1: [11, 12],
          2: ["RUC"],
          3: { 31: "Rentas Internas", 32: "Seguridad Social" },
        },
        false,
      ),
    );
    expect(await within(ventana).findByText(/8,5 \/ 10/)).toBeInTheDocument();
    expect(within(ventana).getByText(/85 %/)).toBeInTheDocument();
  });

  it("el editor suma y reparte los 10 puntos", async () => {
    const { sumaDePuntos, repartirPuntos } =
      await import("../src/pages/Institucional/CapacitacionGestion");
    expect(sumaDePuntos([{ puntos: "2.5" }, { puntos: "7.5" }])).toBe(10);
    const tres = repartirPuntos([{}, {}, {}]).map((p) => p.puntos);
    expect(tres).toEqual(["3.33", "3.33", "3.34"]);
    expect(sumaDePuntos(tres.map((puntos) => ({ puntos })))).toBe(10);
  });
});

describe("Tiempo límite", () => {
  const PREGUNTA = {
    id: 10,
    tipo: "unica",
    puntos: "10.00",
    texto: "¿Qué hacer con un correo sospechoso?",
    opciones: [
      { id: 100, texto: "Abrirlo" },
      { id: 101, texto: "Reportarlo" },
    ],
  };

  function conReloj(material) {
    servicio.miOnboarding.mockResolvedValue({
      ...PLAN,
      materiales: [{ ...MATERIAL, visto: true, tiempo_limite: 5, ...material }],
      total: 1,
    });
  }

  it("avisa antes de empezar y el reloj no corre hasta «Comenzar»", async () => {
    conReloj({ segundos_restantes: null });
    servicio.evaluacion.mockResolvedValue({
      material: { id: 1, titulo: MATERIAL.titulo, nota_minima: 70 },
      intentos_restantes: 3,
      segundos_restantes: 300,
      borrador: {},
      preguntas: [PREGUNTA],
    });
    render(<MiOnboardingPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Evaluarme · 5 min/ }),
    );
    const ventana = await screen.findByRole("dialog");
    expect(ventana).toHaveTextContent("5 minutos");
    expect(servicio.evaluacion).not.toHaveBeenCalled();
    fireEvent.click(within(ventana).getByRole("button", { name: /Comenzar/ }));
    expect(
      await within(ventana).findByRole("timer", { name: "Tiempo restante" }),
    ).toHaveTextContent("05:00");
  });

  it("guarda solo lo respondido y al llegar a cero lo envía y avisa", async () => {
    conReloj({ segundos_restantes: 2 });
    servicio.evaluacion.mockResolvedValue({
      material: { id: 1, titulo: MATERIAL.titulo, nota_minima: 70 },
      intentos_restantes: 3,
      segundos_restantes: 2,
      borrador: {},
      preguntas: [
        PREGUNTA,
        {
          id: 20,
          tipo: "completar",
          puntos: "0.00",
          texto: "El SRI exige el ____.",
          segmentos: ["El SRI exige el ", null, "."],
          huecos: 1,
        },
      ],
    });
    servicio.guardarBorrador.mockResolvedValue({ cerrada: false });
    servicio.responder.mockResolvedValue({
      puntaje: 100,
      nota: "10.00",
      por_tiempo: true,
      aprobado: true,
      nota_minima: 70,
      intentos_restantes: 0,
      a_reforzar: [],
    });
    render(<MiOnboardingPage />);
    // Ya la había empezado: entra directo, sin el aviso.
    fireEvent.click(await screen.findByRole("button", { name: /Continuar/ }));
    const ventana = await screen.findByRole("dialog");
    fireEvent.click(
      await within(ventana).findByRole("radio", { name: "Reportarlo" }),
    );
    await waitFor(() =>
      expect(servicio.guardarBorrador).toHaveBeenCalledWith(1, { 10: 101 }),
    );
    // Sin completar todo: se envía igual al acabarse el tiempo.
    await waitFor(
      () =>
        expect(servicio.responder).toHaveBeenCalledWith(1, { 10: 101 }, true),
      { timeout: 4000 },
    );
    expect(
      await within(ventana).findByText(/Se acabó el tiempo/),
    ).toBeInTheDocument();
  });

  it("formatea el reloj", async () => {
    const { formatoReloj } =
      await import("../src/pages/Institucional/MiOnboardingPage");
    expect(formatoReloj(65)).toBe("01:05");
    expect(formatoReloj(3725)).toBe("1:02:05");
    expect(formatoReloj(-3)).toBe("00:00");
  });
});

describe("Aviso del onboarding", () => {
  it("se ve mientras falte y desaparece al completarlo", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <AvisoOnboarding />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText(/Tiene su onboarding pendiente/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continuar" })).toHaveAttribute(
      "href",
      "/admin/institucional/onboarding",
    );
    unmount();
    servicio.miOnboarding.mockResolvedValue({
      ...PLAN,
      completado_en: "2026-10-25T10:00:00Z",
    });
    render(
      <MemoryRouter>
        <AvisoOnboarding />
      </MemoryRouter>,
    );
    await waitFor(() => expect(servicio.miOnboarding).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Tiene su onboarding pendiente/)).toBeNull();
  });
});
