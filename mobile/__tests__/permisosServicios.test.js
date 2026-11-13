import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import { api } from "../src/api/api";
import { crearCliente } from "../src/api/cliente";
import { erroresPorCampo, mensajeDeFormulario } from "../src/api/errores";
import {
  directorioService,
  licenciasService,
  reemplazoService,
  vacacionesService,
} from "../src/api/servicios";
import { destinoDeNotificacion } from "../src/notificaciones/abrir";
import { rutaDeLicencias, rutaEnApp } from "../src/notificaciones/modulosEnApp";
import {
  elegirImagen,
  elegirPdf,
  TAMANO_MAXIMO,
  TEXTO_DEMASIADO_GRANDE,
  TEXTO_TIPO_NO_PERMITIDO,
  tomarFoto,
  validarArchivo,
} from "../src/permisos/adjunto";
import {
  borrarDocumentosDescargados,
  descargarDocumento,
  estadoDeError,
  TEXTO_DOCUMENTO_NO_DISPONIBLE,
  tipoDeDocumento,
} from "../src/permisos/documentos";
import { fechaCorta, pendienteDe, requisitosDe, textoDeAccion } from "../src/permisos/formato";

jest.mock("../src/api/api", () => ({
  api: {
    get: jest.fn(async () => ({})),
    post: jest.fn(async () => ({})),
    put: jest.fn(async () => ({})),
    url: (ruta) => `https://api.prueba/api/v1${ruta}`,
    conRenovacion: jest.fn(async (hacer, { empresa } = {}) =>
      hacer({ Authorization: "Bearer access", ...(empresa ? { "X-Empresa": empresa } : {}) }),
    ),
  },
  escucharSesion: () => () => {},
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("licenciasService: rutas del contrato", () => {
  it("usa las mismas rutas que la web", async () => {
    await licenciasService.tipos();
    await licenciasService.evaluar(5, "2026-11-16", "2026-11-20");
    await licenciasService.resumen();
    await licenciasService.solicitudes("por_aprobar");
    await licenciasService.solicitud(12);
    await vacacionesService.mias();

    expect(api.get.mock.calls).toEqual([
      ["/licencias/tipos/"],
      ["/licencias/tipos/5/evaluar/", { params: { desde: "2026-11-16", hasta: "2026-11-20" } }],
      ["/licencias/solicitudes/resumen/"],
      ["/licencias/solicitudes/", { params: { vista: "por_aprobar" } }],
      ["/licencias/solicitudes/12/", undefined],
      ["/organizacion/vacaciones/mias/"],
    ]);
  });

  it("aprobar, rechazar y cancelar mandan el comentario y, si viene de un push, la empresa", async () => {
    await licenciasService.aprobar(12, "De acuerdo", { empresa: "7" });
    await licenciasService.rechazar(12, "No hay cobertura ese día");
    await licenciasService.cancelar(12);

    expect(api.post.mock.calls).toEqual([
      ["/licencias/solicitudes/12/aprobar/", { comentario: "De acuerdo" }, { cabeceras: { "X-Empresa": "7" } }],
      ["/licencias/solicitudes/12/rechazar/", { comentario: "No hay cobertura ese día" }, undefined],
      ["/licencias/solicitudes/12/cancelar/", { comentario: "" }, undefined],
    ]);
  });

  it("crea la solicitud en multipart, con el documento como {uri, name, type}", async () => {
    await licenciasService.solicitar(
      { flujo: "3", desde: "2026-11-16", hasta: "2026-11-16", hora_desde: "08:00", hora_hasta: "10:00", motivo: "" },
      { uri: "file:///cache/foto.jpg", name: "foto.jpg", type: "image/jpeg", size: 1000 },
    );

    const [ruta, cuerpo, opciones] = api.post.mock.calls[0];
    expect(ruta).toBe("/licencias/solicitudes/");
    expect(cuerpo).toBeInstanceOf(FormData);
    const partes = Object.fromEntries(cuerpo.getParts().map((p) => [p.fieldName, p]));
    expect(partes.flujo.string).toBe("3");
    expect(partes.hora_desde.string).toBe("08:00");
    expect(partes.motivo.string).toBe("");
    expect(partes.adjunto).toMatchObject({ uri: "file:///cache/foto.jpg", name: "foto.jpg", type: "image/jpeg" });
    // Subir 10 MB tarda: más espera que la de siempre.
    expect(opciones.timeoutMs).toBeGreaterThan(20000);
  });

  it("sin documento no manda la parte «adjunto»", async () => {
    await licenciasService.solicitar({ flujo: "3", desde: "2026-11-16", hasta: "2026-11-20", motivo: "" }, null);
    const cuerpo = api.post.mock.calls[0][1];
    expect(cuerpo.getParts().map((p) => p.fieldName)).not.toContain("adjunto");
  });
});

describe("reemplazo en ausencia y directorio", () => {
  it("usa las mismas rutas que la web", async () => {
    await reemplazoService.obtener();
    await reemplazoService.guardar({ modo: "persona", persona_id: 8 });
    await directorioService.buscar("  carla ");
    await directorioService.buscar("");

    expect(api.get.mock.calls).toEqual([
      ["/organizacion/mi-reemplazo/"],
      ["/chat/directorio/", { params: { q: "carla" } }],
      ["/chat/directorio/", undefined],
    ]);
    expect(api.put).toHaveBeenCalledWith("/organizacion/mi-reemplazo/", { modo: "persona", persona_id: 8 });
  });
});

describe("cliente HTTP con FormData", () => {
  function almacen() {
    return {
      tokens: () => ({ access: "a", refresh: "r" }),
      guardarTokens: jest.fn(),
      empresa: () => "3",
    };
  }

  it("manda el FormData tal cual y deja que fetch ponga el Content-Type", async () => {
    const fetchImpl = jest.fn(async () => ({ status: 201, ok: true, text: async () => '{"id": 9}' }));
    const cliente = crearCliente({ baseUrl: "https://x/api/v1", almacen: almacen(), userAgent: "UA", fetchImpl });
    const datos = new FormData();
    datos.append("flujo", "3");

    const respuesta = await cliente.post("/licencias/solicitudes/", datos);

    const [, opciones] = fetchImpl.mock.calls[0];
    expect(respuesta).toEqual({ id: 9 });
    expect(opciones.body).toBe(datos);
    expect(opciones.headers["Content-Type"]).toBeUndefined();
    expect(opciones.headers.Authorization).toBe("Bearer a");
  });

  it("conRenovacion renueva una vez ante un 401 y reintenta con el token nuevo", async () => {
    const estado = { access: "viejo", refresh: "r1" };
    const alm = {
      tokens: () => ({ ...estado }),
      guardarTokens: jest.fn(async (a, r) => {
        estado.access = a;
        estado.refresh = r;
      }),
      empresa: () => "3",
    };
    const fetchImpl = jest.fn(async () => ({
      status: 200,
      ok: true,
      text: async () => '{"access": "nuevo", "refresh": "r2"}',
    }));
    const cliente = crearCliente({ baseUrl: "https://x/api/v1", almacen: alm, userAgent: "UA", fetchImpl });
    const hacer = jest.fn(async (cabeceras) => {
      if (cabeceras.Authorization === "Bearer viejo") {
        const error = new Error("401");
        error.status = 401;
        throw error;
      }
      return cabeceras;
    });

    const cabeceras = await cliente.conRenovacion(hacer, { empresa: "7" });

    expect(cabeceras).toMatchObject({ Authorization: "Bearer nuevo", "X-Empresa": "7" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://x/api/v1/auth/token/refresh/");
  });
});

describe("errores por campo", () => {
  const error = (details, message = "Error en la solicitud.") => ({
    response: { status: 400, data: { error: { code: "invalid", message, details } } },
  });

  it("lee details por campo y deja «detail» para el aviso de arriba", () => {
    expect(erroresPorCampo(error({ motivo: ["Un permiso médico pide el motivo."], detail: "x" }))).toEqual({
      motivo: "Un permiso médico pide el motivo.",
    });
    expect(mensajeDeFormulario(error({ motivo: ["x"] }))).toBe("Revise los campos marcados.");
    expect(mensajeDeFormulario(error(null, "Las fechas se cruzan con otra solicitud suya."))).toBe(
      "Las fechas se cruzan con otra solicitud suya.",
    );
  });
});

describe("MODULOS_EN_APP.licencias (CA-12)", () => {
  const aviso = (enlace, campos = {}) => ({ id: 40, modulo: "licencias", enlace, ...campos });

  it("con ?solicitud=ID lleva al detalle, con la empresa de la notificación", () => {
    expect(rutaEnApp(aviso("/admin/institucional/permisos?solicitud=12", { empresa: 7 }))).toBe(
      "/permisos/solicitud/12?empresa=7",
    );
    expect(destinoDeNotificacion(aviso("/admin/institucional/permisos?solicitud=12"))).toBe("/permisos/solicitud/12");
  });

  it("sin solicitud, o si no es solo dígitos, abre la pestaña Permisos", () => {
    expect(rutaDeLicencias(aviso("/admin/institucional/permisos"))).toBe("/permisos");
    expect(rutaDeLicencias(aviso("/admin/institucional/permisos?solicitud=12abc"))).toBe("/permisos");
    expect(rutaDeLicencias(aviso("/admin/institucional/permisos?solicitud=../../x"))).toBe("/permisos");
    expect(rutaDeLicencias(aviso(undefined))).toBe("/permisos");
    expect(rutaDeLicencias(aviso("/admin/otra?solicitud=5"))).toBe("/permisos");
  });

  it("el aviso de los fines de semana marcados lleva a Mis vacaciones", () => {
    expect(rutaDeLicencias(aviso("/admin/institucional/vacaciones", { empresa: 7 }))).toMatch(
      /^\/permisos\?seccion=vacaciones&n=\d+&empresa=7$/,
    );
  });

  it("una empresa que no es solo dígitos no se pasa", () => {
    expect(rutaDeLicencias(aviso("/admin/institucional/permisos?solicitud=3", { empresa: "7&x=1" }))).toBe(
      "/permisos/solicitud/3",
    );
  });
});

describe("documento de respaldo: validación (CA-6)", () => {
  it("acepta PDF, JPG y PNG de hasta 10 MB, con la extensión del tipo", () => {
    expect(validarArchivo({ uri: "file:///cache/a", nombre: "Certificado médico.pdf", tipo: "application/pdf", tamano: 500 }))
      .toEqual({ archivo: { uri: "file:///cache/a", name: "Certificado medico.pdf", type: "application/pdf", size: 500 } });
    expect(validarArchivo({ uri: "file:///cache/b.png", nombre: "", tipo: "", tamano: 10 }).archivo.type).toBe("image/png");
  });

  it("rechaza lo que pasa de 10 MB", () => {
    expect(validarArchivo({ uri: "file:///cache/a.jpg", nombre: "a.jpg", tipo: "image/jpeg", tamano: TAMANO_MAXIMO + 1 }))
      .toEqual({ error: TEXTO_DEMASIADO_GRANDE });
  });

  it("rechaza lo que no es PDF ni imagen JPG o PNG", () => {
    expect(validarArchivo({ uri: "file:///cache/a.heic", nombre: "a.heic", tipo: "image/heic", tamano: 10 }))
      .toEqual({ error: TEXTO_TIPO_NO_PERMITIDO });
    expect(validarArchivo({ uri: "file:///cache/a.docx", nombre: "a.docx", tipo: "", tamano: 10 }))
      .toEqual({ error: TEXTO_TIPO_NO_PERMITIDO });
  });

  it("la foto se pide comprimida y en formato compatible, y la cancelación no es un error", async () => {
    ImagePicker.launchCameraAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///cache/ImagePicker/f.jpg", fileName: null, mimeType: "image/jpeg", fileSize: 2000 }],
    });
    const resultado = await tomarFoto();
    expect(resultado.archivo).toMatchObject({ type: "image/jpeg", size: 2000 });
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith(
      expect.objectContaining({ quality: expect.any(Number), preferredAssetRepresentationMode: "compatible" }),
    );
    expect(await elegirImagen()).toBeNull();
  });

  it("si lo elegido no sirve, su copia en la caché se borra", async () => {
    FileSystem.__existentes.add("file:///cache/DocumentPicker/grande.pdf");
    DocumentPicker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///cache/DocumentPicker/grande.pdf", name: "grande.pdf", mimeType: "application/pdf", size: 11 * 1024 * 1024 }],
    });
    expect(await elegirPdf()).toEqual({ error: TEXTO_DEMASIADO_GRANDE });
    expect(FileSystem.__existentes.has("file:///cache/DocumentPicker/grande.pdf")).toBe(false);
  });

  it("sin permiso de cámara lo dice", async () => {
    ImagePicker.requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: false });
    expect((await tomarFoto()).error).toMatch(/permiso para usar la cámara/);
  });

  it("el PDF se elige solo entre PDF y se valida el tamaño", async () => {
    DocumentPicker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///cache/DocumentPicker/x.pdf", name: "x.pdf", mimeType: "application/pdf", size: 11 * 1024 * 1024 }],
    });
    expect(await elegirPdf()).toEqual({ error: TEXTO_DEMASIADO_GRANDE });
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ type: ["application/pdf"] }));
  });
});

describe("documento de respaldo: descarga con la sesión (CA-8)", () => {
  it("descarga a la caché con las cabeceras de la sesión y la empresa del push", async () => {
    const archivo = await descargarDocumento(12, "certificado.pdf", { empresa: "7" });

    expect(FileSystem.File.downloadFileAsync).toHaveBeenCalledWith(
      "https://api.prueba/api/v1/licencias/solicitudes/12/adjunto/",
      expect.objectContaining({ uri: "file:///cache/permisos-documentos/solicitud-12.pdf" }),
      expect.objectContaining({ headers: { Authorization: "Bearer access", "X-Empresa": "7" }, idempotent: true }),
    );
    expect(archivo.uri).toBe("file:///cache/permisos-documentos/solicitud-12.pdf");
  });

  it("un 404 dice que el documento ya no está", async () => {
    FileSystem.File.downloadFileAsync.mockRejectedValueOnce(
      new Error("Unable to download a file: response has status: 404"),
    );
    await expect(descargarDocumento(12, "a.jpg")).rejects.toThrow(TEXTO_DOCUMENTO_NO_DISPONIBLE);
  });

  it("lee el estado del mensaje nativo de Android y de iOS", () => {
    expect(estadoDeError(new Error("Unable to download a file: response has status: 401"))).toBe(401);
    expect(estadoDeError(new Error("response has status 404"))).toBe(404);
    expect(estadoDeError(new Error("sin red"))).toBeNull();
  });

  it("al cerrar sesión se borran los documentos y las copias de los selectores", async () => {
    await descargarDocumento(12, "a.jpg");
    FileSystem.__existentes.add("file:///cache/ImagePicker");
    FileSystem.__existentes.add("file:///cache/ImagePicker/foto.jpg");

    borrarDocumentosDescargados();

    expect([...FileSystem.__existentes].filter((u) => u.startsWith("file:///cache/"))).toEqual([]);
  });

  it("imagen dentro de la app y PDF con el sistema, por la extensión", () => {
    expect(tipoDeDocumento("foto.JPG")).toBe("imagen");
    expect(tipoDeDocumento("certificado.pdf")).toBe("pdf");
    expect(tipoDeDocumento("raro")).toBe("otro");
  });
});

describe("formato", () => {
  it("fechas como la web, sin correrse por la zona horaria", () => {
    expect(fechaCorta("2026-11-01")).toBe("01/11/2026");
  });

  it("requisitos del tipo: un médico pide motivo y documento", () => {
    expect(requisitosDe({ es_medico: true, pide_motivo: false, adjunto: "no" })).toMatchObject({
      medico: true,
      pideMotivo: true,
      adjuntoObligatorio: true,
      pideAdjunto: true,
    });
    expect(requisitosDe({ adjunto: "no", pide_motivo: false, unidad: "horas" })).toMatchObject({
      porHoras: true,
      pideMotivo: false,
      pideAdjunto: false,
    });
  });

  it("de quién está pendiente, con su ausencia y su reemplazo", () => {
    expect(
      pendienteDe({
        pendiente_de: [
          { id: 1, nombre: "Ana Pérez", ausencia: { texto: "De vacaciones hasta el 20/11", reemplazo: { nombre: "Carla Ruiz" } } },
          { id: 2, nombre: "Luis Mora", ausencia: null },
        ],
      }),
    ).toBe("Ana Pérez (ausente: De vacaciones hasta el 20/11 · Aprueba en su lugar: Carla Ruiz), Luis Mora");
  });

  it("el historial en frases", () => {
    expect(textoDeAccion({ accion: "aprobada", actor: "Ana", paso: "Jefe inmediato" })).toBe(
      "Ana aprobó en el paso «Jefe inmediato»",
    );
    expect(textoDeAccion({ accion: "escalada", actor: "", detalle: "Carla", comentario: "Escalada a Carla por ausencia de Ana." }))
      .toBe("Pasó a Carla porque Ana está ausente");
  });
});
