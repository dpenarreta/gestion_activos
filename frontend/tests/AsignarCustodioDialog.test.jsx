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
  sede: 1,
  sede_nombre: "Sede Quito Norte",
  ciudad: "Quito",
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

const SEDES = [
  { id: 1, nombre: "Sede Quito Norte", ciudad: "Quito" },
  { id: 2, nombre: "Sede Guayaquil", ciudad: "Guayaquil" },
  // Sin ciudad rellenada: responde con su nombre en vez de dejar un hueco.
  { id: 3, nombre: "Sucursal Machala", ciudad: "" },
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
  sedesService: { list: vi.fn(() => Promise.resolve({ results: SEDES })) },
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

/** Entra al modo traslado y devuelve el desplegable de destino. */
async function trasladar() {
  fireEvent.click(screen.getByLabelText("Trasladar de ubicación"));
  return screen.findByLabelText("Sede de destino");
}

describe("Asignar o trasladar un activo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("muestra de entrada quién lo tiene, de qué área y en qué ciudad está", async () => {
    /* Es lo primero que se comprueba antes de mover un equipo, y el registro
       que queda en el historial es «de esto a esto». */
    abrir();

    expect(await screen.findByText("Situación actual")).toBeInTheDocument();
    expect(screen.getAllByText("María Salazar").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Contabilidad").length).toBeGreaterThan(0);
    expect(screen.getByText("Quito")).toBeInTheDocument();
  });

  it("dice «sin asignar» y «sin sede» cuando el equipo no los tiene", async () => {
    abrir({
      ...ACTIVO,
      custodio: null,
      custodio_nombre: null,
      sede: null,
      sede_nombre: null,
      ciudad: null,
    });

    expect(await screen.findByText("Sin asignar")).toBeInTheDocument();
    expect(screen.getByText("Sin sede registrada")).toBeInTheDocument();
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

  it("la entrega no toca la sede", async () => {
    abrir();
    await screen.findByText("Situación actual");

    fireEvent.change(screen.getByLabelText("Nuevo responsable"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(activosService.asignar).toHaveBeenCalled());
    const [, datos] = activosService.asignar.mock.calls[0];
    expect(datos).not.toHaveProperty("sede");
    expect(datos.custodio).toBe("7");
  });

  it("no deja confirmar si no hay nada que cambiar", async () => {
    abrir();
    await screen.findByText("Situación actual");

    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
  });
});

describe("Traslado de sede", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no habla de personas: el destino de un traslado es un lugar", async () => {
    /* El equipo pasa a una sede, no a alguien. Preguntar por el responsable
       aquí sugeriría que el traslado se lo cambia. */
    abrir();
    await screen.findByText("Situación actual");
    await trasladar();

    expect(
      screen.queryByLabelText("Nuevo responsable"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Área a la que queda adscrito"),
    ).not.toBeInTheDocument();
  });

  it("avisa de que el equipo quedará sin responsable", async () => {
    /* Es la consecuencia menos evidente del traslado —el equipo cambia de
       sitio *y* deja de tener responsable—: descubrirla después en la ficha es
       peor que leerla antes de confirmar. */
    abrir();
    await screen.findByText("Situación actual");
    await trasladar();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Aviso: El equipo quedará sin responsable y se asignará únicamente a la nueva ubicación",
    );
  });

  it("el aviso no aparece al entregar, que no cambia de sitio el equipo", async () => {
    abrir();
    await screen.findByText("Situación actual");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("arranca en la sede donde está el equipo", async () => {
    /* Empezar con el desplegable vacío obliga a recordar dónde estaba. */
    abrir();
    await screen.findByText("Situación actual");
    const destino = await trasladar();

    expect(destino).toHaveValue("1");
  });

  it("cuenta el traslado en ciudades: «de Quito a Guayaquil»", async () => {
    /* El nombre interno de la sede no le dice nada a quien tiene que ir a
       buscar el equipo. */
    abrir();
    await screen.findByText("Situación actual");
    const destino = await trasladar();

    fireEvent.change(destino, { target: { value: "2" } });

    const cambio = document.querySelector(".situacion-actual__cambio");
    expect(cambio).toHaveTextContent("Quito");
    expect(cambio).toHaveTextContent("Guayaquil");
  });

  it("una sede sin ciudad se cuenta con su nombre, no con un hueco", async () => {
    abrir();
    await screen.findByText("Situación actual");
    const destino = await trasladar();

    fireEvent.change(destino, { target: { value: "3" } });

    expect(
      document.querySelector(".situacion-actual__cambio"),
    ).toHaveTextContent("Sucursal Machala");
  });

  it("libera al responsable: el equipo pasa al lugar, no a alguien", async () => {
    /* Mover un equipo es sacárselo a quien lo tenía. Dejarlo asignado
       produciría una ficha que dice a la vez «Guayaquil» y «María Salazar», y
       nadie sabría a quién reclamarle el equipo. */
    abrir();
    await screen.findByText("Situación actual");
    const destino = await trasladar();

    fireEvent.change(destino, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar traslado" }));

    await waitFor(() =>
      expect(activosService.asignar).toHaveBeenCalledWith(1, {
        custodio: null,
        sede: "2",
        motivo: "",
      }),
    );
  });

  it("el área no se toca: dice de quién es el presupuesto, no quién lo custodia", async () => {
    abrir();
    await screen.findByText("Situación actual");
    const destino = await trasladar();

    fireEvent.change(destino, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar traslado" }));

    await waitFor(() => expect(activosService.asignar).toHaveBeenCalled());
    expect(activosService.asignar.mock.calls[0][1]).not.toHaveProperty(
      "departamento",
    );
  });
});
