import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  ubicacion_nombre: "Sede Guayaquil · Bodega TI",
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
  { id: 1, nombre: "Sede Guayaquil" },
  { id: 2, nombre: "Sede Quito Norte" },
];

const UBICACIONES = [
  {
    id: 5,
    sede: 1,
    sede_nombre: "Sede Guayaquil",
    nombre: "Bodega TI",
    tipo: "bodega",
    tipo_display: "Bodega",
    detalle: "",
    nombre_completo: "Sede Guayaquil · Bodega TI",
  },
  {
    id: 9,
    sede: 2,
    sede_nombre: "Sede Quito Norte",
    // Una bodega que no se llama «bodega»: cuando el sistema lo deducía del
    // nombre, esta acababa clasificada como otra cosa y no había dónde
    // corregirlo.
    nombre: "Almacén de Operaciones",
    tipo: "bodega",
    tipo_display: "Bodega",
    detalle: "",
    nombre_completo: "Sede Quito Norte · Almacén de Operaciones",
  },
  {
    id: 12,
    sede: 2,
    sede_nombre: "Sede Quito Norte",
    nombre: "Oficina 302",
    tipo: "oficina",
    tipo_display: "Oficina",
    detalle: "Piso 3",
    nombre_completo: "Sede Quito Norte · Oficina 302",
  },
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

/** Entra al modo traslado y devuelve el desplegable de destino. */
async function trasladar() {
  fireEvent.click(screen.getByLabelText("Trasladar de ubicación"));
  return screen.findByLabelText("Bodega o área de destino");
}

/** Elige la sede por id, como hace el desplegable real. */
function elegirSede(id) {
  fireEvent.change(screen.getByLabelText("Sede de destino"), {
    target: { value: String(id) },
  });
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
    expect(screen.getByText("Sede Guayaquil · Bodega TI")).toBeInTheDocument();
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

describe("Traslado de ubicación", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no habla de personas: el destino de un traslado es un lugar", async () => {
    /* El equipo pasa a una bodega o a un área, no a alguien. Preguntar por el
       responsable aquí sugeriría que el traslado se lo cambia. */
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
    /* Casi todos los traslados son dentro del mismo edificio; empezar con el
       desplegable vacío obliga a recordar dónde estaba. */
    abrir();
    await screen.findByText("Situación actual");
    await trasladar();

    expect(screen.getByLabelText("Sede de destino")).toHaveValue("1");
  });

  it("solo ofrece los lugares de la sede elegida", async () => {
    /* Con varias sedes, «Bodega TI» aparece tantas veces como edificios haya y
       las dos opciones se leen igual: elegir la de la ciudad equivocada manda
       el equipo a buscar a 400 km. */
    abrir();
    await screen.findByText("Situación actual");
    const lugar = await trasladar();

    expect(
      within(lugar).getByRole("option", { name: /Bodega TI/ }),
    ).toBeInTheDocument();
    expect(
      within(lugar).queryByRole("option", { name: /Oficina 302/ }),
    ).not.toBeInTheDocument();

    elegirSede(2);

    expect(
      within(lugar).getByRole("option", { name: /Almacén de Operaciones/ }),
    ).toBeInTheDocument();
    expect(
      within(lugar).queryByRole("option", { name: /Bodega TI/ }),
    ).not.toBeInTheDocument();
  });

  it("agrupa los lugares por lo que son, no por cómo se llaman", async () => {
    /* «Almacén de Operaciones» es una bodega aunque no empiece por «bodega»:
       el grupo sale del catálogo, que es donde se puede corregir. */
    abrir();
    await screen.findByText("Situación actual");
    const lugar = await trasladar();

    elegirSede(2);

    const grupos = [...lugar.querySelectorAll("optgroup")];
    expect(grupos.map((grupo) => grupo.label)).toEqual(["Bodega", "Oficina"]);
    expect(grupos[0].textContent).toContain("Almacén de Operaciones");
  });

  it("cambiar de sede descarta el lugar que ya no pertenece a ella", async () => {
    /* Si no, el formulario diría «Sede Quito Norte» y enviaría una bodega de
       Guayaquil. */
    abrir();
    await screen.findByText("Situación actual");
    const lugar = await trasladar();
    fireEvent.change(lugar, { target: { value: "5" } });

    elegirSede(2);

    expect(lugar).toHaveValue("");
  });

  it("muestra el origen y el destino completos", async () => {
    abrir();
    await screen.findByText("Situación actual");
    const lugar = await trasladar();

    elegirSede(2);
    fireEvent.change(lugar, { target: { value: "9" } });

    // Sobre la línea del cambio y no sobre el texto suelto: el destino también
    // aparece en el desplegable, y lo que se comprueba aquí es que se vea «de
    // dónde a dónde».
    const cambio = document.querySelector(".situacion-actual__cambio");
    expect(cambio).toHaveTextContent("Sede Guayaquil · Bodega TI");
    expect(cambio).toHaveTextContent(
      "Sede Quito Norte · Almacén de Operaciones",
    );
  });

  it("libera al responsable: el equipo pasa al lugar, no a alguien", async () => {
    /* Mover un equipo es sacárselo a quien lo tenía. Dejarlo asignado
       produciría una ficha que dice a la vez «Almacén de Operaciones» y
       «María Salazar», y nadie sabría a quién reclamarle el equipo. */
    abrir();
    await screen.findByText("Situación actual");
    const lugar = await trasladar();

    elegirSede(2);
    fireEvent.change(lugar, { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar traslado" }));

    await waitFor(() =>
      expect(activosService.asignar).toHaveBeenCalledWith(1, {
        custodio: null,
        ubicacion: "9",
        motivo: "",
      }),
    );
  });

  it("el área no se toca: dice de quién es el presupuesto, no quién lo custodia", async () => {
    abrir();
    await screen.findByText("Situación actual");
    const lugar = await trasladar();

    elegirSede(2);
    fireEvent.change(lugar, { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar traslado" }));

    await waitFor(() => expect(activosService.asignar).toHaveBeenCalled());
    expect(activosService.asignar.mock.calls[0][1]).not.toHaveProperty(
      "departamento",
    );
  });
});
