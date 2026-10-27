import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Button, Form, Modal } from "react-bootstrap";
import { describe, expect, it, vi } from "vitest";

import ModalConCambios from "../src/dashboards/components/common/ModalConCambios";

/*
 * Las ventanas de formulario de dashboards (27/10/2026): con algo escrito,
 * Escape, la X y «Cancelar» preguntan antes de descartarlo.
 */

function Ventana({ onHide }) {
  return (
    <ModalConCambios show onHide={onHide}>
      <Modal.Header closeButton>
        <Modal.Title>Crear dashboard</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Control aria-label="Nombre" />
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" onClick={onHide}>
          Cancelar
        </Button>
      </Modal.Footer>
    </ModalConCambios>
  );
}

describe("ModalConCambios", () => {
  it("sin cambios, Cancelar cierra sin preguntar", () => {
    const onHide = vi.fn();
    render(<Ventana onHide={onHide} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("con algo escrito, Cancelar pregunta y «Seguir editando» no cierra", async () => {
    const onHide = vi.fn();
    render(<Ventana onHide={onHide} />);
    fireEvent.input(screen.getByRole("textbox", { name: "Nombre" }), {
      target: { value: "Ventas" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Seguir editando" }),
    );
    expect(onHide).not.toHaveBeenCalled();
  });

  it("con algo escrito, la X pregunta y «Descartar» cierra", async () => {
    const onHide = vi.fn();
    render(<Ventana onHide={onHide} />);
    fireEvent.input(screen.getByRole("textbox", { name: "Nombre" }), {
      target: { value: "Ventas" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: /close|cerrar/i })[0],
    );
    expect(onHide).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(onHide).toHaveBeenCalledTimes(1));
  });
});
