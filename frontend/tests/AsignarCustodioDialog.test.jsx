import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AsignarCustodioDialog } from "../src/components/activos/AsignarCustodioDialog/AsignarCustodioDialog";

const ACTIVO = {
  id: 1,
  codigo_barras: "GA-LAP-000001",
  nombre: "Laptop Contabilidad 01",
  custodio: 3,
  custodio_nombre: "María Salazar",
  departamento: 2,
  departamento_nombre: "Contabilidad",
  ubicacion: 5,
  ubicacion_nombre: "Sucursal Guayaquil · Bodega TI",
};

const EMPLEADOS = [
  {
    id: 3,
    nombre_completo: "María Salazar",
    departamento: 2,
    departamento_nombre: "Contabilidad",
  },
  {
    id: 7,
    nombre_completo: "Luis Torres",
    departamento: 4,
    departamento_nombre: "Tecnología",
  },
];

const UBICACIONES = [
  { id: 5, nombre_completo: "Sucursal Guayaquil · Bodega TI" },
  { id: 9, nombre_completo: "Matriz Quito · Bodega TI" },
];

vi.mock("../src/api/activosService", () => ({
  activosService: { asignar: vi.fn(() => Promise.resolve({})) },
}));

vi.mock("../src/api/organizacionService", () => ({
  empleadosService: {
    list: vi.fn(() => Promise.resolve({ results: EMPLEADOS })),
  },
  departamentosService: {
    list: vi.fn(() =>
      Promise.resolve({
        results: [
          { id: 2, nombre: "Contabilidad" },
          { id: 4, nombre: "Tecnología" },
        ],
      }),
    ),
  },
  ubicacionesService: {
    list: vi.fn(() => Promise.resolve({ results: UBICACIONES })),
  },
}));

const { activosService } = await import("../src/api/activosService");

function abrir(activo = ACTIVO) {
  return render(
    <AsignarCustodioDialog
      activo={activo}
      onCerrar={() => {}}
      onGuardado={() => {}}
    />,
  );
}

describe("Asignar o trasladar un activo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("muestra de entrada quién lo tiene, de qué área y dónde está", async () => {
    /* Es lo primero que se comprueba antes de mover un equipo, y el registro
       que queda en el historial es «de esto a esto». */
    abrir();

    expect(await screen.findByText("Situación actual")).toBeInTheDocument();
    expect(screen.getAllByText("María Salazar").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Contabilidad").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Sucursal Guayaquil · Bodega TI"),
    ).toBeInTheDocument();
  });

  it("dice «sin asignar» y «sin ubicación» cuando el equipo no los tiene", async () => {
    abrir({
      ...ACTIVO,
      custodio: null,
      custodio_nombre: null,
      ubicacion: null,
      ubicacion_nombre: null,
    });

    expect(await screen.findByText("Sin asignar")).toBeInTheDocument();
    expect(screen.getByText("Sin ubicación registrada")).toBeInTheDocument();
  });

  it("al elegir a una persona propone su área", async () => {
    /* Un equipo entregado a alguien de Tecnología normalmente pasa a
       Tecnología; pedir el área dos veces invita a dejarla descuadrada. */
    abrir();
    await screen.findByText("Situación actual");

    fireEvent.change(screen.getByLabelText("Nuevo responsable"), {
      target: { value: "7" },
    });

    expect(
      await screen.findByText(/Luis Torres pertenece a/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Área a la que queda adscrito")).toHaveValue(
      "4",
    );
  });

  it("en el traslado muestra el origen y el destino", async () => {
    abrir();
    await screen.findByText("Situación actual");

    fireEvent.click(screen.getByLabelText("Trasladar de ubicación"));
    fireEvent.change(await screen.findByLabelText("Nueva ubicación"), {
      target: { value: "9" },
    });

    // Sobre la línea del cambio y no sobre el texto suelto: el destino
    // también aparece en el desplegable, y lo que se comprueba aquí es que se
    // vea «de dónde a dónde», no que la opción exista.
    const cambio = document.querySelector(".situacion-actual__cambio");
    expect(cambio).toHaveTextContent("Sucursal Guayaquil · Bodega TI");
    expect(cambio).toHaveTextContent("Matriz Quito · Bodega TI");
    expect(screen.getByText(/El responsable no cambia/)).toBeInTheDocument();
  });

  it("el traslado no toca al custodio ni al área", async () => {
    /* Mover un equipo de bodega no debería cambiarle el responsable por
       descuido: cada modo manda solo lo suyo. */
    abrir();
    await screen.findByText("Situación actual");

    fireEvent.click(screen.getByLabelText("Trasladar de ubicación"));
    fireEvent.change(await screen.findByLabelText("Nueva ubicación"), {
      target: { value: "9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar traslado" }));

    await waitFor(() =>
      expect(activosService.asignar).toHaveBeenCalledWith(1, {
        custodio: 3,
        ubicacion: "9",
        motivo: "",
      }),
    );
  });

  it("la entrega no toca la ubicación", async () => {
    abrir();
    await screen.findByText("Situación actual");

    fireEvent.change(screen.getByLabelText("Nuevo responsable"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(activosService.asignar).toHaveBeenCalled());
    const [, datos] = activosService.asignar.mock.calls[0];
    expect(datos).not.toHaveProperty("ubicacion");
    expect(datos.custodio).toBe("7");
  });

  it("no deja confirmar si no hay nada que cambiar", async () => {
    abrir();
    await screen.findByText("Situación actual");

    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
  });
});
