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
  "catalogos.ver",
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
      "Usuarios y roles",
      "Catálogos",
      "Notificaciones",
      "Identidad visual",
      "Plantilla de dashboards",
      "Respaldos",
    ]);
  });

  it("dice qué abarca, en la empresa en que se está", () => {
    pintar("/admin/empresas");

    expect(
      screen.getByText(
        "LaarCourier: empresas, usuarios y roles, catálogos, notificaciones, identidad visual, plantilla de dashboards y respaldos.",
      ),
    ).toBeInTheDocument();
  });

  it("solo ofrece las que se pueden abrir", () => {
    /* Una pestaña que termina en un 403 hace parecer roto el sistema. */
    permisos.lista = ["empresas.ver", "organizacion.ver"];

    pintar("/admin/empresas");

    expect(pestanas().map((p) => p.textContent)).toEqual([
      "Empresas",
      "Catálogos",
    ]);
  });

  it("marca la sección actual, también desde una ficha", () => {
    pintar("/admin/users/7");

    const activa = pestanas().find(
      (p) => p.getAttribute("aria-current") === "page",
    );
    expect(activa).toHaveTextContent("Usuarios y roles");
  });

  it("usuarios, roles y permisos son una sola pestaña con sus apartados", () => {
    /* La dirección de permisos empieza por la de roles: gana la más larga. */
    pintar("/admin/roles/permisos");

    const activa = pestanas().find(
      (p) => p.getAttribute("aria-current") === "page",
    );
    expect(activa).toHaveTextContent("Usuarios y roles");
    const apartados = within(
      screen.getByRole("navigation", {
        name: /Apartados de usuarios y roles/i,
      }),
    ).getAllByRole("link");
    expect(apartados.map((a) => a.textContent)).toEqual([
      "Usuarios",
      "Roles",
      "Permisos",
    ]);
    expect(
      apartados.find((a) => a.getAttribute("aria-current") === "page"),
    ).toHaveTextContent("Permisos");
  });

  it("los catálogos tienen sus apartados en una segunda fila", () => {
    pintar("/admin/organizacion/sedes/3");

    const apartados = within(
      screen.getByRole("navigation", { name: "Apartados de catálogos" }),
    ).getAllByRole("link");
    expect(apartados.map((a) => a.textContent)).toEqual([
      "Sedes",
      "Proveedores",
      "Concesionarios",
      "Empleados",
      "Carga masiva",
      "Temas de la Matriz",
      "Entidades de control",
    ]);
    expect(apartados[0]).toHaveAttribute("aria-current", "page");
  });

  it("cada apartado se filtra por su permiso", () => {
    /* Quien solo ve los catálogos de la Matriz entra a «Catálogos» por
       «Temas de la Matriz», no por una sede que le respondería 403. */
    permisos.lista = ["catalogos.ver"];

    pintar("/admin/catalogos/areas");

    const catalogos = screen.getByRole("link", { name: "Catálogos" });
    expect(catalogos).toHaveAttribute("href", "/admin/catalogos/areas");
    const apartados = within(
      screen.getByRole("navigation", { name: "Apartados de catálogos" }),
    ).getAllByRole("link");
    expect(apartados.map((a) => a.textContent)).toEqual([
      "Temas de la Matriz",
      "Entidades de control",
    ]);
  });

  it("una pestaña lleva a su sección", () => {
    pintar("/admin/empresas");

    fireEvent.click(screen.getByRole("link", { name: "Respaldos" }));

    expect(
      screen.getByText("Ruta: /admin/configuracion/respaldos"),
    ).toBeInTheDocument();
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
      screen.getByText("Ruta: /admin/organizacion/sedes"),
    ).toBeInTheDocument();
  });

  it("sin ninguna, al acceso denegado", () => {
    permisos.lista = ["activos.ver"];

    entrar();

    expect(screen.getByText("Ruta: /403")).toBeInTheDocument();
  });
});
