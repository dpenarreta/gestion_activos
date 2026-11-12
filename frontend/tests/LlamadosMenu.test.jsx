import { describe, expect, it } from "vitest";

import {
  getVisibleAdminMenu,
  modulosConAcceso,
  modulosConPermiso,
} from "../src/components/admin/AdminSidebar/staticAdminMenu";

/*
 * US-013: la entrada «Llamados de atención» del módulo Gestión Humana y quién
 * la ve. Un jefe con solo `llamados.solicitar` entra al módulo sin ver lo
 * demás, y quien no tiene ninguno de los permisos no la ve.
 */

const aplanar = (items) =>
  items.flatMap((i) => [i, ...(i.children ? aplanar(i.children) : [])]);
const entradasDeGh = (permisos) =>
  aplanar(getVisibleAdminMenu(permisos, "gestion_humana")).filter(
    (i) => i.modulo === "gestion_humana" && i.path,
  );

describe("Menú de Llamados de atención", () => {
  it.each([
    "llamados.ver",
    "llamados.emitir",
    "llamados.configurar",
    "llamados.solicitar",
  ])("con %s se ve la entrada", (permiso) => {
    const entrada = entradasDeGh([permiso]).find((i) => i.id === "gh-llamados");
    expect(entrada.name).toBe("Llamados de atención");
    expect(entrada.path).toBe("/admin/gestion-humana/llamados-de-atencion");
  });

  it("un jefe con solo «solicitar» entra a Gestión Humana y solo ve esa entrada", () => {
    const permisos = ["llamados.solicitar"];
    expect(modulosConAcceso(permisos)).toContain("gestion_humana");
    expect(modulosConPermiso(permisos)).toContain("gestion_humana");
    expect(entradasDeGh(permisos).map((i) => i.id)).toEqual(["gh-llamados"]);
  });

  it("sin permisos de llamados no se ve la entrada ni se abre el módulo", () => {
    expect(
      entradasDeGh(["novedades.acceder"]).some((i) => i.id === "gh-llamados"),
    ).toBe(false);
    expect(modulosConAcceso([])).not.toContain("gestion_humana");
  });

  it("no cambia lo que ven los demás de Gestión Humana", () => {
    const antes = entradasDeGh(["novedades.acceder"]).map((i) => i.id);
    expect(antes).toContain("gh-dias");
    const con = entradasDeGh(["novedades.acceder", "llamados.ver"]).map(
      (i) => i.id,
    );
    expect(con.filter((id) => id !== "gh-llamados")).toEqual(antes);
  });
});
