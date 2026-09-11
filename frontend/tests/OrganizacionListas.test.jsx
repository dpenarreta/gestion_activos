import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Los cinco catálogos de la organización: sedes, departamentos, empleados,
 * proveedores y concesionarios.
 *
 * Comparten mecánica —buscar, filtrar por estado, paginar— y comparten la
 * regla que importa: quien no puede editar entra igual, pero en modo lectura.
 * Un botón «Editar» que termina en un 403 es peor que no ofrecerlo.
 *
 * Se prueban juntos y con una tabla de casos porque lo que se quiere sostener
 * es justamente que se comporten igual: si uno se desvía, la tabla lo dice sin
 * que haya que acordarse de replicar la prueba en los otros cuatro.
 */

const listar = {
  sedes: vi.fn(),
  departamentos: vi.fn(),
  empleados: vi.fn(),
  proveedores: vi.fn(),
  concesionarios: vi.fn(),
};

vi.mock("../src/api/organizacionService", () => ({
  sedesService: { list: (...args) => listar.sedes(...args) },
  departamentosService: { list: (...args) => listar.departamentos(...args) },
  empleadosService: { list: (...args) => listar.empleados(...args) },
  proveedoresService: { list: (...args) => listar.proveedores(...args) },
  concesionariosService: { list: (...args) => listar.concesionarios(...args) },
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { SedesList } = await import("../src/pages/Admin/Organizacion/SedesList");
const { DepartamentosList } =
  await import("../src/pages/Admin/Organizacion/DepartamentosList");
const { EmpleadosList } =
  await import("../src/pages/Admin/Organizacion/EmpleadosList");
const { ProveedoresList } =
  await import("../src/pages/Admin/Organizacion/ProveedoresList");
const { ConcesionariosList } =
  await import("../src/pages/Admin/Organizacion/ConcesionariosList");

const FILAS = {
  sedes: [
    {
      id: 1,
      nombre: "Matriz Quito",
      ciudad: "Quito",
      direccion: "Av. Amazonas",
      total_activos: 12,
      activa: true,
    },
  ],
  departamentos: [
    {
      id: 2,
      codigo: "TEC",
      nombre: "Tecnología",
      responsable_nombre: "Ana Cevallos",
      total_empleados: 4,
      total_activos: 9,
      activo: true,
    },
  ],
  empleados: [
    {
      id: 3,
      codigo_empleado: "EMP-0003",
      nombre_completo: "Luis Mora",
      cargo: "Analista",
      departamento_nombre: "Tecnología",
      total_activos: 2,
      activo: true,
    },
  ],
  proveedores: [
    {
      id: 4,
      nombre: "Tecnomega C.A.",
      identificacion: "0991234567001",
      contacto: "Paola Vaca",
      telefono: "0999999999",
      total_activos: 6,
      total_repuestos: 3,
      activo: true,
    },
  ],
  concesionarios: [
    {
      id: 5,
      nombre: "Servientrega Andina",
      identificacion: "0992222333001",
      contacto: "Jorge Andrade",
      telefono: "0988888888",
      total_activos: 4,
      activo: true,
    },
  ],
};

/* Los cinco listados, con lo que distingue a cada uno. */
const CATALOGOS = [
  {
    clave: "sedes",
    Pantalla: SedesList,
    titulo: "Sedes",
    alta: "Nueva sede",
    buscar: "Buscar sedes",
    vacio: "Sin sedes registradas",
    error: "No se pudo cargar el listado de sedes.",
    identifica: "Matriz Quito",
    ruta: "/admin/organizacion/sedes/1",
  },
  {
    clave: "departamentos",
    Pantalla: DepartamentosList,
    titulo: "Departamentos",
    alta: "Nuevo departamento",
    buscar: "Buscar departamentos",
    vacio: "Sin departamentos registrados",
    error: "No se pudo cargar el listado de departamentos.",
    identifica: "Tecnología",
    ruta: "/admin/organizacion/departamentos/2",
  },
  {
    clave: "empleados",
    Pantalla: EmpleadosList,
    titulo: "Empleados",
    alta: "Nuevo empleado",
    buscar: "Buscar empleados",
    vacio: "Sin empleados registrados",
    error: "No se pudo cargar el listado de empleados.",
    identifica: "Luis Mora",
    ruta: "/admin/organizacion/empleados/3",
  },
  {
    clave: "proveedores",
    Pantalla: ProveedoresList,
    titulo: "Proveedores",
    alta: "Nuevo proveedor",
    buscar: "Buscar proveedores",
    vacio: "Sin proveedores registrados",
    error: "No se pudo cargar el listado de proveedores.",
    identifica: "Tecnomega C.A.",
    ruta: "/admin/organizacion/proveedores/4",
  },
  {
    clave: "concesionarios",
    Pantalla: ConcesionariosList,
    titulo: "Concesionarios",
    alta: "Nuevo concesionario",
    buscar: "Buscar concesionarios",
    vacio: "Sin concesionarios registrados",
    error: "No se pudo cargar el listado de concesionarios.",
    identifica: "Servientrega Andina",
    ruta: "/admin/organizacion/concesionarios/5",
  },
];

function pintar(Pantalla) {
  return render(
    <MemoryRouter>
      <Pantalla />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  for (const [clave, fn] of Object.entries(listar)) {
    fn.mockResolvedValue({ results: FILAS[clave], count: FILAS[clave].length });
  }
});

// --- Lo que los cuatro deben cumplir ----------------------------------------

describe.each(CATALOGOS)(
  "$titulo",
  ({ clave, Pantalla, alta, buscar, vacio, error, identifica, ruta }) => {
    it("lista lo registrado", async () => {
      pintar(Pantalla);

      expect(await screen.findByText(identifica)).toBeInTheDocument();
    });

    it("sin permiso de edición se entra a mirar, no a editar", async () => {
      /* El catálogo se consulta más de lo que se cambia: negar la pantalla
         entera obligaría a pedirle el dato a otra persona. */
      pintar(Pantalla);

      await screen.findByText(identifica);
      expect(
        screen.queryByRole("link", { name: alta }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Ver" })).toHaveAttribute(
        "href",
        ruta,
      );
    });

    it("con permiso aparecen el alta y la edición", async () => {
      permisos.add("organizacion.editar");

      pintar(Pantalla);

      await screen.findByText(identifica);
      expect(screen.getByRole("link", { name: alta })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute(
        "href",
        ruta,
      );
    });

    it("la búsqueda se envía al confirmar", async () => {
      pintar(Pantalla);

      await screen.findByText(identifica);
      const campo = screen.getByLabelText(buscar);
      fireEvent.change(campo, { target: { value: "quito" } });
      fireEvent.submit(campo.closest("form"));

      await waitFor(() =>
        expect(listar[clave].mock.calls.at(-1)[0]).toMatchObject({
          q: "quito",
        }),
      );
    });

    it("el filtro de estado consulta de nuevo", async () => {
      pintar(Pantalla);

      await screen.findByText(identifica);
      fireEvent.change(screen.getByLabelText("Filtrar por estado"), {
        target: { value: "false" },
      });

      await waitFor(() =>
        expect(Object.values(listar[clave].mock.calls.at(-1)[0])).toContain(
          "false",
        ),
      );
    });

    it("vacío lo dice, en vez de una tabla sin explicación", async () => {
      listar[clave].mockResolvedValue({ results: [], count: 0 });

      pintar(Pantalla);

      expect(await screen.findByText(vacio)).toBeInTheDocument();
    });

    it("si no carga lo dice", async () => {
      listar[clave].mockRejectedValue(new Error("500"));

      pintar(Pantalla);

      expect(await screen.findByText(error)).toBeInTheDocument();
    });
  },
);

// --- Lo propio de cada uno --------------------------------------------------

describe("Lo que cada catálogo muestra de más", () => {
  it("las sedes dicen si están abiertas y cuántos equipos hay dentro", async () => {
    pintar(SedesList);

    const fila = (await screen.findByText("Matriz Quito")).closest("tr");
    expect(fila).toHaveTextContent("Quito");
    expect(fila).toHaveTextContent("Abierta");
    expect(fila).toHaveTextContent("12");
  });

  it("una sede cerrada se distingue de un vistazo", async () => {
    listar.sedes.mockResolvedValue({
      results: [{ ...FILAS.sedes[0], activa: false }],
      count: 1,
    });

    pintar(SedesList);

    expect(await screen.findByText("Cerrada")).toBeInTheDocument();
  });

  it("los departamentos dicen quién responde por el área", async () => {
    pintar(DepartamentosList);

    const fila = (await screen.findByText("Tecnología")).closest("tr");
    expect(fila).toHaveTextContent("TEC");
    expect(fila).toHaveTextContent("Ana Cevallos");
  });

  it("sin responsable asignado se marca, no se deja en blanco", async () => {
    listar.departamentos.mockResolvedValue({
      results: [{ ...FILAS.departamentos[0], responsable_nombre: null }],
      count: 1,
    });

    pintar(DepartamentosList);

    const fila = (await screen.findByText("Tecnología")).closest("tr");
    expect(fila).toHaveTextContent("—");
  });

  it("los activos a cargo de un empleado llevan a esos equipos", async () => {
    /* Es la pregunta que se hace al dar de baja a alguien: qué tiene que
       devolver. Un número suelto obliga a filtrar el inventario a mano. */
    pintar(EmpleadosList);

    await screen.findByText("Luis Mora");
    expect(screen.getByRole("link", { name: "2" })).toHaveAttribute(
      "href",
      "/admin/activos?custodio=3",
    );
  });

  it("sin equipos a cargo no hay enlace a ninguna parte", async () => {
    listar.empleados.mockResolvedValue({
      results: [{ ...FILAS.empleados[0], total_activos: 0 }],
      count: 1,
    });

    pintar(EmpleadosList);

    await screen.findByText("Luis Mora");
    expect(screen.queryByRole("link", { name: "0" })).not.toBeInTheDocument();
  });

  it("los proveedores traen a quién llamar y qué se les compró", async () => {
    /* Se consulta justo cuando algo falló: el RUC sin un teléfono al lado no
       sirve para reclamar. */
    pintar(ProveedoresList);

    const fila = (await screen.findByText("Tecnomega C.A.")).closest("tr");
    expect(fila).toHaveTextContent("0991234567001");
    expect(fila).toHaveTextContent("0999999999");
    expect(fila).toHaveTextContent("6");
    expect(fila).toHaveTextContent("3");
  });

  it("un proveedor dado de baja se distingue del activo", async () => {
    listar.proveedores.mockResolvedValue({
      results: [{ ...FILAS.proveedores[0], activo: false }],
      count: 1,
    });

    pintar(ProveedoresList);

    expect(await screen.findByText("De baja")).toBeInTheDocument();
  });
});

// --- Lo que distingue al concesionario del proveedor ------------------------

describe("Concesionarios", () => {
  it("cuenta los equipos que son del partner y lleva a verlos", async () => {
    /* Es la pregunta que se hace al cerrar una concesión: qué hay que
       devolverle. */
    pintar(ConcesionariosList);

    await screen.findByText("Servientrega Andina");
    expect(screen.getByRole("link", { name: "4" })).toHaveAttribute(
      "href",
      "/activos?propiedad=concesion&concesionario=5",
    );
  });

  it("no cuenta repuestos: a un concesionario no se le compra nada", async () => {
    /* Es justo la diferencia con el proveedor, y la tabla no debe insinuar
       que sea el mismo catálogo. */
    pintar(ConcesionariosList);

    await screen.findByText("Servientrega Andina");
    expect(
      screen.queryByRole("columnheader", { name: "Repuestos" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Equipos suyos" }),
    ).toBeInTheDocument();
  });
});
