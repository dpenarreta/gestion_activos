import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * La ficha del activo: la pantalla más poblada del sistema.
 *
 * Reúne lo que el documento funcional reparte en varios sitios —ficha técnica,
 * custodia, tiempos, indicadores, bitácora, adjuntos e historial— y decide qué
 * acciones se ofrecen según el permiso de quien mira y según el estado del
 * equipo. Estaba al 5,5 %: lo que se rompiera aquí no lo iba a decir ninguna
 * prueba.
 */

const historial = vi.fn();
const listarAdjuntos = vi.fn(() => Promise.resolve([]));

vi.mock("../src/api/activosService", () => ({
  activosService: {
    historial: (...args) => historial(...args),
    asignar: vi.fn(),
    cambiarEstado: vi.fn(),
  },
  tiposDispositivoService: {
    list: vi.fn(() => Promise.resolve({ results: [] })),
  },
  caracteristicasService: { delTipo: vi.fn(() => Promise.resolve([])) },
}));

vi.mock("../src/api/adjuntosService", () => ({
  adjuntosService: {
    list: (...args) => listarAdjuntos(...args),
    subir: vi.fn(),
    descargar: vi.fn(),
    remove: vi.fn(),
  },
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { ActivoDetalle } =
  await import("../src/pages/Admin/Activos/ActivoDetalle");

const ACTIVO = {
  id: 7,
  codigo_barras: "GA-LAP-000007",
  nombre: "Laptop Jefatura TI",
  estado: "en_uso",
  estado_display: "Asignado",
  tipo_nombre: "Laptop",
  marca: "Dell",
  modelo: "Latitude 5440",
  numero_serie: "DL5440-0011",
  fecha_adquisicion: "2025-07-01",
  fecha_ingreso: "2025-07-15",
  antiguedad_meses: 14,
  costo_adquisicion: "1180.00",
  proveedor: "Tecnomega C.A.",
  estado_garantia: "vigente",
  estado_garantia_display: "En garantía",
  fecha_fin_garantia: "2027-07-01",
  dias_para_fin_de_garantia: 300,
  especificaciones: { RAM: 16, Procesador: "Intel i7" },
  observaciones: "Equipo de la jefatura",
  custodio_nombre: "María Fernanda Salazar Ruiz",
  departamento_nombre: "Tecnología",
  sede_nombre: "Matriz Quito",
  ciudad: "Quito",
  criticidad_display: "Alta",
  uso_display: "Gerencial",
  total_mantenimientos: 2,
  total_componentes_criticos: 1,
  dias_en_reparacion: 45,
  renovacion: null,
  tiempos: {
    desde_compra_dias: 420,
    desde_ingreso_dias: 406,
    desde_primera_asignacion_dias: 400,
    con_custodio_actual_dias: 30,
    en_reparacion_dias: 45,
    en_reparacion_ahora_dias: 0,
    sin_uso_dias: 5,
    activo_real_dias: 370,
    medido_desde: "compra",
  },
};

const FICHA = {
  activo: ACTIVO,
  movimientos: [
    {
      id: 1,
      created_at: "2026-01-15T10:00:00Z",
      tipo_display: "Asignación",
      custodio_anterior_nombre: null,
      custodio_nuevo_nombre: "María Fernanda Salazar Ruiz",
      motivo: "Entrega inicial",
      registrado_por_nombre: "admin",
    },
  ],
  mantenimientos: [],
  costos: {
    costo_total: "320.00",
    costo_mano_obra: "45.00",
    costo_repuestos: "275.00",
  },
};

function pintar(ficha = FICHA) {
  historial.mockResolvedValue(ficha);
  return render(
    <MemoryRouter initialEntries={["/admin/activos/7"]}>
      <Routes>
        <Route path="/admin/activos/:id" element={<ActivoDetalle />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * El valor que la ficha muestra para una etiqueta.
 *
 * La ficha es una lista de definición y varios valores se repiten por la
 * pantalla —el código está en la miga de pan y en el título; la antigüedad
 * coincide con el tiempo desde la compra—, así que buscar por texto suelto
 * encuentra más de uno y no dice cuál se estaba comprobando.
 */
function valorDe(etiqueta) {
  const termino = screen.getAllByText(etiqueta, { selector: "dt" })[0];
  return termino.nextElementSibling.textContent.trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  listarAdjuntos.mockResolvedValue([]);
});

// --- Lo que la ficha muestra ------------------------------------------------

describe("La ficha del activo", () => {
  it("reúne identificación, ficha técnica y custodia", async () => {
    pintar();

    expect(await screen.findByText("Laptop Jefatura TI")).toBeInTheDocument();
    // El código aparece dos veces a propósito: en la miga de pan y junto al
    // nombre, que es lo que se lee al llegar desde el escáner.
    expect(screen.getAllByText("GA-LAP-000007")).toHaveLength(2);
    expect(valorDe("Número de serie")).toBe("DL5440-0011");
    expect(valorDe("Proveedor")).toBe("Tecnomega C.A.");
    expect(valorDe("Responsable")).toContain("María Fernanda Salazar Ruiz");
    expect(valorDe("Ciudad")).toBe("Quito");
  });

  it("dice la antigüedad en años y meses, no en un número suelto", async () => {
    pintar();

    await screen.findByText("Laptop Jefatura TI");

    // 14 meses: «14 meses» obliga a dividir para saber que pasó del año.
    expect(valorDe("Antigüedad")).toBe("1 año y 2 meses");
    // Y los tiempos del §10 siguen la misma regla, sin perder los días.
    expect(valorDe("Desde el ingreso")).toBe("1 año, 1 mes y 16 días");
    // En el umbral se sigue diciendo en días: 30 son 30, no «1 mes».
    expect(valorDe("Con el custodio actual")).toBe("30 días");
    expect(valorDe("Guardado sin uso")).toBe("5 días");
  });

  it("muestra las especificaciones capturadas", async () => {
    pintar();

    expect(await screen.findByText("Especificaciones")).toBeInTheDocument();
    expect(screen.getByText("RAM")).toBeInTheDocument();
    expect(screen.getByText("Intel i7")).toBeInTheDocument();
  });

  it("sin especificaciones no deja la sección vacía", async () => {
    pintar({ ...FICHA, activo: { ...ACTIVO, especificaciones: {} } });

    await screen.findByText("Laptop Jefatura TI");
    expect(screen.queryByText("Especificaciones")).not.toBeInTheDocument();
  });

  it("lista el historial de movimientos", async () => {
    pintar();

    const fila = (await screen.findByText("Asignación")).closest("tr");
    expect(within(fila).getByText("Entrega inicial")).toBeInTheDocument();
  });

  it("si la ficha no carga lo dice y no pinta media pantalla", async () => {
    historial.mockRejectedValue(new Error("500"));

    render(
      <MemoryRouter initialEntries={["/admin/activos/7"]}>
        <Routes>
          <Route path="/admin/activos/:id" element={<ActivoDetalle />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("No se pudo cargar la ficha del activo."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ficha técnica")).not.toBeInTheDocument();
  });
});

// --- Qué acciones se ofrecen ------------------------------------------------

describe("Las acciones dependen del permiso", () => {
  it("sin permisos no ofrece ninguna acción sobre el equipo", async () => {
    pintar();

    await screen.findByText("Laptop Jefatura TI");
    expect(
      screen.queryByRole("button", { name: /Etiqueta/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Asignar \/ trasladar/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Cambiar estado/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Editar ficha/ }),
    ).not.toBeInTheDocument();
  });

  it("cada permiso trae su propia acción", async () => {
    permisos.add("activos.asignar");
    permisos.add("activos.dar_baja");
    permisos.add("activos.editar");
    permisos.add("activos.imprimir_etiqueta");

    pintar();

    await screen.findByText("Laptop Jefatura TI");
    expect(
      screen.getByRole("button", { name: /Etiqueta/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Asignar \/ trasladar/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Cambiar estado/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Editar ficha/ }),
    ).toBeInTheDocument();
  });

  it("sin ver mantenimientos no aparece la bitácora ni el desglose de costos", async () => {
    permisos.add("activos.editar");

    pintar();

    await screen.findByText("Laptop Jefatura TI");
    expect(
      screen.queryByText("Bitácora de mantenimientos"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Mano de obra/)).not.toBeInTheDocument();
  });

  it("con el permiso sí aparecen, y el costo se desglosa", async () => {
    permisos.add("mantenimientos.ver");

    pintar();

    expect(
      await screen.findByText("Bitácora de mantenimientos"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Mano de obra/)).toBeInTheDocument();
  });

  it("sin ver adjuntos no se carga el panel de documentos", async () => {
    pintar();

    await screen.findByText("Laptop Jefatura TI");
    expect(listarAdjuntos).not.toHaveBeenCalled();
  });
});

// --- Un equipo que ya salió del inventario ----------------------------------

describe("Cuando el equipo está dado de baja", () => {
  const DE_BAJA = {
    ...FICHA,
    activo: {
      ...ACTIVO,
      estado: "dado_de_baja",
      estado_display: "Dado de baja",
      fecha_baja: "2026-08-01",
      motivo_baja: "Daño irreparable en la placa",
    },
  };

  it("no se puede asignar ni editar: ya no está", async () => {
    permisos.add("activos.asignar");
    permisos.add("activos.editar");
    permisos.add("activos.dar_baja");

    pintar(DE_BAJA);

    await screen.findByText("Laptop Jefatura TI");
    expect(
      screen.queryByRole("button", { name: /Asignar \/ trasladar/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Editar ficha/ }),
    ).not.toBeInTheDocument();
    // Cambiar estado sí: una baja mal registrada tiene que poder corregirse.
    expect(
      screen.getByRole("button", { name: /Cambiar estado/ }),
    ).toBeInTheDocument();
  });

  it("dice cuándo y por qué salió", async () => {
    pintar(DE_BAJA);

    expect(await screen.findByText("Motivo de baja")).toBeInTheDocument();
    expect(
      screen.getByText("Daño irreparable en la placa"),
    ).toBeInTheDocument();
  });

  it("tampoco se registran mantenimientos sobre él", async () => {
    permisos.add("mantenimientos.ver");
    permisos.add("mantenimientos.registrar");

    pintar(DE_BAJA);

    await screen.findByText("Bitácora de mantenimientos");
    expect(
      screen.queryByRole("link", { name: /Registrar mantenimiento/ }),
    ).not.toBeInTheDocument();
  });
});

// --- Lo que vale hoy --------------------------------------------------------

describe("El valor en libros", () => {
  const DEPRECIADO = {
    disponible: true,
    motivo: null,
    costo: "1180.00",
    desde: "2025-07-15",
    meses_vida_contable: 36,
    meses_transcurridos: 14,
    cuota_mensual: "32.78",
    acumulada: "458.92",
    valor_en_libros: "721.08",
    porcentaje_depreciado: "38.89",
    totalmente_depreciado: false,
    fin: "2028-07-15",
  };

  it("va junto al costo: la pregunta es «costó tanto, ¿y ahora?»", async () => {
    pintar({ ...FICHA, activo: { ...ACTIVO, depreciacion: DEPRECIADO } });

    await screen.findByText("Laptop Jefatura TI");
    expect(valorDe("Valor en libros")).toContain("721,08");
    expect(valorDe("Valor en libros")).toContain("38.89 % depreciado");
  });

  it("un equipo ya depreciado se marca, sin tratarlo como un problema", async () => {
    /* Depreciarse en tres años y reemplazarse a los cuatro o cinco es lo
       normal: el aviso es neutro, no una alerta. */
    pintar({
      ...FICHA,
      activo: {
        ...ACTIVO,
        depreciacion: { ...DEPRECIADO, totalmente_depreciado: true },
      },
    });

    await screen.findByText("Laptop Jefatura TI");
    expect(valorDe("Valor en libros")).toContain("Totalmente depreciado desde");
  });

  it("sin política ni costo no se inventa un cero", async () => {
    /* Un valor en libros de 0 significa «ya no vale nada», que es muy distinto
       de «nadie capturó lo que costó». */
    pintar({
      ...FICHA,
      activo: {
        ...ACTIVO,
        depreciacion: { disponible: false, motivo: "Sin costo registrado." },
      },
    });

    await screen.findByText("Laptop Jefatura TI");
    expect(
      screen.queryByText("Valor en libros", { selector: "dt" }),
    ).not.toBeInTheDocument();
  });
});

// --- Nuevo o usado ----------------------------------------------------------

describe("La condición al adquirirlo", () => {
  it("se muestra junto al resto de la compra", async () => {
    pintar({
      ...FICHA,
      activo: { ...ACTIVO, condicion: "usado", condicion_display: "Usado" },
    });

    await screen.findByText("Laptop Jefatura TI");
    expect(valorDe("Condición al adquirirlo")).toBe("Usado");
  });

  it("sin anotar dice «sin especificar», que no es lo mismo que «nuevo»", async () => {
    /* Vacío significa que nadie lo anotó, y decirlo con esas palabras es lo
       que permite completarlo después. */
    pintar({
      ...FICHA,
      activo: { ...ACTIVO, condicion: "", condicion_display: "" },
    });

    await screen.findByText("Laptop Jefatura TI");
    expect(valorDe("Condición al adquirirlo")).toBe("Sin especificar");
  });
});
