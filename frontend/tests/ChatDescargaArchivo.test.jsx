import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * En el chat, un archivo que no es foto lleva un botón «Descargar»; pulsar el
 * botón o el nombre lo descarga directamente (16/11/2026).
 */

const archivo = vi.fn();
const descargarBlob = vi.fn();
vi.mock("../src/api/chatService", () => ({ chatService: { archivo } }));
vi.mock("../src/utils/descargas", () => ({ descargarBlob }));

const { Archivo } = await import("../src/components/admin/Chat/Conversacion");

const INFORME = { url: "/api/v1/chat/archivos/7/", nombre: "informe.pdf" };

beforeEach(() => {
  archivo.mockReset();
  descargarBlob.mockReset();
});

describe("Archivos del chat que no son fotos", () => {
  it("el botón Descargar lo descarga con su nombre", async () => {
    const blob = new Blob(["x"]);
    archivo.mockResolvedValue(blob);
    render(<Archivo archivo={INFORME} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Descargar informe.pdf" }),
    );
    await waitFor(() =>
      expect(descargarBlob).toHaveBeenCalledWith(blob, "informe.pdf"),
    );
    expect(archivo).toHaveBeenCalledWith(INFORME.url);
  });

  it("pulsar el nombre también lo descarga", async () => {
    archivo.mockResolvedValue(new Blob(["x"]));
    render(<Archivo archivo={INFORME} />);
    fireEvent.click(screen.getByText("informe.pdf"));
    await waitFor(() => expect(descargarBlob).toHaveBeenCalledTimes(1));
  });

  it("si ya no está disponible, lo dice", async () => {
    archivo.mockRejectedValue(new Error("404"));
    render(<Archivo archivo={INFORME} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Descargar informe.pdf" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El archivo ya no está disponible.",
    );
  });
});
