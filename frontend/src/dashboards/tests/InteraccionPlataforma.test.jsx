import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* Dashboard «Interacción de la plataforma» y el latido de actividad
   (18/11/2026). */

const servicio = { resumen: vi.fn(), latido: vi.fn() };
vi.mock("../../api/interaccionService", () => ({
  interaccionService: servicio,
}));

const { default: InteraccionPlataformaPage, duracion } =
  await import("../pages/interaccion/InteraccionPlataformaPage");
const { LatidoActividad } =
  await import("../../components/admin/LatidoActividad/LatidoActividad");

const RESUMEN = {
  periodo: { dias: 7, desde: "2026-11-12", hasta: "2026-11-18" },
  registro_desde: "2026-11-18",
  cuentas_activas: 180,
  dias_con_actividad: 1,
  personas_promedio_dia: 42,
  personas_hoy: 42,
  minutos_activo_promedio: 95,
  minutos_conexion_promedio: 240,
  conexion_maxima: { nombre: "Ana Ruiz", fecha: "2026-11-18", minutos: 480 },
  conexion_minima: { nombre: "Beto Paz", fecha: "2026-11-18", minutos: 1 },
  mensajes: { total: 120, promedio_dia: 120, promedio_persona_dia: 2.9 },
  serie: [
    {
      fecha: "2026-11-18",
      personas: 42,
      mensajes: 120,
      minutos_conexion: 240,
      minutos_activo: 95,
    },
  ],
  recurrentes: [
    {
      nombre: "Ana Ruiz",
      ingresos: 6,
      dias: 1,
      ingresos_por_dia: 6,
      minutos: 480,
      ultima: null,
    },
  ],
  sin_ingreso: {
    nunca: 1,
    en_periodo: 138,
    personas: [
      {
        nombre: "Nuevo Ingreso",
        correo: "nuevo@grupolaar.com",
        creada: "2026-11-01",
      },
    ],
  },
  funcionalidades: [{ nombre: "Chat", minutos: 300, personas: 30 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  servicio.resumen.mockResolvedValue(RESUMEN);
  servicio.latido.mockResolvedValue({});
});

describe("Dashboard de interacción", () => {
  it("muestra los indicadores, el top 10, las funcionalidades y quién no ha ingresado", async () => {
    render(
      <MemoryRouter>
        <InteraccionPlataformaPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("42 de 180")).toBeInTheDocument();
    expect(screen.getByText("1 h 35 min")).toBeInTheDocument();
    expect(screen.getAllByText("8 h").length).toBeGreaterThan(0);
    expect(screen.getByText("1 min")).toBeInTheDocument();
    expect(screen.getAllByText("Ana Ruiz").length).toBeGreaterThan(0);
    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Nuevo Ingreso")).toBeInTheDocument();
    expect(servicio.resumen).toHaveBeenCalledWith(7);

    fireEvent.click(screen.getByRole("button", { name: "30 días" }));
    await waitFor(() => expect(servicio.resumen).toHaveBeenCalledWith(30));
  });

  it("formatea las duraciones", () => {
    expect(duracion(45)).toBe("45 min");
    expect(duracion(60)).toBe("1 h");
    expect(duracion(135)).toBe("2 h 15 min");
  });
});

describe("Latido de actividad", () => {
  it("avisa como mucho una vez por minuto, con el título de la pantalla", async () => {
    vi.useFakeTimers();
    document.title = "Organigrama · Intranet LCE";
    render(<LatidoActividad />);
    await act(async () => {
      fireEvent.pointerDown(window);
      fireEvent.keyDown(window);
    });
    expect(servicio.latido).toHaveBeenCalledTimes(1);
    expect(servicio.latido).toHaveBeenCalledWith("Organigrama · Intranet LCE");
    vi.advanceTimersByTime(61_000);
    await act(async () => {
      fireEvent.keyDown(window);
    });
    expect(servicio.latido).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
