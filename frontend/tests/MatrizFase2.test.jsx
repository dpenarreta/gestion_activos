import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Matriz de obligaciones, fase 2: el tablero, la matriz, el detalle del
 * período y el alta de una obligación.
 *
 * Cobertura de AC-MTZ-004 y AC-MTZ-017 a AC-MTZ-024.
 */

const svc = {
  misEmpresas: vi.fn(),
  resumen: vi.fn(),
  periodos: vi.fn(),
  periodo: vi.fn(),
  historial: vi.fn(),
  editarSeguimiento: vi.fn(),
  crearObligacion: vi.fn(),
  catalogos: vi.fn(),
  personas: vi.fn(),
};
let empresaActiva = "1";

vi.mock("../src/api/matrizService", () => ({
  matrizService: new Proxy(
    {},
    {
      get:
        (_, nombre) =>
        (...a) =>
          svc[nombre](...a),
    },
  ),
  catalogoMatrizService: () => ({}),
}));

vi.mock("../src/api/client", () => ({
  getEmpresaActiva: () => empresaActiva,
}));

const { ResumenMatriz } = await import("../src/pages/Matriz/ResumenMatriz");
const { MatrizObligacionesPage } =
  await import("../src/pages/Matriz/MatrizObligacionesPage");
const { ObligacionFormModal } =
  await import("../src/pages/Matriz/ObligacionFormModal");
const { textoDeDias } = await import("../src/pages/Matriz/formatoMatriz");

const COURIER = {
  id: 1,
  nombre: "LaarCourier",
  codigo: "LC",
  color: "#164B86",
  zona_horaria: "America/Guayaquil",
  roles: ["Responsable de cumplimiento"],
  capacidades: ["matriz.crear", "matriz.cargar", "matriz.enviar"],
};

const ESTADO_INCUMPLIDO = {
  group: "incumplido",
  group_label: "Incumplido",
  label: "Incumplido",
  stage: "en_preparacion",
  is_due_today: false,
  is_late: false,
  days_overdue: 3,
  days_remaining: null,
};

function fila(
  id,
  nombre,
  area = "Contabilidad y Tributario",
  estado = ESTADO_INCUMPLIDO,
) {
  return {
    id,
    codigo: `OBL-000${id}`,
    etiqueta: "Octubre 2026",
    obligacion: { id, nombre },
    area,
    entidad: "Servicio de Rentas Internas (SRI)",
    responsable: { id: 7, nombre: "Ana Pérez" },
    prioridad: "alta",
    vence_en: "2026-10-28T22:00:00Z",
    etapa: "en_preparacion",
    avance: 25,
    cerrado: false,
    estado,
  };
}

const DETALLE = {
  ...fila(1, "Declaración de IVA"),
  obligacion: {
    id: 1,
    nombre: "Declaración de IVA",
    tipo: "regulatoria",
    periodicidad: "mensual",
    area_nombre: "Contabilidad y Tributario",
    entidad_nombre: "Servicio de Rentas Internas (SRI)",
    evidencia_esperada: "Formulario 104",
    descripcion: "",
    fundamento_legal: "",
    fundamento_url: "",
  },
  empresa: { id: 1, nombre: "LaarCourier", zona_horaria: "America/Guayaquil" },
  sede: null,
  fecha_inicio: "2026-09-28",
  fecha_preparacion: "2026-10-23",
  suplente: null,
  supervisor: null,
  aprobador: { id: 9, nombre: "Sara Ruiz", email: "sara@laar.com" },
  observaciones: "",
  recordatorios_suspendidos: false,
  acciones: ["edit"],
};

function Ruta() {
  const { pathname, search } = useLocation();
  return <p data-testid="ruta">{`${pathname}${search}`}</p>;
}

function pintar(elemento, ruta) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              {elemento}
              <Ruta />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  empresaActiva = "1";
  svc.misEmpresas.mockResolvedValue({ empresas: [COURIER] });
  svc.resumen.mockResolvedValue({
    counts: {
      overdue: 2,
      in_progress: 5,
      due_soon: 1,
      done: 4,
      done_on_time: 3,
      done_late: 1,
      attention: 2,
    },
    upcoming: [fila(1, "Declaración de IVA")],
    recent_closures: [],
  });
  svc.periodos.mockResolvedValue({
    count: 2,
    next: null,
    previous: null,
    results: [
      fila(1, "Declaración de IVA"),
      fila(2, "Aportes al IESS", "Talento Humano"),
    ],
  });
  svc.periodo.mockResolvedValue(DETALLE);
  svc.historial.mockResolvedValue([
    {
      id: 1,
      created_at: "2026-10-01T15:00:00Z",
      actor: "Ana Pérez",
      descripcion: "Cambio de responsable",
      valor_anterior: "Beto",
      valor_nuevo: "Ana Pérez",
      motivo: "",
    },
  ]);
  svc.catalogos.mockResolvedValue({
    areas: [{ id: 1, codigo: "CONT", nombre: "Contabilidad y Tributario" }],
    entidades: [
      { id: 1, codigo: "SRI", nombre: "Servicio de Rentas Internas (SRI)" },
    ],
    sedes: [],
    tipos: [{ valor: "regulatoria", nombre: "Regulatoria" }],
    periodicidades: [{ valor: "mensual", nombre: "Mensual" }],
    prioridades: [
      { valor: "alta", nombre: "Alta" },
      { valor: "media", nombre: "Media" },
    ],
    etapas: [],
  });
  svc.personas.mockResolvedValue([{ id: 7, nombre: "Ana Pérez", email: "" }]);
});

describe("El tablero (§15.2)", () => {
  it("muestra los cuatro indicadores, el rol y los próximos vencimientos", async () => {
    pintar(<ResumenMatriz />, "/admin/matriz/resumen");

    expect(await screen.findByText("Incumplidas")).toBeInTheDocument();
    expect(
      screen.getByText("3 a tiempo · 1 fuera de plazo"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Responsable de cumplimiento/)).toBeInTheDocument();
    expect(screen.getByText("Declaración de IVA")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Nueva obligación/ }),
    ).toBeInTheDocument();
  });

  it("cada indicador abre la matriz filtrada", async () => {
    pintar(<ResumenMatriz />, "/admin/matriz/resumen");

    const incumplidas = (await screen.findByText("Incumplidas")).closest("a");
    expect(incumplidas).toHaveAttribute(
      "href",
      "/admin/matriz/obligaciones?status=incumplido",
    );
  });

  it("sin rol de la Matriz en la empresa activa, lo dice y cómo resolverlo", async () => {
    empresaActiva = "2";

    pintar(<ResumenMatriz />, "/admin/matriz/resumen");

    expect(
      await screen.findByText(
        "No tiene un rol de la Matriz en la empresa activa.",
      ),
    ).toBeInTheDocument();
    expect(svc.resumen).not.toHaveBeenCalled();
  });

  it("sin permiso de crear, no ofrece «Nueva obligación»", async () => {
    svc.misEmpresas.mockResolvedValue({
      empresas: [{ ...COURIER, capacidades: ["matriz.ver_todas"] }],
    });

    pintar(<ResumenMatriz />, "/admin/matriz/resumen");

    await screen.findByText("Incumplidas");
    expect(
      screen.queryByRole("button", { name: /Nueva obligación/ }),
    ).toBeNull();
  });
});

describe("La matriz (§15.3)", () => {
  it("lista los períodos con su estado y los días de atraso", async () => {
    pintar(<MatrizObligacionesPage />, "/admin/matriz/obligaciones");

    const tabla = await screen.findByRole("table");
    expect(within(tabla).getByText("Aportes al IESS")).toBeInTheDocument();
    expect(within(tabla).getAllByText("+3 d atraso")).toHaveLength(2);
    expect(svc.periodos).toHaveBeenCalledWith({ sort: "urgency", page: 1 });
  });

  it("filtrar por estado viaja a la API y queda en la dirección", async () => {
    pintar(<MatrizObligacionesPage />, "/admin/matriz/obligaciones");

    const grupo = await screen.findByRole("group", {
      name: "Filtrar por estado",
    });
    fireEvent.click(within(grupo).getByRole("button", { name: "Incumplidos" }));

    await waitFor(() =>
      expect(svc.periodos).toHaveBeenLastCalledWith({
        status: "incumplido",
        sort: "urgency",
        page: 1,
      }),
    );
    expect(screen.getByTestId("ruta")).toHaveTextContent("status=incumplido");
  });

  it("la búsqueda de la barra superior llega por ?q=", async () => {
    pintar(<MatrizObligacionesPage />, "/admin/matriz/obligaciones?q=iva");

    await waitFor(() =>
      expect(svc.periodos).toHaveBeenCalledWith({
        q: "iva",
        sort: "urgency",
        page: 1,
      }),
    );
    expect(
      screen.getByRole("searchbox", { name: "Buscar en la matriz" }),
    ).toHaveValue("iva");
  });

  it("las columnas se ordenan; el segundo clic invierte", async () => {
    pintar(<MatrizObligacionesPage />, "/admin/matriz/obligaciones");

    const columna = await screen.findByRole("button", { name: /Obligación/ });
    fireEvent.click(columna);
    await waitFor(() =>
      expect(svc.periodos).toHaveBeenLastCalledWith({ sort: "name", page: 1 }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Obligación/ }));
    await waitFor(() =>
      expect(svc.periodos).toHaveBeenLastCalledWith({ sort: "-name", page: 1 }),
    );
  });

  it("se agrupa por área, con su conteo", async () => {
    pintar(<MatrizObligacionesPage />, "/admin/matriz/obligaciones");

    await screen.findByRole("table");
    fireEvent.change(screen.getByRole("combobox", { name: "Agrupar" }), {
      target: { value: "area" },
    });

    expect(
      screen.getByText("Contabilidad y Tributario · 1"),
    ).toBeInTheDocument();
    expect(screen.getByText("Talento Humano · 1")).toBeInTheDocument();
  });

  // Auditoría UX/UI, fase 2 (28/10/2026): el nombre es un botón real; la
  // fila ya no es enfocable ni tapa sus celdas con un aria-label.
  it("el nombre de la obligación abre el detalle en el panel lateral", async () => {
    pintar(<MatrizObligacionesPage />, "/admin/matriz/obligaciones");

    const boton = await screen.findByRole("button", {
      name: "Declaración de IVA",
    });
    const fila = boton.closest("tr");
    expect(fila).not.toHaveAttribute("tabindex");
    expect(fila).not.toHaveAttribute("aria-label");
    fireEvent.click(boton);

    const panel = await screen.findByRole("dialog");
    expect(screen.getByTestId("ruta")).toHaveTextContent("periodo=1");
    expect(
      await within(panel).findByText("Formulario 104"),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Sara Ruiz")).toBeInTheDocument();
  });

  it("el clic en la fila sigue abriendo el detalle (atajo de ratón)", async () => {
    pintar(<MatrizObligacionesPage />, "/admin/matriz/obligaciones");

    const boton = await screen.findByRole("button", {
      name: "Declaración de IVA",
    });
    fireEvent.click(boton.closest("tr").querySelector("td"));

    await screen.findByRole("dialog");
    expect(screen.getByTestId("ruta")).toHaveTextContent("periodo=1");
  });
});

describe("El detalle del período (§15.4)", () => {
  it("ofrece solo las acciones que manda el servidor", async () => {
    svc.periodo.mockResolvedValue({ ...DETALLE, acciones: [] });

    pintar(<MatrizObligacionesPage />, "/admin/matriz/obligaciones?periodo=1");

    const panel = await screen.findByRole("dialog");
    await within(panel).findByText("Formulario 104");
    expect(
      within(panel).queryByRole("button", { name: /Editar seguimiento/ }),
    ).toBeNull();
  });

  it("el historial muestra quién cambió qué, con el valor anterior", async () => {
    pintar(<MatrizObligacionesPage />, "/admin/matriz/obligaciones?periodo=1");

    const panel = await screen.findByRole("dialog");
    fireEvent.click(
      await within(panel).findByRole("tab", { name: "Historial" }),
    );

    expect(
      await within(panel).findByText("Cambio de responsable"),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Beto → Ana Pérez")).toBeInTheDocument();
  });

  // Auditoría UX/UI, fase 2 (28/10/2026).
  it("un historial que no carga avisa el error, no se ve vacío", async () => {
    svc.historial.mockRejectedValueOnce({ response: { status: 500 } });
    pintar(<MatrizObligacionesPage />, "/admin/matriz/obligaciones?periodo=1");

    const panel = await screen.findByRole("dialog");
    const pestana = await within(panel).findByRole("tab", {
      name: "Historial",
    });
    fireEvent.click(pestana);
    expect(within(panel).getByRole("tabpanel")).toHaveAccessibleName(
      "Historial",
    );
    expect(
      await within(panel).findByText("No se pudo cargar el historial."),
    ).toBeInTheDocument();
  });

  it("un historial sin eventos dice «Sin movimientos»", async () => {
    svc.historial.mockResolvedValueOnce([]);
    pintar(<MatrizObligacionesPage />, "/admin/matriz/obligaciones?periodo=1");

    const panel = await screen.findByRole("dialog");
    fireEvent.click(
      await within(panel).findByRole("tab", { name: "Historial" }),
    );
    expect(
      await within(panel).findByText("Sin movimientos."),
    ).toBeInTheDocument();
  });

  it("editar el seguimiento guarda y recarga el detalle", async () => {
    svc.editarSeguimiento.mockResolvedValue(DETALLE);
    pintar(<MatrizObligacionesPage />, "/admin/matriz/obligaciones?periodo=1");

    const panel = await screen.findByRole("dialog");
    fireEvent.click(
      await within(panel).findByRole("button", { name: /Editar seguimiento/ }),
    );
    fireEvent.change(await screen.findByLabelText("Avance (%)"), {
      target: { value: "60" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(svc.editarSeguimiento).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ avance: 60, responsable: 7 }),
      ),
    );
    await waitFor(() => expect(svc.periodo).toHaveBeenCalledTimes(2));
  });
});

describe("Nueva obligación (§11.1)", () => {
  it("manda lo escrito, sin los campos vacíos", async () => {
    svc.crearObligacion.mockResolvedValue({ id: 12 });
    const onCreada = vi.fn();
    pintar(<ObligacionFormModal onCerrar={vi.fn()} onCreada={onCreada} />, "/");

    await waitFor(() => expect(svc.catalogos).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Nombre * (obligatorio)"), {
      target: { value: "Declaración de IVA" },
    });
    fireEvent.change(await screen.findByLabelText("Tema * (obligatorio)"), {
      target: { value: "1" },
    });
    fireEvent.change(
      screen.getByLabelText("Entidad de control * (obligatorio)"),
      {
        target: { value: "1" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Evidencia esperada * (obligatorio)"),
      {
        target: { value: "Formulario 104" },
      },
    );
    fireEvent.change(screen.getByLabelText("Responsable * (obligatorio)"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear obligación" }));

    await waitFor(() => expect(onCreada).toHaveBeenCalledWith({ id: 12 }));
    const enviado = svc.crearObligacion.mock.calls[0][0];
    expect(enviado).toMatchObject({
      nombre: "Declaración de IVA",
      area: "1",
      responsable: "7",
      hora: "17:00",
    });
    expect(enviado).not.toHaveProperty("fecha_vencimiento");
    expect(enviado).not.toHaveProperty("suplente");
  });

  it("los errores del servidor se muestran junto a su campo", async () => {
    svc.crearObligacion.mockRejectedValue({
      response: {
        data: {
          error: {
            message: "Error en la solicitud.",
            details: {
              nombre: [
                "Ya existe una obligación con ese nombre en la empresa.",
              ],
            },
          },
        },
      },
    });
    pintar(<ObligacionFormModal onCerrar={vi.fn()} onCreada={vi.fn()} />, "/");

    await waitFor(() => expect(svc.catalogos).toHaveBeenCalled());
    fireEvent.submit(
      screen.getByRole("button", { name: "Crear obligación" }).closest("form"),
    );

    expect(
      await screen.findAllByText(/Ya existe una obligación con ese nombre/),
    ).not.toHaveLength(0);
    // El error queda ligado a su campo y el foco va a él (fase 2).
    const nombre = screen.getByLabelText("Nombre * (obligatorio)");
    expect(nombre).toHaveAttribute("aria-invalid", "true");
    expect(nombre).toHaveAccessibleDescription(
      /Ya existe una obligación con ese nombre/,
    );
    await waitFor(() => expect(nombre).toHaveFocus());
  });
});

describe("La columna «Días»", () => {
  it("dice el atraso, si vence hoy o cuánto falta", () => {
    expect(textoDeDias(ESTADO_INCUMPLIDO).texto).toBe("+3 d atraso");
    expect(
      textoDeDias({ group: "en_progreso", is_due_today: true }).texto,
    ).toBe("Vence hoy");
    expect(
      textoDeDias({
        group: "en_progreso",
        is_due_today: false,
        days_remaining: 5,
      }).texto,
    ).toBe("5 d restantes");
    expect(
      textoDeDias({ group: "finalizado", is_late: true, days_overdue: 2 })
        .texto,
    ).toBe("2 d atraso (cerrado)");
  });
});
