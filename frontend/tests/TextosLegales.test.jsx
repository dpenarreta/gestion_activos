import { describe, expect, it } from "vitest";

import {
  PERMISOS_CONFIGURACION,
  RUTAS_CONFIGURACION,
  SECCIONES_CONFIGURACION,
  seccionesVisibles,
} from "../src/components/admin/ConfiguracionMarco/seccionesConfiguracion";

/*
 * Configuración → «Textos legales» (26/10/2026) desapareció con US-004
 * (11/11/2026, CA-7): todos los textos de protección de datos se editan en
 * «Protección de datos» → «Textos». La dirección vieja redirige allá
 * (`AppRoutes`); quien tenía `configuracion.textos_legales` recibió
 * `privacidad.textos`.
 */

describe("Textos legales fuera de Configuración", () => {
  it("ya no es una pestaña de Configuración", () => {
    expect(SECCIONES_CONFIGURACION.map((s) => s.id)).not.toContain(
      "textos-legales",
    );
    expect(RUTAS_CONFIGURACION).not.toContain(
      "/admin/configuracion/textos-legales",
    );
  });

  it("su permiso viejo ya no abre nada en Configuración", () => {
    expect(PERMISOS_CONFIGURACION).not.toContain(
      "configuracion.textos_legales",
    );
    expect(seccionesVisibles(["configuracion.textos_legales"])).toEqual([]);
  });
});
