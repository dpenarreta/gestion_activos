import { describe, expect, it, vi } from "vitest";

vi.mock("../src/api/institucionalService", () => ({
  institucionalService: {},
}));

const { textoVacantes } =
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
