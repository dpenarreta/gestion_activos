import { describe, expect, it } from "vitest";

import { baseDeUsername } from "../src/utils/nomenclatura";

/*
 * La vista previa del nombre de usuario sigue la misma regla que el backend
 * (`apps.users.nomenclatura`).
 */
describe("baseDeUsername", () => {
  it("inicial del nombre y apellidos completos, sin tildes", () => {
    expect(baseDeUsername("Diego", "Peñarreta Vaca")).toBe("dpenarretavaca");
    expect(baseDeUsername("Juan Carlos", "Pérez")).toBe("jperez");
  });

  it("sin apellidos parte el nombre y nunca deja una letra suelta", () => {
    expect(baseDeUsername("Anthony Jacome", "")).toBe("ajacome");
    expect(baseDeUsername("JOSE ANDALUZ", "  ")).toBe("jandaluz");
    expect(baseDeUsername("Recepción", "")).toBe("recepcion");
  });
});
