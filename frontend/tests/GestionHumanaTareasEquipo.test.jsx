import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FECHA_FIN,
  LIDER,
  ME,
  OBJETIVO,
  OTRA,
  VISTA_CIERRE,
  YO_PERSONA,
  errorApi,
  servicioFalso,
  tarea,
} from "./gestionHumanaTareasDatos";

/*
 * Equipo, Tiempo objetivo y validaciones, Cierre de mes y Ajustes de tareas:
 * el render, los estados de carga, vacío y error, la validación del Tiempo
 * Objetivo y de la Fecha Fin, las acciones en bloque y el cierre con
 * confirmación. El servicio va simulado.
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
const { Equipo } = await import("../src/pages/GestionHumana/Tareas/Equipo");
const { TiempoObjetivo } =
  await import("../src/pages/GestionHumana/Tareas/TiempoObjetivo");
const { CierreDeMes } =
  await import("../src/pages/GestionHumana/Tareas/CierreDeMes");
const { AjustesTareas } =
  await import("../src/pages/GestionHumana/Tareas/AjustesTareas");

function pintar(Pantalla, ruta = "/") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <ProveedorTareas>
        <Pantalla />
      </ProveedorTareas>
    </MemoryRouter>,
  );
}

async function accion(titulo, opcion) {
  fireEvent.click(
    await screen.findByRole("button", { name: `Más acciones de «${titulo}»` }),
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: opcion }));
}

const ajena = tarea({ id: 300, title: "Clima laboral", assigned_to: OTRA });
const propia = tarea({ id: 301, title: "Mi tarea", assigned_to: YO_PERSONA });

beforeEach(() => {
  Object.assign(servicio, servicioFalso());
  servicio.yo.mockResolvedValue(LIDER);
  localStorage.clear();
});

describe("Equipo", () => {
  it("lista a su equipo con la inactividad dicha en texto", async () => {
    pintar(Equipo);
    const tarjeta = await screen.findByRole("button", { name: /Luis Mora/ });
    expect(tarjeta).toHaveTextContent("Analista Clima y Cultura");
    expect(tarjeta).toHaveTextContent("Última actividad: Nunca ingresó");
    expect(tarjeta).toHaveTextContent("3 tareas · 33 % completado");
  });

  it("al elegir una persona muestra sus tareas por estado", async () => {
    servicio.tareasDe.mockResolvedValue([
      {
        ...ajena,
        assigned_to: {
          id: 2,
          name: "Luis Mora",
          email: "l@x",
          role: "ANALISTA_CC",
        },
      },
    ]);
    pintar(Equipo);
    fireEvent.click(await screen.findByRole("button", { name: /Luis Mora/ }));
    expect(servicio.tareasDe).toHaveBeenCalledWith(2);
    const tabla = await screen.findByRole("table", {
      name: "Tareas en estado Pendiente",
    });
    expect(within(tabla).getByText("Clima laboral")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Volver a Equipo/ }));
    expect(
      await screen.findByRole("button", { name: /Luis Mora/ }),
    ).toBeInTheDocument();
  });

  it("sin personas a cargo lo explica", async () => {
    servicio.equipo.mockResolvedValue([]);
    pintar(Equipo);
    expect(
      await screen.findByText(/No tiene personas a cargo en el organigrama/),
    ).toBeInTheDocument();
  });

  it("si el equipo no carga, error con reintento", async () => {
    servicio.equipo.mockRejectedValueOnce(errorApi(500, "Caída."));
    pintar(Equipo);
    expect(await screen.findByText("Caída.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("button", { name: /Luis Mora/ }),
    ).toBeInTheDocument();
  });

  it("sin `equipo.ver` no se muestra (aunque la ruta lo exija también)", async () => {
    servicio.yo.mockResolvedValue(ME);
    pintar(Equipo);
    expect(
      await screen.findByText(/No tiene acceso a esta pantalla de Tareas/),
    ).toBeInTheDocument();
    expect(servicio.equipo).not.toHaveBeenCalled();
  });
});

describe("Tiempo objetivo y validaciones", () => {
  const pendientes = {
    tasks: [ajena, propia],
    target_time_data_quality: {
      validated_count: 3,
      pending_count: 1,
      total_count: 4,
      validated_pct: 75,
      pending_pct: 25,
    },
    end_date_data_quality: {
      validated_count: 2,
      pending_count: 2,
      total_count: 4,
      validated_pct: 50,
      pending_pct: 50,
    },
  };

  it("muestra la calidad del dato y no ofrece validar una tarea propia", async () => {
    servicio.pendientes.mockResolvedValue(pendientes);
    pintar(TiempoObjetivo);
    expect(await screen.findByText("75 %")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: "«Mi tarea» es suya: no puede validarla",
      }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Más acciones de «Mi tarea»" }),
    ).toBeNull();
  });

  it("los filtros vuelven a pedir la lista (sin sondeo)", async () => {
    servicio.pendientes.mockResolvedValue(pendientes);
    pintar(TiempoObjetivo);
    await screen.findByText("Clima laboral");
    fireEvent.change(screen.getByLabelText("Tipo"), {
      target: { value: "SEGUIMIENTO" },
    });
    await waitFor(() =>
      expect(servicio.pendientes).toHaveBeenLastCalledWith({
        usuario: "",
        rol: "",
        tipo: "SEGUIMIENTO",
      }),
    );
  });

  it("sin pendientes lo dice; con error, ofrece reintentar", async () => {
    servicio.pendientes
      .mockRejectedValueOnce(errorApi(503, "Servicio no disponible."))
      .mockResolvedValue({ tasks: [] });
    pintar(TiempoObjetivo);
    expect(
      await screen.findByText("Servicio no disponible."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByText("No hay tareas pendientes de validar."),
    ).toBeInTheDocument();
  });

  it("valida el Tiempo Objetivo de una tarea con motivo", async () => {
    servicio.pendientes.mockResolvedValue(pendientes);
    servicio.tiempoObjetivo.mockResolvedValue({
      ...OBJETIVO,
      can_validate: true,
    });
    servicio.fechaFin.mockResolvedValue({ ...FECHA_FIN, can_validate: true });
    servicio.validarTiempoObjetivo.mockResolvedValue({});
    pintar(TiempoObjetivo);
    await accion("Clima laboral", "Validar");
    const dialogo = await screen.findByRole("dialog", {
      name: "Validar tarea",
    });
    const valor = await within(dialogo).findByLabelText(
      /Nuevo tiempo objetivo/,
    );
    expect(valor).toHaveValue("6.30");
    fireEvent.change(valor, { target: { value: "8.15" } });
    // Sin motivo no se envía.
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Validar tiempo objetivo" }),
    );
    expect(
      await within(dialogo).findByText("Elija el motivo del ajuste."),
    ).toBeInTheDocument();
    fireEvent.change(within(dialogo).getByLabelText(/^Motivo/), {
      target: { value: "OTRO" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Validar tiempo objetivo" }),
    );
    expect(
      await within(dialogo).findByText(
        "Indique el detalle cuando el motivo es «Otro».",
      ),
    ).toBeInTheDocument();
    fireEvent.change(within(dialogo).getByLabelText(/Detalle del motivo/), {
      target: { value: "Cambió el proceso" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Validar tiempo objetivo" }),
    );
    await waitFor(() =>
      expect(servicio.validarTiempoObjetivo).toHaveBeenCalledWith(300, {
        new_value: 8.25,
        reason: "OTRO",
        reason_detail: "Cambió el proceso",
      }),
    );
    expect(
      await within(dialogo).findByText("Tiempo objetivo validado."),
    ).toBeInTheDocument();
  });

  it("la Fecha Fin no trae decisión preseleccionada y dice la consecuencia", async () => {
    servicio.pendientes.mockResolvedValue(pendientes);
    servicio.fechaFin.mockResolvedValue({ ...FECHA_FIN, can_validate: true });
    servicio.decidirFechaFin.mockResolvedValue({});
    pintar(TiempoObjetivo);
    await accion("Clima laboral", "Validar");
    const dialogo = await screen.findByRole("dialog", {
      name: "Validar tarea",
    });
    const boton = await within(dialogo).findByRole("button", {
      name: "Elija una decisión",
    });
    expect(boton).toBeDisabled();
    within(dialogo)
      .getAllByRole("radio")
      .forEach((r) => expect(r).not.toBeChecked());
    fireEvent.click(within(dialogo).getByLabelText("Rechazar la fecha"));
    expect(dialogo).toHaveTextContent("La fecha actual no cambia");
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Rechazar fecha fin" }),
    );
    await waitFor(() =>
      expect(servicio.decidirFechaFin).toHaveBeenCalledWith(300, {
        action: "RECHAZAR",
        new_end_date: null,
        observaciones: null,
      }),
    );
  });

  it("regulariza en bloque el Tiempo Objetivo de las seleccionadas", async () => {
    servicio.pendientes.mockResolvedValue(pendientes);
    servicio.validarEnBloque.mockResolvedValue({
      updated_count: 1,
      skipped_self_assigned: [],
    });
    pintar(TiempoObjetivo);
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "Seleccionar «Clima laboral»",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Regularizar tiempo objetivo" }),
    );
    const dialogo = await screen.findByRole("dialog", {
      name: "Regularizar tiempo objetivo de 1 tarea(s)",
    });
    fireEvent.change(within(dialogo).getByLabelText(/Nuevo tiempo objetivo/), {
      target: { value: "4" },
    });
    fireEvent.change(within(dialogo).getByLabelText(/Motivo del ajuste/), {
      target: { value: "PROCEDIMIENTO_ESTANDAR" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Regularizar 1" }),
    );
    await waitFor(() =>
      expect(servicio.validarEnBloque).toHaveBeenCalledWith({
        task_ids: [300],
        new_value: 4,
        reason: "PROCEDIMIENTO_ESTANDAR",
        reason_detail: null,
      }),
    );
    expect(
      await screen.findByText("Tiempo objetivo regularizado en 1 tarea(s)."),
    ).toBeInTheDocument();
  });

  it("aprueba la Fecha Fin en bloque y, si cambió alguna, pide revisar", async () => {
    servicio.pendientes.mockResolvedValue(pendientes);
    servicio.aprobarFechasEnBloque.mockResolvedValue({
      updated_count: 1,
      skipped_self_assigned: [],
      skipped_invalid_date: [],
    });
    pintar(TiempoObjetivo);
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "Seleccionar «Clima laboral»",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Aprobar fecha fin en bloque" }),
    );
    const dialogo = await screen.findByRole("dialog", {
      name: "Aprobar fecha fin de 1 tarea(s)",
    });
    fireEvent.change(
      within(dialogo).getByLabelText("Nueva fecha fin de «Clima laboral»"),
      { target: { value: "2026-11-20" } },
    );
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Revisar cambios" }),
    );
    expect(dialogo).toHaveTextContent("de 15/11/2026 a 20/11/2026");
    expect(servicio.aprobarFechasEnBloque).not.toHaveBeenCalled();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(servicio.aprobarFechasEnBloque).toHaveBeenCalledWith({
        items: [{ task_id: 300, new_end_date: "2026-11-20T00:00:00Z" }],
        observaciones: null,
      }),
    );
  });

  it("con solo `tareas.validar`, las de su equipo desde Equipo", async () => {
    servicio.yo.mockResolvedValue({
      ...LIDER,
      permissions: ["tareas.acceder", "tareas.validar", "equipo.ver"],
    });
    servicio.tareasDe.mockResolvedValue([
      {
        ...ajena,
        assigned_to: { id: 2, name: "Luis Mora", role: "ANALISTA_CC" },
      },
      tarea({
        id: 302,
        title: "Ya validada",
        target_time_validated: 3,
        end_date_approval_status: "APROBADA",
        assigned_to: { id: 2, name: "Luis Mora", role: "ANALISTA_CC" },
      }),
    ]);
    pintar(TiempoObjetivo);
    expect(await screen.findByText("Clima laboral")).toBeInTheDocument();
    expect(screen.queryByText("Ya validada")).toBeNull();
    expect(servicio.pendientes).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("Cierre de mes", () => {
  it("muestra la vista previa y cierra solo tras revisar y confirmar", async () => {
    servicio.cerrarMes.mockResolvedValue({
      archived_count: 5,
      duplicated_count: 4,
      continued_active_count: 2,
      month: 10,
      year: 2026,
      next_month: 11,
      next_year: 2026,
      cutoff_date: "2026-10-31",
      closure_type: "NORMAL",
    });
    pintar(CierreDeMes);
    expect(
      await screen.findByRole("heading", {
        name: "3 · Vista previa: Octubre 2026",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Meses terminados sin cerrar:"),
    ).toBeInTheDocument();
    const cerrar = screen.getByRole("button", { name: "Cerrar Octubre 2026" });
    expect(cerrar).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Revisé la vista previa/));
    expect(cerrar).toBeEnabled();

    // Cancelar no cierra.
    fireEvent.click(cerrar);
    let dialogo = await screen.findByRole("dialog", {
      name: "¿Cerrar Octubre 2026?",
    });
    expect(dialogo).toHaveTextContent("Se archivan 5 tarea(s)");
    expect(dialogo).toHaveTextContent("no se vuelve a abrir");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "¿Cerrar Octubre 2026?" }),
      ).toBeNull(),
    );
    expect(servicio.cerrarMes).not.toHaveBeenCalled();

    fireEvent.click(cerrar);
    dialogo = await screen.findByRole("dialog", {
      name: "¿Cerrar Octubre 2026?",
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Cerrar mes" }),
    );
    await waitFor(() =>
      expect(servicio.cerrarMes).toHaveBeenCalledWith({
        year: 2026,
        month: 10,
        cutoffDate: "2026-10-31",
      }),
    );
    expect(
      await screen.findByText("Octubre 2026 cerrado."),
    ).toBeInTheDocument();
  });

  it("cambiar la fecha de corte recalcula la vista previa", async () => {
    pintar(CierreDeMes);
    const corte = await screen.findByLabelText(/Fecha de corte/);
    await waitFor(() => expect(corte).toBeEnabled());
    fireEvent.change(corte, { target: { value: "2026-10-20" } });
    await waitFor(() =>
      expect(servicio.vistaPreviaDelCierre).toHaveBeenLastCalledWith({
        year: 2026,
        month: 10,
        cutoffDate: "2026-10-20",
      }),
    );
  });

  it("un mes ya cerrado no ofrece cerrar", async () => {
    servicio.vistaPreviaDelCierre.mockResolvedValue({
      ...VISTA_CIERRE,
      already_closed: true,
      pending_closures: [],
    });
    pintar(CierreDeMes);
    expect(
      await screen.findByText(/Este mes ya fue cerrado/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Cerrar Octubre/ }),
    ).toBeNull();
  });

  it("si la vista previa falla, error con reintento", async () => {
    servicio.vistaPreviaDelCierre
      .mockRejectedValueOnce(
        errorApi(400, "La fecha de corte no puede ser posterior a hoy"),
      )
      .mockResolvedValue(VISTA_CIERRE);
    pintar(CierreDeMes);
    expect(
      await screen.findByText("La fecha de corte no puede ser posterior a hoy"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("heading", {
        name: /Vista previa: Octubre 2026/,
      }),
    ).toBeInTheDocument();
  });
});

describe("Ajustes de tareas", () => {
  it("guarda solo los ajustes que cambiaron", async () => {
    servicio.yo.mockResolvedValue({
      ...LIDER,
      permissions: ["tareas.acceder", "tareas.administrar"],
    });
    servicio.guardarAjustes.mockImplementation(async (c) => ({
      retroactive_window_business_days: 3,
      horas_efectivas_dia: 6.5,
      horas_esperadas_mes: 140,
      first_comment_role: null,
      retroactive_notify_users: [],
      ...c,
    }));
    pintar(AjustesTareas);
    const ventana = await screen.findByLabelText(
      /Ventana del registro retroactivo/,
    );
    fireEvent.change(ventana, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
    await waitFor(() =>
      expect(servicio.guardarAjustes).toHaveBeenCalledWith({
        retroactive_window_business_days: 3,
      }),
    );
    expect(await screen.findByText(/Ajustes guardados/)).toBeInTheDocument();
    // El catálogo de motivos, con su estado en texto.
    expect(screen.getByText("Reunión")).toBeInTheDocument();
    expect(screen.getAllByText("Activo").length).toBeGreaterThan(0);
  });

  describe("aviso de los registros retroactivos", () => {
    const AJUSTES = {
      retroactive_window_business_days: 2,
      horas_efectivas_dia: 6.5,
      horas_esperadas_mes: 140,
      first_comment_role: null,
      retroactive_notify_users: [],
    };

    beforeEach(() => {
      servicio.yo.mockResolvedValue({
        ...LIDER,
        permissions: ["tareas.acceder", "tareas.administrar"],
      });
      servicio.ajustes.mockResolvedValue(AJUSTES);
    });

    async function selectorListo() {
      const selector = await screen.findByLabelText("Elegir persona");
      await waitFor(() => expect(selector).toBeEnabled());
      return selector;
    }

    it("sin nadie elegido, se avisa al jefe inmediato", async () => {
      pintar(AjustesTareas);
      expect(
        await screen.findByText(
          "Se avisa al jefe inmediato de quien registra las horas, según el organigrama (recomendado).",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Volver al jefe inmediato" }),
      ).toBeNull();
      expect(screen.queryByText(/Cambios sin guardar/)).toBeNull();
    });

    it("agrega con el foco de vuelta en el selector, avisa que falta guardar y guarda los ids", async () => {
      servicio.guardarAjustes.mockImplementation(async (c) => ({
        ...AJUSTES,
        ...c,
      }));
      pintar(AjustesTareas);
      const selector = await selectorListo();
      fireEvent.change(screen.getByLabelText("Buscar persona"), {
        target: { value: "luis" },
      });
      expect(
        within(selector).queryByRole("option", { name: /Ana Pérez/ }),
      ).toBeNull();
      fireEvent.change(selector, { target: { value: "2" } });
      fireEvent.click(screen.getByRole("button", { name: /Agregar persona/ }));
      await waitFor(() => expect(selector).toHaveFocus());
      expect(screen.getByRole("status")).toHaveTextContent(
        "Se agregó a Luis Mora. 1 de 25 personas.",
      );
      expect(
        screen.getByText(/Al guardar, se avisará solo a estas personas/),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Cambios sin guardar: pulse «Guardar ajustes»."),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
      await waitFor(() =>
        expect(servicio.guardarAjustes).toHaveBeenCalledWith({
          retroactive_notify_users: [2],
        }),
      );
      expect(
        await screen.findByText(/^Se avisa solo a estas personas/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Cambios sin guardar/)).toBeNull();
    });

    it("no se puede agregar a una persona que el buscador oculta", async () => {
      pintar(AjustesTareas);
      const selector = await selectorListo();
      fireEvent.change(selector, { target: { value: "2" } });
      const agregar = screen.getByRole("button", { name: /Agregar persona/ });
      expect(agregar).toBeEnabled();
      fireEvent.change(screen.getByLabelText("Buscar persona"), {
        target: { value: "zzz" },
      });
      expect(agregar).toBeDisabled();
      expect(selector).toHaveValue("");
      fireEvent.click(agregar);
      expect(
        screen.getByText(/Se avisa al jefe inmediato de quien registra/),
      ).toBeInTheDocument();
    });

    it("al quitar, el foco va al «Quitar» siguiente, y al final al buscador", async () => {
      servicio.ajustes.mockResolvedValue({
        ...AJUSTES,
        retroactive_notify_users: [1, 2],
      });
      pintar(AjustesTareas);
      fireEvent.click(
        await screen.findByRole("button", { name: "Quitar a Ana Pérez" }),
      );
      const siguiente = screen.getByRole("button", {
        name: "Quitar a Luis Mora",
      });
      await waitFor(() => expect(siguiente).toHaveFocus());
      expect(screen.getByRole("status")).toHaveTextContent(
        "Se quitó a Ana Pérez.",
      );
      fireEvent.click(siguiente);
      await waitFor(() =>
        expect(screen.getByLabelText("Buscar persona")).toHaveFocus(),
      );
      expect(
        screen.getByText(/Al guardar, se avisará al jefe inmediato/),
      ).toBeInTheDocument();
    });

    it("«Volver al jefe inmediato» vacía la lista y lleva el foco al texto", async () => {
      servicio.ajustes.mockResolvedValue({
        ...AJUSTES,
        retroactive_notify_users: [1, 2],
      });
      servicio.guardarAjustes.mockResolvedValue(AJUSTES);
      pintar(AjustesTareas);
      expect(await screen.findByText("2 de 25 personas.")).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Volver al jefe inmediato" }),
      );
      const texto = screen.getByText(
        /Al guardar, se avisará al jefe inmediato/,
      );
      await waitFor(() => expect(texto).toHaveFocus());
      expect(screen.getByRole("status")).toHaveTextContent(
        "Ahora se avisa al jefe inmediato.",
      );
      fireEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
      await waitFor(() =>
        expect(servicio.guardarAjustes).toHaveBeenCalledWith({
          retroactive_notify_users: [],
        }),
      );
    });

    it("una persona que ya no está en la lista se marca «Ya no tiene acceso»", async () => {
      servicio.ajustes.mockResolvedValue({
        ...AJUSTES,
        retroactive_notify_users: [99],
      });
      pintar(AjustesTareas);
      expect(await screen.findByText("Ya no tiene acceso")).toBeInTheDocument();
      expect(screen.getByText(/Persona n\.º 99/)).toBeInTheDocument();
    });

    it("si la lista de personas no carga, lo dice (no «Cargando…»)", async () => {
      servicio.asignables.mockRejectedValue(errorApi(500, "Sin servicio."));
      pintar(AjustesTareas);
      expect(await screen.findByText("Sin servicio.")).toBeInTheDocument();
      const selector = screen.getByLabelText("Elegir persona");
      expect(
        within(selector).getByRole("option", {
          name: "No se pudo cargar la lista",
        }),
      ).toBeInTheDocument();
    });

    it("el 400 de una persona no válida queda bajo el campo", async () => {
      servicio.guardarAjustes.mockRejectedValue(
        errorApi(
          400,
          "La persona 2 no es una persona activa de la empresa.",
          "validation_error",
          {
            retroactive_notify_users: [
              "La persona 2 no es una persona activa de la empresa.",
            ],
          },
        ),
      );
      pintar(AjustesTareas);
      const selector = await selectorListo();
      fireEvent.change(selector, { target: { value: "2" } });
      fireEvent.click(screen.getByRole("button", { name: /Agregar persona/ }));
      fireEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
      await waitFor(() =>
        expect(screen.getByLabelText("Elegir persona")).toHaveAttribute(
          "aria-invalid",
          "true",
        ),
      );
    });
  });
});
