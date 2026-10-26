import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/*
 * Las reglas de las contraseñas (26/10/2026), las mismas del servidor: al
 * menos 8 caracteres, una mayúscula, un número y un signo especial.
 */

const { ReglasContrasena, cumpleReglas } =
  await import("../src/components/common/ReglasContrasena/ReglasContrasena");

describe("Reglas de la contraseña", () => {
  it.each([
    ["Ab1!xyz", false],
    ["minuscula1!", false],
    ["SinNumero!", false],
    ["SinSigno123", false],
    ["Laar2026#", true],
    ["Cañón-2026", true],
  ])("«%s» cumple: %s", (clave, esperado) => {
    expect(cumpleReglas(clave)).toBe(esperado);
  });

  it("marca cada regla mientras se escribe", () => {
    render(<ReglasContrasena clave="Laar2026" />);
    expect(screen.getByText(/Al menos 8 caracteres/)).toHaveTextContent(
      ": cumple",
    );
    expect(screen.getByText(/Una letra mayúscula/)).toHaveTextContent(
      ": cumple",
    );
    expect(screen.getByText(/Un número/)).toHaveTextContent(": cumple");
    expect(screen.getByText(/Un signo especial/)).toHaveTextContent(": falta");
  });
});
