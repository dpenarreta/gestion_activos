import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El menú del panel.
 *
 * Es lo primero que ve cada persona y lo que define de qué tamaño le parece el
 * sistema: un permiso que se olvida de filtrar aquí ofrece una pantalla que
 * termina en un 403, y un grupo que se queda sin hijos visibles deja un título
 * que no lleva a ninguna parte.
 *
 * Además intercepta la navegación en vez de dejar que el enlace la haga solo:
 * es lo que permite preguntar antes de abandonar un formulario a medio llenar,
 * sin renunciar a que un ctrl+clic siga abriendo en otra pestaña.
 */

const permisos = { lista: [], autenticado: true };
const logout = vi.fn();

vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { permissions: permisos.lista },
    isAuthenticated: permisos.autenticado,
    logout,
  }),
}));

vi.mock("../src/hooks/useTheme", () => ({
  useTheme: () => ({ theme: { site_name: "Gestión de Activos" } }),
}));

// Con una sola empresa el selector no se dibuja; aquí no es lo que se prueba.
vi.mock("../src/api/empresasService", () => ({
  empresasService: {
    mias: vi.fn(() => Promise.resolve({ empresas: [], activa: null })),
  },
}));

vi.mock("../src/api/client", () => ({
  getEmpresaActiva: () => null,
  setEmpresaActiva: vi.fn(),
}));

const { AdminSidebar } =
  await import("../src/components/admin/AdminSidebar/AdminSidebar");
const { UnsavedChangesProvider } =
  await import("../src/context/UnsavedChangesContext");

/** Deja ver a dónde llevó el menú. */
function Ruta() {
  return <p>Ruta: {useLocation().pathname}</p>;
}

function pintar({ ruta = "/admin/activos", colapsado = false } = {}) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <UnsavedChangesProvider>
        <AdminSidebar isCollapsed={colapsado} onToggleCollapse={vi.fn()} />
        <Routes>
          <Route path="*" element={<Ruta />} />
        </Routes>
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = [];
  permisos.autenticado = true;
});

// --- Qué se ofrece ----------------------------------------------------------

describe("Lo que el menú ofrece depende del permiso", () => {
  it("sin permisos no ofrece ninguna sección", async () => {
    /* Ofrecer una pantalla que termina en un 403 hace parecer roto el sistema
       en vez de restringido. */
    pintar();

    expect(screen.queryByText("Activos")).not.toBeInTheDocument();
    expect(screen.queryByText("Mantenimientos")).not.toBeInTheDocument();
  });

  it("cada permiso trae su sección", () => {
    permisos.lista = ["activos.ver", "mantenimientos.ver"];

    pintar();

    expect(screen.getByText("Activos")).toBeInTheDocument();
    expect(screen.getByText("Mantenimientos")).toBeInTheDocument();
    expect(screen.queryByText("Reportes")).not.toBeInTheDocument();
  });

  it("quien solo puede pedir ve Solicitudes y sus tres pantallas", () => {
    permisos.lista = ["solicitudes.ver", "solicitudes.crear"];

    pintar();

    expect(screen.getByText("Solicitudes")).toBeInTheDocument();
    expect(screen.getByText("Mis solicitudes")).toBeInTheDocument();
    expect(screen.getByText("Solicitudes recibidas")).toBeInTheDocument();
    expect(screen.getByText("Realizar solicitud")).toBeInTheDocument();
  });

  it("un auditor sin acceso a usuarios igual llega a Auditoría", () => {
    /* La entrada cuelga de «Usuarios y roles», que pide `usuarios.ver`. Con
       permiso propio, el grupo se abre solo con esta dentro; sin él, quien
       audita no encontraría la pantalla por ningún lado del menú. */
    permisos.lista = ["auditoria.ver"];

    pintar();

    expect(screen.getByText("Usuarios y roles")).toBeInTheDocument();
    expect(screen.getByText("Auditoría")).toBeInTheDocument();
    expect(screen.queryByText("Usuarios")).not.toBeInTheDocument();
    expect(screen.queryByText("Roles y permisos")).not.toBeInTheDocument();
  });

  it("quien administra usuarios pero no audita no ve Auditoría", () => {
    permisos.lista = ["usuarios.ver"];

    pintar();

    expect(screen.getByText("Usuarios")).toBeInTheDocument();
    expect(screen.queryByText("Auditoría")).not.toBeInTheDocument();
  });

  it("quien consulta solicitudes pero no las hace no ve el formulario", () => {
    /* Ofrecérselo lo llevaría a un 403: el permiso de crear es aparte. */
    permisos.lista = ["solicitudes.ver"];

    pintar();

    expect(screen.getByText("Mis solicitudes")).toBeInTheDocument();
    expect(screen.queryByText("Realizar solicitud")).not.toBeInTheDocument();
  });

  it("Organización cuelga de Configuración, con sus catálogos dentro", () => {
    /* Tres niveles: Configuración → Organización → Sedes. El grupo no se
       disuelve entre los otros cuatro, que se quedan donde estaban. */
    permisos.lista = ["configuracion.ver", "organizacion.ver"];

    pintar();

    const configuracion = screen
      .getByRole("button", { name: /Configuración/ })
      .closest("li");
    const organizacion = within(configuracion).getByRole("button", {
      name: /Organización/,
    });
    expect(organizacion).toBeInTheDocument();
    expect(
      within(organizacion.closest("li")).getByText("Sedes"),
    ).toBeInTheDocument();
    // Y los que ya estaban siguen colgando de Configuración, no de dentro del
    // grupo nuevo.
    expect(within(configuracion).getByText("Identidad")).toBeInTheDocument();
    expect(
      within(organizacion.closest("li")).queryByText("Identidad"),
    ).not.toBeInTheDocument();
  });

  it("los catálogos se filtran por su permiso, no por el del abuelo", () => {
    /* Antes el filtro solo miraba un nivel: los seis catálogos habrían
       heredado `configuracion.ver` y se los habría visto quien solo cambia los
       colores del sitio. */
    permisos.lista = ["configuracion.ver"];

    pintar();

    expect(screen.getByText("Identidad")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Organización/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Sedes")).not.toBeInTheDocument();
  });

  it("quien solo administra catálogos entra por Configuración", () => {
    permisos.lista = ["organizacion.ver"];

    pintar();

    const configuracion = screen
      .getByRole("button", { name: /Configuración/ })
      .closest("li");
    expect(
      within(configuracion).getByRole("button", { name: /Organización/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Identidad")).not.toBeInTheDocument();
  });

  it("un hijo con su propio permiso se filtra aparte del grupo", () => {
    /* «Empresas» cuelga de Configuración pero exige `empresas.ver`: quien
       administra la marca del sitio no tiene por qué crear organizaciones. */
    permisos.lista = ["configuracion.ver"];

    pintar({ ruta: "/admin/configuracion/identidad" });

    fireEvent.click(screen.getByRole("button", { name: /Configuración/ }));
    expect(screen.getByText("Identidad")).toBeInTheDocument();
    expect(screen.queryByText("Empresas")).not.toBeInTheDocument();
  });

  it("con el permiso, ese hijo aparece", () => {
    permisos.lista = ["configuracion.ver", "empresas.ver"];

    pintar({ ruta: "/admin/configuracion/identidad" });

    fireEvent.click(screen.getByRole("button", { name: /Configuración/ }));
    expect(screen.getByText("Empresas")).toBeInTheDocument();
  });

  it("sin sesión el menú queda vacío", () => {
    permisos.lista = ["activos.ver"];
    permisos.autenticado = false;

    pintar();

    expect(screen.queryByText("Activos")).not.toBeInTheDocument();
  });
});

// --- Dónde estoy ------------------------------------------------------------

describe("El menú dice dónde se está", () => {
  it("marca la sección abierta, también desde una ruta hija", () => {
    /* Estando en la ficha de un activo se sigue estando en «Inventario»: sin
       la marca, cada pantalla profunda parece salirse del menú. */
    permisos.lista = ["activos.ver"];

    pintar({ ruta: "/admin/activos/7" });

    const grupo = screen.getByRole("button", { name: /Activos/ });
    expect(grupo.className).toContain("is-active");
  });

  it("un grupo se abre y se cierra", () => {
    permisos.lista = ["mantenimientos.ver"];

    pintar({ ruta: "/admin/reportes" });

    const grupo = screen.getByRole("button", { name: /Mantenimientos/ });
    expect(grupo).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(grupo);
    expect(grupo).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(grupo);
    expect(grupo).toHaveAttribute("aria-expanded", "false");
  });

  it("una pantalla de tercer nivel abre los dos grupos que la contienen", () => {
    /* Llegar por un enlace a «Sedes» y encontrar el menú cerrado obliga a
       adivinar de dónde cuelga lo que se está mirando. */
    permisos.lista = ["configuracion.ver", "organizacion.ver"];

    pintar({ ruta: "/admin/organizacion/sedes" });

    expect(
      screen.getByRole("button", { name: /Configuración/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: /Organización/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("el grupo de la pantalla actual llega abierto", () => {
    /* Llegar con el menú cerrado obligaría a buscar de nuevo dónde se está. */
    permisos.lista = ["mantenimientos.ver"];

    pintar({ ruta: "/admin/mantenimientos" });

    expect(
      screen.getByRole("button", { name: /Mantenimientos/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});

// --- La navegación ----------------------------------------------------------

describe("Navegar desde el menú", () => {
  it("un clic normal navega", () => {
    permisos.lista = ["activos.ver"];

    pintar({ ruta: "/admin/reportes" });

    fireEvent.click(screen.getByRole("button", { name: /Activos/ }));
    fireEvent.click(screen.getByText("Inventario"));

    expect(screen.getByText("Ruta: /admin/activos")).toBeInTheDocument();
  });

  it("un ctrl+clic se deja pasar, para abrir en otra pestaña", () => {
    /* Interceptar todos los clics rompería el gesto de siempre; el enlace
       tiene `href` de verdad justamente para esto. */
    permisos.lista = ["activos.ver"];

    pintar({ ruta: "/admin/reportes" });

    fireEvent.click(screen.getByRole("button", { name: /Activos/ }));
    const enlace = screen.getByText("Inventario").closest("a");
    expect(enlace).toHaveAttribute("href", "/admin/activos");

    fireEvent.click(enlace, { ctrlKey: true });
    // El navegador se encarga; la pantalla actual no cambia.
    expect(screen.getByText("Ruta: /admin/reportes")).toBeInTheDocument();
  });
});

// --- Cerrar sesión y contraer -----------------------------------------------

describe("El pie del menú", () => {
  it("cierra la sesión", () => {
    pintar();

    fireEvent.click(screen.getByRole("button", { name: /Cerrar sesión/ }));

    expect(logout).toHaveBeenCalled();
  });

  it("contraído, cada elemento conserva su nombre accesible", () => {
    /* Con solo íconos, un botón sin nombre es indistinguible de otro para
       quien navega con lector de pantalla. */
    permisos.lista = ["activos.ver"];

    pintar({ colapsado: true });

    expect(
      screen.getByRole("button", { name: "Cerrar sesión" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expandir menú" }),
    ).toBeInTheDocument();
  });

  it("expandido, el botón invita a contraer y no al revés", () => {
    pintar();

    expect(
      screen.getByRole("button", { name: "Contraer menú" }),
    ).toBeInTheDocument();
  });

  it("el logo lleva al inicio y dice a dónde va", () => {
    pintar();

    expect(
      screen.getByRole("link", { name: /Gestión de Activos — Ir al inicio/ }),
    ).toHaveAttribute("href", "/");
  });

  it("contraído, la marca se abrevia en vez de desbordar", () => {
    pintar({ colapsado: true });

    const marca = screen.getByRole("link", { name: /Ir al inicio/ });
    expect(within(marca).queryByText("Gestión de Activos")).toBeNull();
    // El glifo de la identidad base: las iniciales, como «MA» en la Matriz.
    expect(marca).toHaveTextContent("GA");
  });
});
