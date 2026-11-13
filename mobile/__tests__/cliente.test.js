import { crearCliente } from "../src/api/cliente";

/** Una respuesta de `fetch` con lo mínimo que lee el cliente. */
function respuesta(status, cuerpo) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (cuerpo === undefined ? "" : JSON.stringify(cuerpo)),
  };
}

function error401(code) {
  return respuesta(401, { error: { code, message: "No autorizado.", details: {} } });
}

function almacenFalso({ access = "access-viejo", refresh = "refresh-viejo", empresa = "3" } = {}) {
  const estado = { access, refresh, empresa };
  return {
    estado,
    tokens: () => ({ access: estado.access, refresh: estado.refresh }),
    guardarTokens: jest.fn(async (a, r) => {
      estado.access = a;
      estado.refresh = r;
    }),
    empresa: () => estado.empresa,
  };
}

const UA = "IntranetLCE/1.0.0 (android)";

function montar({ fetchImpl, almacen = almacenFalso(), alTerminarSesion = jest.fn() } = {}) {
  const cliente = crearCliente({
    baseUrl: "https://api.prueba/api/v1",
    almacen,
    userAgent: UA,
    fetchImpl,
    alTerminarSesion,
  });
  return { cliente, almacen, alTerminarSesion };
}

/** Un fetch que responde según la ruta y el token: el access nuevo vale, el
 * viejo da 401 con `code`. */
function servidor({ codigoDelViejo = "token_not_valid", refresh = () => respuesta(200, { access: "access-nuevo", refresh: "refresh-nuevo" }) } = {}) {
  return jest.fn(async (url, opciones) => {
    if (url.endsWith("/auth/token/refresh/")) return refresh(opciones);
    if (opciones.headers.Authorization === "Bearer access-nuevo") return respuesta(200, { url });
    return error401(codigoDelViejo);
  });
}

describe("cliente HTTP", () => {
  it("manda el Bearer, la empresa y el User-Agent de la app en cada petición", async () => {
    const fetchImpl = jest.fn(async () => respuesta(200, { ok: true }));
    const { cliente } = montar({ fetchImpl });

    await cliente.get("/notificaciones/", { params: { page: 2, estado: undefined } });

    const [url, opciones] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.prueba/api/v1/notificaciones/?page=2");
    expect(opciones.headers.Authorization).toBe("Bearer access-viejo");
    expect(opciones.headers["X-Empresa"]).toBe("3");
    expect(opciones.headers["User-Agent"]).toBe(UA);
  });

  it("también manda el User-Agent en el login, sin token", async () => {
    const fetchImpl = jest.fn(async () => respuesta(200, { access: "a", refresh: "r" }));
    const { cliente } = montar({ fetchImpl, almacen: almacenFalso({ access: null, refresh: null }) });

    await cliente.post("/auth/login/", { identifier: "ana", password: "x" });

    const [, opciones] = fetchImpl.mock.calls[0];
    expect(opciones.headers["User-Agent"]).toBe(UA);
    expect(opciones.headers.Authorization).toBeUndefined();
    expect(JSON.parse(opciones.body)).toEqual({ identifier: "ana", password: "x" });
  });

  it("ante un 401 renueva con el refresh, guarda los dos tokens y reintenta", async () => {
    const fetchImpl = servidor();
    const { cliente, almacen, alTerminarSesion } = montar({ fetchImpl });

    const datos = await cliente.get("/auth/me/");

    expect(datos.url).toContain("/auth/me/");
    expect(almacen.guardarTokens).toHaveBeenCalledWith("access-nuevo", "refresh-nuevo");
    const refresco = fetchImpl.mock.calls.find(([url]) => url.endsWith("/auth/token/refresh/"));
    expect(JSON.parse(refresco[1].body)).toEqual({ refresh: "refresh-viejo" });
    expect(refresco[1].headers["User-Agent"]).toBe(UA);
    expect(alTerminarSesion).not.toHaveBeenCalled();
  });

  it("con varias peticiones a la vez renueva una sola vez (cola)", async () => {
    let soltar;
    const fetchImpl = servidor({
      refresh: () =>
        new Promise((resolver) => {
          soltar = () => resolver(respuesta(200, { access: "access-nuevo", refresh: "refresh-nuevo" }));
        }),
    });
    const { cliente } = montar({ fetchImpl });

    const pedidas = [cliente.get("/a/"), cliente.get("/b/"), cliente.get("/c/")];
    // Que las tres reciban su 401 y queden esperando la misma renovación.
    await new Promise((r) => setTimeout(r, 0));
    soltar();
    const resultados = await Promise.all(pedidas);

    const refrescos = fetchImpl.mock.calls.filter(([url]) => url.endsWith("/auth/token/refresh/"));
    expect(refrescos).toHaveLength(1);
    expect(resultados.map((r) => r.url.slice(-3))).toEqual(["/a/", "/b/", "/c/"]);
  });

  it("si la sesión fue revocada (authentication_failed y el refresh da 401) borra los tokens y avisa una sola vez", async () => {
    const fetchImpl = servidor({
      codigoDelViejo: "authentication_failed",
      refresh: () => error401("authentication_failed"),
    });
    const { cliente, almacen, alTerminarSesion } = montar({ fetchImpl });

    const resultados = await Promise.allSettled([cliente.get("/a/"), cliente.get("/b/")]);

    expect(resultados.every((r) => r.status === "rejected")).toBe(true);
    expect(almacen.estado.access).toBeNull();
    expect(almacen.estado.refresh).toBeNull();
    expect(alTerminarSesion).toHaveBeenCalledTimes(1);
    expect(alTerminarSesion).toHaveBeenCalledWith(
      expect.objectContaining({ accessAnterior: "access-viejo" }),
    );
  });

  it.each(["session_idle_timeout", "session_revoked"])(
    "con %s cierra sin intentar renovar",
    async (codigo) => {
      const fetchImpl = jest.fn(async () => error401(codigo));
      const { cliente, alTerminarSesion } = montar({ fetchImpl });

      await expect(cliente.get("/a/")).rejects.toMatchObject({ codigo });

      expect(fetchImpl.mock.calls.some(([url]) => url.endsWith("/auth/token/refresh/"))).toBe(false);
      expect(alTerminarSesion).toHaveBeenCalledWith(expect.objectContaining({ codigo }));
    },
  );

  it("si el reintento con el token nuevo vuelve a dar 401, la sesión terminó", async () => {
    const fetchImpl = jest.fn(async (url) =>
      url.endsWith("/auth/token/refresh/")
        ? respuesta(200, { access: "access-nuevo", refresh: "refresh-nuevo" })
        : error401("authentication_failed"),
    );
    const { cliente, alTerminarSesion } = montar({ fetchImpl });

    await expect(cliente.get("/a/")).rejects.toBeTruthy();
    expect(alTerminarSesion).toHaveBeenCalledTimes(1);
  });

  it.each([
    [500, { error: { code: "internal_error", message: "Ocurrió un error interno." } }],
    [503, { error: { code: "service_unavailable", message: "Servicio no disponible." } }],
    [502, "<html>Bad Gateway</html>"],
    [429, { error: { code: "throttled", message: "Demasiadas solicitudes." } }],
  ])("un %s al renovar es temporal: no cierra la sesión", async (status, cuerpo) => {
    const fetchImpl = jest.fn(async (url) =>
      url.endsWith("/auth/token/refresh/")
        ? { status, ok: false, text: async () => (typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo)) }
        : error401("token_not_valid"),
    );
    const { cliente, almacen, alTerminarSesion } = montar({ fetchImpl });

    await expect(cliente.get("/a/")).rejects.toMatchObject({ response: { status } });
    expect(alTerminarSesion).not.toHaveBeenCalled();
    expect(almacen.estado.access).toBe("access-viejo");
    expect(almacen.estado.refresh).toBe("refresh-viejo");
  });

  it("si otra petición ya renovó mientras esta viajaba, reintenta sin renovar otra vez", async () => {
    const almacen = almacenFalso();
    const fetchImpl = jest.fn(async (url, opciones) => {
      if (url.endsWith("/auth/token/refresh/")) throw new Error("no debía renovar");
      if (opciones.headers.Authorization === "Bearer access-nuevo") return respuesta(200, { ok: true });
      // Mientras esta petición viajaba con el token viejo, otra lo renovó.
      almacen.estado.access = "access-nuevo";
      almacen.estado.refresh = "refresh-nuevo";
      return error401("token_not_valid");
    });
    const { cliente } = montar({ fetchImpl, almacen });

    await expect(cliente.get("/a/")).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("acepta una cabecera X-Empresa propia en la petición (la del push)", async () => {
    const fetchImpl = jest.fn(async () => respuesta(200, {}));
    const { cliente } = montar({ fetchImpl });

    await cliente.get("/notificaciones/9/", { cabeceras: { "X-Empresa": "7" } });

    expect(fetchImpl.mock.calls[0][1].headers["X-Empresa"]).toBe("7");
  });

  it("un fallo de red al renovar no cierra la sesión", async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (url.endsWith("/auth/token/refresh/")) throw new TypeError("Network request failed");
      return error401("token_not_valid");
    });
    const { cliente, almacen, alTerminarSesion } = montar({ fetchImpl });

    await expect(cliente.get("/a/")).rejects.toMatchObject({ esDeRed: true });
    expect(alTerminarSesion).not.toHaveBeenCalled();
    expect(almacen.estado.refresh).toBe("refresh-viejo");
  });

  it("el 401 del login es un error del formulario, no un cierre de sesión", async () => {
    const fetchImpl = jest.fn(async () => error401("invalid_credentials"));
    const { cliente, alTerminarSesion } = montar({
      fetchImpl,
      almacen: almacenFalso({ access: null, refresh: null }),
    });

    await expect(cliente.post("/auth/login/", {})).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(alTerminarSesion).not.toHaveBeenCalled();
  });
});
