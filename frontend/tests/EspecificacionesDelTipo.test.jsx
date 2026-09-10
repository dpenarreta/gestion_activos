import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EspecificacionesDelTipo } from "../src/components/activos/EspecificacionesDelTipo/EspecificacionesDelTipo";

const CARACTERISTICAS = [
  {
    id: 1,
    nombre: "Procesador",
    dato: "texto",
    unidad: "",
    obligatoria: true,
    opciones: [],
  },
  {
    id: 2,
    nombre: "RAM",
    dato: "entero",
    unidad: "GB",
    obligatoria: false,
    opciones: [],
  },
  {
    id: 3,
    nombre: "Sistema",
    dato: "lista",
    unidad: "",
    obligatoria: false,
    opciones: ["Windows 11", "Ubuntu 22.04"],
  },
  {
    id: 4,
    nombre: "Táctil",
    dato: "booleano",
    unidad: "",
    obligatoria: false,
    opciones: [],
  },
];

function pintar(props = {}) {
  const onChange = vi.fn();
  render(
    <EspecificacionesDelTipo
      caracteristicas={CARACTERISTICAS}
      valor={{}}
      onChange={onChange}
      {...props}
    />,
  );
  return onChange;
}

describe("Características declaradas por el tipo", () => {
  it("pide cada dato como lo que es, no todo como texto", () => {
    pintar();

    // El número lleva su unidad al lado: es lo que evita que alguien escriba
    // «8 GB» dentro del campo y el valor deje de poder compararse.
    expect(screen.getByLabelText(/RAM \(GB\)/)).toHaveAttribute(
      "type",
      "number",
    );
    expect(screen.getByLabelText(/Táctil/)).toHaveRole("combobox");
    expect(
      screen.getByRole("option", { name: "Ubuntu 22.04" }),
    ).toBeInTheDocument();
  });

  it("marca las obligatorias", () => {
    pintar();

    expect(screen.getByLabelText(/Procesador/)).toBeRequired();
    expect(screen.getByLabelText(/RAM/)).not.toBeRequired();
  });

  it("guarda el valor bajo el nombre declarado", () => {
    const onChange = pintar();

    fireEvent.change(screen.getByLabelText(/Procesador/), {
      target: { value: "Intel i7" },
    });

    expect(onChange).toHaveBeenCalledWith({ Procesador: "Intel i7" });
  });

  it("el sí/no viaja como booleano, no como el texto «Sí»", () => {
    const onChange = pintar();

    fireEvent.change(screen.getByLabelText(/Táctil/), {
      target: { value: "true" },
    });

    expect(onChange).toHaveBeenCalledWith({ Táctil: true });
  });

  it("vaciar un campo quita la característica en vez de guardarla vacía", () => {
    const onChange = pintar({ valor: { Procesador: "Intel i7" } });

    fireEvent.change(screen.getByLabelText(/Procesador/), {
      target: { value: "" },
    });

    expect(onChange).toHaveBeenCalledWith({});
  });

  // Un equipo cargado antes de que el tipo se describiera arrastra
  // características que ya nadie declara: se muestran y se conservan.
  it("muestra aparte lo que el equipo traía de antes", () => {
    pintar({
      valor: { Memoria: "8 GB" },
      heredadas: [["Memoria", "8 GB"]],
    });

    expect(screen.getByText("Características anteriores")).toBeInTheDocument();
    expect(screen.getByText("Memoria")).toBeInTheDocument();
  });

  it("sin características anteriores no aparece esa sección", () => {
    pintar();

    expect(
      screen.queryByText("Características anteriores"),
    ).not.toBeInTheDocument();
  });
});
