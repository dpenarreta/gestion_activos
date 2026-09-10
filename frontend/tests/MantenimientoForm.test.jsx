import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Registrar una intervención: el formulario que más se llena después del alta.
 *
 * Aquí se decide lo que después aparece en la bitácora, en el costo acumulado
 * y en el umbral de renovación, así que lo que se prueba es la traducción
 * entre lo que se teclea y lo que se envía: una fecha de salida vacía no es
 * una fecha en blanco sino «sigue fuera de operación», una línea de repuesto a
 * medio llenar no debe viajar, y al editar el desglose se reemplaza entero.
 */

const listarActivos = vi.fn();
const listarComponentes = vi.fn();
const listarProveedores = vi.fn();
const obtener = vi.fn();
const crear = vi.fn();
const actualizar = vi.fn();

vi.mock("../src/api/activosService", () => ({
  activosService: { list: (...args) => listarActivos(...args) },
}));

vi.mock("../src/api/mantenimientosService", () => ({
  mantenimientosService: {
    get: (...args) => obtener(...args),
    create: (...args) => crear(...args),
    update: (...args) => actualizar(...args),
  },
  componentesService: { list: (...args) => listarComponentes(...args) },
}));

vi.mock("../src/api/organizacionService", () => ({
  proveedoresService: { list: (...args) => listarProveedores(...args) },
}));

const { MantenimientoForm } =
  await import("../src/pages/Admin/Mantenimientos/MantenimientoForm");

const ACTIVOS = [
  {
    id: 7,
    codigo_barras: "GA-LAP-000007",
    nombre: "Laptop Jefatura TI",
    estado: "en_uso",
    fecha_adquisicion: "2025-07-01",
  },
  {
    id: 9,
    codigo_barras: "GA-PC-000009",
    nombre: "PC Recepción",
    estado: "dado_de_baja",
    fecha_adquisicion: "2019-02-01",
  },
];

const COMPONENTES = [
  { id: 11, nombre: "Disco SSD 480 GB", es_critico: true, activo: true },
  { id: 12, nombre: "Teclado", es_critico: false, activo: true },
  { id: 13, nombre: "Batería descatalogada", es_critico: false, activo: false },
];

/** Deja ver a dónde navegó el formulario tras guardar. */
function Destino() {
  return <p>Destino: {useLocation().pathname}</p>;
}

function pintar(ruta = "/admin/mantenimientos/new") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route
          path="/admin/mantenimientos/new"
          element={<MantenimientoForm />}
        />
        <Route
          path="/admin/mantenimientos/:id"
          element={<MantenimientoForm />}
        />
        <Route path="*" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Llena los campos obligatorios que el formulario exige para guardar. */
function llenarMinimo() {
  fireEvent.change(screen.getByLabelText("Activo intervenido"), {
    target: { value: "7" },
  });
  fireEvent.change(screen.getByLabelText("Nombre del técnico o proveedor"), {
    target: { value: "Jorge Andrade" },
  });
  fireEvent.change(screen.getByLabelText("Trabajo realizado"), {
    target: { value: "Cambio de disco" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listarActivos.mockResolvedValue({ results: ACTIVOS });
  listarComponentes.mockResolvedValue({ results: COMPONENTES });
  listarProveedores.mockResolvedValue({
    results: [{ id: 21, nombre: "Tecnomega C.A." }],
  });
  crear.mockResolvedValue({ id: 1 });
  actualizar.mockResolvedValue({ id: 1 });
});

// --- Qué se puede elegir ----------------------------------------------------

describe("Registrar una intervención", () => {
  it("no ofrece equipos dados de baja", async () => {
    /* El backend las rechaza; ofrecerlos aquí solo produce un error después de
       haber llenado el formulario entero. */
    pintar();

    expect(
      await screen.findByRole("option", { name: /Laptop Jefatura TI/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /PC Recepción/ }),
    ).not.toBeInTheDocument();
  });

  it("entra con el equipo puesto cuando se llega desde su ficha", async () => {
    pintar("/admin/mantenimientos/new?activo=7");

    await screen.findByRole("option", { name: /Laptop Jefatura TI/ });
    expect(screen.getByLabelText("Activo intervenido")).toHaveValue("7");
  });

  it("acota la fecha a partir de la compra del equipo, y dice cuál es", async () => {
    /* El servidor rechaza una intervención anterior a la compra; saberlo al
       elegir el equipo evita descubrirlo al guardar. */
    pintar("/admin/mantenimientos/new?activo=7");

    expect(
      await screen.findByText(/El equipo se adquirió el 2025-07-01/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Fecha de ingreso")).toHaveAttribute(
      "min",
      "2025-07-01",
    );
  });

  it("solo lista componentes vigentes del catálogo", async () => {
    /* Una pieza retirada del catálogo no se puede volver a consumir; seguir
       ofreciéndola reabre el uso de algo que se decidió descontinuar. */
    pintar();

    await screen.findByRole("option", { name: /Laptop Jefatura TI/ });
    fireEvent.click(screen.getByRole("button", { name: /Agregar componente/ }));

    expect(
      screen.getByRole("option", { name: /Disco SSD 480 GB/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Batería descatalogada/ }),
    ).not.toBeInTheDocument();
  });
});

// --- Los tiempos ------------------------------------------------------------

describe("La fecha de salida", () => {
  it("vacía significa que el equipo sigue fuera, y lo dice", async () => {
    pintar();

    expect(
      await screen.findByText(
        "Vacío mientras el equipo siga fuera de operación.",
      ),
    ).toBeInTheDocument();
  });

  it("con salida muestra el tiempo fuera de operación en meses", async () => {
    pintar();

    await screen.findByRole("option", { name: /Laptop Jefatura TI/ });
    fireEvent.change(screen.getByLabelText("Fecha de ingreso"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText("Fecha de salida"), {
      target: { value: "2026-08-11" },
    });

    expect(
      screen.getByText("1 mes y 11 días fuera de operación."),
    ).toBeInTheDocument();
  });

  it("no permite una salida anterior al ingreso", async () => {
    pintar();

    await screen.findByRole("option", { name: /Laptop Jefatura TI/ });
    fireEvent.change(screen.getByLabelText("Fecha de ingreso"), {
      target: { value: "2026-07-01" },
    });

    expect(screen.getByLabelText("Fecha de salida")).toHaveAttribute(
      "min",
      "2026-07-01",
    );
  });
});

// --- Lo que se envía --------------------------------------------------------

describe("Al guardar", () => {
  it("los campos vacíos viajan como nulos, no como cadenas en blanco", async () => {
    /* Una fecha de salida `""` sería una fecha inválida para el backend; el
       nulo es lo que significa «todavía no salió». */
    pintar();

    await screen.findByRole("option", { name: /Laptop Jefatura TI/ });
    llenarMinimo();
    fireEvent.click(
      screen.getByRole("button", { name: "Registrar intervención" }),
    );

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0]).toMatchObject({
      activo: "7",
      fecha_salida: null,
      costo_mano_obra: null,
      componentes: [],
    });
  });

  it("una línea de repuesto a medio llenar no se envía", async () => {
    /* Se agrega la fila antes de elegir la pieza; si el usuario se arrepiente
       y no la borra, no debe registrarse un consumo sin componente. */
    pintar();

    await screen.findByRole("option", { name: /Laptop Jefatura TI/ });
    llenarMinimo();
    fireEvent.click(screen.getByRole("button", { name: /Agregar componente/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Registrar intervención" }),
    );

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0].componentes).toEqual([]);
  });

  it("envía los repuestos con su proveedor y su costo", async () => {
    pintar();

    await screen.findByRole("option", { name: /Laptop Jefatura TI/ });
    llenarMinimo();
    fireEvent.click(screen.getByRole("button", { name: /Agregar componente/ }));
    fireEvent.change(screen.getByLabelText("Componente"), {
      target: { value: "11" },
    });
    fireEvent.change(screen.getByLabelText("Proveedor"), {
      target: { value: "21" },
    });
    fireEvent.change(screen.getByLabelText("Cantidad"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Costo unitario"), {
      target: { value: "45.50" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Registrar intervención" }),
    );

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0].componentes).toEqual([
      {
        componente: "11",
        proveedor: "21",
        cantidad: 2,
        costo_unitario: "45.50",
        numero_serie_nuevo: "",
      },
    ]);
  });

  it("avisa al capturar una pieza crítica: dispara la sugerencia de reemplazo", async () => {
    /* Quien captura tiene que verlo mientras lo registra, no enterarse
       después de que el equipo apareció como «reemplazo recomendado». */
    pintar();

    await screen.findByRole("option", { name: /Laptop Jefatura TI/ });
    fireEvent.click(screen.getByRole("button", { name: /Agregar componente/ }));
    fireEvent.change(screen.getByLabelText("Componente"), {
      target: { value: "11" },
    });

    expect(screen.getByText(/Pieza crítica/)).toBeInTheDocument();
  });

  it("vuelve a la ficha del equipo, que es donde se ve el resultado", async () => {
    pintar();

    await screen.findByRole("option", { name: /Laptop Jefatura TI/ });
    llenarMinimo();
    fireEvent.click(
      screen.getByRole("button", { name: "Registrar intervención" }),
    );

    expect(
      await screen.findByText("Destino: /admin/activos/7"),
    ).toBeInTheDocument();
  });

  it("si el servidor rechaza el registro, lo dice y no navega", async () => {
    crear.mockRejectedValue({
      response: {
        data: { error: { message: "La fecha excede el permitido." } },
      },
    });

    pintar();

    await screen.findByRole("option", { name: /Laptop Jefatura TI/ });
    llenarMinimo();
    fireEvent.click(
      screen.getByRole("button", { name: "Registrar intervención" }),
    );

    expect(
      await screen.findByText("La fecha excede el permitido."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Destino:/)).not.toBeInTheDocument();
  });
});

// --- Editar una intervención ya registrada ----------------------------------

describe("Editar una intervención", () => {
  const INTERVENCION = {
    id: 5,
    activo: 7,
    tipo: "correctivo",
    fecha_intervencion: "2026-07-01",
    fecha_salida: "2026-07-05",
    tipo_responsable: "proveedor_externo",
    responsable: "Tecnomega C.A.",
    causa: "Disco fallando",
    descripcion: "Reemplazo de disco",
    diagnostico: "",
    solucion: "",
    estado_final: "reparado",
    garantia_usada: false,
    costo_mano_obra: "20.00",
    componentes: [
      {
        componente: 11,
        proveedor: 21,
        cantidad: 1,
        costo_unitario: "80.00",
        numero_serie_nuevo: "SSD-99",
      },
    ],
  };

  it("carga lo registrado, incluido el desglose de repuestos", async () => {
    obtener.mockResolvedValue(INTERVENCION);

    pintar("/admin/mantenimientos/5");

    expect(await screen.findByText("Editar intervención")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre del técnico o proveedor")).toHaveValue(
      "Tecnomega C.A.",
    );
    expect(screen.getByLabelText("Causa de la falla")).toHaveValue(
      "Disco fallando",
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Serie de la pieza")).toHaveValue("SSD-99"),
    );
  });

  it("el activo queda fijo, y explica por qué", async () => {
    /* Mover una intervención de equipo descuadraría los contadores de los dos;
       corregirla es eliminarla y registrarla de nuevo. */
    obtener.mockResolvedValue(INTERVENCION);

    pintar("/admin/mantenimientos/5");

    await screen.findByText("Editar intervención");
    expect(screen.getByLabelText("Activo intervenido")).toBeDisabled();
    expect(
      screen.getByText(/Una intervención no cambia de activo/),
    ).toBeInTheDocument();
  });

  it("advierte que el desglose se reemplaza entero, no se agrega", async () => {
    obtener.mockResolvedValue(INTERVENCION);

    pintar("/admin/mantenimientos/5");

    expect(
      await screen.findByText(/reemplaza por completo el desglose anterior/),
    ).toBeInTheDocument();
  });

  it("guarda contra la intervención existente, no crea otra", async () => {
    obtener.mockResolvedValue(INTERVENCION);

    pintar("/admin/mantenimientos/5");

    await screen.findByText("Editar intervención");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(actualizar).toHaveBeenCalled());
    expect(actualizar.mock.calls[0][0]).toBe("5");
    expect(crear).not.toHaveBeenCalled();
  });

  it("si la intervención no carga lo dice", async () => {
    obtener.mockRejectedValue(new Error("404"));

    pintar("/admin/mantenimientos/5");

    expect(
      await screen.findByText("No se pudo cargar la intervención."),
    ).toBeInTheDocument();
  });
});
