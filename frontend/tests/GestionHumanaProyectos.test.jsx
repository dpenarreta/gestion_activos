import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EN_PAPELERA,
  LUIS,
  ME_LECTOR,
  detalle,
  documento,
  errorApi,
  proyecto,
  servicioFalso,
} from "./gestionHumanaProyectosDatos";

/*
 * Proyectos de Gestión Humana: el menú por permisos, el listado con sus
 * estados de carga, vacío y error, crear y editar un proyecto, la ficha,
 * subir y ver un documento con el visor interno, y la papelera (restaurar y
 * eliminar para siempre, con confirmación). Los servicios van simulados.
 */

const servicio = servicioFalso();
vi.mock("../src/api/proyectosGhService", async (importOriginal) => ({
  ...(await importOriginal()),
  proyectosGhService: servicio,
}));
vi.mock("../src/api/tareasService", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    tareasService: {
      ...original.tareasService,
      ajustes: vi
        .fn()
        .mockResolvedValue({ retroactive_window_business_days: 2 }),
    },
  };
});
const descargar = vi.fn();
vi.mock("../src/api/soporteService", () => ({
  soporteService: { descargar: (...a) => descargar(...a) },
}));
vi.mock("../src/components/common/VisorPdf/VisorPdf", () => ({
  MarcoPdf: () => <div />,
  useUrlDePdf: () => "blob:doc",
  VisorPdf: ({ titulo }) => <div role="dialog" aria-label={titulo} />,
}));
vi.mock("../src/components/common/VisorPresentacion/VisorPresentacion", () => ({
  esPresentacion: (n = "") => /\.pptx$/i.test(n),
  VisorPresentacion: ({ titulo }) => <div role="dialog" aria-label={titulo} />,
}));
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, permissions: [] } }),
}));

const { MarcoProyectos } =
  await import("../src/pages/GestionHumana/Proyectos/ContextoProyectos");
const { Proyectos } =
  await import("../src/pages/GestionHumana/Proyectos/Proyectos");
const { DetalleProyecto } =
  await import("../src/pages/GestionHumana/Proyectos/DetalleProyecto");
const { getVisibleAdminMenu } =
  await import("../src/components/admin/AdminSidebar/staticAdminMenu");

function pintar(ruta = "/admin/gestion-humana/proyectos") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/admin/gestion-humana" element={<MarcoProyectos />}>
          <Route path="proyectos" element={<Proyectos />} />
          <Route path="proyectos/:proyectoId" element={<DetalleProyecto />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const ficha = "/admin/gestion-humana/proyectos/10";

beforeEach(() => {
  Object.assign(servicio, servicioFalso());
  descargar.mockReset();
  descargar.mockResolvedValue({
    data: new Blob(["%PDF-1.4"], { type: "application/pdf" }),
  });
});

describe("Proyectos en el menú", () => {
  const hojas = (items) =>
    items.flatMap((i) => [...(i.path ? [i] : []), ...hojas(i.children ?? [])]);
  const ids = (permisos) =>
    hojas(getVisibleAdminMenu(permisos, "gestion_humana")).map((i) => i.id);

  it("aparece con `proyectos_gh.acceder`, dentro de Tareas y equipo", () => {
    expect(ids(["proyectos_gh.acceder"])).toContain("gh-proyectos");
    expect(ids(["tareas.acceder"])).not.toContain("gh-proyectos");
    const menu = getVisibleAdminMenu(
      ["tareas.acceder", "proyectos_gh.acceder"],
      "gestion_humana",
    ).filter((i) => i.modulo === "gestion_humana");
    const seccion = menu.find((i) => i.id === "gh-tareas-equipo");
    expect(seccion.children.map((i) => i.id)).toEqual([
      "gh-tareas",
      "gh-proyectos",
    ]);
  });

  it("con solo Proyectos, la entrada va directa y lleva a su ruta", () => {
    const menu = getVisibleAdminMenu(
      ["proyectos_gh.acceder"],
      "gestion_humana",
    ).filter((i) => i.modulo === "gestion_humana");
    expect(menu).toHaveLength(1);
    expect(menu[0]).toMatchObject({
      id: "gh-proyectos",
      path: "/admin/gestion-humana/proyectos",
    });
  });
});

describe("Listado de proyectos", () => {
  it("muestra cada proyecto con su estado, horas y responsable", async () => {
    pintar();
    const enlace = await screen.findByRole("link", {
      name: "Plan de bienestar 2027",
    });
    const tarjeta = enlace.closest("li");
    expect(tarjeta).toHaveTextContent("En ejecución");
    expect(tarjeta).toHaveTextContent("6 h 30 min de 40 h");
    expect(tarjeta).toHaveTextContent("Responsable: Ana Pérez");
    expect(tarjeta).toHaveTextContent("Meta: 15/12/2026");
  });

  it("mientras carga lo dice", async () => {
    servicio.listar.mockReturnValue(new Promise(() => {}));
    pintar();
    await screen.findByRole("button", { name: /Nuevo proyecto/ });
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
  });

  it("sin proyectos invita a crear el primero", async () => {
    servicio.listar.mockResolvedValue([]);
    pintar();
    expect(
      await screen.findByText(/Todavía no hay proyectos/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Crear un proyecto" }),
    ).toBeInTheDocument();
  });

  it("si falla, error con «Reintentar» (nunca un vacío)", async () => {
    servicio.listar.mockRejectedValueOnce(errorApi(500, "Servidor caído."));
    pintar();
    expect(await screen.findByText("Servidor caído.")).toBeInTheDocument();
    expect(screen.queryByText(/Todavía no hay proyectos/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("link", { name: "Plan de bienestar 2027" }),
    ).toBeInTheDocument();
  });

  it("filtra por nombre y ofrece limpiar los filtros", async () => {
    servicio.listar.mockResolvedValue([
      proyecto(),
      proyecto({ id: 12, name: "Kits escolares", tags: [], area: "" }),
    ]);
    pintar();
    await screen.findByRole("link", { name: "Kits escolares" });
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Buscar proyectos" }),
      {
        target: { value: "zzz" },
      },
    );
    expect(screen.getByText("Sin resultados para «zzz».")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(
      screen.getByRole("link", { name: "Kits escolares" }),
    ).toBeInTheDocument();
  });

  it("filtra en cada tecla sin distinguir tildes ni mayúsculas", async () => {
    /* Búsqueda en vivo (06/11/2026): filtro local, inmediato. */
    servicio.listar.mockResolvedValue([
      proyecto({ id: 13, name: "Capacitación anual", tags: [], area: "" }),
      proyecto({ id: 12, name: "Kits escolares", tags: [], area: "" }),
    ]);
    pintar();
    await screen.findByRole("link", { name: "Kits escolares" });
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Buscar proyectos" }),
      { target: { value: "CAPACITACION" } },
    );
    expect(
      screen.getByRole("link", { name: "Capacitación anual" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Kits escolares" }),
    ).not.toBeInTheDocument();
  });

  it("sin `proyectos_gh.crear` no ofrece crear ni la papelera", async () => {
    servicio.yo.mockResolvedValue(ME_LECTOR);
    pintar();
    await screen.findByRole("link", { name: "Plan de bienestar 2027" });
    expect(screen.queryByRole("button", { name: /Nuevo proyecto/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Papelera/ })).toBeNull();
  });
});

describe("Crear y editar un proyecto", () => {
  it("valida lo obligatorio antes de enviar", async () => {
    pintar();
    fireEvent.click(
      await screen.findByRole("button", { name: /Nuevo proyecto/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Nuevo proyecto",
    });
    await within(ventana).findByRole("option", { name: /Ana Pérez \(usted\)/ });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Crear proyecto" }),
    );
    expect(
      await within(ventana).findByText("Escriba el nombre del proyecto."),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText("Elija la fecha de inicio."),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText("Indique el tiempo objetivo."),
    ).toBeInTheDocument();
    expect(servicio.crear).not.toHaveBeenCalled();
  });

  it("crea con sus participantes y abre la ficha del proyecto nuevo", async () => {
    servicio.crear.mockResolvedValue(detalle({ id: 10, name: "Inducción" }));
    pintar();
    fireEvent.click(
      await screen.findByRole("button", { name: /Nuevo proyecto/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Nuevo proyecto",
    });
    await within(ventana).findByRole("checkbox", { name: /Luis Mora/ });
    fireEvent.change(within(ventana).getByLabelText(/^Nombre/), {
      target: { value: "Inducción" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Fecha de inicio/), {
      target: { value: "2026-11-05" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Fecha objetivo/), {
      target: { value: "2026-12-20" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Tiempo objetivo/), {
      target: { value: "40.30" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Etiquetas/), {
      target: { value: "inducción, nuevos" },
    });
    fireEvent.click(
      within(ventana).getByRole("checkbox", { name: /Luis Mora/ }),
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Crear proyecto" }),
    );
    await waitFor(() => expect(servicio.crear).toHaveBeenCalledTimes(1));
    expect(servicio.crear).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Inducción",
        responsible: 1,
        start_date: "2026-11-05T00:00:00Z",
        target_date: "2026-12-20T00:00:00Z",
        target_time_hours: 40.5,
        status: "PENDIENTE",
        priority: "MEDIA",
        tags: ["inducción", "nuevos"],
        participant_ids: [2],
      }),
    );
    expect(
      await screen.findByText("Proyecto «Inducción» creado."),
    ).toBeInTheDocument();
    expect(servicio.obtener).toHaveBeenCalledWith(10);
  });

  it("muestra el error del servidor bajo el campo", async () => {
    servicio.crear.mockRejectedValue(
      errorApi(400, "Faltan campos requeridos", "validation_error", {
        name: ["Faltan campos requeridos"],
      }),
    );
    pintar();
    fireEvent.click(
      await screen.findByRole("button", { name: /Nuevo proyecto/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Nuevo proyecto",
    });
    fireEvent.change(within(ventana).getByLabelText(/^Nombre/), {
      target: { value: "X" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Fecha de inicio/), {
      target: { value: "2026-11-05" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Fecha objetivo/), {
      target: { value: "2026-11-06" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Tiempo objetivo/), {
      target: { value: "2" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Crear proyecto" }),
    );
    expect(
      await within(ventana).findAllByText("Faltan campos requeridos"),
    ).not.toHaveLength(0);
    expect(within(ventana).getByLabelText(/^Nombre/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("al editar envía solo lo que cambió", async () => {
    servicio.actualizar.mockResolvedValue(
      detalle({ name: "Plan de bienestar 2028" }),
    );
    pintar(ficha);
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    const ventana = await screen.findByRole("dialog", {
      name: "Editar proyecto",
    });
    fireEvent.change(within(ventana).getByLabelText(/^Nombre/), {
      target: { value: "Plan de bienestar 2028" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Guardar cambios" }),
    );
    await waitFor(() =>
      expect(servicio.actualizar).toHaveBeenCalledWith(10, {
        name: "Plan de bienestar 2028",
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Plan de bienestar 2028" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Cambios guardados.")).toBeInTheDocument();
  });
});

describe("Ficha del proyecto", () => {
  it("muestra el resumen con sus indicadores y lleva el foco al título", async () => {
    pintar(ficha);
    const titulo = await screen.findByRole("heading", {
      name: "Plan de bienestar 2027",
    });
    await waitFor(() => expect(titulo).toHaveFocus());
    expect(screen.getByText("Avance")).toBeInTheDocument();
    expect(screen.getByText("40 %")).toBeInTheDocument();
    expect(screen.getByText("16 % del objetivo")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Fases/ })).toBeInTheDocument();
  });

  it("si no existe o no tiene acceso (404) lo dice", async () => {
    servicio.obtener.mockRejectedValue(
      errorApi(404, "Proyecto no encontrado.", "not_found"),
    );
    pintar(ficha);
    expect(
      await screen.findByText(/No se encontró el proyecto/),
    ).toBeInTheDocument();
  });

  it("cambia el estado con un botón (no al mover el selector)", async () => {
    servicio.actualizar.mockResolvedValue(detalle({ status: "EN_REVISION" }));
    pintar(ficha);
    const selector = await screen.findByLabelText("Estado");
    fireEvent.change(selector, { target: { value: "EN_REVISION" } });
    expect(servicio.actualizar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cambiar estado" }));
    await waitFor(() =>
      expect(servicio.actualizar).toHaveBeenCalledWith(10, {
        status: "EN_REVISION",
      }),
    );
    // El resultado se anuncia en una región `role="status"`.
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((r) => r.textContent === "Estado cambiado a En revisión."),
      ).toBe(true),
    );
  });

  it("envía a la papelera con confirmación y vuelve al listado", async () => {
    pintar(ficha);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Más acciones de «Plan de bienestar 2027»",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Enviar a la papelera" }),
    );
    const dialogo = await screen.findByRole("dialog", {
      name: "¿Enviar «Plan de bienestar 2027» a la papelera?",
    });
    expect(dialogo).toHaveTextContent(/período de retención/);
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Enviar a la papelera" }),
    );
    await waitFor(() =>
      expect(servicio.enviarAPapelera).toHaveBeenCalledWith(10),
    );
    expect(
      await screen.findByText(
        "«Plan de bienestar 2027» se envió a la papelera.",
      ),
    ).toBeInTheDocument();
  });

  it("agrega y quita participantes (nunca al responsable)", async () => {
    servicio.agregarParticipante.mockResolvedValue({
      id: 102,
      user: { id: 3, first_name: "Sofía", last_name: "Ruiz", roles: [] },
      added_by: { id: 1, first_name: "Ana", last_name: "Pérez" },
      added_at: "2026-11-05T15:00:00Z",
    });
    pintar(`${ficha}?pestana=participantes`);
    const selector = await screen.findByLabelText("Agregar participante");
    await within(selector).findByRole("option", { name: /Sofía Ruiz/ });
    expect(
      screen.queryByRole("button", { name: /Quitar a Ana Pérez/ }),
    ).toBeNull();
    fireEvent.change(selector, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    await waitFor(() =>
      expect(servicio.agregarParticipante).toHaveBeenCalledWith(10, 3),
    );
    expect(
      await screen.findByText("Sofía Ruiz se agregó al proyecto.", {
        selector: "p",
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Quitar a Luis Mora/ }));
    const dialogo = await screen.findByRole("dialog", {
      name: "¿Quitar a Luis Mora del proyecto?",
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Quitar" }));
    await waitFor(() =>
      expect(servicio.quitarParticipante).toHaveBeenCalledWith(10, 101),
    );
  });

  it("registra una actividad con la duración calculada", async () => {
    servicio.registrarActividad.mockResolvedValue({
      id: 300,
      phase_id: null,
      description: "Reunión de diagnóstico con el equipo",
      comments: null,
      start_time: "09:00",
      end_time: "10:30",
      duration: 90,
      is_retroactive: false,
      activity_date: null,
      author: { id: 1, first_name: "Ana", last_name: "Pérez" },
      created_at: "2026-11-05T15:00:00Z",
      documents: [],
    });
    pintar(`${ficha}?pestana=actividades`);
    expect(
      await screen.findByText(/Todavía no hay actividades registradas/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Descripción/), {
      target: { value: "Corta" },
    });
    fireEvent.change(screen.getByLabelText(/^Hora de inicio/), {
      target: { value: "09:00" },
    });
    fireEvent.change(screen.getByLabelText(/^Hora de fin/), {
      target: { value: "10:30" },
    });
    expect(screen.getByText("1 h 30 min")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Registrar actividad" }),
    );
    expect(
      await screen.findByText(/al menos 15 caracteres \(faltan 10\)/),
    ).toBeInTheDocument();
    expect(servicio.registrarActividad).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Descripción/), {
      target: { value: "Reunión de diagnóstico con el equipo" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Registrar actividad" }),
    );
    await waitFor(() =>
      expect(servicio.registrarActividad).toHaveBeenCalledWith(
        10,
        expect.objectContaining({
          description: "Reunión de diagnóstico con el equipo",
          start_time: "09:00",
          end_time: "10:30",
          phase: null,
        }),
      ),
    );
    expect(
      await screen.findByText("Reunión de diagnóstico con el equipo"),
    ).toBeInTheDocument();
  });
});

describe("Foco tras «⋯» y confirmar", () => {
  it("al cancelar «Enviar a la papelera», el foco vuelve al botón «⋯»", async () => {
    pintar(ficha);
    const menu = await screen.findByRole("button", {
      name: "Más acciones de «Plan de bienestar 2027»",
    });
    fireEvent.click(menu);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Enviar a la papelera" }),
    );
    const dialogo = await screen.findByRole("dialog", {
      name: "¿Enviar «Plan de bienestar 2027» a la papelera?",
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(menu).toHaveFocus());
    expect(servicio.enviarAPapelera).not.toHaveBeenCalled();
  });
});

describe("Documentos", () => {
  it("abre el PDF en el visor interno, sin descargarlo", async () => {
    pintar(`${ficha}?pestana=documentos`);
    fireEvent.click(
      await screen.findByRole("button", { name: /Ver «acta-inicio.pdf»/ }),
    );
    expect(
      await screen.findByRole("dialog", { name: "acta-inicio.pdf" }),
    ).toBeInTheDocument();
    expect(descargar).toHaveBeenCalledWith("/projects/10/documents/70/file/");
  });

  it("Word y Excel se descargan", async () => {
    servicio.documentos.mockResolvedValue([
      documento({
        id: 71,
        file_name: "presupuesto.xlsx",
        category: "EXCEL",
        viewable: false,
        viewer: null,
      }),
    ]);
    pintar(`${ficha}?pestana=documentos`);
    expect(
      await screen.findByRole("button", {
        name: /Descargar «presupuesto.xlsx»/,
      }),
    ).toBeInTheDocument();
  });

  it("sube un documento como archivo y lo agrega a la lista", async () => {
    servicio.subirDocumento.mockResolvedValue(
      documento({ id: 72, file_name: "plan.pdf", version: 1 }),
    );
    pintar(`${ficha}?pestana=documentos`);
    await screen.findByRole("button", { name: /Ver «acta-inicio.pdf»/ });
    const entrada = screen.getByLabelText(/^Archivo/);
    expect(entrada).toHaveAttribute("accept", expect.stringContaining(".pptx"));
    const archivo = new File(["%PDF"], "plan.pdf", { type: "application/pdf" });
    fireEvent.change(entrada, { target: { files: [archivo] } });
    fireEvent.change(screen.getByLabelText("Categoría"), {
      target: { value: "ACTA" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Subir documento/ }));
    await waitFor(() =>
      expect(servicio.subirDocumento).toHaveBeenCalledWith(10, archivo, {
        categoria: "ACTA",
      }),
    );
    expect(
      await screen.findByRole("button", { name: /Ver «plan.pdf»/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("«plan.pdf» se subió.", { selector: "p" }),
    ).toBeInTheDocument();
  });

  it("la presentación .pptx se abre en el visor de diapositivas", async () => {
    servicio.documentos.mockResolvedValue([
      documento({
        id: 73,
        file_name: "inicio.pptx",
        category: "OTRO",
        file_url: "/projects/10/documents/73/file/",
        viewer: "presentacion",
      }),
    ]);
    pintar(`${ficha}?pestana=documentos`);
    fireEvent.click(
      await screen.findByRole("button", { name: /Ver «inicio.pptx»/ }),
    );
    expect(
      await screen.findByRole("dialog", { name: "inicio.pptx" }),
    ).toBeInTheDocument();
    expect(descargar).toHaveBeenCalledWith("/projects/10/documents/73/file/");
  });

  it("si el servidor no admite el tipo, muestra su motivo", async () => {
    servicio.subirDocumento.mockRejectedValue(
      errorApi(
        400,
        "Tipo de archivo no permitido. Use PDF, Word, Excel o PowerPoint.",
        "validation_error",
        {
          file: [
            "Tipo de archivo no permitido. Use PDF, Word, Excel o PowerPoint.",
          ],
        },
      ),
    );
    pintar(`${ficha}?pestana=documentos`);
    await screen.findByRole("button", { name: /Ver «acta-inicio.pdf»/ });
    fireEvent.change(screen.getByLabelText(/^Archivo/), {
      target: { files: [new File(["x"], "foto.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Subir documento/ }));
    expect(
      await screen.findByText(
        "Tipo de archivo no permitido. Use PDF, Word, Excel o PowerPoint.",
      ),
    ).toBeInTheDocument();
  });

  it("si la lista no carga, error con reintento", async () => {
    servicio.documentos.mockRejectedValueOnce(
      errorApi(500, "Sin conexión al archivo."),
    );
    pintar(`${ficha}?pestana=documentos`);
    expect(
      await screen.findByText("Sin conexión al archivo."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("button", { name: /Ver «acta-inicio.pdf»/ }),
    ).toBeInTheDocument();
  });
});

describe("Papelera", () => {
  async function abrirPapelera() {
    pintar();
    fireEvent.click(await screen.findByRole("button", { name: /Papelera/ }));
    return screen.findByRole("dialog", { name: /Papelera/ });
  }

  it("lista lo eliminado con el plazo que queda", async () => {
    const panel = await abrirPapelera();
    expect(
      await within(panel).findByText("Proyecto viejo"),
    ).toBeInTheDocument();
    // El plazo según la retención del servidor (7 días) y lo que queda.
    expect(
      within(panel).getByText("Se conserva 7 días · Vence en 3 d 4 h"),
    ).toBeInTheDocument();
  });

  it("vacía lo dice; si falla, error con reintento", async () => {
    servicio.papelera.mockRejectedValueOnce(errorApi(500, "No se pudo leer."));
    const panel = await abrirPapelera();
    expect(
      await within(panel).findByText("No se pudo leer."),
    ).toBeInTheDocument();
    servicio.papelera.mockResolvedValue([]);
    fireEvent.click(within(panel).getByRole("button", { name: "Reintentar" }));
    expect(
      await within(panel).findByText("La papelera está vacía."),
    ).toBeInTheDocument();
  });

  it("restaura con confirmación y recarga el listado", async () => {
    const panel = await abrirPapelera();
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Restaurar" }),
    );
    const dialogo = await screen.findByRole("dialog", {
      name: "¿Restaurar «Proyecto viejo»?",
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Restaurar" }));
    await waitFor(() => expect(servicio.restaurar).toHaveBeenCalledWith(11));
    expect(
      await within(panel).findByText("«Proyecto viejo» se restauró."),
    ).toBeInTheDocument();
    expect(within(panel).queryByText("Proyecto viejo")).toBeNull();
    expect(servicio.listar).toHaveBeenCalledTimes(2);
  });

  it("eliminar para siempre: la opción segura tiene el foco y dice la consecuencia", async () => {
    const panel = await abrirPapelera();
    fireEvent.click(
      await within(panel).findByRole("button", {
        name: "Eliminar para siempre",
      }),
    );
    const dialogo = await screen.findByRole("dialog", {
      name: "¿Eliminar «Proyecto viejo» para siempre?",
    });
    expect(dialogo).toHaveTextContent("No se puede deshacer.");
    expect(
      within(dialogo).getByRole("button", { name: "Cancelar" }),
    ).toHaveFocus();
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Eliminar para siempre" }),
    );
    await waitFor(() =>
      expect(servicio.eliminarParaSiempre).toHaveBeenCalledWith(11),
    );
    expect(servicio.restaurar).not.toHaveBeenCalled();
  });

  it("quien administra puede actuar sobre lo que no creó (`can_delete`)", async () => {
    servicio.papelera.mockResolvedValue([
      {
        ...EN_PAPELERA,
        created_by: { id: 9, name: "Otra persona" },
        can_delete: true,
      },
    ]);
    const panel = await abrirPapelera();
    expect(
      await within(panel).findByRole("button", { name: "Restaurar" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Eliminar para siempre" }),
    ).toBeInTheDocument();
  });

  it("sin `can_delete` explica quién puede actuar", async () => {
    servicio.papelera.mockResolvedValue([
      { ...EN_PAPELERA, can_delete: false },
    ]);
    const panel = await abrirPapelera();
    expect(
      await within(panel).findByText(/Solo Ana Pérez \(creador\)/),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: "Restaurar" }),
    ).toBeNull();
  });
});

describe("Fases", () => {
  it("lista las fases y guarda el progreso con un botón", async () => {
    servicio.actualizarFase.mockResolvedValue({
      ...detalle().phases[0],
      progress: 60,
    });
    pintar(`${ficha}?pestana=fases`);
    const tarjeta = (
      await screen.findByRole("heading", { name: "Diagnóstico" })
    ).closest("li");
    expect(tarjeta).toHaveTextContent("Responsable: Luis Mora");
    expect(tarjeta).toHaveTextContent("Registrado: 2 h 30 min");
    const rango = within(tarjeta).getByLabelText(/Progreso/);
    fireEvent.change(rango, { target: { value: "60" } });
    fireEvent.click(
      within(tarjeta).getByRole("button", { name: "Guardar progreso" }),
    );
    await waitFor(() =>
      expect(servicio.actualizarFase).toHaveBeenCalledWith(10, 50, {
        progress: 60,
      }),
    );
  });

  it("sin fases y sin gestionar, solo lo dice", async () => {
    servicio.obtener.mockResolvedValue(
      detalle({ phases: [], can_manage: false, can_delete: false }),
    );
    pintar(`${ficha}?pestana=fases`);
    expect(
      await screen.findByText("Este proyecto todavía no tiene fases."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agregar fase/ })).toBeNull();
    expect(LUIS.id).toBe(2);
  });
});
