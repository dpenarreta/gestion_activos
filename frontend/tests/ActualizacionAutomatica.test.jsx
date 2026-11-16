import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * La web se recarga sola con una versión nueva, solo si no hay nada que
 * guardar (16/11/2026).
 */

const sinGuardar = { valor: false };
vi.mock("../src/context/UnsavedChangesContext", () => ({
  useUnsavedChanges: () => ({ haySinGuardar: () => sinGuardar.valor }),
}));

const { ActualizacionAutomatica, hayAlgoEscribiendose } =
  await import("../src/components/admin/ActualizacionAutomatica/ActualizacionAutomatica");

function publicada(script) {
  return Promise.resolve({
    ok: true,
    text: () =>
      Promise.resolve(
        `<html><script type="module" src="${script}"></script></html>`,
      ),
  });
}

describe("Recarga automática por versión nueva", () => {
  let recargar;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("DEV", false);
    sinGuardar.valor = false;
    document.head.innerHTML =
      '<script type="module" src="/assets/index-VIEJO1.js"></script>';
    document.body.innerHTML = "";
    recargar = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload: recargar });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("con la misma versión no recarga", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => publicada("/assets/index-VIEJO1.js")),
    );
    render(<ActualizacionAutomatica />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(fetch).toHaveBeenCalled();
    expect(recargar).not.toHaveBeenCalled();
  });

  it("con una versión nueva y nada que guardar, recarga", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => publicada("/assets/index-NUEVO2.js")),
    );
    render(<ActualizacionAutomatica />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it("con cambios sin guardar espera, y recarga cuando ya no hay", async () => {
    sinGuardar.valor = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => publicada("/assets/index-NUEVO2.js")),
    );
    render(<ActualizacionAutomatica />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(recargar).not.toHaveBeenCalled();
    sinGuardar.valor = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(recargar).toHaveBeenCalledTimes(1);
  });
});

describe("¿Hay algo escribiéndose?", () => {
  it("un mensaje a medio escribir, un campo con el foco o una ventana abierta lo impiden", () => {
    document.body.innerHTML = "<textarea></textarea><input id='c' />";
    expect(hayAlgoEscribiendose()).toBe(false);
    document.querySelector("textarea").value = "Hola, te escribo…";
    expect(hayAlgoEscribiendose()).toBe(true);
    document.querySelector("textarea").value = "";
    document.getElementById("c").focus();
    expect(hayAlgoEscribiendose()).toBe(true);
    document.getElementById("c").blur();
    document.body.insertAdjacentHTML(
      "beforeend",
      "<div class='modal show'></div>",
    );
    expect(hayAlgoEscribiendose()).toBe(true);
  });
});
