import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/*
 * Confirmación de lectura (22/10/2026): ✓ enviado, ✓✓ leído; en un grupo,
 * por cuántos y quiénes.
 */

vi.mock("../src/api/chatService", () => ({ chatService: {} }));

const { EstadoLectura } =
  await import("../src/components/admin/Chat/Conversacion");

const MENSAJE = { id: 10, propio: true };

describe("La confirmación de lectura", () => {
  it("en un directo: enviado y, al leerlo, leído con la hora", () => {
    const { rerender } = render(
      <EstadoLectura
        mensaje={MENSAJE}
        lecturas={[{ id: 2, nombre: "Beto", ultimo_leido: 9, leido_en: null }]}
        grupal={false}
      />,
    );
    expect(screen.getByText("Enviado")).toBeInTheDocument();

    rerender(
      <EstadoLectura
        mensaje={MENSAJE}
        lecturas={[
          {
            id: 2,
            nombre: "Beto",
            ultimo_leido: 10,
            leido_en: "2026-10-22T15:32:00Z",
          },
        ]}
        grupal={false}
      />,
    );
    const leido = screen.getByText("Leído").closest(".chat-lectura");
    expect(leido).toHaveClass("chat-lectura--leido");
    expect(leido.getAttribute("title")).toMatch(/^Visto a las/);
  });

  it("en un grupo: por cuántos y quiénes", () => {
    const lecturas = [
      { id: 2, nombre: "Beto", ultimo_leido: 12, leido_en: null },
      { id: 3, nombre: "Caro", ultimo_leido: 5, leido_en: null },
      { id: 4, nombre: "Dani", ultimo_leido: 10, leido_en: null },
    ];
    const { rerender } = render(
      <EstadoLectura mensaje={MENSAJE} lecturas={lecturas} grupal />,
    );
    const parcial = screen
      .getByText("Leído por 2 de 3")
      .closest(".chat-lectura");
    expect(parcial.getAttribute("title")).toBe("Lo leyeron: Beto, Dani");

    rerender(
      <EstadoLectura
        mensaje={MENSAJE}
        lecturas={lecturas.map((l) => ({ ...l, ultimo_leido: 20 }))}
        grupal
      />,
    );
    expect(screen.getByText("Leído por todos")).toBeInTheDocument();
  });
});
