import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Al crear un usuario, el código de empleado se sugiere desde nómina por
 * nombres y apellidos; con varias coincidencias se elige (17/11/2026).
 */

const coincidencias = vi.fn();
vi.mock("../src/api/sincronizacionNominaService", () => ({
  sincronizacionNominaService: { coincidencias },
}));

const { CodigoDesdeNomina } =
  await import("../src/pages/Admin/Users/CodigoDesdeNomina");

const DANIEL = {
  codigo: "20104758",
  nombres: "Daniel Patricio",
  apellidos: "Peñarreta Feijoo",
  correo: "dpenarreta@grupolaar.com",
  asignado_a: null,
};

beforeEach(() => coincidencias.mockReset());

describe("Código de empleado desde nómina", () => {
  it("una coincidencia se ofrece y se usa", async () => {
    coincidencias.mockResolvedValue({
      configurada: true,
      resultados: [DANIEL],
    });
    const onUsar = vi.fn();
    render(
      <CodigoDesdeNomina
        nombres="Daniel"
        apellidos="Peñarreta"
        codigo=""
        onUsar={onUsar}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Usar este código/ }),
    );
    expect(onUsar).toHaveBeenCalledWith("20104758");
    expect(coincidencias).toHaveBeenCalledWith("Daniel", "Peñarreta");
  });

  it("varias coincidencias se listan; la que ya tiene cuenta no se puede elegir", async () => {
    coincidencias.mockResolvedValue({
      configurada: true,
      resultados: [
        { ...DANIEL, asignado_a: "dpenarreta" },
        {
          ...DANIEL,
          codigo: "20100001",
          apellidos: "Peñarreta Ruiz",
          correo: "",
        },
      ],
    });
    render(
      <CodigoDesdeNomina
        nombres="Daniel"
        apellidos="Peñarreta"
        codigo=""
        onUsar={() => {}}
      />,
    );
    expect(
      await screen.findByText(/hay 2 personas con ese nombre/),
    ).toBeInTheDocument();
    const botones = screen.getAllByRole("button", { name: /Usar este código/ });
    expect(botones[0]).toBeDisabled();
    expect(botones[1]).toBeEnabled();
    expect(
      screen.getByText(/ya es de la cuenta «dpenarreta»/),
    ).toBeInTheDocument();
  });

  it("con el código ya puesto, confirma que coincide", async () => {
    coincidencias.mockResolvedValue({
      configurada: true,
      resultados: [DANIEL],
    });
    render(
      <CodigoDesdeNomina
        nombres="Daniel"
        apellidos="Peñarreta"
        codigo="20104758"
        onUsar={() => {}}
      />,
    );
    expect(await screen.findByText(/Coincide con nómina/)).toBeInTheDocument();
  });

  it("sin nombres y apellidos no consulta", () => {
    render(
      <CodigoDesdeNomina
        nombres="Daniel"
        apellidos=""
        codigo=""
        onUsar={() => {}}
      />,
    );
    expect(coincidencias).not.toHaveBeenCalled();
  });
});
