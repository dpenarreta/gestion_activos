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
      expect(servicio.responder).toHaveBeenCalledWith(1, { 10: 100 }),
    );
    expect(await within(ventana).findByText(/0 \/ 100/)).toBeInTheDocument();
    expect(
      within(ventana).getByRole("region", { name: "Oportunidades de mejora" }),
    ).toHaveTextContent("¿Qué hacer con un correo sospechoso?");
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
