import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Estructura global (auditoría UX/UI, fase 3, 28/10/2026).
 *
 * - La pestaña del navegador dice en qué pantalla se está, con el mismo
 *   título que la barra superior, y el h1 de la barra sigue existiendo.
 * - Con el menú contraído a íconos, los grupos se abren sin mouse: antes el
 *   panel flotante solo respondía a pasar el puntero, y con teclado o en una
 *   tableta táctil no había forma de llegar a lo de dentro.
 * - En una pantalla táctil el menú no arranca contraído.
 */

const permisos = { lista: ["activos.ver", "activos.crear"] };

vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { permissions: permisos.lista, first_name: "Ana" },
    isAuthenticated: true,
    logout: vi.fn(),
  }),
}));

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
vi.mock("../src/components/admin/ModuloApagado/ModuloApagado", () => ({
  ModuloApagado: ({ children }) => children,
}));

const { AdminLayout } =
  await import("../src/components/admin/AdminLayout/AdminLayout");
const { AdminSidebar } =
  await import("../src/components/admin/AdminSidebar/AdminSidebar");
const { UnsavedChangesProvider } =
  await import("../src/context/UnsavedChangesContext");
const { fijarNombreDelSitio } = await import("../src/utils/tituloDocumento");

const matchMediaOriginal = window.matchMedia;

/** `matchMedia` que responde `true` solo a las consultas indicadas. */
function medios(...queCumple) {
  window.matchMedia = vi.fn((consulta) => ({
    matches: queCumple.some((c) => consulta.includes(c)),
    media: consulta,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function pintarLayout(ruta) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/admin/*" element={<AdminLayout />}>
          <Route path="*" element={<p>Contenido</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  permisos.lista = ["activos.ver", "activos.crear"];
  fijarNombreDelSitio("Gestión de Activos");
  medios();
});

afterEach(() => {
  window.matchMedia = matchMediaOriginal;
});

describe("El título de la pestaña", () => {
  it("dice la pantalla y el sitio, igual que la barra superior", () => {
    pintarLayout("/admin/activos/importar");

    const titulo = screen.getByRole("heading", { level: 1 });
    expect(titulo).toHaveTextContent("Carga masiva");
    expect(document.title).toBe("Carga masiva · Gestión de Activos");
  });

  it("el tema que llega después no lo pisa", () => {
    pintarLayout("/admin/activos");

    act(() => fijarNombreDelSitio("Grupo Laar"));

    expect(document.title).toBe("Inventario · Grupo Laar");
  });

  it("al salir de /admin vuelve a ser solo el nombre del sitio", () => {
    const { unmount } = pintarLayout("/admin/activos");
    unmount();

    expect(document.title).toBe("Gestión de Activos");
  });
});

describe("En una pantalla táctil", () => {
  it("el menú no arranca contraído aunque sea de tableta", () => {
    medios("pointer: coarse");
    // 1024 px: «lg», que con mouse arranca contraído.
    const anchoOriginal = window.innerWidth;
    window.innerWidth = 1024;
    try {
      const { container } = pintarLayout("/admin/activos");
      expect(container.querySelector(".mz-shell")).not.toHaveClass(
        "mz-shell--collapsed",
      );
    } finally {
      window.innerWidth = anchoOriginal;
    }
  });
});

describe("Con el menú contraído, sin mouse", () => {
  function pintarContraido() {
    return render(
      <MemoryRouter initialEntries={["/admin/mantenimientos"]}>
        <UnsavedChangesProvider>
          <AdminSidebar isCollapsed onToggleCollapse={vi.fn()} />
        </UnsavedChangesProvider>
      </MemoryRouter>,
    );
  }

  it("Enter en el grupo abre el panel y pone el foco en su primer enlace", () => {
    pintarContraido();
    const grupo = screen.getByTitle("Activos");
    expect(grupo).toHaveAttribute("aria-expanded", "false");

    // Un Enter sobre un botón es un clic.
    grupo.focus();
    fireEvent.click(grupo);

    const panel = screen.getByRole("group", { name: "Activos" });
    expect(grupo).toHaveAttribute("aria-expanded", "true");
    expect(grupo).toHaveAttribute("aria-controls", panel.id);
    expect(
      within(panel).getByRole("link", { name: "Inventario" }),
    ).toHaveFocus();
  });

  it("las flechas recorren sus enlaces y Escape vuelve al grupo", () => {
    pintarContraido();
    const grupo = screen.getByTitle("Activos");
    grupo.focus();
    fireEvent.keyDown(grupo, { key: "ArrowDown" });

    const panel = screen.getByRole("group", { name: "Activos" });
    const enlaces = within(panel).getAllByRole("link");
    expect(enlaces.length).toBeGreaterThan(1);
    expect(enlaces[0]).toHaveFocus();

    fireEvent.keyDown(enlaces[0], { key: "ArrowDown" });
    expect(enlaces[1]).toHaveFocus();
    fireEvent.keyDown(enlaces[1], { key: "ArrowUp" });
    expect(enlaces[0]).toHaveFocus();
    // Hacia arriba desde el primero, da la vuelta al último.
    fireEvent.keyDown(enlaces[0], { key: "ArrowUp" });
    expect(enlaces[enlaces.length - 1]).toHaveFocus();

    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Activos" })).toBeNull();
    expect(grupo).toHaveFocus();
  });

  it("un toque abre el panel y otro toque fuera lo cierra", () => {
    pintarContraido();
    const grupo = screen.getByTitle("Activos");

    // Sin mouse, el «mouseenter» que dispara un toque no abre nada.
    fireEvent.mouseEnter(grupo.closest("li"));
    expect(screen.queryByRole("group", { name: "Activos" })).toBeNull();

    fireEvent.click(grupo);
    expect(screen.getByRole("group", { name: "Activos" })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("group", { name: "Activos" })).toBeNull();
  });
});
