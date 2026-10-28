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
 * Mantenimiento de sedes: el panel, el listado, la ficha y la reportería de
 * órdenes de trabajo. Lo que se protege es que cada pantalla diga el alcance
 * de quien mira y ofrezca solo los pasos que el servidor va a aceptar.
 */

const servicio = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  asignar: vi.fn(),
  cambiarEstado: vi.fn(),
  registrarMaterial: vi.fn(),
  registrarManoDeObra: vi.fn(),
  quitarCosto: vi.fn(),
  resumen: vi.fn(),
  reportes: vi.fn(),
  exportar: vi.fn(),
  catalogos: vi.fn(),
};
vi.mock("../src/api/ordenesService", () => ({ ordenesService: servicio }));

const { PanelOrdenes } = await import("../src/pages/Ordenes/PanelOrdenes");
const { OrdenesList } = await import("../src/pages/Ordenes/OrdenesList");
const { OrdenDetalle } = await import("../src/pages/Ordenes/OrdenDetalle");
const { OrdenForm } = await import("../src/pages/Ordenes/OrdenForm");
const { ReportesOrdenes } =
  await import("../src/pages/Ordenes/ReportesOrdenes");

const KPIS = {
  registradas: 12,
  abiertas: 7,
  vencidas: 1,
  cerradas: 5,
  costo_total: "7328.05",
  prioridad_alta: 6,
  pendientes_aprobacion: 1,
  con_observaciones: 1,
};

const ORDEN = {
  id: 118,
  numero: "OT-2026-000118",
  sede: {
    id: 1,
    nombre: "Quito · Matriz",
    ciudad: "Quito",
    region: "sierra",
    region_display: "Sierra",
    provincia: "Pichincha",
  },
  categoria: "electrico",
  categoria_display: "Eléctrico",
  prioridad: "critica",
  prioridad_display: "Crítica",
  estado: "en_ejecucion",
  estado_display: "En ejecución",
  titulo: "Sin luz en el área de cajas",
  solicitante: { id: 5, nombre: "Paola Ríos" },
  tecnico: { id: 3, nombre: "Jorge Andrade" },
  proveedor: null,
  responsable: "Jorge Andrade",
  fecha_programada: "2026-10-10",
  cumplimiento: "vencida",
  contacto: "•••••••273",
  total: "486.40",
  con_observaciones: false,
  created_at: "2026-10-09T10:00:00Z",
};

const CATALOGOS = {
  sedes: [ORDEN.sede],
  categorias: [{ valor: "electrico", etiqueta: "Eléctrico" }],
  prioridades: [{ valor: "critica", etiqueta: "Crítica" }],
  estados: [{ valor: "en_ejecucion", etiqueta: "En ejecución" }],
  regiones: [{ valor: "sierra", etiqueta: "Sierra" }],
  puede: {
    crear: false,
    gestionar: false,
    reportes: false,
    ver_todas: false,
    ver_contacto: false,
  },
  alcance: "Solo las órdenes asignadas a usted.",
};

function pintar(elemento, ruta = "/") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/admin/ordenes/lista/:id" element={elemento} />
        <Route path="*" element={elemento} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  servicio.catalogos.mockResolvedValue(CATALOGOS);
});

describe("El panel", () => {
  it("muestra los ocho indicadores, lo que requiere atención y el alcance", async () => {
    servicio.resumen.mockResolvedValue({
      kpis: KPIS,
      atencion: [ORDEN],
      actividad: [
        {
          id: 1,
          descripcion:
            "Cambió el estado de OT-2026-000118: Asignada → En ejecución",
          actor: "Marco Villacís",
          estado_nuevo: "en_ejecucion",
          created_at: "2026-10-11T01:58:00Z",
          orden: { id: 118, numero: ORDEN.numero },
        },
      ],
      alcance: "Todas las sedes de la empresa.",
    });
    pintar(<PanelOrdenes />);

    expect(
      await screen.findByText("Alcance: Todas las sedes de la empresa."),
    ).toBeInTheDocument();
    expect(screen.getByText("Órdenes registradas")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Con observaciones")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ORDEN.numero })).toHaveAttribute(
      "href",
      "/admin/ordenes/lista/118",
    );
    expect(screen.getByText("Vencida")).toBeInTheDocument();
    expect(screen.getByText(/Asignada → En ejecución/)).toBeInTheDocument();
  });
});

describe("El panel cuando falla", () => {
  it("conserva el título y deja reintentar sin recargar", async () => {
    /* Revisión final UX/UI, 28/10/2026: la carga se anuncia y el fallo
       ofrece reintento. */
    servicio.resumen.mockRejectedValueOnce(new Error("500"));
    pintar(<PanelOrdenes />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo cargar el panel.",
    );
    expect(
      screen.getByRole("heading", { name: "Panel de mantenimiento" }),
    ).toBeInTheDocument();

    servicio.resumen.mockResolvedValueOnce({
      kpis: KPIS,
      atencion: [],
      actividad: [],
      alcance: "Todas las sedes de la empresa.",
    });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Órdenes registradas")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("la ficha que no carga conserva la salida al listado y el reintento", async () => {
    servicio.get.mockRejectedValueOnce(new Error("500"));
    pintar(<OrdenDetalle />, "/admin/ordenes/lista/118");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo cargar la orden.",
    );
    expect(
      screen.getByRole("link", { name: "Volver al listado" }),
    ).toBeInTheDocument();

    servicio.get.mockResolvedValueOnce(detalle());
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByText("Sin luz en el área de cajas"),
    ).toBeInTheDocument();
  });
});

describe("El listado", () => {
  it("si los filtros no cargan, lo dice junto a ellos", async () => {
    servicio.catalogos.mockRejectedValue(new Error("500"));
    servicio.list.mockResolvedValue({
      results: [],
      count: 0,
      next: null,
      previous: null,
    });
    pintar(<OrdenesList />);

    expect(
      await screen.findByText(/No se pudieron cargar los filtros\./),
    ).toBeInTheDocument();
  });

  it("dice el alcance, enmascara el contacto y no ofrece crear sin permiso", async () => {
    servicio.list.mockResolvedValue({
      results: [ORDEN],
      count: 1,
      next: null,
      previous: null,
    });
    pintar(<OrdenesList />);

    expect(await screen.findByText(ORDEN.numero)).toBeInTheDocument();
    expect(screen.getByText("•••••••273")).toBeInTheDocument();
    await screen.findByText(/alcance: Solo las órdenes asignadas a usted/);
    expect(screen.queryByRole("link", { name: /Nueva orden/ })).toBeNull();
    expect(screen.getByText("Solo lectura")).toBeInTheDocument();
    expect(screen.getByText(/Teléfonos enmascarados/)).toBeInTheDocument();
  });

  it("con permiso de crear ofrece la nueva orden", async () => {
    servicio.catalogos.mockResolvedValue({
      ...CATALOGOS,
      puede: { ...CATALOGOS.puede, crear: true },
    });
    servicio.list.mockResolvedValue({
      results: [],
      count: 0,
      next: null,
      previous: null,
    });
    pintar(<OrdenesList />);

    expect(
      await screen.findByRole("link", { name: /Nueva orden/ }),
    ).toHaveAttribute("href", "/admin/ordenes/lista/nueva");
    expect(
      await screen.findByText("No hay órdenes abiertas en su alcance."),
    ).toBeInTheDocument();
  });
});

function detalle(extra = {}) {
  return {
    ...ORDEN,
    descripcion: "",
    telefono_contacto_editable: null,
    fecha_cierre: null,
    observaciones_cierre: "",
    materiales: [],
    mano_de_obra: [],
    movimientos: [
      {
        id: 1,
        descripcion: "Solicitó la orden OT-2026-000118",
        nota: "",
        actor: "Paola Ríos",
        created_at: "2026-10-09T10:00:00Z",
      },
    ],
    costos: {
      materiales: "0",
      mano_de_obra: "0",
      subtotal: "0.00",
      iva_porcentaje: 15,
      iva: "0.00",
      total: "0.00",
    },
    permisos: {
      editar: false,
      asignar: false,
      registrar_costos: true,
      acciones: ["pausada", "pendiente_aprobacion"],
    },
    ...extra,
  };
}

describe("La ficha", () => {
  it("ofrece solo los pasos permitidos y manda la nota al pausar", async () => {
    servicio.get.mockResolvedValue(detalle());
    servicio.cambiarEstado.mockResolvedValue(
      detalle({
        estado: "pausada",
        estado_display: "Pausada",
        permisos: { ...detalle().permisos, acciones: ["en_ejecucion"] },
      }),
    );
    pintar(<OrdenDetalle />, "/admin/ordenes/lista/118");

    await screen.findByText("Sin luz en el área de cajas");
    expect(screen.getByRole("button", { name: "Pausar" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enviar a aprobación" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Aceptar y cerrar" }),
    ).toBeNull();
    // Sin permiso de asignar, no hay tarjeta de asignación.
    expect(screen.queryByRole("heading", { name: "Asignar" })).toBeNull();

    fireEvent.change(screen.getByLabelText(/Nota \(obligatoria/), {
      target: { value: "Falta el repuesto." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pausar" }));

    await waitFor(() =>
      expect(servicio.cambiarEstado).toHaveBeenCalledWith(118, "pausada", {
        nota: "Falta el repuesto.",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Reanudar" }),
    ).toBeInTheDocument();
  });

  it("registra materiales y muestra el total con IVA", async () => {
    servicio.get.mockResolvedValue(detalle());
    servicio.registrarMaterial.mockResolvedValue(
      detalle({
        materiales: [
          {
            id: 9,
            descripcion: "Breaker 20 A",
            cantidad: "2.00",
            costo_unitario: "15.50",
            subtotal: "31.00",
          },
        ],
        costos: {
          materiales: "31",
          mano_de_obra: "0",
          subtotal: "31.00",
          iva_porcentaje: 15,
          iva: "4.65",
          total: "35.65",
        },
      }),
    );
    pintar(<OrdenDetalle />, "/admin/ordenes/lista/118");

    await screen.findByText("Sin luz en el área de cajas");
    fireEvent.change(screen.getByLabelText("Material"), {
      target: { value: "Breaker 20 A" },
    });
    fireEvent.change(screen.getByLabelText("Cantidad"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getAllByLabelText("Costo unitario")[0], {
      target: { value: "15.50" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Agregar" })[0]);

    await waitFor(() =>
      expect(servicio.registrarMaterial).toHaveBeenCalledWith(118, {
        descripcion: "Breaker 20 A",
        cantidad: "2",
        costo_unitario: "15.50",
      }),
    );
    expect(await screen.findByText("Breaker 20 A")).toBeInTheDocument();
    expect(screen.getByText("IVA (15 %)")).toBeInTheDocument();
  });

  it("quien coordina asigna técnico y proveedor", async () => {
    servicio.catalogos.mockResolvedValue({
      ...CATALOGOS,
      tecnicos: [{ id: 3, nombre: "Jorge Andrade" }],
      proveedores: [{ id: 2, nombre: "Climas del Sur" }],
    });
    servicio.get.mockResolvedValue(
      detalle({
        estado: "solicitada",
        estado_display: "Solicitada",
        tecnico: null,
        responsable: "Sin asignar",
        permisos: {
          editar: true,
          asignar: true,
          registrar_costos: true,
          acciones: [],
        },
      }),
    );
    servicio.asignar.mockResolvedValue(detalle());
    pintar(<OrdenDetalle />, "/admin/ordenes/lista/118");

    const tarjeta = (
      await screen.findByRole("heading", { name: "Asignar" })
    ).closest("section");
    fireEvent.change(within(tarjeta).getByLabelText("Técnico"), {
      target: { value: "3" },
    });
    fireEvent.change(
      within(tarjeta).getByLabelText("Proveedor (si es externo)"),
      { target: { value: "2" } },
    );
    fireEvent.click(within(tarjeta).getByRole("button", { name: "Asignar" }));

    await waitFor(() =>
      expect(servicio.asignar).toHaveBeenCalledWith(118, {
        tecnico: "3",
        proveedor: "2",
        fecha_programada: "2026-10-10",
        nota: "",
      }),
    );
  });
});

describe("La reportería", () => {
  it("pinta los gráficos y vuelve a calcular al filtrar", async () => {
    servicio.reportes.mockResolvedValue({
      kpis: KPIS,
      graficos: [
        {
          clave: "region",
          titulo: "Órdenes por región",
          filas: [
            { etiqueta: "Sierra", valor: 7 },
            { etiqueta: "Costa", valor: 4 },
          ],
        },
        {
          clave: "costo_categoria",
          titulo: "Costo por categoría",
          moneda: true,
          filas: [{ etiqueta: "Estructural", valor: "2860.00" }],
        },
      ],
    });
    pintar(<ReportesOrdenes />);

    expect(await screen.findByText("Órdenes por región")).toBeInTheDocument();
    const porRegion = screen.getByText("Órdenes por región").closest("section");
    expect(within(porRegion).getByText("Sierra")).toBeInTheDocument();
    expect(within(porRegion).getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Costo por categoría")).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText("Región"), {
      target: { value: "sierra" },
    });
    await waitFor(() =>
      expect(servicio.reportes).toHaveBeenLastCalledWith({
        periodo: "",
        region: "sierra",
        categoria: "",
      }),
    );
  });
});

describe("La nueva orden", () => {
  /* Antes los obligatorios no se marcaban y el único aviso era la burbuja
     del navegador (revisión final UX/UI, 28/10/2026). */
  it("marca los obligatorios y asocia la ayuda al campo", async () => {
    pintar(<OrdenForm />);

    await screen.findByRole("option", { name: /Quito · Matriz/ });
    expect(screen.getByText("Obligatorio")).toBeInTheDocument();
    for (const etiqueta of [/^Sede/, /^Categoría/, /^Qué hay que hacer/]) {
      expect(screen.getByLabelText(etiqueta)).toHaveAttribute(
        "aria-required",
        "true",
      );
      expect(screen.getByLabelText(etiqueta)).not.toHaveAttribute("required");
    }
    expect(screen.getByLabelText(/^Prioridad/)).not.toHaveAttribute(
      "aria-required",
    );
    expect(
      screen.getByLabelText(/^Teléfono de contacto/),
    ).toHaveAccessibleDescription(/Para que el técnico coordine la visita/);
  });

  it("si faltan, lo dice bajo cada campo y lleva el foco al primero", async () => {
    pintar(<OrdenForm />);

    await screen.findByRole("option", { name: /Quito · Matriz/ });
    fireEvent.click(screen.getByRole("button", { name: "Registrar orden" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "revise los campos marcados",
    );
    expect(servicio.create).not.toHaveBeenCalled();
    const sede = screen.getByLabelText(/^Sede/);
    expect(sede).toHaveAttribute("aria-invalid", "true");
    expect(sede).toHaveAccessibleDescription("Elija la sede.");
    expect(screen.getByText("Elija la categoría.")).toBeInTheDocument();
    expect(screen.getByText("Diga qué hay que hacer.")).toBeInTheDocument();
    await waitFor(() => expect(sede).toHaveFocus());

    // Al corregirlo, su error se va.
    fireEvent.change(sede, { target: { value: "1" } });
    expect(sede).not.toHaveAttribute("aria-invalid");
  });

  it("el error del servidor de un campo aparece bajo ese campo", async () => {
    servicio.create.mockRejectedValue({
      response: {
        data: {
          error: {
            message: "Error en la solicitud.",
            details: { titulo: ["Demasiado corto."] },
          },
        },
      },
    });
    pintar(<OrdenForm />);

    await screen.findByRole("option", { name: /Quito · Matriz/ });
    fireEvent.change(screen.getByLabelText(/^Sede/), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/^Categoría/), {
      target: { value: "electrico" },
    });
    fireEvent.change(screen.getByLabelText(/^Qué hay que hacer/), {
      target: { value: "Luz" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar orden" }));

    expect(await screen.findByText("Demasiado corto.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "revise los campos marcados",
    );
    const titulo = screen.getByLabelText(/^Qué hay que hacer/);
    expect(titulo).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(titulo).toHaveFocus());
  });

  it("si las sedes no cargan, lo dice junto al campo", async () => {
    servicio.catalogos.mockRejectedValue(new Error("500"));
    pintar(<OrdenForm />);

    expect(
      await screen.findByText("No se pudieron cargar las sedes."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Sede/)).toHaveAccessibleDescription(
      "No se pudieron cargar las sedes.",
    );
  });
});
