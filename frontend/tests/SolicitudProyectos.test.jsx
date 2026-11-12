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
// Las pantallas piden el servicio de su categoría (US-008): se anota cuál.
const servicioDe = vi.fn(() => servicio);
vi.mock("../src/api/proyectosService", () => ({
  proyectosService: servicio,
  servicioDe: (...args) => servicioDe(...args),
  guardarArchivo: (...args) => guardarArchivo(...args),
}));

const { EVENTO_INSIGNIAS } = await import("../src/utils/insigniasDelMenu");
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

  it("sin categoría usa el servicio de proyectos", async () => {
    pagina();
    await screen.findByText("Nuevo CRM");
    expect(servicioDe).toHaveBeenCalled();
    expect(servicioDe.mock.calls.every(([c]) => c === "proyecto")).toBe(true);
    expect(
      screen.getByRole("heading", { name: "Solicitud de proyectos" }),
    ).toBeInTheDocument();
  });

  it("con los permisos de procesos no ofrece Todas ni los tipos de proyecto", async () => {
    // Los permisos de una categoría no sirven para la otra (US-008, CA-4).
    permisos.lista = ["procesos.configurar", "procesos.ver_todas"];
    pagina();
    await screen.findByText("Nuevo CRM");
    expect(screen.queryByRole("link", { name: /Tipos de/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Todas" })).toBeNull();
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

describe("Ausencias en los proyectos (11/11/2026, US-001)", () => {
  it("la lista y el detalle dicen que el aprobador está fuera de la oficina", async () => {
    const ausente = {
      id: 5,
      nombre: "Gerardo Ruiz",
      ausencia: {
        clave: "fuera_oficina",
        texto: "Fuera de la oficina hasta el 18/11",
        hasta: "2026-11-18",
        reemplazo: { id: 9, nombre: "Tatiana Torres" },
      },
    };
    servicio.solicitudes.mockResolvedValue([
      { ...SOLICITUD, pendiente_de: [ausente] },
    ]);
    servicio.solicitud.mockResolvedValue({
      ...DETALLE,
      pendiente_de: [ausente],
      acciones: [
        ...DETALLE.acciones,
        {
          id: 2,
          accion: "escalada",
          accion_display: "Escaló",
          actor: "",
          paso: "Autorización",
          comentario: "Escalada a Tatiana Torres por ausencia de Gerardo Ruiz",
          detalle: "Tatiana Torres",
          created_at: "2026-10-26T15:05:00Z",
        },
      ],
    });
    pagina("/admin/institucional/proyectos?solicitud=9");
    const tabla = await screen.findByRole("table");
    expect(
      (await within(tabla).findByText("Gerardo Ruiz")).closest("td"),
    ).toHaveTextContent(
      "Autorización · Gerardo Ruiz (ausente: Fuera de la oficina hasta el 18/11 · Aprueba en su lugar: Tatiana Torres)",
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Solicitud PRY-2026-0009",
    });
    expect(
      await within(ventana).findByText(/pendiente\s+de:/),
    ).toHaveTextContent(
      "pendiente de: Gerardo Ruiz (ausente: Fuera de la oficina hasta el 18/11 · Aprueba en su lugar: Tatiana Torres)",
    );
    const linea = within(ventana)
      .getByText(/porque/)
      .closest("li");
    expect(linea).toHaveTextContent(
      "Pasó a Tatiana Torres porque Gerardo Ruiz está ausente (paso «Autorización»)",
    );
    expect(linea).not.toHaveTextContent("Escalada a");
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

/*
 * Solicitud de procesos (US-008, 12/11/2026): las mismas pantallas con
 * `categoria="proceso"`, sus textos y sus permisos `procesos.*`.
 */
describe("Solicitud de procesos", () => {
  function procesos(ruta = "/admin/institucional/procesos") {
    return render(
      <MemoryRouter initialEntries={[ruta]}>
        <SolicitudProyectosPage categoria="proceso" />
      </MemoryRouter>,
    );
  }

  // Pedir procesos exige `procesos.solicitar`, de todo cargo.
  beforeEach(() => {
    permisos.lista = ["procesos.solicitar"];
  });

  it("pide el servicio de procesos y habla de procesos", async () => {
    servicio.solicitudes.mockResolvedValue([
      {
        ...SOLICITUD,
        numero: "PRC-2026-0001",
        titulo: "Alta de proveedor",
        tipo_proyecto: "Alta",
      },
    ]);
    procesos();
    expect(await screen.findByText("Alta de proveedor")).toBeInTheDocument();
    expect(servicioDe).toHaveBeenCalled();
    expect(servicioDe.mock.calls.every(([c]) => c === "proceso")).toBe(true);
    expect(
      screen.getByRole("heading", { name: "Solicitud de procesos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Pida un proceso con su plantilla/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Proceso" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: "Solicitudes de proceso" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/proyecto/i)).toBeNull();
  });

  it("con procesos.* ofrece Todas y los tipos de proceso; con proyectos.*, no", async () => {
    permisos.lista = ["proyectos.configurar", "proyectos.ver_todas"];
    const { unmount } = procesos();
    await screen.findByText("Nuevo CRM");
    expect(screen.queryByRole("link", { name: /Tipos de/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Todas" })).toBeNull();
    unmount();

    permisos.lista = ["procesos.configurar", "procesos.ver_todas"];
    procesos();
    expect(
      await screen.findByRole("link", { name: /Tipos de proceso/ }),
    ).toHaveAttribute("href", "/admin/institucional/procesos/tipos");
    expect(screen.getByRole("tab", { name: "Todas" })).toBeInTheDocument();
  });

  it("la nueva solicitud dice proceso, también al faltar el nombre", async () => {
    servicio.tipos.mockResolvedValue([
      { ...TIPO, nombre: "Alta de proveedor", plantilla_nombre: "Alta.docx" },
    ]);
    procesos();
    fireEvent.click(
      await screen.findByRole("button", { name: /Nueva solicitud/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Nueva solicitud de proceso",
    });
    expect(
      await within(ventana).findByLabelText(/Tipo de proceso/),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByLabelText(/Nombre del proceso/),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText("Complete los datos del proceso"),
    ).toBeInTheDocument();
    fireEvent.change(
      within(ventana).getByLabelText(/Cargue la plantilla llena/),
      { target: { files: [new File(["x"], "a.docx")] } },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviar solicitud" }),
    );
    expect(
      await within(ventana).findByText("Escriba el nombre del proceso."),
    ).toBeInTheDocument();
    expect(servicio.solicitar).not.toHaveBeenCalled();
  });

  it("la ventana sin tipos tiene Cerrar y, si falla la carga, Reintentar", async () => {
    // La pantalla sí encontró tipos; la ventana, al abrirse, falla y luego
    // ya no queda ninguno (se desactivaron entre medio).
    servicio.tipos
      .mockResolvedValueOnce([TIPO])
      .mockRejectedValueOnce(new Error("red"))
      .mockResolvedValueOnce([]);
    procesos();
    fireEvent.click(
      await screen.findByRole("button", { name: /Nueva solicitud/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Nueva solicitud de proceso",
    });
    expect(
      await within(ventana).findByText(
        "No se pudieron cargar los tipos de proceso.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Reintentar" }),
    );
    expect(
      await within(ventana).findByText(
        "Todavía no hay tipos de proceso para solicitar.",
      ),
    ).toBeInTheDocument();
    expect(servicio.tipos).toHaveBeenCalledTimes(3);
    // El del cuerpo, con texto (la X de la cabecera también se llama «Cerrar»).
    fireEvent.click(
      within(ventana).getByText("Cerrar", { selector: "button" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  describe("sin tipos activos (el primer día)", () => {
    beforeEach(() => {
      servicio.tipos.mockResolvedValue([]);
      servicio.solicitudes.mockResolvedValue([]);
      servicio.resumen.mockResolvedValue({ por_atender: 0 });
    });

    it("a quien configura lo invita a crear el primer tipo", async () => {
      permisos.lista = ["procesos.configurar"];
      procesos();
      expect(
        await screen.findByText(
          "Todavía no hay tipos de proceso. Cree el primero para que se puedan pedir.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /Configurar tipos de proceso/ }),
      ).toHaveAttribute("href", "/admin/institucional/procesos/tipos");
      // Reemplaza la tabla vacía y las pestañas, y no ofrece pedir.
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.queryByRole("table")).toBeNull();
      expect(
        screen.queryByRole("button", { name: /Nueva solicitud/ }),
      ).toBeNull();
    });

    it("a quien no configura le dice que aún no hay procesos para pedir", async () => {
      procesos();
      expect(
        await screen.findByText(
          "Todavía no hay procesos para pedir. Cuando el área responsable los publique, aparecerán aquí.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /Configurar tipos/ }),
      ).toBeNull();
      expect(screen.queryByRole("table")).toBeNull();
      expect(
        screen.queryByRole("button", { name: /Nueva solicitud/ }),
      ).toBeNull();
    });

    it("en proyectos, los mismos textos dicen proyecto", async () => {
      permisos.lista = ["proyectos.configurar"];
      pagina();
      expect(
        await screen.findByText(
          "Todavía no hay tipos de proyecto. Cree el primero para que se puedan pedir.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /Configurar tipos de proyecto/ }),
      ).toHaveAttribute("href", "/admin/institucional/proyectos/tipos");
    });

    it("con solicitudes propias o por atender, la tabla y las pestañas siguen", async () => {
      servicio.solicitudes.mockResolvedValue([SOLICITUD]);
      servicio.resumen.mockResolvedValue({ por_atender: 1 });
      procesos();
      expect(await screen.findByText("Nuevo CRM")).toBeInTheDocument();
      expect(screen.getByRole("tablist")).toBeInTheDocument();
      // El aviso va encima, y sin tipos sigue sin ofrecerse pedir.
      expect(
        await screen.findByText(/Todavía no hay procesos para pedir/),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Nueva solicitud/ }),
      ).toBeNull();
    });

    it("con algo por atender, aunque las propias estén vacías, la tabla sigue", async () => {
      servicio.resumen.mockResolvedValue({ por_atender: 2 });
      procesos();
      await screen.findByText(/Todavía no hay procesos para pedir/);
      await waitFor(() =>
        expect(
          screen.getByRole("tab", { name: /Por atender\s*2/ }),
        ).toBeInTheDocument(),
      );
    });

    it("quien ve todas conserva las pestañas para llegar a «Todas»", async () => {
      permisos.lista = ["procesos.ver_todas", "procesos.solicitar"];
      procesos();
      await screen.findByText(/Todavía no hay procesos para pedir/);
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Todas" })).toBeInTheDocument(),
      );
    });
  });

  it("abre ?solicitud= con el servicio de procesos y aprueba con él", async () => {
    servicio.solicitud.mockResolvedValue({
      ...DETALLE,
      numero: "PRC-2026-0009",
    });
    servicio.aprobar.mockResolvedValue({
      ...DETALLE,
      numero: "PRC-2026-0009",
      puedo: { resolver: false, escalar: false, cancelar: false },
    });
    const insignias = vi.fn();
    window.addEventListener(EVENTO_INSIGNIAS, insignias);
    procesos("/admin/institucional/procesos?solicitud=9");
    const ventana = await screen.findByRole("dialog", {
      name: "Solicitud PRC-2026-0009",
    });
    expect(servicio.solicitud).toHaveBeenCalledWith("9");
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Aprobar «Autorización»/ }),
    );
    await waitFor(() => expect(servicio.aprobar).toHaveBeenCalledWith("9", ""));
    // Todo lo pidió el servicio de procesos.
    expect(servicioDe.mock.calls.every(([c]) => c === "proceso")).toBe(true);
    // Y el menú se entera enseguida de que cambió lo pendiente.
    await waitFor(() => expect(insignias).toHaveBeenCalled());
    window.removeEventListener(EVENTO_INSIGNIAS, insignias);
  });

  it("crear una solicitud también avisa al menú", async () => {
    servicio.solicitar.mockResolvedValue({
      ...DETALLE,
      numero: "PRC-2026-0010",
      paso_actual: "Aprobación",
      pendiente_de: [{ id: 4, nombre: "Julia Paz" }],
    });
    const insignias = vi.fn();
    window.addEventListener(EVENTO_INSIGNIAS, insignias);
    procesos();
    fireEvent.click(
      await screen.findByRole("button", { name: /Nueva solicitud/ }),
    );
    const ventana = await screen.findByRole("dialog");
    fireEvent.change(
      await within(ventana).findByLabelText(/Nombre del proceso/),
      { target: { value: "Alta" } },
    );
    fireEvent.change(within(ventana).getByLabelText(/Objetivo/), {
      target: { value: "Ordenar" },
    });
    fireEvent.change(
      within(ventana).getByLabelText(/Cargue la plantilla llena/),
      { target: { files: [new File(["x"], "a.docx")] } },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviar solicitud" }),
    );
    expect(
      await screen.findByText(/Solicitud PRC-2026-0010 enviada/),
    ).toBeInTheDocument();
    expect(insignias).toHaveBeenCalled();
    window.removeEventListener(EVENTO_INSIGNIAS, insignias);
  });

  it("una solicitud de proyecto abierta en procesos dice dónde buscarla", async () => {
    servicio.solicitud.mockRejectedValue({
      response: { status: 404, data: { error: { message: "No encontrado." } } },
    });
    procesos("/admin/institucional/procesos?solicitud=9");
    const ventana = await screen.findByRole("dialog");
    expect(
      await within(ventana).findByText(
        /No se encontró la solicitud aquí\. Puede que sea de Solicitud de proyectos\./,
      ),
    ).toBeInTheDocument();
    // Sin el número: quien sigue el enlace no lo ve.
    expect(within(ventana).queryByText(/PRY|PRC/)).toBeNull();
    // El enlace lleva la marca de dónde viene, para no rebotar.
    expect(
      within(ventana).getByRole("link", {
        name: "Abrir en Solicitud de proyectos",
      }),
    ).toHaveAttribute(
      "href",
      "/admin/institucional/proyectos?solicitud=9&desde=proceso",
    );
  });

  it("y una de proceso abierta en proyectos, al revés", async () => {
    servicio.solicitud.mockRejectedValue({ response: { status: 404 } });
    pagina("/admin/institucional/proyectos?solicitud=9");
    const ventana = await screen.findByRole("dialog");
    expect(
      await within(ventana).findByText(
        /Puede que sea de Solicitud de procesos/,
      ),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByRole("link", {
        name: "Abrir en Solicitud de procesos",
      }),
    ).toHaveAttribute(
      "href",
      "/admin/institucional/procesos?solicitud=9&desde=proyecto",
    );
  });

  it("si al llegar desde la otra pantalla tampoco está, no ofrece volver", async () => {
    servicio.solicitud.mockRejectedValue({ response: { status: 404 } });
    procesos("/admin/institucional/procesos?solicitud=9&desde=proyecto");
    const ventana = await screen.findByRole("dialog");
    expect(
      await within(ventana).findByText(
        "No se encontró la solicitud o no tiene acceso a ella.",
      ),
    ).toBeInTheDocument();
    expect(within(ventana).queryByRole("link")).toBeNull();
    expect(within(ventana).queryByText(/Puede que sea/)).toBeNull();
  });

  it("«Nueva solicitud» no aparece mientras cargan los tipos, y sí tras un error", async () => {
    let resolver;
    servicio.tipos.mockReturnValueOnce(
      new Promise((r) => {
        resolver = r;
      }),
    );
    procesos();
    await screen.findByText("Nuevo CRM");
    // Cargando: ni el botón ni el aviso de que no hay tipos.
    expect(
      screen.queryByRole("button", { name: /Nueva solicitud/ }),
    ).toBeNull();
    resolver([TIPO]);
    expect(
      await screen.findByRole("button", { name: /Nueva solicitud/ }),
    ).toBeInTheDocument();
  });

  it("tras un error al cargar los tipos, «Nueva solicitud» sigue disponible", async () => {
    servicio.tipos.mockRejectedValueOnce(new Error("red"));
    procesos();
    expect(
      await screen.findByRole("button", { name: /Nueva solicitud/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Todavía no hay/)).toBeNull();
  });

  it("sin procesos.solicitar no ofrece pedir procesos", async () => {
    permisos.lista = ["procesos.ver_todas"];
    procesos();
    await screen.findByText("Nuevo CRM");
    await waitFor(() => expect(servicio.tipos).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(
      screen.queryByRole("button", { name: /Nueva solicitud/ }),
    ).toBeNull();
  });

  it("sin tipos y sin poder pedir ni configurar, el vacío no invita a pedir", async () => {
    permisos.lista = [];
    servicio.tipos.mockResolvedValue([]);
    servicio.solicitudes.mockResolvedValue([]);
    servicio.resumen.mockResolvedValue({ por_atender: 0 });
    procesos();
    expect(
      await screen.findByText("Todavía no hay tipos de proceso."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/para pedir/)).toBeNull();
  });

  it("sin tipos pero con la tabla a la vista, un solo vacío: el aviso es compacto", async () => {
    permisos.lista = [
      "procesos.solicitar",
      "procesos.ver_todas",
      "procesos.configurar",
    ];
    servicio.tipos.mockResolvedValue([]);
    servicio.solicitudes.mockResolvedValue([]);
    servicio.resumen.mockResolvedValue({ por_atender: 0 });
    procesos();
    const aviso = await screen.findByRole("note");
    expect(aviso).toHaveClass("mz-alert", "mz-alert--info");
    expect(aviso).toHaveTextContent(
      "Todavía no hay tipos de proceso. Cree el primero para que se puedan pedir.",
    );
    // El enlace a configurar se mantiene en el aviso.
    expect(
      within(aviso).getByRole("link", { name: /Configurar tipos de proceso/ }),
    ).toHaveAttribute("href", "/admin/institucional/procesos/tipos");
    // Y la tabla dice su propio vacío: no hay un segundo bloque grande.
    expect(await screen.findByText("No hay solicitudes.")).toBeInTheDocument();
    expect(document.querySelectorAll(".mz-empty")).toHaveLength(1);
  });

  it("si fallan los tipos, el error habla de procesos", async () => {
    servicio.tipos.mockRejectedValue(new Error("red"));
    procesos();
    fireEvent.click(
      await screen.findByRole("button", { name: /Nueva solicitud/ }),
    );
    expect(
      await screen.findByText("No se pudieron cargar los tipos de proceso."),
    ).toBeInTheDocument();
  });

  it("Tipos de proceso: textos, enlace de vuelta y tipo nuevo de proceso", async () => {
    servicio.tiposConfigurados.mockResolvedValue([]);
    servicio.opciones.mockResolvedValue({
      personas: [],
      roles: [],
      cargos: [],
    });
    render(
      <MemoryRouter>
        <TiposProyectoPage categoria="proceso" />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText(
        "Todavía no hay tipos de proceso. Cree el primero con «Nuevo tipo de proceso»: su plantilla, su formulario y quién lo aprueba.",
      ),
    ).toBeInTheDocument();
    expect(servicioDe.mock.calls.every(([c]) => c === "proceso")).toBe(true);
    expect(
      screen.getByRole("heading", { name: "Tipos de proceso" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Volver a Solicitud de procesos" }),
    ).toHaveAttribute("href", "/admin/institucional/procesos");

    // El botón principal se repite en el estado vacío: los dos abren el editor.
    const botones = screen.getAllByRole("button", {
      name: /Nuevo tipo de proceso/,
    });
    expect(botones).toHaveLength(2);
    fireEvent.click(botones[1]);
    const editor = await screen.findByRole("dialog", {
      name: "Nuevo tipo de proceso",
    });
    expect(
      within(editor).getByLabelText(/Nombre del tipo de proceso/),
    ).toBeInTheDocument();
    expect(
      within(editor).getByDisplayValue("Objetivo del proceso"),
    ).toBeInTheDocument();
    expect(within(editor).queryByText(/proyecto/i)).toBeNull();

    // Sin nombre, el aviso habla del tipo de proceso.
    fireEvent.click(
      within(editor).getByRole("button", { name: "Crear tipo de proceso" }),
    );
    expect(
      await within(editor).findByText("Nombre del tipo de proceso: escríbalo."),
    ).toBeInTheDocument();
    expect(servicio.guardarTipo).not.toHaveBeenCalled();
  });
});
