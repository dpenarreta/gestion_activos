import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { BuscadorDeListas } from "../src/components/common/BuscadorDeListas/BuscadorDeListas";

/*
 * Todo desplegable con buscador (28/10/2026): al abrir un <select> aparece
 * una lista con un buscador arriba que filtra mientras se escribe; al elegir,
 * el <select> recibe el valor con su `change` de siempre.
 */

function Formulario({ onCambio = () => {}, ...props }) {
  const [valor, setValor] = useState("");
  return (
    <>
      <label htmlFor="cargo">Cargo</label>
      <select
        id="cargo"
        value={valor}
        onChange={(e) => {
          setValor(e.target.value);
          onCambio(e.target.value);
        }}
        {...props}
      >
        <option value="">Elija un cargo</option>
        <optgroup label="Comercial">
          <option value="1">Gerente Comercial</option>
          <option value="2">Jefe Comercial Quito</option>
        </optgroup>
        <optgroup label="Talento Humano">
          <option value="3">Jefe Nacional de Talento Humano y SSO</option>
          <option value="4" disabled>
            Cargo inactivo
          </option>
        </optgroup>
      </select>
      <BuscadorDeListas />
    </>
  );
}

const abrir = () =>
  fireEvent.mouseDown(screen.getByLabelText("Cargo"), { button: 0 });

const buscador = () => screen.getByRole("combobox", { name: /^Buscar en/ });
const opciones = () =>
  within(screen.getByRole("listbox")).getAllByRole("option");

describe("BuscadorDeListas", () => {
  it("al abrir, el buscador está arriba con el foco y filtra sin tildes", () => {
    render(<Formulario />);
    abrir();
    const buscar = screen.getByRole("combobox", { name: "Buscar en Cargo" });
    expect(buscar).toHaveFocus();
    expect(opciones()).toHaveLength(5);
    fireEvent.change(buscar, { target: { value: "JEFE" } });
    expect(opciones().map((o) => o.textContent)).toEqual([
      "Jefe Comercial Quito",
      "Jefe Nacional de Talento Humano y SSO",
    ]);
    fireEvent.change(buscar, { target: { value: "comérc" } });
    expect(opciones()).toHaveLength(2);
    fireEvent.change(buscar, { target: { value: "talento jefe" } });
    expect(opciones().map((o) => o.textContent)).toEqual([
      "Jefe Nacional de Talento Humano y SSO",
    ]);
    fireEvent.change(buscar, { target: { value: "xyz" } });
    expect(screen.getByText(/Sin resultados/)).toBeInTheDocument();
  });

  it("Enter elige la primera que coincide y dispara el change del select", () => {
    const onCambio = vi.fn();
    render(<Formulario onCambio={onCambio} />);
    abrir();
    const buscar = buscador();
    fireEvent.change(buscar, { target: { value: "nacional" } });
    fireEvent.keyDown(buscar, { key: "Enter" });
    expect(onCambio).toHaveBeenCalledWith("3");
    expect(screen.getByLabelText("Cargo")).toHaveValue("3");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByLabelText("Cargo")).toHaveFocus();
  });

  it("con el mouse se elige; las deshabilitadas no se eligen", () => {
    const onCambio = vi.fn();
    render(<Formulario onCambio={onCambio} />);
    abrir();
    const lista = screen.getByRole("listbox");
    fireEvent.mouseDown(within(lista).getByText("Cargo inactivo"));
    expect(onCambio).not.toHaveBeenCalled();
    fireEvent.mouseDown(within(lista).getByText("Gerente Comercial"));
    expect(onCambio).toHaveBeenCalledWith("1");
  });

  it("Escape cierra la lista sin llegar a la ventana que la contiene", () => {
    const enDocumento = vi.fn();
    document.addEventListener("keydown", enDocumento);
    render(<Formulario />);
    abrir();
    fireEvent.keyDown(buscador(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(enDocumento).not.toHaveBeenCalled();
    document.removeEventListener("keydown", enDocumento);
  });

  it("también se abre con el teclado, y los marcados quedan nativos", () => {
    const { unmount } = render(<Formulario />);
    fireEvent.keyDown(screen.getByLabelText("Cargo"), { key: " " });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    unmount();
    render(<Formulario data-sin-buscador />);
    abrir();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("BuscadorDeListas en formularios y ventanas", () => {
  it("con una lista abierta, un clic en otro desplegable abre el suyo", () => {
    render(
      <>
        <select aria-label="Primero" defaultValue="a">
          <option value="a">Alfa</option>
        </select>
        <select aria-label="Segundo" defaultValue="b">
          <option value="b">Beta</option>
        </select>
        <BuscadorDeListas />
      </>,
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Primero" }), {
      button: 0,
    });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Segundo" }), {
      button: 0,
    });
    expect(
      screen.getByRole("combobox", { name: "Buscar en Segundo" }),
    ).toHaveFocus();
    expect(within(screen.getByRole("listbox")).getByText("Beta")).toBeTruthy();
  });

  it("dentro de una ventana, la lista se monta en ella (no fuera del aria-modal)", () => {
    render(
      <>
        <div role="dialog" aria-modal="true" aria-label="Ventana">
          <select aria-label="Tipo" defaultValue="x">
            <option value="x">Equis</option>
          </select>
        </div>
        <BuscadorDeListas />
      </>,
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Tipo" }), {
      button: 0,
    });
    expect(
      within(screen.getByRole("dialog", { name: "Ventana" })).getByRole(
        "listbox",
      ),
    ).toBeInTheDocument();
  });
});
