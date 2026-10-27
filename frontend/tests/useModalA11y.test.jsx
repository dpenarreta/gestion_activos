import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { useModalA11y } from "../src/hooks/useModalA11y";

/*
 * El hook de todas las ventanas (auditoría UX/UI, 27/10/2026): Escape cierra
 * solo la de arriba, el foco vuelve a quien la abrió y Tab alcanza los
 * botones que se habilitan después de abrir.
 */

function Ventana({ nombre, onCerrar, children }) {
  const { panelRef } = useModalA11y({ isOpen: true, onRequestClose: onCerrar });
  return (
    <div role="dialog" aria-label={nombre} ref={panelRef} tabIndex={-1}>
      {children}
    </div>
  );
}

describe("useModalA11y", () => {
  it("Escape cierra solo la ventana de arriba", () => {
    const cerrarPanel = vi.fn();
    const cerrarFicha = vi.fn();
    render(
      <>
        <Ventana nombre="Panel" onCerrar={cerrarPanel}>
          <button type="button">Algo</button>
        </Ventana>
        <Ventana nombre="Ficha" onCerrar={cerrarFicha}>
          <button type="button">Otra</button>
        </Ventana>
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(cerrarFicha).toHaveBeenCalledTimes(1);
    expect(cerrarPanel).not.toHaveBeenCalled();
  });

  it("al cerrar, el foco vuelve a quien abrió la ventana", () => {
    function Pagina() {
      const [abierta, setAbierta] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setAbierta(true)}>
            Abrir
          </button>
          {abierta && (
            <Ventana nombre="Ventana" onCerrar={() => setAbierta(false)}>
              <button type="button">Dentro</button>
            </Ventana>
          )}
        </>
      );
    }
    render(<Pagina />);
    const abrir = screen.getByRole("button", { name: "Abrir" });
    abrir.focus();
    fireEvent.click(abrir);
    expect(screen.getByRole("button", { name: "Dentro" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(abrir).toHaveFocus();
  });

  it("Tab llega a un botón que se habilitó después de abrir", () => {
    function ConBoton() {
      const [listo, setListo] = useState(false);
      return (
        <Ventana nombre="Importar" onCerrar={() => {}}>
          <button type="button" onClick={() => setListo(true)}>
            Simular
          </button>
          <button type="button" disabled={!listo}>
            Importar
          </button>
        </Ventana>
      );
    }
    render(<ConBoton />);
    const simular = screen.getByRole("button", { name: "Simular" });
    fireEvent.click(simular);
    const importar = screen.getByRole("button", { name: "Importar" });
    importar.focus();
    // Desde el último, Tab vuelve al primero: el último ya es «Importar».
    fireEvent.keyDown(document, { key: "Tab" });
    expect(simular).toHaveFocus();
  });
});
