/**
 * La app pide con el `fetch` de React Native y no con el global de Expo
 * (16/11/2026): `expo/fetch` no acepta archivos `{uri, name, type}` en un
 * `FormData` y dejaba sin subir los respaldos y adjuntos.
 */
const mockFetchNativo = jest.fn(async () => ({ ok: true, status: 201, text: async () => '{"id":7}' }));
jest.mock("whatwg-fetch", () => ({ fetch: (...args) => mockFetchNativo(...args) }));

import { api } from "../src/api/api";
import { fetchNativo } from "../src/api/fetchNativo";

describe("fetch de React Native", () => {
  const fetchGlobal = global.fetch;

  beforeEach(() => {
    mockFetchNativo.mockClear();
    global.fetch = jest.fn(async () => {
      throw new Error("Unsupported FormDataPart implementation");
    });
  });

  afterAll(() => {
    global.fetch = fetchGlobal;
  });

  it("fetchNativo es el de whatwg-fetch, no el global", async () => {
    await fetchNativo("https://ejemplo/x");
    expect(mockFetchNativo).toHaveBeenCalledWith("https://ejemplo/x");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("un FormData con un archivo {uri} sale por el fetch de React Native", async () => {
    const datos = new FormData();
    datos.append("tipo", "foto");
    datos.append("archivo", { uri: "file:///cache/foto.jpg", name: "foto.jpg", type: "image/jpeg" });
    await expect(api.post("/adjuntos/", datos)).resolves.toEqual({ id: 7 });
    expect(global.fetch).not.toHaveBeenCalled();
    const [url, opciones] = mockFetchNativo.mock.calls[0];
    expect(url).toMatch(/\/adjuntos\/$/);
    expect(opciones.method).toBe("POST");
    expect(opciones.body).toBe(datos);
    // Sin Content-Type propio: lo pone el fetch con el boundary del multipart.
    expect(opciones.headers["Content-Type"]).toBeUndefined();
  });
});
