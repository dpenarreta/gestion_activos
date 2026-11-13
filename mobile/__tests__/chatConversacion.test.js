import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import { AccessibilityInfo, AppState } from "react-native";

import { chatService, notificacionesService } from "../src/api/servicios";
import {
  abrirArchivoDelChat,
  descargarArchivoDelChat,
  elegirArchivoParaElChat,
  elegirImagenParaElChat,
  TEXTO_ARCHIVO_GRANDE,
} from "../src/chat/adjunto";
import {
  COMPORTAMIENTOS,
  comportamientoDelAviso,
  conversacionAbierta,
  olvidarConversaciones,
} from "../src/chat/avisoEnPrimerPlano";
import {
  Conversacion,
  REFRESCO_LECTURAS_MS,
  TEXTO_NO_ENCONTRADA,
  TEXTO_SIN_MENSAJES,
} from "../src/pantallas/chat/Conversacion";

/**
 * La pantalla de una conversación (US-011: CA-2, CA-3, CA-6, CA-7, CA-9,
 * CA-11, CA-13 y CA-14). El `ChatProvider` se reemplaza por un doble: aquí se
 * prueba la pantalla; la consulta periódica está en `chatContexto.test.js`.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockNavegacion = { setOptions: jest.fn() };
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    useNavigation: () => mockNavegacion,
    useFocusEffect: (efecto) => React.useEffect(efecto, [efecto]),
  };
});

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const mockSesion = { versionEmpresa: 0, empresaActiva: { id: 1 } };
jest.mock("../src/sesion/SesionContext", () => ({
  useSesion: () => mockSesion,
}));

const mockContador = { noLeidas: 0, recargar: jest.fn() };
jest.mock("../src/notificaciones/ContadorContext", () => ({
  useContador: () => mockContador,
}));

/** El doble del `ChatProvider`: guarda a quién reparte las novedades. */
const mockOyentes = new Map();
const mockChat = {
  conversaciones: [],
  noLeidos: {},
  marcarLeida: jest.fn(),
  escucharMensajes: jest.fn(),
};
jest.mock("../src/chat/ChatContext", () => ({
  useChat: () => mockChat,
  useChatVisible: () => {},
}));

jest.mock("../src/api/servicios", () => ({
  chatService: {
    mensajes: jest.fn(),
    conversacion: jest.fn(),
    enviar: jest.fn(),
    leer: jest.fn(),
    lecturas: jest.fn(),
    presencia: jest.fn(),
  },
  notificacionesService: { detalle: jest.fn() },
}));

jest.mock("../src/chat/adjunto", () => ({
  ...jest.requireActual("../src/chat/adjunto"),
  descargarArchivoDelChat: jest.fn(),
  abrirArchivoDelChat: jest.fn(),
  tomarFotoParaElChat: jest.fn(),
  elegirImagenParaElChat: jest.fn(),
  elegirArchivoParaElChat: jest.fn(),
}));

const CARLA = { id: 9, nombre: "Carla Ruiz", correo: "carla@grupolaar.com", area: "Cartera", cargo: "Analista" };

/** Con la forma real de `views.resumen`. */
const DIRECTA = {
  id: 5,
  tipo: "directa",
  nombre: "Carla Ruiz",
  otro: CARLA,
  departamento: null,
  miembros: 2,
  administra: false,
  no_leidos: 0,
  ultimo: null,
};
const GRUPO = {
  id: 7,
  tipo: "grupo",
  nombre: "Equipo TI",
  otro: null,
  departamento: null,
  miembros: 3,
  administra: true,
  no_leidos: 0,
  ultimo: null,
};

const HOY = new Date();
HOY.setHours(10, 5, 0, 0);

/** Con la forma real de `serializers.mensaje_dict`. */
function mensaje(id, cambios = {}) {
  return {
    id,
    conversacion: 5,
    autor: { id: 9, nombre: "Carla Ruiz" },
    propio: false,
    texto: `Mensaje ${id}`,
    archivo: null,
    fecha: HOY.toISOString(),
    ...cambios,
  };
}

function propio(id, cambios = {}) {
  return mensaje(id, { autor: { id: 1, nombre: "Ana Pérez" }, propio: true, ...cambios });
}

function pagina(mensajes, cambios = {}) {
  return { mensajes, hay_mas: false, ultimo_leido: 0, lecturas: [], ...cambios };
}

function pendiente() {
  let resolver;
  let rechazar;
  const promesa = new Promise((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

function errorDeRed() {
  const error = new Error("red");
  error.esDeRed = true;
  return error;
}

function error400(code, message, details) {
  const error = new Error(message);
  error.response = { status: 400, data: { error: { code, message, details } } };
  return error;
}

function errorConEstado(status) {
  const error = new Error(`HTTP ${status}`);
  error.response = { status, data: { error: { code: "not_found", message: "No encontrado.", details: null } } };
  return error;
}

/**
 * El manejador `nombre` del componente que pinta `elemento` (p. ej. el
 * `onPress` del `Pressable`), para llamarlo dos veces dentro del mismo
 * `act`, como dos toques antes de que React vuelva a pintar.
 *
 * Usa `unstable_fiber` porque no hay una vía pública que lo permita (ronda 2
 * de QA): el `Pressable` no expone `onPress` en el elemento anfitrión (que
 * solo tiene los `onResponder…`), y `fireEvent.press` abre su propio `act`.
 * Dos `fireEvent` sin `await` superponen dos `act` (React lo avisa en la
 * consola), y con `await` React ya pinta entre un toque y otro, que es
 * justo lo que no se quiere probar. Aquí se prueba el candado síncrono.
 */
function manejadorDe(elemento, nombre) {
  for (let fibra = elemento.unstable_fiber; fibra; fibra = fibra.return) {
    if (typeof fibra.memoizedProps?.[nombre] === "function") return fibra.memoizedProps[nombre];
  }
  throw new Error(`Sin ${nombre}`);
}

/** Toques sin esperar lo que devuelve el manejador (una promesa que se deja
 * pendiente a propósito), dentro de un solo `act`. */
async function tocarSinEsperar(...elementos) {
  const manejadores = elementos.map((e) => manejadorDe(e, "onPress"));
  await act(async () => {
    for (const alTocar of manejadores) alTocar();
  });
}

/** Lo último que la pantalla pidió para su cabecera. */
function opcionesDeCabecera() {
  return mockNavegacion.setOptions.mock.calls.at(-1)?.[0] ?? {};
}

/** Que cada elemento muestre su texto, en ese orden. */
function enOrden(elementos, textos) {
  expect(elementos).toHaveLength(textos.length);
  textos.forEach((texto, i) => expect(elementos[i]).toHaveTextContent(texto, { exact: true }));
}

function error500() {
  const error = new Error("HTTP 500");
  error.response = { status: 500, data: { error: { code: "error", message: "Error del servidor.", details: null } } };
  return error;
}

/** Pinta lo último que la pantalla puso en `headerRight` (la cabecera de la
 * pila no existe en las pruebas). */
async function renderCabeceraDerecha() {
  const opciones = mockNavegacion.setOptions.mock.calls.at(-1)[0];
  await render(opciones.headerRight());
}

/** Lo que la consulta periódica reparte a la conversación abierta. */
async function llegan(id, mensajes) {
  await act(async () => {
    for (const oyente of mockOyentes.get(String(id)) ?? []) oyente(mensajes);
  });
}

let anuncios;

beforeEach(() => {
  jest.clearAllMocks();
  olvidarConversaciones();
  mockOyentes.clear();
  mockSesion.versionEmpresa = 0;
  mockChat.conversaciones = [DIRECTA, GRUPO];
  mockChat.noLeidos = {};
  mockChat.escucharMensajes.mockImplementation((id, oyente) => {
    const clave = String(id);
    if (!mockOyentes.has(clave)) mockOyentes.set(clave, new Set());
    mockOyentes.get(clave).add(oyente);
    return () => mockOyentes.get(clave)?.delete(oyente);
  });
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: jest.fn() }));
  anuncios = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  chatService.mensajes.mockResolvedValue(pagina([mensaje(10), propio(11)]));
  chatService.conversacion.mockResolvedValue({ ...DIRECTA, participantes: [] });
  chatService.enviar.mockImplementation(async (_id, texto) => ({ ...propio(60, { texto }), avisos: [] }));
  chatService.leer.mockResolvedValue({ ultimo_leido: 11 });
  chatService.lecturas.mockResolvedValue([]);
  chatService.presencia.mockResolvedValue({ 9: { en_linea: true, ultima_conexion: null, estado: null } });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function textosAnunciados() {
  return anuncios.mock.calls.map(([texto]) => texto);
}

describe("leer una conversación (CA-2)", () => {
  it("mientras carga lo dice; luego muestra los mensajes con autor y hora, del más antiguo al más nuevo", async () => {
    const espera = pendiente();
    chatService.mensajes.mockReturnValueOnce(espera.promesa);
    await render(<Conversacion id="5" />);
    expect(screen.getByText("Cargando la conversación…")).toBeTruthy();

    await act(async () => espera.resolver(pagina([mensaje(10), propio(11)])));
    expect(chatService.mensajes).toHaveBeenCalledWith("5", {});
    expect(screen.getByText("Mensaje 10")).toBeTruthy();
    expect(screen.getByText("Mensaje 11")).toBeTruthy();
    expect(screen.getByTestId("mensaje-10").props.accessibilityLabel).toBe("Carla Ruiz, 10:05. Mensaje 10");
    expect(screen.getByTestId("mensaje-11").props.accessibilityLabel).toMatch(/^Usted, 10:05\. Mensaje 11/);
    // La lista va invertida: el primer elemento (el de abajo) es el más nuevo,
    // así que en pantalla se leen del más antiguo al más nuevo.
    expect(screen.getAllByTestId(/^mensaje-\d+$/).map((e) => e.props.testID)).toEqual(["mensaje-11", "mensaje-10"]);
    expect(opcionesDeCabecera().title).toBe("Carla Ruiz");
  });

  it("al abrirla la marca leída hasta el último mensaje y apaga la campana", async () => {
    mockChat.noLeidos = { 5: 1 };
    await render(<Conversacion id="5" />);
    await waitFor(() => expect(chatService.leer).toHaveBeenCalledWith("5", 11, {}));
    expect(mockChat.marcarLeida).toHaveBeenCalledWith("5");
    await waitFor(() => expect(mockContador.recargar).toHaveBeenCalled());
  });

  it("sin mensajes invita a escribir el primero", async () => {
    chatService.mensajes.mockResolvedValueOnce(pagina([]));
    await render(<Conversacion id="5" />);
    expect(await screen.findByText(TEXTO_SIN_MENSAJES)).toBeTruthy();
  });

  it("al subir carga los anteriores con «?antes=» y no repite ninguno", async () => {
    chatService.mensajes
      .mockResolvedValueOnce(pagina([mensaje(50), mensaje(51)], { hay_mas: true }))
      .mockResolvedValueOnce(pagina([mensaje(48), mensaje(49), mensaje(50)], { hay_mas: false }));
    await render(<Conversacion id="5" />);
    await fireEvent(await screen.findByTestId("mensajes"), "endReached");

    expect(chatService.mensajes).toHaveBeenLastCalledWith("5", { antes: 50 });
    expect(await screen.findByText("Mensaje 48")).toBeTruthy();
    expect(screen.getAllByText("Mensaje 50")).toHaveLength(1);
    // Ya no hay más: ni el botón ni otra petición.
    expect(screen.queryByTestId("ver-anteriores")).toBeNull();
    await fireEvent(screen.getByTestId("mensajes"), "endReached");
    expect(chatService.mensajes).toHaveBeenCalledTimes(2);
  });

  it("«Ver mensajes anteriores» hace lo mismo y, si falla, ofrece «Reintentar»", async () => {
    chatService.mensajes
      .mockResolvedValueOnce(pagina([mensaje(50)], { hay_mas: true }))
      .mockRejectedValueOnce(errorDeRed())
      .mockResolvedValueOnce(pagina([mensaje(49)], { hay_mas: false }));
    await render(<Conversacion id="5" />);
    await fireEvent.press(await screen.findByTestId("ver-anteriores"));
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeTruthy();
    // Lo ya cargado no se pierde.
    expect(screen.getByText("Mensaje 50")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Mensaje 49")).toBeTruthy();
    expect(chatService.mensajes).toHaveBeenLastCalledWith("5", { antes: 50 });
  });

  it("si falla la carga ofrece «Reintentar» (CA-14)", async () => {
    chatService.mensajes.mockRejectedValueOnce(errorDeRed());
    await render(<Conversacion id="5" />);
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Mensaje 10")).toBeTruthy();
  });

  it.each([403, 404])("con %i explica que no existe o es de otra empresa y ofrece «Volver»", async (status) => {
    chatService.mensajes.mockRejectedValueOnce(errorConEstado(status));
    await render(<Conversacion id="5" />);
    expect(await screen.findByText(TEXTO_NO_ENCONTRADA)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Volver" }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("si no está en la lista (otra empresa o recién creada) pide sus datos", async () => {
    mockChat.conversaciones = [];
    await render(<Conversacion id="5" />);
    await waitFor(() => expect(chatService.conversacion).toHaveBeenCalledWith("5", {}));
    await waitFor(() => expect(opcionesDeCabecera().title).toBe("Carla Ruiz"));
  });

  it("abierta desde un push de otra empresa, la manda como X-Empresa en cada petición (CA-12, CA-13)", async () => {
    mockChat.noLeidos = { 5: 1 };
    await render(<Conversacion id="5" empresa="2" />);
    await waitFor(() => expect(chatService.leer).toHaveBeenCalledWith("5", 11, { empresa: "2" }));
    expect(chatService.mensajes).toHaveBeenCalledWith("5", { empresa: "2" });

    await fireEvent.changeText(screen.getByTestId("escribir"), "Hola");
    await fireEvent.press(screen.getByTestId("enviar"));
    expect(chatService.enviar).toHaveBeenCalledWith("5", "Hola", null, { empresa: "2" });
  });

  it("al cambiar de empresa vuelve a cargar (CA-13)", async () => {
    const { rerender } = await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 10");
    mockSesion.versionEmpresa = 1;
    await rerender(<Conversacion id="5" />);
    await waitFor(() => expect(chatService.mensajes).toHaveBeenCalledTimes(2));
  });
});

describe("mensajes nuevos en vivo (CA-4, CA-14)", () => {
  it("lo que llega se agrega sin repetir, se anuncia al lector y se marca leído", async () => {
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    chatService.leer.mockClear();

    await llegan(5, [mensaje(11), mensaje(12, { texto: "¿Tiene un momento?" })]);
    expect(screen.getByText("¿Tiene un momento?")).toBeTruthy();
    expect(screen.getAllByText("Mensaje 11")).toHaveLength(1);
    expect(textosAnunciados()).toContain("Mensaje de Carla Ruiz: ¿Tiene un momento?");
    await waitFor(() => expect(chatService.leer).toHaveBeenCalledWith("5", 12, {}));
    expect(chatService.lecturas).toHaveBeenCalled();
  });

  it("un archivo recibido se anuncia con su nombre; muchos juntos, cuántos", async () => {
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    await llegan(5, [
      mensaje(20, { texto: "", archivo: { nombre: "acta.pdf", tamano: 2048, es_imagen: false, url: "/chat/archivos/20/" } }),
    ]);
    expect(textosAnunciados()).toContain("Mensaje de Carla Ruiz: envió el archivo acta.pdf");

    await llegan(5, [mensaje(21), mensaje(22), mensaje(23), mensaje(24)]);
    expect(textosAnunciados()).toContain("4 mensajes nuevos en Carla Ruiz.");
  });

  it("lo propio que llega (enviado desde la web) no se anuncia", async () => {
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    anuncios.mockClear();
    await llegan(5, [propio(30, { texto: "Desde la web" })]);
    expect(screen.getByText("Desde la web")).toBeTruthy();
    expect(anuncios).not.toHaveBeenCalled();
  });

  it("al salir deja de escuchar", async () => {
    const { unmount } = await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    expect(mockOyentes.get("5").size).toBe(1);
    await unmount();
    expect(mockOyentes.get("5").size).toBe(0);
  });
});

describe("escribir (CA-3)", () => {
  it("envía el texto, lo muestra y vacía el campo", async () => {
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    expect(screen.getByTestId("enviar").props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.changeText(screen.getByTestId("escribir"), "  Hola, Carla  ");
    await fireEvent.press(screen.getByTestId("enviar"));
    expect(chatService.enviar).toHaveBeenCalledWith("5", "Hola, Carla", null, {});
    expect(await screen.findByText("Hola, Carla")).toBeTruthy();
    expect(screen.getByTestId("mensaje-60")).toBeTruthy();
    expect(screen.getByTestId("escribir").props.value).toBe("");
  });

  it("dos toques seguidos envían una sola vez; mientras tanto se ve «Enviando…»", async () => {
    const espera = pendiente();
    chatService.enviar.mockReturnValueOnce(espera.promesa);
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    await fireEvent.changeText(screen.getByTestId("escribir"), "Hola");
    const alTocar = manejadorDe(screen.getByTestId("enviar"), "onPress");
    // Los dos toques antes de que React vuelva a pintar: el candado síncrono.
    await act(async () => {
      alTocar();
      alTocar();
    });
    expect(chatService.enviar).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Enviando…")).toBeTruthy();
    expect(screen.getByTestId("enviar").props.accessibilityState).toMatchObject({ disabled: true, busy: true });

    // Lo que se escribe mientras tanto tampoco sale hasta que termine.
    await fireEvent.changeText(screen.getByTestId("escribir"), "Otro");
    await fireEvent.press(screen.getByTestId("enviar"));
    expect(chatService.enviar).toHaveBeenCalledTimes(1);

    await act(async () => espera.resolver({ ...propio(60, { texto: "Hola" }), avisos: [] }));
    expect(screen.queryByLabelText("Enviando…")).toBeNull();
    expect(screen.getByTestId("mensaje-60")).toBeTruthy();
  });

  it("si el servidor lo rechaza queda «No se envió · Reintentar» sin perder el texto, y al reintentar se envía", async () => {
    chatService.enviar.mockRejectedValueOnce(error500());
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    await fireEvent.changeText(screen.getByTestId("escribir"), "Importante");
    await fireEvent.press(screen.getByTestId("enviar"));

    expect(await screen.findByText(/^No se envió · /)).toBeTruthy();
    expect(screen.getByText("Importante")).toBeTruthy();
    expect(textosAnunciados().some((t) => t.startsWith("No se envió."))).toBe(true);

    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(chatService.enviar).toHaveBeenCalledTimes(2);
    expect(chatService.enviar).toHaveBeenLastCalledWith("5", "Importante", null, {});
    expect(await screen.findByTestId("mensaje-60")).toBeTruthy();
    expect(screen.queryByText(/No se envió/)).toBeNull();
  });

  it("un mensaje que no se envió se puede descartar", async () => {
    chatService.enviar.mockRejectedValueOnce(error500());
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    await fireEvent.changeText(screen.getByTestId("escribir"), "Borrador");
    await fireEvent.press(screen.getByTestId("enviar"));
    await screen.findByText(/No se envió/);

    await fireEvent.press(screen.getByRole("button", { name: "Descartar este mensaje" }));
    expect(screen.queryByText("Borrador")).toBeNull();
    expect(textosAnunciados()).toContain("Mensaje descartado.");
  });

  it("muestra el error del campo que da el servidor", async () => {
    chatService.enviar.mockRejectedValueOnce(
      error400("invalid", "Error en la solicitud.", { texto: ["Escriba un mensaje o adjunte un archivo."] }),
    );
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    await fireEvent.changeText(screen.getByTestId("escribir"), "x");
    await fireEvent.press(screen.getByTestId("enviar"));
    expect(await screen.findByText("No se envió · Escriba un mensaje o adjunte un archivo.")).toBeTruthy();
  });

  it("en un grupo, al enviar avisa quién no está (los «avisos» del servidor)", async () => {
    chatService.mensajes.mockResolvedValueOnce(pagina([], { lecturas: [] }));
    chatService.enviar.mockResolvedValueOnce({
      ...propio(70, { conversacion: 7, texto: "Reunión a las 3" }),
      avisos: [
        {
          usuario: 12,
          nombre: "Luis Mora",
          clave: "almuerzo",
          texto: "En almuerzo",
          detalle: "En almuerzo hasta las 13:30",
          mensaje: "",
          desde: null,
          hasta: null,
          reemplazo: null,
        },
      ],
    });
    await render(<Conversacion id="7" />);
    await screen.findByText(TEXTO_SIN_MENSAJES);
    await fireEvent.changeText(screen.getByTestId("escribir"), "Reunión a las 3");
    await fireEvent.press(screen.getByTestId("enviar"));
    expect(
      await screen.findByText("Luis Mora está en almuerzo hasta las 13:30: verá su mensaje al volver."),
    ).toBeTruthy();
  });
});

describe("adjuntos (CA-7)", () => {
  const PDF = { uri: "file:///cache/DocumentPicker/acta.pdf", name: "acta.pdf", type: "application/pdf", size: 2048 };

  it("se elige un archivo y se envía en multipart, aunque no haya texto", async () => {
    elegirArchivoParaElChat.mockResolvedValueOnce({ archivo: PDF });
    chatService.enviar.mockResolvedValueOnce({
      ...propio(61, { texto: "", archivo: { nombre: "acta.pdf", tamano: 2048, es_imagen: false, url: "/chat/archivos/61/" } }),
      avisos: [],
    });
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    await fireEvent.press(screen.getByTestId("adjuntar"));
    expect(screen.getByTestId("opciones-adjunto")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("adjuntar-archivo"));

    expect(await screen.findByTestId("adjunto-elegido")).toBeTruthy();
    expect(screen.getByText("acta.pdf · 2 KB")).toBeTruthy();
    expect(textosAnunciados()).toContain("Archivo listo para enviar: acta.pdf.");

    await fireEvent.press(screen.getByTestId("enviar"));
    expect(chatService.enviar).toHaveBeenCalledWith("5", "", PDF, {});
    expect(await screen.findByTestId("mensaje-61")).toBeTruthy();
    expect(screen.queryByTestId("adjunto-elegido")).toBeNull();
  });

  it("el archivo elegido se puede quitar antes de enviar", async () => {
    elegirImagenParaElChat.mockResolvedValueOnce({
      archivo: { uri: "file:///cache/ImagePicker/foto.jpg", name: "foto.jpg", type: "image/jpeg", size: 1000 },
    });
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    await fireEvent.press(screen.getByTestId("adjuntar"));
    await fireEvent.press(screen.getByTestId("adjuntar-galeria"));
    await screen.findByTestId("adjunto-elegido");
    await fireEvent.press(screen.getByLabelText("Quitar el archivo foto.jpg"));
    expect(screen.queryByTestId("adjunto-elegido")).toBeNull();
    expect(textosAnunciados()).toContain("Archivo quitado.");
  });

  it("uno de más de 10 MB se avisa antes de enviar y, en un directo, ofrece escribirle por correo", async () => {
    elegirArchivoParaElChat.mockResolvedValueOnce({ error: TEXTO_ARCHIVO_GRANDE });
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    await fireEvent.press(screen.getByTestId("adjuntar"));
    await fireEvent.press(screen.getByTestId("adjuntar-archivo"));

    expect(await screen.findByText(TEXTO_ARCHIVO_GRANDE)).toBeTruthy();
    expect(screen.queryByTestId("adjunto-elegido")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Escribir a carla@grupolaar.com" }));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/^mailto:carla@grupolaar\.com\?subject=/));
    expect(chatService.enviar).not.toHaveBeenCalled();
  });

  it("si el servidor lo rechaza por grande («archivo_grande»), ofrece enviarlo por correo a quienes lo recibirían", async () => {
    elegirArchivoParaElChat.mockResolvedValueOnce({ archivo: PDF });
    chatService.enviar.mockRejectedValueOnce(
      error400("archivo_grande", "Error en la solicitud.", {
        archivo: ["El archivo pesa 12 MB y el máximo es 10 MB. Envíelo por correo."],
        correos: ["carla@grupolaar.com"],
        limite_mb: 10,
      }),
    );
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    await fireEvent.press(screen.getByTestId("adjuntar"));
    await fireEvent.press(screen.getByTestId("adjuntar-archivo"));
    await screen.findByTestId("adjunto-elegido");
    await fireEvent.press(screen.getByTestId("enviar"));

    expect(await screen.findByText(`No se envió · ${TEXTO_ARCHIVO_GRANDE}`)).toBeTruthy();
    // El archivo sigue en el mensaje pendiente, para reintentar o mandarlo por correo.
    expect(screen.getByText("acta.pdf")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Enviar por correo" }));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/^mailto:carla@grupolaar\.com/));
  });

  it("una imagen recibida se ve dentro de la app y se borra al cerrar el visor", async () => {
    const archivo = { uri: "file:///cache/chat-archivos/mensaje-10.jpg", exists: true, delete: jest.fn() };
    descargarArchivoDelChat.mockResolvedValueOnce(archivo);
    const conImagen = mensaje(10, {
      texto: "",
      archivo: { nombre: "foto.jpg", tamano: 1000, es_imagen: true, url: "/chat/archivos/10/" },
    });
    chatService.mensajes.mockResolvedValueOnce(pagina([conImagen]));
    await render(<Conversacion id="5" />);
    await fireEvent.press(await screen.findByTestId("mensaje-10"));

    expect(descargarArchivoDelChat).toHaveBeenCalledWith(conImagen, {});
    expect(await screen.findByTestId("imagen-del-chat")).toBeTruthy();
    expect(abrirArchivoDelChat).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("cerrar-imagen"));
    expect(archivo.delete).toHaveBeenCalled();
    expect(screen.queryByTestId("imagen-del-chat")).toBeNull();
  });

  it("otro archivo se abre con el sistema y se borra al salir de la conversación", async () => {
    const archivo = { uri: "file:///cache/chat-archivos/mensaje-10.pdf", exists: true, delete: jest.fn() };
    descargarArchivoDelChat.mockResolvedValueOnce(archivo);
    abrirArchivoDelChat.mockResolvedValueOnce(undefined);
    chatService.mensajes.mockResolvedValueOnce(
      pagina([mensaje(10, { texto: "", archivo: { nombre: "acta.pdf", tamano: 2048, es_imagen: false, url: "/chat/archivos/10/" } })]),
    );
    const { unmount } = await render(<Conversacion id="5" />);
    await fireEvent.press(await screen.findByTestId("mensaje-10"));
    expect(abrirArchivoDelChat).toHaveBeenCalledWith(archivo, "acta.pdf");
    expect(archivo.delete).not.toHaveBeenCalled();
    await unmount();
    expect(archivo.delete).toHaveBeenCalled();
  });

  it("si no se puede descargar, lo dice", async () => {
    descargarArchivoDelChat.mockRejectedValueOnce(new Error("El archivo ya no está disponible."));
    chatService.mensajes.mockResolvedValueOnce(
      pagina([mensaje(10, { texto: "", archivo: { nombre: "acta.pdf", tamano: 2048, es_imagen: false, url: "/chat/archivos/10/" } })]),
    );
    await render(<Conversacion id="5" />);
    await fireEvent.press(await screen.findByTestId("mensaje-10"));
    expect(await screen.findByText("El archivo ya no está disponible.")).toBeTruthy();
  });
});

describe("quién leyó (CA-9)", () => {
  const LECTURA_CARLA = { id: 9, nombre: "Carla Ruiz", ultimo_leido: 11, leido_en: HOY.toISOString() };

  it("en un directo, el mensaje propio dice «Leído» y al mantenerlo pulsado se ve quién y cuándo", async () => {
    chatService.mensajes.mockResolvedValueOnce(pagina([mensaje(10), propio(11)], { lecturas: [LECTURA_CARLA] }));
    await render(<Conversacion id="5" />);
    const burbuja = await screen.findByTestId("mensaje-11");
    expect(burbuja.props.accessibilityLabel).toContain("Leído");
    // N-05: sin archivo, un toque también lo abre, y la pista lo dice.
    expect(burbuja.props.accessibilityHint).toBe("Toque para ver quién lo leyó");
    // Los ajenos no llevan confirmación.
    expect(screen.getByTestId("mensaje-10").props.accessibilityHint).toBeUndefined();

    await fireEvent(burbuja, "longPress");
    expect(screen.getByText("Quién leyó su mensaje")).toBeTruthy();
    expect(screen.getByText("Lo leyeron")).toBeTruthy();
    expect(screen.getByLabelText("Carla Ruiz. Lo leyó a las 10:05")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("cerrar-lecturas"));
    expect(screen.queryByText("Quién leyó su mensaje")).toBeNull();
  });

  it("en un grupo dice por cuántos y quiénes faltan", async () => {
    chatService.mensajes.mockResolvedValueOnce(
      pagina([propio(11, { conversacion: 7 })], {
        lecturas: [LECTURA_CARLA, { id: 12, nombre: "Luis Mora", ultimo_leido: 5, leido_en: null }],
      }),
    );
    await render(<Conversacion id="7" />);
    const burbuja = await screen.findByTestId("mensaje-11");
    expect(burbuja.props.accessibilityLabel).toContain("Leído por 1 de 2");
    await fireEvent(burbuja, "longPress");
    expect(screen.getByText("Todavía no lo leen")).toBeTruthy();
    expect(screen.getByLabelText("Luis Mora. Todavía no lo lee")).toBeTruthy();
  });

  it("se actualiza cada 10 s mientras se ve, como la web", async () => {
    jest.useFakeTimers();
    await render(<Conversacion id="5" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    chatService.lecturas.mockClear();
    chatService.lecturas.mockResolvedValue([LECTURA_CARLA]);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REFRESCO_LECTURAS_MS);
    });
    expect(chatService.lecturas).toHaveBeenCalledWith("5", {});
    expect(screen.getByTestId("mensaje-11").props.accessibilityLabel).toContain("Leído");
  });
});

describe("grupos y presencia (CA-6, CA-8)", () => {
  it("en un grupo se ve el autor y «Participantes» va en la cabecera como ícono (H-12)", async () => {
    chatService.mensajes.mockResolvedValueOnce(pagina([mensaje(10, { conversacion: 7 })]));
    await render(<Conversacion id="7" />);
    expect(await screen.findByText("Grupo · 3 participantes")).toBeTruthy();
    expect(screen.getByText("Carla Ruiz")).toBeTruthy();
    // Ya no está en la pantalla: está en la cabecera.
    expect(screen.queryByTestId("ver-participantes")).toBeNull();
    await renderCabeceraDerecha();
    const boton = screen.getByTestId("ver-participantes");
    expect(boton.props.accessibilityLabel).toBe("Ver los participantes de Equipo TI");
    await fireEvent.press(boton);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/chat/participantes/[id]", params: { id: "7" } });
    // En un grupo no se pide la presencia de nadie desde aquí.
    expect(chatService.presencia).not.toHaveBeenCalled();
  });

  it("los participantes se abren en la empresa de la conversación", async () => {
    await render(<Conversacion id="7" empresa="2" />);
    await screen.findByText("Grupo · 3 participantes");
    await renderCabeceraDerecha();
    await fireEvent.press(screen.getByTestId("ver-participantes"));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/chat/participantes/[id]",
      params: { id: "7", empresa: "2" },
    });
  });

  it("en un directo la cabecera no lleva «Participantes»", async () => {
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    expect(opcionesDeCabecera().headerRight).toBeUndefined();
  });

  it("mientras no se sabe qué conversación es, no ofrece «Participantes» (B5)", async () => {
    mockChat.conversaciones = [];
    chatService.conversacion.mockReturnValue(new Promise(() => {}));
    await render(<Conversacion id="7" />);
    await screen.findByText("Mensaje 11");
    expect(opcionesDeCabecera().headerRight).toBeUndefined();
    // Y no se pinta como grupo: sin línea de participantes.
    expect(screen.queryByText(/participantes$/)).toBeNull();
  });

  it("en un directo se ve la presencia de la otra persona y el aviso de su estado, con texto", async () => {
    chatService.presencia.mockResolvedValueOnce({
      9: {
        en_linea: false,
        ultima_conexion: null,
        estado: {
          clave: "vacaciones",
          texto: "Vacaciones",
          detalle: "De vacaciones hasta el 20/11/2026",
          mensaje: "",
          desde: "2026-11-16",
          hasta: "2026-11-20",
          reemplazo: { id: 3, nombre: "Pedro León" },
        },
      },
    });
    await render(<Conversacion id="5" />);
    expect(await screen.findByTestId("presencia-del-otro")).toBeTruthy();
    expect(chatService.presencia).toHaveBeenCalledWith(["9"]);
    expect(screen.getByTestId("presencia-del-otro").props.accessibilityLabel).toBe(
      "De vacaciones hasta el 20/11/2026 · Aprueba en su lugar: Pedro León",
    );
    expect(screen.getByTestId("aviso-del-otro").props.accessibilityLabel).toBe(
      "Carla Ruiz está de vacaciones hasta el 20/11/2026: verá su mensaje al volver. Aprueba en su lugar: Pedro León.",
    );
  });
});

describe("no molestar dentro de la conversación (CA-11)", () => {
  const PUSH = (notificacionId) => ({
    request: { content: { data: { modulo: "chat", notificacion_id: notificacionId, empresa: 1 } } },
  });

  it("mientras está abierta, su push no se muestra; el de otra sí; al salir, todos", async () => {
    notificacionesService.detalle.mockImplementation(async (id) => ({
      enlace: id === "77" ? "/admin/chat?c=5" : "/admin/chat?c=8",
    }));
    const { unmount } = await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    expect(conversacionAbierta()).toEqual({ id: "5", empresa: null });

    expect(await comportamientoDelAviso(PUSH(77))).toBe(COMPORTAMIENTOS.CALLAR);
    expect(await comportamientoDelAviso(PUSH(78))).toBe(COMPORTAMIENTOS.MOSTRAR);

    await unmount();
    expect(conversacionAbierta()).toBeNull();
    expect(await comportamientoDelAviso(PUSH(77))).toBe(COMPORTAMIENTOS.MOSTRAR);
  });

  it("abierta desde un push de otra empresa, la registra con esa empresa", async () => {
    await render(<Conversacion id="5" empresa="2" />);
    await screen.findByText("Mensaje 11");
    expect(conversacionAbierta()).toEqual({ id: "5", empresa: "2" });
  });
});

describe("accesibilidad (CA-14)", () => {
  it("los controles de escribir tienen nombre y el campo dice a quién se escribe", async () => {
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    expect(screen.getByLabelText("Mensaje para Carla Ruiz")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeTruthy();
    const adjuntar = screen.getByRole("button", { name: "Adjuntar foto o archivo" });
    expect(adjuntar.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(adjuntar);
    expect(screen.getByTestId("adjuntar").props.accessibilityState).toMatchObject({ expanded: true });
  });
});

describe("separadores de día y autor agrupado (auditoría UX, H-07 y H-13)", () => {
  const AYER = new Date(HOY);
  AYER.setDate(AYER.getDate() - 1);
  const ANTES = new Date(2026, 0, 5, 9, 30);

  it("intercala «Hoy», «Ayer» y la fecha como encabezados; la burbuja muestra solo la hora", async () => {
    chatService.mensajes.mockResolvedValueOnce(
      pagina([
        mensaje(1, { fecha: ANTES.toISOString(), texto: "Muy antiguo" }),
        mensaje(2, { fecha: AYER.toISOString(), texto: "De ayer" }),
        mensaje(3, { fecha: HOY.toISOString(), texto: "De hoy" }),
      ]),
    );
    await render(<Conversacion id="5" />);
    await screen.findByText("De hoy");

    // La lista va invertida: en el árbol, lo más nuevo primero.
    enOrden(screen.getAllByRole("header"), ["Hoy", "Ayer", "05/01/2026"]);
    // Cada separador va después de los mensajes de su día en el árbol (arriba de ellos en pantalla).
    enOrden(screen.getAllByText(/^(De hoy|Hoy|De ayer|Ayer)$/), ["De hoy", "Hoy", "De ayer", "Ayer"]);
    // Solo la hora a la vista; la etiqueta accesible conserva el día.
    expect(screen.getAllByText("09:30").length).toBeGreaterThan(0);
    expect(screen.getByTestId("mensaje-1").props.accessibilityLabel).toBe("Carla Ruiz, 05/01/2026, 09:30. Muy antiguo");
  });

  it("lo que se está enviando va bajo «Hoy» aunque lo último sea de ayer", async () => {
    const espera = pendiente();
    chatService.enviar.mockReturnValueOnce(espera.promesa);
    chatService.mensajes.mockResolvedValueOnce(pagina([mensaje(2, { fecha: AYER.toISOString(), texto: "De ayer" })]));
    await render(<Conversacion id="5" />);
    await screen.findByText("De ayer");
    expect(screen.queryByText("Hoy")).toBeNull();
    await fireEvent.changeText(screen.getByTestId("escribir"), "Respuesta");
    await fireEvent.press(screen.getByTestId("enviar"));
    expect(screen.getByRole("header", { name: "Hoy" })).toBeTruthy();
    await act(async () => espera.resolver({ ...propio(60, { texto: "Respuesta" }), avisos: [] }));
  });

  it("en un grupo el autor se ve solo cuando cambia, y se repite al cambiar de día", async () => {
    const LUIS = { id: 12, nombre: "Luis Mora" };
    chatService.mensajes.mockResolvedValueOnce(
      pagina([
        mensaje(1, { conversacion: 7, fecha: AYER.toISOString() }),
        mensaje(2, { conversacion: 7, fecha: HOY.toISOString() }),
        mensaje(3, { conversacion: 7, fecha: HOY.toISOString() }),
        mensaje(4, { conversacion: 7, fecha: HOY.toISOString(), autor: LUIS }),
        mensaje(5, { conversacion: 7, fecha: HOY.toISOString() }),
      ]),
    );
    await render(<Conversacion id="7" />);
    await screen.findByText("Mensaje 5");
    // 1 (ayer), 2 (nuevo día), 5 (vuelve tras Luis): tres veces «Carla Ruiz»; 3 no.
    expect(screen.getAllByText("Carla Ruiz")).toHaveLength(3);
    expect(screen.getAllByText("Luis Mora")).toHaveLength(1);
    // El lector oye el autor siempre.
    expect(screen.getByTestId("mensaje-3").props.accessibilityLabel).toMatch(/^Carla Ruiz, /);
  });

  it("elementosDeLaConversacion: separador por día y autor solo al cambiar", () => {
    const { elementosDeLaConversacion } = require("../src/pantallas/chat/Conversacion");
    const elementos = elementosDeLaConversacion(
      [
        mensaje(1, { fecha: AYER.toISOString() }),
        mensaje(2, { fecha: HOY.toISOString() }),
        mensaje(3, { fecha: HOY.toISOString() }),
        propio(4, { fecha: HOY.toISOString() }),
      ],
      [],
      true,
      HOY,
    );
    expect(elementos.map((e) => e.dia ?? (e.conAutor ? `${e.mensaje.id}+` : `${e.mensaje.id}`))).toEqual([
      "Ayer",
      "1+",
      "Hoy",
      "2+",
      "3",
      "4+",
    ]);
  });
});

describe("visor de imágenes (auditoría UX, H-06 y H-22)", () => {
  it("en Android ofrece «Ampliar con el visor del teléfono» con el archivo descargado", async () => {
    const { Platform } = require("react-native");
    const FileSystem = require("expo-file-system");
    const sistemaOriginal = Platform.OS;
    Platform.OS = "android";
    try {
      const archivo = { uri: "file:///cache/chat-archivos/mensaje-10.jpg", exists: true, delete: jest.fn() };
      descargarArchivoDelChat.mockResolvedValueOnce(archivo);
      chatService.mensajes.mockResolvedValueOnce(
        pagina([
          mensaje(10, {
            texto: "",
            archivo: { nombre: "foto.jpg", tamano: 1000, es_imagen: true, url: "/chat/archivos/10/" },
          }),
        ]),
      );
      await render(<Conversacion id="5" />);
      await fireEvent.press(await screen.findByTestId("mensaje-10"));
      await screen.findByTestId("imagen-del-chat");
      expect(screen.getByTestId("cerrar-imagen").props.accessibilityLabel).toBe("Cerrar");

      await fireEvent.press(screen.getByTestId("ampliar-imagen"));
      expect(FileSystem.File.preview).toHaveBeenCalledWith(archivo, { mimeType: "image/*", title: "foto.jpg" });
      // Al cerrar se borra igual (LOPDP).
      await fireEvent.press(screen.getByTestId("cerrar-imagen"));
      expect(archivo.delete).toHaveBeenCalled();
    } finally {
      Platform.OS = sistemaOriginal;
    }
  });

  it("en iOS no hace falta: se amplía con los dedos", async () => {
    const archivo = { uri: "file:///cache/chat-archivos/mensaje-10.jpg", exists: true, delete: jest.fn() };
    descargarArchivoDelChat.mockResolvedValueOnce(archivo);
    chatService.mensajes.mockResolvedValueOnce(
      pagina([
        mensaje(10, { texto: "", archivo: { nombre: "foto.jpg", tamano: 1000, es_imagen: true, url: "/chat/archivos/10/" } }),
      ]),
    );
    await render(<Conversacion id="5" />);
    await fireEvent.press(await screen.findByTestId("mensaje-10"));
    await screen.findByTestId("imagen-del-chat");
    expect(screen.queryByTestId("ampliar-imagen")).toBeNull();
  });
});

describe("correcciones de la ronda 1 de QA", () => {
  const { FlatList, Keyboard, Platform } = require("react-native");
  const formato = require("../src/chat/formato");
  const {
    mismasLecturas,
    pendientesReconocidos,
    TEXTO_PUEDE_HABERSE_ENVIADO,
    TEXTO_SIN_FECHA,
  } = require("../src/pantallas/chat/Conversacion");

  function lejosDelFinal(distancia = 600) {
    return fireEvent.scroll(screen.getByTestId("mensajes"), {
      nativeEvent: {
        contentOffset: { x: 0, y: distancia },
        contentSize: { width: 360, height: 3000 },
        layoutMeasurement: { width: 360, height: 600 },
      },
    });
  }

  it("P2-2: escribir no vuelve a dibujar las burbujas", async () => {
    const hora = jest.spyOn(formato, "horaDeMensaje");
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    const antes = hora.mock.calls.length;
    // Sin esto, la prueba pasaría aunque las burbujas nunca se pintaran.
    expect(antes).toBeGreaterThan(0);
    await fireEvent.changeText(screen.getByTestId("escribir"), "H");
    await fireEvent.changeText(screen.getByTestId("escribir"), "Ho");
    await fireEvent.changeText(screen.getByTestId("escribir"), "Hol");
    expect(hora.mock.calls.length).toBe(antes);
  });

  it("P2-2: si las lecturas no cambian, el refresco no vuelve a dibujar nada", async () => {
    jest.useFakeTimers();
    const LECTURA = { id: 9, nombre: "Carla Ruiz", ultimo_leido: 11, leido_en: HOY.toISOString() };
    chatService.mensajes.mockResolvedValueOnce(pagina([mensaje(10), propio(11)], { lecturas: [LECTURA] }));
    chatService.lecturas.mockResolvedValue([{ ...LECTURA }]);
    const hora = jest.spyOn(formato, "horaDeMensaje");
    await render(<Conversacion id="5" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    const antes = hora.mock.calls.length;
    // Sin esto, la prueba pasaría aunque las burbujas nunca se pintaran.
    expect(antes).toBeGreaterThan(0);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REFRESCO_LECTURAS_MS);
    });
    expect(chatService.lecturas).toHaveBeenCalled();
    expect(hora.mock.calls.length).toBe(antes);
    expect(mismasLecturas([LECTURA], [{ ...LECTURA }])).toBe(true);
    expect(mismasLecturas([LECTURA], [{ ...LECTURA, ultimo_leido: 12 }])).toBe(false);
  });

  it("N-04: lejos del final ofrece «Ir al último mensaje» con lo nuevo sin ver, y vuelve abajo", async () => {
    const desplazar = jest.spyOn(FlatList.prototype, "scrollToOffset").mockImplementation(() => {});
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    expect(screen.queryByTestId("ir-al-ultimo")).toBeNull();

    await lejosDelFinal();
    expect(screen.getByTestId("ir-al-ultimo").props.accessibilityLabel).toBe("Ir al último mensaje");
    await llegan(5, [mensaje(12), mensaje(13)]);
    expect(screen.getByTestId("ir-al-ultimo").props.accessibilityLabel).toBe("Ir al último mensaje. 2 mensajes nuevos");

    await fireEvent.press(screen.getByTestId("ir-al-ultimo"));
    expect(desplazar).toHaveBeenCalledWith({ offset: 0, animated: true });
    expect(screen.queryByTestId("ir-al-ultimo")).toBeNull();
  });

  it("N-04: al enviar va siempre al último mensaje", async () => {
    const desplazar = jest.spyOn(FlatList.prototype, "scrollToOffset").mockImplementation(() => {});
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    await lejosDelFinal();
    await fireEvent.changeText(screen.getByTestId("escribir"), "Hola");
    await fireEvent.press(screen.getByTestId("enviar"));
    expect(desplazar).toHaveBeenCalledWith({ offset: 0, animated: true });
  });

  it("N-05: un toque en la propia abre «quién leyó»; el texto solo es seleccionable si tocar no hace nada", async () => {
    const LECTURA = { id: 9, nombre: "Carla Ruiz", ultimo_leido: 11, leido_en: HOY.toISOString() };
    chatService.mensajes.mockResolvedValueOnce(pagina([mensaje(10), propio(11)], { lecturas: [LECTURA] }));
    await render(<Conversacion id="5" />);
    const propia = await screen.findByTestId("mensaje-11");
    expect(screen.getByText("Mensaje 11").props.selectable).toBe(false);
    expect(screen.getByText("Mensaje 10").props.selectable).toBe(true);
    await fireEvent.press(propia);
    expect(screen.getByText("Quién leyó su mensaje")).toBeTruthy();
  });

  it("B1: un mensaje sin fecha válida no tumba la pantalla", async () => {
    chatService.mensajes.mockResolvedValueOnce(
      pagina([mensaje(1, { fecha: null, texto: "Sin fecha aquí" }), mensaje(2, { fecha: HOY.toISOString() })]),
    );
    await render(<Conversacion id="5" />);
    expect(await screen.findByText("Sin fecha aquí")).toBeTruthy();
    expect(screen.getByRole("header", { name: TEXTO_SIN_FECHA })).toBeTruthy();
    expect(screen.getByRole("header", { name: "Hoy" })).toBeTruthy();
  });

  it("B2: si se perdió la respuesta, dice que puede que se haya enviado y desaparece cuando llega", async () => {
    chatService.enviar.mockRejectedValueOnce(errorDeRed());
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    await fireEvent.changeText(screen.getByTestId("escribir"), "  ¿Me confirma?  ");
    await fireEvent.press(screen.getByTestId("enviar"));
    expect(await screen.findByText(`Sin confirmar · ${TEXTO_PUEDE_HABERSE_ENVIADO}`)).toBeTruthy();

    // El servidor sí lo guardó: llega por el sondeo.
    await llegan(5, [propio(70, { texto: "¿Me confirma?", fecha: new Date().toISOString() })]);
    expect(screen.queryByText(/Sin confirmar/)).toBeNull();
    expect(screen.getAllByText("¿Me confirma?")).toHaveLength(1);
    expect(screen.getByTestId("mensaje-70")).toBeTruthy();
  });

  it("B2: si llega por el sondeo mientras se envía, el fallo posterior no lo duplica ni lo anuncia", async () => {
    const espera = pendiente();
    chatService.enviar.mockReturnValueOnce(espera.promesa);
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    await fireEvent.changeText(screen.getByTestId("escribir"), "Hola");
    await fireEvent.press(screen.getByTestId("enviar"));
    await llegan(5, [propio(71, { texto: "Hola", fecha: new Date().toISOString() })]);
    expect(screen.queryByLabelText("Enviando…")).toBeNull();
    anuncios.mockClear();
    await act(async () => espera.rechazar(errorDeRed()));
    expect(screen.queryByText(/Sin confirmar/)).toBeNull();
    expect(anuncios).not.toHaveBeenCalled();
    expect(screen.getAllByText("Hola")).toHaveLength(1);
  });

  it("B2: pendientesReconocidos no confunde un mensaje anterior igual ni uno con otro archivo", () => {
    const inicio = new Date(2026, 10, 12, 10, 0).getTime();
    const p = { clave: "p1", texto: "Hola", archivo: null, inicio, ultimoConocido: 50 };
    const ahora = new Date(inicio + 1000).toISOString();
    expect(pendientesReconocidos([p], [propio(40, { texto: "Hola", fecha: ahora })])).toEqual([]);
    expect(pendientesReconocidos([p], [mensaje(60, { texto: "Hola", fecha: ahora })])).toEqual([]);
    expect(
      pendientesReconocidos([p], [propio(60, { texto: "Hola", fecha: ahora, archivo: { nombre: "a.pdf" } })]),
    ).toEqual([]);
    const antiguo = new Date(inicio - 10 * 60_000).toISOString();
    expect(pendientesReconocidos([p], [propio(60, { texto: "Hola", fecha: antiguo })])).toEqual([]);
    expect(pendientesReconocidos([p], [propio(60, { texto: " Hola ", fecha: ahora })])).toEqual(["p1"]);
    // Un mensaje reconoce a un solo pendiente.
    const q = { ...p, clave: "p2" };
    expect(pendientesReconocidos([p, q], [propio(60, { texto: "Hola", fecha: ahora })])).toEqual(["p1"]);
  });

  it("B4: un mensaje con fecha «futura» y lo pendiente quedan bajo un solo «Hoy»", async () => {
    const MANANA = new Date(HOY);
    MANANA.setDate(MANANA.getDate() + 1);
    const espera = pendiente();
    chatService.enviar.mockReturnValueOnce(espera.promesa);
    chatService.mensajes.mockResolvedValueOnce(
      pagina([mensaje(1, { fecha: HOY.toISOString() }), mensaje(2, { fecha: MANANA.toISOString(), texto: "Adelantado" })]),
    );
    await render(<Conversacion id="5" />);
    await screen.findByText("Adelantado");
    await fireEvent.changeText(screen.getByTestId("escribir"), "Respuesta");
    await fireEvent.press(screen.getByTestId("enviar"));
    expect(screen.getAllByRole("header", { name: "Hoy" })).toHaveLength(1);
    await act(async () => espera.resolver({ ...propio(60, { texto: "Respuesta" }), avisos: [] }));
  });

  it("B4: al pasar la medianoche, el siguiente render pasa «Hoy» a «Ayer»", async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 12, 23, 50), doNotFake: ["nextTick", "setImmediate"] });
    chatService.mensajes.mockResolvedValueOnce(
      pagina([mensaje(1, { fecha: new Date(2026, 10, 12, 23, 0).toISOString(), texto: "De anoche" })]),
    );
    const { rerender } = await render(<Conversacion id="5" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("header", { name: "Hoy" })).toBeTruthy();
    jest.setSystemTime(new Date(2026, 10, 13, 0, 5));
    await rerender(<Conversacion id="5" />);
    expect(screen.getByRole("header", { name: "Ayer" })).toBeTruthy();
    expect(screen.queryByRole("header", { name: "Hoy" })).toBeNull();
  });

  it("B7: al cargar los anteriores de otro día aparece su separador, sin repetir el de hoy", async () => {
    const AYER = new Date(HOY);
    AYER.setDate(AYER.getDate() - 1);
    chatService.mensajes
      .mockResolvedValueOnce(pagina([mensaje(50, { fecha: HOY.toISOString() })], { hay_mas: true }))
      .mockResolvedValueOnce(pagina([mensaje(49, { fecha: AYER.toISOString(), texto: "Ayer escribí" })]));
    await render(<Conversacion id="5" />);
    await fireEvent.press(await screen.findByTestId("ver-anteriores"));
    expect(await screen.findByText("Ayer escribí")).toBeTruthy();
    expect(screen.getAllByRole("header", { name: "Hoy" })).toHaveLength(1);
    expect(screen.getAllByRole("header", { name: "Ayer" })).toHaveLength(1);
  });

  it("N-07: abrir el clip cierra el teclado; N-12: el clip dice si está abierto", async () => {
    const cerrar = jest.spyOn(Keyboard, "dismiss");
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    const clip = screen.getByRole("button", { name: "Adjuntar foto o archivo" });
    expect(clip.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(clip);
    expect(cerrar).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Adjuntar foto o archivo" }).props.accessibilityState).toMatchObject({
      expanded: true,
    });
  });

  it("N-08: en un grupo las propias no dicen «Usted» a la vista, pero sí al lector", async () => {
    chatService.mensajes.mockResolvedValueOnce(pagina([mensaje(10, { conversacion: 7 }), propio(11, { conversacion: 7 })]));
    await render(<Conversacion id="7" />);
    await screen.findByText("Mensaje 11");
    expect(screen.queryByText("Usted")).toBeNull();
    expect(screen.getByTestId("mensaje-11").props.accessibilityLabel).toMatch(/^Usted, /);
  });

  it("N-11: en iOS escucha el teclado con «Will»", async () => {
    const escuchar = jest.spyOn(Keyboard, "addListener");
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    const eventos = escuchar.mock.calls.map(([evento]) => evento);
    if (Platform.OS === "ios") expect(eventos).toEqual(expect.arrayContaining(["keyboardWillShow", "keyboardWillHide"]));
    else expect(eventos).toEqual(expect.arrayContaining(["keyboardDidShow", "keyboardDidHide"]));
  });

  it("N-12: «Cerrar» de las lecturas es un botón de ícono con nombre", async () => {
    const LECTURA = { id: 9, nombre: "Carla Ruiz", ultimo_leido: 11, leido_en: HOY.toISOString() };
    chatService.mensajes.mockResolvedValueOnce(pagina([propio(11)], { lecturas: [LECTURA] }));
    await render(<Conversacion id="5" />);
    await fireEvent.press(await screen.findByTestId("mensaje-11"));
    const cerrarLecturas = screen.getByTestId("cerrar-lecturas");
    expect(cerrarLecturas.props.accessibilityLabel).toBe("Cerrar");
    expect(cerrarLecturas.props.accessibilityRole).toBe("button");
  });

  it("N-18: «Ampliar» del visor queda ocupado y no abre dos visores", async () => {
    const FileSystem = require("expo-file-system");
    const sistemaOriginal = Platform.OS;
    Platform.OS = "android";
    try {
      const abrir = pendiente();
      FileSystem.File.preview.mockReturnValueOnce(abrir.promesa);
      const archivo = { uri: "file:///cache/chat-archivos/mensaje-10.jpg", exists: true, delete: jest.fn() };
      descargarArchivoDelChat.mockResolvedValueOnce(archivo);
      chatService.mensajes.mockResolvedValueOnce(
        pagina([mensaje(10, { texto: "", archivo: { nombre: "foto.jpg", tamano: 1, es_imagen: true, url: "/chat/archivos/10/" } })]),
      );
      await render(<Conversacion id="5" />);
      await fireEvent.press(await screen.findByTestId("mensaje-10"));
      await screen.findByTestId("imagen-del-chat");
      // Dos toques seguidos: el segundo encuentra el candado (y el botón ocupado).
      await tocarSinEsperar(screen.getByTestId("ampliar-imagen"), screen.getByTestId("ampliar-imagen"));
      expect(FileSystem.File.preview).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("ampliar-imagen").props.accessibilityState).toMatchObject({ busy: true });
      await act(async () => abrir.resolver());
      expect(screen.getByTestId("ampliar-imagen").props.accessibilityState).toMatchObject({ busy: false });
    } finally {
      Platform.OS = sistemaOriginal;
    }
  });
});

describe("correcciones de la ronda 2 de QA", () => {
  const { StyleSheet } = require("react-native");
  const { colores } = require("../src/tema/colores");
  const { msHastaMedianoche } = require("../src/utils/useMedianoche");
  const { DISTANCIA_LEJOS, pendientesReconocidos } = require("../src/pantallas/chat/Conversacion");

  function lejosDelFinal(distancia = 600) {
    return fireEvent.scroll(screen.getByTestId("mensajes"), {
      nativeEvent: {
        contentOffset: { x: 0, y: distancia },
        contentSize: { width: 360, height: 3000 },
        layoutMeasurement: { width: 360, height: 600 },
      },
    });
  }

  it("R-01: «Ir al último» queda dentro de la zona de la lista y «Enviar» sigue pulsable", async () => {
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    await lejosDelFinal();
    const zona = screen.getByTestId("zona-lista");
    expect(within(zona).getByTestId("ir-al-ultimo")).toBeTruthy();
    expect(within(zona).queryByTestId("enviar")).toBeNull();
    expect(within(zona).queryByTestId("escribir")).toBeNull();
    expect(StyleSheet.flatten(zona.props.style).flex).toBe(1);

    await fireEvent.changeText(screen.getByTestId("escribir"), "Sigo aquí");
    await fireEvent.press(screen.getByTestId("enviar"));
    expect(chatService.enviar).toHaveBeenCalledWith("5", "Sigo aquí", null, {});
  });

  it("P3-1: lo nuevo se sigue solo hasta la misma distancia en que aparece «Ir al último»", async () => {
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    expect(screen.getByTestId("mensajes").props.maintainVisibleContentPosition).toEqual({
      minIndexForVisible: 0,
      autoscrollToTopThreshold: DISTANCIA_LEJOS,
    });
  });

  it("P3-2: un pendiente rechazado por el servidor no se da por enviado", async () => {
    const inicio = Date.now();
    const ahora = new Date(inicio + 1000).toISOString();
    const base = { texto: "Hola", archivo: null, inicio, ultimoConocido: 50 };
    const rechazado = { ...base, clave: "p1", estado: "fallido", error: { texto: "No.", sinConfirmar: false } };
    const sinConfirmar = { ...base, clave: "p2", estado: "fallido", error: { texto: "?", sinConfirmar: true } };
    const enviando = { ...base, clave: "p3", estado: "enviando", error: null };
    expect(pendientesReconocidos([rechazado], [propio(60, { texto: "Hola", fecha: ahora })])).toEqual([]);
    expect(pendientesReconocidos([sinConfirmar], [propio(60, { texto: "Hola", fecha: ahora })])).toEqual(["p2"]);
    expect(pendientesReconocidos([enviando], [propio(60, { texto: "Hola", fecha: ahora })])).toEqual(["p3"]);

    chatService.enviar.mockRejectedValueOnce(error500());
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    await fireEvent.changeText(screen.getByTestId("escribir"), "Hola");
    await fireEvent.press(screen.getByTestId("enviar"));
    await screen.findByText(/^No se envió · /);
    // Uno igual enviado desde la web no borra el que el servidor rechazó.
    await llegan(5, [propio(70, { texto: "Hola", fecha: new Date().toISOString() })]);
    expect(screen.getByText(/^No se envió · /)).toBeTruthy();
  });

  it("R-04: «Sin confirmar» es un aviso (no un error) y dice qué hacer", async () => {
    chatService.enviar.mockRejectedValueOnce(errorDeRed());
    await render(<Conversacion id="5" />);
    await screen.findByText("Mensaje 11");
    await fireEvent.changeText(screen.getByTestId("escribir"), "¿Llegó?");
    await fireEvent.press(screen.getByTestId("enviar"));
    const texto = await screen.findByText(
      "Sin confirmar · Puede que ya se haya enviado. Espere unos segundos: si llegó, este aviso desaparece solo; si no, reintente.",
    );
    expect(StyleSheet.flatten(texto.props.style).color).toBe(colores.avisoTexto);
    const burbuja = screen.getByTestId(/^pendiente-/);
    expect(StyleSheet.flatten(burbuja.props.style).backgroundColor).toBe(colores.avisoFondo);
    expect(screen.getByRole("button", { name: "Descartar este mensaje" })).toBeTruthy();
  });

  it("R-05: «Ver quién lo leyó» aparece una sola vez entre las acciones", async () => {
    const LECTURA = { id: 9, nombre: "Carla Ruiz", ultimo_leido: 20, leido_en: HOY.toISOString() };
    chatService.mensajes.mockResolvedValueOnce(
      pagina(
        [
          propio(11),
          propio(12, { texto: "", archivo: { nombre: "acta.pdf", tamano: 1, es_imagen: false, url: "/chat/archivos/12/" } }),
        ],
        { lecturas: [LECTURA] },
      ),
    );
    await render(<Conversacion id="5" />);
    const sinArchivo = (await screen.findByTestId("mensaje-11")).props.accessibilityActions;
    expect(sinArchivo).toEqual([{ name: "activate", label: "Ver quién lo leyó" }]);
    const conArchivo = screen.getByTestId("mensaje-12").props.accessibilityActions;
    expect(conArchivo).toEqual([
      { name: "activate", label: "Abrir acta.pdf" },
      { name: "longpress", label: "Ver quién lo leyó" },
    ]);
  });

  it("O3: a las 00:00:05 «Hoy» pasa a «Ayer» sin que llegue nada ni se toque la pantalla", async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 12, 23, 59, 0), doNotFake: ["nextTick", "setImmediate"] });
    expect(msHastaMedianoche(new Date(2026, 10, 12, 23, 59, 0))).toBe(65_000);
    chatService.mensajes.mockResolvedValueOnce(
      pagina([mensaje(1, { fecha: new Date(2026, 10, 12, 23, 30).toISOString(), texto: "De anoche" })]),
    );
    const { unmount } = await render(<Conversacion id="5" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("header", { name: "Hoy" })).toBeTruthy();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(65_000);
    });
    expect(screen.getByRole("header", { name: "Ayer" })).toBeTruthy();
    expect(screen.queryByRole("header", { name: "Hoy" })).toBeNull();
    await unmount();
  });
});
