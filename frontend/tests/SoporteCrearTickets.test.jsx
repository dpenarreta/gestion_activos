import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * «Crear tickets» (`soporte.crear`, 09/11/2026).
 *
 * - El botón «Soporte TI» de la barra superior solo se ofrece con el permiso.
 * - En /admin/ayuda, sin el permiso, no hay pestaña «Nuevo ticket»: se abre
 *   «Mis tickets» con una nota de a quién pedir el permiso.
 * - En la Mesa de ayuda, «Nuevo ticket» aparece en el menú con el permiso, y
 *   no hace de nadie «una cuenta con permisos» para el 403.
 */

const permisos = { lista: [] };

vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { permissions: permisos.lista, first_name: "Begoña" },
    isAuthenticated: true,
    logout: vi.fn(),
  }),
}));

const servicio = {
  misTickets: vi.fn(),
  solicitar: vi.fn(),
  crearTicket: vi.fn(),
};
vi.mock("../src/api/soporteService", () => ({ soporteService: servicio }));

vi.mock("../src/hooks/useTheme", () => ({
  useTheme: () => ({ theme: { site_name: "Gestión de Activos" } }),
}));
vi.mock("../src/context/AppearanceContext", () => ({
  useAppearance: () => ({ resolvedTheme: "light", setMode: vi.fn() }),
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
// Lo que rodea al contenido y no es lo que se prueba aquí.
vi.mock("../src/modulos/EstadoModulos", () => ({
  EstadoModulosProvider: ({ children }) => children,
  useEstadoModulos: () => ({ apagados: new Set(), veApagados: false }),
}));
vi.mock("../src/components/admin/Chat/ChatContext", () => ({
  ChatProvider: ({ children }) => children,
}));
vi.mock("../src/components/admin/Chat/ChatDock", () => ({
  ChatDock: () => null,
}));
vi.mock("../src/components/admin/Notificaciones/CampanaNotificaciones", () => ({
  CampanaNotificaciones: () => null,
}));
vi.mock("../src/components/admin/AvisoInicioSesion/AvisoInicioSesion", () => ({
  AvisoInicioSesion: () => null,
}));
vi.mock("../src/components/admin/AvisoOnboarding/AvisoOnboarding", () => ({
  AvisoOnboarding: () => null,
}));
vi.mock("../src/components/admin/AvisoPerfil/AvisoPerfil", () => ({
  AvisoPerfil: () => null,
}));
vi.mock("../src/components/admin/AvisoRolPagos/AvisoRolPagos", () => ({
  AvisoRolPagos: () => null,
}));
vi.mock("../src/components/admin/ModuloApagado/ModuloApagado", () => ({
  ModuloApagado: ({ children }) => children,
}));
vi.mock("../src/pages/Soporte/Llamadas", () => ({
  LlamadasProvider: ({ children }) => children,
}));

const { AdminLayout } =
  await import("../src/components/admin/AdminLayout/AdminLayout");
const { AyudaPage } = await import("../src/pages/Ayuda/AyudaPage");
const { NuevoTicketPropio } =
  await import("../src/pages/Soporte/NuevoTicketPropio");
const { conPermiso, getVisibleAdminMenu } =
  await import("../src/components/admin/AdminSidebar/staticAdminMenu");

function pintar(elemento, ruta, patron) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path={patron} element={elemento} />
      </Routes>
    </MemoryRouter>,
  );
}

function pintarLayout() {
  return render(
    <MemoryRouter initialEntries={["/admin/institucional"]}>
      <Routes>
        <Route path="/admin/*" element={<AdminLayout />}>
          <Route path="*" element={<p>Contenido</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  permisos.lista = [];
  servicio.misTickets.mockResolvedValue([]);
  servicio.solicitar.mockReturnValue(new Promise(() => {}));
});

describe("El botón «Soporte TI» de la barra superior", () => {
  it("se ofrece a quien puede crear tickets", () => {
    permisos.lista = ["soporte.crear"];
    pintarLayout();
    expect(screen.getByRole("link", { name: /Soporte TI/ })).toHaveAttribute(
      "href",
      "/admin/ayuda",
    );
  });

  it("no se ofrece sin el permiso", () => {
    permisos.lista = ["licencias.solicitar"];
    pintarLayout();
    expect(screen.queryByRole("link", { name: /Soporte TI/ })).toBeNull();
  });
});

describe("Soporte TI sin «Crear tickets»", () => {
  it("abre «Mis tickets» sin pestañas, con una nota de a quién pedirlo", async () => {
    pintar(<AyudaPage />, "/admin/ayuda", "/admin/ayuda");

    // Con una sola vista no hay pestañas ni «Nuevo ticket».
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Nuevo ticket" })).toBeNull();
    // La nota es texto normal, no un aviso que se anuncie.
    const nota = screen.getByText(
      "Para crear tickets a su nombre necesita el permiso «Crear tickets»; pídaselo a su jefe o a Tecnología.",
    );
    expect(nota.tagName).toBe("P");
    expect(nota.closest("[role]")).toBeNull();
    // No se pide el formulario ni se ofrece enviar nada.
    expect(servicio.solicitar).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Enviar/ })).toBeNull();
    expect(
      screen.getByText("Aquí sigue los tickets que pidió al equipo de TI."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Todavía no ha pedido ayuda."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Pedir ayuda en Soporte TI" }),
    ).toBeNull();
  });

  it("aunque la dirección no pida «Mis tickets», no muestra el formulario", async () => {
    pintar(<AyudaPage />, "/admin/ayuda?vista=nuevo", "/admin/ayuda");

    expect(servicio.solicitar).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Todavía no ha pedido ayuda."),
    ).toBeInTheDocument();
  });

  it("con el permiso hay pestañas, se pide el formulario y no hay nota", () => {
    permisos.lista = ["soporte.crear"];
    pintar(<AyudaPage />, "/admin/ayuda", "/admin/ayuda");

    expect(screen.getByRole("tab", { name: "Nuevo ticket" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(servicio.solicitar).toHaveBeenCalled();
    expect(screen.queryByText(/Para crear tickets a su nombre/)).toBeNull();
  });
});

describe("«Nuevo ticket» de la Mesa de ayuda", () => {
  it("el título no repite la barra y remite a «Registrar ticket» a quien puede", () => {
    permisos.lista = ["soporte.crear", "soporte.registrar"];
    pintar(
      <NuevoTicketPropio />,
      "/admin/soporte/nuevo",
      "/admin/soporte/nuevo",
    );

    expect(
      screen.getByRole("heading", { name: "Pida ayuda a su nombre" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/¿Es para otra persona\?/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Registrar ticket" }),
    ).toHaveAttribute("href", "/admin/soporte/registrar");
  });

  it("sin «Registrar ticket» no lo menciona", () => {
    permisos.lista = ["soporte.crear"];
    pintar(
      <NuevoTicketPropio />,
      "/admin/soporte/nuevo",
      "/admin/soporte/nuevo",
    );

    expect(screen.queryByText(/¿Es para otra persona\?/)).toBeNull();
  });
});

describe("«Nuevo ticket» en el menú de la Mesa de ayuda", () => {
  const nuevo = (lista) =>
    getVisibleAdminMenu(lista, "soporte").find((i) => i.id === "soporte-nuevo");

  it("aparece con el permiso y lleva al formulario del módulo", () => {
    const entrada = nuevo(["soporte.crear"]);
    expect(entrada).toMatchObject({
      name: "Nuevo ticket",
      path: "/admin/soporte/nuevo",
    });
  });

  it("no aparece sin el permiso", () => {
    expect(nuevo(["soporte.atender"])).toBeUndefined();
  });

  it("no cuenta como un permiso «de verdad» para la pantalla de 403", () => {
    const menu = getVisibleAdminMenu(["soporte.crear"], "soporte");
    expect(conPermiso(menu).map((i) => i.id)).not.toContain("soporte-nuevo");
  });
});
