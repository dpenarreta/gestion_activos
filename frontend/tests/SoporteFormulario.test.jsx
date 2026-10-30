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
  peso: 2,
  casos: [
    {
      id: 4,
      nombre: "No enciende",
      peso: 1,
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
  peso: 1,
  casos: [
    {
      id: 6,
      nombre: "Olvidé mi clave",
      peso: 1,
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
    expect(await screen.findByText(/Carla Ordóñez/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Teléfono de contacto")).toBeNull();

    fireEvent.change(screen.getByLabelText(/^Categoría/), {
      target: { value: "5" },
    });
    expect(screen.queryByLabelText("Serie del equipo")).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Categoría/), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText(/^Serie del equipo/), {
      target: { value: "MX20991" },
    });
    fireEvent.click(screen.getByLabelText(/^Bloquea su trabajo/));
    fireEvent.change(screen.getByLabelText(/^Caso de ayuda/), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText(/^Describa el problema/), {
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
      within(vista).getByLabelText(/^Describa el problema/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("De «Mi perfil»").length).toBe(2);
  });
});

const CRITICIDAD = {
  areas: [
    { id: 20, nombre: "Talento Humano", peso: 1 },
    { id: 21, nombre: "Operaciones", peso: 2 },
  ],
  niveles: [
    { id: 30, nombre: "Gerencia", orden: 0, peso: 2 },
    { id: 31, nombre: "Área", orden: 1, peso: 1 },
  ],
};

/* Las opciones de los desplegables del sistema se editan desde el propio
   formulario (21/10/2026). */
describe("Las opciones de los desplegables del sistema", () => {
  const SISTEMA = [
    campo(7, "categoria", "Categoría", { tipo: "lista" }),
    campo(8, "caso", "Caso de ayuda", { tipo: "lista" }),
    campo(9, "impacto", "¿A quién afecta?", {
      tipo: "lista",
      bloqueado: false,
      opciones: ["Solo a mí", "A mi área", "A toda la empresa"],
      valores: ["bajo", "medio", "alto"],
    }),
  ];

  function pintar() {
    servicio.config.listar.mockImplementation((recurso) =>
      Promise.resolve(
        recurso === "formulario"
          ? SISTEMA
          : recurso === "criticidad"
            ? CRITICIDAD
            : [HARDWARE, ACCESOS],
      ),
    );
    render(
      <MemoryRouter>
        <FormularioEditor />
      </MemoryRouter>,
    );
  }

  async function editar(etiqueta) {
    const lista = await screen.findByRole("list", {
      name: "Campos del formulario",
    });
    const fila = within(lista)
      .getAllByRole("listitem")
      .find((li) => li.textContent.includes(etiqueta));
    fireEvent.click(within(fila).getByRole("button", { name: "Editar" }));
    return screen.getByRole("form", { name: `Editar «${etiqueta}»` });
  }

  it("las categorías se renombran, se ocultan y se agregan", async () => {
    servicio.config.actualizar.mockResolvedValue({});
    servicio.config.crear.mockResolvedValue({});
    pintar();
    const editor = await editar("Categoría");

    fireEvent.change(
      within(editor).getByLabelText("Nombre de la categoría «Hardware»"),
      { target: { value: "Equipos" } },
    );
    const fila = within(editor)
      .getByLabelText("Nombre de la categoría «Hardware»")
      .closest("li");
    fireEvent.click(within(fila).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(servicio.config.actualizar).toHaveBeenCalledWith("categorias", 3, {
        nombre: "Equipos",
      }),
    );

    // Ocultar se confirma: deja de ofrecerse al pedir ayuda.
    fireEvent.click(within(editor).getByLabelText("Mostrar «Accesos»"));
    fireEvent.click(
      within(
        await screen.findByRole("dialog", { name: "¿Ocultar «Accesos»?" }),
      ).getByRole("button", { name: "Ocultar" }),
    );
    await waitFor(() =>
      expect(servicio.config.actualizar).toHaveBeenCalledWith("categorias", 5, {
        activa: false,
      }),
    );

    fireEvent.change(within(editor).getByLabelText(/Nueva opción: categoría/), {
      target: { value: "Impresoras" },
    });
    fireEvent.click(within(editor).getByRole("button", { name: /Agregar/ }));
    await waitFor(() =>
      expect(servicio.config.crear).toHaveBeenCalledWith("categorias", {
        nombre: "Impresoras",
        activa: true,
      }),
    );
  });

  it("los casos se agregan dentro de su categoría", async () => {
    servicio.config.crear.mockResolvedValue({});
    pintar();
    const editor = await editar("Caso de ayuda");
    expect(
      within(editor).getByLabelText("Nombre de el caso «No enciende»"),
    ).toBeInTheDocument();
    fireEvent.change(
      within(editor).getByLabelText("Nueva opción: caso en Accesos"),
      { target: { value: "Cuenta bloqueada" } },
    );
    const grupo = within(editor)
      .getByLabelText("Nueva opción: caso en Accesos")
      .closest("div");
    fireEvent.click(within(grupo).getByRole("button", { name: /Agregar/ }));
    await waitFor(() =>
      expect(servicio.config.crear).toHaveBeenCalledWith("casos", {
        categoria: 5,
        nombre: "Cuenta bloqueada",
        activo: true,
      }),
    );
  });

  it("el texto de las opciones de impacto se cambia y se guarda", async () => {
    servicio.config.actualizar.mockResolvedValue({});
    pintar();
    const editor = await editar("¿A quién afecta?");
    fireEvent.change(
      within(editor).getByLabelText(/Afecta a un grupo · peso 2/),
      {
        target: { value: "A mi equipo" },
      },
    );
    fireEvent.click(within(editor).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(servicio.config.actualizar).toHaveBeenCalledWith(
        "formulario",
        9,
        expect.objectContaining({
          opciones: ["Solo a mí", "A mi equipo", "A toda la empresa"],
        }),
      ),
    );
  });

  it("las flechas cambian el peso de una categoría en la criticidad", async () => {
    servicio.config.ponderar = vi.fn().mockResolvedValue([]);
    pintar();
    const editor = await editar("Categoría");
    // Se lee de más a menos crítica: Hardware (2/2) y Accesos (1/2).
    expect(within(editor).getByText("2/2")).toBeInTheDocument();
    expect(
      within(editor).getByRole("button", { name: "Más crítico: «Hardware»" }),
    ).toBeDisabled();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Más crítico: «Accesos»" }),
    );
    // Se manda de menos a más crítica: ahora Hardware vale 1 y Accesos 2.
    await waitFor(() =>
      expect(servicio.config.ponderar).toHaveBeenCalledWith("categorias", {
        ids: [3, 5],
      }),
    );
  });

  it("las áreas se reordenan y los niveles se muestran con su peso", async () => {
    servicio.config.crear.mockResolvedValue(CRITICIDAD);
    pintar();
    const panel = await screen.findByRole("region", {
      name: "Criticidad según quien pide",
    });
    // De más a menos crítica: Operaciones (2/2) y Talento Humano (1/2).
    const filas = within(panel).getAllByRole("listitem");
    expect(filas[0]).toHaveTextContent("2/2Operaciones");
    expect(within(panel).getByText("Gerencia")).toBeInTheDocument();
    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Más crítica: «Talento Humano»",
      }),
    );
    await waitFor(() =>
      expect(servicio.config.crear).toHaveBeenCalledWith("criticidad", {
        ids: [21, 20],
      }),
    );
  });
});
