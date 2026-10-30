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
 * Mi horario y las horas fuera de horario (auditoría UX/UI, 30/10/2026): las
 * franjas se validan antes de guardar, el atajo pregunta antes de reemplazar,
 * aprobar se confirma y rechazar pide el motivo.
 */

const servicio = {
  miHorario: vi.fn(),
  guardarMiHorario: vi.fn(),
  horas: vi.fn(),
  bandeja: vi.fn(),
  revisarHoras: vi.fn(),
};
vi.mock("../src/api/soporteService", () => ({ soporteService: servicio }));

const { MiHorario } = await import("../src/pages/Soporte/MiHorario");
const { HorasFuera } = await import("../src/pages/Soporte/HorasFuera");
const { erroresDeAgenda } = await import("../src/pages/Soporte/EditorDeAgenda");

function pintar(elemento) {
  return render(<MemoryRouter>{elemento}</MemoryRouter>);
}

const franja = (dia, desde, hasta) => ({
  dia_semana: dia,
  hora_inicio: desde,
  hora_fin: hasta,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Las franjas del horario", () => {
  it("detecta horas al revés, franjas que se cruzan y ausencias sin fechas", () => {
    expect(erroresDeAgenda([franja(0, "08:00", "17:30")], [])).toBeNull();
    const errores = erroresDeAgenda(
      [
        franja(0, "17:00", "08:00"),
        franja(1, "08:00", "12:00"),
        franja(1, "11:00", "15:00"),
      ],
      [{ desde: "2026-11-02", hasta: "", motivo: "" }],
    );
    expect(errores.franjas[0]).toMatch(/después de «Desde»/);
    expect(errores.franjas[1]).toMatch(/Se cruza con otra franja del martes/);
    expect(errores.ausencias[0]).toBe("Ponga las dos fechas.");
  });

  it("no guarda un horario con errores y dice dónde está el problema", async () => {
    servicio.miHorario.mockResolvedValue({
      horarios: [franja(0, "17:00", "08:00")],
      ausencias: [],
    });
    pintar(<MiHorario />);
    expect(
      await screen.findByText(/Los plazos \(SLA\) se miden con el horario/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(servicio.guardarMiHorario).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Revise las franjas o las fechas marcadas.",
    );
    expect(screen.getByLabelText("Hasta")).toHaveAccessibleDescription(
      "«Hasta» debe ser después de «Desde».",
    );
  });

  it("el atajo pregunta antes de reemplazar las franjas", async () => {
    servicio.miHorario.mockResolvedValue({
      horarios: [franja(5, "09:00", "13:00")],
      ausencias: [],
    });
    pintar(<MiHorario />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Lunes a viernes, 08:00–17:30",
      }),
    );
    const pregunta = await screen.findByRole("dialog", {
      name: "¿Reemplazar el horario?",
    });
    fireEvent.click(
      within(pregunta).getByRole("button", { name: "Reemplazar" }),
    );
    await waitFor(() =>
      expect(screen.getAllByLabelText("Día")).toHaveLength(5),
    );
  });
});

describe("Las horas fuera de horario", () => {
  const REGISTRO = {
    id: 9,
    fecha: "2026-10-28",
    tecnico_nombre: "Jorge Andrade",
    ticket: 42,
    ticket_numero: "TCK-2026-000042",
    horas: "2",
    descripcion: "Reinstalé el sistema",
    estado: "pendiente",
    estado_display: "Pendiente",
  };

  beforeEach(() => {
    servicio.bandeja.mockResolvedValue({ puede: { aprobar_horas: true } });
    servicio.horas.mockResolvedValue([REGISTRO]);
    servicio.revisarHoras.mockResolvedValue({});
  });

  it("rechazar pide el motivo y dice el resultado", async () => {
    pintar(<HorasFuera />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Rechazar 2 horas de Jorge Andrade",
      }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Rechazar 2 horas de Jorge Andrade",
    });
    fireEvent.click(within(ventana).getByRole("button", { name: "Rechazar" }));
    expect(servicio.revisarHoras).not.toHaveBeenCalled();
    const motivo = within(ventana).getByLabelText(/^Motivo del rechazo/);
    expect(motivo).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(motivo, { target: { value: "No estaba de turno" } });
    fireEvent.click(within(ventana).getByRole("button", { name: "Rechazar" }));
    await waitFor(() =>
      expect(servicio.revisarHoras).toHaveBeenCalledWith(
        9,
        false,
        "No estaba de turno",
      ),
    );
    expect(
      await screen.findByText("Rechazadas 2 horas de Jorge Andrade."),
    ).toBeInTheDocument();
  });

  it("aprobar se confirma diciendo cuánto y de quién", async () => {
    pintar(<HorasFuera />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Aprobar 2 horas de Jorge Andrade",
      }),
    );
    const pregunta = await screen.findByRole("dialog", {
      name: "¿Aprobar 2 horas de Jorge Andrade?",
    });
    fireEvent.click(within(pregunta).getByRole("button", { name: "Aprobar" }));
    await waitFor(() =>
      expect(servicio.revisarHoras).toHaveBeenCalledWith(9, true, ""),
    );
  });

  it("mientras carga dice «Cargando…», no «No hay registros»", async () => {
    servicio.horas.mockReturnValue(new Promise(() => {}));
    pintar(<HorasFuera />);
    expect((await screen.findAllByText(/Cargando/))[0]).toBeInTheDocument();
    expect(screen.queryByText("No hay horas por revisar.")).toBeNull();
  });
});
