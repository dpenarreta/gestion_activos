import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Campo } from "../src/components/common/Campo/Campo";
import {
  EstadoDeCarga,
  FilaDeEstado,
} from "../src/components/common/EstadoDeCarga/EstadoDeCarga";
import {
  PanelDePestana,
  Pestanas,
} from "../src/components/common/Pestanas/Pestanas";
import { erroresPorCampo } from "../src/utils/errores";

/*
 * Los componentes comunes de la fase 2 de la auditoría UX/UI (28/10/2026):
 * estados de carga, campos con su error y pestañas accesibles.
 */

describe("EstadoDeCarga", () => {
  it("el error va primero y deja reintentar", () => {
    const reintentar = vi.fn();
    render(
      <EstadoDeCarga cargando error="No se pudo" onReintentar={reintentar} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo");
    expect(screen.queryByText("Cargando…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(reintentar).toHaveBeenCalled();
  });

  it("mientras carga lo anuncia", () => {
    render(<EstadoDeCarga cargando vacio />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
  });

  it("distingue vacío por filtros de vacío sin datos", () => {
    const limpiar = vi.fn();
    const { rerender } = render(
      <EstadoDeCarga vacio hayFiltros onLimpiarFiltros={limpiar} />,
    );
    expect(
      screen.getByText("Ningún resultado con estos filtros."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(limpiar).toHaveBeenCalled();
    rerender(<EstadoDeCarga vacio textoVacio="Sin solicitudes." />);
    expect(screen.getByText("Sin solicitudes.")).toBeInTheDocument();
  });

  it("con datos no pinta nada; en tabla ocupa todas las columnas", () => {
    const { container, rerender } = render(<EstadoDeCarga />);
    expect(container).toBeEmptyDOMElement();
    rerender(
      <table>
        <tbody>
          <FilaDeEstado columnas={4} cargando />
        </tbody>
      </table>,
    );
    expect(screen.getByRole("cell")).toHaveAttribute("colspan", "4");
  });
});

describe("Campo", () => {
  it("marca el obligatorio y asocia la ayuda y el error al control", () => {
    render(
      <Campo
        id="serie"
        etiqueta="Serie"
        obligatorio
        ayuda="La del fabricante."
        error="Ya existe."
      >
        <input className="form-control" />
      </Campo>,
    );
    const control = screen.getByLabelText(/Serie/);
    // Obligatorio para el lector, sin la burbuja nativa del navegador.
    expect(control).toHaveAttribute("aria-required", "true");
    expect(control).not.toHaveAttribute("required");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveClass("form-control", "is-invalid");
    expect(control).toHaveAccessibleDescription(
      "La del fabricante. Ya existe.",
    );
    expect(screen.getByText("(obligatorio)", { exact: false })).toHaveClass(
      "visually-hidden",
    );
  });

  it("sin error no marca nada", () => {
    render(
      <Campo id="nombre" etiqueta="Nombre">
        <input className="form-control" />
      </Campo>,
    );
    const control = screen.getByLabelText("Nombre");
    expect(control).not.toHaveAttribute("aria-required");
    expect(control).not.toHaveAttribute("aria-invalid");
  });
});

describe("Pestanas", () => {
  function ConPanel() {
    const [vista, setVista] = useState("mias");
    return (
      <>
        <Pestanas
          etiqueta="Solicitudes"
          idBase="sp"
          valor={vista}
          onCambio={setVista}
          opciones={[
            { id: "mias", etiqueta: "Mis solicitudes" },
            {
              id: "aprobar",
              etiqueta: "Por aprobar",
              cuenta: 3,
              unidad: "pendientes",
            },
          ]}
        />
        <PanelDePestana idBase="sp" valor={vista}>
          Contenido de {vista}
        </PanelDePestana>
      </>
    );
  }

  it("una parada de Tab, flechas que cambian y panel asociado", () => {
    render(<ConPanel />);
    const mias = screen.getByRole("tab", { name: "Mis solicitudes" });
    expect(mias).toHaveAttribute("tabindex", "0");
    const panel = screen.getByRole("tabpanel");
    expect(mias).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", mias.id);
    mias.focus();
    fireEvent.keyDown(mias, { key: "ArrowRight" });
    const aprobar = screen.getByRole("tab", {
      name: /Por aprobar 3 pendientes/,
    });
    expect(aprobar).toHaveFocus();
    expect(aprobar).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("aprobar");
    fireEvent.keyDown(aprobar, { key: "Home" });
    expect(mias).toHaveFocus();
  });
});

describe("erroresPorCampo", () => {
  it("lee el detalle envuelto y el sin envolver, sin los generales", () => {
    expect(
      erroresPorCampo({
        response: {
          data: {
            error: {
              message: "Error en la solicitud.",
              details: { serie: ["Ya existe."], non_field_errors: ["x"] },
            },
          },
        },
      }),
    ).toEqual({ serie: "Ya existe." });
    expect(
      erroresPorCampo({ response: { data: { nombre: ["Obligatorio."] } } }),
    ).toEqual({ nombre: "Obligatorio." });
    expect(
      erroresPorCampo({ response: { data: { error: { message: "No." } } } }),
    ).toEqual({});
  });
});
