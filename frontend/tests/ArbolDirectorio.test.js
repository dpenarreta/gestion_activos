import { describe, expect, it } from "vitest";

import {
  arbolDeCargos,
  armarArbol,
  pisosDeRaices,
} from "../src/pages/Institucional/organigrama";

/*
 * El Directorio (19/11/2026): el Presidente arriba, los dos Directores
 * debajo y, en una fila bajo ellos, el Comité Ejecutivo, que informa a los
 * dos sin supervisión directa. El Gerente General encabeza su propia unidad
 * y aparece en el Comité como tarjeta de referencia.
 */

const cargo = (id, nombre, extra = {}) => ({
  id,
  nombre,
  unidad: 1,
  jefe: null,
  jefes_secundarios: [],
  ...extra,
});

const DIRECTORIO = [
  cargo(1, "Presidente del Directorio"),
  cargo(2, "Director Ejecutivo", { jefe: 1 }),
  cargo(3, "Director Financiero", { jefe: 1 }),
  cargo(4, "Gerente de Procesos y Proyectos", { jefes_secundarios: [2, 3] }),
  cargo(5, "Jefe Administrativo Financiero Corporativo", {
    jefes_secundarios: [2, 3],
  }),
];
const GERENTE_GENERAL = cargo(9, "Gerente General", {
  unidad: 2,
  jefes_secundarios: [2, 3],
});
const JEFE_DE_CARTERA = cargo(10, "Jefe de Cartera", {
  unidad: 3,
  jefe: 9,
  jefes_secundarios: [5],
});

describe("arbolDeCargos con quienes informan sin supervisión", () => {
  const raices = arbolDeCargos(DIRECTORIO, [
    ...DIRECTORIO,
    GERENTE_GENERAL,
    JEFE_DE_CARTERA,
  ]);

  it("deja una sola raíz: el Presidente, con los dos Directores debajo", () => {
    expect(raices.map((r) => r.cargo.nombre)).toEqual([
      "Presidente del Directorio",
    ]);
    expect(raices[0].hijos.map((h) => h.cargo.nombre)).toEqual([
      "Director Ejecutivo",
      "Director Financiero",
    ]);
  });

  it("pone al Comité Ejecutivo en una fila bajo los Directores, con el Gerente General de referencia", () => {
    const comite = raices[0].informan;
    expect(comite.map((r) => r.cargo.nombre)).toEqual([
      "Gerente de Procesos y Proyectos",
      "Gerente General",
      "Jefe Administrativo Financiero Corporativo",
    ]);
    expect(comite.every((r) => r.profundidad === 2)).toBe(true);
    expect(comite.find((r) => r.cargo.id === 9).cargo.externo).toBe(true);
    expect(comite.find((r) => r.cargo.id === 4).cargo.externo).toBeUndefined();
  });

  it("no trae a quien tiene jefe directo en otra unidad", () => {
    const todos = JSON.stringify(raices);
    expect(todos).not.toContain("Jefe de Cartera");
  });

  it("sin líneas punteadas el árbol es el de siempre", () => {
    const simples = arbolDeCargos([
      cargo(1, "Gerente"),
      cargo(2, "Jefe", { jefe: 1 }),
    ]);
    expect(simples[0].hijos[0].cargo.nombre).toBe("Jefe");
    expect(simples[0].informan).toEqual([]);
  });
});

describe("las raíces por pisos (19/11/2026)", () => {
  it("pone el Directorio arriba de todo y la Gerencia General debajo", () => {
    const raices = armarArbol({
      niveles: [
        { id: 1, nombre: "Gerencia General", orden: 1 },
        { id: 2, nombre: "Área", orden: 2 },
        { id: 3, nombre: "Directorio", orden: 0 },
      ],
      unidades: [
        { id: 10, nombre: "Gerencia General", nivel: 1, padre: null, orden: 0 },
        { id: 11, nombre: "TI", nivel: 2, padre: 10, orden: 0 },
        { id: 12, nombre: "Directorio", nivel: 3, padre: null, orden: 1 },
      ],
      cargos: [],
    });
    expect(raices.map((r) => r.nombre)).toEqual([
      "Directorio",
      "Gerencia General",
    ]);
    expect(pisosDeRaices(raices).map((p) => p.map((r) => r.nombre))).toEqual([
      ["Directorio"],
      ["Gerencia General"],
    ]);
  });

  it("las raíces de un mismo nivel quedan en el mismo piso", () => {
    const pisos = pisosDeRaices([
      { id: 1, nombre: "A", nivel: { orden: 1 } },
      { id: 2, nombre: "B", nivel: { orden: 1 } },
    ]);
    expect(pisos).toHaveLength(1);
    expect(pisos[0]).toHaveLength(2);
  });
});
