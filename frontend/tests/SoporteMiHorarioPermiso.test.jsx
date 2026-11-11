import { describe, expect, it } from "vitest";

import {
  getVisibleAdminMenu,
  modulosConAcceso,
} from "../src/components/admin/AdminSidebar/staticAdminMenu";

/*
 * «Mi horario» de la Mesa de ayuda tiene su propio permiso desde el 10/11/2026
 * (`soporte.mi_horario`): antes colgaba de `soporte.atender`.
 */

const hojas = (items) =>
  items.flatMap((i) => [...(i.path ? [i] : []), ...hojas(i.children ?? [])]);

const entradas = (permisos) =>
  hojas(getVisibleAdminMenu(permisos, "soporte")).map((i) => i.id);

describe("«Mi horario» con su propio permiso", () => {
  it("aparece con soporte.mi_horario", () => {
    expect(entradas(["soporte.mi_horario"])).toContain("soporte-horario");
    expect(modulosConAcceso(["soporte.mi_horario"])).toContain("soporte");
  });

  it("atender tickets ya no lo trae", () => {
    expect(entradas(["soporte.atender"])).not.toContain("soporte-horario");
  });
});
