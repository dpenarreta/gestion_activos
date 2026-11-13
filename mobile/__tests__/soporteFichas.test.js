import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as FileSystem from "expo-file-system";
import * as Linking from "expo-linking";
import { AccessibilityInfo, Alert, AppState, ScrollView, StyleSheet, TextInput } from "react-native";
import { colores } from "../src/tema/colores";

import { soporteService } from "../src/api/servicios";
import { tomarAviso } from "../src/soporte/avisoPendiente";
import { TEXTO_PUEDE_HABERSE_ENVIADO } from "../src/soporte/formato";
import { SONDEO_FICHAS_MS } from "../src/soporte/useSondeo";
import {
  MiTicket,
  TEXTO_BORRADOR_SIN_ENVIAR as TEXTO_BORRADOR_MIO,
  TEXTO_CERRADO,
  TEXTO_NO_DISPONIBLE,
  TEXTO_RESPUESTA_VACIA,
} from "../src/pantallas/soporte/MiTicket";
import {
  TEXTO_BORRADOR_SIN_ENVIAR,
  TEXTO_FUERA_DE_HORARIO,
  TEXTO_JUSTIFICACION,
  TEXTO_NO_DISPONIBLE as TEXTO_NO_DISPONIBLE_EQUIPO,
  ESPERA_ANUNCIO_RESPUESTAS_MS,
  TEXTO_REFRESCO_FALLIDO,
  TEXTO_SIN_LLAMADA,
  TEXTO_SOLO_EQUIPO,
  TicketDetalle,
} from "../src/pantallas/soporte/TicketDetalle";
import PantallaMiTicket from "../src/app/(app)/soporte/mi-ticket/[id]";
import PantallaTicket from "../src/app/(app)/soporte/ticket/[id]";

const mockRouter = { push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockNavegacion = { setOptions: jest.fn(), dispatch: jest.fn() };
const mockParametros = {};
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    useNavigation: () => mockNavegacion,
    usePreventRemove: () => {},
    useLocalSearchParams: () => mockParametros,
    useFocusEffect: (efecto) => React.useEffect(efecto, [efecto]),
  };
});

const mockSesion = { usuario: { permissions: ["soporte.crear"] }, empresaActiva: { id: 1 }, versionEmpresa: 0 };
jest.mock("../src/sesion/SesionContext", () => ({ useSesion: () => mockSesion }));

const mockResumen = { recargar: jest.fn(async () => {}), informarMisTickets: jest.fn() };
jest.mock("../src/soporte/ResumenSoporteContext", () => ({
  useResumenSoporte: () => mockResumen,
  useRecargarResumenSoporte: () => mockResumen,
}));

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View };
});

jest.mock("../src/api/api", () => ({
  api: { conRenovacion: jest.fn(async (hacer) => hacer({ Authorization: "Bearer access" })) },
}));

jest.mock("../src/api/servicios", () => ({
  soporteService: {
    miTicket: jest.fn(),
    responderMiTicket: jest.fn(),
    confirmarMiTicket: jest.fn(),
    encuestaMiTicket: jest.fn(),
    ticket: jest.fn(),
    tomar: jest.fn(),
    cambiarEstado: jest.fn(),
    cambiarPrioridad: jest.fn(),
    tecnicos: jest.fn(),
    asignar: jest.fn(),
    escalar: jest.fn(),
    responder: jest.fn(),
    respuestas: jest.fn(),
    etiquetas: jest.fn(),
    urlAdjunto: (ruta) => `https://api.prueba/api/v1${ruta}`,
  },
}));

function errorDeRed() {
  return Object.assign(new Error("red"), { esDeRed: true });
}

function error(status, code, message, details = null) {
  const e = new Error(message);
  e.response = { status, data: { error: { code, message, details } } };
  return e;
}

function anunciados() {
  return AccessibilityInfo.announceForAccessibility.mock.calls.map(([t]) => t);
}

/** Con la forma de `serializers.seguimiento`. */
function seguimiento(campos = {}) {
  return {
    numero: "TCK-2026-7",
    estado: "en_curso",
    estado_display: "En atención",
    cierre_automatico: null,
    atrasado: false,
    posicion: null,
    fuera_de_horario: false,
    categoria: "Impresoras",
    caso: "Papel atascado",
    prioridad: "media",
    prioridad_display: "P3 · Media",
    plazos: { respuesta: null, solucion: "2099-11-14T15:00:00Z", respondido: true },
    aprobaciones: [],
    descripcion: "La impresora del piso 2 dice papel atascado",
    datos_adicionales: [{ clave: "piso", etiqueta: "Piso", valor: "2" }],
    atiende: "Luis Mora",
    creado: "2026-11-13T09:00:00Z",
    adjuntos: [{ id: 5, nombre: "foto.jpg", tamano: 2048, url: "/soporte/mis-tickets/7/adjuntos/5/", interno: false }],
    mensajes: [
      { id: 1, texto: "¿Ya revisó la bandeja?", del_solicitante: false, autor: "Luis Mora", fecha: "2026-11-13T10:00:00Z", adjuntos: [] },
    ],
    puede_responder: true,
    puede_confirmar: false,
    encuesta: null,
    puede_encuestar: false,
    ...campos,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: jest.fn() }));
  mockSesion.usuario = { permissions: ["soporte.crear"] };
  soporteService.respuestas.mockResolvedValue([]);
  soporteService.etiquetas.mockResolvedValue(null);
  soporteService.tecnicos.mockResolvedValue([]);
  tomarAviso();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("la ficha de quien pide (CA-7)", () => {
  it("muestra estado, quién atiende, plazos, lo que contó con adjuntos y la conversación", async () => {
    soporteService.miTicket.mockResolvedValue(seguimiento());
    await render(<MiTicket id="7" />);
    // H-23: el número va en la barra; dentro, el caso.
    expect(await screen.findByRole("header", { name: "Papel atascado" })).toBeTruthy();
    expect(screen.queryByText("Ticket TCK-2026-7")).toBeNull();
    expect(soporteService.miTicket).toHaveBeenCalledWith("7", {});
    expect(screen.getByText("En atención")).toBeTruthy();
    expect(screen.getByText("Lo atiende Luis Mora")).toBeTruthy();
    expect(screen.getByText(/Debería quedar resuelto antes del/)).toBeTruthy();
    expect(screen.getByLabelText("Prioridad: P3 · Media")).toBeTruthy();
    expect(screen.getByLabelText("Piso: 2")).toBeTruthy();
    expect(screen.getByRole("header", { name: "Lo que nos contó" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "foto.jpg, 2 KB. Abrir el adjunto" })).toBeTruthy();
    expect(screen.getByLabelText(/^Soporte TI, Luis Mora, /)).toBeTruthy();
    expect(mockNavegacion.setOptions).toHaveBeenLastCalledWith({ title: "Ticket TCK-2026-7" });
  });

  it("un adjunto se descarga con la sesión, se ve en la app y se borra al cerrar", async () => {
    soporteService.miTicket.mockResolvedValue(seguimiento());
    await render(<MiTicket id="7" />);
    await fireEvent.press(await screen.findByRole("button", { name: "foto.jpg, 2 KB. Abrir el adjunto" }));
    expect(FileSystem.File.downloadFileAsync).toHaveBeenCalledWith(
      "https://api.prueba/api/v1/soporte/mis-tickets/7/adjuntos/5/",
      expect.anything(),
      expect.objectContaining({ headers: { Authorization: "Bearer access" } }),
    );
    expect(await screen.findByTestId("imagen-adjunto")).toBeTruthy();
    expect(FileSystem.__existentes.has("file:///cache/soporte-adjuntos/adjunto-5.jpg")).toBe(true);
    await fireEvent.press(screen.getByTestId("cerrar-adjunto"));
    expect(FileSystem.__existentes.has("file:///cache/soporte-adjuntos/adjunto-5.jpg")).toBe(false);
  });

  it("responde con texto; vacío no se envía", async () => {
    soporteService.miTicket.mockResolvedValue(seguimiento());
    soporteService.responderMiTicket.mockResolvedValue(
      seguimiento({ mensajes: [...seguimiento().mensajes, { id: 2, texto: "Sí, sigue", del_solicitante: true, autor: "Usted", fecha: "2026-11-13T11:00:00Z", adjuntos: [] }] }),
    );
    await render(<MiTicket id="7" />);
    await fireEvent.press(await screen.findByRole("button", { name: "Enviar" }));
    expect(soporteService.responderMiTicket).not.toHaveBeenCalled();
    expect(anunciados()).toContain(TEXTO_RESPUESTA_VACIA);

    await fireEvent.changeText(screen.getByTestId("texto-respuesta"), "  Sí, sigue  ");
    await fireEvent.press(screen.getByRole("button", { name: "Enviar" }));
    expect(soporteService.responderMiTicket).toHaveBeenCalledWith("7", "Sí, sigue", [], {});
    expect(await screen.findByText("Mensaje enviado. Soporte le responderá aquí.")).toBeTruthy();
    expect(screen.getByTestId("texto-respuesta").props.value).toBe("");
    expect(screen.getByLabelText(/^Usted, /)).toBeTruthy();
  });

  it("CA-22: sin respuesta del servidor conserva lo escrito y avisa que puede haberse enviado; sin doble envío", async () => {
    soporteService.miTicket.mockResolvedValue(seguimiento());
    let rechazar;
    soporteService.responderMiTicket.mockReturnValue(new Promise((_, r) => (rechazar = r)));
    await render(<MiTicket id="7" />);
    await fireEvent.changeText(await screen.findByTestId("texto-respuesta"), "Sigue sin imprimir");
    await fireEvent.press(screen.getByTestId("enviar-respuesta"));
    await fireEvent.press(screen.getByTestId("enviar-respuesta"));
    expect(soporteService.responderMiTicket).toHaveBeenCalledTimes(1);
    await act(async () => rechazar(errorDeRed()));
    expect(await screen.findByText(TEXTO_PUEDE_HABERSE_ENVIADO)).toBeTruthy();
    expect(screen.getByTestId("texto-respuesta").props.value).toBe("Sigue sin imprimir");
  });

  it("«¿Quedó resuelto?»: «Sí» confirma y «No, sigue el problema» lleva a responder (que reabre)", async () => {
    jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
    soporteService.miTicket.mockResolvedValue(
      seguimiento({ estado: "atendido", estado_display: "Resuelto: falta su confirmación", puede_confirmar: true, cierre_automatico: "2026-11-18" }),
    );
    soporteService.confirmarMiTicket.mockResolvedValue(
      seguimiento({ estado: "cerrado", estado_display: "Cerrado", puede_responder: false, puede_encuestar: true }),
    );
    await render(<MiTicket id="7" />);
    expect(await screen.findByText(/se cerrará solo el 18\/11\/2026/)).toBeTruthy();
    expect(screen.getByTestId("texto-respuesta").props.accessibilityLabel).toMatch(/^¿El problema sigue\? Cuéntenos \(el ticket se reabre\)/);

    jest.useFakeTimers();
    await fireEvent.press(screen.getByRole("button", { name: "No, sigue el problema" }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(expect.anything(), "focus");
    jest.useRealTimers();

    await fireEvent.press(screen.getByRole("button", { name: "Sí, quedó resuelto" }));
    expect(soporteService.confirmarMiTicket).toHaveBeenCalledWith("7", {});
    expect(await screen.findByText(/Cerramos su ticket/)).toBeTruthy();
    expect(screen.getByRole("header", { name: "¿Cómo lo atendimos?" })).toBeTruthy();
  });

  it("la encuesta pide calificación y si se resolvió, y envía el comentario", async () => {
    soporteService.miTicket.mockResolvedValue(
      seguimiento({ estado: "cerrado", estado_display: "Cerrado", puede_responder: false, puede_encuestar: true }),
    );
    soporteService.encuestaMiTicket.mockResolvedValue(
      seguimiento({ estado: "cerrado", estado_display: "Cerrado", puede_responder: false, puede_encuestar: false, encuesta: { calificacion: 4, resuelto: true } }),
    );
    await render(<MiTicket id="7" />);
    await fireEvent.press(await screen.findByRole("button", { name: "Enviar encuesta" }));
    expect(screen.getByText("Elija una calificación de 1 a 5 estrellas.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "4 de 5: Satisfecho" }));
    await fireEvent.press(screen.getByRole("button", { name: "Enviar encuesta" }));
    expect(screen.getByText("Indique si su requerimiento se resolvió.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Sí" }));
    await fireEvent.changeText(screen.getByTestId("encuesta-comentario"), "Muy rápido");
    await fireEvent.press(screen.getByRole("button", { name: "Enviar encuesta" }));
    expect(soporteService.encuestaMiTicket).toHaveBeenCalledWith("7", { calificacion: 4, resuelto: true, comentario: "Muy rápido" }, {});
    expect(await screen.findByText("¡Gracias por su opinión!")).toBeTruthy();
    expect(screen.getByText(/Calificó la atención con 4 de 5/)).toBeTruthy();
  });

  it("cerrado no se puede responder y se indica crear uno nuevo", async () => {
    soporteService.miTicket.mockResolvedValue(seguimiento({ estado: "cerrado", estado_display: "Cerrado", puede_responder: false }));
    await render(<MiTicket id="7" />);
    expect(await screen.findByText(TEXTO_CERRADO)).toBeTruthy();
    expect(screen.queryByTestId("texto-respuesta")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Crear un ticket nuevo" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/soporte/nuevo");
  });

  it("se actualiza cada 10 s con `sondeo`, avisa lo nuevo y no pisa lo que se escribe", async () => {
    jest.useFakeTimers();
    soporteService.miTicket.mockResolvedValue(seguimiento());
    await render(<MiTicket id="7" empresa="3" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    await fireEvent.changeText(screen.getByTestId("texto-respuesta"), "Estoy escribiendo");
    soporteService.miTicket.mockResolvedValue(
      seguimiento({ mensajes: [...seguimiento().mensajes, { id: 3, texto: "¿Funcionó?", del_solicitante: false, autor: "Luis Mora", fecha: "2026-11-13T12:00:00Z", adjuntos: [] }] }),
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SONDEO_FICHAS_MS);
    });
    expect(soporteService.miTicket).toHaveBeenLastCalledWith("7", { empresa: "3", sondeo: true });
    expect(screen.getByText(/^Soporte le respondió/)).toBeTruthy();
    // T3 (WCAG 4.1.3): la novedad también se anuncia.
    expect(anunciados().some((t) => /^Soporte le respondió/.test(t))).toBe(true);
    expect(screen.getByText("¿Funcionó?")).toBeTruthy();
    expect(screen.getByTestId("texto-respuesta").props.value).toBe("Estoy escribiendo");

    soporteService.miTicket.mockRejectedValue(errorDeRed());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SONDEO_FICHAS_MS);
    });
    expect(screen.getByText("¿Funcionó?")).toBeTruthy();
    expect(screen.getByText(/No se pudo actualizar el ticket/)).toBeTruthy();
  });

  it("H-06: «No, sigue el problema» lleva la pantalla a la sección «Responder»", async () => {
    const desplazar = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
    soporteService.miTicket.mockResolvedValue(
      seguimiento({ estado: "atendido", estado_display: "Resuelto: falta su confirmación", puede_confirmar: true }),
    );
    await render(<MiTicket id="7" />);
    const bloque = await screen.findByTestId("responder");
    expect(screen.getByRole("header", { name: "Responder" })).toBeTruthy();
    await fireEvent(bloque, "layout", { nativeEvent: { layout: { y: 900, height: 300 } } });
    jest.useFakeTimers();
    await fireEvent.press(screen.getByRole("button", { name: "No, sigue el problema" }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(50);
    });
    expect(desplazar).toHaveBeenCalledWith({ y: 888, animated: true });
    desplazar.mockRestore();
  });

  it("G-4: si el sondeo cierra el ticket con un borrador escrito, el texto queda para copiarlo", async () => {
    jest.useFakeTimers();
    soporteService.miTicket.mockResolvedValue(seguimiento());
    await render(<MiTicket id="7" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    await fireEvent.changeText(screen.getByTestId("texto-respuesta"), "Sigue fallando");
    soporteService.miTicket.mockResolvedValue(seguimiento({ estado: "cerrado", estado_display: "Cerrado", puede_responder: false }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SONDEO_FICHAS_MS);
    });
    expect(screen.getByText(TEXTO_BORRADOR_MIO)).toBeTruthy();
    expect(screen.getByText("Sigue fallando").props.selectable).toBe(true);
  });

  it("las rutas solo aceptan ids de 1 a 12 dígitos", async () => {
    mockParametros.id = "abc";
    await render(<PantallaMiTicket />);
    expect(screen.getByText("Este ticket no existe.")).toBeTruthy();
    mockParametros.id = "1234567890123";
    await render(<PantallaTicket />);
    expect(screen.getAllByText("Este ticket no existe.").length).toBeGreaterThan(0);
    expect(soporteService.miTicket).not.toHaveBeenCalled();
    expect(soporteService.ticket).not.toHaveBeenCalled();
    delete mockParametros.id;
  });

  it("uno que no es suyo dice que no está y ofrece volver", async () => {
    soporteService.miTicket.mockRejectedValue(error(404, "not_found", "No encontrado."));
    await render(<MiTicket id="99" />);
    expect(await screen.findByText(TEXTO_NO_DISPONIBLE)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Ver mis tickets" }));
    // US-016: vuelve al módulo de debajo, sin apilar otra copia.
    expect(mockRouter.dismissTo).toHaveBeenCalledWith({ pathname: "/soporte", params: { vista: "mis" } });
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

/** Con la forma de `TicketDetalleSerializer` + `registrar_horas`. */
function detalle(campos = {}) {
  return {
    id: 9,
    numero: "TCK-2026-9",
    estado: "asignado",
    estado_display: "Asignado",
    prioridad: "media",
    prioridad_display: "P3 · Media",
    prioridad_base: "media",
    tipo_display: "Incidente",
    canal_display: "Portal (formulario)",
    categoria: "Correo",
    caso: "No envía",
    codigo: "CO-01",
    agencia: "Matriz",
    area: "Cartera",
    nivel: "N1",
    tecnico: { id: 3, nombre: "Luis Mora" },
    solicitante_nombre: "Ana Pérez",
    solicitante_telefono: "0991234567",
    solicitante_correo: "ana@grupolaar.com",
    escalado_por_sla: false,
    sla: { estado: "en_plazo", vence: "2099-01-01T00:00:00Z", respuesta: { estado: "en_plazo", vence: "2099-01-01T00:00:00Z" } },
    created_at: "2026-11-13T09:00:00Z",
    descripcion: "No puedo enviar correos desde ayer",
    impacto: "bajo",
    impacto_display: "Bajo: un usuario",
    urgencia: "media",
    urgencia_display: "Media: degradada, con alternativa",
    registrado_por: "",
    respondido_en: null,
    cerrado_en: null,
    atendido_en: null,
    reaperturas: 0,
    encuesta: null,
    aprobaciones: [],
    datos_adicionales: [],
    adjuntos: [],
    mensajes: [
      { id: 1, texto: "Revisando el buzón", interno: true, del_solicitante: false, autor: "Luis Mora", fecha: "2026-11-13T10:00:00Z", adjuntos: [] },
      { id: 2, texto: "Gracias", interno: false, del_solicitante: true, autor: "Ana Pérez", fecha: "2026-11-13T10:05:00Z", adjuntos: [] },
    ],
    movimientos: [{ id: 1, descripcion: "Asignado a Luis Mora", nota: "", actor: "Sistema", created_at: "2026-11-13T09:01:00Z" }],
    permisos: {
      acciones: ["en_curso", "esperando_usuario", "atendido"],
      tomar: false,
      motivo_no_tomar: "",
      responder: true,
      escalar: true,
      asignar: false,
      prioridad: true,
    },
    registrar_horas: false,
    ...campos,
  };
}

/** H-01: lo que no es la acción principal está en «Más acciones». */
async function abrirMasAcciones() {
  await fireEvent.press(await screen.findByRole("button", { name: "Más acciones" }));
}

describe("la ficha del técnico (CA-10 a CA-15, CA-21)", () => {
  it("muestra el resumen con la acción principal; lo demás, en «Más acciones» (H-01)", async () => {
    soporteService.ticket.mockResolvedValue(detalle());
    await render(<TicketDetalle id="9" />);
    expect(await screen.findByRole("header", { name: "No envía" })).toBeTruthy();
    expect(mockNavegacion.setOptions).toHaveBeenLastCalledWith({ title: "TCK-2026-9" });
    expect(screen.getByText("Lo atiende Luis Mora: falta la primera respuesta al usuario.")).toBeTruthy();
    const acciones = within(screen.getByTestId("acciones"));
    expect(acciones.getByRole("button", { name: "Poner en curso" })).toBeTruthy();
    expect(acciones.getByRole("button", { name: "Responder" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Esperar al usuario (pausa el plazo)" })).toBeNull();
    await abrirMasAcciones();
    const otras = within(screen.getByTestId("otras-acciones"));
    expect(otras.getByRole("button", { name: "Esperar al usuario (pausa el plazo)" })).toBeTruthy();
    expect(otras.getByRole("button", { name: "Marcar como atendido" })).toBeTruthy();
    expect(otras.getByRole("button", { name: "Escalar al siguiente nivel" })).toBeTruthy();
    expect(otras.queryByRole("button", { name: "Cerrar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tomar este ticket" })).toBeNull();
    expect(otras.queryByRole("button", { name: "Asignar" })).toBeNull();
    // H-02: la solicitud va antes que la conversación.
    const orden = screen.getAllByTestId(/^(solicitud|conversacion|responder)$/).map((e) => e.props.testID);
    expect(orden).toEqual(["solicitud", "conversacion", "responder"]);
    // Datos e historial, plegados.
    expect(screen.getByRole("button", { name: "Datos: plazos, quién pide y clasificación", expanded: false })).toBeTruthy();
    expect(screen.queryByTestId("historial")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Historial" }));
    expect(screen.getByText("Asignado a Luis Mora")).toBeTruthy();
  });

  it("«Tomar este ticket» solo con `permisos.tomar`; si no, dice por qué", async () => {
    soporteService.ticket.mockResolvedValue(
      detalle({ estado: "nuevo", estado_display: "En cola", tecnico: null, permisos: { acciones: [], tomar: false, motivo_no_tomar: "Usted no atiende la categoría «Correo».", responder: false } }),
    );
    await render(<TicketDetalle id="9" />);
    expect(await screen.findByText("Usted no atiende la categoría «Correo».")).toBeTruthy();

    soporteService.ticket.mockResolvedValue(detalle({ estado: "nuevo", estado_display: "En cola", tecnico: null, permisos: { acciones: [], tomar: true, responder: false } }));
    soporteService.tomar.mockResolvedValue(detalle());
    await render(<TicketDetalle id="10" empresa="2" />);
    await fireEvent.press(await screen.findByRole("button", { name: "Tomar este ticket" }));
    expect(soporteService.tomar).toHaveBeenCalledWith(9, { empresa: "2" });
    expect(await screen.findByText("El ticket es suyo: ya puede trabajarlo.")).toBeTruthy();
  });

  it("H-02: quién pide, con «Llamar» y «Correo» en el resumen", async () => {
    soporteService.ticket.mockResolvedValue(detalle());
    await render(<TicketDetalle id="9" />);
    expect(await screen.findByText("Ana Pérez · Matriz")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Llamar a Ana Pérez: 0991234567" }));
    expect(Linking.openURL).toHaveBeenCalledWith("tel:0991234567");
    await fireEvent.press(screen.getByRole("button", { name: "Escribir un correo a Ana Pérez: ana@grupolaar.com" }));
    expect(Linking.openURL).toHaveBeenCalledWith("mailto:ana@grupolaar.com");
  });

  it("«Responder» del resumen lleva la pantalla y el foco a la caja (H-01)", async () => {
    const desplazar = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
    jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
    soporteService.ticket.mockResolvedValue(detalle());
    await render(<TicketDetalle id="9" />);
    await fireEvent(await screen.findByTestId("responder"), "layout", { nativeEvent: { layout: { y: 700, height: 300 } } });
    jest.useFakeTimers();
    await fireEvent.press(screen.getByTestId("ir-a-responder"));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(desplazar).toHaveBeenCalledWith({ y: 688, animated: true });
    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(expect.anything(), "focus");
    desplazar.mockRestore();
  });

  it("«Tomando…» mientras se toma, sin dejar tocar otra vez", async () => {
    let resolver;
    soporteService.ticket.mockResolvedValue(detalle({ estado: "nuevo", estado_display: "En cola", tecnico: null, permisos: { acciones: [], tomar: true, responder: false } }));
    soporteService.tomar.mockReturnValue(new Promise((r) => (resolver = r)));
    await render(<TicketDetalle id="9" />);
    await fireEvent.press(await screen.findByRole("button", { name: "Tomar este ticket" }));
    expect(screen.getByText("Tomando…")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("tomar-este"));
    expect(soporteService.tomar).toHaveBeenCalledTimes(1);
    await act(async () => resolver(detalle()));
  });

  it("«Esperar al usuario» exige la nota antes de enviar (CA-12)", async () => {
    soporteService.ticket.mockResolvedValue(detalle());
    soporteService.cambiarEstado.mockResolvedValue(detalle({ estado: "esperando_usuario", estado_display: "Esperando al usuario" }));
    await render(<TicketDetalle id="9" />);
    await abrirMasAcciones();
    await fireEvent.press(await screen.findByRole("button", { name: "Esperar al usuario (pausa el plazo)" }));
    expect(screen.getByRole("header", { name: "Esperar al usuario" })).toBeTruthy();
    await fireEvent.press(screen.getByTestId("dialogo-confirmar"));
    expect(soporteService.cambiarEstado).not.toHaveBeenCalled();
    expect(anunciados()).toContain("Escriba qué necesita del usuario: es lo que le llega.");

    await fireEvent.changeText(screen.getByTestId("dialogo-nota"), "¿Puede reiniciar Outlook?");
    await fireEvent.press(screen.getByTestId("dialogo-confirmar"));
    expect(soporteService.cambiarEstado).toHaveBeenCalledWith(9, "esperando_usuario", "¿Puede reiniciar Outlook?", {});
    expect(await screen.findByText(/^Estado actualizado/)).toBeTruthy();
    expect(screen.queryByTestId("dialogo")).toBeNull();
  });

  it("un error del servidor sale en la ventana, sin el nombre del campo (G-7), y no la cierra", async () => {
    soporteService.ticket.mockResolvedValue(detalle());
    soporteService.cambiarEstado.mockRejectedValue(
      error(400, "invalid", "Error en la solicitud.", { estado: ["Un ticket asignado no puede pasar a «cerrado»."] }),
    );
    await render(<TicketDetalle id="9" />);
    await abrirMasAcciones();
    await fireEvent.press(await screen.findByRole("button", { name: "Marcar como atendido" }));
    await fireEvent.press(screen.getByTestId("dialogo-confirmar"));
    expect(await screen.findByText("Un ticket asignado no puede pasar a «cerrado».")).toBeTruthy();
    expect(screen.queryByText(/^estado:/)).toBeNull();
    expect(screen.getByTestId("dialogo")).toBeTruthy();
  });

  it("G-1: un mensaje con `ErrorDetail(...)` se muestra limpio", async () => {
    soporteService.ticket.mockResolvedValue(detalle({ estado: "nuevo", estado_display: "En cola", tecnico: null, permisos: { acciones: [], tomar: true, responder: false } }));
    soporteService.tomar.mockRejectedValue(
      error(400, "invalid", "[ErrorDetail(string='Otra persona lo tomó mientras tanto.', code='invalid')]"),
    );
    await render(<TicketDetalle id="9" />);
    await fireEvent.press(await screen.findByRole("button", { name: "Tomar este ticket" }));
    expect(await screen.findByText("Otra persona lo tomó mientras tanto.")).toBeTruthy();
  });

  it("H-17: cerrar la ventana con una nota escrita pide confirmación", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, botones) => {
      botones.find((b) => b.text === "Seguir escribiendo").onPress();
    });
    soporteService.ticket.mockResolvedValue(detalle());
    await render(<TicketDetalle id="9" />);
    await abrirMasAcciones();
    await fireEvent.press(await screen.findByRole("button", { name: "Escalar al siguiente nivel" }));
    await fireEvent.press(screen.getByTestId("dialogo-cancelar"));
    // Sin nota se cierra sin preguntar.
    expect(alerta).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dialogo")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Escalar al siguiente nivel" }));
    await fireEvent.changeText(screen.getByTestId("dialogo-nota"), "Requiere N2");
    await fireEvent.press(screen.getByTestId("dialogo-cancelar"));
    expect(alerta).toHaveBeenCalledWith("¿Descartar lo que escribió?", expect.any(String), expect.any(Array), expect.any(Object));
    expect(screen.getByTestId("dialogo")).toBeTruthy();
    expect(screen.getByTestId("dialogo-nota").props.value).toBe("Requiere N2");
  });

  it("ajustar la prioridad pide justificación y dice en qué quedará (CA-13)", async () => {
    soporteService.ticket.mockResolvedValue(detalle());
    soporteService.cambiarPrioridad.mockResolvedValue(detalle({ prioridad: "alta", prioridad_display: "P2 · Alta" }));
    await render(<TicketDetalle id="9" />);
    await abrirMasAcciones();
    await fireEvent.press(await screen.findByRole("button", { name: "Ajustar prioridad" }));
    expect(screen.getByText("Cambie algo para poder guardarlo.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Medio: un área o un grupo" }));
    expect(screen.getByTestId("prioridad-quedara").props.children).toBe("Quedará en: P3 · Media (la misma de ahora).");
    await fireEvent.press(screen.getByRole("radio", { name: "Alta: la operación está detenida" }));
    expect(screen.getByTestId("prioridad-quedara").props.children).toBe("Quedará en: P2 · Alta (antes P3 · Media).");
    await fireEvent.press(screen.getByRole("button", { name: "Cambiar prioridad" }));
    expect(soporteService.cambiarPrioridad).not.toHaveBeenCalled();
    expect(anunciados()).toContain(TEXTO_JUSTIFICACION);
    await fireEvent.changeText(screen.getByTestId("prioridad-justificacion"), "Afecta a todo Cartera");
    await fireEvent.press(screen.getByRole("button", { name: "Cambiar prioridad" }));
    expect(soporteService.cambiarPrioridad).toHaveBeenCalledWith(
      9,
      { impacto: "medio", urgencia: "alta", justificacion: "Afecta a todo Cartera" },
      {},
    );
    expect(await screen.findByText("Prioridad actualizada; el plazo se recalculó.")).toBeTruthy();
    expect(screen.getByText("Prioridad: P2 · Alta")).toBeTruthy();
  });

  it("asigna a un técnico de la lista, con nota (CA-14)", async () => {
    soporteService.ticket.mockResolvedValue(detalle({ permisos: { ...detalle().permisos, asignar: true } }));
    soporteService.tecnicos.mockResolvedValue([
      { id: 4, nombre: "Carla Ruiz", nivel: "N2", abiertos: 0 },
      { id: 5, nombre: "Pedro Gil", nivel: "N1", abiertos: 3 },
    ]);
    soporteService.asignar.mockResolvedValue(detalle({ tecnico: { id: 4, nombre: "Carla Ruiz" } }));
    await render(<TicketDetalle id="9" />);
    await waitFor(() => expect(soporteService.tecnicos).toHaveBeenCalled());
    await abrirMasAcciones();
    await fireEvent.press(await screen.findByTestId("asignar-a"));
    expect(screen.getByRole("radio", { name: "Pedro Gil · N1 · 3 abiertos" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Carla Ruiz · N2 · sin tickets abiertos" }));
    await fireEvent.press(screen.getByRole("button", { name: "Asignar" }));
    expect(screen.getByRole("header", { name: "Asignar a Carla Ruiz" })).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("dialogo-nota"), "Es de correo");
    await fireEvent.press(screen.getByTestId("dialogo-confirmar"));
    expect(soporteService.asignar).toHaveBeenCalledWith(9, 4, "Es de correo", {});
    expect(await screen.findByText("Ticket asignado a Carla Ruiz.")).toBeTruthy();
  });

  it("si no carga la lista de técnicos, ofrece «Reintentar»", async () => {
    soporteService.ticket.mockResolvedValue(detalle({ permisos: { ...detalle().permisos, asignar: true } }));
    soporteService.tecnicos.mockRejectedValueOnce(error(500, "error", "Falló"));
    soporteService.tecnicos.mockResolvedValueOnce([{ id: 4, nombre: "Carla Ruiz", nivel: "N2", abiertos: 0 }]);
    await render(<TicketDetalle id="9" />);
    await abrirMasAcciones();
    await fireEvent.press(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByTestId("asignar-a")).toBeTruthy();
    expect(soporteService.tecnicos).toHaveBeenCalledTimes(2);
  });

  it("al escalar con `visible: false` vuelve a la bandeja y lo anuncia (CA-15)", async () => {
    soporteService.ticket.mockResolvedValue(detalle());
    soporteService.escalar.mockResolvedValue({ id: 9, numero: "TCK-2026-9", estado: "nuevo", visible: false });
    await render(<TicketDetalle id="9" />);
    await abrirMasAcciones();
    await fireEvent.press(await screen.findByRole("button", { name: "Escalar al siguiente nivel" }));
    await fireEvent.press(screen.getByTestId("dialogo-confirmar"));
    expect(soporteService.escalar).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId("dialogo-nota"), "Requiere acceso al servidor");
    await fireEvent.press(screen.getByTestId("dialogo-confirmar"));
    expect(soporteService.escalar).toHaveBeenCalledWith(9, "Requiere acceso al servidor", {});
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(anunciados()).toContain("Ticket TCK-2026-9 escalado; ya no está en su bandeja.");
    expect(tomarAviso()).toBe("Ticket TCK-2026-9 escalado; ya no está en su bandeja.");
  });

  it("nota interna frente a respuesta al usuario, cada una marcada en el hilo (CA-11)", async () => {
    soporteService.ticket.mockResolvedValue(detalle());
    soporteService.responder.mockResolvedValue(detalle());
    await render(<TicketDetalle id="9" />);
    expect(await screen.findByLabelText(/^Nota interna \(el usuario no la ve\), Luis Mora, /)).toBeTruthy();
    expect(screen.getByLabelText(/^Usuario, Ana Pérez, /)).toBeTruthy();
    // Por defecto, al usuario.
    expect(screen.getByRole("radio", { name: "Al usuario: la ve en su ticket", checked: true })).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("texto-respuesta"), "Ya lo revisé");
    await fireEvent.press(screen.getByTestId("enviar-respuesta"));
    expect(soporteService.responder).toHaveBeenCalledWith(9, { texto: "Ya lo revisé", interno: false }, [], {});
    expect(await screen.findByText("Respuesta enviada al usuario.")).toBeTruthy();

    await fireEvent.press(screen.getByRole("radio", { name: "Nota interna: el usuario no la ve" }));
    // H-09: dice que no le llega al usuario.
    expect(screen.getByText(TEXTO_SOLO_EQUIPO)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("texto-respuesta"), "Revisar el DNS");
    await fireEvent.press(screen.getByRole("button", { name: "Guardar nota interna" }));
    expect(soporteService.responder).toHaveBeenLastCalledWith(9, { texto: "Revisar el DNS", interno: true }, [], {});
    expect(await screen.findByText("Nota interna guardada.")).toBeTruthy();
  });

  it("«/» sugiere respuestas predefinidas y elegir una inserta su texto (CA-11)", async () => {
    soporteService.ticket.mockResolvedValue(detalle());
    soporteService.respuestas.mockResolvedValue([
      { id: 1, atajo: "reinicio", titulo: "Pedir reinicio", texto: "Hola {{nombre}}, reinicie el equipo." },
      { id: 2, atajo: "cierre", titulo: "Cierre", texto: "Listo." },
    ]);
    await render(<TicketDetalle id="9" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Respuestas predefinidas" })).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId("texto-respuesta"), "/rei");
    expect(screen.getByRole("button", { name: "/reinicio: Pedir reinicio" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "/cierre: Cierre" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "/reinicio: Pedir reinicio" }));
    expect(screen.getByTestId("texto-respuesta").props.value).toBe("Hola Ana Pérez, reinicie el equipo.");
    await fireEvent.changeText(screen.getByTestId("texto-respuesta"), "/zzz");
    expect(screen.getByText("Ninguna respuesta predefinida coincide con «/zzz».")).toBeTruthy();
  });

  it("el sondeo no borra lo que se escribe ni se lanza durante una acción", async () => {
    jest.useFakeTimers();
    soporteService.ticket.mockResolvedValue(detalle());
    await render(<TicketDetalle id="9" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    await fireEvent.changeText(screen.getByTestId("texto-respuesta"), "Borrador");
    soporteService.ticket.mockResolvedValue(
      detalle({ mensajes: [...detalle().mensajes, { id: 3, texto: "¿Novedades?", interno: false, del_solicitante: true, autor: "Ana Pérez", fecha: "2026-11-13T11:00:00Z", adjuntos: [] }] }),
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SONDEO_FICHAS_MS);
    });
    expect(soporteService.ticket).toHaveBeenLastCalledWith("9", { sondeo: true });
    expect(screen.getByText(/^Llegó un mensaje nuevo a la conversación/)).toBeTruthy();
    // T3: también se anuncia.
    expect(anunciados().some((t) => /^Llegó un mensaje nuevo/.test(t))).toBe(true);
    expect(screen.getByTestId("texto-respuesta").props.value).toBe("Borrador");

    // H-24: si falla, se dice y no se borra nada.
    soporteService.ticket.mockRejectedValue(errorDeRed());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SONDEO_FICHAS_MS);
    });
    expect(screen.getByText(TEXTO_REFRESCO_FALLIDO)).toBeTruthy();
    expect(screen.getByText("¿Novedades?")).toBeTruthy();

    // G-4: si se cierra con el borrador escrito, queda para copiarlo.
    soporteService.ticket.mockResolvedValue(detalle({ estado: "cerrado", estado_display: "Cerrado", permisos: { acciones: [], responder: false } }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SONDEO_FICHAS_MS);
    });
    expect(screen.queryByTestId("texto-respuesta")).toBeNull();
    expect(screen.getByText(TEXTO_BORRADOR_SIN_ENVIAR)).toBeTruthy();
    expect(screen.getByText("Borrador").props.selectable).toBe(true);
  });

  it("G-3: si el sondeo ya no lo encuentra (404 o `visible: false`), lo dice con «Volver a la bandeja»", async () => {
    jest.useFakeTimers();
    soporteService.ticket.mockResolvedValue(detalle());
    await render(<TicketDetalle id="9" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    soporteService.ticket.mockRejectedValue(error(404, "not_found", "No encontrado."));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SONDEO_FICHAS_MS);
    });
    expect(screen.getByText(TEXTO_NO_DISPONIBLE_EQUIPO)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Volver a la bandeja" }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("fuera de su horario, pide registrar las horas en el navegador (CA-21)", async () => {
    soporteService.ticket.mockResolvedValue(detalle({ registrar_horas: true }));
    await render(<TicketDetalle id="9" />);
    expect(await screen.findByText(TEXTO_FUERA_DE_HORARIO)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Registrar las horas en el navegador" })).toBeTruthy();
  });

  it("N-01: lo del equipo, a la derecha en su ficha; lo de «Usted», a la derecha en la de quien pide", async () => {
    soporteService.ticket.mockResolvedValue(
      detalle({
        mensajes: [
          ...detalle().mensajes,
          { id: 3, texto: "Lo reviso", interno: false, del_solicitante: false, autor: "Luis Mora", fecha: "2026-11-13T10:10:00Z", adjuntos: [] },
        ],
      }),
    );
    await render(<TicketDetalle id="9" />);
    const lado = (id) => StyleSheet.flatten(screen.getByTestId(`mensaje-${id}`).props.style);
    expect((await screen.findByTestId("mensaje-3")) && lado(3).marginLeft).toBe(24);
    expect(lado(2).marginRight).toBe(24);
    expect(lado(1).marginLeft).toBeUndefined();
    expect(lado(1).marginRight).toBeUndefined();

    soporteService.miTicket.mockResolvedValue(
      seguimiento({ mensajes: [...seguimiento().mensajes, { id: 4, texto: "Sigue", del_solicitante: true, autor: "Usted", fecha: "2026-11-13T11:00:00Z", adjuntos: [] }] }),
    );
    await render(<MiTicket id="7" />);
    await screen.findByTestId("mensaje-4");
    expect(lado(4).marginLeft).toBe(24);
    expect(lado(1).marginRight).toBe(24);
  });

  it("N-03: «Atiende» no se repite si lo que toca ya lo dice", async () => {
    soporteService.ticket.mockResolvedValue(detalle());
    await render(<TicketDetalle id="9" />);
    expect(await screen.findByText("Lo atiende Luis Mora: falta la primera respuesta al usuario.")).toBeTruthy();
    expect(screen.queryByTestId("atiende")).toBeNull();
    soporteService.ticket.mockResolvedValue(detalle({ estado: "esperando_usuario", estado_display: "Esperando al usuario" }));
    await render(<TicketDetalle id="10" />);
    await waitFor(() => expect(screen.getAllByTestId("atiende").length).toBeGreaterThan(0));
  });

  it("N-04: «Cerrar» va en la variante de peligro", async () => {
    soporteService.ticket.mockResolvedValue(
      detalle({ estado: "atendido", estado_display: "Atendido", permisos: { ...detalle().permisos, acciones: ["en_curso", "cerrado"] } }),
    );
    await render(<TicketDetalle id="9" />);
    await fireEvent.press(await screen.findByRole("button", { name: "Más acciones" }));
    const cerrar = screen.getByTestId("accion-cerrado");
    expect(StyleSheet.flatten(cerrar.props.style).backgroundColor).toBe(colores.malFondo);
    expect(StyleSheet.flatten(cerrar.props.style).borderColor).toBe(colores.malTexto);
  });

  it("N-07: si el teléfono no puede llamar, lo dice con el número", async () => {
    Linking.openURL.mockRejectedValueOnce(new Error("sin app"));
    soporteService.ticket.mockResolvedValue(detalle());
    await render(<TicketDetalle id="9" />);
    await fireEvent.press(await screen.findByTestId("llamar-solicitante"));
    expect(await screen.findByText(`${TEXTO_SIN_LLAMADA} 0991234567`)).toBeTruthy();
  });

  it("N-08 y N-09: las sugerencias se anuncian tras la pausa; «Responder» abre el teclado", async () => {
    const enfocar = jest.spyOn(TextInput.prototype, "focus").mockImplementation(() => {});
    soporteService.ticket.mockResolvedValue(detalle());
    soporteService.respuestas.mockResolvedValue([{ id: 1, atajo: "reinicio", titulo: "Pedir reinicio", texto: "Reinicie." }]);
    await render(<TicketDetalle id="9" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Respuestas predefinidas" })).toBeTruthy());
    await fireEvent.press(screen.getByTestId("ir-a-responder"));
    expect(enfocar).toHaveBeenCalled();
    jest.useFakeTimers();
    await fireEvent.changeText(screen.getByTestId("texto-respuesta"), "/r");
    await fireEvent.changeText(screen.getByTestId("texto-respuesta"), "/re");
    expect(anunciados()).not.toContain("1 respuesta sugerida.");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ESPERA_ANUNCIO_RESPUESTAS_MS);
    });
    expect(anunciados().filter((t) => t === "1 respuesta sugerida.")).toHaveLength(1);
    enfocar.mockRestore();
  });

  it("N-11: el fallo del sondeo se anuncia una vez, no en cada intento (las dos fichas)", async () => {
    jest.useFakeTimers();
    soporteService.ticket.mockResolvedValue(detalle());
    await render(<TicketDetalle id="9" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    soporteService.ticket.mockRejectedValue(errorDeRed());
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(SONDEO_FICHAS_MS);
      });
    }
    expect(anunciados().filter((t) => t === TEXTO_REFRESCO_FALLIDO)).toHaveLength(1);

    soporteService.miTicket.mockResolvedValue(seguimiento());
    await render(<MiTicket id="7" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    soporteService.miTicket.mockRejectedValue(errorDeRed());
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(SONDEO_FICHAS_MS);
      });
    }
    expect(anunciados().filter((t) => t === TEXTO_REFRESCO_FALLIDO)).toHaveLength(2);
  });

  it("QA-TECH (d): el error de una carga ya vieja no tapa la nueva", async () => {
    let rechazar;
    soporteService.ticket.mockReturnValueOnce(new Promise((_, r) => (rechazar = r)));
    soporteService.ticket.mockResolvedValueOnce(detalle());
    const { rerender } = await render(<TicketDetalle id="9" />);
    mockSesion.versionEmpresa = 1;
    await rerender(<TicketDetalle id="9" />);
    expect(await screen.findByRole("header", { name: "No envía" })).toBeTruthy();
    await act(async () => rechazar(error(500, "error", "Falló la primera")));
    expect(screen.queryByText("Falló la primera")).toBeNull();
    expect(screen.getByRole("header", { name: "No envía" })).toBeTruthy();
    mockSesion.versionEmpresa = 0;
  });

  it("con el ticket cerrado no se responde", async () => {
    soporteService.ticket.mockResolvedValue(
      detalle({ estado: "cerrado", estado_display: "Cerrado", cerrado_en: "2026-11-13T12:00:00Z", permisos: { acciones: [], responder: true } }),
    );
    await render(<TicketDetalle id="9" />);
    expect(await screen.findByText(/ya no se puede responder/)).toBeTruthy();
    expect(screen.queryByTestId("texto-respuesta")).toBeNull();
  });
});
