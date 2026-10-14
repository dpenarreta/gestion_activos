import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Configuración, como en la Matriz: una sola entrada del menú y, dentro, las
 * pestañas de sus secciones. Lo que se prueba es lo que antes hacía el menú
 * desplegable —ofrecer solo lo que se puede abrir y decir dónde se está—, ahora
 * en las pestañas.
 */

const permisos = { lista: [] };

vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { permissions: permisos.lista },
    isInitializing: false,
  }),
}));

const { ConfiguracionMarco } =
  await import("../src/components/admin/ConfiguracionMarco/ConfiguracionMarco");
const { InicioDeConfiguracion } =
  await import("../src/components/admin/ConfiguracionMarco/InicioDeConfiguracion");
const { UnsavedChangesProvider } =
  await import("../src/context/UnsavedChangesContext");

const TODOS = [
  "empresas.ver",
  "usuarios.ver",
  "roles.ver",
  "permisos.ver",
  "organizacion.ver",
  "configuracion.ver",
  "auditoria.ver",
];

function Ruta() {
  return <p>Ruta: {useLocation().pathname}</p>;
}

function pintar(ruta, empresa = "LaarCourier") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <UnsavedChangesProvider>
        <ConfiguracionMarco empresa={empresa}>
          <Ruta />
        </ConfiguracionMarco>
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

function pestanas() {
  const nav = screen.getByRole("navigation", {
    name: "Secciones de configuración",
  });
  return within(nav).getAllByRole("link");
}

beforeEach(() => {
  permisos.lista = [...TODOS];
});

describe("Las pestañas de Configuración", () => {
  it("son las secciones del sistema, en español y en este orden", () => {
    pintar("/admin/empresas");

    expect(pestanas().map((p) => p.textContent)).toEqual([
      "Empresas",
      "Usuarios",
      "Roles",
      "Permisos",
      "Catálogos",
      "Identidad visual",
      "Respaldos",
      "Auditoría",
    ]);
  });

  it("dice qué abarca, en la empresa en que se está", () => {
    pintar("/admin/empresas");

    expect(
      screen.getByText(
        "LaarCourier: empresas, usuarios, roles, permisos, catálogos, identidad visual, respaldos y auditoría.",
      ),
    ).toBeInTheDocument();
  });

  it("solo ofrece las que se pueden abrir", () => {
    /* Una pestaña que termina en un 403 hace parecer roto el sistema. */
    permisos.lista = ["auditoria.ver", "organizacion.ver"];

    pintar("/admin/auditoria");

    expect(pestanas().map((p) => p.textContent)).toEqual([
      "Catálogos",
      "Auditoría",
    ]);
  });

  it("marca la sección actual, también desde una ficha", () => {
    pintar("/admin/users/7");

    const activa = pestanas().find(
      (p) => p.getAttribute("aria-current") === "page",
    );
    expect(activa).toHaveTextContent("Usuarios");
  });

  it("el catálogo de permisos es «Permisos», no «Roles»", () => {
    /* Su dirección empieza por la de roles: gana el prefijo más largo. */
    pintar("/admin/roles/permisos");

    const activa = pestanas().find(
      (p) => p.getAttribute("aria-current") === "page",
    );
    expect(activa).toHaveTextContent("Permisos");
  });

  it("los catálogos tienen sus apartados en una segunda fila", () => {
    pintar("/admin/organizacion/sedes/3");

    const apartados = within(
      screen.getByRole("navigation", { name: "Apartados de catálogos" }),
    ).getAllByRole("link");
    expect(apartados.map((a) => a.textContent)).toEqual([
      "Departamentos",
      "Sedes",
      "Proveedores",
      "Concesionarios",
      "Empleados",
      "Carga masiva",
    ]);
    expect(apartados[1]).toHaveAttribute("aria-current", "page");
  });

  it("una pestaña lleva a su sección", () => {
    pintar("/admin/empresas");

    fireEvent.click(screen.getByRole("link", { name: "Auditoría" }));

    expect(screen.getByText("Ruta: /admin/auditoria")).toBeInTheDocument();
  });
});

describe("La entrada del menú", () => {
  function entrar() {
    return render(
      <MemoryRouter initialEntries={["/admin/configuracion"]}>
        <Routes>
          <Route
            path="/admin/configuracion"
            element={<InicioDeConfiguracion />}
          />
          <Route path="*" element={<Ruta />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("lleva a la primera sección que se puede abrir", () => {
    /* Quien solo administra catálogos no tiene por qué aterrizar en un 403
       de empresas. */
    permisos.lista = ["organizacion.ver", "auditoria.ver"];

    entrar();

    expect(
      screen.getByText("Ruta: /admin/organizacion/departamentos"),
    ).toBeInTheDocument();
  });

  it("sin ninguna, al acceso denegado", () => {
    permisos.lista = ["activos.ver"];

    entrar();

    expect(screen.getByText("Ruta: /403")).toBeInTheDocument();
  });
});
