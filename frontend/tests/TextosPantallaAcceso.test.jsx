import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import {
  PantallaAcceso,
  TEXTOS_ACCESO_POR_DEFECTO,
  textoDeAcceso,
} from "../src/components/common/PantallaAcceso/PantallaAcceso";
import { ThemeContext } from "../src/context/ThemeContext";

/*
 * Los textos de la pantalla de acceso se personalizan en Configuración ›
 * Identidad (17/11/2026).
 */

function pintar(theme) {
  return render(
    <MemoryRouter>
      <ThemeContext.Provider value={{ theme }}>
        <PantallaAcceso titulo="Título">contenido</PantallaAcceso>
      </ThemeContext.Provider>
    </MemoryRouter>,
  );
}

describe("Textos de la pantalla de acceso", () => {
  it("muestra los del tema", () => {
    pintar({
      site_name: "Intranet LCE",
      acceso_lema: "Bienvenido a la intranet",
      acceso_descripcion: "Todo en un lugar.",
      acceso_pie: "Soporte TI · ext. 1234",
    });
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Bienvenido a la intranet",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Todo en un lugar.")).toBeInTheDocument();
    expect(screen.getByText("Soporte TI · ext. 1234")).toBeInTheDocument();
  });

  it("sin tema, los de siempre; vacíos a propósito, no se muestran", () => {
    const { unmount } = pintar(null);
    expect(
      screen.getByText(TEXTOS_ACCESO_POR_DEFECTO.acceso_lema),
    ).toBeInTheDocument();
    unmount();

    pintar({ acceso_lema: "Lema", acceso_descripcion: "", acceso_pie: "" });
    expect(
      screen.queryByText(TEXTOS_ACCESO_POR_DEFECTO.acceso_pie),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(TEXTOS_ACCESO_POR_DEFECTO.acceso_descripcion),
    ).not.toBeInTheDocument();
  });

  it("el título del formulario sale del tema o del de siempre", () => {
    expect(textoDeAcceso({ acceso_titulo: "Ingresar" }, "acceso_titulo")).toBe(
      "Ingresar",
    );
    expect(textoDeAcceso(undefined, "acceso_titulo")).toBe("Acceso al sistema");
  });
});
