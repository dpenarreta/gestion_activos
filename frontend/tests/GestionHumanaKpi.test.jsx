import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN,
  DIRECCION,
  EQUIPO,
  LIDER,
  ME,
  cargaConPermisoMedico,
  cargaEnmascarada,
  errorApi,
  kpi,
  servicioFalso,
} from "./gestionHumanaKpiDatos";

/*
 * Desempeño: el menú por permisos, Mis KPI (su mes, el rango, los estados de
 * carga y error, el detalle médico enmascarado), KPI del equipo (con el
 * riesgo operativo), el simulador, el Resumen ejecutivo, la Inteligencia
 * preventiva y los Ajustes de KPI. Los servicios van simulados.
 */

const servicio = servicioFalso();
vi.mock("../src/api/kpiService", async (importOriginal) => ({
  ...(await importOriginal()),
  kpiService: servicio,
}));
const proyectos = { listar: vi.fn() };
vi.mock("../src/api/proyectosGhService", async (importOriginal) => ({
  ...(await importOriginal()),
  proyectosGhService: proyectos,
}));
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, permissions: [] } }),
}));

beforeAll(() => {
  // Recharts mide su contenedor; jsdom no trae ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const { ProveedorKpi } =
  await import("../src/pages/GestionHumana/Desempeno/ContextoKpi");
const { MisKpi } = await import("../src/pages/GestionHumana/Desempeno/MisKpi");
const { KpiEquipo } =
  await import("../src/pages/GestionHumana/Desempeno/KpiEquipo");
const { ResumenEjecutivo } =
  await import("../src/pages/GestionHumana/Desempeno/ResumenEjecutivo");
const { InteligenciaPreventiva } =
  await import("../src/pages/GestionHumana/Desempeno/InteligenciaPreventiva");
const { AjustesKpi } =
  await import("../src/pages/GestionHumana/Desempeno/AjustesKpi");
const { getVisibleAdminMenu } =
  await import("../src/components/admin/AdminSidebar/staticAdminMenu");

function pintar(Pantalla, ruta = "/admin/gestion-humana") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <ProveedorKpi>
        <Pantalla />
      </ProveedorKpi>
    </MemoryRouter>,
  );
}

function mesDe(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
}
const hoy = new Date();
const MES_ACTUAL = mesDe(hoy);
const MES_ANTERIOR = mesDe(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));

beforeEach(() => {
  Object.assign(servicio, servicioFalso());
  proyectos.listar.mockReset();
  proyectos.listar.mockResolvedValue([
    { id: 10, name: "Plan de bienestar", status: "EN_EJECUCION" },
  ]);
});

describe("Desempeño en el menú", () => {
  const hojas = (items) =>
    items.flatMap((i) => [...(i.path ? [i] : []), ...hojas(i.children ?? [])]);
  const ids = (permisos) =>
    hojas(getVisibleAdminMenu(permisos, "gestion_humana")).map((i) => i.id);

  it("con solo `kpi.acceder`, Mis KPI directo", () => {
    const menu = getVisibleAdminMenu(["kpi.acceder"], "gestion_humana").filter(
      (i) => i.modulo === "gestion_humana",
    );
    expect(menu).toHaveLength(1);
    expect(menu[0]).toMatchObject({
      id: "gh-mis-kpi",
      path: "/admin/gestion-humana/mis-kpi",
    });
  });

  it("cada entrada con su permiso, y todas exigen `kpi.acceder`", () => {
    expect(ids(["kpi.acceder", "kpi.equipo"])).toContain("gh-kpi-equipo");
    expect(ids(["kpi.equipo"])).not.toContain("gh-kpi-equipo");
    expect(ids(["kpi.acceder", "kpi.ejecutivo"])).toContain(
      "gh-resumen-ejecutivo",
    );
    expect(ids(["kpi.acceder", "inteligencia_preventiva.ver"])).toContain(
      "gh-inteligencia-preventiva",
    );
    expect(ids(["inteligencia_preventiva.ver"])).not.toContain(
      "gh-inteligencia-preventiva",
    );
    expect(ids(["kpi.acceder", "kpi.administrar"])).toContain("gh-ajustes-kpi");
    expect(ids(["kpi.acceder"])).not.toContain("gh-ajustes-kpi");
  });

  it("con todo, la sección Desempeño con sus cinco entradas en orden", () => {
    const menu = getVisibleAdminMenu(
      ADMIN.permissions,
      "gestion_humana",
    ).filter((i) => i.modulo === "gestion_humana");
    const seccion = menu.find((i) => i.id === "gh-desempeno");
    expect(seccion.name).toBe("Desempeño");
    expect(seccion.children.map((i) => i.name)).toEqual([
      "Mis KPI",
      "KPI del equipo",
      "Resumen ejecutivo",
      "Inteligencia preventiva",
      "Ajustes de KPI",
    ]);
  });

  it("el aviso de riesgo (`/admin/gestion-humana/kpi`) es la ruta de KPI del equipo", () => {
    const entrada = hojas(
      getVisibleAdminMenu(LIDER.permissions, "gestion_humana"),
    ).find((i) => i.id === "gh-kpi-equipo");
    expect(entrada.path).toBe("/admin/gestion-humana/kpi");
  });
});

describe("Mis KPI", () => {
  it("carga el mes en curso y lo muestra con su semáforo en texto", async () => {
    pintar(MisKpi);
    expect(
      await screen.findByText("Aceptable (60 a 79 %)"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Mis KPI" }),
    ).toBeInTheDocument();
    expect(servicio.misKpi).toHaveBeenCalledWith(MES_ACTUAL);
    expect(screen.getAllByText("Subutilización").length).toBeGreaterThan(0);
    expect(screen.getByText("Informe de clima laboral")).toBeInTheDocument();
    // Horas como «30 h 30 min», nunca «30.5h».
    expect(
      screen.getByText(/30 h 30 min de 140 h de base/),
    ).toBeInTheDocument();
  });

  it("cambiar de mes vuelve a pedir sus KPI de ese mes", async () => {
    pintar(MisKpi);
    await screen.findByText("Informe de clima laboral");
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    await waitFor(() =>
      expect(servicio.misKpi).toHaveBeenLastCalledWith(MES_ANTERIOR),
    );
    expect(
      screen.getByRole("button", { name: "Mes siguiente" }),
    ).not.toBeDisabled();
  });

  it("mientras carga lo dice", async () => {
    servicio.misKpi.mockReturnValue(new Promise(() => {}));
    pintar(MisKpi);
    await screen.findByRole("tab", { name: "Mes" });
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
  });

  it("si falla, error con «Reintentar»", async () => {
    servicio.misKpi.mockRejectedValueOnce(
      errorApi(500, "El motor no respondió."),
    );
    pintar(MisKpi);
    expect(
      await screen.findByText("El motor no respondió."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByText("Informe de clima laboral"),
    ).toBeInTheDocument();
  });

  it("sin tareas en el mes lo dice (no una tabla vacía)", async () => {
    servicio.misKpi.mockResolvedValue(
      kpi({
        tasks: [],
        cumplimiento: {
          ...kpi().cumplimiento,
          total: 0,
          completed_pct: 0,
          color: "red",
        },
      }),
    );
    pintar(MisKpi);
    expect(
      await screen.findByText("Sin tareas asignadas en este período."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No hay tareas registradas en este período/),
    ).toBeInTheDocument();
  });

  it("los gráficos traen su tabla equivalente", async () => {
    pintar(MisKpi);
    await screen.findByText("Informe de clima laboral");
    const tabla = screen.getByRole("table", { name: "Horas por día" });
    expect(within(tabla).getByText("Feriado")).toBeInTheDocument();
    expect(
      screen.getAllByText("Ver los datos en tabla").length,
    ).toBeGreaterThan(1);
  });

  it("el análisis por reglas y el Motor de Insights cargan (sin Nova)", async () => {
    pintar(MisKpi);
    expect(
      await screen.findByText("Puntaje de desempeño (Performance Score)", {
        selector: "h3",
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Acción inmediata")).toBeInTheDocument();
    expect(
      (await screen.findAllByText("Cumplimiento por debajo del objetivo"))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/Nova/)).toBeNull();
  });

  it("para un rol de dirección explica que sus KPI individuales no aplican", async () => {
    servicio.yo.mockResolvedValue(DIRECCION);
    pintar(MisKpi);
    expect(
      await screen.findByText(
        /sus indicadores individuales de ejecución no son representativos/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Ver los KPI del equipo" }),
    ).toBeInTheDocument();
    expect(servicio.misKpi).not.toHaveBeenCalled();
  });

  it("el rango de meses muestra el informe o el motivo del servidor", async () => {
    servicio.misKpiPorRango.mockRejectedValueOnce(
      errorApi(400, "El rango no puede superar 24 meses."),
    );
    pintar(MisKpi, "/admin/gestion-humana/mis-kpi?vista=rango");
    fireEvent.click(
      await screen.findByRole("button", { name: "Generar informe" }),
    );
    expect(
      await screen.findByText("El rango no puede superar 24 meses."),
    ).toBeInTheDocument();

    servicio.misKpiPorRango.mockResolvedValue({
      report: {
        from: "2026-09",
        to: "2026-10",
        months: [
          {
            month: "2026-09",
            label: "septiembre de 2026",
            completed_pct: 70,
            total_tasks: 3,
            completed_tasks: 2,
            overdue_count: 1,
            score: 60,
            carga_real_hours: 120,
            carga_base_hours: 140,
            carga_pct: 86,
            carga_color: "yellow",
            carga_label: "Moderado",
          },
          {
            month: "2026-10",
            label: "octubre de 2026",
            completed_pct: 90,
            total_tasks: 5,
            completed_tasks: 5,
            overdue_count: 0,
            score: 80,
            carga_real_hours: 140,
            carga_base_hours: 140,
            carga_pct: 100,
            carga_color: "green",
            carga_label: "Óptimo",
          },
        ],
        aggregated: {
          avg_cumplimiento: 80,
          avg_score: 70,
          total_tasks: 8,
          total_completed_tasks: 7,
          total_seguimiento: 2,
          consultas_by_reason: [],
          total_carga_real_hours: 260,
          total_carga_base_hours: 280,
          avg_carga_pct: 93,
          carga_color: "yellow",
          carga_label: "Moderado",
        },
        trends: {
          cumplimiento_trend: "mejora",
          cumplimiento_change: 20,
          first_month_cumplimiento: 70,
          last_month_cumplimiento: 90,
        },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generar informe" }));
    expect(await screen.findByText("En mejora")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Detalle por mes" }),
    ).toHaveTextContent("octubre de 2026");
  });
});

describe("Detalle médico (LOPDP)", () => {
  it("el titular ve el tipo de permiso tal como llega", async () => {
    servicio.misKpi.mockResolvedValue(
      kpi({ carga_tiempo: cargaConPermisoMedico() }),
    );
    pintar(MisKpi);
    expect(
      await screen.findByText("Permiso médico (día completo)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Permisos médicos: 8 h")).toBeInTheDocument();
  });

  it("enmascarado por el servidor: solo «Ausencia justificada», nunca el motivo", async () => {
    servicio.kpiDe.mockResolvedValue(
      kpi({
        user: { id: 2, name: "Luis", role: "ANALISTA_CC" },
        carga_tiempo: cargaEnmascarada(),
      }),
    );
    servicio.yo.mockResolvedValue(LIDER);
    pintar(KpiEquipo, "/admin/gestion-humana/kpi?persona=2");
    expect(
      await screen.findByText("Ausencia justificada (día completo)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ausencias justificadas: 8 h")).toBeInTheDocument();
    const tabla = screen.getByRole("table", { name: "Horas por día" });
    expect(within(tabla).getByText("Ausencia justificada")).toBeInTheDocument();
    expect(screen.queryByText(/médic/i)).toBeNull();
    expect(screen.queryByText(/Permiso personal/)).toBeNull();
    expect(screen.queryByText(/Vacaciones/)).toBeNull();
  });
});

describe("KPI del equipo", () => {
  beforeEach(() => servicio.yo.mockResolvedValue(LIDER));

  it("muestra el balance de carga con su zona en texto y la capacidad", async () => {
    pintar(KpiEquipo);
    await waitFor(() =>
      expect(servicio.equipo).toHaveBeenCalledWith(MES_ACTUAL),
    );
    const balance = (
      await screen.findByText("Balance de carga del equipo")
    ).closest("section");
    expect(within(balance).getByText("Sobrecarga")).toBeInTheDocument();
    expect(within(balance).getByText("Óptimo")).toBeInTheDocument();
    expect(await screen.findByText("1 con capacidad alta")).toBeInTheDocument();
  });

  it("al elegir a una persona pide sus KPI del mes y el foco va a su nombre", async () => {
    pintar(KpiEquipo);
    fireEvent.click(await screen.findByRole("button", { name: /Luis/ }));
    await waitFor(() =>
      expect(servicio.kpiDe).toHaveBeenCalledWith(2, MES_ACTUAL),
    );
    const nombre = await screen.findByRole("heading", {
      name: "Luis",
      level: 3,
    });
    await waitFor(() => expect(nombre).toHaveFocus());
    expect(
      await screen.findByText("Informe de clima laboral"),
    ).toBeInTheDocument();
  });

  it("sin personas a cargo lo explica", async () => {
    servicio.equipo.mockResolvedValue({ users: [] });
    pintar(KpiEquipo);
    expect(
      await screen.findByText(
        /No tiene personas a cargo \(según el organigrama\)/,
      ),
    ).toBeInTheDocument();
  });

  it("si el equipo no carga, error con reintento", async () => {
    servicio.equipo.mockRejectedValueOnce(
      errorApi(500, "No se pudo leer el equipo."),
    );
    pintar(KpiEquipo);
    expect(
      await screen.findByText("No se pudo leer el equipo."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("button", { name: /Sofía/ }),
    ).toBeInTheDocument();
    expect(EQUIPO.users).toHaveLength(2);
  });

  it("sin `kpi.equipo` ni riesgo, no tiene acceso", async () => {
    servicio.yo.mockResolvedValue(ME);
    pintar(KpiEquipo);
    expect(
      await screen.findByText(/No tiene acceso a esta pantalla de Desempeño/),
    ).toBeInTheDocument();
    expect(servicio.equipo).not.toHaveBeenCalled();
  });
});

describe("Riesgo operativo", () => {
  it("el equipo con su clasificación en texto y las recomendaciones por reglas", async () => {
    servicio.yo.mockResolvedValue(LIDER);
    pintar(KpiEquipo);
    const tabla = await screen.findByRole("table", {
      name: "Riesgo operativo por persona, de mayor a menor",
    });
    expect(within(tabla).getByText("Riesgo alto")).toBeInTheDocument();
    expect(within(tabla).getByText("Riesgo bajo")).toBeInTheDocument();
    expect(
      await screen.findByText("Redistribuir 12 h de Luis hacia Sofía."),
    ).toBeInTheDocument();
    expect(screen.getByText(/−10 pts de riesgo operativo/)).toBeInTheDocument();
  });

  it("el índice individual con su desglose y acciones", async () => {
    servicio.yo.mockResolvedValue(LIDER);
    pintar(KpiEquipo, "/admin/gestion-humana/kpi?persona=2");
    const seccion = (
      await screen.findByText("Índice de Riesgo Operativo", { selector: "h3" })
    ).closest("section");
    expect(await within(seccion).findByText("Riesgo alto")).toBeInTheDocument();
    expect(
      within(seccion).getByText("+8 frente al mes anterior."),
    ).toBeInTheDocument();
    expect(
      within(seccion).getByText(/Redistribuir tareas pendientes/),
    ).toBeInTheDocument();
    expect(servicio.riesgo).toHaveBeenCalledWith(2);
  });

  it("con solo `inteligencia_preventiva.ver`, el destino del aviso muestra el riesgo del equipo", async () => {
    servicio.yo.mockResolvedValue({
      ...ME,
      permissions: ["kpi.acceder", "inteligencia_preventiva.ver"],
    });
    pintar(KpiEquipo, "/admin/gestion-humana/kpi");
    expect(
      await screen.findByRole("table", {
        name: "Riesgo operativo por persona, de mayor a menor",
      }),
    ).toBeInTheDocument();
    expect(servicio.equipo).not.toHaveBeenCalled();
  });

  it("si el riesgo del equipo falla, error con reintento", async () => {
    servicio.yo.mockResolvedValue(LIDER);
    servicio.riesgoDelEquipo.mockRejectedValueOnce(
      errorApi(500, "Riesgo no disponible."),
    );
    pintar(KpiEquipo);
    expect(
      await screen.findByText("Riesgo no disponible."),
    ).toBeInTheDocument();
  });
});

describe("Simulador «¿Qué pasaría si…?»", () => {
  it("valida, simula al pulsar y muestra antes y después", async () => {
    servicio.simular.mockResolvedValue({
      before: {
        carga_pct: 22,
        carga_label: "Subutilización",
        carga_color: "red",
        capacidad_disponible_pct: 98,
        capacidad_disponible_horas: 120,
        cumplimiento_pct: 75,
        health_score: 45.5,
        health_classification: "Crítico",
        performance_score_pts: 72.5,
        performance_score_class: "Riesgo",
      },
      after: {
        carga_pct: 26,
        carga_label: "Subutilización",
        carga_color: "red",
        capacidad_disponible_pct: 98,
        capacidad_disponible_horas: 120,
        cumplimiento_pct: 75,
        health_score: 47,
        health_classification: "Crítico",
        performance_score_pts: 72.5,
        performance_score_class: "Riesgo",
      },
      diff: { health_score: 1.5, performance_score: 0 },
    });
    pintar(MisKpi);
    fireEvent.click(
      await screen.findByRole("button", { name: /¿Qué pasaría si…\?/ }),
    );
    const panel = await screen.findByRole("dialog", {
      name: "¿Qué pasaría si…?",
    });
    fireEvent.click(
      within(panel).getByRole("radio", { name: "Registrar horas" }),
    );
    fireEvent.change(within(panel).getByLabelText(/Horas adicionales/), {
      target: { value: "4.75" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Simular" }));
    expect(
      await within(panel).findByText(/Use el formato HH.MM/),
    ).toBeInTheDocument();
    expect(servicio.simular).not.toHaveBeenCalled();

    fireEvent.change(within(panel).getByLabelText(/Horas adicionales/), {
      target: { value: "4.30" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Simular" }));
    await waitFor(() =>
      expect(servicio.simular).toHaveBeenCalledWith(1, {
        type: "register_hours",
        hours: 4.5,
      }),
    );
    const tabla = await within(panel).findByRole("table", {
      name: "Antes y después de la simulación",
    });
    expect(within(tabla).getByText("26 %")).toBeInTheDocument();
    expect(within(tabla).getByText("47")).toBeInTheDocument();
    // La columna «Cambio» dice si mejora o empeora, no solo el número.
    expect(within(tabla).getByText("▲ mejora")).toBeInTheDocument();
    expect(within(tabla).getByText("▲ sube")).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("status")
        .some((r) => r.textContent.startsWith("Simulación lista:")),
    ).toBe(true);
    expect(panel).toHaveTextContent("no guarda ni modifica ningún dato");
  });

  it("si el servidor rechaza el escenario, dice por qué", async () => {
    servicio.simular.mockRejectedValue(errorApi(400, "Escenario inválido."));
    pintar(MisKpi);
    fireEvent.click(
      await screen.findByRole("button", { name: /¿Qué pasaría si…\?/ }),
    );
    const panel = await screen.findByRole("dialog", {
      name: "¿Qué pasaría si…?",
    });
    fireEvent.change(within(panel).getByLabelText(/Tareas a completar/), {
      target: { value: "2" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Simular" }));
    expect(
      await within(panel).findByText("Escenario inválido."),
    ).toBeInTheDocument();
  });
});

describe("Resumen ejecutivo", () => {
  beforeEach(() => servicio.yo.mockResolvedValue(LIDER));

  it("muestra el estado, qué atender y el ranking con la carga en texto", async () => {
    pintar(ResumenEjecutivo);
    expect((await screen.findAllByText("Atención")).length).toBeGreaterThan(0);
    expect(
      screen.getByText("Luis — sobrecarga proyectada (115%)"),
    ).toBeInTheDocument();
    const ranking = screen.getByRole("table", {
      name: "Ranking del equipo por puntaje",
    });
    expect(within(ranking).getByText("Sobrecarga")).toBeInTheDocument();
    expect(within(ranking).getByText("−6")).toBeInTheDocument();
  });

  it("sin equipo lo explica; si falla, error con reintento", async () => {
    servicio.ejecutivo.mockRejectedValueOnce(errorApi(500, "Sin respuesta."));
    pintar(ResumenEjecutivo);
    expect(await screen.findByText("Sin respuesta.")).toBeInTheDocument();
    servicio.ejecutivo.mockResolvedValue({
      ...(await servicioFalso().ejecutivo()),
      ranking: [],
    });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByText(/no tiene un equipo ejecutor a cargo/),
    ).toBeInTheDocument();
  });
});

describe("Inteligencia preventiva", () => {
  it("predicciones, estabilidad y alertas con su severidad en texto", async () => {
    servicio.yo.mockResolvedValue({
      ...ME,
      permissions: ["kpi.acceder", "inteligencia_preventiva.ver"],
    });
    pintar(InteligenciaPreventiva);
    expect(
      await screen.findByText(
        "El cumplimiento esperado al cierre del mes es 78 %.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Nivel bajo")).toBeInTheDocument();
    // «Muy Alta» sin ninguna variabilidad medida es falta de datos.
    expect(screen.queryByText("Muy Alta")).toBeNull();
    expect(screen.getAllByText("Sin datos suficientes").length).toBeGreaterThan(
      0,
    );
    expect(await screen.findByText("Seguimiento")).toBeInTheDocument();
    expect(screen.getByText("Alto: 65 %")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Su equipo" })).toBeNull();
  });

  it("con `kpi.equipo` suma la sección del equipo y el retraso de proyectos", async () => {
    servicio.yo.mockResolvedValue(LIDER);
    pintar(InteligenciaPreventiva);
    expect(
      await screen.findByRole("heading", { name: "Su equipo" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Plan de bienestar")).toBeInTheDocument();
    expect(servicio.retrasoDeProyecto).toHaveBeenCalledWith(10);
    expect(
      await screen.findByText(
        "Sin riesgos preventivos detectados en el equipo.",
      ),
    ).toBeInTheDocument();
  });

  it("si las predicciones fallan, error con reintento", async () => {
    servicio.yo.mockResolvedValue({
      ...ME,
      permissions: ["kpi.acceder", "inteligencia_preventiva.ver"],
    });
    servicio.predicciones.mockRejectedValueOnce(
      errorApi(500, "Predicciones caídas."),
    );
    pintar(InteligenciaPreventiva);
    expect(await screen.findByText("Predicciones caídas.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByText(
        "El cumplimiento esperado al cierre del mes es 78 %.",
      ),
    ).toBeInTheDocument();
  });
});

describe("Ajustes de KPI", () => {
  beforeEach(() => servicio.yo.mockResolvedValue(ADMIN));

  it("dice si las ponderaciones suman 100 y guarda solo lo que cambió", async () => {
    servicio.guardarConfiguracion.mockResolvedValue({ config: {} });
    pintar(AjustesKpi);
    const seccion = (
      await screen.findByText("Ponderaciones del Performance Score")
    ).closest("section");
    expect(
      within(seccion).getByText(/Suma: 100 \(correcta\)/),
    ).toBeInTheDocument();
    fireEvent.change(within(seccion).getByLabelText("Trazabilidad"), {
      target: { value: "20" },
    });
    expect(
      within(seccion).getByText(/Suma: 105 \(debe sumar 100\)/),
    ).toBeInTheDocument();
    fireEvent.change(within(seccion).getByLabelText("Cumplimiento"), {
      target: { value: "30" },
    });
    fireEvent.click(within(seccion).getByRole("button", { name: "Guardar" }));
    const confirmacion = await screen.findByRole("dialog", {
      name: "¿Guardar este cambio del motor de KPI?",
    });
    expect(confirmacion).toHaveTextContent(
      "Recalcula los KPI de todas las personas desde ahora",
    );
    fireEvent.click(
      within(confirmacion).getByRole("button", { name: "Guardar" }),
    );
    await waitFor(() =>
      expect(servicio.guardarConfiguracion).toHaveBeenCalledWith({
        perf_weight_trazabilidad: 20,
        perf_weight_cumplimiento: 30,
      }),
    );
  });

  it("muestra el motivo del servidor si rechaza el cambio", async () => {
    servicio.guardarConfiguracion.mockRejectedValue(
      errorApi(
        400,
        "Las ponderaciones de Performance Score deben sumar 100 (suman 105).",
      ),
    );
    pintar(AjustesKpi);
    const seccion = (
      await screen.findByText("Ponderaciones del Performance Score")
    ).closest("section");
    fireEvent.change(within(seccion).getByLabelText("Trazabilidad"), {
      target: { value: "20" },
    });
    fireEvent.click(within(seccion).getByRole("button", { name: "Guardar" }));
    fireEvent.click(
      within(
        await screen.findByRole("dialog", {
          name: "¿Guardar este cambio del motor de KPI?",
        }),
      ).getByRole("button", { name: "Guardar" }),
    );
    expect(
      await within(seccion).findByText(
        "Las ponderaciones de Performance Score deben sumar 100 (suman 105).",
      ),
    ).toBeInTheDocument();
  });

  it("si no cargan, error con reintento; sin `kpi.administrar`, sin acceso", async () => {
    servicio.configuracion.mockRejectedValueOnce(
      errorApi(500, "Ajustes no disponibles."),
    );
    const { unmount } = pintar(AjustesKpi);
    expect(
      await screen.findByText("Ajustes no disponibles."),
    ).toBeInTheDocument();
    unmount();
    servicio.yo.mockResolvedValue(LIDER);
    pintar(AjustesKpi);
    expect(
      await screen.findByText(/No tiene acceso a esta pantalla de Desempeño/),
    ).toBeInTheDocument();
  });
});

describe("Auditoría UX/UI: números delicados", () => {
  it("la barra de zonas usa los umbrales reales y la clasificación del servidor", async () => {
    pintar(MisKpi);
    const seccion = (
      await screen.findByText("Puntaje de desempeño (Performance Score)", {
        selector: "h3",
      })
    ).closest("section");
    expect(
      within(seccion).getByText(
        /de 100: Riesgo\. Tramos: Crítico de 0 a 60; Riesgo de 60 a 75; Bueno de 75 a 90; Excelente de 90 a 100\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/rango Medio/)).toBeNull();
  });

  it("fuera del mes en curso oculta lo que el servidor calcula con el día de hoy", async () => {
    pintar(MisKpi);
    await screen.findByText("Puntaje de desempeño (Performance Score)", {
      selector: "h3",
    });
    expect(
      screen.getByRole("button", { name: /¿Qué pasaría si…\?/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    expect(
      await screen.findByText(
        /son del mes en curso; para verlos, vuelva al mes en curso/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /¿Qué pasaría si…\?/ }),
    ).toBeNull();
    expect(screen.queryByText("Carga laboral (horas reales)")).toBeNull();
    expect(screen.queryByText("Motor de Insights")).toBeNull();
    expect(screen.getByText("Informe de clima laboral")).toBeInTheDocument();
  });

  it("el día de hoy se muestra «En curso», sin semáforo", async () => {
    pintar(MisKpi);
    const carga = (
      await screen.findByText("Carga laboral (horas reales)", {
        selector: "h3",
      })
    ).closest("section");
    expect(within(carga).getByText("En curso")).toBeInTheDocument();
  });

  it("descarta lo que se apoya en «Sin historial suficiente» y habla de usted en su vista", async () => {
    servicio.insights.mockResolvedValue({
      ...(await servicioFalso().insights()),
      insights: [
        ...(await servicioFalso().insights()).insights,
        {
          id: "z",
          tone: "positive",
          hallazgo: "Ritmo muy estable",
          explicacion: "Consistencia alta.",
          evidencia: [
            {
              label: "Consistencia",
              before: "—",
              after: "Sin historial suficiente",
            },
          ],
          accion: null,
          confidence: { stars: 5, label: "Alta" },
        },
      ],
    });
    servicio.equilibrio.mockResolvedValue({
      ...(await servicioFalso().equilibrio()),
      meaning: "El colaborador presenta señales de desequilibrio.",
    });
    pintar(MisKpi);
    expect(
      await screen.findByText("Usted presenta señales de desequilibrio."),
    ).toBeInTheDocument();
    await screen.findAllByText("Cumplimiento por debajo del objetivo");
    expect(screen.queryByText("Ritmo muy estable")).toBeNull();
  });

  it("si la calidad del dato del equipo falla, lo dice con «Reintentar»", async () => {
    servicio.yo.mockResolvedValue(LIDER);
    servicio.calidadDelDato.mockRejectedValueOnce(
      errorApi(500, "Calidad no disponible."),
    );
    pintar(KpiEquipo);
    expect(
      await screen.findByText("Calidad no disponible."),
    ).toBeInTheDocument();
  });

  it("sin equipo y con solo riesgo: un único aviso, sin píldoras en cero", async () => {
    servicio.yo.mockResolvedValue({
      ...ME,
      permissions: ["kpi.acceder", "inteligencia_preventiva.ver"],
    });
    servicio.riesgoDelEquipo.mockResolvedValue({
      members: [],
      summary: { bajo: 0, medio: 0, alto: 0, critico: 0 },
    });
    pintar(KpiEquipo);
    expect(
      await screen.findByText(
        /No tiene personas a cargo \(según el organigrama\)/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/en riesgo bajo/)).toBeNull();
    expect(servicio.recomendacionesDelEquipo).not.toHaveBeenCalled();
  });

  it("el simulador de escenarios valida en su campo y sin valores precargados", async () => {
    servicio.yo.mockResolvedValue({
      ...ME,
      permissions: ["kpi.acceder", "inteligencia_preventiva.ver"],
    });
    pintar(InteligenciaPreventiva);
    const campo = await screen.findByLabelText(/^Horas adicionales \(HH\.MM\)/);
    expect(campo).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Simular impacto" }));
    expect(await screen.findByText("Complete este campo.")).toBeInTheDocument();
    await waitFor(() => expect(campo).toHaveFocus());
    expect(servicio.simular).not.toHaveBeenCalled();
  });
});
