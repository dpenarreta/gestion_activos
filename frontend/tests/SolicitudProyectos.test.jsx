import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Solicitud de proyectos: descargar la plantilla, llenarla y volver a
 * cargarla con los campos del formulario; quien decide cada paso ve lo
 * cargado y aprueba, rechaza o escala; y configurar los tipos (plantilla,
 * campos obligatorios u opcionales y pasos).
 */

const permisos = { lista: [] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { permissions: permisos.lista } }),
}));

const servicio = {
  tipos: vi.fn(),
  plantilla: vi.fn(),
  solicitudes: vi.fn(),
  solicitud: vi.fn(),
  resumen: vi.fn(),
  solicitar: vi.fn(),
  aprobar: vi.fn(),
  rechazar: vi.fn(),
  cancelar: vi.fn(),
  escalar: vi.fn(),
  archivo: vi.fn(),
  opciones: vi.fn(),
  tiposConfigurados: vi.fn(),
  guardarTipo: vi.fn(),
  activarTipo: vi.fn(),
  eliminarTipo: vi.fn(),
  cargarPlantilla: vi.fn(),
  plantillaConfigurada: vi.fn(),
};
const guardarArchivo = vi.fn();
vi.mock("../src/api/proyectosService", () => ({
  proyectosService: servicio,
  guardarArchivo: (...args) => guardarArchivo(...args),
}));

const { SolicitudProyectosPage } =
  await import("../src/pages/Institucional/SolicitudProyectosPage");
const { TiposProyectoPage } =
  await import("../src/pages/Institucional/TiposProyectoPage");

const TIPO = {
  id: 1,
  nombre: "Proyecto de TI",
  descripcion: "Descargue la plantilla y llénela.",
  plantilla_nombre: "Plantilla de proyecto.docx",
  campos: [
    {
      clave: "c1",
      etiqueta: "Objetivo",
      tipo: "parrafo",
      opciones: [],
      obligatorio: true,
      ayuda: "Qué se quiere lograr.",
    },
    {
      clave: "c2",
      etiqueta: "Presupuesto",
      tipo: "numero",
      opciones: [],
      obligatorio: false,
      ayuda: "",
    },
  ],
  pasos: [
    { nombre: "Aprobación", aprobadores: ["Su jefe inmediato (organigrama)"] },
    { nombre: "Autorización", aprobadores: ["Cargo Gerente General"] },
    { nombre: "Revisión", aprobadores: ["Tatiana Torres"] },
  ],
};

const SOLICITUD = {
  id: 9,
  numero: "PRY-2026-0009",
  tipo_proyecto: "Proyecto de TI",
  titulo: "Nuevo CRM",
  solicitante: { id: 3, nombre: "Ana Vera" },
  estado: "pendiente",
  estado_display: "En aprobación",
  paso_actual: "Autorización",
  pendiente_de: [{ id: 5, nombre: "Gerardo Ruiz" }],
  created_at: "2026-10-26T15:00:00Z",
  cerrada_en: null,
};

const DETALLE = {
  ...SOLICITUD,
  respuestas: [
    { etiqueta: "Objetivo", tipo: "parrafo", valor: "Ordenar la cartera" },
    { etiqueta: "Presupuesto", tipo: "numero", valor: "1500" },
  ],
  archivo_nombre: "CRM llena.docx",
  archivo_tamano: 20480,
  pasos: [
    { nombre: "Aprobación", estado: "aprobado" },
    { nombre: "Autorización", estado: "en_curso" },
    { nombre: "Revisión", estado: "pendiente" },
  ],
  acciones: [
    {
      id: 1,
      accion: "creada",
      accion_display: "Solicitó",
      actor: "Ana Vera",
      paso: "",
      comentario: "",
      detalle: "",
      created_at: "2026-10-26T15:00:00Z",
    },
  ],
  puedo: { resolver: true, escalar: true, cancelar: false },
};

function pagina(ruta = "/admin/institucional/proyectos") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <SolicitudProyectosPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = [];
  servicio.solicitudes.mockResolvedValue([SOLICITUD]);
  servicio.resumen.mockResolvedValue({ por_atender: 1 });
  servicio.tipos.mockResolvedValue([TIPO]);
  servicio.solicitud.mockResolvedValue(DETALLE);
  servicio.plantilla.mockResolvedValue(new Blob(["x"]));
  servicio.archivo.mockResolvedValue(new Blob(["y"]));
});

describe("Solicitud de proyectos", () => {
  it("lista las solicitudes y marca cuántas tiene por atender", async () => {
    pagina();
    expect(await screen.findByText("Nuevo CRM")).toBeInTheDocument();
    expect(screen.getByText("PRY-2026-0009")).toBeInTheDocument();
    // La cuenta va dentro de la pestaña y se lee «1 por atender».
    expect(
      screen.getByRole("tab", { name: /Por atender\s*1\s*por atender/ }),
    ).toBeInTheDocument();
    // Sin permiso no se ven «Todas» ni la configuración.
    expect(screen.queryByRole("tab", { name: "Todas" })).toBeNull();
    expect(screen.queryByText("Tipos de proyecto")).toBeNull();
  });

  it("pide descargar la plantilla, cargarla llena y los campos del tipo", async () => {
    servicio.solicitar.mockResolvedValue({
      ...DETALLE,
      paso_actual: "Aprobación",
      pendiente_de: [{ id: 4, nombre: "Julia Paz" }],
    });
    pagina();
    fireEvent.click(
      await screen.findByRole("button", { name: /Nueva solicitud/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Nueva solicitud de proyecto",
    });
    // Los pasos por los que pasa, a la vista.
    expect(within(ventana).getByText("Autorización")).toBeInTheDocument();

    fireEvent.click(
      within(ventana).getByRole("button", {
        name: /Descargar Plantilla de proyecto.docx/,
      }),
    );
    await waitFor(() =>
      expect(guardarArchivo).toHaveBeenCalledWith(
        expect.any(Blob),
        "Plantilla de proyecto.docx",
      ),
    );

    fireEvent.change(within(ventana).getByLabelText(/Nombre del proyecto/), {
      target: { value: "Nuevo CRM" },
    });
    fireEvent.change(within(ventana).getByLabelText(/Objetivo/), {
      target: { value: "Ordenar la cartera" },
    });
    expect(within(ventana).getByText("(opcional)")).toBeInTheDocument();

    // Sin la plantilla llena no se envía: el aviso va en su campo.
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviar solicitud" }),
    );
    const campoArchivo = within(ventana).getByLabelText(
      /Cargue la plantilla llena/,
    );
    await waitFor(() =>
      expect(campoArchivo).toHaveAttribute("aria-invalid", "true"),
    );
    expect(campoArchivo).toHaveAccessibleDescription(
      /Cargue la plantilla llena: descárguela, complétela y súbala aquí/,
    );
    expect(servicio.solicitar).not.toHaveBeenCalled();

    const llena = new File(["contenido"], "CRM llena.docx");
    fireEvent.change(
      within(ventana).getByLabelText(/Cargue la plantilla llena/),
      {
        target: { files: [llena] },
      },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviar solicitud" }),
    );
    await waitFor(() =>
      expect(servicio.solicitar).toHaveBeenCalledWith(
        {
          tipo_proyecto: 1,
          titulo: "Nuevo CRM",
          respuestas: { c1: "Ordenar la cartera" },
        },
        llena,
      ),
    );
    expect(
      await screen.findByText(/queda pendiente de Julia Paz \(«Aprobación»\)/),
    ).toBeInTheDocument();
  });

  it("muestra los errores de cada campo que devuelve el servidor", async () => {
    servicio.solicitar.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            message: "Revise los datos.",
            details: { respuestas: { c1: ["Este campo es obligatorio."] } },
          },
        },
      },
    });
    pagina();
    fireEvent.click(
      await screen.findByRole("button", { name: /Nueva solicitud/ }),
    );
    const ventana = await screen.findByRole("dialog");
    await within(ventana).findByText("Autorización");
    fireEvent.change(within(ventana).getByLabelText(/Nombre del proyecto/), {
      target: { value: "CRM" },
    });
    fireEvent.change(
      within(ventana).getByLabelText(/Cargue la plantilla llena/),
      {
        target: { files: [new File(["x"], "a.docx")] },
      },
    );
    fireEvent.submit(
      within(ventana).getByRole("button", { name: "Enviar solicitud" }),
    );
    expect(
      await within(ventana).findByText("Este campo es obligatorio."),
    ).toBeInTheDocument();
  });

  it("quien decide ve lo cargado, descarga la plantilla llena y aprueba su paso", async () => {
    servicio.aprobar.mockResolvedValue({
      ...DETALLE,
      paso_actual: "Revisión",
      puedo: { resolver: false, escalar: false, cancelar: false },
    });
    pagina("/admin/institucional/proyectos?solicitud=9");
    const ventana = await screen.findByRole("dialog", {
      name: "Solicitud PRY-2026-0009",
    });
    expect(
      await within(ventana).findByText("Ordenar la cartera"),
    ).toBeInTheDocument();
    expect(within(ventana).getByText("1500")).toBeInTheDocument();
    expect(within(ventana).getByText("Aprobación")).toBeInTheDocument();
    expect(within(ventana).getByText(": en curso")).toBeInTheDocument();

    fireEvent.click(
      within(ventana).getByRole("button", { name: /CRM llena.docx/ }),
    );
    await waitFor(() =>
      expect(guardarArchivo).toHaveBeenCalledWith(
        expect.any(Blob),
        "CRM llena.docx",
      ),
    );

    fireEvent.click(
      within(ventana).getByRole("button", { name: /Aprobar «Autorización»/ }),
    );
    await waitFor(() => expect(servicio.aprobar).toHaveBeenCalledWith("9", ""));
  });
});

describe("Tipos de proyecto", () => {
  const CONFIGURADO = {
    id: 1,
    nombre: "Proyecto de TI",
    descripcion: "",
    activo: false,
    tiene_plantilla: false,
    plantilla_nombre: "",
    solicitudes: 0,
    campos: [
      {
        id: 11,
        clave: "c11",
        etiqueta: "Objetivo",
        tipo: "parrafo",
        opciones: [],
        obligatorio: true,
        ayuda: "",
      },
    ],
    pasos: [
      {
        id: 21,
        nombre: "Aprobación",
        aprobadores: [
          {
            tipo: "jefe_inmediato",
            usuario: null,
            rol: null,
            cargo: null,
            descripcion: "Su jefe inmediato (organigrama)",
          },
        ],
      },
    ],
  };

  function configuracion() {
    return render(
      <MemoryRouter>
        <TiposProyectoPage />
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    servicio.tiposConfigurados.mockResolvedValue([CONFIGURADO]);
    servicio.opciones.mockResolvedValue({
      personas: [],
      roles: [],
      cargos: [],
    });
  });

  it("sin plantilla avisa y no deja activarlo", async () => {
    configuracion();
    expect(
      await screen.findByRole("button", { name: /Cargar plantilla/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activar" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Editar Proyecto de TI" }),
    );
    const editor = await screen.findByRole("dialog");
    expect(within(editor).getByLabelText(/Activo/)).toBeDisabled();
  });

  it("agrega un campo de lista opcional, carga la plantilla y lo activa", async () => {
    servicio.guardarTipo.mockResolvedValue({ ...CONFIGURADO, id: 1 });
    servicio.cargarPlantilla.mockResolvedValue({});
    servicio.activarTipo.mockResolvedValue({});
    configuracion();
    fireEvent.click(
      await screen.findByRole("button", { name: "Editar Proyecto de TI" }),
    );
    const editor = await screen.findByRole("dialog");

    fireEvent.click(
      within(editor).getByRole("button", { name: /Agregar campo/ }),
    );
    fireEvent.change(within(editor).getByLabelText("Nombre del campo 2"), {
      target: { value: "Prioridad" },
    });
    fireEvent.change(within(editor).getByLabelText("Tipo del campo 2"), {
      target: { value: "lista" },
    });
    fireEvent.change(within(editor).getByLabelText(/^Opciones del campo 2/), {
      target: { value: "Alta\nMedia\n\nBaja" },
    });

    const plantilla = new File(["p"], "Plantilla.docx");
    fireEvent.change(within(editor).getByLabelText(/^Cargar la plantilla/), {
      target: { files: [plantilla] },
    });
    fireEvent.click(within(editor).getByLabelText(/Activo/));
    fireEvent.click(
      within(editor).getByRole("button", { name: "Guardar cambios" }),
    );

    await waitFor(() => expect(servicio.guardarTipo).toHaveBeenCalled());
    const [id, datos] = servicio.guardarTipo.mock.calls[0];
    expect(id).toBe(1);
    expect(datos.activo).toBe(false);
    expect(datos.campos).toEqual([
      {
        id: 11,
        etiqueta: "Objetivo",
        tipo: "parrafo",
        opciones: [],
        obligatorio: true,
        ayuda: "",
      },
      {
        id: null,
        etiqueta: "Prioridad",
        tipo: "lista",
        opciones: ["Alta", "Media", "Baja"],
        obligatorio: false,
        ayuda: "",
      },
    ]);
    expect(datos.pasos[0]).toMatchObject({ id: 21, nombre: "Aprobación" });
    await waitFor(() =>
      expect(servicio.cargarPlantilla).toHaveBeenCalledWith(1, plantilla),
    );
    await waitFor(() =>
      expect(servicio.activarTipo).toHaveBeenCalledWith(1, true),
    );
  });

  it("un tipo nuevo no se envía con pasos sin elegir y dice qué falta", async () => {
    configuracion();
    fireEvent.click(
      await screen.findByRole("button", { name: /Nuevo tipo de proyecto/ }),
    );
    const editor = await screen.findByRole("dialog", {
      name: "Nuevo tipo de proyecto",
    });
    fireEvent.change(
      within(editor).getByLabelText(/^Nombre del tipo de proyecto/),
      { target: { value: "Desarrollo de un reporte" } },
    );
    fireEvent.click(
      within(editor).getByRole("button", { name: "Crear tipo de proyecto" }),
    );
    expect(servicio.guardarTipo).not.toHaveBeenCalled();
    const alerta = within(editor).getByRole("alert");
    expect(alerta).toHaveTextContent(
      "Paso 2, quien decide 1: elija una persona.",
    );
    expect(alerta).not.toHaveTextContent("aprobadores");
    expect(
      within(editor).getByLabelText(
        "quien decide el paso 2, opción 1: una persona",
      ),
    ).toHaveAttribute("aria-invalid", "true");
  });

  it("avisa si un paso lo decide quien ya decidió uno anterior", async () => {
    servicio.tiposConfigurados.mockResolvedValue([
      {
        ...CONFIGURADO,
        pasos: [
          CONFIGURADO.pasos[0],
          { ...CONFIGURADO.pasos[0], id: 22, nombre: "Autorización" },
        ],
      },
    ]);
    configuracion();
    fireEvent.click(
      await screen.findByRole("button", { name: "Editar Proyecto de TI" }),
    );
    const editor = await screen.findByRole("dialog");
    expect(within(editor).getByText(/Así queda la ruta/)).toBeInTheDocument();
    expect(editor).toHaveTextContent(
      /El paso 2 lo decide quien ya decidió uno anterior/,
    );
  });

  it("si la plantilla falla, el tipo ya creado no se duplica al reintentar", async () => {
    servicio.guardarTipo.mockResolvedValue({ ...CONFIGURADO, id: 7 });
    servicio.cargarPlantilla.mockRejectedValueOnce({
      response: { data: { detail: "El archivo está dañado." } },
    });
    configuracion();
    fireEvent.click(
      await screen.findByRole("button", { name: /Nuevo tipo de proyecto/ }),
    );
    const editor = await screen.findByRole("dialog");
    fireEvent.change(
      within(editor).getByLabelText(/^Nombre del tipo de proyecto/),
      { target: { value: "Desarrollo de un reporte" } },
    );
    // Los pasos 2 y 3 nacen sin elegir: se quitan para este caso.
    fireEvent.click(
      within(editor).getByRole("button", { name: "Quitar el paso 3" }),
    );
    fireEvent.click(
      within(editor).getByRole("button", { name: "Quitar el paso 2" }),
    );
    fireEvent.change(within(editor).getByLabelText(/^Cargar la plantilla/), {
      target: { files: [new File(["p"], "Plantilla.docx")] },
    });
    fireEvent.click(
      within(editor).getByRole("button", { name: "Crear tipo de proyecto" }),
    );
    expect(
      await within(editor).findByText(
        /El tipo se creó, pero la plantilla no se cargó/,
      ),
    ).toBeInTheDocument();
    expect(servicio.guardarTipo).toHaveBeenLastCalledWith(
      undefined,
      expect.anything(),
    );
    // El reintento edita el tipo creado (PUT con su id), no crea otro.
    servicio.cargarPlantilla.mockResolvedValueOnce({});
    fireEvent.click(
      within(editor).getByRole("button", { name: "Guardar cambios" }),
    );
    await waitFor(() =>
      expect(servicio.guardarTipo).toHaveBeenLastCalledWith(
        7,
        expect.anything(),
      ),
    );
  });
});
