import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    expect(await screen.findByText(/entra a la cola/)).toHaveClass(
      "mz-alert--ok",
    );
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

  // Auditoría UX/UI, fase 2 (28/10/2026).
  it("no aprobar espera a la nota", async () => {
    servicio.aprobaciones.mockResolvedValue([PENDIENTE]);
    render(<AprobacionesPage />);
    const boton = await screen.findByRole("button", { name: "No aprobar" });
    expect(boton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Nota/), {
      target: { value: "No corresponde" },
    });
    expect(boton).toBeEnabled();
  });

  it("el éxito es un aviso de estado y el fallo queda en la tarjeta", async () => {
    servicio.aprobaciones.mockResolvedValue([PENDIENTE]);
    servicio.decidirAprobacion.mockRejectedValue({
      response: { data: { error: { message: "Ya fue decidida." } } },
    });
    render(<AprobacionesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Aprobar" }));
    const tarjeta = screen.getByRole("region", {
      name: "Aprobación de TCK-2026-000050",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya fue decidida.",
    );
    expect(tarjeta).toContainElement(screen.getByRole("alert"));
  });

  it("mientras carga lo dice y si falla deja reintentar", async () => {
    servicio.aprobaciones
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValue([]);
    render(<AprobacionesPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando");
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByText("No tiene aprobaciones pendientes."),
    ).toBeInTheDocument();
  });
});

describe("El foco tras decidir", () => {
  it("va al aviso de éxito, no se pierde en la página", async () => {
    /* La tarjeta desaparece al decidir y el foco caía en el <body>
       (revisión final UX/UI, 28/10/2026). */
    const OTRA = {
      ...PENDIENTE,
      id: 8,
      ticket: { ...PENDIENTE.ticket, numero: "TCK-2026-000051" },
    };
    servicio.aprobaciones
      .mockResolvedValueOnce([PENDIENTE, OTRA])
      .mockResolvedValue([OTRA]);
    servicio.decidirAprobacion.mockResolvedValue({});
    render(<AprobacionesPage />);

    const tarjeta = await screen.findByRole("region", {
      name: "Aprobación de TCK-2026-000050",
    });
    const aprobar = within(tarjeta).getByRole("button", { name: "Aprobar" });
    aprobar.focus();
    fireEvent.click(aprobar);

    const aviso = await screen.findByText(/TCK-2026-000050 aprobado/);
    await waitFor(() => expect(aviso).toHaveFocus());
    await waitFor(() =>
      expect(
        screen.queryByRole("region", {
          name: "Aprobación de TCK-2026-000050",
        }),
      ).not.toBeInTheDocument(),
    );
    // Sigue en el aviso cuando la tarjeta ya no está.
    expect(aviso).toHaveFocus();
    expect(aviso).toHaveAttribute("tabindex", "-1");
  });
});
