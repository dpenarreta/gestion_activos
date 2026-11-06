import { readFileSync } from "node:fs";
import path from "node:path";

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CIERRE_ANTICIPADO,
  LISTA_VACIA,
  ME_ADMIN,
  ME_GENERAR,
  ME_VER,
  detalle,
  errorApi,
  servicioFalso,
} from "./gestionHumanaInformesDatos";

/*
 * Informes ejecutivos de Gestión Humana: el menú por permisos, el listado
 * (permisos, vacío, filtros, error), el asistente de generación
 * (validaciones, vista previa, 422 sin colaboradores, errores por campo) y
 * el visor (las once páginas, la marca «sin IA», Excel, imprimir con su
 * evento de bitácora y lo que solo ve quien administra). Los servicios van
 * simulados.
 */

const servicio = servicioFalso();
vi.mock("../src/api/informesService", async (importOriginal) => ({
  ...(await importOriginal()),
  informesService: servicio,
}));
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, permissions: [] } }),
}));

const { MarcoInformes } =
  await import("../src/pages/GestionHumana/Informes/ContextoInformes");
const { Informes } =
  await import("../src/pages/GestionHumana/Informes/Informes");
const { VisorInforme } =
  await import("../src/pages/GestionHumana/Informes/VisorInforme");
const { getVisibleAdminMenu } =
  await import("../src/components/admin/AdminSidebar/staticAdminMenu");
const { mesDeHoy, validarPeriodo } =
  await import("../src/pages/GestionHumana/Informes/informesComunes");
const { sumarMeses } =
  await import("../src/pages/GestionHumana/Desempeno/kpiComunes");
// La hoja como texto: con `?raw` el CSS llega vacío (vitest no lo procesa).
const hojaDeInformes = readFileSync(
  path.resolve(__dirname, "../src/pages/GestionHumana/Informes/Informes.css"),
  "utf8",
);

const LISTADO = "/admin/gestion-humana/informes";
const VISOR = `${LISTADO}/NXR-20261001-ABC123`;

function pintar(ruta = LISTADO) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/admin/gestion-humana" element={<MarcoInformes />}>
          <Route path="informes" element={<Informes />} />
          <Route path="informes/:reportId" element={<VisorInforme />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function usar(me) {
  Object.assign(servicio, servicioFalso(me));
}

beforeEach(() => usar(ME_GENERAR));
afterEach(() => vi.restoreAllMocks());

// --- Menú ---------------------------------------------------------------------

const hojas = (items) =>
  items.flatMap((i) => [...(i.path ? [i] : []), ...hojas(i.children ?? [])]);
const entradas = (permisos) =>
  hojas(getVisibleAdminMenu(permisos, "gestion_humana")).map((i) => i.id);

describe("Informes ejecutivos en el menú", () => {
  it("aparece con informes_gh.ver, sin necesitar kpi.acceder", () => {
    expect(entradas(["informes_gh.ver"])).toContain("gh-informes");
    expect(entradas(["informes_gh.generar"])).toContain("gh-informes");
  });

  it("no aparece sin ningún permiso de informes", () => {
    expect(entradas(["kpi.acceder", "kpi.ejecutivo"])).not.toContain(
      "gh-informes",
    );
  });
});

// --- Listado ------------------------------------------------------------------

describe("Listado de informes", () => {
  it("con solo ver: lista los informes sin el botón de generar", async () => {
    usar(ME_VER);
    pintar();
    expect(
      await screen.findByRole("link", { name: "Octubre 2026" }),
    ).toHaveAttribute("href", VISOR);
    expect(screen.getByText("Julio – Septiembre 2026")).toBeInTheDocument();
    expect(screen.getByText("Integridad parcial")).toBeInTheDocument();
    expect(screen.getByText("Migrado de Nexo")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Generar informe/ }),
    ).not.toBeInTheDocument();
    // Las pestañas de administración no se ofrecen.
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(servicio.listar).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      tipo: "",
      estado: "",
    });
  });

  it("vacío con generar: invita a generar el primero", async () => {
    servicio.listar.mockResolvedValue(LISTA_VACIA);
    pintar();
    expect(
      await screen.findByText(/Todavía no hay informes\. Genere el primero/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generar un informe" }));
    expect(
      await screen.findByRole("dialog", { name: "Generar informe ejecutivo" }),
    ).toBeInTheDocument();
  });

  it("vacío con solo ver: explica que aún no hay informes que pueda abrir", async () => {
    usar(ME_VER);
    servicio.listar.mockResolvedValue(LISTA_VACIA);
    pintar();
    expect(
      await screen.findByText(/no hay informes que pueda abrir/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Generar un informe" }),
    ).not.toBeInTheDocument();
  });

  it("filtrar por tipo vuelve a pedir desde la primera página", async () => {
    pintar();
    await screen.findByRole("link", { name: "Octubre 2026" });
    fireEvent.change(
      screen.getByRole("combobox", { name: "Filtrar por tipo de informe" }),
      { target: { value: "RANGO_MESES" } },
    );
    await waitFor(() =>
      expect(servicio.listar).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        tipo: "RANGO_MESES",
        estado: "",
      }),
    );
  });

  it("un error se muestra con Reintentar", async () => {
    servicio.listar.mockRejectedValueOnce(errorApi(500, "Falló el servidor."));
    pintar();
    expect(await screen.findByText("Falló el servidor.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("link", { name: "Octubre 2026" }),
    ).toBeInTheDocument();
  });

  it("quien administra ve los incidentes de integridad de la empresa", async () => {
    usar(ME_ADMIN);
    pintar();
    fireEvent.click(
      await screen.findByRole("tab", { name: /Incidentes de integridad/ }),
    );
    expect(
      await screen.findByText("teamSummary.avgCumplimiento"),
    ).toBeInTheDocument();
    expect(servicio.incidentes).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      reportId: undefined,
    });
  });

  it("sin acceso (403 en me/) lo dice", async () => {
    servicio.yo.mockRejectedValue(
      errorApi(403, "No tiene permiso.", "permission_denied"),
    );
    pintar();
    expect(await screen.findByText("No tiene permiso.")).toBeInTheDocument();
  });
});

// --- Asistente ----------------------------------------------------------------

async function abrirAsistente() {
  pintar();
  fireEvent.click(
    await screen.findByRole("button", { name: /Generar informe/ }),
  );
  const ventana = await screen.findByRole("dialog", {
    name: "Generar informe ejecutivo",
  });
  // Espera a que cargue el equipo (las casillas de rol).
  await within(ventana).findByRole("checkbox", {
    name: "Analista Clima y Cultura",
  });
  return ventana;
}

const enviar = (ventana) =>
  fireEvent.click(
    within(ventana).getByRole("button", { name: /Generar informe/ }),
  );

describe("Asistente de generación", () => {
  it("valida el rango de meses antes de enviar", async () => {
    const ventana = await abrirAsistente();
    fireEvent.click(
      within(ventana).getByRole("radio", { name: /Rango de meses/ }),
    );
    const actual = mesDeHoy();
    fireEvent.change(within(ventana).getByLabelText("Desde (mes)"), {
      target: { value: actual },
    });
    fireEvent.change(within(ventana).getByLabelText("Hasta (mes)"), {
      target: { value: sumarMeses(actual, -1) },
    });
    enviar(ventana);
    expect(
      await within(ventana).findByText(
        "El mes de inicio debe ser anterior al de fin.",
      ),
    ).toBeInTheDocument();
    expect(within(ventana).getByLabelText("Desde (mes)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(servicio.generar).not.toHaveBeenCalled();
  });

  it("las reglas de período coinciden con las del servidor", () => {
    const ahora = new Date("2026-11-06T12:00:00-05:00");
    expect(validarPeriodo({ tipo: "MENSUAL", mes: "2026-12" }, ahora).mes).toBe(
      "Ese mes todavía no empieza.",
    );
    expect(
      validarPeriodo(
        { tipo: "RANGO_MESES", desdeMes: "2024-01", hastaMes: "2026-10" },
        ahora,
      ).hasta,
    ).toBe("El rango debe tener entre 2 y 24 meses.");
    expect(
      validarPeriodo(
        {
          tipo: "RANGO_PERSONALIZADO",
          desdeDia: "2025-01-01",
          hastaDia: "2026-01-10",
        },
        ahora,
      ).hasta,
    ).toBe("El rango no puede superar 366 días.");
    expect(
      validarPeriodo(
        { tipo: "MENSUAL", mes: "2026-10", fechaCorte: "2026-09-30" },
        ahora,
      ).fecha_corte,
    ).toMatch(/no puede ser anterior al inicio/);
    expect(validarPeriodo({ tipo: "MENSUAL", mes: "2026-10" }, ahora)).toEqual(
      {},
    );
  });

  it("muestra el cierre del mes y cuántas personas entran con los filtros", async () => {
    servicio.estadoDeCierre.mockResolvedValue(CIERRE_ANTICIPADO);
    servicio.roster.mockImplementation(async (filtros) =>
      filtros?.roles?.length
        ? {
            users: [],
            user_ids: [2, 4],
            scope: "COORDINADOR",
            roster_kind: "POR_AREA",
          }
        : (await import("./gestionHumanaInformesDatos")).ROSTER,
    );
    const ventana = await abrirAsistente();
    expect(
      await within(ventana).findByText(/cerrado anticipadamente/),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText(/Entrarán 3 personas/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(ventana).getByRole("checkbox", {
        name: "Analista Clima y Cultura",
      }),
    );
    expect(
      await within(ventana).findByText(
        /Entrarán 2 personas \(informe por área o rol\)/,
      ),
    ).toBeInTheDocument();
    expect(servicio.roster).toHaveBeenLastCalledWith({
      roles: ["ANALISTA_CC"],
      areas: [],
      colaboradores: [],
    });
  });

  it("422 sin colaboradores: lo explica y no cierra el asistente", async () => {
    servicio.generar.mockRejectedValue(
      errorApi(
        422,
        "No hay colaboradores en su alcance con esos filtros.",
        "roster_vacio",
      ),
    );
    const ventana = await abrirAsistente();
    enviar(ventana);
    expect(await within(ventana).findByRole("alert")).toHaveTextContent(
      "No hay colaboradores en su alcance con esos filtros.",
    );
    expect(
      screen.getByRole("dialog", { name: "Generar informe ejecutivo" }),
    ).toBeInTheDocument();
  });

  it("un 400 por campo marca ese campo", async () => {
    servicio.generar.mockRejectedValue(
      errorApi(400, "Ese mes todavía no empieza.", "invalid", {
        mes: ["Ese mes todavía no empieza."],
      }),
    );
    const ventana = await abrirAsistente();
    enviar(ventana);
    await waitFor(() =>
      expect(within(ventana).getByLabelText("Mes")).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    expect(
      within(ventana).getAllByText("Ese mes todavía no empieza.").length,
    ).toBeGreaterThan(0);
  });

  it("al generar abre el visor del informe nuevo", async () => {
    const ventana = await abrirAsistente();
    fireEvent.click(
      within(ventana).getByRole("checkbox", { name: /Marta Ríos/ }),
    );
    enviar(ventana);
    expect(
      await screen.findByText("Informe NXR-20261001-ABC123 generado."),
    ).toBeInTheDocument();
    const [cuerpo] = servicio.generar.mock.calls[0];
    expect(cuerpo).toEqual({
      tipo: "MENSUAL",
      mes: mesDeHoy(),
      roles: [],
      areas: [],
      colaboradores: [3],
    });
    expect(servicio.obtener).toHaveBeenCalledWith("NXR-20261001-ABC123");
  });
});

// --- Visor --------------------------------------------------------------------

describe("Visor del informe", () => {
  it("pinta las once páginas y rotula la narrativa sin IA", async () => {
    const { container } = pintar(VISOR);
    expect(
      await screen.findByRole("heading", { name: "Informe Mensual" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".ie-pagina")).toHaveLength(11);
    for (const titulo of [
      "Resumen ejecutivo (Executive Summary)",
      "Estado general del equipo",
      "Indicadores estratégicos",
      "Detalle por colaborador",
      "Distribución operativa",
      "Hallazgos ejecutivos (Executive Insights)",
      "Evaluación ejecutiva (Executive Assessment)",
      "Recomendaciones",
      "Analítica predictiva",
      "Metadatos",
    ])
      expect(screen.getByRole("heading", { name: titulo })).toBeInTheDocument();
    expect(
      screen.getAllByText("Narrativa sin IA (texto determinista)").length,
    ).toBe(3);
    expect(screen.getByText("Sin IA (texto determinista)")).toBeInTheDocument();
    expect(screen.getByText("Integridad completa")).toBeInTheDocument();
    // La calidad del dato, en la ficha de estado (no solo en los metadatos).
    const ficha = screen.getByRole("region", { name: "Estado del informe" });
    expect(within(ficha).getByText("88%")).toBeInTheDocument();
    expect(
      screen.getByText("1 problema de calidad del dato"),
    ).toBeInTheDocument();
    // Las tablas tienen encabezados de columna y de fila.
    const detalleTabla = screen.getByRole("table", {
      name: "Indicadores de cada colaborador del informe",
    });
    expect(
      within(detalleTabla).getByRole("columnheader", { name: "Carga" }),
    ).toBeInTheDocument();
    expect(
      within(detalleTabla).getByRole("rowheader", { name: "Luis" }),
    ).toBeInTheDocument();
  });

  it("con narrativa de IA no muestra la marca «sin IA»", async () => {
    servicio.obtener.mockResolvedValue(
      detalle({ data: { novaOrigen: "NOVA" }, nova: { a: 1 } }),
    );
    pintar(VISOR);
    expect(
      await screen.findByRole("heading", {
        name: "Evaluación ejecutiva (Executive Assessment by NOVA)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Narrativa sin IA (texto determinista)"),
    ).not.toBeInTheDocument();
  });

  it("imprimir abre el diálogo del navegador y registra el evento PDF", async () => {
    const imprimir = vi.spyOn(window, "print").mockImplementation(() => {});
    pintar(VISOR);
    fireEvent.click(
      await screen.findByRole("button", { name: /Imprimir \/ Guardar PDF/ }),
    );
    await waitFor(() => expect(imprimir).toHaveBeenCalledTimes(1));
    expect(servicio.registrarPdf).toHaveBeenCalledWith("NXR-20261001-ABC123");
  });

  it("si el registro del evento falla, igual imprime", async () => {
    const imprimir = vi.spyOn(window, "print").mockImplementation(() => {});
    servicio.registrarPdf.mockRejectedValue(errorApi(500, "Falló."));
    pintar(VISOR);
    fireEvent.click(
      await screen.findByRole("button", { name: /Imprimir \/ Guardar PDF/ }),
    );
    await waitFor(() => expect(imprimir).toHaveBeenCalledTimes(1));
  });

  it("descarga el Excel del informe", async () => {
    pintar(VISOR);
    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar Excel/ }),
    );
    await waitFor(() =>
      expect(servicio.exportarExcel).toHaveBeenCalledWith(
        "NXR-20261001-ABC123",
      ),
    );
  });

  it("sin administrar no hay bitácora ni incidentes", async () => {
    usar(ME_VER);
    pintar(VISOR);
    await screen.findByRole("heading", { name: "Informe Mensual" });
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(servicio.bitacora).not.toHaveBeenCalled();
  });

  it("quien administra ve la bitácora y los incidentes del informe", async () => {
    usar(ME_ADMIN);
    pintar(VISOR);
    fireEvent.click(await screen.findByRole("tab", { name: /Bitácora/ }));
    expect(
      await screen.findByRole("rowheader", { name: "Generado" }),
    ).toBeInTheDocument();
    expect(servicio.bitacora).toHaveBeenCalledWith("NXR-20261001-ABC123");
    fireEvent.click(
      screen.getByRole("tab", { name: /Incidentes de integridad/ }),
    );
    await waitFor(() =>
      expect(servicio.incidentes).toHaveBeenCalledWith({
        page: 1,
        pageSize: 20,
        reportId: "NXR-20261001-ABC123",
      }),
    );
  });

  it("un informe que no existe o no se puede ver (404)", async () => {
    servicio.obtener.mockRejectedValue(
      errorApi(404, "Informe no encontrado.", "not_found"),
    );
    pintar(VISOR);
    expect(
      await screen.findByText(/No se encontró el informe NXR-20261001-ABC123/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Volver a los informes/ }),
    ).toHaveAttribute("href", LISTADO);
  });
});

// --- Impresión ----------------------------------------------------------------

/** El cuerpo de la primera regla `selector { … }` que aparece después de
 * `desde` en la hoja. */
function regla(hoja, desde, selector) {
  const inicio = hoja.indexOf(desde);
  expect(inicio).toBeGreaterThan(-1);
  const pos = hoja.indexOf(`${selector} {`, inicio);
  expect(pos).toBeGreaterThan(-1);
  return hoja.slice(pos, hoja.indexOf("}", pos));
}

describe("Hoja de impresión", () => {
  it("con tema oscuro fija tinta, títulos y enlaces claros sin pasar por --color-*", () => {
    // jsdom no aplica @media print: se revisa la hoja misma. Con el tema
    // oscuro, `--color-text` vale #dee2e6 y dejaba el PDF ilegible.
    for (const [desde, selector] of [
      ["@media print {", ':root[data-theme="dark"] .ie-doc'],
      [
        "@media print and (prefers-color-scheme: dark)",
        ':root:not([data-theme="light"]) .ie-doc',
      ],
    ]) {
      const cuerpo = regla(hojaDeInformes, desde, selector);
      expect(cuerpo).toContain("--mz-ink: #0f2138");
      expect(cuerpo).toContain("--mz-heading: #0f2138");
      expect(cuerpo).toContain("--mz-link: #1c5da3");
      expect(cuerpo).not.toContain("var(--color-");
    }
  });

  it("las tablas solo se apilan en pantalla, nunca al imprimir", () => {
    expect(hojaDeInformes).toContain("@media screen and (max-width: 880px)");
    expect(hojaDeInformes).not.toMatch(/@media \(max-width: 880px\)/);
  });
});

describe("Avisos de confianza en el documento", () => {
  it("integridad parcial y migrado de Nexo salen en la portada y en metadatos", async () => {
    servicio.obtener.mockResolvedValue(
      detalle({ integrity_flag: "PARTIAL", origin: "LEGACY_MIGRATION" }),
    );
    pintar(VISOR);
    const documento = await screen.findByRole("article", {
      name: "Informe NXR-20261001-ABC123",
    });
    expect(
      within(documento).getByText("Integridad parcial"),
    ).toBeInTheDocument();
    // En el aviso de la portada y en la fila «Origen» de los metadatos.
    expect(within(documento).getAllByText("Migrado de Nexo")).toHaveLength(2);
    const metadatos = within(documento).getByRole("table", {
      name: "Metadatos del informe",
    });
    expect(
      within(metadatos).getByRole("row", { name: /Integridad Parcial/ }),
    ).toBeInTheDocument();
    expect(
      within(metadatos).getByRole("row", { name: /Origen Migrado de Nexo/ }),
    ).toBeInTheDocument();
  });

  it("un informe completo y generado no lleva avisos en la portada", async () => {
    pintar(VISOR);
    const documento = await screen.findByRole("article", {
      name: "Informe NXR-20261001-ABC123",
    });
    expect(
      within(documento).queryByText("Integridad parcial"),
    ).not.toBeInTheDocument();
    expect(
      within(documento).getByRole("row", {
        name: /Origen Generado en la intranet/,
      }),
    ).toBeInTheDocument();
  });

  it("la pestaña lleva el título del informe", async () => {
    pintar(VISOR);
    await screen.findByRole("heading", {
      name: "Informe ejecutivo · Octubre 2026",
    });
    expect(document.title).toContain("Informe ejecutivo · Octubre 2026");
  });
});

describe("Asistente: envío en curso y vista previa vacía", () => {
  it("mientras genera no se puede cerrar", async () => {
    servicio.generar.mockReturnValue(new Promise(() => {}));
    const ventana = await abrirAsistente();
    enviar(ventana);
    expect(
      await within(ventana).findByRole("button", { name: /Generando/ }),
    ).toBeDisabled();
    const cerrar = within(ventana).getByRole("button", {
      name: "Cerrar ventana",
    });
    expect(cerrar).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(cerrar);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.getByRole("dialog", { name: "Generar informe ejecutivo" }),
    ).toBeInTheDocument();
  });

  it("si con los filtros no entra nadie, no deja generar y dice por qué", async () => {
    servicio.roster.mockImplementation(async (filtros) =>
      filtros?.roles?.length
        ? {
            users: [],
            user_ids: [],
            scope: "COORDINADOR",
            roster_kind: "POR_AREA",
          }
        : (await import("./gestionHumanaInformesDatos")).ROSTER,
    );
    const ventana = await abrirAsistente();
    fireEvent.click(
      within(ventana).getByRole("checkbox", {
        name: "Asistente de Gestión Humana",
      }),
    );
    const aviso = await within(ventana).findByText(/no entra nadie/);
    const boton = within(ventana).getByRole("button", {
      name: /Generar informe/,
    });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAccessibleDescription(
      expect.stringContaining("no entra nadie"),
    );
    expect(aviso).toBeInTheDocument();
  });
});
