import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Aprobaciones: quien debe dar el visto bueno entra al sistema (el correo lo
 * trae aquí) y aprueba o rechaza; rechazar exige un motivo.
 */

const servicio = {
  aprobaciones: vi.fn(),
  decidirAprobacion: vi.fn(),
};
vi.mock("../src/api/soporteService", () => ({ soporteService: servicio }));

const { AprobacionesPage } =
  await import("../src/pages/Aprobaciones/AprobacionesPage");

const PENDIENTE = {
  id: 7,
  rol: "Jefe de área (Cobranzas)",
  sin_aprobador: false,
  creada: "2026-10-19T10:00:00Z",
  ticket: {
    numero: "TCK-2026-000050",
    solicitante: "Carla",
    correo: "carla@grupolaar.com",
    area: "Cobranzas",
    agencia: "Loja",
    categoria: "Puesto de trabajo",
    codigo: "ACC-02",
    caso: "Acceso a VPN",
    prioridad_display: "P3 · Media",
    descripcion: "Necesito VPN para trabajar desde casa",
    datos_adicionales: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Las aprobaciones", () => {
  it("muestran lo pendiente y aprobar lo saca de la lista", async () => {
    servicio.aprobaciones
      .mockResolvedValueOnce([PENDIENTE])
      .mockResolvedValue([]);
    servicio.decidirAprobacion.mockResolvedValue({});
    render(<AprobacionesPage />);
    expect(
      await screen.findByText("Necesito VPN para trabajar desde casa"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Jefe de área \(Cobranzas\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));
    await waitFor(() =>
      expect(servicio.decidirAprobacion).toHaveBeenCalledWith(7, true, ""),
    );
    expect(await screen.findByText(/entra a la cola/)).toBeInTheDocument();
    expect(
      await screen.findByText("No tiene aprobaciones pendientes."),
    ).toBeInTheDocument();
  });

  it("no aprobar manda la nota", async () => {
    servicio.aprobaciones.mockResolvedValue([PENDIENTE]);
    servicio.decidirAprobacion.mockResolvedValue({});
    render(<AprobacionesPage />);
    fireEvent.change(await screen.findByLabelText(/Nota/), {
      target: { value: "No corresponde a su cargo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "No aprobar" }));
    await waitFor(() =>
      expect(servicio.decidirAprobacion).toHaveBeenCalledWith(
        7,
        false,
        "No corresponde a su cargo",
      ),
    );
  });
});
