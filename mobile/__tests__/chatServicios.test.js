import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { AppState } from "react-native";

import { api } from "../src/api/api";
import { chatService, notificacionesService } from "../src/api/servicios";
import {
  descargarArchivoDelChat,
  elegirArchivoParaElChat,
  rutaDeArchivoValida,
  TAMANO_MAXIMO_CHAT,
  TEXTO_ARCHIVO_GRANDE,
  TEXTO_ARCHIVO_NO_DISPONIBLE,
  TEXTO_TIPO_NO_PERMITIDO_CHAT,
  validarAdjuntoDelChat,
} from "../src/chat/adjunto";
import {
  COMPORTAMIENTOS,
  comportamientoDelAviso,
  olvidarConversaciones,
  registrarConversacionAbierta,
} from "../src/chat/avisoEnPrimerPlano";
import { conversacionDelEnlace } from "../src/chat/enlace";
import {
  estadoDeLectura,
  iconoDePresencia,
  textoAvisoDeEstado,
  textoPresencia,
  textoUltimo,
} from "../src/chat/formato";
import { errorDeRegreso, erroresDeVacaciones } from "../src/chat/miEstado";
import { destinoDeNotificacion } from "../src/notificaciones/abrir";
import { MODULOS_EN_APP, rutaDeChat, rutaEnApp } from "../src/notificaciones/modulosEnApp";
import { borrarDocumentosDescargados } from "../src/permisos/documentos";

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

jest.mock("../src/api/almacen", () => ({
  almacen: { empresa: jest.fn(() => "1") },
}));

beforeEach(() => {
  jest.clearAllMocks();
  olvidarConversaciones();
  AppState.currentState = "active";
});

describe("chatService: rutas y campos del contrato", () => {
  it("usa las mismas rutas que la web", async () => {
    await chatService.conversaciones();
    await chatService.conversacion(7);
    await chatService.mensajes(7);
    await chatService.mensajes(7, { antes: 120 });
    await chatService.lecturas(7);
    await chatService.novedades(null);
    await chatService.novedades(345);
    await chatService.presencia([3, 9]);
    await chatService.miEstado();

    expect(api.get.mock.calls).toEqual([
      ["/chat/conversaciones/"],
      ["/chat/conversaciones/7/", undefined],
      ["/chat/conversaciones/7/mensajes/", { params: undefined }],
      ["/chat/conversaciones/7/mensajes/", { params: { antes: 120 } }],
      ["/chat/conversaciones/7/lecturas/", undefined],
      ["/chat/novedades/", undefined],
      ["/chat/novedades/", { params: { desde: 345 } }],
      ["/chat/presencia/", { params: { ids: "3,9" } }],
      ["/chat/mi-estado/"],
    ]);
  });

  it("con la empresa de un push, la manda como X-Empresa solo en esa petición", async () => {
    await chatService.mensajes(7, { empresa: "4" });
    await chatService.leer(7, 99, { empresa: "4" });

    expect(api.get).toHaveBeenCalledWith("/chat/conversaciones/7/mensajes/", {
      cabeceras: { "X-Empresa": "4" },
      params: undefined,
    });
    expect(api.post).toHaveBeenCalledWith("/chat/conversaciones/7/leer/", { hasta: 99 }, {
      cabeceras: { "X-Empresa": "4" },
    });
  });

  it("directo, leer sin «hasta» y mi estado", async () => {
    await chatService.directa(12);
    await chatService.leer(7);
    await chatService.guardarEstado({ estado: "almuerzo" });

    expect(api.post).toHaveBeenCalledWith("/chat/conversaciones/directa/", { usuario: 12 });
    expect(api.post).toHaveBeenCalledWith("/chat/conversaciones/7/leer/", {}, undefined);
    expect(api.put).toHaveBeenCalledWith("/chat/mi-estado/", { estado: "almuerzo" });
  });

  it("envía en multipart el texto y el archivo, con más tiempo si hay archivo", async () => {
    await chatService.enviar(7, "Hola", null);
    await chatService.enviar(7, "", { uri: "file:///cache/a.pdf", name: "a.pdf", type: "application/pdf" });

    const [ruta, sinArchivo, opciones] = api.post.mock.calls[0];
    expect(ruta).toBe("/chat/conversaciones/7/mensajes/");
    expect(sinArchivo.getParts()).toEqual([{ fieldName: "texto", string: "Hola" }]);
    expect(opciones.timeoutMs).toBeUndefined();

    const [, conArchivo, opcionesArchivo] = api.post.mock.calls[1];
    expect(conArchivo.getParts()).toEqual([
      { fieldName: "texto", string: "" },
      { fieldName: "archivo", uri: "file:///cache/a.pdf", name: "a.pdf", type: "application/pdf" },
    ]);
    expect(opcionesArchivo.timeoutMs).toBe(120000);
  });
});

describe("MODULOS_EN_APP.chat (CA-12)", () => {
  it("el enlace de la web lleva a la conversación, con la empresa de la notificación", () => {
    expect(rutaDeChat({ enlace: "/admin/chat?c=15", empresa: 3 })).toBe("/chat/conversacion/15?empresa=3");
    expect(rutaDeChat({ enlace: "/admin/chat?c=15", empresa: { id: 2 } })).toBe("/chat/conversacion/15?empresa=2");
    expect(rutaDeChat({ enlace: "/admin/chat?c=15" })).toBe("/chat/conversacion/15");
    expect(destinoDeNotificacion({ id: 9, modulo: "chat", enlace: "/admin/chat?c=15", empresa: 1 })).toBe(
      "/chat/conversacion/15?empresa=1",
    );
  });

  it("un enlace raro o sin conversación va a la pestaña «Chat»", () => {
    expect(rutaDeChat({ enlace: "/admin/chat" })).toBe("/chat");
    expect(rutaDeChat({ enlace: "/admin/chat?c=1;drop" })).toBe("/chat");
    expect(rutaDeChat({ enlace: "/admin/otra?c=4" })).toBe("/chat");
    expect(rutaEnApp({ id: 1, modulo: "chat", enlace: null })).toBe("/chat");
    expect(MODULOS_EN_APP.chat).toBe(rutaDeChat);
  });

  it("lee la conversación del enlace", () => {
    expect(conversacionDelEnlace("/admin/chat?c=8")).toBe("8");
    expect(conversacionDelEnlace("/admin/chat?x=1&c=8#fin")).toBe("8");
    expect(conversacionDelEnlace("//otro/admin/chat?c=8")).toBeNull();
    expect(conversacionDelEnlace(undefined)).toBeNull();
  });
});

function push({ modulo = "chat", id = 50, empresa = 1 } = {}) {
  return { request: { content: { data: { notificacion_id: id, modulo, empresa } } } };
}

describe("push con la app abierta (CA-11)", () => {
  it("sin conversación abierta se muestra sin preguntar nada", async () => {
    expect(await comportamientoDelAviso(push())).toBe(COMPORTAMIENTOS.MOSTRAR);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("de la conversación abierta no se muestra; la segunda vez no vuelve a preguntar", async () => {
    jest.spyOn(notificacionesService, "detalle").mockResolvedValue({ enlace: "/admin/chat?c=5" });
    const borrar = registrarConversacionAbierta("5");

    expect(await comportamientoDelAviso(push({ id: 50 }))).toBe(COMPORTAMIENTOS.CALLAR);
    expect(notificacionesService.detalle).toHaveBeenCalledWith("50", { empresa: "1" });
    expect(await comportamientoDelAviso(push({ id: 50 }))).toBe(COMPORTAMIENTOS.CALLAR);
    expect(notificacionesService.detalle).toHaveBeenCalledTimes(1);

    borrar();
    expect(await comportamientoDelAviso(push({ id: 50 }))).toBe(COMPORTAMIENTOS.MOSTRAR);
  });

  it("de otra conversación, de otro módulo o de otra empresa, se muestra", async () => {
    jest.spyOn(notificacionesService, "detalle").mockResolvedValue({ enlace: "/admin/chat?c=6" });
    registrarConversacionAbierta("5");

    expect(await comportamientoDelAviso(push({ id: 51 }))).toBe(COMPORTAMIENTOS.MOSTRAR);
    expect(await comportamientoDelAviso(push({ modulo: "licencias" }))).toBe(COMPORTAMIENTOS.MOSTRAR);
    expect(await comportamientoDelAviso(push({ empresa: 2, id: 52 }))).toBe(COMPORTAMIENTOS.MOSTRAR);
  });

  it("si la consulta falla o tarda, se muestra (mejor un aviso de más que uno perdido)", async () => {
    registrarConversacionAbierta("5");
    jest.spyOn(notificacionesService, "detalle").mockRejectedValueOnce(new Error("red"));
    expect(await comportamientoDelAviso(push({ id: 60 }))).toBe(COMPORTAMIENTOS.MOSTRAR);

    jest.useFakeTimers();
    notificacionesService.detalle.mockReturnValueOnce(new Promise(() => {}));
    const respuesta = comportamientoDelAviso(push({ id: 61 }));
    await jest.advanceTimersByTimeAsync(2100);
    expect(await respuesta).toBe(COMPORTAMIENTOS.MOSTRAR);
    jest.useRealTimers();
  });

  it("con la app en segundo plano se muestra", async () => {
    registrarConversacionAbierta("5");
    AppState.currentState = "background";
    expect(await comportamientoDelAviso(push())).toBe(COMPORTAMIENTOS.MOSTRAR);
  });
});

describe("adjuntos del chat (CA-7)", () => {
  it("acepta lo mismo que el servidor: PDF, imágenes, Word y Excel", () => {
    expect(validarAdjuntoDelChat({ uri: "file:///cache/a", nombre: "Informe.docx", tipo: "", tamano: 100 }).archivo).toEqual({
      uri: "file:///cache/a",
      name: "Informe.docx",
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 100,
    });
    // Android a veces no sabe el tipo: decide la extensión.
    expect(
      validarAdjuntoDelChat({ uri: "file:///cache/b", nombre: "c.xlsx", tipo: "application/octet-stream", tamano: 5 })
        .archivo.type,
    ).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(validarAdjuntoDelChat({ uri: "file:///cache/c.webp", nombre: "c.webp", tipo: "image/webp", tamano: 5 }).archivo.name).toBe(
      "c.webp",
    );
  });

  it("un archivo de más de 10 MB se avisa antes de enviar, sugiriendo el correo", () => {
    expect(
      validarAdjuntoDelChat({ uri: "file:///cache/a.pdf", nombre: "a.pdf", tipo: "application/pdf", tamano: TAMANO_MAXIMO_CHAT + 1 })
        .error,
    ).toBe(TEXTO_ARCHIVO_GRANDE);
    expect(TEXTO_ARCHIVO_GRANDE).toContain("Envíelo por correo");
  });

  it("rechaza lo que el servidor no acepta", () => {
    expect(validarAdjuntoDelChat({ uri: "file:///cache/a.zip", nombre: "a.zip", tipo: "application/zip", tamano: 5 })).toEqual({
      error: TEXTO_TIPO_NO_PERMITIDO_CHAT,
    });
  });

  it("el selector ofrece los tipos del chat y descarta lo que no sirve", async () => {
    FileSystem.__existentes.add("file:///cache/DocumentPicker/x.zip");
    DocumentPicker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///cache/DocumentPicker/x.zip", name: "x.zip", mimeType: "application/zip", size: 9 }],
    });

    expect(await elegirArchivoParaElChat()).toEqual({ error: TEXTO_TIPO_NO_PERMITIDO_CHAT });
    expect(DocumentPicker.getDocumentAsync.mock.calls[0][0].type).toEqual(
      expect.arrayContaining(["application/pdf", "image/webp"]),
    );
    expect(FileSystem.__existentes.has("file:///cache/DocumentPicker/x.zip")).toBe(false);
  });

  it("descarga con la sesión solo la ruta del contrato, y se borra al cerrar sesión", async () => {
    const archivo = await descargarArchivoDelChat(
      { id: 77, archivo: { nombre: "foto.jpg", url: "/chat/archivos/77/", es_imagen: true } },
      { empresa: "3" },
    );
    expect(FileSystem.File.downloadFileAsync).toHaveBeenCalledWith(
      "https://api.prueba/api/v1/chat/archivos/77/",
      expect.anything(),
      { headers: { Authorization: "Bearer access", "X-Empresa": "3" }, idempotent: true },
    );
    expect(archivo.uri).toBe("file:///cache/chat-archivos/mensaje-77.jpg");
    expect(FileSystem.__existentes.has(archivo.uri)).toBe(true);

    borrarDocumentosDescargados();
    expect(FileSystem.__existentes.has(archivo.uri)).toBe(false);

    expect(rutaDeArchivoValida("https://otro.sitio/x")).toBe(false);
    await expect(
      descargarArchivoDelChat({ id: 1, archivo: { nombre: "x.pdf", url: "https://otro.sitio/x" } }),
    ).rejects.toThrow(TEXTO_ARCHIVO_NO_DISPONIBLE);
  });
});

describe("formato del chat", () => {
  it("presencia: lo elegido primero, luego en línea o la última conexión", () => {
    const ahora = new Date("2026-11-12T15:00:00Z");
    expect(textoPresencia({ en_linea: true, estado: null })).toBe("En línea");
    expect(
      textoPresencia({ en_linea: false, ultima_conexion: "2026-11-12T14:55:00Z", estado: null }, ahora),
    ).toBe("Última conexión: hace 5 min");
    expect(textoPresencia({ en_linea: false, ultima_conexion: null })).toBe("Sin conexiones");
    const almuerzo = { clave: "almuerzo", detalle: "En almuerzo hasta las 13:30", mensaje: "" };
    expect(textoPresencia({ en_linea: true, estado: almuerzo })).toBe("En almuerzo hasta las 13:30");
    expect(iconoDePresencia({ en_linea: true, estado: almuerzo })).toBe("coffee-outline");
    expect(iconoDePresencia({ en_linea: true })).toBe("circle");
    expect(iconoDePresencia({ en_linea: false })).toBe("circle-outline");
  });

  it("el aviso del estado de la otra persona, como la web", () => {
    expect(
      textoAvisoDeEstado("Carla", {
        clave: "vacaciones",
        detalle: "De vacaciones hasta el 20/11/2026",
        mensaje: "Escriba a Juan",
        reemplazo: { nombre: "Juan Pérez" },
      }),
    ).toBe("Carla está de vacaciones hasta el 20/11/2026: verá su mensaje al volver. «Escriba a Juan» Aprueba en su lugar: Juan Pérez.");
    expect(
      textoAvisoDeEstado("Carla", { clave: "vacaciones_proximas", detalle: "Estará de vacaciones del 1 al 5" }),
    ).toBe("Carla estará de vacaciones del 1 al 5.");
  });

  it("lecturas: enviado, leído y, en un grupo, por cuántos", () => {
    const lecturas = [
      { id: 2, nombre: "Ana", ultimo_leido: 10, leido_en: "2026-11-12T10:00:00Z" },
      { id: 3, nombre: "Luis", ultimo_leido: 4, leido_en: null },
    ];
    expect(estadoDeLectura({ id: 5 }, lecturas.slice(1), false).texto).toBe("Enviado");
    expect(estadoDeLectura({ id: 5 }, lecturas.slice(0, 1), false).texto).toBe("Leído");
    expect(estadoDeLectura({ id: 5 }, lecturas, true).texto).toBe("Leído por 1 de 2");
    expect(estadoDeLectura({ id: 3 }, lecturas, true).texto).toBe("Leído por todos");
    expect(estadoDeLectura({ id: 5 }, [], true)).toBeNull();
  });

  it("el último mensaje de la lista", () => {
    expect(textoUltimo({ tipo: "general", ultimo: null })).toBe("Toda la empresa");
    expect(textoUltimo({ tipo: "grupo", ultimo: null })).toBe("Sin mensajes");
    expect(textoUltimo({ ultimo: { propio: true, autor: "Ana", texto: "Hola" } })).toBe("Usted: Hola");
    expect(textoUltimo({ ultimo: { propio: false, autor: "Luis", texto: "📎 a.pdf" } })).toBe("Luis: 📎 a.pdf");
  });

  it("mi estado: las fechas de fuera de la oficina y de las vacaciones", () => {
    expect(errorDeRegreso("", "2026-11-12", "2027-05-11")).toBe("Indique hasta cuándo estará fuera de la oficina.");
    expect(errorDeRegreso("2026-11-11", "2026-11-12", "2027-05-11")).toBe("Elija como último día hoy o una fecha posterior.");
    expect(errorDeRegreso("2027-06-01", "2026-11-12", "2027-05-11")).toBe("Elija una fecha dentro de los próximos 6 meses.");
    expect(errorDeRegreso("2026-11-20", "2026-11-12", "2027-05-11")).toBeNull();
    expect(erroresDeVacaciones("2026-11-20", "2026-11-18")).toEqual({
      vacaciones_hasta: "«Hasta» no puede ser antes de «Desde».",
    });
  });
});
