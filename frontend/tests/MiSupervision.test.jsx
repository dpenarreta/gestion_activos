import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/*
 * «Mi perfil» → Mi línea de supervisión: sus jefes, quienes comparten su
 * cargo y a quiénes supervisa directamente, según el organigrama.
 */

const { MiSupervision } = await import("../src/pages/MisDatos/MiSupervision");

const LINEA = {
  jefes: [
    {
      id: 4,
      nombre: "Gerente General",
      unidad: "Gerencia General",
      personas: [{ id: 24, nombre: "Ana Ñacato" }],
      vacantes: 0,
    },
    {
      id: 99,
      nombre: "Jefe ITD",
      unidad: "Tecnología",
      personas: [],
      vacantes: 1,
    },
  ],
  companeros: [{ id: "sin-cuenta-9", nombre: "Pedro Mora", sin_cuenta: true }],
  supervisa: [
    {
      id: 103,
      nombre: "Coordinador TI",
      unidad: "Tecnología",
      personas: [
        { id: "sin-cuenta-3", nombre: "Ivan Campos", sin_cuenta: true },
      ],
      vacantes: 1,
    },
  ],
};

describe("Mi línea de supervisión", () => {
  it("sin cargo no aparece", () => {
    const { container } = render(<MiSupervision linea={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("muestra a quién reporta, quién comparte su cargo y a quiénes supervisa", () => {
    render(
      <MiSupervision linea={LINEA} cargo={{ id: 106, nombre: "Jefe TI" }} />,
    );
    const jefes = screen.getByLabelText("Sus jefes");
    expect(within(jefes).getByText("Gerente General")).toBeInTheDocument();
    expect(within(jefes).getByText(/Ana Ñacato/)).toBeInTheDocument();
    expect(within(jefes).getByText("Cargo vacante")).toBeInTheDocument();
    expect(screen.getByText("Jefe TI")).toBeInTheDocument();
    expect(screen.getByText(/Pedro Mora/)).toBeInTheDocument();
    const supervisa = screen.getByLabelText("A quiénes supervisa");
    expect(within(supervisa).getByText("Coordinador TI")).toBeInTheDocument();
    expect(within(supervisa).getByText(/Ivan Campos/)).toBeInTheDocument();
    expect(within(supervisa).getByText("1 plaza vacante")).toBeInTheDocument();
  });

  it("sin supervisados lo dice", () => {
    render(
      <MiSupervision
        linea={{ jefes: [], companeros: [], supervisa: [] }}
        cargo={{ id: 1, nombre: "Gerente General" }}
      />,
    );
    expect(screen.getByText(/no reporta a nadie/)).toBeInTheDocument();
    expect(screen.getByText(/Ningún cargo le reporta/)).toBeInTheDocument();
  });
});
