import { beforeEach, describe, expect, it } from "vitest";

import {
  DIAS_RECORDADO,
  leerUsuarioRecordado,
  olvidarUsuario,
  recordarUsuario,
} from "../src/utils/usuarioRecordado";

/* El usuario se recuerda en el equipo por 30 días (17/11/2026). */

const DIA = 24 * 60 * 60 * 1000;

beforeEach(() => localStorage.clear());

describe("Usuario recordado", () => {
  it("se recuerda 30 días y luego se olvida solo", () => {
    const ahora = Date.UTC(2026, 10, 17);
    recordarUsuario("  dpenarreta ", ahora);
    expect(leerUsuarioRecordado(ahora + 29 * DIA)).toBe("dpenarreta");
    expect(leerUsuarioRecordado(ahora + DIAS_RECORDADO * DIA)).toBe("");
    expect(localStorage.length).toBe(0);
  });

  it("cada ingreso vuelve a contar los 30 días", () => {
    const ahora = Date.UTC(2026, 10, 1);
    recordarUsuario("20104758", ahora);
    recordarUsuario("20104758", ahora + 20 * DIA);
    expect(leerUsuarioRecordado(ahora + 45 * DIA)).toBe("20104758");
  });

  it("se puede olvidar y nunca guarda nada vacío", () => {
    recordarUsuario("");
    expect(localStorage.length).toBe(0);
    recordarUsuario("ana");
    olvidarUsuario();
    expect(leerUsuarioRecordado()).toBe("");
  });

  it("un valor dañado no rompe la pantalla", () => {
    localStorage.setItem("intranet.usuario_recordado", "{no es json");
    expect(leerUsuarioRecordado()).toBe("");
  });
});
