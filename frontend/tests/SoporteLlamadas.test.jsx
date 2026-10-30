import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * La llamada de voz del ticket (30/10/2026): suena en cualquier pantalla,
 * se contesta o rechaza, y sin HTTPS el botón explica por qué no llama. El
 * audio (WebRTC) y el micrófono se simulan: jsdom no los tiene.
 */

const servicio = {
  llamar: vi.fn(),
  llamadasEntrantes: vi.fn(),
  llamada: vi.fn(),
  contestarLlamada: vi.fn(),
  colgarLlamada: vi.fn(() => Promise.resolve({})),
  colgarAlSalir: vi.fn(),
};

const SIN_LLAMADAS = { entrantes: [], activas: [], esperar: 3 };
vi.mock("../src/api/soporteService", () => ({ soporteService: servicio }));

const { LlamadasProvider, BotonLlamar } =
  await import("../src/pages/Soporte/Llamadas");

class ConexionFalsa {
  constructor() {
    this.iceGatheringState = "complete";
    this.localDescription = { type: "answer", sdp: "sdp-r" };
  }
  addTrack() {}
  addEventListener() {}
  async setRemoteDescription() {}
  async createAnswer() {
    return {};
  }
  async createOffer() {
    return {};
  }
  async setLocalDescription() {}
  close() {}
}

const ENTRANTE = {
  id: 7,
  ticket: 42,
  ticket_numero: "TCK-2026-000042",
  enlace_ticket: "/admin/soporte/tickets/42",
  estado: "sonando",
  soy_llamante: false,
  otro: "Carla Ordóñez",
  oferta: JSON.stringify({ type: "offer", sdp: "sdp-o" }),
  respuesta: "",
};

function pintar(hijos = null) {
  return render(
    <MemoryRouter>
      <LlamadasProvider>{hijos}</LlamadasProvider>
    </MemoryRouter>,
  );
}

const original = {
  seguro: window.isSecureContext,
  rtc: window.RTCPeerConnection,
  medios: navigator.mediaDevices,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "isSecureContext", {
    value: original.seguro,
    configurable: true,
  });
  window.RTCPeerConnection = original.rtc;
  Object.defineProperty(navigator, "mediaDevices", {
    value: original.medios,
    configurable: true,
  });
});

describe("La llamada del ticket", () => {
  it("sin HTTPS, el botón no llama, sigue enfocable y dice por qué", () => {
    Object.defineProperty(window, "isSecureContext", {
      value: false,
      configurable: true,
    });
    pintar(<BotonLlamar ticketId={42} nombre="Jorge Andrade" paraQuienPide />);
    const boton = screen.getByRole("button", {
      name: /Llamar a Jorge Andrade/,
    });
    expect(boton).toHaveAttribute("aria-disabled", "true");
    expect(boton).toHaveAccessibleDescription(
      /Las llamadas aún no están disponibles/,
    );
    fireEvent.click(boton);
    expect(servicio.llamar).not.toHaveBeenCalled();
  });

  it("una llamada entrante suena, se contesta y queda en curso", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    window.RTCPeerConnection = ConexionFalsa;
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn() }],
          getAudioTracks: () => [],
        })),
      },
      configurable: true,
    });
    servicio.llamadasEntrantes.mockResolvedValue({
      ...SIN_LLAMADAS,
      entrantes: [ENTRANTE],
    });
    servicio.contestarLlamada.mockResolvedValue({
      ...ENTRANTE,
      estado: "en_curso",
    });
    servicio.llamada.mockResolvedValue({ ...ENTRANTE, estado: "en_curso" });
    pintar();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    const aviso = await screen.findByRole("region", {
      name: "Carla Ordóñez le está llamando",
    });
    const contestar = screen.getByRole("button", { name: /Contestar/ });
    // No roba el foco: quien escribía no contesta sin querer.
    expect(contestar).not.toHaveFocus();
    expect(aviso).toHaveTextContent("TCK-2026-000042");
    // Se anuncia y el timbre se puede callar sin rechazar.
    expect(
      screen.getByText(/le está llamando por el ticket TCK-2026-000042/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Silenciar timbre/ }));
    expect(
      screen.getByRole("button", { name: /Silenciar timbre/ }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(contestar);
    await waitFor(() =>
      expect(servicio.contestarLlamada).toHaveBeenCalledWith(
        7,
        JSON.stringify({ type: "answer", sdp: "sdp-r" }),
      ),
    );
    expect(
      await screen.findByRole("region", {
        name: /^En llamada con Carla Ordóñez/,
      }),
    ).toBeInTheDocument();
    // Nombre fijo y estado en aria-pressed.
    fireEvent.click(
      screen.getByRole("button", { name: /Silenciar micrófono/ }),
    );
    expect(
      screen.getByRole("button", { name: /Silenciar micrófono/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText("Su micrófono está silenciado."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Colgar/ }));
    await waitFor(() => expect(servicio.colgarLlamada).toHaveBeenCalledWith(7));
    expect(
      (
        await screen.findAllByText(/Llamada terminada .*Quedó en el historial/)
      )[0],
    ).toBeInTheDocument();
  });

  it("rechazar una llamada entrante la cuelga", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    window.RTCPeerConnection = ConexionFalsa;
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    });
    servicio.llamadasEntrantes.mockResolvedValue({
      ...SIN_LLAMADAS,
      entrantes: [ENTRANTE],
    });
    servicio.llamada.mockResolvedValue(ENTRANTE);
    pintar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    fireEvent.click(await screen.findByRole("button", { name: /Rechazar/ }));
    await waitFor(() => expect(servicio.colgarLlamada).toHaveBeenCalledWith(7));
    expect(
      screen.queryByRole("region", { name: /le está llamando/ }),
    ).toBeNull();
  });

  it("al entrar, cuelga la llamada que quedó de una recarga", async () => {
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    window.RTCPeerConnection = ConexionFalsa;
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    });
    servicio.llamadasEntrantes.mockResolvedValue({
      ...SIN_LLAMADAS,
      activas: [{ ...ENTRANTE, id: 9, estado: "en_curso" }],
    });
    pintar();
    await waitFor(() => expect(servicio.colgarLlamada).toHaveBeenCalledWith(9));
    expect(
      await screen.findByText(/Se cortó una llamada al salir de la página/),
    ).toBeInTheDocument();
  });
});
