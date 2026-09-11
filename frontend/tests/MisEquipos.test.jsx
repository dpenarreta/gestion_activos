import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * «Mis equipos»: la única pantalla del rol «Usuario final» del §13.
 *
 * Lo que no muestra es tan deliberado como lo que muestra —fuera quedan el
 * costo, el proveedor, el veredicto de renovación y el historial de
 * custodios—, así que eso se prueba explícitamente: son datos del inventario,
 * no del aparato que uno usa.
 *
 * Y el caso que parece un detalle y no lo es: una cuenta sin ficha de empleado
 * no es una lista vacía. «No tienes equipos» y «tu cuenta no está enlazada» se
 * arreglan de formas muy distintas, y la segunda necesita a un administrador.
 */

const consultar = vi.fn();

vi.mock("../src/api/activosService", () => ({
  misEquiposService: { consultar: (...args) => consultar(...args) },
}));

const permisos = { lista: [], autenticado: true };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { permissions: permisos.lista },
    isAuthenticated: permisos.autenticado,
  }),
}));

const { MisEquiposPage } =
  await import("../src/pages/Admin/MisEquipos/MisEquiposPage");
const { InicioDelPanel } = await import("../src/routes/InicioDelPanel");

/** Una entrega de hace poco más de un año, para leer el «hace…». */
function haceDias(dias) {
  return new Date(Date.now() - dias * 86400000).toISOString();
}

const DATOS = {
  empleado: {
    nombre: "Ana Cevallos",
    codigo: "CTB-0007",
    departamento: "Contabilidad",
  },
  equipos: [
    {
      id: 7,
      codigo_barras: "GA-LAP-000007",
      nombre: "Laptop Contabilidad 01",
      tipo_nombre: "Laptop",
      marca: "Dell",
      modelo: "Latitude 5440",
      numero_serie: "DL5440-0011",
      especificaciones: { RAM: "16 GB" },
      estado: "en_uso",
      estado_display: "Asignado",
      ciudad: "Quito",
      departamento_nombre: "Contabilidad",
      desde: haceDias(411),
    },
  ],
  aviso: null,
};

function pintar() {
  return render(
    <MemoryRouter>
      <MisEquiposPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = [];
  permisos.autenticado = true;
  consultar.mockResolvedValue(DATOS);
});

// --- Lo que muestra ---------------------------------------------------------

describe("Mis equipos", () => {
  it("lista los equipos propios con lo que hace falta para pedir soporte", async () => {
    /* El código de la etiqueta y la serie son lo que se dicta por teléfono. */
    pintar();

    expect(
      await screen.findByText("Laptop Contabilidad 01"),
    ).toBeInTheDocument();
    const tarjeta = screen
      .getByText("Laptop Contabilidad 01")
      .closest("article");
    expect(tarjeta).toHaveTextContent("GA-LAP-000007");
    expect(tarjeta).toHaveTextContent("DL5440-0011");
    expect(tarjeta).toHaveTextContent("Laptop · Dell Latitude 5440");
  });

  it("dice quién es, para que se vea que la lista es la suya", async () => {
    pintar();

    expect(
      await screen.findByText(/Ana Cevallos · CTB-0007 · Contabilidad/),
    ).toBeInTheDocument();
  });

  it("el «desde cuándo» se lee en años y meses, no solo como fecha", async () => {
    /* La fecha sola obliga a contar: lo que se quiere saber es si el equipo
       lleva dos meses o cuatro años. */
    pintar();

    await screen.findByText("Laptop Contabilidad 01");
    expect(screen.getByText(/hace 1 año, 1 mes y 21 días/)).toBeInTheDocument();
  });

  it("un equipo sin entrega registrada lo dice en vez de fingir una fecha", async () => {
    consultar.mockResolvedValue({
      ...DATOS,
      equipos: [{ ...DATOS.equipos[0], desde: null }],
    });

    pintar();

    expect(
      await screen.findByText("Sin registro de entrega"),
    ).toBeInTheDocument();
  });

  it("recuerda qué hacer con la pantalla, no solo qué muestra", async () => {
    pintar();

    expect(
      await screen.findByText(/indique el código del equipo/),
    ).toBeInTheDocument();
  });
});

// --- Lo que deliberadamente no muestra --------------------------------------

describe("Lo que esta pantalla no enseña", () => {
  it("ni costo, ni proveedor, ni el veredicto de renovación", async () => {
    /* Son datos del inventario. El veredicto además es una decisión de
       planificación —«este equipo se reemplaza el año que viene»— que no se
       comunica por una pantalla. */
    pintar();

    await screen.findByText("Laptop Contabilidad 01");
    const tarjeta = screen
      .getByText("Laptop Contabilidad 01")
      .closest("article");

    for (const ausente of [/costo/i, /proveedor/i, /renovaci/i, /reemplaz/i]) {
      expect(tarjeta.textContent).not.toMatch(ausente);
    }
  });

  it("tampoco quién tuvo antes el equipo", async () => {
    /* No es asunto de quien lo tiene ahora. */
    pintar();

    await screen.findByText("Laptop Contabilidad 01");
    expect(screen.queryByText(/custodio/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/historial/i)).not.toBeInTheDocument();
  });
});

// --- Los dos vacíos, que no son el mismo ------------------------------------

describe("Cuando no hay nada que listar", () => {
  it("sin equipos, dice qué hacer si acaba de recibir uno", async () => {
    consultar.mockResolvedValue({ ...DATOS, equipos: [] });

    pintar();

    expect(
      await screen.findByText(/No tiene equipos a su cargo/),
    ).toBeInTheDocument();
  });

  it("sin ficha de empleado es otra cosa, y la arregla un administrador", async () => {
    consultar.mockResolvedValue({
      empleado: null,
      equipos: [],
      aviso:
        "Su cuenta todavía no está enlazada a una ficha de empleado, así que el sistema no sabe qué equipos son suyos.",
    });

    pintar();

    expect(
      await screen.findByText(/no está enlazada a una ficha de empleado/),
    ).toBeInTheDocument();
    // Y no el otro mensaje: mandaría a pedirle a soporte que registre una
    // entrega que no es el problema.
    expect(
      screen.queryByText(/No tiene equipos a su cargo/),
    ).not.toBeInTheDocument();
  });

  it("con la ficha en otra empresa, el aviso dice cuál", async () => {
    /* Cambiar de empresa no borra los equipos de nadie, y esto lo resuelve
       quien mira con el selector del menú. */
    consultar.mockResolvedValue({
      empleado: null,
      equipos: [],
      aviso:
        "Su ficha de empleado está en LaarSeguridad. Cambie de empresa en el menú para ver los equipos que tiene a su cargo.",
    });

    pintar();

    expect(
      await screen.findByText(/Su ficha de empleado está en LaarSeguridad/),
    ).toBeInTheDocument();
  });

  it("si no cargan, lo dice", async () => {
    consultar.mockRejectedValue(new Error("500"));

    pintar();

    expect(
      await screen.findByText("No se pudieron cargar sus equipos."),
    ).toBeInTheDocument();
  });
});

// --- Por dónde entra al panel -----------------------------------------------

describe("A dónde lleva /admin", () => {
  function pintarInicio() {
    return render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<InicioDelPanel />} />
          <Route path="*" element={<Destino />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  function Destino() {
    return <p>Destino: {useLocation().pathname}</p>;
  }

  it("a quien solo ve lo suyo lo deja en su pantalla, no en un 403", async () => {
    /* Antes se iba siempre al panel principal, que exige `activos.ver`: el
       usuario final entraba al sistema y chocaba con un 403 teniendo su
       pantalla a un clic. */
    permisos.lista = ["activos.ver_asignados"];

    pintarInicio();

    expect(screen.getByText("Destino: /admin/mis-equipos")).toBeInTheDocument();
  });

  it("a quien opera el inventario lo deja en el panel principal", async () => {
    permisos.lista = ["activos.ver", "activos.ver_asignados"];

    pintarInicio();

    expect(screen.getByText("Destino: /admin/dashboard")).toBeInTheDocument();
  });

  it("sin ningún permiso, el 403 es la verdad", async () => {
    /* La cuenta existe pero todavía no tiene nada asignado; mandarla a una
       pantalla cualquiera solo movería el error de sitio. */
    permisos.lista = [];

    pintarInicio();

    expect(screen.getByText("Destino: /403")).toBeInTheDocument();
  });
});
