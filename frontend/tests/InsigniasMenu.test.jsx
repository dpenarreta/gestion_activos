import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Las insignias del menú: lo que cada pantalla tiene pendiente para quien
 * entra, a la derecha de su entrada («Solicitud de permisos 1»).
 */

const permisos = { lista: ["licencias.solicitar"] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { permissions: permisos.lista },
    isAuthenticated: true,
  }),
}));
vi.mock("../src/hooks/useTheme", () => ({
  useTheme: () => ({ theme: { site_name: "Gestión" } }),
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
const resumenLicencias = vi.fn();
vi.mock("../src/api/licenciasService", () => ({
  licenciasService: { resumen: resumenLicencias },
}));
const miOnboarding = vi.fn();
vi.mock("../src/api/capacitacionService", () => ({
  capacitacionService: { miOnboarding },
}));
const resumenSugerencias = vi.fn();
vi.mock("../src/api/sugerenciasService", () => ({
  sugerenciasService: { resumen: resumenSugerencias },
}));

const estadoNomina = vi.fn();
const resumenObservaciones = vi.fn();
const avisoRol = vi.fn();
vi.mock("../src/api/nominaService", () => ({
  nominaService: {
    estado: estadoNomina,
    resumenObservaciones,
    aviso: avisoRol,
  },
}));

const { AdminSidebar } =
  await import("../src/components/admin/AdminSidebar/AdminSidebar");
const { UnsavedChangesProvider } =
  await import("../src/context/UnsavedChangesContext");

function pintar(ruta = "/admin/institucional/inicio") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <UnsavedChangesProvider>
        <AdminSidebar isCollapsed={false} onToggleCollapse={vi.fn()} />
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = ["licencias.solicitar"];
  resumenSugerencias.mockResolvedValue({ nuevos: 0 });
  avisoRol.mockResolvedValue({ mostrar: false });
});

describe("Insignias del menú", () => {
  it("Solicitud de permisos muestra cuántas tiene por aprobar", async () => {
    resumenLicencias.mockResolvedValue({ por_aprobar: 1 });
    miOnboarding.mockResolvedValue({
      asignado: true,
      completado_en: null,
      total: 4,
      aprobados: 1,
    });
    pintar();
    // El enlace se lee con el número y lo que cuenta (auditoría UX/UI, fase 3):
    // antes era un aria-label sobre un <span>, que los lectores ignoran.
    expect(
      await screen.findByRole("link", {
        name: /Solicitud de permisos\s*1 por aprobar/,
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("link", {
        name: /Mi onboarding\s*3 materiales pendientes/,
      }),
    ).toBeInTheDocument();
  });

  it("sin pendientes no muestra número", async () => {
    resumenLicencias.mockResolvedValue({ por_aprobar: 0 });
    miOnboarding.mockResolvedValue({ asignado: false, total: 0, aprobados: 0 });
    pintar();
    const permisos = await screen.findByRole("link", {
      name: /Solicitud de permisos/,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(within(permisos).queryByText("0")).toBeNull();
    expect(resumenLicencias).toHaveBeenCalled();
  });

  it("Rol de pagos agrupa consultar y observaciones, con lo pendiente de cada una", async () => {
    permisos.lista = ["roles_pago.consultar", "roles_pago.observaciones"];
    resumenLicencias.mockResolvedValue({ por_aprobar: 0 });
    miOnboarding.mockResolvedValue({ asignado: false, total: 0, aprobados: 0 });
    estadoNomina.mockResolvedValue({ por_confirmar: [{ id: 1 }] });
    resumenObservaciones.mockResolvedValue({ abiertas: 2 });
    pintar("/admin/institucional/rol-pagos/observaciones");

    // La cabecera suma lo de sus entradas: 1 corrección + 2 observaciones.
    const grupo = await screen.findByRole("button", { name: /Rol de pagos/ });
    expect(await within(grupo).findByText("3")).toBeInTheDocument();
    expect(grupo).toHaveAccessibleName(/Rol de pagos\s*3 pendientes/);
    const observaciones = screen.getByRole("link", { name: /Observaciones/ });
    expect(observaciones).toHaveAccessibleName(
      /Observaciones.*2 observaciones por atender/,
    );
    // Solo la entrada de la pantalla abierta queda marcada.
    expect(observaciones).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: /Consultar rol de pagos/ }),
    ).not.toHaveAttribute("aria-current");
  });

  it("sin observaciones a cargo, Consultar rol de pagos va directo", async () => {
    permisos.lista = ["roles_pago.consultar"];
    resumenLicencias.mockResolvedValue({ por_aprobar: 0 });
    miOnboarding.mockResolvedValue({ asignado: false, total: 0, aprobados: 0 });
    estadoNomina.mockResolvedValue({ por_confirmar: [{ id: 1 }] });
    pintar();
    const consultar = await screen.findByRole("link", {
      name: /Consultar rol de pagos/,
    });
    await waitFor(() =>
      expect(consultar).toHaveAccessibleName(
        /Consultar rol de pagos\s*1 pendiente de aceptar o confirmar/,
      ),
    );
    expect(screen.queryByRole("button", { name: /Rol de pagos/ })).toBeNull();
  });

  it("el rol del mes sin aceptar enciende Consultar rol de pagos y la cabecera Rol de pagos", async () => {
    permisos.lista = ["roles_pago.consultar", "roles_pago.observaciones"];
    resumenLicencias.mockResolvedValue({ por_aprobar: 0 });
    miOnboarding.mockResolvedValue({ asignado: false, total: 0, aprobados: 0 });
    // El mismo aviso que sale al entrar: el rol de octubre sin aceptar.
    avisoRol.mockResolvedValue({ mostrar: true, anio: 2026, mes: 10 });
    estadoNomina.mockResolvedValue({ por_confirmar: [] });
    resumenObservaciones.mockResolvedValue({ abiertas: 0 });
    pintar("/admin/institucional/rol-pagos");

    const grupo = await screen.findByRole("button", { name: /Rol de pagos/ });
    expect(await within(grupo).findByText("1")).toBeInTheDocument();
    // En singular: «1 pendiente», no «1 pendientes».
    expect(grupo).toHaveAccessibleName(/Rol de pagos\s*1 pendiente$/);
    expect(
      screen.getByRole("link", { name: /Consultar rol de pagos/ }),
    ).toHaveAccessibleName(
      /Consultar rol de pagos\s*1 pendiente de aceptar o confirmar/,
    );

    // Al aceptarlo, el menú se actualiza enseguida (sin esperar al minuto).
    avisoRol.mockResolvedValue({ mostrar: false });
    const { avisarCambioDeInsignias } =
      await import("../src/utils/insigniasDelMenu");
    avisarCambioDeInsignias();
    await waitFor(() => expect(within(grupo).queryByText("1")).toBeNull());
  });

  it("sin la pantalla de consulta, el aviso cuenta igual aunque el estado falle", async () => {
    permisos.lista = ["roles_pago.consultar"];
    resumenLicencias.mockResolvedValue({ por_aprobar: 0 });
    miOnboarding.mockResolvedValue({ asignado: false, total: 0, aprobados: 0 });
    avisoRol.mockResolvedValue({ mostrar: true, anio: 2026, mes: 10 });
    estadoNomina.mockRejectedValue(new Error("403"));
    pintar();
    const consultar = await screen.findByRole("link", {
      name: /Consultar rol de pagos/,
    });
    await waitFor(() =>
      expect(consultar).toHaveAccessibleName(
        /Consultar rol de pagos\s*1 pendiente de aceptar o confirmar/,
      ),
    );
  });

  it("con el menú contraído, el grupo y su panel también muestran lo pendiente", async () => {
    permisos.lista = ["roles_pago.consultar", "roles_pago.observaciones"];
    resumenLicencias.mockResolvedValue({ por_aprobar: 0 });
    miOnboarding.mockResolvedValue({ asignado: false, total: 0, aprobados: 0 });
    avisoRol.mockResolvedValue({ mostrar: true, anio: 2026, mes: 10 });
    estadoNomina.mockResolvedValue({ por_confirmar: [] });
    resumenObservaciones.mockResolvedValue({ abiertas: 0 });
    render(
      <MemoryRouter initialEntries={["/admin/institucional/inicio"]}>
        <UnsavedChangesProvider>
          <AdminSidebar isCollapsed onToggleCollapse={vi.fn()} />
        </UnsavedChangesProvider>
      </MemoryRouter>,
    );
    const grupo = await screen.findByRole("button", { name: /Rol de pagos/ });
    expect(await within(grupo).findByText("1")).toBeInTheDocument();
    fireEvent.click(grupo);
    const panel = await screen.findByRole("group", { name: "Rol de pagos" });
    expect(
      within(panel).getByRole("link", { name: /Consultar rol de pagos/ }),
    ).toHaveAccessibleName(
      /Consultar rol de pagos\s*1 pendiente de aceptar o confirmar/,
    );
  });
});
