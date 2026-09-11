import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AsignarCustodioDialog } from "../src/components/activos/AsignarCustodioDialog/AsignarCustodioDialog";

const ACTIVO = {
  id: 1,
  codigo_barras: "GA-LAP-000001",
  nombre: "Laptop Contabilidad 01",
  compartido: false,
  responsables: [
    { id: 3, nombre_completo: "María Salazar", codigo_empleado: "CTB-0003" },
  ],
  responsables_resumen: "María Salazar",
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
      responsables: [],
      responsables_resumen: "",
      sede: null,
      sede_nombre: null,
      ciudad: null,
    });

    expect(await screen.findByText("Sin asignar")).toBeInTheDocument();
    // Más de uno: el de la situación actual y la opción vacía del desplegable
    // de sede, que desde que la entrega pregunta por el sitio también está.
    expect(screen.getAllByText("Sin sede registrada").length).toBeGreaterThan(
      0,
    );
  });

  it("el área no se pregunta, pero se dice a cuál queda adscrito", async () => {
    /* Es la de quien recibe el equipo, así que preguntarla sería pedir dos
       veces el mismo dato. Cambiarla sin decirlo sería peor: un dato que
       cambia sin que nadie lo vea es un dato que nadie corrige cuando está
       mal. */
    abrir();
    await screen.findByText("Situación actual");

    fireEvent.change(screen.getByLabelText("Nuevo responsable"), {
      target: { value: "7" },
    });

    expect(
      await screen.findByText(/Luis Torres pertenece a/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Quedará adscrito a Tecnología/),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Área a la que queda adscrito"),
    ).not.toBeInTheDocument();
  });

  it("y el área sigue viajando al guardar, aunque no se pregunte", async () => {
    abrir();
    await screen.findByText("Situación actual");

    fireEvent.change(screen.getByLabelText("Nuevo responsable"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(activosService.asignar).toHaveBeenCalled());
    const [, datos] = activosService.asignar.mock.calls[0];
    expect(datos.departamento).toBe("4");
  });

  it("la entrega lleva la sede: se entrega donde el equipo se queda", async () => {
    /* Entregar un equipo suele ser ponerlo donde trabaja quien lo recibe, y
       tener que registrar después un traslado aparte dejaba el sitio
       desactualizado hasta que alguien se acordara. */
    abrir();
    await screen.findByText("Situación actual");

    fireEvent.change(screen.getByLabelText("Nuevo responsable"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("Sede donde queda el equipo"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(activosService.asignar).toHaveBeenCalled());
    const [, datos] = activosService.asignar.mock.calls[0];
    expect(datos.sede).toBe("2");
    expect(datos.responsables).toEqual([7]);
  });

  it("sin tocarla, la entrega deja el equipo donde estaba", async () => {
    abrir();
    await screen.findByText("Situación actual");

    fireEvent.change(screen.getByLabelText("Nuevo responsable"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(activosService.asignar).toHaveBeenCalled());
    const [, datos] = activosService.asignar.mock.calls[0];
    expect(datos.sede).toBe(1);
  });

  it("cambiar solo la sede ya es un movimiento que registrar", async () => {
    abrir();
    await screen.findByText("Situación actual");

    fireEvent.change(screen.getByLabelText("Sede donde queda el equipo"), {
      target: { value: "2" },
    });

    expect(screen.getByRole("button", { name: "Confirmar" })).toBeEnabled();
  });

  it("devolver a bodega avisa de que nadie responderá por él", async () => {
    /* Quien devuelve un equipo lo sabe; quien quita a la última persona de un
       turno, no siempre. Es la consecuencia que hay que leer antes de
       confirmar, no descubrirla después en la ficha. */
    abrir();
    await screen.findByText("Situación actual");

    fireEvent.change(screen.getByLabelText("Nuevo responsable"), {
      target: { value: "" },
    });

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(/sin responsable/);
    expect(aviso).toHaveTextContent(/Nadie responderá por él/);
  });

  it("mientras tenga responsable no hay aviso que leer", async () => {
    abrir();
    await screen.findByText("Situación actual");

    fireEvent.change(screen.getByLabelText("Nuevo responsable"), {
      target: { value: "7" },
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
        responsables: [],
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

// --- Un equipo del que responde más de uno ---------------------------------

describe("Un equipo compartido", () => {
  /* Del escáner del andén responde el turno entero y ninguno responde más que
     otro: no hay un «nuevo responsable» que sustituya al anterior, hay una
     lista de la que se suma y se quita. */
  const COMPARTIDO = {
    ...ACTIVO,
    compartido: true,
    responsables: [
      { id: 3, nombre_completo: "María Salazar", codigo_empleado: "CTB-0003" },
    ],
    responsables_resumen: "María Salazar",
  };

  beforeEach(() => vi.clearAllMocks());

  it("enseña la lista en vez del desplegable de reemplazo", async () => {
    abrir(COMPARTIDO);

    await screen.findByText("Situación actual");
    expect(
      screen.queryByLabelText("Nuevo responsable"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Sumar a alguien")).toBeInTheDocument();
  });

  it("sumar a alguien no quita a quien ya respondía", async () => {
    abrir(COMPARTIDO);
    await screen.findByText("Situación actual");

    fireEvent.change(await screen.findByLabelText("Sumar a alguien"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(activosService.asignar).toHaveBeenCalled());
    const [, datos] = activosService.asignar.mock.calls[0];
    expect(datos.responsables).toEqual([3, 7]);
  });

  it("a quien ya responde no se lo ofrece dos veces", async () => {
    abrir(COMPARTIDO);
    await screen.findByLabelText("Sumar a alguien");

    const textos = [
      ...screen.getByLabelText("Sumar a alguien").querySelectorAll("option"),
    ].map((opcion) => opcion.textContent);

    expect(textos.some((t) => t.includes("María Salazar"))).toBe(false);
    expect(textos.some((t) => t.includes("Luis Torres"))).toBe(true);
  });

  it("se quita a una persona sin tocar a las demás", async () => {
    abrir({
      ...COMPARTIDO,
      responsables: [
        ...COMPARTIDO.responsables,
        { id: 7, nombre_completo: "Luis Torres", codigo_empleado: "TI-0007" },
      ],
      responsables_resumen: "María Salazar, Luis Torres",
    });
    await screen.findByText("Situación actual");

    fireEvent.click(
      await screen.findByRole("button", { name: "Quitar a Luis Torres" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(activosService.asignar).toHaveBeenCalled());
    const [, datos] = activosService.asignar.mock.calls[0];
    expect(datos.responsables).toEqual([3]);
  });

  it("quitar a todos avisa de que el equipo vuelve a bodega", async () => {
    abrir(COMPARTIDO);
    await screen.findByText("Situación actual");

    fireEvent.click(
      await screen.findByRole("button", { name: "Quitar a María Salazar" }),
    );

    expect(screen.getByText("Nadie responde por él")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/sin responsable/);
  });

  it("no deja confirmar si la lista quedó igual", async () => {
    /* Sumar y volver a quitar a la misma persona no es un movimiento: lo que
       se registra en el historial es el cambio, y aquí no lo hubo. */
    abrir(COMPARTIDO);
    await screen.findByLabelText("Sumar a alguien");

    fireEvent.change(screen.getByLabelText("Sumar a alguien"), {
      target: { value: "7" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Quitar a Luis Torres" }),
    );

    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
  });
});
