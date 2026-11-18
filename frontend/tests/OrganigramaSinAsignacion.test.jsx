import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/api/institucionalService", () => ({
  institucionalService: {},
}));

const { Plazas, textoVacantes } =
  await import("../src/pages/Institucional/OrganigramaPage");

/* Un cargo sin nadie asignado dice «Sin asignación» (17/11/2026). */
describe("Plazas del organigrama", () => {
  it("sin asignados, «Sin asignación»; con alguno, las plazas que faltan", () => {
    expect(textoVacantes({ ocupantes: [], vacantes: 1, plazas: 1 })).toBe(
      "Sin asignación",
    );
    expect(
      textoVacantes({ ocupantes: [{ id: 1 }], vacantes: 2, plazas: 3 }),
    ).toBe("2 plazas vacantes");
    expect(
      textoVacantes({ ocupantes: [{ id: 1 }], vacantes: 1, plazas: 2 }),
    ).toBe("1 plaza vacante");
  });
});

/* Cada cargo dice cuántas plazas tiene cubiertas, también con una sola:
   «0/1» vacante, «1/1» cubierto (18/11/2026). */
describe("Ocupación de cada cargo", () => {
  it.each([
    [{ plazas: 1, vacantes: 1 }, "0/1", true],
    [{ plazas: 3, vacantes: 1 }, "2/3", true],
    [{ plazas: 1, vacantes: 0 }, "1/1", false],
    [{ plazas: 5, vacantes: 0 }, "5/5", false],
  ])("%o se muestra %s", (cargo, texto, vacante) => {
    const { container } = render(<Plazas cargo={cargo} />);
    expect(screen.getByText(texto)).toBeInTheDocument();
    expect(
      container
        .querySelector(".org-plazas")
        .classList.contains("org-plazas--vacante"),
    ).toBe(vacante);
  });
});
