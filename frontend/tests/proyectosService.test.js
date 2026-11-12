import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El servicio de proyectos y procesos (US-008, 12/11/2026): cada pedido lleva
 * `?categoria=`; sin categoría, `proyecto`, como hasta ahora.
 */

const respuesta = { data: { por_atender: 0 } };
const apiClient = {
  get: vi.fn(() => Promise.resolve(respuesta)),
  post: vi.fn(() => Promise.resolve(respuesta)),
  put: vi.fn(() => Promise.resolve(respuesta)),
  patch: vi.fn(() => Promise.resolve(respuesta)),
  delete: vi.fn(() => Promise.resolve(respuesta)),
};
vi.mock("../src/api/client", () => ({ apiClient }));
vi.mock("../src/utils/descargas", () => ({ descargarBlob: vi.fn() }));

const { crearServicio, proyectosService, procesosService, servicioDe } =
  await import("../src/api/proyectosService");

/** Los parámetros de consulta del último pedido de ese método. */
function params(metodo) {
  const llamada = apiClient[metodo].mock.calls.at(-1);
  return llamada.at(-1).params;
}

beforeEach(() => vi.clearAllMocks());

describe("proyectosService con categoría", () => {
  it("sin categoría pide proyectos", async () => {
    await crearServicio().resumen();
    expect(apiClient.get).toHaveBeenCalledWith(
      "/proyectos/solicitudes/resumen/",
      {
        params: { categoria: "proyecto" },
      },
    );
    await proyectosService.tipos();
    expect(params("get")).toEqual({ categoria: "proyecto" });
  });

  it("el de procesos manda categoria=proceso en cada pedido", async () => {
    const s = procesosService;
    await s.tipos();
    expect(params("get")).toEqual({ categoria: "proceso" });
    await s.solicitudes("por_atender");
    expect(params("get")).toEqual({
      vista: "por_atender",
      categoria: "proceso",
    });
    await s.solicitud(3);
    expect(params("get")).toEqual({ categoria: "proceso" });
    await s.plantilla(2);
    expect(apiClient.get.mock.calls.at(-1)[1]).toEqual({
      responseType: "blob",
      params: { categoria: "proceso" },
    });
    await s.solicitar({ tipo_proyecto: 1, titulo: "T", respuestas: {} });
    expect(params("post")).toEqual({ categoria: "proceso" });
    await s.aprobar(3, "ok");
    expect(apiClient.post.mock.calls.at(-1)).toEqual([
      "/proyectos/solicitudes/3/aprobar/",
      { comentario: "ok" },
      { params: { categoria: "proceso" } },
    ]);
    await s.escalar(3, { tipo: "rol", rol: 2 }, "");
    expect(params("post")).toEqual({ categoria: "proceso" });
    await s.opciones();
    expect(params("get")).toEqual({ categoria: "proceso" });
    await s.tiposConfigurados();
    expect(params("get")).toEqual({ categoria: "proceso" });
    await s.guardarTipo(null, { nombre: "N" });
    expect(params("post")).toEqual({ categoria: "proceso" });
    await s.guardarTipo(4, { nombre: "N" });
    expect(params("put")).toEqual({ categoria: "proceso" });
    await s.activarTipo(4, true);
    expect(params("patch")).toEqual({ categoria: "proceso" });
    await s.eliminarTipo(4);
    expect(params("delete")).toEqual({ categoria: "proceso" });
  });

  it("servicioDe devuelve el de cada categoría y rechaza otras", () => {
    expect(servicioDe("proceso")).toBe(procesosService);
    expect(servicioDe("proyecto")).toBe(proyectosService);
    expect(servicioDe()).toBe(proyectosService);
    expect(() => crearServicio("otra")).toThrow(/desconocida/);
  });
});
