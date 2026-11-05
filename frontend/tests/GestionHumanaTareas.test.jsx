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
  LIDER,
  ME,
  TAREAS,
  YO,
  errorApi,
  servicioFalso,
  tarea,
} from "./gestionHumanaTareasDatos";

/*
 * Tareas (Gestión Humana): las cuatro vistas, los estados de carga, vacío y
 * error, crear y editar, mover sin arrastrar, eliminar con confirmación y el
 * registro de horas (normal y retroactivo). El servicio va simulado.
 */

const servicio = servicioFalso();
vi.mock("../src/api/tareasService", async (importOriginal) => ({
  ...(await importOriginal()),
  tareasService: servicio,
}));
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, permissions: [] } }),
}));

const { ProveedorTareas } =
  await import("../src/pages/GestionHumana/Tareas/ContextoTareas");
const { Tareas } = await import("../src/pages/GestionHumana/Tareas/Tareas");

function pintar(ruta = "/admin/gestion-humana/tareas") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <ProveedorTareas>
        <Routes>
          <Route path="/admin/gestion-humana/tareas" element={<Tareas />} />
          <Route
            path="/admin/gestion-humana/tareas/:tareaId"
            element={<Tareas />}
          />
        </Routes>
      </ProveedorTareas>
    </MemoryRouter>,
  );
}

/** Abre «Más acciones» de una tarea y elige una opción. */
async function accion(titulo, opcion) {
  const [boton] = await screen.findAllByRole("button", {
    name: `Más acciones de «${titulo}»`,
  });
  fireEvent.click(boton);
  fireEvent.click(await screen.findByRole("menuitem", { name: opcion }));
}

beforeEach(() => {
  Object.assign(servicio, servicioFalso());
  localStorage.clear();
});

describe("Estados de la pantalla", () => {
  it("mientras se sabe quién es la persona, «Cargando…»", () => {
    servicio.yo.mockReturnValue(new Promise(() => {}));
    pintar();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
  });

  it("sin acceso al módulo lo dice con el mensaje del servidor", async () => {
    servicio.yo.mockRejectedValue(
      errorApi(403, "No tiene permiso para Tareas.", "permission_denied"),
    );
    pintar();
    expect(
      await screen.findByText("No tiene permiso para Tareas."),
    ).toBeInTheDocument();
    expect(servicio.listar).not.toHaveBeenCalled();
  });

  it("si la lista no carga, error con «Reintentar» (no una lista vacía)", async () => {
    servicio.listar.mockRejectedValueOnce(errorApi(500, "Falla del servidor."));
    pintar();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Falla del servidor.",
    );
    expect(screen.queryByText("Todavía no tiene tareas activas.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Informe mensual")).toBeInTheDocument();
    expect(servicio.listar).toHaveBeenCalledTimes(2);
  });

  it("sin tareas, la Tabla lo dice y ofrece crear una", async () => {
    servicio.listar.mockResolvedValue([]);
    pintar("/admin/gestion-humana/tareas?vista=tabla");
    expect(
      await screen.findByText("Todavía no tiene tareas activas."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Crear una tarea" }));
    expect(
      await screen.findByRole("dialog", { name: "Nueva tarea" }),
    ).toBeInTheDocument();
  });

  it("una búsqueda sin resultados ofrece limpiar el filtro", async () => {
    pintar();
    await screen.findByText("Informe mensual");
    fireEvent.change(screen.getByLabelText("Buscar"), {
      target: { value: "zzz" },
    });
    expect(
      screen.getByText("Ningún resultado con estos filtros."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(screen.getByText("Informe mensual")).toBeInTheDocument();
  });
});

describe("Las vistas", () => {
  it("Kanban: tres columnas por estado; «Completada» empieza contraída", async () => {
    pintar();
    expect(
      await screen.findByRole("heading", { name: "Informe mensual" }),
    ).toBeInTheDocument();
    const pendiente = screen.getByRole("button", { name: /Pendiente\s*1/ });
    expect(pendiente).toHaveAttribute("aria-expanded", "true");
    const completada = screen.getByRole("button", { name: /Completada\s*0/ });
    expect(completada).toHaveAttribute("aria-expanded", "false");
    // Las fechas se leen en UTC: la medianoche del 15/11 llega como 14/11 19:00.
    expect(screen.getAllByText(/Vence 15\/11\/2026/)).toHaveLength(2);
    // Los comentarios nuevos se dicen con texto, no solo con un punto.
    expect(
      screen.getByRole("button", {
        name: "Comentarios de «Seguimiento de vacantes»: 2, hay nuevos",
      }),
    ).toBeInTheDocument();
  });

  it("Tabla: una sección por estado con la tarea como encabezado de fila", async () => {
    pintar("/admin/gestion-humana/tareas?vista=tabla");
    const tabla = await screen.findByRole("table", {
      name: "Tareas en estado Pendiente",
    });
    expect(
      within(tabla).getByRole("rowheader", { name: /Informe mensual/ }),
    ).toBeInTheDocument();
    expect(within(tabla).getByText("6 h 30 min")).toBeInTheDocument();
  });

  it("Gantt: una barra por tarea que dice sus fechas y su estado", async () => {
    pintar("/admin/gestion-humana/tareas?vista=gantt");
    expect(
      await screen.findByRole("table", { name: /Cronograma de las tareas/ }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Del 01/11/2026 al 15/11/2026 · En progreso · 40 % de avance",
      ),
    ).toHaveLength(1);
  });

  it("Repositorio: los meses cerrados y, al elegir uno, sus tareas", async () => {
    servicio.repositorio.mockResolvedValue([
      {
        year: 2026,
        month: 10,
        total_tasks: 4,
        completed_tasks: 3,
        total_hours: 12.5,
      },
    ]);
    servicio.repositorioDelMes.mockResolvedValue([
      tarea({
        id: 90,
        title: "Archivada",
        status: "COMPLETADA",
        corrected: true,
      }),
    ]);
    pintar("/admin/gestion-humana/tareas?vista=repositorio");
    fireEvent.click(
      await screen.findByRole("button", { name: /Octubre 2026/ }),
    );
    expect(servicio.repositorioDelMes).toHaveBeenCalledWith(2026, 10);
    expect(await screen.findByText("Archivada")).toBeInTheDocument();
    expect(screen.getByText("Corregida")).toBeInTheDocument();
  });

  it("Repositorio vacío lo dice", async () => {
    pintar("/admin/gestion-humana/tareas?vista=repositorio");
    expect(
      await screen.findByText(
        "Todavía no hay meses cerrados en el repositorio.",
      ),
    ).toBeInTheDocument();
  });

  it("cambiar de pestaña cambia de vista", async () => {
    pintar();
    await screen.findByRole("heading", { name: "Informe mensual" });
    fireEvent.click(screen.getByRole("tab", { name: /Tabla/ }));
    expect(
      await screen.findByRole("table", { name: "Tareas en estado Pendiente" }),
    ).toBeInTheDocument();
  });
});

describe("Crear y editar", () => {
  it("crea una tarea con la fecha a medianoche UTC y el tiempo en HH.MM", async () => {
    servicio.crear.mockResolvedValue(tarea({ id: 200, title: "Nueva" }));
    pintar();
    await screen.findByRole("heading", { name: "Informe mensual" });
    fireEvent.click(screen.getByRole("button", { name: /Nueva tarea$/ }));
    const dialogo = await screen.findByRole("dialog", { name: "Nueva tarea" });
    await waitFor(() =>
      expect(within(dialogo).getByLabelText(/Asignada a/)).toBeEnabled(),
    );
    fireEvent.change(within(dialogo).getByLabelText(/Título/), {
      target: { value: "Plan de capacitación" },
    });
    fireEvent.change(within(dialogo).getByLabelText(/Fecha de inicio/), {
      target: { value: "2026-11-03" },
    });
    fireEvent.change(within(dialogo).getByLabelText(/Fecha de fin/), {
      target: { value: "2026-11-20" },
    });
    fireEvent.change(within(dialogo).getByLabelText(/Tiempo objetivo/), {
      target: { value: "6.30" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Crear tarea" }),
    );
    await waitFor(() => expect(servicio.crear).toHaveBeenCalledTimes(1));
    expect(servicio.crear).toHaveBeenCalledWith({
      title: "Plan de capacitación",
      description: "",
      type: "FIJA",
      priority: "MEDIA",
      frequency: "MENSUAL",
      start_date: "2026-11-03T00:00:00Z",
      end_date: "2026-11-20T00:00:00Z",
      estimated_hours: 6.5,
      assigned_to: YO,
      status: "PENDIENTE",
    });
    expect(await screen.findByText("Tarea creada.")).toBeInTheDocument();
    expect(servicio.listar).toHaveBeenCalledTimes(2);
  });

  it("sin los obligatorios no envía y marca cada campo", async () => {
    pintar();
    await screen.findByRole("heading", { name: "Informe mensual" });
    fireEvent.click(screen.getByRole("button", { name: /Nueva tarea$/ }));
    const dialogo = await screen.findByRole("dialog", { name: "Nueva tarea" });
    fireEvent.change(within(dialogo).getByLabelText(/Tiempo objetivo/), {
      target: { value: "6.75" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Crear tarea" }),
    );
    expect(
      await within(dialogo).findByText("Escriba el título de la tarea."),
    ).toBeInTheDocument();
    expect(within(dialogo).getByLabelText(/Tiempo objetivo/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(servicio.crear).not.toHaveBeenCalled();
  });

  it("el error del servidor queda bajo el campo", async () => {
    servicio.crear.mockRejectedValue(
      errorApi(
        400,
        "No puede asignar tareas a esta persona.",
        "assignee_out_of_scope",
        {
          assigned_to: ["No puede asignar tareas a esta persona."],
        },
      ),
    );
    pintar();
    await screen.findByRole("heading", { name: "Informe mensual" });
    fireEvent.click(screen.getByRole("button", { name: /Nueva tarea$/ }));
    const dialogo = await screen.findByRole("dialog", { name: "Nueva tarea" });
    fireEvent.change(within(dialogo).getByLabelText(/Título/), {
      target: { value: "X" },
    });
    fireEvent.change(within(dialogo).getByLabelText(/Fecha de inicio/), {
      target: { value: "2026-11-03" },
    });
    fireEvent.change(within(dialogo).getByLabelText(/Fecha de fin/), {
      target: { value: "2026-11-04" },
    });
    fireEvent.change(within(dialogo).getByLabelText(/Tiempo objetivo/), {
      target: { value: "2" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Crear tarea" }),
    );
    await waitFor(() =>
      expect(within(dialogo).getByLabelText(/Asignada a/)).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
  });

  it("al editar envía solo lo que cambió", async () => {
    servicio.actualizar.mockResolvedValue(
      tarea({ title: "Informe mensual de nómina" }),
    );
    pintar();
    await accion("Informe mensual", "Editar");
    const dialogo = await screen.findByRole("dialog", { name: "Editar tarea" });
    expect(within(dialogo).getByLabelText(/Fecha de inicio/)).toHaveValue(
      "2026-11-01",
    );
    expect(within(dialogo).getByLabelText(/Tiempo objetivo/)).toHaveValue(
      "6.30",
    );
    fireEvent.change(within(dialogo).getByLabelText(/Título/), {
      target: { value: "Informe mensual de nómina" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Guardar cambios" }),
    );
    await waitFor(() =>
      expect(servicio.actualizar).toHaveBeenCalledWith(101, {
        title: "Informe mensual de nómina",
      }),
    );
    expect(await screen.findByText("Tarea actualizada.")).toBeInTheDocument();
  });
});

describe("Mover una tarea sin arrastrar", () => {
  it("«Más acciones › Mover a…» cambia el estado y lo anuncia", async () => {
    servicio.actualizar.mockResolvedValue(tarea({ status: "EN_PROGRESO" }));
    pintar();
    await accion("Informe mensual", "Mover a En progreso");
    await waitFor(() =>
      expect(servicio.actualizar).toHaveBeenCalledWith(101, {
        status: "EN_PROGRESO",
      }),
    );
    expect(
      await screen.findByText("«Informe mensual» pasó a En progreso."),
    ).toBeInTheDocument();
  });

  it("el botón de estado de la tarjeta abre «Mover a…» y no mueve hasta elegir", async () => {
    servicio.actualizar.mockResolvedValue(tarea({ status: "COMPLETADA" }));
    pintar();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Estado de «Informe mensual»: Pendiente. Cambiar estado",
      }),
    );
    expect(servicio.actualizar).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Mover a Completada" }),
    );
    await waitFor(() =>
      expect(servicio.actualizar).toHaveBeenCalledWith(101, {
        status: "COMPLETADA",
      }),
    );
    // El foco sigue a la tarea, en su nueva columna (que se despliega).
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Informe mensual" }),
      ).toHaveFocus(),
    );
    expect(
      screen.getByRole("button", { name: /Completada\s*1/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("si el servidor lo rechaza, vuelve a su columna y lo explica", async () => {
    servicio.actualizar.mockRejectedValue(
      errorApi(
        400,
        "Solo el responsable de la tarea puede editar ese campo.",
        "self_only_field",
      ),
    );
    pintar();
    await accion("Informe mensual", "Mover a Completada");
    expect(
      await screen.findByText(
        "Solo el responsable de la tarea puede editar ese campo.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Estado de «Informe mensual»: Pendiente. Cambiar estado",
      }),
    ).toBeInTheDocument();
  });
});

describe("Eliminar", () => {
  it("pide confirmación, con la consecuencia, antes de eliminar", async () => {
    pintar();
    await accion("Informe mensual", "Eliminar");
    const dialogo = await screen.findByRole("dialog", {
      name: "¿Eliminar la tarea «Informe mensual»?",
    });
    expect(dialogo).toHaveTextContent("No se puede deshacer.");
    expect(servicio.eliminar).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Eliminar tarea" }),
    );
    await waitFor(() => expect(servicio.eliminar).toHaveBeenCalledWith(101));
    expect(
      await screen.findByText("Tarea «Informe mensual» eliminada."),
    ).toBeInTheDocument();
  });
});

describe("Registro de horas", () => {
  it("registra una actividad con un motivo de su rol", async () => {
    servicio.registrarActividad.mockResolvedValue({
      id: 5,
      task: 101,
      author: { id: YO, first_name: "Ana", last_name: "Pérez" },
      reason: "REUNION",
      start_time: null,
      end_time: null,
      duration: 90,
      description: "",
      is_retroactive: false,
      activity_date: null,
      admin_comment: null,
      modified_by_admin: false,
      modified_at: null,
      comment_count: 0,
      created_at: "2026-11-04T10:00:00-05:00",
    });
    pintar();
    await accion("Informe mensual", "Registrar horas");
    const panel = await screen.findByRole("dialog", {
      name: "Informe mensual",
    });
    expect(
      await within(panel).findByText("Todavía no hay actividades registradas."),
    ).toBeInTheDocument();
    const motivo = within(panel).getByLabelText(/Motivo/);
    await waitFor(() =>
      expect(
        within(motivo).getByRole("option", { name: "Reunión" }),
      ).toBeInTheDocument(),
    );
    // Un motivo de otro rol no se ofrece.
    expect(
      within(motivo).queryByRole("option", { name: "Solo jefes" }),
    ).toBeNull();
    fireEvent.change(motivo, { target: { value: "REUNION" } });
    fireEvent.change(within(panel).getByLabelText("Horas"), {
      target: { value: "1" },
    });
    fireEvent.change(within(panel).getByLabelText("Minutos"), {
      target: { value: "30" },
    });
    expect(within(panel).getByText("1 h 30 min")).toBeInTheDocument();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Registrar actividad" }),
    );
    await waitFor(() =>
      expect(servicio.registrarActividad).toHaveBeenCalledWith(101, {
        reason: "REUNION",
        hours: 1,
        minutes: 30,
        description: "",
        start_time: null,
        end_time: null,
      }),
    );
    expect(
      await within(panel).findByText("Reunión", { selector: ".mz-pill" }),
    ).toBeInTheDocument();
  });

  it("sin motivos para su rol no muestra el formulario y dice a quién pedirlos", async () => {
    servicio.motivos.mockResolvedValue([
      {
        id: 2,
        key: "SOLO_JEFES",
        label: "Solo jefes",
        is_active: true,
        is_archived: false,
        assigned_roles: ["JEFE_NACIONAL"],
      },
    ]);
    pintar();
    await accion("Informe mensual", "Registrar horas");
    const panel = await screen.findByRole("dialog", {
      name: "Informe mensual",
    });
    expect(
      await within(panel).findByText(
        /No tiene motivos asignados para registrar horas/,
      ),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: "Registrar actividad" }),
    ).toBeNull();
    // A quien no administra no se le ofrece ir a Ajustes.
    expect(
      within(panel).queryByRole("link", { name: /Ajustes de tareas/ }),
    ).toBeNull();
  });

  it("sin motivo ni duración no envía", async () => {
    pintar();
    await accion("Informe mensual", "Registrar horas");
    const panel = await screen.findByRole("dialog", {
      name: "Informe mensual",
    });
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Registrar actividad" }),
    );
    expect(
      await within(panel).findByText("Elija el motivo."),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText("La duración debe ser mayor a 0."),
    ).toBeInTheDocument();
    expect(servicio.registrarActividad).not.toHaveBeenCalled();
  });

  it("una tarea fija con 2 registros ya no admite más", async () => {
    const actividad = (id) => ({
      id,
      author: { id: YO, first_name: "Ana", last_name: "Pérez" },
      reason: "REUNION",
      duration: 60,
      description: "",
      is_retroactive: false,
      modified_by_admin: false,
      comment_count: 0,
      created_at: "2026-11-04T10:00:00-05:00",
    });
    servicio.actividades.mockResolvedValue([actividad(1), actividad(2)]);
    pintar();
    await accion("Informe mensual", "Registrar horas");
    const panel = await screen.findByRole("dialog", {
      name: "Informe mensual",
    });
    expect(
      await within(panel).findByText(/ya alcanzó el máximo de 2/),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: "Registrar actividad" }),
    ).toBeNull();
    expect(within(panel).getByText("2 h")).toBeInTheDocument();
  });

  it("si el panel no carga las actividades, error con reintento", async () => {
    servicio.actividades.mockRejectedValueOnce(errorApi(500, "Sin servicio."));
    pintar();
    await accion("Informe mensual", "Registrar horas");
    const panel = await screen.findByRole("dialog", {
      name: "Informe mensual",
    });
    expect(await within(panel).findByText("Sin servicio.")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Reintentar" }));
    expect(
      await within(panel).findByText("Todavía no hay actividades registradas."),
    ).toBeInTheDocument();
  });

  it("registro retroactivo: solo en Seguimiento, con fecha válida y descripción", async () => {
    servicio.registrarRetroactiva.mockResolvedValue({ id: 9 });
    pintar();
    // Una tarea Fija no ofrece el registro retroactivo.
    const [fija] = await screen.findAllByRole("button", {
      name: "Más acciones de «Informe mensual»",
    });
    fireEvent.click(fija);
    expect(
      screen.queryByRole("menuitem", { name: "Registro retroactivo" }),
    ).toBeNull();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    await accion("Seguimiento de vacantes", "Registro retroactivo");
    const dialogo = await screen.findByRole("dialog", {
      name: "Registro retroactivo de horas",
    });
    const fecha = within(dialogo).getByLabelText(/Fecha de la actividad/);
    const dia = fecha.value;
    expect(dia).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const motivo = within(dialogo).getByLabelText(/Motivo/);
    await waitFor(() =>
      expect(
        within(motivo).getByRole("option", { name: "Reunión" }),
      ).toBeInTheDocument(),
    );
    fireEvent.change(motivo, { target: { value: "REUNION" } });
    fireEvent.change(within(dialogo).getByLabelText("Horas"), {
      target: { value: "2" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", {
        name: "Registrar horas retroactivas",
      }),
    );
    expect(
      await within(dialogo).findByText(
        "La descripción es obligatoria en un registro retroactivo.",
      ),
    ).toBeInTheDocument();
    expect(servicio.registrarRetroactiva).not.toHaveBeenCalled();
    fireEvent.change(within(dialogo).getByLabelText(/Descripción/), {
      target: { value: "Entrevistas del viernes" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", {
        name: "Registrar horas retroactivas",
      }),
    );
    await waitFor(() =>
      expect(servicio.registrarRetroactiva).toHaveBeenCalledWith(102, {
        reason: "REUNION",
        hours: 2,
        minutes: 0,
        description: "Entrevistas del viernes",
        start_time: null,
        end_time: null,
        activity_date: dia,
      }),
    );
    expect(
      await screen.findByText(/Horas retroactivas del .* registradas/),
    ).toBeInTheDocument();
  });

  it("con horario, avisa del cruce con otra actividad del día", async () => {
    localStorage.setItem("gestion_humana:formato_actividad", "horario");
    servicio.agendaDelDia.mockResolvedValue([
      {
        id: 3,
        startTime: "09:00",
        endTime: "10:00",
        taskId: 7,
        taskTitle: "Otra tarea",
      },
    ]);
    pintar();
    await accion("Seguimiento de vacantes", "Registrar horas");
    const panel = await screen.findByRole("dialog", {
      name: "Seguimiento de vacantes",
    });
    await waitFor(() => expect(servicio.agendaDelDia).toHaveBeenCalled());
    fireEvent.change(within(panel).getByLabelText(/Hora de inicio(?! y)/), {
      target: { value: "09:30" },
    });
    fireEvent.change(within(panel).getByLabelText(/Hora de fin/), {
      target: { value: "10:30" },
    });
    expect(
      await within(panel).findByText(
        /se cruza con una actividad registrada de 09:00 a 10:00/,
      ),
    ).toBeInTheDocument();
  });
});

describe("Menú y atajos", () => {
  it("en «⋯», Eliminar va separado y «Mover a…» después de las demás", async () => {
    pintar();
    fireEvent.click(
      (
        await screen.findAllByRole("button", {
          name: "Más acciones de «Informe mensual»",
        })
      )[0],
    );
    const menu = await screen.findByRole("menu");
    const textos = within(menu)
      .getAllByRole("menuitem")
      .map((b) => b.textContent);
    expect(textos[0]).toBe("Registrar horas");
    expect(textos.at(-1)).toBe("Eliminar");
    expect(textos.indexOf("Mover a En progreso")).toBeGreaterThan(
      textos.indexOf("Editar"),
    );
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
  });

  it("en Seguimiento, el panel ofrece el registro retroactivo", async () => {
    pintar();
    await accion("Seguimiento de vacantes", "Registrar horas");
    const panel = await screen.findByRole("dialog", {
      name: "Seguimiento de vacantes",
    });
    fireEvent.click(
      within(panel).getByRole("button", {
        name: "¿Olvidó registrar un día anterior?",
      }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Registro retroactivo de horas",
      }),
    ).toBeInTheDocument();
  });
});

describe("Enlace de un aviso", () => {
  it("`/tareas/<id>` abre los comentarios de esa tarea", async () => {
    servicio.obtener.mockResolvedValue(TAREAS[1]);
    servicio.comentarios.mockResolvedValue([
      {
        id: 1,
        task: 102,
        author: { id: 2, first_name: "Luis", last_name: "Mora", roles: [] },
        text: "<b>Revisar</b> pronto",
        created_at: "2026-11-03T10:00:00-05:00",
      },
    ]);
    pintar("/admin/gestion-humana/tareas/102");
    const panel = await screen.findByRole("dialog", {
      name: "Seguimiento de vacantes",
    });
    expect(servicio.obtener).toHaveBeenCalledWith("102");
    // El texto se pinta como texto: nada de HTML interpretado.
    expect(
      await within(panel).findByText("<b>Revisar</b> pronto"),
    ).toBeInTheDocument();
  });
});

describe("Cierre pendiente", () => {
  it("a quien cierra el mes le avisa de los meses terminados sin cerrar", async () => {
    servicio.yo.mockResolvedValue(LIDER);
    pintar();
    expect(
      await screen.findByText("Octubre 2026 quedó sin cerrar."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Cerrar Octubre 2026" }),
    ).toHaveAttribute(
      "href",
      "/admin/gestion-humana/cierre-de-mes?year=2026&month=10",
    );
  });

  it("a quien no cierra el mes no le pregunta", async () => {
    servicio.yo.mockResolvedValue(ME);
    pintar();
    await screen.findByRole("heading", { name: "Informe mensual" });
    expect(servicio.vistaPreviaDelCierre).not.toHaveBeenCalled();
  });
});
