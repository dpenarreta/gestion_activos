import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Lo que se guarda en Configuración se ve en todo el sistema sin recargar la
 * página: el cliente HTTP avisa y el tema (logo, nombre, colores) se vuelve a
 * pedir solo.
 */

const obtenerTema = vi.fn();
vi.mock("../src/api/themeService", () => ({
  themeService: { getCurrent: (...a) => obtenerTema(...a) },
}));
vi.mock("../src/context/AppearanceContext", () => ({
  useAppearance: () => ({ resolvedTheme: "light" }),
}));

const { avisarCambio, EVENTO_CONFIGURACION } =
  await import("../src/api/cambiosDeConfiguracion");
const { ThemeProvider } = await import("../src/context/ThemeContext");
const { useTheme } = await import("../src/hooks/useTheme");

function Nombre() {
  const { theme } = useTheme();
  return <p>Sitio: {theme?.site_name ?? "…"}</p>;
}

beforeEach(() => vi.clearAllMocks());

describe("Cambios de configuración sin recargar", () => {
  it("solo avisan las escrituras de las secciones que se ven en todo el sistema", () => {
    const avisos = [];
    const escuchar = (e) => avisos.push(e.detail.secciones);
    window.addEventListener(EVENTO_CONFIGURACION, escuchar);

    avisarCambio({ method: "patch", url: "/admin/theme/", baseURL: "/api/v1" });
    avisarCambio({ method: "get", url: "/admin/theme/" });
    avisarCambio({ method: "post", url: "/admin/roles/" });
    avisarCambio({ method: "patch", url: "/empresas/2/" });
    avisarCambio({ method: "post", url: "/activos/" });

    window.removeEventListener(EVENTO_CONFIGURACION, escuchar);
    expect(avisos).toEqual([["tema"], ["permisos"], ["empresas"]]);
  });

  it("guardado el tema, el sistema lo vuelve a pedir y lo muestra ya", async () => {
    obtenerTema
      .mockResolvedValueOnce({ site_name: "Gestión de Activos" })
      .mockResolvedValueOnce({ site_name: "Laar Sistemas" });
    render(
      <ThemeProvider>
        <Nombre />
      </ThemeProvider>,
    );
    expect(
      await screen.findByText("Sitio: Gestión de Activos"),
    ).toBeInTheDocument();

    avisarCambio({ method: "patch", url: "/admin/theme/" });

    expect(await screen.findByText("Sitio: Laar Sistemas")).toBeInTheDocument();
    await waitFor(() => expect(obtenerTema).toHaveBeenCalledTimes(2));
  });
});
