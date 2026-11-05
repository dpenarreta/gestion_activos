import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import {
  getVisibleAdminMenu,
  modulosConAcceso,
} from "../src/components/admin/AdminSidebar/staticAdminMenu";

/*
 * «Tareas y equipo» en el menú de Gestión Humana: cada entrada se filtra por
 * los permisos `tareas.*` / `equipo.*` del catálogo, y todas piden además
 * `tareas.acceder` (el servidor lo exige en toda petición de `/tasks/`).
 */

const permisos = { lista: [] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { permissions: permisos.lista } }),
}));

const { InicioGestionHumana } =
  await import("../src/pages/GestionHumana/InicioGestionHumana");

const hojas = (items) =>
  items.flatMap((i) => [...(i.path ? [i] : []), ...hojas(i.children ?? [])]);

const ids = (lista) =>
  hojas(
    getVisibleAdminMenu(lista, "gestion_humana").filter(
      (i) => i.modulo === "gestion_humana",
    ),
  ).map((i) => i.id);

const TAREAS = [
  "gh-tareas",
  "gh-equipo",
  "gh-tiempo-objetivo",
  "gh-cierre-mes",
  "gh-ajustes-tareas",
];

describe("Tareas y equipo en el menú", () => {
  it("con solo el acceso a Tareas ve Tareas, directo (sin sección de una entrada)", () => {
    const menu = getVisibleAdminMenu(["tareas.acceder"], "gestion_humana");
    const delModulo = menu.filter((i) => i.modulo === "gestion_humana");
    expect(delModulo).toHaveLength(1);
    expect(delModulo[0]).toMatchObject({
      id: "gh-tareas",
      path: "/admin/gestion-humana/tareas",
    });
  });

  it("Equipo pide `equipo.ver` además del acceso", () => {
    expect(ids(["tareas.acceder"])).not.toContain("gh-equipo");
    expect(ids(["tareas.acceder", "equipo.ver"])).toContain("gh-equipo");
    // Sin `tareas.acceder` no hay nada que abrir: el servidor lo exige.
    expect(ids(["equipo.ver"])).not.toContain("gh-equipo");
  });

  it("Tiempo objetivo se abre con validar o con regularizar", () => {
    expect(ids(["tareas.acceder", "tareas.validar"])).toContain(
      "gh-tiempo-objetivo",
    );
    expect(ids(["tareas.acceder", "tareas.regularizar"])).toContain(
      "gh-tiempo-objetivo",
    );
    expect(ids(["tareas.acceder"])).not.toContain("gh-tiempo-objetivo");
  });

  it("Cierre de mes y Ajustes van con sus propios permisos", () => {
    expect(ids(["tareas.acceder", "tareas.cerrar_mes"])).toContain(
      "gh-cierre-mes",
    );
    expect(ids(["tareas.acceder", "tareas.cerrar_mes"])).not.toContain(
      "gh-ajustes-tareas",
    );
    expect(ids(["tareas.acceder", "tareas.administrar"])).toContain(
      "gh-ajustes-tareas",
    );
  });

  it("con todo, las dos secciones y las cinco entradas de Tareas en orden", () => {
    const menu = getVisibleAdminMenu(
      [
        "novedades.acceder",
        "tareas.acceder",
        "tareas.validar",
        "tareas.regularizar",
        "tareas.cerrar_mes",
        "tareas.administrar",
        "equipo.ver",
      ],
      "gestion_humana",
    ).filter((i) => i.modulo === "gestion_humana");
    expect(menu.map((i) => i.name)).toEqual([
      "Control operativo",
      "Tareas y equipo",
    ]);
    expect(menu[1].children.map((i) => i.id)).toEqual(TAREAS);
  });

  it("el módulo se ofrece a quien solo tiene Tareas", () => {
    expect(modulosConAcceso(["tareas.acceder"])).toContain("gestion_humana");
    expect(modulosConAcceso(["equipo.ver"])).not.toContain("gestion_humana");
  });

  it("la entrada del módulo lleva a Tareas a quien no tiene Control operativo", () => {
    permisos.lista = ["tareas.acceder"];
    let destino = null;
    function Ver({ nombre }) {
      destino = nombre;
      return null;
    }
    render(
      <MemoryRouter initialEntries={["/admin/gestion-humana"]}>
        <Routes>
          <Route
            path="/admin/gestion-humana"
            element={<InicioGestionHumana />}
          />
          <Route
            path="/admin/gestion-humana/tareas"
            element={<Ver nombre="tareas" />}
          />
          <Route
            path="/admin/gestion-humana/dias-laborados"
            element={<Ver nombre="dias" />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(destino).toBe("tareas");
  });
});
