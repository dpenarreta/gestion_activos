import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Nova en Gestión Humana: el «Análisis de Nova» de los KPI (a pedido, con
 * estados de carga, error y versión sin IA), la frase del inicio y la marca
 * por página de la narrativa de los informes. El servicio va simulado.
 */

const servicio = {
  me: vi.fn(),
  analisisKpi: vi.fn(),
  mensajeInicio: vi.fn(),
};
vi.mock("../src/api/novaService", async (importOriginal) => ({
  ...(await importOriginal()),
  novaService: servicio,
}));
const permisos = { lista: [] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, permissions: permisos.lista } }),
}));

const { PanelNova } =
  await import("../src/pages/GestionHumana/Desempeno/PanelNova");
const { InicioGestionHumana } =
  await import("../src/pages/GestionHumana/InicioGestionHumana");
const { DocumentoInforme } =
  await import("../src/pages/GestionHumana/Informes/DocumentoInforme");

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = [];
});

describe("Análisis de Nova en los KPI", () => {
  it("se pide a mano y avisa que es texto de IA", async () => {
    servicio.analisisKpi.mockResolvedValue({
      variante: "completo",
      con_ia: true,
      hallazgo_principal: "Ana sostiene un cumplimiento del 80%.",
      riesgos: ["Una tarea vencida."],
      aspectos_positivos: ["Buen avance."],
      recomendaciones: ["Revisar pendientes esta semana."],
    });
    render(<PanelNova usuarioId={7} />);
    expect(servicio.analisisKpi).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /generar análisis/i }));
    expect(
      await screen.findByText("Ana sostiene un cumplimiento del 80%."),
    ).toBeInTheDocument();
    expect(servicio.analisisKpi).toHaveBeenCalledWith(7);
    expect(screen.getByText(/texto generado por ia/i)).toBeInTheDocument();
    expect(screen.getByText("Riesgos")).toBeInTheDocument();
    // El botón desaparece con el resultado: el foco va al título.
    expect(
      screen.getByRole("heading", { name: "Análisis de Nova" }),
    ).toHaveFocus();
  });

  it("mientras analiza el botón sigue enfocable pero inactivo", async () => {
    let resolver;
    servicio.analisisKpi.mockReturnValue(
      new Promise((r) => {
        resolver = r;
      }),
    );
    render(<PanelNova usuarioId={7} />);
    fireEvent.click(screen.getByRole("button", { name: /generar análisis/i }));
    const boton = await screen.findByRole("button", { name: /analizando/i });
    expect(boton).toHaveAttribute("aria-disabled", "true");
    expect(boton).not.toBeDisabled();
    fireEvent.click(boton);
    expect(servicio.analisisKpi).toHaveBeenCalledTimes(1);
    resolver({ variante: "motivacional", con_ia: false, mensajes: ["Bien."] });
    expect(await screen.findByText("Bien.")).toBeInTheDocument();
  });

  it("en el inicio, si la frase no carga deja reintentar", async () => {
    permisos.lista = ["tareas.acceder", "nova.mensaje_inicio"];
    servicio.mensajeInicio
      .mockRejectedValueOnce({ response: { status: 500, data: {} } })
      .mockResolvedValueOnce({ mensaje: "Frase de hoy.", con_ia: true });
    render(
      <MemoryRouter>
        <InicioGestionHumana />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Frase de hoy.")).toBeInTheDocument();
  });

  it("muestra la versión sin IA con su motivo", async () => {
    servicio.analisisKpi.mockResolvedValue({
      variante: "motivacional",
      con_ia: false,
      mensaje: "Alcanzó el límite de 40 consultas diarias a Nova.",
      mensajes: ["Va bien: 70% de cumplimiento."],
    });
    render(<PanelNova usuarioId={7} />);
    fireEvent.click(screen.getByRole("button", { name: /generar análisis/i }));
    expect(
      await screen.findByText("Va bien: 70% de cumplimiento."),
    ).toBeInTheDocument();
    expect(screen.getByText(/versión sin ia/i)).toBeInTheDocument();
    expect(screen.getByText(/límite de 40 consultas/)).toBeInTheDocument();
  });

  it("un error se anuncia y se puede reintentar", async () => {
    servicio.analisisKpi.mockRejectedValue({
      response: { status: 403, data: { error: { message: "Sin permiso." } } },
    });
    render(<PanelNova usuarioId={7} />);
    fireEvent.click(screen.getByRole("button", { name: /generar análisis/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin permiso.");
    expect(
      screen.getByRole("button", { name: /reintentar/i }),
    ).toBeInTheDocument();
  });
});

describe("Inicio de Gestión Humana", () => {
  function inicio() {
    return render(
      <MemoryRouter initialEntries={["/admin/gestion-humana"]}>
        <Routes>
          <Route
            path="/admin/gestion-humana"
            element={<InicioGestionHumana />}
          />
          <Route path="/admin/gestion-humana/tareas" element={<p>tareas</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("sin el permiso de Nova lleva directo a la primera pantalla", () => {
    permisos.lista = ["tareas.acceder"];
    inicio();
    expect(screen.getByText("tareas")).toBeInTheDocument();
    expect(servicio.mensajeInicio).not.toHaveBeenCalled();
  });

  it("con el permiso muestra la frase del día y los accesos", async () => {
    permisos.lista = ["tareas.acceder", "nova.mensaje_inicio"];
    servicio.mensajeInicio.mockResolvedValue({
      mensaje: "Tiene 2 tareas próximas a vencer esta semana.",
      con_ia: true,
    });
    inicio();
    expect(
      await screen.findByText("Tiene 2 tareas próximas a vencer esta semana."),
    ).toBeInTheDocument();
    expect(screen.getByText(/texto generado por ia/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /tareas/i })).toBeInTheDocument();
  });

  it("sin IA lo dice", async () => {
    permisos.lista = ["tareas.acceder", "nova.mensaje_inicio"];
    servicio.mensajeInicio.mockResolvedValue({
      mensaje: "Revisión urgente: tiene 1 tarea vencida.",
      con_ia: false,
      aviso: "Nova no está configurada en este entorno.",
    });
    inicio();
    expect(await screen.findByText(/versión sin ia/i)).toBeInTheDocument();
    expect(screen.getByText(/no está configurada/)).toBeInTheDocument();
  });
});

describe("Narrativa del informe", () => {
  const resumen = {
    kind: "executiveSummary",
    situacionGeneral: "Situación.",
    fortalezas: "Fortalezas.",
    aspectosAtencion: "Atención.",
    conclusion: "Conclusión.",
  };

  it("marca cada página según su origen", () => {
    render(
      <DocumentoInforme
        reportId="NXR-1"
        pages={[
          { ...resumen, conIa: true },
          {
            kind: "insights",
            conIa: false,
            patrones: [],
            cambios: [],
            anomalias: [],
            relacionesCruzadas: [],
            hallazgosBase: [],
            insightsBase: [],
          },
        ]}
      />,
    );
    expect(screen.getByText(/redactado por ia \(nova\)/i)).toBeInTheDocument();
    expect(screen.getByText(/narrativa sin ia/i)).toBeInTheDocument();
  });

  it("los informes anteriores a Nova conservan su marca", () => {
    render(<DocumentoInforme reportId="NXR-2" pages={[resumen]} sinIa />);
    expect(screen.getByText(/narrativa sin ia/i)).toBeInTheDocument();
    expect(screen.queryByText(/redactado por ia/i)).not.toBeInTheDocument();
  });
});
