import { act, renderHook, render, screen, waitFor } from "@testing-library/react-native";
import * as FileSystem from "expo-file-system";
import { Text } from "react-native";

import { api } from "../src/api/api";
import { soporteService } from "../src/api/servicios";
import { CARPETAS_DE_DESCARGAS } from "../src/adjuntos/descargas";
import { destinoDeNotificacion } from "../src/notificaciones/abrir";
import { rutaDeSoporte, rutaEnApp } from "../src/notificaciones/modulosEnApp";
import {
  descargarAdjunto,
  MAX_ADJUNTOS,
  rutaDeAdjuntoValida,
  TAMANO_MAXIMO_SOPORTE,
  TEXTO_ADJUNTO_GRANDE,
  TEXTO_ADJUNTO_NO_DISPONIBLE,
  TEXTO_MAXIMO_ADJUNTOS,
  TEXTO_TIPO_NO_PERMITIDO,
  useAdjuntosPorEnviar,
  validarAdjunto,
  validarLista,
} from "../src/soporte/adjuntos";
import {
  accesosEnElNavegador,
  aplicarPlantilla,
  camposVisibles,
  dialogoDe,
  esDelEquipo,
  faltanEnElPerfil,
  mensajeDeSoporte,
  ordenarMisTickets,
  pendientesDeMisTickets,
  prioridadPorMatriz,
  queSigue,
  respuestasSugeridas,
  rutaDeAltaPropia,
  TEXTO_MODULO_APAGADO,
  TEXTO_PUEDE_HABERSE_ENVIADO,
  textoDelPaso,
  textoDeVence,
  validarCampos,
} from "../src/soporte/formato";
import { ResumenSoporteProvider, useResumenSoporte } from "../src/soporte/ResumenSoporteContext";
import { normalizar, raices, sugerirCasos } from "../src/soporte/sugerirCaso";

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

const mockSesion = { usuario: { permissions: [] }, versionEmpresa: 0 };
jest.mock("../src/sesion/SesionContext", () => ({ useSesion: () => mockSesion }));

beforeEach(() => {
  jest.clearAllMocks();
  mockSesion.usuario = { permissions: [] };
});

const FOTO = { uri: "file:///cache/ImagePicker/a.jpg", name: "captura.jpg", type: "image/jpeg", size: 1000 };

describe("soporteService: rutas y campos del contrato (sección 4)", () => {
  it("lo de quien pide usa las mismas rutas que la web", async () => {
    await soporteService.formularioPropio();
    await soporteService.formularioPropio({ desdeLaMesa: true });
    await soporteService.misTickets();
    await soporteService.miTicket(7);
    await soporteService.miTicket(7, { sondeo: true, empresa: "3" });
    await soporteService.aprobaciones();
    await soporteService.etiquetas();

    expect(api.get.mock.calls).toEqual([
      ["/soporte/solicitar/"],
      ["/soporte/mesa/solicitar/"],
      ["/soporte/mis-tickets/"],
      ["/soporte/mis-tickets/7/", { params: undefined }],
      ["/soporte/mis-tickets/7/", { cabeceras: { "X-Empresa": "3" }, params: { sondeo: 1 } }],
      ["/soporte/aprobaciones/"],
      ["/soporte/etiquetas/"],
    ]);
  });

  it("lo del equipo usa las mismas rutas que la web", async () => {
    await soporteService.bandeja();
    await soporteService.tickets({ ambito: "cola", page: 2 });
    await soporteService.ticket(9, { sondeo: true });
    await soporteService.tecnicos();
    await soporteService.respuestas();
    await soporteService.formularioInterno();
    await soporteService.personas(" ca ");
    await soporteService.personas("");

    expect(api.get.mock.calls).toEqual([
      ["/soporte/tickets/bandeja/"],
      ["/soporte/tickets/", { params: { ambito: "cola", page: 2 } }],
      ["/soporte/tickets/9/", { params: { sondeo: 1 } }],
      ["/soporte/tickets/tecnicos/", undefined],
      ["/soporte/config/respuestas/", undefined],
      ["/soporte/tickets/formulario/"],
      ["/soporte/tickets/personas/", { params: { q: "ca" } }],
      ["/soporte/tickets/personas/", undefined],
    ]);
  });

  it("las acciones van con su cuerpo y la empresa del aviso", async () => {
    await soporteService.tomar(9, { empresa: "2" });
    await soporteService.tomarSiguiente();
    await soporteService.cambiarEstado(9, "esperando_usuario", "¿Reinició?");
    await soporteService.cambiarPrioridad(9, { prioridad: "alta", justificacion: "Afecta a todos" });
    await soporteService.asignar(9, 4, "Le toca");
    await soporteService.escalar(9, "Requiere N2");
    await soporteService.confirmarMiTicket(7);
    await soporteService.encuestaMiTicket(7, { calificacion: 5, resuelto: true, comentario: "" });
    await soporteService.decidirAprobacion(3, false, "No corresponde");

    expect(api.post.mock.calls).toEqual([
      ["/soporte/tickets/9/tomar/", {}, { cabeceras: { "X-Empresa": "2" } }],
      ["/soporte/tickets/tomar-siguiente/", {}],
      ["/soporte/tickets/9/cambiar-estado/", { estado: "esperando_usuario", nota: "¿Reinició?" }, undefined],
      ["/soporte/tickets/9/prioridad/", { prioridad: "alta", justificacion: "Afecta a todos" }, undefined],
      ["/soporte/tickets/9/asignar/", { tecnico: 4, nota: "Le toca" }, undefined],
      ["/soporte/tickets/9/escalar/", { motivo: "Requiere N2" }, undefined],
      ["/soporte/mis-tickets/7/", { confirmar: true }, undefined],
      ["/soporte/mis-tickets/7/encuesta/", { calificacion: 5, resuelto: true, comentario: "" }, undefined],
      ["/soporte/aprobaciones/3/decidir/", { aprobar: false, nota: "No corresponde" }],
    ]);
  });

  it("los envíos con archivos van en multipart con la clave «adjuntos» y más tiempo", async () => {
    await soporteService.crearTicket({ caso: "4", descripcion: "No imprime", adicionales: "{}" }, [FOTO], {
      desdeLaMesa: true,
    });
    await soporteService.responder(9, { texto: "Hola", interno: true }, [FOTO]);
    await soporteService.responderMiTicket(7, "Sigue igual", []);
    await soporteService.registrar({ solicitante: 5, canal: "telefono", asignarme: "false" }, []);

    const [ruta, cuerpo, opciones] = api.post.mock.calls[0];
    expect(ruta).toBe("/soporte/mesa/solicitar/");
    expect(cuerpo.getParts()).toEqual([
      { fieldName: "caso", string: "4" },
      { fieldName: "descripcion", string: "No imprime" },
      { fieldName: "adicionales", string: "{}" },
      { fieldName: "adjuntos", uri: FOTO.uri, name: "captura.jpg", type: "image/jpeg" },
    ]);
    expect(opciones.timeoutMs).toBeGreaterThan(20000);

    const [rutaResponder, cuerpoResponder] = api.post.mock.calls[1];
    expect(rutaResponder).toBe("/soporte/tickets/9/responder/");
    expect(cuerpoResponder.getParts().slice(0, 2)).toEqual([
      { fieldName: "texto", string: "Hola" },
      { fieldName: "interno", string: "true" },
    ]);
    const [rutaMia, cuerpoMio, opcionesMias] = api.post.mock.calls[2];
    expect(rutaMia).toBe("/soporte/mis-tickets/7/");
    expect(cuerpoMio.getParts()).toEqual([{ fieldName: "texto", string: "Sigue igual" }]);
    expect(opcionesMias.timeoutMs).toBeUndefined();
    expect(api.post.mock.calls[3][0]).toBe("/soporte/tickets/registrar/");
  });
});

/** Con la forma de `datos_del_formulario`. */
const CATEGORIAS = [
  {
    id: 1,
    nombre: "Impresoras",
    descripcion: "Equipos de impresión",
    casos: [
      { id: 11, nombre: "Papel atascado", prioridad: "baja" },
      { id: 12, nombre: "Impresora no imprime", prioridad: "media" },
    ],
  },
  {
    id: 2,
    nombre: "Correo",
    descripcion: "",
    casos: [
      { id: 21, nombre: "No puedo enviar correos", prioridad: "media" },
      { id: 22, nombre: "Caída general del correo", prioridad: "critica" },
    ],
  },
  { id: 3, nombre: "Sistema ERP", descripcion: "Facturación", casos: [{ id: 31, nombre: "Error al facturar", prioridad: "alta" }] },
];

describe("sugerirCaso (portado de la web, CA-4)", () => {
  it("quita tildes sin `normalize` y deja raíces de 5 letras sin palabras vacías", () => {
    expect(normalizar("Caída MAÑANA Pingüino")).toBe("caida manana pinguino");
    expect([...raices("Buenos días, tengo un problema con la impresora")]).toEqual(["impre"]);
    expect(raices("la de y un").size).toBe(0);
  });

  it("propone primero lo que coincide con el nombre del caso", () => {
    const sugeridas = sugerirCasos("La impresora no imprime nada desde ayer", CATEGORIAS);
    expect(sugeridas[0].caso.id).toBe(12);
    expect(sugeridas.map((s) => s.categoria.id)).toEqual([1]);
  });

  it("no propone casos solo porque coincide la categoría", () => {
    expect(sugerirCasos("falla en el sistema", CATEGORIAS)).toEqual([]);
  });

  it("entre iguales, primero el menos crítico, y como mucho 3", () => {
    const sugeridas = sugerirCasos("el correo no envía, caída", CATEGORIAS);
    // Los dos suman lo mismo: va primero «No puedo enviar correos» (media)
    // y después «Caída general del correo» (crítica).
    expect(sugeridas.map((s) => s.caso.id)).toEqual([21, 22]);
    const muchas = [{ id: 9, nombre: "Red", casos: Array.from({ length: 6 }, (_, i) => ({ id: 90 + i, nombre: `Red caída ${i}` })) }];
    expect(sugerirCasos("la red está caída", muchas)).toHaveLength(3);
    expect(sugerirCasos("", CATEGORIAS)).toEqual([]);
  });
});

describe("formato de la Mesa de ayuda", () => {
  it("«qué sigue» y el orden de Mis tickets: primero lo que pide algo de la persona (CA-6)", () => {
    const lista = [
      { id: 1, estado: "cerrado", puede_encuestar: false },
      { id: 2, estado: "nuevo", posicion: 3 },
      { id: 3, estado: "atendido" },
      { id: 4, estado: "cerrado", puede_encuestar: true },
      { id: 5, estado: "esperando_usuario" },
      { id: 6, estado: "en_curso", atrasado: true },
    ];
    expect(ordenarMisTickets(lista).map((t) => t.id)).toEqual([3, 4, 5, 2, 6, 1]);
    expect(pendientesDeMisTickets(lista)).toBe(3);
    expect(queSigue(lista[1]).texto).toBe("Hay 2 tickets antes que el suyo.");
    expect(queSigue({ estado: "nuevo", posicion: 1 }).texto).toBe("Es el siguiente en la cola.");
    expect(queSigue(lista[4])).toEqual({ texto: "Le respondieron: lea y conteste", accion: true });
    expect(queSigue(lista[5]).atrasado).toBe(true);
  });

  it("el plazo que importa, en texto y con su tono (CA-8)", () => {
    const ahora = new Date("2026-11-13T15:00:00Z").getTime();
    expect(
      textoDeVence({ estado: "en_plazo", respuesta: { estado: "vencida", vence: "2026-11-13T13:00:00Z" } }, ahora).texto,
    ).toBe("Respuesta vencida hace 2 h");
    const enPlazo = textoDeVence({ estado: "por_vencer", vence: "2026-11-13T15:45:00Z", respuesta: { estado: "cumplida" } }, ahora);
    expect(enPlazo.texto).toBe("Solucionar en 45 min");
    expect(enPlazo.icono).toBe("clock-alert-outline");
    expect(textoDeVence({ estado: "pausado", restante_en_pausa: 90 }, ahora).texto).toBe("En pausa · quedan 1 h 30 min");
  });

  it("los pasos y sus ventanas: la nota es obligatoria al esperar al usuario y al escalar (CA-12, CA-15)", () => {
    expect(dialogoDe("esperando_usuario", {}).obligatorio).toBeTruthy();
    expect(dialogoDe("escalar", {}).obligatorio).toBeTruthy();
    expect(dialogoDe("atendido", { solicitante_nombre: "Ana" }).obligatorio).toBeUndefined();
    expect(textoDelPaso("en_curso", { estado: "atendido" })).toBe("Reabrir");
    expect(textoDelPaso("en_curso", { estado: "asignado" })).toBe("Poner en curso");
    expect(prioridadPorMatriz("alto", "alta")).toBe("critica");
    expect(prioridadPorMatriz("bajo", "")).toBeNull();
  });

  it("respuestas predefinidas con «/», por atajo y título (CA-11)", () => {
    const respuestas = [
      { id: 1, atajo: "reinicio", titulo: "Pedir reinicio", texto: "Hola {{nombre}}, reinicie el equipo ({{numero}})." },
      { id: 2, atajo: "cierre", titulo: "Cierre por resuelto", texto: "Listo." },
    ];
    expect(respuestasSugeridas(respuestas, "hola")).toBeNull();
    expect(respuestasSugeridas(respuestas, "/").map((r) => r.id)).toEqual([1, 2]);
    expect(respuestasSugeridas(respuestas, "/rei").map((r) => r.id)).toEqual([1]);
    expect(respuestasSugeridas(respuestas, "/resuelto").map((r) => r.id)).toEqual([2]);
    expect(respuestasSugeridas(respuestas, "texto", { verTodas: true })).toHaveLength(2);
    expect(aplicarPlantilla(respuestas[0].texto, { solicitante_nombre: "Ana", numero: "TCK-2026-5" })).toBe(
      "Hola Ana, reinicie el equipo (TCK-2026-5).",
    );
  });

  it("el formulario: describir primero, campos propios por categoría y obligatorios", () => {
    const campos = [
      { clave: "nombre", base: true, obligatorio: true, etiqueta: "Nombre" },
      { clave: "categoria", base: true, obligatorio: true, etiqueta: "Categoría" },
      { clave: "caso", base: true, obligatorio: true, etiqueta: "Caso" },
      { clave: "descripcion", base: true, obligatorio: true, etiqueta: "Describa" },
      { clave: "impacto", base: true, obligatorio: false, etiqueta: "¿A quién afecta?" },
      { clave: "serie", base: false, obligatorio: true, etiqueta: "N.º de serie", tipo: "texto", categorias: [1] },
    ];
    expect(camposVisibles(campos, "", true).map((c) => c.clave)).toEqual(["descripcion", "categoria", "caso", "impacto"]);
    expect(camposVisibles(campos, "1").map((c) => c.clave)).toContain("serie");
    expect(validarCampos(campos, { categoria: "1", caso: "", descripcion: "x" }, {})).toEqual({
      caso: "Elija el caso que mejor lo describe.",
      serie: "Complete «N.º de serie».",
    });
  });

  it("lo que bloquea el alta en «Mi perfil» es lo mismo que comprueba el servidor (CA-5)", () => {
    expect(faltanEnElPerfil({ nombre: "Ana Pérez", area: { id: 1 }, agencia: { id: 2 } })).toEqual([]);
    expect(faltanEnElPerfil({ nombre: " ", area: null, agencia: null })).toEqual(["nombre y apellido", "área", "agencia"]);
  });

  it("permisos: equipo, alta propia y escritorio en el navegador (CA-1, CA-20)", () => {
    expect(esDelEquipo(["soporte.crear"])).toBe(false);
    expect(esDelEquipo(["soporte.registrar"])).toBe(true);
    expect(rutaDeAltaPropia(["soporte.crear", "soporte.mesa_crear"])).toEqual({ desdeLaMesa: false });
    expect(rutaDeAltaPropia(["soporte.mesa_crear"])).toEqual({ desdeLaMesa: true });
    expect(rutaDeAltaPropia([])).toBeNull();
    expect(accesosEnElNavegador(["soporte.reportes", "soporte.mi_horario"]).map((a) => a.ruta)).toEqual([
      "/admin/reportes/soporte",
      "/admin/soporte/mi-horario",
    ]);
  });

  it("CA-3: el módulo apagado y la falta de permiso se dicen claro; sin red, que puede haberse enviado", () => {
    const apagado = new Error("x");
    apagado.response = { status: 403, data: { error: { code: "modulo_apagado", message: "El módulo «Mesa de ayuda» está apagado en la empresa." } } };
    expect(mensajeDeSoporte(apagado, "")).toBe(TEXTO_MODULO_APAGADO);
    const sinPermiso = new Error("x");
    sinPermiso.response = { status: 403, data: { error: { code: "permission_denied", message: "No tiene permiso para crear tickets; pídalo a su administrador." } } };
    expect(mensajeDeSoporte(sinPermiso, "")).toBe("No tiene permiso para crear tickets; pídalo a su administrador.");
    const red = new Error("red");
    red.esDeRed = true;
    expect(mensajeDeSoporte(red, "", { envio: true })).toBe(TEXTO_PUEDE_HABERSE_ENVIADO);
  });
});

describe("adjuntos de la Mesa de ayuda (CA-18)", () => {
  it("valida tipo y tamaño antes de enviar", () => {
    expect(validarAdjunto({ uri: "file:///a.exe", nombre: "virus.exe", tipo: "application/x-msdownload", tamano: 10 }).error).toBe(
      TEXTO_TIPO_NO_PERMITIDO,
    );
    expect(
      validarAdjunto({ uri: "file:///a.pdf", nombre: "informe.pdf", tipo: "application/pdf", tamano: TAMANO_MAXIMO_SOPORTE + 1 }).error,
    ).toBe(TEXTO_ADJUNTO_GRANDE);
    const docx = validarAdjunto({ uri: "file:///b", nombre: "acta.docx", tipo: "application/octet-stream", tamano: 50 });
    expect(docx.archivo.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(validarAdjunto({ uri: "file:///c.webp", nombre: "c.webp", tipo: "image/webp", tamano: 50 }).archivo.name).toBe("c.webp");
    expect(validarLista([FOTO, FOTO, FOTO])).toBeNull();
    expect(validarLista([FOTO, FOTO, FOTO, FOTO])).toBe(TEXTO_MAXIMO_ADJUNTOS);
  });

  it("no deja elegir un cuarto archivo", async () => {
    const { result } = await renderHook(() => useAdjuntosPorEnviar());
    for (let i = 0; i < MAX_ADJUNTOS; i += 1) {
      await act(async () => {
        await result.current.agregar(async () =>
          validarAdjunto({ uri: `file:///cache/ImagePicker/${i}.jpg`, nombre: `${i}.jpg`, tipo: "image/jpeg", tamano: 100 }),
        );
      });
    }
    expect(result.current.lista).toHaveLength(3);
    const selector = jest.fn();
    await act(async () => {
      await result.current.agregar(selector);
    });
    expect(selector).not.toHaveBeenCalled();
    expect(result.current.error.texto).toBe(TEXTO_MAXIMO_ADJUNTOS);
    await act(async () => result.current.quitar(0));
    expect(result.current.lista).toHaveLength(2);
  });

  it("solo descarga de las rutas del contrato, con la sesión y la empresa, a su carpeta", async () => {
    expect(rutaDeAdjuntoValida("/soporte/tickets/9/adjuntos/3/")).toBe(true);
    expect(rutaDeAdjuntoValida("/soporte/mis-tickets/9/adjuntos/3/")).toBe(true);
    expect(rutaDeAdjuntoValida("https://otro.com/x")).toBe(false);
    await expect(descargarAdjunto({ id: 3, nombre: "a.pdf", url: "/otra/" })).rejects.toThrow(TEXTO_ADJUNTO_NO_DISPONIBLE);

    const archivo = await descargarAdjunto({ id: 3, nombre: "acta.pdf", url: "/soporte/tickets/9/adjuntos/3/" }, { empresa: "2" });
    expect(FileSystem.File.downloadFileAsync).toHaveBeenCalledWith(
      "https://api.prueba/api/v1/soporte/tickets/9/adjuntos/3/",
      expect.anything(),
      { headers: { Authorization: "Bearer access", "X-Empresa": "2" }, idempotent: true },
    );
    expect(archivo.uri).toBe("file:///cache/soporte-adjuntos/adjunto-3.pdf");
    // LOPDP: la carpeta se borra al cerrar sesión con las demás.
    expect(CARPETAS_DE_DESCARGAS).toContain("soporte-adjuntos");
  });
});

describe("notificaciones del módulo «soporte» (CA-19)", () => {
  it("abren la ficha del equipo, la de quien pide, las aprobaciones o la Mesa", () => {
    expect(rutaDeSoporte({ enlace: "/admin/soporte/tickets/15", empresa: 2 })).toBe("/soporte/ticket/15?empresa=2");
    expect(rutaDeSoporte({ enlace: "/admin/ayuda/tickets/15#encuesta", empresa: { id: 3 } })).toBe(
      "/soporte/mi-ticket/15?empresa=3",
    );
    expect(rutaDeSoporte({ enlace: "https://intranet.laarcourier.com/admin/ayuda/tickets/8" })).toBe("/soporte/mi-ticket/8");
    expect(rutaDeSoporte({ enlace: "/admin/aprobaciones" })).toMatch(/^\/soporte\?vista=aprobaciones&n=\d+$/);
    expect(rutaDeSoporte({ enlace: "/admin/soporte/bandeja" })).toBe("/soporte");
    expect(rutaDeSoporte({ enlace: "/admin/soporte/tickets/1;2" })).toBe("/soporte");
    expect(rutaEnApp({ id: 1, modulo: "soporte", enlace: "" })).toBe("/soporte");
    expect(destinoDeNotificacion({ id: 4, modulo: "soporte", enlace: "/admin/soporte/tickets/9" })).toBe("/soporte/ticket/9");
  });
});

describe("ResumenSoporteProvider («Para hoy», CA-2)", () => {
  function Numeros() {
    const r = useResumenSoporte();
    return <Text>{`mios ${r.misPendientes} · aprobaciones ${r.aprobaciones} · asignados ${r.asignados}`}</Text>;
  }

  it("quien no es del equipo no llama a la bandeja (sin 403 visibles)", async () => {
    api.get.mockImplementation(async (ruta) =>
      ruta === "/soporte/mis-tickets/" ? [{ id: 1, estado: "esperando_usuario" }, { id: 2, estado: "nuevo" }] : [],
    );
    await render(
      <ResumenSoporteProvider>
        <Numeros />
      </ResumenSoporteProvider>,
    );
    expect(await screen.findByText("mios 1 · aprobaciones 0 · asignados 0")).toBeTruthy();
    expect(api.get.mock.calls.map(([r]) => r)).not.toContain("/soporte/tickets/bandeja/");
  });

  it("al equipo le cuenta lo asignado; un 403 deja todo en cero sin error", async () => {
    mockSesion.usuario = { permissions: ["soporte.atender"] };
    api.get.mockImplementation(async (ruta) => {
      if (ruta === "/soporte/tickets/bandeja/") return { tecnico: { abiertos: 4 }, puede: {} };
      if (ruta === "/soporte/aprobaciones/") return [{ id: 1 }, { id: 2 }];
      return [];
    });
    await render(
      <ResumenSoporteProvider>
        <Numeros />
      </ResumenSoporteProvider>,
    );
    expect(await screen.findByText("mios 0 · aprobaciones 2 · asignados 4")).toBeTruthy();
  });

  it("con el módulo apagado (403) todo queda en cero, sin error", async () => {
    mockSesion.usuario = { permissions: ["soporte.atender"] };
    const prohibido = new Error("403");
    prohibido.response = { status: 403, data: { error: { code: "modulo_apagado" } } };
    api.get.mockRejectedValue(prohibido);
    await render(
      <ResumenSoporteProvider>
        <Numeros />
      </ResumenSoporteProvider>,
    );
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/soporte/tickets/bandeja/"));
    expect(screen.getByText("mios 0 · aprobaciones 0 · asignados 0")).toBeTruthy();
  });

  describe("US-016: «noEsDelEquipo» (el 403 de bandeja/) para la barra de la Mesa", () => {
    const { useRecargarResumenSoporte } = require("../src/soporte/ResumenSoporteContext");
    let marcar;
    function Equipo() {
      const r = useResumenSoporte();
      marcar = useRecargarResumenSoporte().marcarNoEsDelEquipo;
      return <Text>{`del equipo ${r.delEquipo} · no es ${r.noEsDelEquipo}`}</Text>;
    }

    afterEach(() => {
      mockSesion.versionEmpresa = 0;
    });

    it("un 403 de bandeja/ en el resumen lo marca; al cambiar de empresa se vuelve a comprobar (G-9)", async () => {
      mockSesion.usuario = { permissions: ["soporte.atender"] };
      const prohibido = new Error("403");
      prohibido.response = { status: 403, data: { error: { code: "permission_denied" } } };
      api.get.mockImplementation(async (ruta) => {
        if (ruta === "/soporte/tickets/bandeja/") throw prohibido;
        return [];
      });
      const arbol = () => (
        <ResumenSoporteProvider>
          <Equipo />
        </ResumenSoporteProvider>
      );
      const { rerender } = await render(arbol());
      expect(await screen.findByText("del equipo true · no es true")).toBeTruthy();

      api.get.mockImplementation(async (ruta) =>
        ruta === "/soporte/tickets/bandeja/" ? { tecnico: { abiertos: 0 }, puede: {} } : [],
      );
      mockSesion.versionEmpresa = 1;
      await rerender(arbol());
      expect(await screen.findByText("del equipo true · no es false")).toBeTruthy();
    });

    it("la Mesa lo informa con marcarNoEsDelEquipo", async () => {
      mockSesion.usuario = { permissions: ["soporte.atender"] };
      api.get.mockImplementation(async (ruta) =>
        ruta === "/soporte/tickets/bandeja/" ? { tecnico: { abiertos: 0 }, puede: {} } : [],
      );
      await render(
        <ResumenSoporteProvider>
          <Equipo />
        </ResumenSoporteProvider>,
      );
      expect(await screen.findByText("del equipo true · no es false")).toBeTruthy();
      await act(async () => marcar());
      expect(screen.getByText("del equipo true · no es true")).toBeTruthy();
    });
  });
});

describe("ronda 1 de QA: errores, «Para hoy» y plazos", () => {
  const { limpiarMensaje, mensajeDeError } = require("../src/api/errores");
  const formato = require("../src/soporte/formato");

  function conRespuesta(status, data) {
    const e = new Error("x");
    e.response = { status, data };
    return e;
  }

  it("G-1: saca los textos de `ErrorDetail(...)` y de una lista", () => {
    const real = "[ErrorDetail(string='Otra persona lo tomó mientras tanto.', code='invalid')]";
    expect(limpiarMensaje(real)).toBe("Otra persona lo tomó mientras tanto.");
    expect(limpiarMensaje("['Uno.', 'Dos.']")).toBe("Uno. Dos.");
    expect(limpiarMensaje("Un mensaje normal.")).toBe("Un mensaje normal.");
    expect(mensajeDeError(conRespuesta(400, { error: { code: "invalid", message: real } }))).toBe(
      "Otra persona lo tomó mientras tanto.",
    );
  });

  it("G-2: un 502, 503 o 504, o una página HTML, también puede haberse enviado", () => {
    for (const status of [502, 503, 504]) {
      expect(formato.mensajeDeSoporte(conRespuesta(status, null), "", { envio: true })).toBe(TEXTO_PUEDE_HABERSE_ENVIADO);
    }
    expect(formato.mensajeDeSoporte(conRespuesta(500, "<html>Error</html>"), "", { envio: true })).toBe(
      TEXTO_PUEDE_HABERSE_ENVIADO,
    );
    expect(formato.mensajeDeSoporte(conRespuesta(400, { error: { message: "Falta el texto." } }), "", { envio: true })).toBe(
      "Falta el texto.",
    );
  });

  it("G-7: el error de una acción, sin el nombre del campo", () => {
    expect(
      formato.mensajeDeAccion(
        conRespuesta(400, { error: { message: "Error en la solicitud.", details: { nivel: ["No hay un nivel superior al que escalar."] } } }),
        "",
      ),
    ).toBe("No hay un nivel superior al que escalar.");
  });

  it("G-5: la encuesta pendiente no cuenta en «Para hoy», pero sigue en la lista", () => {
    const lista = [
      { estado: "cerrado", puede_encuestar: true },
      { estado: "esperando_usuario" },
      { estado: "atendido" },
    ];
    expect(formato.pendientesParaHoy(lista)).toBe(2);
    expect(pendientesDeMisTickets(lista)).toBe(3);
  });

  it("H-20: «Responder en…» va en ámbar solo si está por vencer", () => {
    const ahora = new Date("2026-11-13T15:00:00Z").getTime();
    const holgado = textoDeVence({ respuesta: { estado: "en_plazo", vence: "2026-11-13T18:00:00Z", minutos: 240 } }, ahora);
    expect(holgado.texto).toBe("Responder en 3 h");
    expect(holgado.icono).toBe("clock-check-outline");
    const justo = textoDeVence({ respuesta: { estado: "en_plazo", vence: "2026-11-13T15:30:00Z", minutos: 240 } }, ahora);
    expect(justo.icono).toBe("clock-alert-outline");
  });

  it("G-8: un 403 al descargar no se presenta como problema de red; la extensión, solo las del contrato", async () => {
    const { TEXTO_ADJUNTO_SIN_PERMISO } = require("../src/soporte/adjuntos");
    FileSystem.File.downloadFileAsync.mockRejectedValueOnce(new Error("Unable to download a file: response has status: 403"));
    await expect(descargarAdjunto({ id: 3, nombre: "a.pdf", url: "/soporte/tickets/9/adjuntos/3/" })).rejects.toThrow(
      TEXTO_ADJUNTO_SIN_PERMISO,
    );
    const archivo = await descargarAdjunto({ id: 4, nombre: "script.sh", url: "/soporte/tickets/9/adjuntos/4/" });
    expect(archivo.uri).toBe("file:///cache/soporte-adjuntos/adjunto-4.bin");
  });
});

describe("T1: ResumenSoporteProvider recarga poco y no repinta de más", () => {
  const Notifications = require("expo-notifications");
  const { AppState } = require("react-native");
  const { ESPERA_AGRUPAR_MS, useRecargarResumenSoporte } = require("../src/soporte/ResumenSoporteContext");

  afterEach(() => jest.useRealTimers());

  it("solo los push de «soporte», juntos con la vuelta al frente, en una sola recarga", async () => {
    let alPush;
    let alCambiarApp;
    Notifications.addNotificationReceivedListener.mockImplementation((fn) => {
      alPush = fn;
      return { remove: jest.fn() };
    });
    jest.spyOn(AppState, "addEventListener").mockImplementation((_e, fn) => {
      alCambiarApp = fn;
      return { remove: jest.fn() };
    });
    api.get.mockResolvedValue([]);
    jest.useFakeTimers();
    await render(
      <ResumenSoporteProvider>
        <Text>hola</Text>
      </ResumenSoporteProvider>,
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    const alAbrir = api.get.mock.calls.length;
    const aviso = (modulo) => ({ request: { content: { data: { modulo } } } });
    await act(async () => {
      alPush(aviso("chat"));
      await jest.advanceTimersByTimeAsync(ESPERA_AGRUPAR_MS * 2);
    });
    expect(api.get.mock.calls.length).toBe(alAbrir);
    await act(async () => {
      alPush(aviso("soporte"));
      alPush(aviso("soporte"));
      alCambiarApp("active");
      await jest.advanceTimersByTimeAsync(ESPERA_AGRUPAR_MS);
    });
    // Una recarga: mis-tickets y aprobaciones (no es del equipo).
    expect(api.get.mock.calls.length).toBe(alAbrir + 2);
    Notifications.addNotificationReceivedListener.mockImplementation(() => ({ remove: jest.fn() }));
  });

  it("con los mismos números no repinta; `recargar` es estable y omite mis-tickets si se pide", async () => {
    api.get.mockImplementation(async (ruta) => (ruta === "/soporte/aprobaciones/" ? [{ id: 1 }] : []));
    let pintadas = 0;
    const recargas = new Set();
    function Contador() {
      const r = useResumenSoporte();
      const { recargar } = useRecargarResumenSoporte();
      pintadas += 1;
      recargas.add(recargar);
      return <Text>{`aprobaciones ${r.aprobaciones}`}</Text>;
    }
    let recargarDeFuera;
    function Captura() {
      recargarDeFuera = useRecargarResumenSoporte().recargar;
      return null;
    }
    await render(
      <ResumenSoporteProvider>
        <Contador />
        <Captura />
      </ResumenSoporteProvider>,
    );
    expect(await screen.findByText("aprobaciones 1")).toBeTruthy();
    const antes = pintadas;
    api.get.mockClear();
    await act(async () => recargarDeFuera({ sinMisTickets: true }));
    expect(api.get.mock.calls.map(([r]) => r)).toEqual(["/soporte/aprobaciones/"]);
    expect(pintadas).toBe(antes);
    expect(recargas.size).toBe(1);
  });
});
