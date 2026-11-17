import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pulsar una foto del chat la abre a pantalla completa (17/11/2026); se
 * cierra con Escape, con la X o tocando fuera de la imagen.
 */

const archivo = vi.fn();
vi.mock("../src/api/chatService", () => ({ chatService: { archivo } }));

const { Archivo } = await import("../src/components/admin/Chat/Conversacion");

const FOTO = {
  url: "/api/v1/chat/archivos/3/",
  nombre: "foto.png",
  es_imagen: true,
};

beforeEach(() => {
  archivo.mockReset();
  archivo.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  globalThis.URL.createObjectURL = vi.fn(() => "blob:foto");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("Foto del chat a pantalla completa", () => {
  it("se abre al pulsarla y se cierra con la X", async () => {
    render(<Archivo archivo={FOTO} />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Ver foto.png a pantalla completa",
      }),
    );

    const visor = screen.getByRole("dialog", { name: "foto.png" });
    expect(visor.querySelector("img")).toHaveAttribute("src", "blob:foto");
    expect(
      screen.getByRole("button", { name: /Descargar/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar la imagen" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("se cierra con Escape", async () => {
    render(<Archivo archivo={FOTO} />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Ver foto.png a pantalla completa",
      }),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
