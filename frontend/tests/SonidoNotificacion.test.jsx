import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El sonido de una notificación nueva: se genera con Web Audio, respeta la
 * preferencia de la persona y no suena hasta que el navegador lo permite.
 */

const notas = [];
class ContextoFalso {
  constructor() {
    this.state = "suspended";
    this.currentTime = 0;
    this.destination = {};
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  createOscillator() {
    const oscilador = {
      type: "",
      frequency: { setValueAtTime: (f) => notas.push(f) },
      connect: (destino) => destino,
      start: vi.fn(),
      stop: vi.fn(),
    };
    return oscilador;
  }
  createGain() {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: (destino) => destino,
    };
  }
}

beforeEach(() => {
  notas.length = 0;
  localStorage.clear();
  window.AudioContext = ContextoFalso;
});

describe("El sonido de las notificaciones", () => {
  it("no suena hasta el primer clic; después, dos notas", async () => {
    const modulo = await import("../src/utils/sonidoNotificacion");
    const limpiar = modulo.prepararSonido();
    expect(modulo.sonarNotificacion()).toBe(false); // el navegador lo bloquea

    window.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    expect(modulo.sonarNotificacion()).toBe(true);
    expect(notas).toEqual([880, 660]);
    limpiar();
  });

  it("silenciado no suena y la preferencia se recuerda", async () => {
    const modulo = await import("../src/utils/sonidoNotificacion");
    expect(modulo.sonidoActivado()).toBe(true);
    modulo.fijarSonido(false);
    expect(modulo.sonidoActivado()).toBe(false);
    expect(modulo.sonarNotificacion()).toBe(false);
  });
});
