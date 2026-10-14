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
  it("Configuración es una entrada sola, sin hijos", () => {
    /* Sus secciones se eligen con las pestañas de la pantalla, como en la
       Matriz: el menú solo lleva hasta ella. */
    const menu = getVisibleAdminMenu(["configuracion.ver", "empresas.ver"]);

    const configuracion = buscar(menu, "configuracion");
    expect(configuracion.path).toBe("/admin/configuracion");
    expect(configuracion.children).toBeUndefined();
  });

  it("basta con poder abrir una de sus secciones para verla", () => {
    for (const permiso of [
      "empresas.ver",
      "usuarios.ver",
      "roles.ver",
      "permisos.ver",
      "organizacion.ver",
      "configuracion.ver",
      "auditoria.ver",
    ]) {
      expect(
        buscar(getVisibleAdminMenu([permiso]), "configuracion"),
      ).toBeDefined();
    }
  });

  it("y desaparece cuando no puede abrir ninguna", () => {
    const menu = getVisibleAdminMenu(["activos.ver"]);

    expect(buscar(menu, "configuracion")).toBeUndefined();
  });

  it("se marca desde las direcciones de sus secciones", () => {
    const configuracion = buscar(
      getVisibleAdminMenu(["usuarios.ver"]),
      "configuracion",
    );

    expect(configuracion.rutas).toEqual(
      expect.arrayContaining([
        "/admin/users",
        "/admin/empresas",
        "/admin/roles",
        "/admin/organizacion",
        "/admin/catalogos",
        "/admin/auditoria",
      ]),
    );
  });

  it("un hijo sin permiso propio hereda el del grupo; con uno propio, se filtra por el suyo", () => {
    /* Quien consulta solicitudes ve las suyas y las recibidas, pero no el
       formulario de crear, que exige otro permiso. */
    const soloVer = getVisibleAdminMenu(["solicitudes.ver"]);
    const verYCrear = getVisibleAdminMenu([
      "solicitudes.ver",
      "solicitudes.crear",
    ]);

    expect(buscar(soloVer, "solicitudes-mias")).toBeDefined();
    expect(buscar(soloVer, "solicitudes-nueva")).toBeUndefined();
    expect(buscar(verYCrear, "solicitudes-nueva")).toBeDefined();
  });
});
