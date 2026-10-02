import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * La lectura con la cámara del teléfono.
 *
 * Existe porque las etiquetas en QR no las lee una pistola láser: el lector
 * ahí es el teléfono. Lo que se prueba es lo que se rompe en campo —que la
 * cámara se suelte al cerrar, que el permiso denegado se explique y que sin
 * HTTPS se diga por qué— más que el reconocimiento en sí, que es cosa de la
 * librería.
 */

const decodeFromVideoDevice = vi.fn();
const stop = vi.fn();
let constructorLector = vi.fn();

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    constructor(...args) {
      constructorLector(...args);
    }
    decodeFromVideoDevice(...args) {
      return decodeFromVideoDevice(...args);
    }
  },
}));

vi.mock("@zxing/library", () => ({
  BarcodeFormat: { QR_CODE: "QR_CODE", CODE_128: "CODE_128" },
  DecodeHintType: { POSSIBLE_FORMATS: "POSSIBLE_FORMATS" },
}));

const { EscanerCamara } = await import(
  "../src/components/activos/EscanerCamara/EscanerCamara"
);

const originalMediaDevices = navigator.mediaDevices;

function conCamaraDisponible() {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  constructorLector = vi.fn();
  conCamaraDisponible();
  decodeFromVideoDevice.mockResolvedValue({ stop });
});

afterEach(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: originalMediaDevices,
  });
});

describe("El escáner por cámara", () => {
  it("lo que lee se entrega tal cual a quien lo pidió", async () => {
    const leido = vi.fn();
    decodeFromVideoDevice.mockImplementation(
      async (_dispositivo, _video, alLeer) => {
        alLeer({ getText: () => "GA-LAP-000007" });
        return { stop };
      },
    );

    render(<EscanerCamara onLeer={leido} onCerrar={vi.fn()} />);

    await waitFor(() => expect(leido).toHaveBeenCalledWith("GA-LAP-000007"));
  });

  it("busca QR y código de barras, no todo lo que la librería sabe leer", async () => {
    /* Buscar los veinte formatos hace el reconocimiento más lento y más
       propenso a leer cualquier cosa impresa que haya al lado. */
    render(<EscanerCamara onLeer={vi.fn()} onCerrar={vi.fn()} />);

    await waitFor(() => expect(constructorLector).toHaveBeenCalled());
    const pistas = constructorLector.mock.calls[0][0];
    expect(pistas.get("POSSIBLE_FORMATS")).toEqual(["QR_CODE", "CODE_128"]);
  });

  it("suelta la cámara al cerrarla", async () => {
    /* Sin esto el piloto del teléfono se queda encendido hasta cerrar la
       pestaña, y eso se lee como que la aplicación sigue mirando. */
    render(<EscanerCamara onLeer={vi.fn()} onCerrar={vi.fn()} />);
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /Cerrar la cámara/ }));

    expect(stop).toHaveBeenCalled();
  });

  it("y también al desmontarse sin pasar por el botón", async () => {
    const { unmount } = render(
      <EscanerCamara onLeer={vi.fn()} onCerrar={vi.fn()} />,
    );
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalled());

    unmount();

    expect(stop).toHaveBeenCalled();
  });

  it("sin permiso dice qué hacer, no «error»", async () => {
    decodeFromVideoDevice.mockRejectedValue(
      Object.assign(new Error("denegado"), { name: "NotAllowedError" }),
    );

    render(<EscanerCamara onLeer={vi.fn()} onCerrar={vi.fn()} />);

    expect(
      await screen.findByText(/No se concedió permiso para usar la cámara/),
    ).toBeInTheDocument();
  });

  it("si la cámara falla, recuerda que la pistola sigue sirviendo", async () => {
    decodeFromVideoDevice.mockRejectedValue(new Error("sin dispositivo"));

    render(<EscanerCamara onLeer={vi.fn()} onCerrar={vi.fn()} />);

    expect(
      await screen.findByText(/seguir escaneando con la pistola/),
    ).toBeInTheDocument();
  });

  it("sin acceso a la cámara explica el motivo más probable", async () => {
    /* Entrar por http:// es lo que lo causa casi siempre, y sin decirlo
       parece que la aplicación está rota. */
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });

    render(<EscanerCamara onLeer={vi.fn()} onCerrar={vi.fn()} />);

    expect(
      await screen.findByText(/sin HTTPS/),
    ).toBeInTheDocument();
    expect(decodeFromVideoDevice).not.toHaveBeenCalled();
  });
});
