import { describe, expect, it } from "vitest";

import { getVisibleAdminMenu } from "../src/components/admin/AdminSidebar/staticAdminMenu";

function buscar(menu, id) {
  for (const item of menu) {
    if (item.id === id) return item;
    const hijo = item.children?.find((child) => child.id === id);
    if (hijo) return hijo;
  }
  return undefined;
}

describe("Menú administrativo", () => {
  it("las empresas se crean desde Configuración", () => {
    const menu = getVisibleAdminMenu(["configuracion.ver", "empresas.ver"]);

    const configuracion = buscar(menu, "configuracion");
    expect(configuracion.children[0].id).toBe("configuracion-empresas");
    expect(configuracion.children[0].path).toBe("/admin/empresas");
  });

  // Quien administra las empresas del grupo no tiene por qué poder tocar la
  // identidad institucional, y al revés.
  it("un hijo con permiso propio se filtra por el suyo", () => {
    const soloEmpresas = getVisibleAdminMenu(["empresas.ver"]);
    const soloIdentidad = getVisibleAdminMenu(["configuracion.ver"]);

    expect(buscar(soloEmpresas, "configuracion-empresas")).toBeDefined();
    expect(buscar(soloEmpresas, "configuracion-identidad")).toBeUndefined();
    expect(buscar(soloIdentidad, "configuracion-empresas")).toBeUndefined();
    expect(buscar(soloIdentidad, "configuracion-identidad")).toBeDefined();
  });

  it("el grupo desaparece cuando no le queda ningún hijo visible", () => {
    const menu = getVisibleAdminMenu(["activos.ver"]);

    expect(buscar(menu, "configuracion")).toBeUndefined();
  });

  it("un hijo sin permiso propio sigue heredando el del grupo", () => {
    const menu = getVisibleAdminMenu(["usuarios.ver"]);

    expect(buscar(menu, "accesos-usuarios")).toBeDefined();
    expect(buscar(menu, "accesos-roles")).toBeDefined();
  });
});
