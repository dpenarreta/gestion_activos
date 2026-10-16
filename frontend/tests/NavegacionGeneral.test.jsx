import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Lo general del sistema —Reportes y Configuración, con usuarios, roles y
 * permisos— no depende del módulo: va en el bloque «General» del menú, igual en
 * todos, y Reportes es uno solo con una pestaña por asunto.
 */

const sesion = { permisos: [], inicializando: false };

vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { permissions: sesion.permisos },
    isAuthenticated: true,
    isInitializing: sesion.inicializando,
    logout: vi.fn(),
  }),
}));
vi.mock("../src/hooks/useTheme", () => ({
  useTheme: () => ({ theme: { site_name: "Gestión de Activos" } }),
}));
vi.mock("../src/api/empresasService", () => ({
  empresasService: {
    mias: vi.fn(() => Promise.resolve({ empresas: [], activa: null })),
  },
}));
vi.mock("../src/api/client", () => ({
  getEmpresaActiva: () => null,
  setEmpresaActiva: vi.fn(),
}));
vi.mock("../src/api/matrizService", () => ({
  matrizService: { resumen: vi.fn(() => new Promise(() => {})) },
}));

const { AdminSidebar } =
  await import("../src/components/admin/AdminSidebar/AdminSidebar");
const { UnsavedChangesProvider } =
  await import("../src/context/UnsavedChangesContext");
const { ReportesMarco, ReportesInicio } =
  await import("../src/components/admin/ReportesMarco/ReportesMarco");
const { moduloDeRuta } = await import("../src/modulos/modulos");

function Ruta() {
  return <p>Ruta: {useLocation().pathname}</p>;
}

function pintarMenu(ruta) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <UnsavedChangesProvider>
        <AdminSidebar isCollapsed={false} onToggleCollapse={vi.fn()} />
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

function bloqueGeneral() {
  return screen.getByText("General").closest(".mz-nav-general");
}

beforeEach(() => {
  sesion.permisos = [
    "activos.ver",
    "reportes.ver",
    "usuarios.ver",
    "roles.ver",
    "matriz.crear",
  ];
  sesion.inicializando = false;
});

describe("El bloque «General» del menú", () => {
  it.each([
    ["Gestión de Activos", "/admin/dashboard"],
    ["Matriz", "/admin/matriz/resumen"],
  ])(
    "en %s lleva Reportes y Configuración, y no en el bloque del módulo",
    (_, ruta) => {
      pintarMenu(ruta);
      const general = within(bloqueGeneral());
      expect(
        general.getByRole("link", { name: /Reportes/ }),
      ).toBeInTheDocument();
      expect(
        general.getByRole("link", { name: /Configuración/ }),
      ).toBeInTheDocument();
      const modulo = within(
        document.querySelector(".mz-nav:not(.mz-nav--general)"),
      );
      expect(
        modulo.queryByRole("link", { name: /Reportes|Configuración/ }),
      ).toBeNull();
    },
  );

  it("la Matriz ya no tiene su propio Reportes", () => {
    pintarMenu("/admin/matriz/resumen");
    expect(screen.getAllByRole("link", { name: /Reportes/ })).toHaveLength(1);
  });

  it("Reportes aparece también para quien solo tiene la Matriz", () => {
    sesion.permisos = ["matriz.crear"];
    pintarMenu("/admin/matriz/resumen");
    expect(
      within(bloqueGeneral()).getByRole("link", { name: /Reportes/ }),
    ).toBeInTheDocument();
  });

  it("las rutas de Reportes no cambian de módulo", () => {
    expect(moduloDeRuta("/admin/reportes")).toBeNull();
    expect(moduloDeRuta("/admin/reportes/matriz")).toBeNull();
    expect(moduloDeRuta("/admin/users")).toBeNull();
  });
});

describe("Reportes, uno solo con pestañas", () => {
  function pintarReportes(ruta) {
    return render(
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route
            path="/admin/reportes"
            element={
              <ReportesInicio>
                <ReportesMarco>
                  <p>inventario</p>
                </ReportesMarco>
              </ReportesInicio>
            }
          />
          <Route
            path="/admin/reportes/matriz"
            element={
              <ReportesMarco>
                <p>matriz</p>
              </ReportesMarco>
            }
          />
          <Route path="*" element={<Ruta />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("muestra una pestaña por asunto que se puede abrir", () => {
    pintarReportes("/admin/reportes/matriz");
    const pestanas = within(
      screen.getByRole("navigation", { name: "Reportes" }),
    );
    expect(pestanas.getByRole("link", { name: "Inventario" })).toHaveAttribute(
      "href",
      "/admin/reportes",
    );
    expect(
      pestanas.getByRole("link", { name: "Matriz de obligaciones" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("sin el de inventario, lleva al de la Matriz en vez de a un 403", () => {
    sesion.permisos = ["matriz.ver_todas"];
    pintarReportes("/admin/reportes");
    expect(screen.getByText("matriz")).toBeInTheDocument();
    // Con una sola pestaña posible, no se dibujan pestañas.
    expect(screen.queryByRole("navigation", { name: "Reportes" })).toBeNull();
  });

  it("mientras carga la sesión no decide nada", () => {
    sesion.inicializando = true;
    sesion.permisos = [];
    pintarReportes("/admin/reportes");
    expect(screen.queryByText(/Ruta: \/403/)).toBeNull();
  });
});
