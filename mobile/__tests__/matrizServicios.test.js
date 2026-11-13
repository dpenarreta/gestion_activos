import { act, renderHook, waitFor } from "@testing-library/react-native";
import * as FileSystem from "expo-file-system";

import { CARPETAS_DE_DESCARGAS } from "../src/adjuntos/descargas";
import { api } from "../src/api/api";
import { crearCliente } from "../src/api/cliente";
import { matrizService } from "../src/api/servicios";
import {
  descargarEvidencia,
  TEXTO_EVIDENCIA_FALLO,
  TEXTO_EVIDENCIA_NO_DISPONIBLE,
  TEXTO_EVIDENCIA_SIN_PERMISO,
} from "../src/matriz/documentos";
import {
  accionesEnLaApp,
  diaConSemana,
  diaEnZona,
  diaLargo,
  horaDeLaZona,
  empresaDeLaMatriz,
  esDiaValido,
  ESTADOS_DE_LA_BANDEJA,
  fechaHoraEnZona,
  grupoMasUrgente,
  hayAccionesEnLaWeb,
  matrizEnElNavegador,
  mensajeDeMatriz,
  moverMes,
  nombreDeFila,
  PERMISOS_MATRIZ,
  rutaWebDelPeriodo,
  semanasDelMes,
  TEXTO_PUEDE_HABERSE_GUARDADO,
  textoAccionesEnLaWeb,
  textoDeDias,
  tieneAccesoALaMatriz,
  tituloDelMes,
  tonoDeGrupo,
} from "../src/matriz/formato";
import { olvidarEmpresaDeLaMatriz, useEmpresaDeLaMatriz } from "../src/matriz/useEmpresaDeLaMatriz";
import { destinoDeNotificacion } from "../src/notificaciones/abrir";
import { MODULOS_EN_APP, rutaDeMatriz } from "../src/notificaciones/modulosEnApp";
import {
  opcionesDePersonas,
  TEXTO_AVANCE,
  TEXTO_FECHA_OBLIGATORIA,
  TEXTO_MOTIVO_CORTO,
  TEXTO_RESPONSABLE_OBLIGATORIO,
  TEXTO_SUPLENTE_DISTINTO,
  textoRevise,
  validarFecha,
  validarSeguimiento,
} from "../src/pantallas/matriz/AccionesDelPeriodo";
import { TONOS } from "../src/soporte/formato";

jest.mock("../src/api/api", () => ({
  api: {
    get: jest.fn(async () => ({})),
    post: jest.fn(async () => ({})),
    put: jest.fn(async () => ({})),
    patch: jest.fn(async () => ({})),
    url: (ruta) => `https://api.prueba/api/v1${ruta}`,
    conRenovacion: jest.fn(async (hacer, { empresa } = {}) =>
      hacer({ Authorization: "Bearer access", ...(empresa ? { "X-Empresa": empresa } : {}) }),
    ),
  },
  escucharSesion: () => () => {},
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useIsFocused: () => true,
  useFocusEffect: () => {},
}));

const mockSesion = { usuario: { id: 1, permissions: [] }, empresaActiva: { id: 2 }, versionEmpresa: 0 };
jest.mock("../src/sesion/SesionContext", () => ({ useSesion: () => mockSesion }));

const ZONA = "America/Guayaquil";

beforeEach(() => {
  jest.clearAllMocks();
  olvidarEmpresaDeLaMatriz();
  mockSesion.empresaActiva = { id: 2 };
  mockSesion.versionEmpresa = 0;
  mockSesion.usuario = { id: 1, permissions: [] };
});

describe("matrizService: las mismas rutas que la web (views.py)", () => {
  it("lecturas", async () => {
    await matrizService.misEmpresas();
    await matrizService.resumen();
    await matrizService.periodos({ status: "en_progreso", sort: "due", page: 2 });
    await matrizService.periodo(7);
    await matrizService.periodo(7, { empresa: "3" });
    await matrizService.historial(7);
    await matrizService.documentos(7, { empresa: "3" });
    await matrizService.calendario(2026, 11);
    await matrizService.personas();
    await matrizService.catalogos();
    expect(api.get.mock.calls).toEqual([
      ["/matriz/empresas/mias/"],
      ["/matriz/resumen/"],
      ["/matriz/periodos/", { params: { status: "en_progreso", sort: "due", page: 2 } }],
      ["/matriz/periodos/7/", undefined],
      ["/matriz/periodos/7/", { cabeceras: { "X-Empresa": "3" } }],
      ["/matriz/periodos/7/historial/", undefined],
      ["/matriz/periodos/7/documentos/", { cabeceras: { "X-Empresa": "3" } }],
      ["/matriz/calendario/", { params: { year: 2026, month: 11 } }],
      ["/matriz/personas/", undefined],
      ["/matriz/catalogos/", undefined],
    ]);
    expect(matrizService.urlArchivo(12)).toBe("https://api.prueba/api/v1/matriz/documentos/12/archivo/");
  });

  it("las tres acciones: PATCH del seguimiento, POST de la fecha y del recordatorio", async () => {
    const seguimiento = { responsable: 4, suplente: null, avance: 50 };
    await matrizService.editarSeguimiento(7, seguimiento, { empresa: "3" });
    await matrizService.cambiarVencimiento(7, {
      due_date: "2026-12-01",
      due_time: "17:00",
      reason: "Prórroga del SRI",
    });
    await matrizService.enviarRecordatorio(7);
    expect(api.patch).toHaveBeenCalledWith("/matriz/periodos/7/", seguimiento, { cabeceras: { "X-Empresa": "3" } });
    expect(api.post.mock.calls).toEqual([
      [
        "/matriz/periodos/7/vencimiento/",
        { due_date: "2026-12-01", due_time: "17:00", reason: "Prórroga del SRI" },
        undefined,
      ],
      ["/matriz/periodos/7/recordatorios/enviar/", {}, undefined],
    ]);
  });

  it("el id va codificado", async () => {
    await matrizService.periodo("7/../x");
    expect(api.get).toHaveBeenCalledWith("/matriz/periodos/7%2F..%2Fx/", undefined);
  });
});

describe("cliente HTTP: PATCH (nuevo en la US-019)", () => {
  it("manda el cuerpo en JSON con el método PATCH, el token y la empresa", async () => {
    const fetchImpl = jest.fn(async () => ({ status: 200, ok: true, text: async () => '{"id":7}' }));
    const cliente = crearCliente({
      baseUrl: "https://api.prueba/api/v1",
      almacen: { tokens: () => ({ access: "a", refresh: "r" }), empresa: () => "2", guardarTokens: jest.fn() },
      userAgent: "IntranetLCE/1.0.0 (android)",
      fetchImpl,
    });
    await expect(cliente.patch("/matriz/periodos/7/", { avance: 10 })).resolves.toEqual({ id: 7 });
    const [url, opciones] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.prueba/api/v1/matriz/periodos/7/");
    expect(opciones.method).toBe("PATCH");
    expect(opciones.body).toBe('{"avance":10}');
    expect(opciones.headers).toMatchObject({
      Authorization: "Bearer a",
      "X-Empresa": "2",
      "Content-Type": "application/json",
    });
  });
});

describe("acceso a la Matriz (CA-1)", () => {
  it("cualquier permiso matriz.* de la web; otros no", () => {
    expect(PERMISOS_MATRIZ).toHaveLength(12);
    expect(tieneAccesoALaMatriz(["matriz.recordar"])).toBe(true);
    expect(tieneAccesoALaMatriz(["soporte.crear", "matriz"])).toBe(false);
    expect(tieneAccesoALaMatriz(undefined)).toBe(false);
  });

  it("la empresa activa entre las de matriz/empresas/mias (como RequiereRolMatriz)", () => {
    const empresas = [{ id: 1 }, { id: 2 }];
    expect(empresaDeLaMatriz(empresas, 2)).toEqual({ id: 2 });
    expect(empresaDeLaMatriz(empresas, "3")).toBeNull();
    expect(empresaDeLaMatriz(empresas, null)).toEqual({ id: 1 });
    expect(empresaDeLaMatriz(undefined, 2)).toBeNull();
  });

  it("useEmpresaDeLaMatriz: la zona horaria, sin rol si la activa no está, y una sola consulta por empresa", async () => {
    api.get.mockResolvedValue({ empresas: [{ id: 2, nombre: "LAAR", zona_horaria: ZONA, roles: ["Responsable"] }] });
    const uno = await renderHook(() => useEmpresaDeLaMatriz());
    await waitFor(() => expect(uno.result.current.estado).toBe("listo"));
    expect(uno.result.current.zona).toBe(ZONA);
    const dos = await renderHook(() => useEmpresaDeLaMatriz());
    await waitFor(() => expect(dos.result.current.estado).toBe("listo"));
    expect(api.get).toHaveBeenCalledTimes(1);

    olvidarEmpresaDeLaMatriz();
    mockSesion.empresaActiva = { id: 9 };
    const tres = await renderHook(() => useEmpresaDeLaMatriz());
    await waitFor(() => expect(tres.result.current.estado).toBe("sin_rol"));
    api.get.mockReset();
  });

  it("useEmpresaDeLaMatriz: un fallo no se guarda y se puede reintentar", async () => {
    api.get.mockRejectedValueOnce(Object.assign(new Error("red"), { esDeRed: true }));
    api.get.mockResolvedValueOnce({ empresas: [{ id: 2, zona_horaria: ZONA }] });
    const { result } = await renderHook(() => useEmpresaDeLaMatriz());
    await waitFor(() => expect(result.current.estado).toBe("error"));
    await act(async () => result.current.recargar());
    await waitFor(() => expect(result.current.estado).toBe("listo"));
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});

describe("formato de la Matriz", () => {
  it("las fechas van en la zona de la empresa, no en la del teléfono", () => {
    // 03:00 UTC del 14 son las 22:00 del 13 en Guayaquil (UTC−5).
    expect(diaEnZona("2026-11-14T03:00:00Z", ZONA)).toBe("2026-11-13");
    expect(fechaHoraEnZona("2026-11-14T03:00:00Z", ZONA)).toBe("13/11/2026, 22:00");
    expect(diaEnZona("2026-11-14T03:00:00Z", "Europe/Madrid")).toBe("2026-11-14");
    expect(fechaHoraEnZona(null, ZONA)).toBe("—");
    // Una zona que no existe no rompe: se usa la del teléfono.
    expect(diaEnZona("2026-11-14T12:00:00Z", "Zona/Inventada")).toMatch(/^2026-11-1[34]$/);
  });

  it("las semanas del mes, de domingo a sábado, completas con los vecinos", () => {
    const semanas = semanasDelMes(2026, 11);
    expect(semanas).toHaveLength(5);
    expect(semanas.every((s) => s.length === 7)).toBe(true);
    expect(semanas[0][0]).toMatchObject({ iso: "2026-11-01", delMes: true, semana: 0 });
    expect(semanas[4][6]).toMatchObject({ iso: "2026-12-05", delMes: false });
    expect(semanasDelMes(2026, 2)[0][0].iso).toBe("2026-02-01");
    expect(moverMes({ anio: 2026, mes: 12 }, 1)).toEqual({ anio: 2027, mes: 1 });
    expect(moverMes({ anio: 2026, mes: 1 }, -1)).toEqual({ anio: 2025, mes: 12 });
    expect(tituloDelMes(2026, 11)).toBe("Noviembre 2026");
    expect(diaLargo("2026-11-13")).toBe("13 de noviembre de 2026");
    expect(esDiaValido("2026-02-30")).toBe(false);
    expect(esDiaValido("2026-02-28")).toBe(true);
    expect(esDiaValido("x")).toBe(false);
  });

  it("estados: tono, ícono y días en palabras", () => {
    expect(tonoDeGrupo("incumplido")).toEqual({ ...TONOS.mal, icono: "alert-outline" });
    expect(tonoDeGrupo("finalizado").icono).toBe("check-circle-outline");
    expect(textoDeDias({ group: "incumplido", days_overdue: 3 })).toBe("3 días de atraso");
    expect(textoDeDias({ group: "en_progreso", is_due_today: true })).toBe("Vence hoy");
    expect(textoDeDias({ group: "en_progreso", days_remaining: 1 })).toBe("Queda 1 día");
    expect(textoDeDias({ group: "finalizado", is_late: false })).toBe("");
    expect(textoDeDias({ group: "finalizado", is_late: true, days_overdue: 2 })).toBe("Cerrado con 2 días de atraso");
    expect(grupoMasUrgente([{ estado: { group: "finalizado" } }, { estado: { group: "incumplido" } }])).toBe(
      "incumplido",
    );
    expect(grupoMasUrgente([])).toBeNull();
  });

  it("CA-2 y CA-3: las cuatro tarjetas con los filtros de la web", () => {
    expect(ESTADOS_DE_LA_BANDEJA.map((e) => [e.titulo, e.params])).toEqual([
      ["Incumplidas", { status: "incumplido" }],
      ["En progreso", { status: "en_progreso" }],
      ["Próximas a vencer", { status: "en_progreso", sort: "due" }],
      ["Finalizadas", { status: "finalizado" }],
    ]);
    const counts = { overdue: 1, in_progress: 2, due_soon: 3, done: 4, done_on_time: 3, done_late: 1 };
    expect(ESTADOS_DE_LA_BANDEJA.map((e) => e.cifra(counts))).toEqual([1, 2, 3, 4]);
    expect(ESTADOS_DE_LA_BANDEJA[3].detalle(counts)).toBe("3 a tiempo · 1 fuera de plazo");
  });

  it("CA-3: la fila se dice entera", () => {
    const fila = nombreDeFila(
      {
        obligacion: { nombre: "Declaración del IVA" },
        entidad: "SRI",
        area: "Tributario",
        responsable: { nombre: "Ana Pérez" },
        vence_en: "2026-11-14T03:00:00Z",
        estado: { group: "en_progreso", label: "En preparación", days_remaining: 4 },
      },
      ZONA,
    );
    expect(fila).toBe(
      "Declaración del IVA. SRI · Tributario. Responsable: Ana Pérez. Vence el 13/11/2026, 22:00. Estado: En preparación. Quedan 4 días",
    );
  });

  it("CA-5 y CA-6: qué acciones hace la app y cuáles van a la web", () => {
    expect(accionesEnLaApp(["submit", "remind", "edit"]).map((a) => a.texto)).toEqual([
      "Editar seguimiento",
      "Reenviar recordatorio",
    ]);
    expect(accionesEnLaApp(undefined)).toEqual([]);
    expect(hayAccionesEnLaWeb(["edit", "change_due_date", "remind"])).toBe(false);
    for (const accion of ["submit", "upload", "validate", "return", "reject_document"]) {
      expect(hayAccionesEnLaWeb(["edit", accion])).toBe(true);
    }
    expect(rutaWebDelPeriodo(7)).toBe("/admin/matriz/obligaciones?periodo=7");
  });

  it("CA-5: sin respuesta del servidor, que puede haberse guardado", () => {
    const red = Object.assign(new Error("x"), { esDeRed: true });
    expect(mensajeDeMatriz(red, "No se pudo.", { envio: true })).toBe(TEXTO_PUEDE_HABERSE_GUARDADO);
    expect(mensajeDeMatriz({ response: { status: 502, data: "<html>" } }, "No se pudo.", { envio: true })).toBe(
      TEXTO_PUEDE_HABERSE_GUARDADO,
    );
    const prohibido = {
      response: { status: 403, data: { error: { message: "No tiene permiso para editar este período." } } },
    };
    expect(mensajeDeMatriz(prohibido, "No se pudo.", { envio: true })).toBe(
      "No tiene permiso para editar este período.",
    );
  });

  it("lo de la web según los permisos", () => {
    expect(matrizEnElNavegador(["matriz.editar"]).map((a) => a.ruta)).toEqual([
      "/admin/matriz/obligaciones",
      "/admin/matriz/documentos",
      "/admin/reportes/matriz",
      "/admin/configuracion/recordatorios",
    ]);
    expect(matrizEnElNavegador(["matriz.ver_auditoria"]).map((a) => a.ruta)).toContain(
      "/admin/auditoria?modulo=matriz",
    );
    expect(matrizEnElNavegador([])).toEqual([]);
  });
});

describe("validaciones de las acciones (CA-5)", () => {
  const base = { responsable: 4, suplente: null, avance: "50" };
  it("seguimiento: responsable obligatorio, suplente distinto y avance de 0 a 100", () => {
    expect(validarSeguimiento(base)).toEqual({});
    expect(validarSeguimiento({ ...base, responsable: null })).toEqual({ responsable: TEXTO_RESPONSABLE_OBLIGATORIO });
    expect(validarSeguimiento({ ...base, suplente: 4 })).toEqual({ suplente: TEXTO_SUPLENTE_DISTINTO });
    expect(validarSeguimiento({ ...base, avance: "101" })).toEqual({ avance: TEXTO_AVANCE });
    expect(validarSeguimiento({ ...base, avance: "" })).toEqual({ avance: TEXTO_AVANCE });
    expect(validarSeguimiento({ ...base, avance: "0" })).toEqual({});
  });

  it("fecha: la fecha y al menos 10 caracteres de justificación", () => {
    expect(validarFecha({ fecha: "2026-12-01", motivo: "Prórroga del SRI" })).toEqual({});
    expect(validarFecha({ fecha: "", motivo: "  corto   " })).toEqual({
      due_date: TEXTO_FECHA_OBLIGATORIA,
      reason: TEXTO_MOTIVO_CORTO,
    });
  });

  it("las personas que ya figuran se conservan aunque no estén en la lista", () => {
    const opciones = opcionesDePersonas([{ id: 1, nombre: "Ana", email: "ana@x" }], {
      responsable: { id: 1, nombre: "Ana" },
      suplente: { id: 9, nombre: "Luis (ya no está)" },
    });
    expect(opciones).toEqual([
      { valor: 1, texto: "Ana", detalle: "ana@x" },
      { valor: 9, texto: "Luis (ya no está)", detalle: undefined },
    ]);
  });
});

describe("avisos de la Matriz (CA-8)", () => {
  it("el recordatorio lleva al detalle del período, con la empresa", () => {
    const aviso = {
      id: 4,
      modulo: "matriz",
      empresa: 2,
      enlace: "/admin/matriz/obligaciones?periodo=15&empresa=2",
    };
    expect(MODULOS_EN_APP.matriz).toBe(rutaDeMatriz);
    expect(rutaDeMatriz(aviso)).toBe("/matriz/periodo/15?empresa=2");
    expect(destinoDeNotificacion(aviso)).toBe("/matriz/periodo/15?empresa=2");
    // Con la web delante (el de los correos) y la empresa solo en el enlace.
    expect(
      rutaDeMatriz({
        modulo: "matriz",
        enlace: "https://intranet.laarcourier.com/admin/matriz/obligaciones?periodo=8&empresa=3",
      }),
    ).toBe("/matriz/periodo/8?empresa=3");
  });

  it("sin un período válido, a la Bandeja de la Matriz", () => {
    expect(rutaDeMatriz({ modulo: "matriz", enlace: "/admin/matriz/resumen" })).toBe("/matriz");
    expect(rutaDeMatriz({ modulo: "matriz", enlace: "/admin/matriz/obligaciones?periodo=1x" })).toBe("/matriz");
    expect(rutaDeMatriz({ modulo: "matriz", enlace: "/admin/otro?periodo=5" })).toBe("/matriz");
    expect(rutaDeMatriz({ modulo: "matriz" })).toBe("/matriz");
  });
});

describe("evidencias (CA-4)", () => {
  it("se descargan con la sesión a su carpeta, que se borra al cerrar sesión", async () => {
    expect(CARPETAS_DE_DESCARGAS).toContain("matriz-documentos");
    const archivo = await descargarEvidencia({ id: 12, nombre_original: "../../informe.exe" }, { empresa: "3" });
    expect(archivo.uri).toBe("file:///cache/matriz-documentos/evidencia-12.pdf");
    const [url, , opciones] = FileSystem.File.downloadFileAsync.mock.calls[0];
    expect(url).toBe("https://api.prueba/api/v1/matriz/documentos/12/archivo/");
    expect(opciones.headers).toMatchObject({ Authorization: "Bearer access", "X-Empresa": "3" });
  });

  it("los errores, en palabras", async () => {
    FileSystem.File.downloadFileAsync.mockRejectedValueOnce(new Error("response has status: 404"));
    await expect(descargarEvidencia({ id: 1 })).rejects.toThrow(TEXTO_EVIDENCIA_NO_DISPONIBLE);
    FileSystem.File.downloadFileAsync.mockRejectedValueOnce(new Error("response has status: 403"));
    await expect(descargarEvidencia({ id: 1 })).rejects.toThrow(TEXTO_EVIDENCIA_SIN_PERMISO);
    FileSystem.File.downloadFileAsync.mockRejectedValueOnce(new Error("timeout"));
    await expect(descargarEvidencia({ id: 1 })).rejects.toThrow(TEXTO_EVIDENCIA_FALLO);
    await expect(descargarEvidencia({ id: "x" })).rejects.toThrow(TEXTO_EVIDENCIA_NO_DISPONIBLE);
  });
});

describe("ronda 1 de correcciones", () => {
  it("la zona horaria en palabras: «hora de Ecuador»; una desconocida no se menciona", () => {
    expect(horaDeLaZona("America/Guayaquil")).toBe("hora de Ecuador");
    expect(horaDeLaZona("Pacific/Galapagos")).toBe("hora de Galápagos");
    expect(horaDeLaZona("Asia/Tokyo")).toBeNull();
    expect(horaDeLaZona(null)).toBeNull();
  });

  it("H-13: el aviso de la web nombra solo lo que ofrece el servidor", () => {
    expect(textoAccionesEnLaWeb(["edit", "upload"])).toBe("Cargar evidencia se hace en la web.");
    expect(textoAccionesEnLaWeb(["submit", "upload"])).toBe(
      "Enviar a validación y cargar evidencia se hacen en la web.",
    );
    expect(textoAccionesEnLaWeb(["validate", "return", "reject_document"])).toBe(
      "Validar o devolver y rechazar evidencias se hacen en la web.",
    );
    expect(textoAccionesEnLaWeb(["edit"])).toBe("");
  });

  it("H-07: el día con el de la semana", () => {
    expect(diaConSemana("2026-11-13")).toBe("viernes 13 de noviembre de 2026");
    expect(diaConSemana("2026-02-30")).toBe("");
  });

  it("H-15: el aviso nombra los campos en el orden del formulario", () => {
    expect(textoRevise({ avance: "x", responsable: "y" }, ["responsable", "avance"])).toBe(
      "Revise los campos: Responsable y Avance (%).",
    );
    expect(textoRevise({ reason: "x" }, ["due_date", "reason"])).toBe("Revise el campo: Justificación.");
    expect(textoRevise({}, ["x"])).toBe("Revise los campos marcados.");
  });

  it("P2-1: la cuenta B no recibe lo que se guardó para la cuenta A (misma empresa)", async () => {
    api.get.mockResolvedValueOnce({
      empresas: [{ id: 2, nombre: "LAAR", zona_horaria: ZONA, roles: ["Responsable"] }],
    });
    api.get.mockResolvedValueOnce({ empresas: [] });
    const a = await renderHook(() => useEmpresaDeLaMatriz());
    await waitFor(() => expect(a.result.current.estado).toBe("listo"));
    a.unmount();
    // Sale A y entra B: la versión de la empresa no vuelve a 0.
    mockSesion.usuario = { id: 2, permissions: [] };
    const b = await renderHook(() => useEmpresaDeLaMatriz());
    await waitFor(() => expect(b.result.current.estado).toBe("sin_rol"));
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("P2-1: al cerrar sesión se olvida (limpiarEstado de SesionContext)", () => {
    const fs = require("fs");
    const path = require("path");
    const fuente = fs.readFileSync(path.join(__dirname, "../src/sesion/SesionContext.js"), "utf8");
    expect(fuente).toMatch(
      /const limpiarEstado = useCallback\(\(avisoFinal\) => \{\s*(\/\/.*\s*)*olvidarEmpresaDeLaMatriz\(\);/,
    );
  });
});
