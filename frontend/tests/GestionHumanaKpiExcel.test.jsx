import {
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EJECUTIVO,
  EQUIPO,
  LIDER,
  ME,
  errorApi,
  kpi,
} from "./gestionHumanaKpiDatos";

/*
 * Descarga a Excel de Mis KPI, KPI del equipo y Resumen ejecutivo: la URL
 * (con el mes elegido), la descarga con `descargarBlob` y el nombre de
 * `Content-Disposition`, el estado «Descargando…», el error con
 * «Reintentar» y que el botón no aparezca sin permiso. Aquí el servicio es
 * el real; lo simulado es el cliente HTTP.
 */

const get = vi.fn();
vi.mock("../src/api/client", () => ({
  apiClient: { get: (...a) => get(...a) },
}));
const descargarBlob = vi.fn();
vi.mock("../src/utils/descargas", () => ({
  descargarBlob: (...a) => descargarBlob(...a),
}));
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, permissions: [] } }),
}));

// La pantalla pide muchas secciones a la vez: en la suite completa, con la
// máquina cargada, el primer `findBy` puede tardar más de 1 s.
configure({ asyncUtilTimeout: 5000 });

beforeAll(() => {
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

function pintar(Pantalla) {
  return render(
    <MemoryRouter>
      <ProveedorKpi>
        <Pantalla />
      </ProveedorKpi>
    </MemoryRouter>,
  );
}

const mesDe = (f) =>
  `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}`;
const hoy = new Date();
const MES = mesDe(hoy);
const MES_ANTERIOR = mesDe(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));
const BLOB = new Blob(["xlsx"]);

let yo;
let exportar;

beforeEach(() => {
  yo = ME;
  exportar = () =>
    Promise.resolve({
      data: BLOB,
      headers: {
        "content-disposition": `attachment; filename="mis-kpi-${MES}.xlsx"`,
      },
    });
  get.mockReset();
  descargarBlob.mockReset();
  get.mockImplementation((url) => {
    if (url === "/analytics/me/") return Promise.resolve({ data: yo });
    if (url.endsWith("/export/")) return exportar(url);
    if (url === "/analytics/kpis/me/") return Promise.resolve({ data: kpi() });
    if (url === "/analytics/kpis/team/")
      return Promise.resolve({ data: EQUIPO });
    if (url === "/analytics/kpis/executive/")
      return Promise.resolve({ data: EJECUTIVO });
    // El resto de las secciones no importa aquí.
    return Promise.reject(errorApi(500, "No disponible en esta prueba."));
  });
});

const llamadasDeExportacion = () =>
  get.mock.calls.filter(([url]) => url.endsWith("/export/"));

describe("Mis KPI a Excel", () => {
  it("pide el mes elegido como blob y lo guarda con el nombre del servidor", async () => {
    pintar(MisKpi);
    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar Excel/ }),
    );
    await waitFor(() => expect(descargarBlob).toHaveBeenCalledTimes(1));
    expect(llamadasDeExportacion()).toEqual([
      [
        "/analytics/kpis/me/export/",
        { params: { month: MES }, responseType: "blob" },
      ],
    ]);
    expect(descargarBlob).toHaveBeenCalledWith(BLOB, `mis-kpi-${MES}.xlsx`);
  });

  it("sin `Content-Disposition` usa el nombre de la tabla", async () => {
    exportar = () => Promise.resolve({ data: BLOB, headers: {} });
    pintar(MisKpi);
    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar Excel/ }),
    );
    await waitFor(() =>
      expect(descargarBlob).toHaveBeenCalledWith(BLOB, `mis-kpi-${MES}.xlsx`),
    );
  });

  it("mientras descarga queda `aria-disabled` (sin perder el foco) e ignora un segundo clic", async () => {
    let soltar;
    exportar = () =>
      new Promise((r) => {
        soltar = () => r({ data: BLOB, headers: {} });
      });
    pintar(MisKpi);
    const boton = await screen.findByRole("button", {
      name: /Descargar Excel/,
    });
    boton.focus();
    fireEvent.click(boton);
    fireEvent.click(boton);
    const ocupado = await screen.findByRole("button", { name: /Descargando…/ });
    expect(ocupado).toHaveAttribute("aria-disabled", "true");
    expect(ocupado).not.toBeDisabled();
    expect(ocupado).toHaveFocus();
    expect(ocupado.querySelector(".spinner-border")).not.toBeNull();
    expect(llamadasDeExportacion()).toHaveLength(1);
    soltar();
    expect(
      await screen.findByRole("button", { name: /Descargar Excel/ }),
    ).not.toHaveAttribute("aria-disabled");
  });

  it("ante un 404 o un 403 dice su propio mensaje y lleva el foco a «Reintentar»", async () => {
    let intentos = 0;
    exportar = () => {
      intentos += 1;
      return intentos === 1
        ? Promise.reject(errorApi(404, "No se encontró."))
        : Promise.resolve({ data: BLOB, headers: {} });
    };
    pintar(MisKpi);
    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar Excel/ }),
    );
    const texto = await screen.findByText(
      "No se pudo generar el Excel. Inténtelo de nuevo o avise a Soporte TI.",
    );
    const alerta = texto.closest('[role="alert"]');
    expect(alerta).toHaveClass("mz-alert--accion");
    expect(alerta.closest(".gk-excel")).not.toBeNull();
    const reintentar = within(alerta).getByRole("button", {
      name: "Reintentar",
    });
    expect(reintentar).toHaveClass("btn-outline-danger");
    await waitFor(() => expect(reintentar).toHaveFocus());
    expect(screen.queryByText(/ya no exista/)).toBeNull();
    fireEvent.click(reintentar);
    await waitFor(() => expect(descargarBlob).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText(
        "No se pudo generar el Excel. Inténtelo de nuevo o avise a Soporte TI.",
      ),
    ).toBeNull();
  });

  it("un 403 también da el mensaje propio", async () => {
    exportar = () => Promise.reject(errorApi(403, "No tiene permiso."));
    pintar(MisKpi);
    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar Excel/ }),
    );
    expect(
      await screen.findByText(
        "No se pudo generar el Excel. Inténtelo de nuevo o avise a Soporte TI.",
      ),
    ).toBeInTheDocument();
  });

  it("en otro mes, el aviso queda unido al botón con `aria-describedby`", async () => {
    pintar(MisKpi);
    await screen.findByRole("button", { name: /Descargar Excel/ });
    expect(screen.queryByText(/El Excel no incluye/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    const aviso = await screen.findByText(
      "El Excel no incluye la carga laboral de meses pasados.",
    );
    const boton = await screen.findByRole("button", {
      name: /Descargar Excel/,
    });
    expect(boton).toHaveAttribute("aria-describedby", aviso.id);
    expect(boton).toHaveAccessibleDescription(
      "El Excel no incluye la carga laboral de meses pasados.",
    );
    fireEvent.click(boton);
    await waitFor(() =>
      expect(llamadasDeExportacion()[0][1].params).toEqual({
        month: MES_ANTERIOR,
      }),
    );
  });

  it("va a la derecha, junto a las demás acciones de la barra del período", async () => {
    pintar(MisKpi);
    const boton = await screen.findByRole("button", {
      name: /Descargar Excel/,
    });
    const grupo = boton.closest(".gk-acciones");
    expect(grupo).toHaveClass("ms-auto");
    expect(grupo.closest(".gk-barra")).not.toBeNull();
    expect(
      within(grupo).getByRole("button", { name: /¿Qué pasaría si…\?/ }),
    ).toBeInTheDocument();
  });
});

describe("KPI del equipo a Excel", () => {
  it("con `kpi.equipo` descarga el mes elegido", async () => {
    yo = LIDER;
    exportar = () => Promise.resolve({ data: BLOB, headers: {} });
    pintar(KpiEquipo);
    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar Excel/ }),
    );
    await waitFor(() =>
      expect(descargarBlob).toHaveBeenCalledWith(
        BLOB,
        `kpi-equipo-${MES}.xlsx`,
      ),
    );
    expect(llamadasDeExportacion()[0]).toEqual([
      "/analytics/kpis/team/export/",
      { params: { month: MES }, responseType: "blob" },
    ]);
  });

  it("sin `kpi.equipo` (solo riesgo) no hay botón", async () => {
    yo = { ...ME, permissions: ["kpi.acceder", "inteligencia_preventiva.ver"] };
    pintar(KpiEquipo);
    await waitFor(() =>
      expect(get.mock.calls.some(([u]) => u.includes("operational-risk"))).toBe(
        true,
      ),
    );
    expect(
      screen.getByRole("heading", { name: "KPI del equipo" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Descargar Excel/ }),
    ).toBeNull();
  });
});

describe("Resumen ejecutivo a Excel", () => {
  it("con `kpi.ejecutivo` descarga sin mes", async () => {
    yo = LIDER;
    exportar = () => Promise.resolve({ data: BLOB, headers: {} });
    pintar(ResumenEjecutivo);
    const boton = await screen.findByRole("button", {
      name: /Descargar Excel/,
    });
    // En el encabezado, junto a «Modo ejecutivo».
    expect(boton.closest(".mz-view-actions")).not.toBeNull();
    fireEvent.click(boton);
    await waitFor(() =>
      expect(descargarBlob).toHaveBeenCalledWith(
        BLOB,
        "resumen-ejecutivo.xlsx",
      ),
    );
    expect(llamadasDeExportacion()[0]).toEqual([
      "/analytics/kpis/executive/export/",
      { params: {}, responseType: "blob" },
    ]);
  });

  it("sin `kpi.ejecutivo` no hay botón", async () => {
    yo = ME;
    pintar(ResumenEjecutivo);
    expect(
      await screen.findByText(/No tiene acceso a esta pantalla de Desempeño/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Descargar Excel/ }),
    ).toBeNull();
  });
});
