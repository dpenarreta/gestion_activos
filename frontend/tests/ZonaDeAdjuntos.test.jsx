import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import {
  nombreDeCaptura,
  ZonaDeAdjuntos,
} from "../src/components/common/ZonaDeAdjuntos/ZonaDeAdjuntos";

/* Pegar la captura de evidencia directamente (Ctrl+V), arrastrar o elegir
   archivos (18/11/2026). */

function Prueba({ max = 3 }) {
  const [archivos, setArchivos] = useState([]);
  return (
    <>
      <textarea aria-label="Descripción" />
      <ZonaDeAdjuntos
        id="z"
        etiqueta="Capturas o archivos"
        archivos={archivos}
        onCambio={setArchivos}
        max={max}
      />
    </>
  );
}

function pegar(destino, archivos) {
  const items = archivos.map((archivo) => ({
    kind: "file",
    getAsFile: () => archivo,
  }));
  fireEvent.paste(destino, { clipboardData: { items, files: archivos } });
}

describe("Zona de adjuntos", () => {
  it("el nombre accesible de la zona es el de su etiqueta visible", () => {
    render(<Prueba />);
    expect(screen.getByRole("group")).toHaveAccessibleName(
      /^Capturas o archivos Pegue aquí su captura/,
    );
  });

  it("al quitar un archivo el foco no se pierde", () => {
    render(<Prueba />);
    pegar(screen.getByRole("group"), [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Quitar a.png" }));
    expect(screen.getByRole("button", { name: "Quitar b.png" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Quitar b.png" }));
    expect(screen.getByRole("group")).toHaveFocus();
  });

  it("pegar una captura la agrega con un nombre con la fecha", () => {
    render(<Prueba />);
    const captura = new File(["png"], "image.png", { type: "image/png" });
    pegar(screen.getByRole("group"), [captura]);
    const lista = screen.getByRole("list", { name: "Archivos por adjuntar" });
    expect(lista).toHaveTextContent(/captura-\d{4}-\d{2}-\d{2}-\d{6}\.png/);
  });

  it("también al pegar con el foco en otro campo, sin tocar el texto", () => {
    render(<Prueba />);
    const descripcion = screen.getByRole("textbox", { name: "Descripción" });
    pegar(descripcion, [new File(["png"], "image.png", { type: "image/png" })]);
    expect(
      screen.getByRole("list", { name: "Archivos por adjuntar" }),
    ).toBeInTheDocument();
    // Pegar texto no agrega nada.
    fireEvent.paste(descripcion, {
      clipboardData: { items: [{ kind: "string" }], files: [] },
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("arrastrar y soltar, con el tipo y el tamaño validados", async () => {
    render(<Prueba />);
    const grande = new File(["x"], "video.png", { type: "image/png" });
    Object.defineProperty(grande, "size", { value: 11 * 1024 * 1024 });
    fireEvent.drop(screen.getByRole("group"), {
      dataTransfer: {
        files: [
          new File(["x"], "informe.pdf", { type: "application/pdf" }),
          new File(["x"], "programa.exe"),
          grande,
        ],
      },
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /«programa\.exe» no es un tipo permitido; «video\.png» pesa más de 10\.0 MB/,
      ),
    );
  });

  it("nombra la captura con la fecha y la hora", () => {
    expect(nombreDeCaptura("image/jpeg", new Date(2026, 10, 18, 9, 5, 7))).toBe(
      "captura-2026-11-18-090507.jpg",
    );
  });
});
