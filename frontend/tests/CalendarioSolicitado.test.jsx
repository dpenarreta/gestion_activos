import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/*
 * El calendario reducido del detalle de una solicitud: solo sus semanas, los
 * días pedidos marcados y si toma fines de semana.
 */

const { CalendarioSolicitado } =
  await import("../src/pages/Institucional/CalendarioSolicitado");

describe("Calendario de los días solicitados", () => {
  it("de lunes a viernes: una semana, ningún fin de semana", () => {
    render(<CalendarioSolicitado desde="2026-11-16" hasta="2026-11-20" />);
    const calendario = screen.getByRole("region", { name: "Días solicitados" });
    // Una sola semana (más la cabecera).
    expect(within(calendario).getAllByRole("row")).toHaveLength(2);
    expect(within(calendario).getAllByLabelText(/solicitado$/)).toHaveLength(5);
    expect(
      within(calendario).getByText(/5 días · ninguno de fin de semana/),
    ).toBeInTheDocument();
  });

  it("si toma un fin de semana lo dice", () => {
    render(<CalendarioSolicitado desde="2026-11-19" hasta="2026-11-25" />);
    const calendario = screen.getByRole("region", { name: "Días solicitados" });
    expect(within(calendario).getAllByRole("row")).toHaveLength(3);
    expect(
      within(calendario).getByText(
        /2 de fin de semana \(1 sábado y 1 domingo\)/,
      ),
    ).toBeInTheDocument();
    expect(
      within(calendario).getByLabelText("sábado, 21 de noviembre, solicitado"),
    ).toHaveClass("is-pedido", "is-finde");
  });
});
