import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAXIMO_BYTES_IMAGEN,
  formatearMegabytes,
  optimizarImagen,
} from "../src/utils/imagenes";

/*
 * Optimizar imágenes en el navegador antes de subirlas (US-007, CA-1). jsdom
 * no tiene `createImageBitmap` ni lienzo: se simulan, y cada prueba dice qué
 * medidas tiene la imagen, si es transparente y cuánto pesa cada formato.
 */

const MB = 1024 * 1024;

function archivo(nombre, tipo, bytes) {
  const f = new File(["x"], nombre, { type: tipo });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

let simulado;

class LienzoSimulado {
  constructor(ancho, alto) {
    this.width = ancho;
    this.height = alto;
    simulado.lienzos.push(this);
    simulado.medidasCreadas.push({ width: ancho, height: alto });
  }

  getContext() {
    // Safari 16.0–16.3: hay OffscreenCanvas, pero sin contexto 2D.
    if (simulado.sinContextoOffscreen) return null;
    return {
      drawImage: vi.fn(),
      getImageData: (x, y, ancho, alto) => {
        const data = new Uint8ClampedArray(ancho * alto * 4).fill(255);
        if (simulado.transparente) data[3] = 0;
        return { data };
      },
    };
  }

  convertToBlob({ type }) {
    simulado.pedidos.push(type);
    // Sin WebP, el navegador entrega PNG en su lugar.
    const tipo = type === "image/webp" && !simulado.webp ? "image/png" : type;
    return Promise.resolve(
      new Blob([new Uint8Array(simulado.pesos[tipo] ?? 1000)], { type: tipo }),
    );
  }
}

beforeEach(() => {
  simulado = {
    medidas: { width: 4000, height: 3000 },
    transparente: false,
    webp: true,
    pesos: {},
    lienzos: [],
    medidasCreadas: [],
    pedidos: [],
    cerrada: false,
  };
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() =>
      Promise.resolve({
        ...simulado.medidas,
        close: () => {
          simulado.cerrada = true;
        },
      }),
    ),
  );
  vi.stubGlobal("OffscreenCanvas", LienzoSimulado);
});

afterEach(() => vi.unstubAllGlobals());

describe("formatearMegabytes", () => {
  it("se reexporta desde formato.js, con dos decimales fijos", () => {
    expect(formatearMegabytes(5_284_823)).toBe("5,04 MB");
    expect(formatearMegabytes(1_258_291)).toBe("1,20 MB");
  });
});

describe("optimizarImagen", () => {
  it("no toca una imagen liviana y de medida razonable", async () => {
    simulado.medidas = { width: 1600, height: 1000 };
    const original = archivo("foto.jpg", "image/jpeg", 800_000);
    const resultado = await optimizarImagen(original);
    expect(resultado).toEqual({
      archivo: original,
      optimizada: false,
      antes: 800_000,
      despues: 800_000,
    });
    expect(simulado.lienzos).toHaveLength(0);
    expect(simulado.cerrada).toBe(true);
  });

  it("reduce una grande a 2400 px por el lado mayor, conservando la proporción", async () => {
    simulado.medidas = { width: 3000, height: 4000 };
    simulado.pesos["image/jpeg"] = 1_200_000;
    const original = archivo("afiche.jpeg", "image/jpeg", 5_284_823);
    const resultado = await optimizarImagen(original);

    expect(globalThis.createImageBitmap).toHaveBeenCalledWith(original, {
      imageOrientation: "from-image",
    });
    expect(simulado.medidasCreadas[0]).toEqual({ width: 1800, height: 2400 });
    expect(resultado.optimizada).toBe(true);
    expect(resultado.antes).toBe(5_284_823);
    expect(resultado.despues).toBe(1_200_000);
    expect(resultado.archivo.type).toBe("image/jpeg");
    expect(resultado.archivo.name).toBe("afiche.jpg");
  });

  it("también reduce una que pesa más de 5 MB aunque mida poco", async () => {
    simulado.medidas = { width: 1600, height: 1000 };
    simulado.pesos["image/jpeg"] = 900_000;
    const resultado = await optimizarImagen(
      archivo("foto.jpg", "image/jpeg", MAXIMO_BYTES_IMAGEN + 1),
    );
    expect(simulado.medidasCreadas[0]).toEqual({ width: 1600, height: 1000 });
    expect(resultado.optimizada).toBe(true);
  });

  it("un PNG con transparencia sale WebP, nunca JPEG", async () => {
    simulado.transparente = true;
    simulado.pesos["image/webp"] = 700_000;
    const resultado = await optimizarImagen(
      archivo("logo.png", "image/png", 6 * MB),
    );
    expect(simulado.pedidos).not.toContain("image/jpeg");
    expect(resultado.archivo.type).toBe("image/webp");
    expect(resultado.archivo.name).toBe("logo.webp");
  });

  it("sin WebP en el navegador, un PNG transparente sigue siendo PNG", async () => {
    simulado.transparente = true;
    simulado.webp = false;
    simulado.pesos["image/png"] = 3 * MB;
    const resultado = await optimizarImagen(
      archivo("logo.png", "image/png", 6 * MB),
    );
    expect(simulado.pedidos).not.toContain("image/jpeg");
    expect(resultado.archivo.type).toBe("image/png");
    expect(resultado.archivo.name).toBe("logo.png");
  });

  it("un PNG opaco puede pasar a JPEG", async () => {
    simulado.pesos["image/jpeg"] = 1 * MB;
    const resultado = await optimizarImagen(
      archivo("foto.png", "image/png", 6 * MB),
    );
    expect(resultado.archivo.type).toBe("image/jpeg");
    expect(resultado.archivo.name).toBe("foto.jpg");
  });

  it("si la versión optimizada no pesa menos, devuelve el original", async () => {
    simulado.pesos["image/jpeg"] = 7 * MB;
    const original = archivo("foto.jpg", "image/jpeg", 6 * MB);
    const resultado = await optimizarImagen(original);
    expect(resultado.archivo).toBe(original);
    expect(resultado.optimizada).toBe(false);
    expect(resultado.despues).toBe(6 * MB);
  });

  it("si el navegador no puede leerla, devuelve el original", async () => {
    globalThis.createImageBitmap.mockRejectedValue(new Error("dañada"));
    const original = archivo("foto.jpg", "image/jpeg", 6 * MB);
    const resultado = await optimizarImagen(original);
    expect(resultado.archivo).toBe(original);
    expect(resultado.optimizada).toBe(false);
  });

  it("no intenta con lo que no es JPG, PNG ni WebP", async () => {
    const original = archivo("animada.gif", "image/gif", 6 * MB);
    const resultado = await optimizarImagen(original);
    expect(resultado.archivo).toBe(original);
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });
});

describe("optimizarImagen en navegadores con carencias", () => {
  it("si OffscreenCanvas no da contexto 2D (Safari 16.0–16.3), usa un <canvas> y lo libera", async () => {
    simulado.sinContextoOffscreen = true;
    simulado.pesos["image/jpeg"] = 1 * MB;
    const crear = document.createElement.bind(document);
    let canvas;
    vi.spyOn(document, "createElement").mockImplementation((etiqueta) => {
      if (etiqueta !== "canvas") return crear(etiqueta);
      canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (resolver, tipo) =>
          resolver(new Blob([new Uint8Array(1 * MB)], { type: tipo })),
      };
      return canvas;
    });
    const resultado = await optimizarImagen(
      archivo("foto.jpg", "image/jpeg", 6 * MB),
    );
    expect(resultado.optimizada).toBe(true);
    expect(resultado.despues).toBe(1 * MB);
    // Liberado tras usarlo: no retiene ~20 MB hasta que pase el recolector.
    expect(canvas).toMatchObject({ width: 0, height: 0 });
    vi.restoreAllMocks();
  });

  it("reintenta sin opciones solo si el navegador no las entiende (TypeError)", async () => {
    simulado.pesos["image/jpeg"] = 1 * MB;
    globalThis.createImageBitmap
      .mockRejectedValueOnce(new TypeError("opción desconocida"))
      .mockResolvedValueOnce({ width: 4000, height: 3000, close: vi.fn() });
    const resultado = await optimizarImagen(
      archivo("foto.jpg", "image/jpeg", 6 * MB),
    );
    expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(2);
    expect(resultado.optimizada).toBe(true);
  });

  it("con una imagen dañada no reintenta", async () => {
    globalThis.createImageBitmap.mockRejectedValueOnce(
      new DOMException("dañada", "InvalidStateError"),
    );
    const original = archivo("foto.jpg", "image/jpeg", 6 * MB);
    const resultado = await optimizarImagen(original);
    expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);
    expect(resultado.archivo).toBe(original);
  });
});
