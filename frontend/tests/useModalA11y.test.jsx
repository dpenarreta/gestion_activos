import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("useModalA11y y el clic fuera de la ventana", () => {
  function ConFondo({ onCerrar, ...opciones }) {
    const { panelRef, handleBackdropClick } = useModalA11y({
      isOpen: true,
      onRequestClose: onCerrar,
      ...opciones,
    });
    return (
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div data-testid="fondo" onClick={handleBackdropClick}>
        <div role="dialog" aria-label="Formulario" ref={panelRef} tabIndex={-1}>
          <input aria-label="Nombre" />
        </div>
      </div>
    );
  }

  it("no cierra la ventana: se perdería lo escrito", () => {
    const cerrar = vi.fn();
    render(<ConFondo onCerrar={cerrar} />);
    const nombre = screen.getByRole("textbox", { name: "Nombre" });
    fireEvent.change(nombre, { target: { value: "Algo escrito" } });
    nombre.blur();
    fireEvent.click(screen.getByTestId("fondo"));
    expect(cerrar).not.toHaveBeenCalled();
    expect(nombre).toHaveValue("Algo escrito");
    // Responde con un rebote y el foco vuelve a la ventana, no a <body>.
    const ventana = screen.getByRole("dialog");
    expect(ventana).toHaveClass("mz-modal--rebote");
    expect(ventana).toHaveFocus();
  });

  it("cierra si se pide (el menú lateral del teléfono)", () => {
    const cerrar = vi.fn();
    render(<ConFondo onCerrar={cerrar} closeOnBackdrop />);
    fireEvent.click(screen.getByTestId("fondo"));
    expect(cerrar).toHaveBeenCalledTimes(1);
  });
});

describe("useModalA11y con una grilla de foco itinerante", () => {
  it("Tab no se escapa por los botones con tabindex=-1", () => {
    render(
      <Ventana nombre="Calendario" onCerrar={() => {}}>
        <button type="button">Cerrar</button>
        <button type="button" tabIndex={0}>
          Día con foco
        </button>
        <button type="button" tabIndex={-1}>
          Otro día
        </button>
      </Ventana>,
    );
    const dia = screen.getByRole("button", { name: "Día con foco" });
    dia.focus();
    // El último que recibe Tab es el día con foco: Tab vuelve a «Cerrar».
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(dia).toHaveFocus();
  });
});

describe("useModalA11y con datos sin guardar", () => {
  function Formulario({ onCerrar }) {
    const { panelRef } = useModalA11y({
      isOpen: true,
      onRequestClose: onCerrar,
    });
    return (
      <div role="dialog" aria-label="Formulario" ref={panelRef} tabIndex={-1}>
        <div className="mz-panel-head">
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          />
        </div>
        <form>
          <input aria-label="Nombre" />
          <button type="button" onClick={onCerrar}>
            Cancelar
          </button>
        </form>
      </div>
    );
  }

  it("sin cambios, Escape y Cancelar cierran sin preguntar", () => {
    const cerrar = vi.fn();
    render(<Formulario onCerrar={cerrar} />);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(cerrar).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("¿Descartar los cambios?")).toBeNull();
  });

  it("con algo escrito, Escape pregunta y «Seguir editando» lo conserva", async () => {
    const cerrar = vi.fn();
    render(<Formulario onCerrar={cerrar} />);
    const nombre = screen.getByRole("textbox", { name: "Nombre" });
    fireEvent.input(nombre, { target: { value: "Algo" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      await screen.findByText("¿Descartar los cambios?"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    await waitFor(() =>
      expect(screen.queryByText("¿Descartar los cambios?")).toBeNull(),
    );
    expect(cerrar).not.toHaveBeenCalled();
    expect(nombre).toHaveValue("Algo");
  });

  it("con algo escrito, Cancelar y la X preguntan; «Descartar» cierra", async () => {
    const cerrar = vi.fn();
    render(<Formulario onCerrar={cerrar} />);
    fireEvent.input(screen.getByRole("textbox", { name: "Nombre" }), {
      target: { value: "Algo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(cerrar).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(cerrar).toHaveBeenCalledTimes(1));
  });
});

describe("useModalA11y: lo que no es cerrar la ventana", () => {
  function ConPasos({ onCerrar, onQuitar, onVolver }) {
    const { panelRef } = useModalA11y({
      isOpen: true,
      onRequestClose: onCerrar,
    });
    return (
      <div role="dialog" aria-label="Pasos" ref={panelRef} tabIndex={-1}>
        <form>
          <input aria-label="Nombre" />
          <input aria-label="Buscar" data-sin-descarte />
          <button
            type="button"
            className="mz-close"
            aria-label="Quitar a Luis Torres"
            onClick={onQuitar}
          />
          <div className="mz-panel-foot">
            <button type="button" data-no-descarta onClick={onVolver}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    );
  }

  it("quitar a alguien de una lista o volver de paso no preguntan", () => {
    const quitar = vi.fn();
    const volver = vi.fn();
    render(
      <ConPasos onCerrar={() => {}} onQuitar={quitar} onVolver={volver} />,
    );
    fireEvent.input(screen.getByRole("textbox", { name: "Nombre" }), {
      target: { value: "Algo" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Quitar a Luis Torres" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(quitar).toHaveBeenCalledTimes(1);
    expect(volver).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("¿Descartar los cambios?")).toBeNull();
  });

  it("escribir en un buscador no cuenta como cambio", () => {
    const cerrar = vi.fn();
    render(<ConPasos onCerrar={cerrar} />);
    fireEvent.input(screen.getByRole("textbox", { name: "Buscar" }), {
      target: { value: "Luis" },
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(cerrar).toHaveBeenCalledTimes(1);
  });
});
