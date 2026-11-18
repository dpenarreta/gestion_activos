import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { FAMILIA, familiaDe } from "../src/utils/coloresDeModulo";

/* Las notificaciones de la web con los colores de la app móvil
   (18/11/2026): la misma familia por módulo y la misma paleta. */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const leer = (ruta) => fs.readFileSync(path.join(RAIZ, ruta), "utf-8");

describe("Colores de módulo iguales en web y móvil", () => {
  it("cada módulo va a la misma familia que en la app", () => {
    const movil = leer("mobile/src/notificaciones/coloresDeModulo.js");
    const bloque = movil.slice(movil.indexOf("const FAMILIA = {"));
    const pares = Object.fromEntries(
      [
        ...bloque.slice(0, bloque.indexOf("};")).matchAll(/(\w+): "(\w+)"/g),
      ].map((m) => [m[1], m[2]]),
    );
    expect(FAMILIA).toEqual(pares);
  });

  it("la web usa los mismos colores de la paleta de la app, en claro y en oscuro", () => {
    const paleta = leer("mobile/src/tema/familias.js");
    // Sin distinguir mayúsculas: el formateador escribe los colores en
    // minúsculas.
    const css = leer(
      "frontend/src/components/admin/Notificaciones/CampanaNotificaciones.css",
    ).toUpperCase();
    const claro = paleta.slice(
      paleta.indexOf("export const COLORES_DE_MODULO = {"),
      paleta.indexOf("// En claro"),
    );
    for (const m of claro.matchAll(
      /(\w+): \{\s*nombre: "[^"]*",\s*icono: "(#\w+)",\s*fondo: "(#\w+)",\s*etiqueta: "(#\w+)"/g,
    )) {
      const [, familia, icono, fondo, etiqueta] = m;
      const regla = css.slice(
        css.indexOf(`.CAMPANA-ITEM--${familia.toUpperCase()} {`),
      );
      expect(regla.slice(0, regla.indexOf("}"))).toContain(icono);
      expect(regla.slice(0, regla.indexOf("}"))).toContain(fondo);
      expect(regla.slice(0, regla.indexOf("}"))).toContain(etiqueta);
    }
    const oscuro = paleta.slice(paleta.indexOf("COLORES_DE_MODULO_OSCURO = {"));
    for (const m of oscuro.matchAll(
      /(\w+): \{ icono: "(#\w+)", fondo: "(#\w+)", etiqueta: "(#\w+)"/g,
    )) {
      const [, familia, icono, fondo, etiqueta] = m;
      const regla = css.slice(
        css.indexOf(
          `:ROOT[DATA-THEME="DARK"] .CAMPANA-ITEM--${familia.toUpperCase()} {`,
        ),
      );
      const cuerpo = regla.slice(0, regla.indexOf("}"));
      expect(cuerpo).toContain(icono);
      expect(cuerpo).toContain(fondo);
      expect(cuerpo).toContain(etiqueta);
    }
  });

  it("la familia sale del módulo o del prefijo del tipo", () => {
    expect(familiaDe({ modulo: "licencias" })).toBe("permisos");
    expect(familiaDe({ tipo: "chat.reunion" })).toBe("chat");
    expect(familiaDe({ modulo: "otro" })).toBe("sistema");
  });
});
