import { describe, expect, it } from "vitest";

import { formatearDias, formatearMeses } from "../src/utils/formato";

/* La misma tabla vive en backend/apps/core/tests/test_duracion.py: los dos
   lados tienen que contar igual, o el aviso del correo diría una cosa y la
   ficha del equipo otra. */
const CASOS = [
  [0, "0 días"],
  [1, "1 día"],
  [15, "15 días"],
  // El umbral de la regla: hasta 30 se dice en días.
  [30, "30 días"],
  [31, "1 mes y 1 día"],
  [45, "1 mes y 15 días"],
  // Un cero no se dice: «2 meses», no «2 meses y 0 días».
  [60, "2 meses"],
  [89, "2 meses y 29 días"],
  [359, "11 meses y 29 días"],
  // Doce meses son un año: «12 meses» obligaría a hacer la cuenta.
  [360, "1 año"],
  [361, "1 año y 1 día"],
  [395, "1 año, 1 mes y 5 días"],
  [412, "1 año, 1 mes y 22 días"],
  [730, "2 años y 10 días"],
];

describe("Duración en días", () => {
  it.each(CASOS)("%i días se dice «%s»", (dias, esperado) => {
    expect(formatearDias(dias)).toBe(esperado);
  });

  it("sin dato no inventa un cero", () => {
    expect(formatearDias(null)).toBe("—");
    expect(formatearDias(undefined)).toBe("—");
    expect(formatearDias("")).toBe("—");
  });

  // Una garantía vencida se dice «venció hace 2 meses», no «hace -2 meses»:
  // la dirección la pone la frase de alrededor.
  it("del negativo cuenta la magnitud", () => {
    expect(formatearDias(-45)).toBe("1 mes y 15 días");
  });

  it("un valor que no es número se devuelve tal cual", () => {
    expect(formatearDias("pendiente")).toBe("pendiente");
  });
});

describe("Antigüedad en meses", () => {
  it.each([
    [1, "1 mes"],
    [11, "11 meses"],
    [12, "12 meses"],
    [13, "1 año y 1 mes"],
    [24, "2 años"],
    [70, "5 años y 10 meses"],
  ])("%i meses se dice «%s»", (meses, esperado) => {
    expect(formatearMeses(meses)).toBe(esperado);
  });

  it("sin dato no inventa un cero", () => {
    expect(formatearMeses(null)).toBe("—");
  });
});
