import { describe, expect, it } from "vitest";

import {
  conPermiso,
  getVisibleAdminMenu,
  modulosConPermiso,
} from "../src/components/admin/AdminSidebar/staticAdminMenu";

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
      ]),
    );
    expect(configuracion.rutas).not.toContain("/admin/auditoria");
  });

  it("Auditoría va aparte, en el bloque General, con cualquiera de sus dos permisos", () => {
    for (const permiso of ["auditoria.ver", "matriz.ver_auditoria"]) {
      const auditoria = buscar(getVisibleAdminMenu([permiso]), "auditoria");
      expect(auditoria.modulo).toBe("comun");
      expect(auditoria.path).toBe("/admin/auditoria");
    }
    expect(
      buscar(getVisibleAdminMenu(["auditoria.ver"]), "configuracion"),
    ).toBeUndefined();
    expect(
      buscar(getVisibleAdminMenu(["activos.ver"]), "auditoria"),
    ).toBeUndefined();
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

  it("Solicitudes agrupa permisos, proyectos y procesos (US-008)", () => {
    const menu = getVisibleAdminMenu(["licencias.solicitar"], "institucional");
    const grupo = buscar(menu, "institucional-solicitudes");
    expect(grupo.name).toBe("Solicitudes");
    expect(grupo.children.map((h) => [h.name, h.path, h.insignia])).toEqual([
      ["Solicitud de permisos", "/admin/institucional/permisos", "por_aprobar"],
      [
        "Solicitud de proyectos",
        "/admin/institucional/proyectos",
        "proyectos_por_atender",
      ],
      [
        "Solicitud de procesos",
        "/admin/institucional/procesos",
        "procesos_por_atender",
      ],
    ]);
    expect(buscar(menu, "institucional-procesos").rutas).toContain(
      "/admin/institucional/procesos/tipos",
    );
  });

  it("un grupo sin permiso propio no hace a nadie «una cuenta con permisos»", () => {
    // Proyectos y procesos son de todos: el grupo «Solicitudes» se ve sin
    // permisos, pero no cuenta como permiso de verdad (pantalla de 403).
    expect(modulosConPermiso([])).not.toContain("institucional");
    const sinPermisos = getVisibleAdminMenu([], "institucional");
    expect(buscar(sinPermisos, "institucional-solicitudes")).toBeDefined();
    expect(
      buscar(conPermiso(sinPermisos), "institucional-solicitudes"),
    ).toBeUndefined();
    // Con permiso para pedir permisos, sí, y solo con esa entrada.
    const conLicencias = conPermiso(
      getVisibleAdminMenu(["licencias.solicitar"], "institucional"),
    );
    expect(
      buscar(conLicencias, "institucional-solicitudes").children.map(
        (h) => h.id,
      ),
    ).toEqual(["institucional-permisos"]);
  });
});
