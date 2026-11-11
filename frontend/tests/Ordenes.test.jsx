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
  responsables: vi.fn(),
  registrarProveedor: vi.fn(),
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

/** aaaa-mm-dd de hoy en hora local, como las pantallas. */
function hoy() {
  const fecha = new Date();
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
}

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

  /* QA-FUNC B-1 (US-006, 11/11/2026): con responsable, el bloque reasigna,
     admite solo proveedor y deja cambiar solo la fecha. */
  it("reprogramar envía solo la fecha", async () => {
    servicio.catalogos.mockResolvedValue({
      ...CATALOGOS,
      tecnicos: [{ id: 3, nombre: "Jorge Andrade" }],
      proveedores: [{ id: 2, nombre: "Climas del Sur" }],
    });
    servicio.get.mockResolvedValue(
      detalle({
        estado: "programada",
        estado_display: "Programada",
        tecnico: null,
        proveedor: { id: 2, nombre: "Climas del Sur" },
        responsable: "Climas del Sur",
        permisos: {
          editar: true,
          asignar: true,
          registrar_costos: true,
          acciones: [],
        },
      }),
    );
    // Lo que devuelve el servidor sigue siendo la misma orden, reasignable.
    servicio.asignar.mockImplementation(() => servicio.get());
    pintar(<OrdenDetalle />, "/admin/ordenes/lista/118");

    const tarjeta = (
      await screen.findByRole("heading", { name: "Reasignar" })
    ).closest("section");
    const tecnico = within(tarjeta).getByLabelText(/^Técnico/);
    // El responsable puede ser solo un proveedor.
    expect(tecnico).toHaveValue("");
    const fecha = within(tarjeta).getByLabelText(/^Fecha programada/);
    expect(fecha).not.toHaveAttribute("min");
    expect(fecha).toHaveAccessibleDescription(
      "El día en que debe cumplirse: hoy o después.",
    );
    fireEvent.change(fecha, { target: { value: "2099-12-01" } });
    expect(fecha).toHaveAttribute("min", hoy());
    fireEvent.change(within(tarjeta).getByLabelText(/^Nota/), {
      target: { value: "Llega el repuesto" },
    });
    fireEvent.click(within(tarjeta).getByRole("button", { name: "Reasignar" }));

    await waitFor(() =>
      expect(servicio.asignar).toHaveBeenCalledWith(118, {
        fecha_programada: "2099-12-01",
        nota: "Llega el repuesto",
      }),
    );
    expect(await screen.findByText("Orden reprogramada.")).toBeInTheDocument();
    // La nota ya se guardó: no se queda para la siguiente.
    expect(within(await bloque()).getByLabelText(/^Nota/)).toHaveValue("");
  });

  /* Contrato de `asignar` (US-006, 11/11/2026): lo omitido se conserva y
     `null` lo quita. */
  function ordenConAmbos() {
    servicio.catalogos.mockResolvedValue({
      ...CATALOGOS,
      tecnicos: [
        { id: 3, nombre: "Jorge Andrade" },
        { id: 4, nombre: "Lucía Mora" },
      ],
      proveedores: [{ id: 2, nombre: "Climas del Sur" }],
    });
    servicio.get.mockResolvedValue(
      detalle({
        estado: "programada",
        estado_display: "Programada",
        proveedor: { id: 2, nombre: "Climas del Sur" },
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
  }

  async function bloque() {
    return (await screen.findByRole("heading", { name: "Reasignar" })).closest(
      "section",
    );
  }

  it("reasignar a otra persona sin tocar el proveedor no lo envía", async () => {
    ordenConAmbos();
    const tarjeta = await bloque();
    fireEvent.change(within(tarjeta).getByLabelText(/^Técnico/), {
      target: { value: "4" },
    });
    fireEvent.click(within(tarjeta).getByRole("button", { name: "Reasignar" }));

    await waitFor(() =>
      expect(servicio.asignar).toHaveBeenCalledWith(118, { tecnico: 4 }),
    );
  });

  it("vaciar el proveedor envía null", async () => {
    ordenConAmbos();
    const tarjeta = await bloque();
    fireEvent.change(within(tarjeta).getByLabelText("Proveedor (opcional)"), {
      target: { value: "" },
    });
    fireEvent.click(within(tarjeta).getByRole("button", { name: "Reasignar" }));

    await waitFor(() =>
      expect(servicio.asignar).toHaveBeenCalledWith(118, { proveedor: null }),
    );
  });

  it("sin cambios no envía y lo dice en el bloque", async () => {
    ordenConAmbos();
    const tarjeta = await bloque();
    fireEvent.click(within(tarjeta).getByRole("button", { name: "Reasignar" }));

    expect(within(tarjeta).getByRole("alert")).toHaveTextContent(
      "No cambió nada",
    );
    expect(servicio.asignar).not.toHaveBeenCalled();
  });

  /* El servidor no quita la fecha con null: vaciarla pide una, con el
     mensaje del alta (QA-UX, ronda 2). */
  it("vaciar una fecha que existía lo dice junto al campo y no envía", async () => {
    ordenConAmbos();
    const tarjeta = await bloque();
    const fecha = within(tarjeta).getByLabelText(/^Fecha programada/);
    fireEvent.change(fecha, { target: { value: "" } });
    fireEvent.click(within(tarjeta).getByRole("button", { name: "Reasignar" }));

    expect(fecha).toHaveAccessibleDescription(
      /Indique la fecha en que debe cumplirse la orden\./,
    );
    await waitFor(() => expect(fecha).toHaveFocus());
    expect(servicio.asignar).not.toHaveBeenCalled();
  });

  it("una fecha pasada no se envía al reprogramar", async () => {
    ordenConAmbos();
    const tarjeta = await bloque();
    const fecha = within(tarjeta).getByLabelText(/^Fecha programada/);
    fireEvent.change(fecha, { target: { value: "2020-01-01" } });
    fireEvent.click(within(tarjeta).getByRole("button", { name: "Reasignar" }));

    expect(fecha).toHaveAccessibleDescription(
      /La fecha programada no puede ser anterior a hoy\./,
    );
    expect(fecha).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(fecha).toHaveFocus());
    expect(servicio.asignar).not.toHaveBeenCalled();
  });

  it("si los técnicos no cargan, la tarjeta lo dice y deja reintentar", async () => {
    // Antes de pintar: la primera carga falla, el reintento funciona.
    servicio.catalogos.mockRejectedValueOnce(new Error("500"));
    ordenConAmbos();

    const tarjeta = await bloque();
    expect(await within(tarjeta).findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar los técnicos y proveedores.",
    );
    fireEvent.click(
      within(tarjeta).getByRole("button", { name: "Reintentar" }),
    );

    const tarjetaLista = await bloque();
    expect(
      await within(tarjetaLista).findByRole("option", { name: "Lucía Mora" }),
    ).toBeInTheDocument();
    expect(servicio.catalogos).toHaveBeenCalledTimes(2);
  });

  it("el 400 de `responsable` aparece junto al bloque y el de la fecha bajo su campo", async () => {
    ordenConAmbos();
    servicio.asignar.mockRejectedValue({
      response: {
        data: {
          error: {
            code: "validation_error",
            message: "Error en la solicitud.",
            details: {
              responsable: [
                "Indique el proveedor o la persona que realizará la orden.",
              ],
              fecha_programada: [
                "La fecha programada no puede ser anterior a hoy.",
              ],
            },
          },
        },
      },
    });
    const tarjeta = await bloque();
    fireEvent.change(within(tarjeta).getByLabelText(/^Técnico/), {
      target: { value: "4" },
    });
    fireEvent.click(within(tarjeta).getByRole("button", { name: "Reasignar" }));

    expect(await within(tarjeta).findByRole("alert")).toHaveTextContent(
      "Indique el proveedor o la persona que realizará la orden.",
    );
    const fecha = within(tarjeta).getByLabelText(/^Fecha programada/);
    expect(fecha).toHaveAttribute("aria-invalid", "true");
    expect(fecha).toHaveAccessibleDescription(
      /La fecha programada no puede ser anterior a hoy\./,
    );
    // El foco va al primer campo con error.
    await waitFor(() => expect(fecha).toHaveFocus());
  });

  it("sin técnico ni proveedor lo dice junto al técnico y no envía", async () => {
    servicio.catalogos.mockResolvedValue({
      ...CATALOGOS,
      tecnicos: [{ id: 3, nombre: "Jorge Andrade" }],
      proveedores: [{ id: 2, nombre: "Climas del Sur" }],
    });
    servicio.get.mockResolvedValue(
      detalle({
        estado: "programada",
        estado_display: "Programada",
        permisos: {
          editar: true,
          asignar: true,
          registrar_costos: true,
          acciones: [],
        },
      }),
    );
    pintar(<OrdenDetalle />, "/admin/ordenes/lista/118");

    const tarjeta = (
      await screen.findByRole("heading", { name: "Reasignar" })
    ).closest("section");
    const tecnico = within(tarjeta).getByLabelText(/^Técnico/);
    expect(tecnico).not.toBeRequired();
    fireEvent.change(tecnico, { target: { value: "" } });
    fireEvent.click(within(tarjeta).getByRole("button", { name: "Reasignar" }));

    expect(tecnico).toHaveAccessibleDescription(
      /Indique el técnico o el proveedor que realizará la orden\./,
    );
    await waitFor(() => expect(tecnico).toHaveFocus());
    expect(servicio.asignar).not.toHaveBeenCalled();

    // Con un proveedor, el error se va.
    fireEvent.change(within(tarjeta).getByLabelText("Proveedor (opcional)"), {
      target: { value: "2" },
    });
    expect(tecnico).not.toHaveAttribute("aria-invalid");
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
    fireEvent.change(within(tarjeta).getByLabelText("Proveedor (opcional)"), {
      target: { value: "2" },
    });
    fireEvent.click(within(tarjeta).getByRole("button", { name: "Asignar" }));

    await waitFor(() =>
      expect(servicio.asignar).toHaveBeenCalledWith(118, {
        tecnico: 3,
        proveedor: 2,
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
  const RESPONSABLES = {
    proveedores: [{ id: 7, nombre: "Electro Andes S.A." }],
    personas: [
      {
        id: 3,
        nombre: "Jorge Andrade",
        proveedor: { id: 7, nombre: "Electro Andes S.A." },
      },
      { id: 4, nombre: "Lucía Mora", proveedor: null },
    ],
  };

  /** aaaa-mm-dd de hoy más `dias`, en hora local como la pantalla. */
  function dia(dias = 0) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + dias);
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
  }

  async function llenarDatos() {
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
  }

  function campoResponsable() {
    return screen.getByRole("combobox", { name: /^Quién la realiza/ });
  }

  async function buscarYElegir(texto, nombre) {
    fireEvent.change(campoResponsable(), { target: { value: texto } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: nombre }));
  }

  beforeEach(() => {
    servicio.responsables.mockResolvedValue(RESPONSABLES);
  });

  /* Antes los obligatorios no se marcaban y el único aviso era la burbuja
     del navegador (revisión final UX/UI, 28/10/2026). */
  it("marca los obligatorios y asocia la ayuda al campo", async () => {
    pintar(<OrdenForm />);

    await screen.findByRole("option", { name: /Quito · Matriz/ });
    expect(screen.getByText("Obligatorio")).toBeInTheDocument();
    for (const etiqueta of [
      /^Sede/,
      /^Categoría/,
      /^Qué hay que hacer/,
      /^Quién la realiza/,
      /^Fecha programada/,
    ]) {
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
      screen.getByLabelText(/^Teléfono de quien reporta/),
    ).toHaveAccessibleDescription(/Para que el técnico coordine la visita/);
    // La fecha no deja elegir un día pasado en el calendario.
    expect(screen.getByLabelText(/^Fecha programada/)).toHaveAttribute(
      "min",
      dia(0),
    );
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

  /* US-006, CA-1 y CA-4: sin quién la realiza ni fecha, no se envía. */
  it("sin responsable ni fecha no envía y lo dice junto a cada campo", async () => {
    pintar(<OrdenForm />);
    await llenarDatos();

    fireEvent.click(screen.getByRole("button", { name: "Registrar orden" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "revise los campos marcados",
    );
    expect(servicio.create).not.toHaveBeenCalled();
    const responsable = campoResponsable();
    expect(responsable).toHaveAttribute("aria-invalid", "true");
    expect(responsable).toHaveAccessibleDescription(
      /Indique el proveedor o la persona que realizará la orden\./,
    );
    expect(
      screen.getByLabelText(/^Fecha programada/),
    ).toHaveAccessibleDescription(
      /Indique la fecha en que debe cumplirse la orden\./,
    );
    await waitFor(() => expect(responsable).toHaveFocus());
  });

  it("una fecha pasada no se envía", async () => {
    servicio.responsables.mockResolvedValue(RESPONSABLES);
    pintar(<OrdenForm />);
    await llenarDatos();
    await buscarYElegir("electro", "Electro Andes S.A.");
    const fecha = screen.getByLabelText(/^Fecha programada/);
    fireEvent.change(fecha, { target: { value: dia(-1) } });

    fireEvent.click(screen.getByRole("button", { name: "Registrar orden" }));

    expect(
      await screen.findByText(
        "La fecha programada no puede ser anterior a hoy.",
      ),
    ).toBeInTheDocument();
    expect(servicio.create).not.toHaveBeenCalled();
    await waitFor(() => expect(fecha).toHaveFocus());
  });

  /* US-006, CA-2. */
  it("busca y muestra proveedores y personas en dos grupos", async () => {
    pintar(<OrdenForm />);
    await screen.findByRole("option", { name: /Quito · Matriz/ });

    fireEvent.change(campoResponsable(), { target: { value: "and" } });

    const lista = await screen.findByRole("listbox", {
      name: /Quién la realiza/,
    });
    await waitFor(() =>
      expect(servicio.responsables).toHaveBeenLastCalledWith("and"),
    );
    const proveedores = within(lista).getByRole("group", {
      name: "Proveedores",
    });
    const personas = within(lista).getByRole("group", { name: "Personas" });
    expect(
      within(proveedores).getByRole("option", { name: "Electro Andes S.A." }),
    ).toBeInTheDocument();
    expect(
      within(personas).getByRole("option", { name: /Jorge Andrade/ }),
    ).toBeInTheDocument();
    expect(
      within(personas).getByRole("option", { name: /Lucía Mora/ }),
    ).toBeInTheDocument();
    expect(campoResponsable()).toHaveAttribute("aria-expanded", "true");

    // Con el teclado: ↓ marca la primera y Enter la elige sin enviar.
    fireEvent.keyDown(campoResponsable(), { key: "ArrowDown" });
    expect(campoResponsable()).toHaveAttribute(
      "aria-activedescendant",
      expect.stringContaining("opcion-0"),
    );
    fireEvent.keyDown(campoResponsable(), { key: "Enter" });
    expect(campoResponsable()).toHaveValue("Electro Andes S.A.");
    expect(servicio.create).not.toHaveBeenCalled();
    // Elegido un proveedor, no hay campo de proveedor aparte.
    expect(screen.queryByLabelText(/^Proveedor \(opcional\)/)).toBeNull();
  });

  it("si nada coincide, lo dice y ofrece registrar un proveedor", async () => {
    servicio.responsables.mockResolvedValue({ proveedores: [], personas: [] });
    pintar(<OrdenForm />);
    await screen.findByRole("option", { name: /Quito · Matriz/ });

    fireEvent.change(campoResponsable(), { target: { value: "zzz" } });

    expect(
      await screen.findAllByText(
        "Ningún proveedor ni persona coincide con «zzz». Puede registrar un proveedor nuevo.",
      ),
    ).not.toHaveLength(0);
    expect(
      screen.getByRole("button", { name: /Registrar proveedor nuevo/ }),
    ).toBeInTheDocument();
  });

  /* El proveedor de una persona es una aproximación: se propone y se puede
     quitar (US-006, decisión del Tech Lead, 11/11/2026). */
  it("al elegir una persona propone su proveedor y se puede quitar", async () => {
    servicio.create.mockResolvedValue({ id: 200 });
    pintar(<OrdenForm />);
    await llenarDatos();

    await buscarYElegir("jor", /Jorge Andrade/);

    const proveedor = screen.getByRole("combobox", {
      name: /^Proveedor \(opcional\)/,
    });
    expect(proveedor).toHaveValue("Electro Andes S.A.");
    expect(proveedor).toHaveAccessibleDescription(/Propuesto: Electro Andes/);
    fireEvent.click(
      screen.getByRole("button", { name: "Quitar el proveedor" }),
    );
    expect(proveedor).toHaveValue("");
    expect(proveedor).toHaveFocus();

    fireEvent.change(screen.getByLabelText(/^Fecha programada/), {
      target: { value: dia(0) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar orden" }));

    await waitFor(() =>
      expect(servicio.create).toHaveBeenCalledWith(
        expect.objectContaining({ tecnico: 3, proveedor: null }),
      ),
    );
  });

  it("envía el responsable, el proveedor y la fecha", async () => {
    servicio.create.mockResolvedValue({ id: 200 });
    pintar(<OrdenForm />);
    await llenarDatos();
    await buscarYElegir("jor", /Jorge Andrade/);
    fireEvent.change(screen.getByLabelText(/^Fecha programada/), {
      target: { value: dia(3) },
    });

    fireEvent.click(screen.getByRole("button", { name: "Registrar orden" }));

    await waitFor(() =>
      expect(servicio.create).toHaveBeenCalledWith({
        sede: "1",
        categoria: "electrico",
        prioridad: "media",
        titulo: "Luz",
        descripcion: "",
        telefono_contacto: "",
        fecha_programada: dia(3),
        tecnico: 3,
        proveedor: 7,
      }),
    );
  });

  /* US-006, CA-3. */
  it("registra un proveedor nuevo y queda elegido", async () => {
    servicio.registrarProveedor.mockResolvedValue({
      id: 9,
      nombre: "Pedro Gómez",
    });
    servicio.create.mockResolvedValue({ id: 201 });
    pintar(<OrdenForm />);
    await llenarDatos();

    fireEvent.click(
      screen.getByRole("button", { name: /Registrar proveedor nuevo/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Registrar proveedor nuevo",
    });

    // Sin nombre ni contacto no se envía.
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Registrar y elegir" }),
    );
    expect(
      await within(ventana).findByText("Escriba el nombre o la razón social."),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByLabelText(/^Teléfono/),
    ).toHaveAccessibleDescription(
      /Indique un teléfono o un correo para contactarlo\./,
    );
    expect(servicio.registrarProveedor).not.toHaveBeenCalled();

    fireEvent.change(within(ventana).getByLabelText(/^Nombre o razón social/), {
      target: { value: "Pedro Gómez" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Teléfono/), {
      target: { value: "0991234567" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Registrar y elegir" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(servicio.registrarProveedor).toHaveBeenCalledWith({
      nombre: "Pedro Gómez",
      telefono: "0991234567",
      correo: "",
      contacto: "",
      identificacion: "",
    });
    expect(campoResponsable()).toHaveValue("Pedro Gómez");

    fireEvent.change(screen.getByLabelText(/^Fecha programada/), {
      target: { value: dia(1) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar orden" }));
    await waitFor(() =>
      expect(servicio.create).toHaveBeenCalledWith(
        expect.objectContaining({ tecnico: null, proveedor: 9 }),
      ),
    );
  });

  it("si el proveedor ya existe, lo dice junto al nombre", async () => {
    servicio.registrarProveedor.mockRejectedValue({
      response: {
        data: {
          error: {
            code: "validation_error",
            message: "Error en la solicitud.",
            details: {
              nombre: [
                "Ya existe un proveedor llamado «Electro Andes S.A.»: búsquelo y elíjalo.",
              ],
            },
          },
        },
      },
    });
    pintar(<OrdenForm />);
    await screen.findByRole("option", { name: /Quito · Matriz/ });

    fireEvent.click(
      screen.getByRole("button", { name: /Registrar proveedor nuevo/ }),
    );
    const ventana = await screen.findByRole("dialog");
    const nombre = within(ventana).getByLabelText(/^Nombre o razón social/);
    fireEvent.change(nombre, { target: { value: "electro andes s.a." } });
    fireEvent.change(within(ventana).getByLabelText(/^Correo/), {
      target: { value: "ventas@electroandes.ec" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Registrar y elegir" }),
    );

    await waitFor(() =>
      expect(nombre).toHaveAccessibleDescription(
        /Ya existe un proveedor llamado «Electro Andes S.A.»/,
      ),
    );
    expect(nombre).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(nombre).toHaveFocus());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(campoResponsable()).toHaveValue("");
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
    await llenarDatos();
    await buscarYElegir("electro", "Electro Andes S.A.");
    fireEvent.change(screen.getByLabelText(/^Fecha programada/), {
      target: { value: dia(0) },
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

  it("el 400 de `responsable` aparece junto a «Quién la realiza»", async () => {
    servicio.create.mockRejectedValue({
      response: {
        data: {
          error: {
            code: "validation_error",
            message: "Error en la solicitud.",
            details: {
              responsable: [
                "Indique el proveedor o la persona que realizará la orden.",
              ],
              fecha_programada: [
                "La fecha programada no puede ser anterior a hoy.",
              ],
            },
          },
        },
      },
    });
    pintar(<OrdenForm />);
    await llenarDatos();
    await buscarYElegir("electro", "Electro Andes S.A.");
    fireEvent.change(screen.getByLabelText(/^Fecha programada/), {
      target: { value: dia(0) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar orden" }));

    const responsable = campoResponsable();
    await waitFor(() =>
      expect(responsable).toHaveAccessibleDescription(
        /Indique el proveedor o la persona que realizará la orden\./,
      ),
    );
    expect(
      screen.getByLabelText(/^Fecha programada/),
    ).toHaveAccessibleDescription(
      /La fecha programada no puede ser anterior a hoy\./,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "revise los campos marcados",
    );
    await waitFor(() => expect(responsable).toHaveFocus());
  });

  /* QA-UX, ronda 1 (11/11/2026): la lista no se abre al recibir el foco;
     tras validar, el foco llega al campo y la lista tapaba el error. */
  it("al llevar el foco al campo tras validar, la lista no se abre", async () => {
    pintar(<OrdenForm />);
    await llenarDatos();

    fireEvent.click(screen.getByRole("button", { name: "Registrar orden" }));

    const responsable = campoResponsable();
    await waitFor(() => expect(responsable).toHaveFocus());
    fireEvent.focus(responsable);
    expect(responsable).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(servicio.responsables).not.toHaveBeenCalled();
    expect(responsable).toHaveAccessibleDescription(
      /Indique el proveedor o la persona/,
    );

    // Un clic sí la abre, con los primeros de cada grupo.
    fireEvent.click(responsable);
    expect(
      await screen.findByRole("option", { name: "Electro Andes S.A." }),
    ).toBeInTheDocument();
    expect(servicio.responsables).toHaveBeenCalledWith("");
  });

  it("la última fila registra un proveedor con lo escrito", async () => {
    servicio.responsables.mockResolvedValue({ proveedores: [], personas: [] });
    pintar(<OrdenForm />);
    await screen.findByRole("option", { name: /Quito · Matriz/ });

    fireEvent.change(campoResponsable(), { target: { value: "Pedro Gómez" } });
    const fila = await screen.findByRole("option", {
      name: /Registrar proveedor «Pedro Gómez»/,
    });
    // Se llega con las flechas: ↑ desde ninguna marca la última.
    fireEvent.keyDown(campoResponsable(), { key: "ArrowUp" });
    expect(campoResponsable()).toHaveAttribute(
      "aria-activedescendant",
      fila.id,
    );
    fireEvent.keyDown(campoResponsable(), { key: "Enter" });

    const ventana = await screen.findByRole("dialog", {
      name: "Registrar proveedor nuevo",
    });
    expect(
      within(ventana).getByLabelText(/^Nombre o razón social/),
    ).toHaveValue("Pedro Gómez");
    expect(servicio.create).not.toHaveBeenCalled();
    // Irse a registrar (el foco pasa a la ventana) no es «salir sin elegir».
    expect(campoResponsable()).not.toHaveAttribute("aria-invalid");
  });

  it("al salir con un nombre sin elegir, lo dice; si coincide con uno, lo elige", async () => {
    pintar(<OrdenForm />);
    await llenarDatos();

    // Sin coincidencia exacta: el aviso.
    fireEvent.change(campoResponsable(), { target: { value: "Jor" } });
    await screen.findByRole("option", { name: /Jorge Andrade/ });
    fireEvent.focusOut(campoResponsable());
    expect(campoResponsable()).toHaveAccessibleDescription(
      /Elija de la lista quién realiza la orden o registre un proveedor nuevo\./,
    );

    // Al enviar así, el error dice que falta elegir.
    fireEvent.change(screen.getByLabelText(/^Fecha programada/), {
      target: { value: dia(0) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar orden" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "revise los campos marcados",
      ),
    );
    expect(campoResponsable()).toHaveAccessibleDescription(
      /Elija de la lista quién realiza la orden o registre un proveedor nuevo\./,
    );
    expect(servicio.create).not.toHaveBeenCalled();

    // Igual a una sola opción (sin tildes ni mayúsculas): queda elegida.
    fireEvent.change(campoResponsable(), {
      target: { value: "electro andes s.a." },
    });
    await screen.findByRole("option", { name: "Electro Andes S.A." });
    fireEvent.focusOut(campoResponsable());
    expect(campoResponsable()).toHaveValue("Electro Andes S.A.");
    expect(campoResponsable()).not.toHaveAttribute("aria-invalid");
  });

  /* QA-UX, ronda 2: sin opción marcada, Enter solo elige si lo escrito es
     exactamente una opción de los resultados de ese mismo texto. */
  it("Enter sin marcar elige solo la coincidencia exacta del término actual", async () => {
    pintar(<OrdenForm />);
    await llenarDatos();

    // Parcial: no elige «la primera»; dice que falta elegir.
    fireEvent.change(campoResponsable(), { target: { value: "and" } });
    await screen.findByRole("option", { name: "Electro Andes S.A." });
    await waitFor(() =>
      expect(servicio.responsables).toHaveBeenLastCalledWith("and"),
    );
    await waitFor(() =>
      expect(campoResponsable()).not.toHaveAttribute("aria-busy"),
    );
    fireEvent.keyDown(campoResponsable(), { key: "Enter" });
    expect(campoResponsable()).toHaveValue("and");
    expect(campoResponsable()).toHaveAccessibleDescription(
      /Elija de la lista quién realiza la orden/,
    );

    // Exacto pero con los resultados de otro texto todavía: tampoco.
    fireEvent.change(campoResponsable(), {
      target: { value: "electro andes s.a." },
    });
    fireEvent.keyDown(campoResponsable(), { key: "Enter" });
    expect(campoResponsable()).toHaveValue("electro andes s.a.");

    // Con los resultados de ese texto: queda elegido.
    await waitFor(() =>
      expect(servicio.responsables).toHaveBeenLastCalledWith(
        "electro andes s.a.",
      ),
    );
    await waitFor(() =>
      expect(campoResponsable()).not.toHaveAttribute("aria-busy"),
    );
    fireEvent.keyDown(campoResponsable(), { key: "Enter" });
    expect(campoResponsable()).toHaveValue("Electro Andes S.A.");
    expect(campoResponsable()).not.toHaveAttribute("aria-invalid");
    expect(servicio.create).not.toHaveBeenCalled();
  });

  /* QA-TECH, P2: con las flechas, la opción marcada se trae a la vista. */
  it("la opción marcada con las flechas se trae a la vista", async () => {
    const original = Element.prototype.scrollIntoView;
    const traer = vi.fn();
    Element.prototype.scrollIntoView = traer;
    try {
      pintar(<OrdenForm />);
      await screen.findByRole("option", { name: /Quito · Matriz/ });
      fireEvent.change(campoResponsable(), { target: { value: "a" } });
      await screen.findByRole("option", { name: /Lucía Mora/ });

      fireEvent.keyDown(campoResponsable(), { key: "ArrowDown" });
      fireEvent.keyDown(campoResponsable(), { key: "End" });

      await waitFor(() =>
        expect(traer).toHaveBeenLastCalledWith({ block: "nearest" }),
      );
      expect(campoResponsable()).toHaveAttribute(
        "aria-activedescendant",
        screen.getByRole("option", { name: /Registrar proveedor/ }).id,
      );
      fireEvent.keyDown(campoResponsable(), { key: "Home" });
      expect(campoResponsable()).toHaveAttribute(
        "aria-activedescendant",
        expect.stringContaining("opcion-0"),
      );
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("corregir la persona no borra el proveedor hasta elegir otra, y lo avisa", async () => {
    pintar(<OrdenForm />);
    await llenarDatos();
    await buscarYElegir("jor", /Jorge Andrade/);
    const proveedor = screen.getByRole("combobox", {
      name: /^Proveedor \(opcional\)/,
    });
    expect(proveedor).toHaveAccessibleDescription(
      /Propuesto: Electro Andes S\.A\. \(último proveedor de Jorge Andrade\)/,
    );

    fireEvent.change(campoResponsable(), { target: { value: "Lu" } });
    expect(proveedor).toHaveValue("Electro Andes S.A.");

    fireEvent.mouseDown(
      await screen.findByRole("option", { name: /Lucía Mora/ }),
    );
    expect(proveedor).toHaveValue("");
    expect(
      screen.getByText(
        /Se quitó el proveedor Electro Andes S\.A\.: Lucía Mora no tiene proveedor anterior\./,
      ),
    ).toBeInTheDocument();
  });

  it("el campo de proveedor busca solo proveedores", async () => {
    pintar(<OrdenForm />);
    await llenarDatos();
    await buscarYElegir("jor", /Jorge Andrade/);
    const proveedor = screen.getByRole("combobox", {
      name: /^Proveedor \(opcional\)/,
    });

    fireEvent.click(proveedor);

    await waitFor(() =>
      expect(servicio.responsables).toHaveBeenLastCalledWith("", {
        solo: "proveedores",
      }),
    );
    const lista = await screen.findByRole("listbox", { name: /Proveedor/ });
    expect(within(lista).queryByRole("group", { name: "Personas" })).toBeNull();
    // El elegido lleva su marca.
    expect(
      within(lista).getByRole("option", { name: /Elegido: Electro Andes/ }),
    ).toBeInTheDocument();
  });

  it("la ventana del proveedor revisa el formato del correo", async () => {
    pintar(<OrdenForm />);
    await screen.findByRole("option", { name: /Quito · Matriz/ });
    fireEvent.click(
      screen.getByRole("button", { name: /Registrar proveedor nuevo/ }),
    );
    const ventana = await screen.findByRole("dialog");
    fireEvent.change(within(ventana).getByLabelText(/^Nombre o razón social/), {
      target: { value: "Pedro Gómez" },
    });
    const correo = within(ventana).getByLabelText(/^Correo/);
    fireEvent.change(correo, { target: { value: "pedro@" } });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Registrar y elegir" }),
    );

    await waitFor(() =>
      expect(correo).toHaveAccessibleDescription(/Escriba un correo válido/),
    );
    expect(servicio.registrarProveedor).not.toHaveBeenCalled();
    expect(ventana.querySelector("form")).toHaveAttribute("novalidate");
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
