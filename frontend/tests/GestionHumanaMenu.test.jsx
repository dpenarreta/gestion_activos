import { describe, expect, it } from "vitest";

import {
  getVisibleAdminMenu,
  modulosConAcceso,
} from "../src/components/admin/AdminSidebar/staticAdminMenu";
import { MODULOS, moduloDeRuta } from "../src/modulos/modulos";

/*
 * Gestión Humana en el menú: cada pestaña de Nexo es una entrada del menú
 * lateral, filtrada por los permisos del catálogo (`novedades.*`).
 */

const entradas = (permisos) =>
  getVisibleAdminMenu(permisos, "gestion_humana")
    .filter((i) => i.modulo === "gestion_humana")
    .map((i) => i.id);

describe("Gestión Humana en el menú", () => {
  it("está registrado como módulo con su prefijo", () => {
    const modulo = MODULOS.find((m) => m.id === "gestion_humana");
    expect(modulo).toMatchObject({
      nombre: "Gestión Humana",
      prefijo: "/admin/gestion-humana",
    });
    expect(moduloDeRuta("/admin/gestion-humana/horas-extras")).toBe(
      "gestion_humana",
    );
  });

  it("con el acceso al módulo ve Días laborados, Horas extras y Colaboradores", () => {
    expect(entradas(["novedades.acceder"])).toEqual([
      "gh-dias",
      "gh-horas",
      "gh-colaboradores",
    ]);
  });

  it("el Supervisor ve el repositorio pero no el historial de registros", () => {
    // Rol Supervisor: `historial_ver` le da solo el Repositorio mensual.
    expect(entradas(["novedades.acceder", "novedades.historial_ver"])).toEqual([
      "gh-dias",
      "gh-horas",
      "gh-colaboradores",
      "gh-repositorio",
    ]);
  });

  it("el Asistente ve el historial (historial y consolidado)", () => {
    expect(
      entradas([
        "novedades.acceder",
        "novedades.historial_ver",
        "novedades.consolidado_ver",
      ]),
    ).toContain("gh-historial");
  });

  it("el Jefe (consolidado sin historial) no ve el historial", () => {
    expect(
      entradas([
        "novedades.acceder",
        "novedades.consolidado_ver",
        "novedades.depurar",
      ]),
    ).not.toContain("gh-historial");
  });

  it("Horas depuradas, para quien depura o administra", () => {
    expect(entradas(["novedades.acceder", "novedades.depurar"])).toContain(
      "gh-depuradas",
    );
    expect(entradas(["novedades.acceder"])).not.toContain("gh-depuradas");
  });

  it("Ingresos y salidas va con sus propios permisos, sin el acceso al resto", () => {
    expect(entradas(["novedades.salidas_ver"])).toEqual(["gh-movimientos"]);
    expect(entradas(["novedades.ingresos_ver"])).toEqual(["gh-movimientos"]);
  });

  it("la configuración del módulo es del administrador", () => {
    expect(entradas(["novedades.acceder"])).not.toContain("gh-configuracion");
    expect(
      entradas(["novedades.acceder", "novedades.permisos_gestionar"]),
    ).toContain("gh-configuracion");
  });

  it("el administrador ve las ocho entradas", () => {
    expect(
      entradas([
        "novedades.acceder",
        "novedades.historial_ver",
        "novedades.administrar",
        "novedades.permisos_gestionar",
        "novedades.ingresos_ver",
      ]),
    ).toEqual([
      "gh-dias",
      "gh-horas",
      "gh-colaboradores",
      "gh-historial",
      "gh-repositorio",
      "gh-depuradas",
      "gh-movimientos",
      "gh-configuracion",
    ]);
  });

  it("sin permisos del módulo no se ofrece en el selector", () => {
    expect(modulosConAcceso(["activos.ver"])).not.toContain("gestion_humana");
    expect(modulosConAcceso(["novedades.acceder"])).toContain("gestion_humana");
  });
});
