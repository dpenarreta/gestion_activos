import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Los módulos del sistema: un selector en la barra superior, junto al de
 * empresa, decide qué menú lateral se ve. Configuración es común a todos.
 *
 * Cobertura de AC-MTZ-008 a AC-MTZ-010.
 */

const permisos = { lista: [] };

vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { permissions: permisos.lista },
    isAuthenticated: true,
  }),
}));

const { SelectorModulo } =
  await import("../src/components/admin/SelectorModulo/SelectorModulo");
const { getVisibleAdminMenu, modulosConAcceso } =
  await import("../src/components/admin/AdminSidebar/staticAdminMenu");
const { moduloDeRuta } = await import("../src/modulos/modulos");
const { UnsavedChangesProvider } =
  await import("../src/context/UnsavedChangesContext");

function Ruta() {
  return <p>Ruta: {useLocation().pathname}</p>;
}

function pintar(ruta = "/admin/dashboard") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <UnsavedChangesProvider>
        <SelectorModulo />
        <Routes>
          <Route path="*" element={<Ruta />} />
        </Routes>
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  permisos.lista = ["activos.ver", "matriz.cargar", "usuarios.ver"];
});

describe("Cada módulo trae su menú", () => {
  it("el inventario no muestra la Matriz, ni la Matriz el inventario", () => {
    const activos = getVisibleAdminMenu(permisos.lista, "activos").map(
      (i) => i.id,
    );
    const matriz = getVisibleAdminMenu(permisos.lista, "matriz").map(
      (i) => i.id,
    );

    expect(activos).toContain("activos");
    expect(activos).not.toContain("matriz-resumen");
    expect(matriz).toContain("matriz-resumen");
    expect(matriz).not.toContain("activos");
  });

  it("Configuración aparece en los dos", () => {
    for (const modulo of ["activos", "matriz"]) {
      expect(
        getVisibleAdminMenu(permisos.lista, modulo).map((i) => i.id),
      ).toContain("configuracion");
    }
  });

  it("solo se ofrecen los módulos en que hay algo que abrir", () => {
    /* La Matriz depende del rol en la empresa activa: sin permisos de ella, no
       se ofrece. Configuración sola no cuenta como módulo. */
    expect(modulosConAcceso(["activos.ver"])).toEqual(["activos"]);
    expect(modulosConAcceso(["matriz.ver_todas"])).toEqual(["matriz"]);
    expect(modulosConAcceso(["usuarios.ver"])).toEqual([]);
  });

  it("el módulo sale de la ruta; las de Configuración no tienen uno propio", () => {
    expect(moduloDeRuta("/admin/matriz")).toBe("matriz");
    expect(moduloDeRuta("/admin/activos/4")).toBe("activos");
    expect(moduloDeRuta("/admin/users")).toBeNull();
  });
});

describe("El selector de módulos", () => {
  it("dice en qué módulo se está y ofrece los demás", () => {
    pintar("/admin/dashboard");

    const boton = screen.getByRole("button", {
      name: /Módulo: Gestión de Activos/,
    });
    fireEvent.click(boton);

    const opciones = within(
      screen.getByRole("menu", { name: "Módulos" }),
    ).getAllByRole("menuitemradio");
    expect(opciones.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Gestión de Activos"),
      expect.stringContaining("Matriz de obligaciones"),
    ]);
    expect(opciones[0]).toHaveAttribute("aria-checked", "true");
  });

  it("elegir otro lleva a su inicio", () => {
    pintar("/admin/dashboard");

    fireEvent.click(screen.getByRole("button", { name: /Cambiar de módulo/ }));
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: /Matriz de obligaciones/ }),
    );

    expect(screen.getByText("Ruta: /admin/matriz")).toBeInTheDocument();
  });

  it("en Configuración conserva el módulo desde el que se llegó", () => {
    /* Abrir Usuarios desde la Matriz no puede devolver el menú del inventario. */
    sessionStorage.setItem("gestion_activos_modulo", "matriz");

    pintar("/admin/users");

    expect(
      screen.getByRole("button", { name: /Módulo: Matriz de obligaciones/ }),
    ).toBeInTheDocument();
  });

  it("con un solo módulo no se dibuja", () => {
    permisos.lista = ["activos.ver"];

    pintar();

    expect(
      screen.queryByRole("button", { name: /Cambiar de módulo/ }),
    ).toBeNull();
  });

  it("Escape lo cierra", () => {
    pintar();

    fireEvent.click(screen.getByRole("button", { name: /Cambiar de módulo/ }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
