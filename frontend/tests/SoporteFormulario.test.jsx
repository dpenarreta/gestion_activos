import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Mesa de ayuda → Formulario: «Soporte TI» arma sus campos con lo que
 * configuró la empresa, y el editor los agrega, ordena y protege. Los datos de
 * contacto salen de «Mi perfil» y no se preguntan.
 */

const servicio = {
  solicitar: vi.fn(),
  crearTicket: vi.fn(),
  config: {
    listar: vi.fn(),
    crear: vi.fn(),
    actualizar: vi.fn(),
    eliminar: vi.fn(),
    ordenarCampos: vi.fn(),
  },
};
vi.mock("../src/api/soporteService", () => ({ soporteService: servicio }));

const { NuevoTicket } = await import("../src/pages/Ayuda/NuevoTicket");
const { FormularioEditor } =
  await import("../src/pages/Soporte/FormularioEditor");

function base(clave, etiqueta, tipo, extra = {}) {
  return {
    clave,
    etiqueta,
    tipo,
    ayuda: "",
    opciones: [],
    obligatorio: true,
    base: true,
    categorias: [],
    ...extra,
  };
}

const HARDWARE = {
  id: 3,
  nombre: "Hardware",
  activa: true,
  casos: [
    {
      id: 4,
      nombre: "No enciende",
      prioridad: "alta",
      prioridad_display: "Alta",
      activo: true,
    },
  ],
};
const ACCESOS = {
  id: 5,
  nombre: "Accesos",
  activa: true,
  casos: [
    {
      id: 6,
      nombre: "Olvidé mi clave",
      prioridad: "baja",
      prioridad_display: "Baja",
      activo: true,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("El formulario configurable de Soporte TI", () => {
  it("pinta los campos de la empresa y pide los propios solo en su categoría", async () => {
    servicio.solicitar.mockResolvedValue({
      empresa: "LaarCourier",
      disponible: true,
      agencias: [],
      areas: [],
      categorias: [HARDWARE, ACCESOS],
      mis_datos: {
        nombre: "Carla Ordóñez",
        correo: "carla@grupolaar.com",
        telefono: "0994182273",
        area: { id: 2, nombre: "Cobranzas" },
        agencia: { id: 1, nombre: "Loja" },
        faltan: [],
      },
      campos: [
        base("categoria", "Categoría", "lista"),
        base("caso", "Caso de ayuda", "lista"),
        base("descripcion", "Describa el problema", "parrafo"),
        {
          ...base("serie", "Serie del equipo", "lista"),
          base: false,
          opciones: ["PF3K9ZL", "MX20991"],
          categorias: [3],
        },
        {
          ...base("urgente", "Bloquea su trabajo", "casilla"),
          base: false,
          obligatorio: false,
        },
      ],
    });
    servicio.crearTicket.mockResolvedValue({
      id: 1,
      numero: "TCK-2026-000001",
      posicion: 1,
      estado: "nuevo",
    });
    render(
      <MemoryRouter initialEntries={["/admin/ayuda"]}>
        <Routes>
          <Route path="/admin/ayuda" element={<NuevoTicket />} />
        </Routes>
      </MemoryRouter>,
    );

    // Los datos de contacto salen de «Mi perfil»: no se preguntan.
    expect(await screen.findByText("Carla Ordóñez")).toBeInTheDocument();
    expect(screen.queryByLabelText("Teléfono de contacto")).toBeNull();

    fireEvent.change(screen.getByLabelText("Categoría"), {
      target: { value: "5" },
    });
    expect(screen.queryByLabelText("Serie del equipo")).toBeNull();
    fireEvent.change(screen.getByLabelText("Categoría"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Serie del equipo"), {
      target: { value: "MX20991" },
    });
    fireEvent.click(screen.getByLabelText("Bloquea su trabajo"));
    fireEvent.change(screen.getByLabelText("Caso de ayuda"), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("Describa el problema"), {
      target: { value: "No prende" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear ticket" }));

    await waitFor(() => expect(servicio.crearTicket).toHaveBeenCalled());
    const campos = servicio.crearTicket.mock.calls[0][0];
    expect(JSON.parse(campos.adicionales)).toEqual({
      serie: "MX20991",
      urgente: true,
    });
  });
});

function campo(id, clave, etiqueta, extra = {}) {
  return {
    id,
    clave,
    etiqueta,
    ayuda: "",
    tipo: "texto",
    tipo_display: "Texto corto",
    opciones: [],
    obligatorio: true,
    activo: true,
    base: true,
    bloqueado: true,
    categorias: [],
    ...extra,
  };
}

const CAMPOS = [
  campo(1, "nombre", "Nombre y apellido"),
  campo(2, "telefono", "Teléfono de contacto", { bloqueado: false }),
  campo(3, "descripcion", "Describa el problema", {
    tipo: "parrafo",
    tipo_display: "Párrafo",
  }),
];

function pintarEditor() {
  servicio.config.listar.mockImplementation((recurso) =>
    Promise.resolve(recurso === "formulario" ? CAMPOS : [HARDWARE, ACCESOS]),
  );
  return render(
    <MemoryRouter>
      <FormularioEditor />
    </MemoryRouter>,
  );
}

describe("El editor del formulario", () => {
  it("agrega un campo de lista limitado a una categoría", async () => {
    servicio.config.crear.mockResolvedValue({});
    pintarEditor();
    fireEvent.click(
      await screen.findByRole("button", { name: /Agregar campo/ }),
    );
    const editor = screen.getByRole("form", { name: "Campo nuevo" });
    fireEvent.change(within(editor).getByLabelText("Pregunta"), {
      target: { value: "Serie del equipo" },
    });
    fireEvent.change(within(editor).getByLabelText("Tipo"), {
      target: { value: "lista" },
    });
    fireEvent.change(within(editor).getByLabelText(/Opciones/), {
      target: { value: "PF3K9ZL\n\n MX20991 " },
    });
    fireEvent.click(within(editor).getByLabelText("Hardware"));
    fireEvent.click(within(editor).getByRole("button", { name: "Agregar" }));

    await waitFor(() =>
      expect(servicio.config.crear).toHaveBeenCalledWith("formulario", {
        etiqueta: "Serie del equipo",
        ayuda: "",
        obligatorio: false,
        activo: true,
        tipo: "lista",
        opciones: ["PF3K9ZL", "MX20991"],
        categorias: [3],
      }),
    );
  });

  it("los campos que la cola necesita no se pueden ocultar ni quitar", async () => {
    pintarEditor();
    const lista = await screen.findByRole("list", {
      name: "Campos del formulario",
    });
    const nombre = within(lista).getAllByRole("listitem")[0];
    expect(within(nombre).queryByRole("button", { name: "Quitar" })).toBeNull();
    fireEvent.click(within(nombre).getByRole("button", { name: "Editar" }));
    expect(screen.getByLabelText("Mostrar en el formulario")).toBeDisabled();
    expect(screen.getByLabelText("Tipo")).toBeDisabled();
  });

  it("subir un campo manda el nuevo orden y la vista previa lo refleja", async () => {
    servicio.config.ordenarCampos.mockResolvedValue([]);
    pintarEditor();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Subir «Teléfono de contacto»",
      }),
    );
    await waitFor(() =>
      expect(servicio.config.ordenarCampos).toHaveBeenCalledWith([2, 1, 3]),
    );
    const vista = screen.getByRole("form", {
      name: "Vista previa del formulario",
    });
    // Los datos de contacto no se preguntan: no están en la vista previa.
    expect(within(vista).queryByLabelText("Nombre y apellido")).toBeNull();
    expect(
      within(vista).getByLabelText("Describa el problema"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("De «Mi perfil»").length).toBe(2);
  });
});
