import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Dos pantallas que existen por una razón muy concreta y que se rompen de
 * formas muy distintas.
 *
 * El escáner es la consulta de campo: el técnico dispara la pistola equipo por
 * equipo, sin tocar la pantalla. Lo que importa es que el campo aguante la
 * repetición —foco, historial de lecturas— y que un código que no existe no
 * deje la ficha anterior en pantalla, porque se leería como si fuera la del
 * equipo que se acaba de escanear.
 *
 * Las sugerencias existen para respaldar una compra ante el área financiera,
 * así que cada equipo tiene que decir qué criterio superó, con qué valor y
 * contra qué umbral. «Conviene renovar» no sirve para presentar el caso.
 */

const porCodigo = vi.fn();
const sugerencias = vi.fn();

vi.mock("../src/api/activosService", () => ({
  activosService: { porCodigo: (...args) => porCodigo(...args) },
}));

vi.mock("../src/api/politicasService", () => ({
  politicasService: { sugerencias: (...args) => sugerencias(...args) },
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { EscanerPage } = await import("../src/pages/Admin/Activos/EscanerPage");
const { SugerenciasPage } =
  await import("../src/pages/Admin/Politicas/SugerenciasPage");

const FICHA = {
  activo: {
    id: 7,
    codigo_barras: "GA-LAP-000007",
    nombre: "Laptop Jefatura TI",
    estado: "en_uso",
    estado_display: "Asignado",
    responsables_resumen: "María Fernanda Salazar Ruiz",
    departamento_nombre: "Tecnología",
    ciudad: "Quito",
    marca: "Dell",
    modelo: "Latitude 5440",
    numero_serie: "DL5440-0011",
    antiguedad_meses: 14,
    total_mantenimientos: 2,
    total_componentes_criticos: 1,
    esta_operativo: true,
    renovacion: null,
  },
  movimientos: [{ id: 1 }, { id: 2 }],
  mantenimientos: [
    {
      id: 3,
      fecha_intervencion: "2026-07-01",
      tipo_display: "Correctivo",
      descripcion: "Reemplazo de disco",
    },
  ],
  costos: { costo_total: "320.00" },
};

const SUGERENCIAS = {
  total: 2,
  por_nivel: { recomendado: 1, evaluar: 1 },
  resultados: [
    {
      id: 7,
      codigo_barras: "GA-LAP-000007",
      nombre: "Laptop Jefatura TI",
      marca: "Dell",
      modelo: "Latitude 5440",
      tipo: "Laptop",
      departamento: "Tecnología",
      custodio: "María Salazar",
      nivel_renovacion: "recomendado",
      nivel_renovacion_display: "Reemplazo recomendado",
      politica_aplicada: "Laptops corporativas",
      motivos: [
        { criterio: "mantenimientos", valor_actual: 5, umbral: 3 },
        { criterio: "longevidad", valor_actual: 62, umbral: 48 },
      ],
    },
    {
      id: 8,
      codigo_barras: "GA-IMP-000008",
      nombre: "Impresora Bodega",
      marca: "HP",
      modelo: "M404",
      tipo: "Impresora",
      departamento: "Logística",
      custodio: null,
      nivel_renovacion: "evaluar",
      nivel_renovacion_display: "Evaluar reemplazo",
      politica_aplicada: null,
      motivos: [
        { criterio: "componentes_criticos", valor_actual: 3, umbral: 2 },
      ],
    },
  ],
};

function pintar(Pantalla) {
  return render(
    <MemoryRouter>
      <Pantalla />
    </MemoryRouter>,
  );
}

/** Dispara una lectura sobre el campo del escáner. */
function escanear(codigo) {
  const campo = screen.getByLabelText("Código de barras o número de serie");
  fireEvent.change(campo, { target: { value: codigo } });
  fireEvent.submit(campo.closest("form"));
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  porCodigo.mockResolvedValue(FICHA);
  sugerencias.mockResolvedValue(SUGERENCIAS);
});

// --- El escáner -------------------------------------------------------------

describe("La consulta por escáner", () => {
  it("el campo arranca enfocado: el técnico no toca la pantalla", async () => {
    pintar(EscanerPage);

    expect(
      screen.getByLabelText("Código de barras o número de serie"),
    ).toHaveFocus();
  });

  it("una lectura trae lo que hace falta saber junto al equipo", async () => {
    pintar(EscanerPage);

    escanear("GA-LAP-000007");

    expect(await screen.findByText("Laptop Jefatura TI")).toBeInTheDocument();
    expect(porCodigo).toHaveBeenCalledWith("GA-LAP-000007");
    expect(screen.getByText("María Fernanda Salazar Ruiz")).toBeInTheDocument();
    expect(screen.getByText("Quito")).toBeInTheDocument();
    // La antigüedad se lee en años, no en un número de meses suelto.
    expect(screen.getByText("1 año y 2 meses")).toBeInTheDocument();
  });

  it("resume la última intervención y los movimientos de custodia", async () => {
    pintar(EscanerPage);

    escanear("GA-LAP-000007");

    expect(await screen.findByText(/Última intervención/)).toHaveTextContent(
      "Correctivo, Reemplazo de disco",
    );
    expect(
      screen.getByText("2 movimiento(s) de custodia registrados."),
    ).toBeInTheDocument();
  });

  it("ofrece las dos cosas que se hacen con el equipo en la mano", async () => {
    /* Mirarlo o anotar lo que le pasa. Con solo la ficha había que entrar en
       ella y buscar ahí dentro el botón de registrar, que es un rodeo justo
       cuando el técnico tiene el equipo delante y una avería que apuntar. */
    permisos.add("mantenimientos.registrar");

    pintar(EscanerPage);

    escanear("GA-LAP-000007");

    expect(
      await screen.findByRole("link", { name: /Ver ficha completa/ }),
    ).toHaveAttribute("href", "/admin/activos/7");
    expect(
      screen.getByRole("link", { name: /Registrar mantenimiento/ }),
    ).toHaveAttribute("href", "/admin/mantenimientos/new?activo=7");
  });

  it("sin el permiso de registrar, solo se ofrece la ficha", async () => {
    pintar(EscanerPage);

    escanear("GA-LAP-000007");

    expect(
      await screen.findByRole("link", { name: /Ver ficha completa/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Registrar mantenimiento/ }),
    ).not.toBeInTheDocument();
  });

  it("sobre un equipo que ya salió del parque tampoco", async () => {
    /* El backend rechaza la intervención; el estado está al lado del nombre
       para que se vea por qué no se ofrece. */
    permisos.add("mantenimientos.registrar");
    porCodigo.mockResolvedValue({
      ...FICHA,
      activo: {
        ...FICHA.activo,
        estado: "robado",
        estado_display: "Robado",
        esta_operativo: false,
      },
    });

    pintar(EscanerPage);

    escanear("GA-LAP-000007");

    expect(
      await screen.findByRole("link", { name: /Ver ficha completa/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Registrar mantenimiento/ }),
    ).not.toBeInTheDocument();
  });

  it("un código que no existe no deja la ficha anterior en pantalla", async () => {
    /* Sería el peor error posible aquí: el técnico leería los datos del equipo
       anterior creyendo que son los del que tiene en la mano. */
    pintar(EscanerPage);

    escanear("GA-LAP-000007");
    await screen.findByText("Laptop Jefatura TI");

    porCodigo.mockRejectedValue({ response: { status: 404, data: {} } });
    escanear("GA-XXX-999999");

    expect(
      await screen.findByText(/Ningún activo corresponde a "GA-XXX-999999"/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Laptop Jefatura TI")).not.toBeInTheDocument();
  });

  it("un fallo del servidor se distingue de un código inexistente", async () => {
    porCodigo.mockRejectedValue({ response: { status: 500, data: {} } });

    pintar(EscanerPage);

    escanear("GA-LAP-000007");

    expect(
      await screen.findByText("No se pudo consultar el activo."),
    ).toBeInTheDocument();
  });

  it("avisa cuando la lectora manda otra distribución de teclado", async () => {
    /* El backend repara el código y la búsqueda funciona, pero el mismo
       problema reaparecerá en la carga masiva y en el buscador, así que se
       dice aunque esta lectura haya salido bien. */
    porCodigo.mockResolvedValue({
      ...FICHA,
      advertencia_lector: {
        mensaje: "El guion llegó como apóstrofe.",
      },
    });

    pintar(EscanerPage);

    escanear("GA'LAP'000007");

    expect(
      await screen.findByText(/Revise la configuración del lector/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/El guion llegó como apóstrofe/),
    ).toBeInTheDocument();
  });

  it("guarda los escaneos anteriores para volver a uno sin repetir el disparo", async () => {
    pintar(EscanerPage);

    escanear("GA-LAP-000007");
    await screen.findByText("Laptop Jefatura TI");

    porCodigo.mockResolvedValue({
      ...FICHA,
      activo: {
        ...FICHA.activo,
        id: 8,
        codigo_barras: "GA-IMP-000008",
        nombre: "Impresora Bodega",
      },
    });
    escanear("GA-IMP-000008");
    await screen.findByText("Impresora Bodega");

    expect(await screen.findByText("Escaneos recientes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /GA-LAP-000007/ })).toHaveAttribute(
      "href",
      "/admin/activos/7",
    );
  });

  it("con una sola lectura todavía no hay historial que mostrar", async () => {
    pintar(EscanerPage);

    escanear("GA-LAP-000007");
    await screen.findByText("Laptop Jefatura TI");

    expect(screen.queryByText("Escaneos recientes")).not.toBeInTheDocument();
  });

  it("volver a escanear el mismo equipo no lo duplica en el historial", async () => {
    pintar(EscanerPage);

    escanear("GA-LAP-000007");
    await screen.findByText("Laptop Jefatura TI");
    escanear("GA-LAP-000007");
    await waitFor(() => expect(porCodigo).toHaveBeenCalledTimes(2));

    expect(screen.queryByText("Escaneos recientes")).not.toBeInTheDocument();
  });
});

// --- Las sugerencias de renovación ------------------------------------------

describe("Las sugerencias de renovación", () => {
  it("cada equipo dice qué superó, con qué valor y contra qué umbral", async () => {
    /* Es el propósito de la pantalla: dar al área financiera un respaldo
       cuantitativo. Sin las cifras no hay caso que presentar. */
    pintar(SugerenciasPage);

    const tarjeta = (await screen.findByText("Laptop Jefatura TI")).closest(
      "article",
    );
    expect(tarjeta).toHaveTextContent("Intervenciones");
    expect(tarjeta).toHaveTextContent("5");
    expect(tarjeta).toHaveTextContent("/ 3");
    expect(tarjeta).toHaveTextContent("Antigüedad");
    expect(tarjeta).toHaveTextContent("Política: Laptops corporativas");
  });

  it("dice cuántos hay en cada nivel", async () => {
    pintar(SugerenciasPage);

    expect(
      await screen.findByText(/2 equipo\(s\) superan al menos un umbral/),
    ).toHaveTextContent("1 con reemplazo recomendado y 1 a evaluar");
  });

  it("filtrar por nivel vuelve a preguntar solo por ese", async () => {
    pintar(SugerenciasPage);

    await screen.findByText("Laptop Jefatura TI");
    fireEvent.change(screen.getByLabelText("Filtrar por nivel de sugerencia"), {
      target: { value: "recomendado" },
    });

    await waitFor(() =>
      expect(sugerencias).toHaveBeenLastCalledWith({ nivel: "recomendado" }),
    );
  });

  it("sin filtro no se manda ninguno", async () => {
    pintar(SugerenciasPage);

    await screen.findByText("Laptop Jefatura TI");
    expect(sugerencias).toHaveBeenCalledWith(undefined);
  });

  it("un parque sano se dice como buena noticia, no como una tabla vacía", async () => {
    sugerencias.mockResolvedValue({ total: 0, resultados: [] });

    pintar(SugerenciasPage);

    expect(
      await screen.findByText(
        "Ningún equipo excede hoy los umbrales configurados.",
      ),
    ).toBeInTheDocument();
  });

  it("con un nivel filtrado, el vacío se refiere a ese nivel", async () => {
    /* «Ningún equipo excede los umbrales» sería falso si solo se está mirando
       un nivel. */
    sugerencias.mockResolvedValue({ total: 0, resultados: [] });

    pintar(SugerenciasPage);

    await screen.findByText(/Ningún equipo/);
    fireEvent.change(screen.getByLabelText("Filtrar por nivel de sugerencia"), {
      target: { value: "evaluar" },
    });

    expect(
      await screen.findByText("Ningún equipo está hoy en ese nivel."),
    ).toBeInTheDocument();
  });

  it("quien configura los umbrales llega desde aquí", async () => {
    permisos.add("politicas.editar");

    pintar(SugerenciasPage);

    expect(
      await screen.findByRole("link", { name: "Configurar umbrales" }),
    ).toHaveAttribute("href", "/admin/politicas");
  });

  it("quien no los configura no ve ese atajo", async () => {
    pintar(SugerenciasPage);

    await screen.findByText("Laptop Jefatura TI");
    expect(
      screen.queryByRole("link", { name: "Configurar umbrales" }),
    ).not.toBeInTheDocument();
  });

  it("si no cargan, lo dice", async () => {
    sugerencias.mockRejectedValue(new Error("500"));

    pintar(SugerenciasPage);

    expect(
      await screen.findByText(
        "No se pudieron cargar las sugerencias de renovación.",
      ),
    ).toBeInTheDocument();
  });
});
