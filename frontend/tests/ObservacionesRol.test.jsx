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
 * Observaciones a los roles de pagos: Talento Humano las ve, las corrige y
 * pide a la persona que vuelva a confirmar.
 */

const servicio = {
  observaciones: vi.fn(),
  observacion: vi.fn(),
  corregirObservacion: vi.fn(),
};
vi.mock("../src/api/nominaService", () => ({ nominaService: servicio }));

const { ObservacionesRolPage } =
  await import("../src/pages/Institucional/ObservacionesRolPage");

const FILA = {
  id: 5,
  persona: { id: 9, nombre: "Juan Diego Almachi" },
  codigo: "20100001",
  anio: 2026,
  mes: 9,
  estado: "abierta",
  estado_display: "Por atender",
  actualizada: "2026-10-21T15:00:00Z",
  ultima: "Faltan horas extra.",
};

beforeEach(() => {
  vi.clearAllMocks();
  servicio.observaciones.mockResolvedValue([FILA]);
  servicio.observacion.mockResolvedValue({
    ...FILA,
    mensajes: [
      {
        id: 1,
        tipo: "observacion",
        tipo_display: "Observación",
        autor: "Juan Diego Almachi",
        texto: "Faltan horas extra.",
        fecha: "2026-10-21T15:00:00Z",
      },
    ],
  });
});

describe("Observaciones a los roles de pagos", () => {
  it("lista las por atender y al corregir pide confirmación", async () => {
    servicio.corregirObservacion.mockResolvedValue({
      ...FILA,
      estado: "corregida",
      estado_display: "Corregida, por confirmar",
      mensajes: [],
    });
    render(
      <MemoryRouter initialEntries={["/?observacion=5"]}>
        <ObservacionesRolPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText("Faltan horas extra.", { selector: "td" }),
    ).toBeInTheDocument();
    expect(servicio.observaciones).toHaveBeenCalledWith("abierta");

    const ventana = await screen.findByRole("dialog", {
      name: "Juan Diego Almachi · septiembre 2026",
    });
    const boton = within(ventana).getByRole("button", {
      name: /Marcar como corregido/,
    });
    expect(boton).toBeDisabled();
    fireEvent.change(within(ventana).getByLabelText(/Qué se corrigió/), {
      target: { value: "Se sumaron las horas extra." },
    });
    fireEvent.click(boton);
    await waitFor(() =>
      expect(servicio.corregirObservacion).toHaveBeenCalledWith(
        "5",
        "Se sumaron las horas extra.",
      ),
    );
    expect(
      await within(ventana).findByText(/Se le pidió a la persona que revise/),
    ).toBeInTheDocument();
  });
});
