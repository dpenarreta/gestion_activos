import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* «Mi calendario de Google» en Mi estado (17/11/2026). */

const servicio = {
  calendario: vi.fn(),
  conectarCalendario: vi.fn(),
  desconectarCalendario: vi.fn(),
};
const confirmar = vi.fn(async () => true);
vi.mock("../src/api/chatService", () => ({ chatService: servicio }));
vi.mock("../src/components/common/Confirmar/confirmar", () => ({ confirmar }));

const { CalendarioGoogle } =
  await import("../src/components/admin/Chat/CalendarioGoogle");

beforeEach(() => {
  Object.values(servicio).forEach((f) => f.mockReset());
  confirmar.mockClear();
});

describe("Calendario de Google", () => {
  it("sin Google configurado no aparece", async () => {
    servicio.calendario.mockResolvedValue({
      disponible: false,
      conectado: false,
    });
    const { container } = render(<CalendarioGoogle />);
    await waitFor(() => expect(servicio.calendario).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("explica que solo ve la disponibilidad y lleva a Google", async () => {
    servicio.calendario.mockResolvedValue({
      disponible: true,
      conectado: false,
    });
    servicio.conectarCalendario.mockResolvedValue({
      url: "https://accounts.google.com/x",
    });
    const asignar = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign: asignar });
    render(<CalendarioGoogle />);
    expect(
      await screen.findByText(/«ver los eventos de sus calendarios»/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Conectar mi calendario de Google/ }),
    );
    await waitFor(() =>
      expect(asignar).toHaveBeenCalledWith("https://accounts.google.com/x"),
    );
    vi.unstubAllGlobals();
  });

  it("conectado, se puede desconectar con confirmación", async () => {
    servicio.calendario.mockResolvedValue({
      disponible: true,
      conectado: true,
      conectado_en: "2026-11-17T15:00:00Z",
      error: "",
    });
    servicio.desconectarCalendario.mockResolvedValue({
      disponible: true,
      conectado: false,
    });
    render(<CalendarioGoogle />);
    fireEvent.click(await screen.findByRole("button", { name: "Desconectar" }));
    await waitFor(() =>
      expect(servicio.desconectarCalendario).toHaveBeenCalled(),
    );
    expect(confirmar).toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: /Conectar mi calendario/ }),
    ).toBeInTheDocument();
  });
});
