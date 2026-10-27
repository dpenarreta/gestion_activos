import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CalendarioDeRango } from "../src/pages/Institucional/CalendarioDeRango";

/*
 * El calendario de Solicitud de permisos con el teclado (auditoría UX/UI,
 * 27/10/2026): una sola parada de Tab, las flechas mueven el cursor y Enter
 * (el clic del botón) elige el día.
 */

describe("Calendario de rango con el teclado", () => {
  it("una sola parada de Tab y las flechas mueven el cursor", () => {
    const onCambio = vi.fn();
    render(
      <CalendarioDeRango
        desde="2026-12-10"
        hasta="2026-12-10"
        onCambio={onCambio}
      />,
    );
    const conTab = screen
      .getAllByRole("gridcell")
      .filter((d) => d.getAttribute("tabindex") === "0");
    expect(conTab).toHaveLength(1);
    const inicio = screen.getByRole("gridcell", {
      name: "10 de diciembre de 2026",
    });
    expect(conTab[0]).toBe(inicio);

    inicio.focus();
    fireEvent.keyDown(inicio, { key: "ArrowRight" });
    const siguiente = screen.getByRole("gridcell", {
      name: "11 de diciembre de 2026",
    });
    expect(siguiente).toHaveFocus();
    fireEvent.keyDown(siguiente, { key: "ArrowDown" });
    expect(
      screen.getByRole("gridcell", { name: "18 de diciembre de 2026" }),
    ).toHaveFocus();
    // Mover el cursor no cambia el rango: elegir es con Enter o clic.
    expect(onCambio).not.toHaveBeenCalled();
    fireEvent.click(document.activeElement);
    expect(onCambio).toHaveBeenCalled();

    // AvPág cambia de mes.
    fireEvent.keyDown(document.activeElement, { key: "PageDown" });
    expect(screen.getByText(/Enero de 2027/)).toBeInTheDocument();
    expect(
      screen.getByRole("gridcell", { name: "18 de enero de 2027" }),
    ).toHaveFocus();
  });
});
