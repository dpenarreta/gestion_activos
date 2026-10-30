import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El visor de presentaciones (30/10/2026): la .pptx se ve dentro del
 * sistema, una diapositiva a la vez, con «Anterior» / «Siguiente» y las
 * flechas del teclado. La librería que dibuja se simula.
 */

const dibujadas = [];
const previsor = {
  slideCount: 3,
  load: vi.fn(() => Promise.resolve()),
  renderSingleSlide: vi.fn((i) => dibujadas.push(i)),
  removeCurrentSlide: vi.fn(),
  destroy: vi.fn(),
};
vi.mock("pptx-preview", () => ({ init: vi.fn(() => previsor) }));

const { VisorPresentacion, esPresentacion } =
  await import("../src/components/common/VisorPresentacion/VisorPresentacion");

function blob() {
  return { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
}

beforeEach(() => {
  dibujadas.length = 0;
  vi.clearAllMocks();
});

describe("Visor de presentaciones", () => {
  it("se navega con los botones y con las flechas del teclado", async () => {
    render(
      <VisorPresentacion
        titulo="Capacitación general"
        blob={blob()}
        nombreArchivo="capacitacion.pptx"
        onCerrar={() => {}}
      />,
    );
    expect(
      await screen.findByText(
        (_, el) => el?.textContent === "Diapositiva 1 de 3",
      ),
    ).toBeInTheDocument();
    const anterior = screen.getByRole("button", { name: /Anterior/ });
    const siguiente = screen.getByRole("button", { name: /Siguiente/ });
    expect(anterior).toBeDisabled();
    await waitFor(() => expect(siguiente).toHaveFocus());

    fireEvent.click(siguiente);
    expect(dibujadas.at(-1)).toBe(1);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(dibujadas.at(-1)).toBe(2);
    expect(siguiente).toBeDisabled();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(dibujadas.at(-1)).toBe(1);
    expect(
      screen.getByRole("img", {
        name: "Diapositiva 2 de 3 de «Capacitación general»",
      }),
    ).toBeInTheDocument();
  });

  it("si no se puede dibujar, lo dice y ofrece descargarla", async () => {
    previsor.load.mockRejectedValueOnce(new Error("dañada"));
    render(
      <VisorPresentacion
        titulo="Rota"
        blob={blob()}
        nombreArchivo="rota.pptx"
        onCerrar={() => {}}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo mostrar la presentación aquí",
    );
    expect(
      screen.getByRole("button", { name: /Descargar/ }),
    ).toBeInTheDocument();
  });

  it("solo la .pptx se dibuja (la .ppt antigua no)", () => {
    expect(esPresentacion("curso.pptx")).toBe(true);
    expect(esPresentacion("CURSO.PPTX")).toBe(true);
    expect(esPresentacion("curso.ppt")).toBe(false);
  });
});
