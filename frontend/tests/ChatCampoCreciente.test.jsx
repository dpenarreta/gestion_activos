import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * El campo del chat crece con el texto hasta 3 líneas y de ahí se desplaza
 * por dentro (16/11/2026).
 */

const { ajustarAltura, LINEAS_MAXIMAS } =
  await import("../src/components/admin/Chat/Conversacion");

function campo(alto) {
  const area = document.createElement("textarea");
  Object.defineProperty(area, "scrollHeight", {
    configurable: true,
    get: () => alto,
  });
  return area;
}

afterEach(() => vi.restoreAllMocks());

describe("Campo de texto del chat", () => {
  const estilo = {
    fontSize: "14px",
    lineHeight: "20px",
    paddingTop: "4px",
    paddingBottom: "4px",
    borderTopWidth: "1px",
    borderBottomWidth: "1px",
  };

  it("crece con el texto sin desplazarse hasta 3 líneas", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue(estilo);
    const area = campo(2 * 20 + 8);
    ajustarAltura(area);
    expect(area.style.height).toBe("50px");
    expect(area.style.overflowY).toBe("hidden");
  });

  it("pasadas 3 líneas se queda en el máximo y se desplaza por dentro", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue(estilo);
    const area = campo(6 * 20 + 8);
    ajustarAltura(area);
    expect(LINEAS_MAXIMAS).toBe(3);
    expect(area.style.height).toBe(`${3 * 20 + 8 + 2}px`);
    expect(area.style.overflowY).toBe("auto");
  });
});
