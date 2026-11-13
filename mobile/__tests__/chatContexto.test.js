import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { AppState, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { chatService } from "../src/api/servicios";
import {
  ChatProvider,
  INTERVALO_FUERA_DEL_CHAT_MS,
  INTERVALO_MS,
  mismosNoLeidos,
  useChat,
  useChatVisible,
} from "../src/chat/ChatContext";
import { CabeceraDeModulos } from "../src/navegacion/CabeceraDeModulos";
import { ListaChats } from "../src/pantallas/chat/ListaChats";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (efecto) => React.useEffect(efecto, [efecto]),
  };
});

const mockSesion = { versionEmpresa: 0, empresaActiva: { id: 1 } };
jest.mock("../src/sesion/SesionContext", () => ({
  useSesion: () => mockSesion,
}));

jest.mock("../src/notificaciones/ContadorContext", () => ({
  useContador: () => ({ noLeidas: 0, recargar: jest.fn() }),
}));
jest.mock("../src/permisos/ResumenPermisosContext", () => ({
  useResumenPermisos: () => ({ porAprobar: 0 }),
}));

jest.mock("../src/api/servicios", () => ({
  chatService: {
    conversaciones: jest.fn(),
    novedades: jest.fn(),
    presencia: jest.fn(),
    miEstado: jest.fn(),
  },
}));

const METRICAS = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } };

/** Los oyentes de `AppState` que registran el proveedor y las pantallas. */
let oyentesApp = [];
function cambiarApp(estado) {
  AppState.currentState = estado;
  for (const oyente of [...oyentesApp]) oyente(estado);
}

const CONVERSACIONES = [
  {
    id: 1,
    tipo: "general",
    nombre: "Canal general",
    otro: null,
    miembros: 40,
    administra: false,
    no_leidos: 0,
    ultimo: { texto: "Buenos días", autor: "Luis Mora", propio: false, fecha: "2026-11-12T13:00:00Z" },
  },
  {
    id: 5,
    tipo: "directa",
    nombre: "Carla Ruiz",
    otro: { id: 9, nombre: "Carla Ruiz", correo: "carla@grupolaar.com", area: "Cartera", cargo: "Analista" },
    miembros: 2,
    administra: false,
    no_leidos: 3,
    ultimo: { texto: "¿Me ayuda?", autor: "Carla Ruiz", propio: false, fecha: "2026-11-12T14:00:00Z" },
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockSesion.versionEmpresa = 0;
  oyentesApp = [];
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation((_tipo, oyente) => {
    oyentesApp.push(oyente);
    return {
      remove: () => {
        oyentesApp = oyentesApp.filter((o) => o !== oyente);
      },
    };
  });
  chatService.conversaciones.mockResolvedValue(CONVERSACIONES);
  chatService.novedades.mockResolvedValue({ cursor: 100, mensajes: [], no_leidos: { 5: 3 }, total_no_leidos: 3 });
  chatService.presencia.mockResolvedValue({ 9: { en_linea: true, ultima_conexion: null, estado: null } });
  chatService.miEstado.mockResolvedValue({ estado: "disponible", vigente: null });
});

afterEach(() => {
  jest.useRealTimers();
});

function Total() {
  const { totalNoLeidos } = useChat();
  return <Text testID="total">{String(totalNoLeidos)}</Text>;
}

function Visible() {
  useChatVisible();
  return null;
}

async function esperar(ms) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

describe("consulta periódica de novedades (CA-4)", () => {
  it("arranca en primer plano y, fuera del chat, consulta cada 30 s como la web con la pestaña oculta", async () => {
    jest.useFakeTimers();
    await render(
      <ChatProvider>
        <Total />
      </ChatProvider>,
    );
    await esperar(0);
    expect(chatService.novedades).toHaveBeenCalledTimes(1);
    expect(chatService.novedades).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId("total")).toHaveTextContent("3");

    await esperar(INTERVALO_MS * 3);
    expect(chatService.novedades).toHaveBeenCalledTimes(1);
    await esperar(INTERVALO_FUERA_DEL_CHAT_MS);
    expect(chatService.novedades).toHaveBeenCalledTimes(2);
    expect(chatService.novedades).toHaveBeenLastCalledWith(100);
  });

  it("viendo el chat consulta cada 4 s", async () => {
    jest.useFakeTimers();
    await render(
      <ChatProvider>
        <Visible />
      </ChatProvider>,
    );
    await esperar(0);
    const antes = chatService.novedades.mock.calls.length;
    await esperar(INTERVALO_MS * 3);
    expect(chatService.novedades.mock.calls.length - antes).toBe(3);
  });

  it("se detiene en segundo plano, consulta enseguida al volver y se detiene al desmontar", async () => {
    jest.useFakeTimers();
    const { unmount } = await render(
      <ChatProvider>
        <Visible />
      </ChatProvider>,
    );
    await esperar(0);
    await act(async () => cambiarApp("background"));
    const enPausa = chatService.novedades.mock.calls.length;
    await esperar(INTERVALO_FUERA_DEL_CHAT_MS * 3);
    expect(chatService.novedades).toHaveBeenCalledTimes(enPausa);

    await act(async () => cambiarApp("active"));
    await esperar(0);
    expect(chatService.novedades).toHaveBeenCalledTimes(enPausa + 1);

    await unmount();
    await esperar(INTERVALO_FUERA_DEL_CHAT_MS * 2);
    expect(chatService.novedades).toHaveBeenCalledTimes(enPausa + 1);
  });

  it("si arranca en segundo plano no consulta hasta pasar al frente", async () => {
    jest.useFakeTimers();
    AppState.currentState = "background";
    await render(<ChatProvider />);
    await esperar(INTERVALO_FUERA_DEL_CHAT_MS * 2);
    expect(chatService.novedades).not.toHaveBeenCalled();
    await act(async () => cambiarApp("active"));
    await esperar(0);
    expect(chatService.novedades).toHaveBeenCalledTimes(1);
  });

  it("nunca hay dos consultas a la vez", async () => {
    jest.useFakeTimers();
    chatService.novedades.mockReturnValue(new Promise(() => {}));
    await render(
      <ChatProvider>
        <Visible />
      </ChatProvider>,
    );
    await esperar(INTERVALO_MS * 5);
    expect(chatService.novedades).toHaveBeenCalledTimes(1);
  });

  it("reparte los mensajes nuevos y recarga la lista si llega algo ajeno", async () => {
    jest.useFakeTimers();
    const recibidos = [];
    function Oyente() {
      const { escucharMensajes } = useChat();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      require("react").useEffect(() => escucharMensajes(5, (m) => recibidos.push(...m)), []);
      return null;
    }
    chatService.novedades
      .mockResolvedValueOnce({ cursor: 100, mensajes: [], no_leidos: {}, total_no_leidos: 0 })
      .mockResolvedValueOnce({
        cursor: 101,
        mensajes: [{ id: 101, conversacion: 5, propio: false, texto: "Hola", autor: { id: 9, nombre: "Carla" } }],
        no_leidos: { 5: 1 },
        total_no_leidos: 1,
      });
    await render(
      <ChatProvider>
        <Visible />
        <Oyente />
      </ChatProvider>,
    );
    await esperar(0);
    const listas = chatService.conversaciones.mock.calls.length;
    await esperar(INTERVALO_MS);
    expect(recibidos.map((m) => m.id)).toEqual([101]);
    expect(chatService.conversaciones.mock.calls.length).toBe(listas + 1);
  });

  it("lo que no viene en «no_leidos» queda en cero (leído en la web)", async () => {
    jest.useFakeTimers();
    chatService.novedades
      .mockResolvedValueOnce({ cursor: 100, mensajes: [], no_leidos: { 5: 3 }, total_no_leidos: 3 })
      .mockResolvedValueOnce({ cursor: 100, mensajes: [], no_leidos: {}, total_no_leidos: 0 });
    await render(
      <ChatProvider>
        <Visible />
        <Total />
      </ChatProvider>,
    );
    await esperar(0);
    expect(screen.getByTestId("total")).toHaveTextContent("3");
    await esperar(INTERVALO_MS);
    expect(screen.getByTestId("total")).toHaveTextContent("0");
  });

  it("P2-1: un sondeo sin cambios no cambia la referencia de los no leídos", async () => {
    jest.useFakeTimers();
    const vistos = [];
    function Registro() {
      const { noLeidos } = useChat();
      vistos.push(noLeidos);
      return null;
    }
    await render(
      <ChatProvider>
        <Visible />
        <Registro />
      </ChatProvider>,
    );
    await esperar(0);
    const antes = vistos.at(-1);
    expect(antes).toEqual({ 5: 3 });
    await esperar(INTERVALO_MS * 3);
    expect(chatService.novedades.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(vistos.at(-1)).toBe(antes);
    expect(mismosNoLeidos({ 5: 3 }, { 5: 3 })).toBe(true);
    expect(mismosNoLeidos({ 5: 3 }, { 5: 2 })).toBe(false);
    expect(mismosNoLeidos({ 5: 3 }, { 5: 3, 7: 1 })).toBe(false);
  });

  it("un push del chat con la app abierta consulta enseguida", async () => {
    jest.useFakeTimers();
    let alRecibir;
    Notifications.addNotificationReceivedListener.mockImplementation((fn) => {
      alRecibir = fn;
      return { remove: jest.fn() };
    });
    await render(<ChatProvider />);
    await esperar(0);
    expect(chatService.novedades).toHaveBeenCalledTimes(1);
    await act(async () => alRecibir({ request: { content: { data: { modulo: "chat" } } } }));
    expect(chatService.novedades).toHaveBeenCalledTimes(2);
  });

  it("al cambiar de empresa vuelve a empezar (CA-13)", async () => {
    jest.useFakeTimers();
    const { rerender } = await render(<ChatProvider />);
    await esperar(0);
    mockSesion.versionEmpresa = 1;
    await rerender(<ChatProvider />);
    await esperar(0);
    expect(chatService.conversaciones).toHaveBeenCalledTimes(2);
    expect(chatService.novedades).toHaveBeenLastCalledWith(null);
  });
});

describe("pestaña «Chat» (CA-1)", () => {
  it("muestra las conversaciones con el último mensaje, la presencia y los no leídos", async () => {
    await render(
      <ChatProvider>
        <ListaChats />
      </ChatProvider>,
    );

    expect(await screen.findByText("Canal general")).toBeTruthy();
    expect(screen.getByText("Luis Mora: Buenos días")).toBeTruthy();
    expect(screen.getByText("Carla Ruiz: ¿Me ayuda?")).toBeTruthy();
    expect(screen.getByLabelText("3 mensajes sin leer")).toBeTruthy();
    expect(await screen.findByText("En línea")).toBeTruthy();
    expect(chatService.presencia).toHaveBeenCalledWith(["9"]);
    expect(screen.getByTestId("conversacion-5").props.accessibilityLabel).toContain("3 mensajes sin leer");
    expect(screen.getByTestId("conversacion-5").props.accessibilityLabel).toContain("En línea");

    await fireEvent.press(screen.getByTestId("conversacion-5"));
    expect(mockRouter.push).toHaveBeenCalledWith("/chat/conversacion/5");
    await fireEvent.press(screen.getByTestId("nuevo-mensaje"));
    expect(mockRouter.push).toHaveBeenCalledWith("/chat/nuevo");
  });

  it("si falla la carga ofrece «Reintentar»", async () => {
    const error = new Error("red");
    error.esDeRed = true;
    chatService.conversaciones.mockRejectedValueOnce(error);
    await render(
      <ChatProvider>
        <ListaChats />
      </ChatProvider>,
    );
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Canal general")).toBeTruthy();
  });

  it("US-016: «Mis grupos» filtra la lista en el teléfono a los grupos y los de área", async () => {
    chatService.conversaciones.mockResolvedValue([
      ...CONVERSACIONES,
      { ...CONVERSACIONES[0], id: 7, tipo: "grupo", nombre: "Equipo TI" },
      { ...CONVERSACIONES[0], id: 8, tipo: "area", nombre: "Cartera" },
    ]);
    await render(
      <ChatProvider>
        <ListaChats soloGrupos />
      </ChatProvider>,
    );
    expect(await screen.findByText("Equipo TI")).toBeTruthy();
    expect(screen.getByText("Cartera")).toBeTruthy();
    expect(screen.queryByText("Canal general")).toBeNull();
    expect(screen.queryByText("Carla Ruiz")).toBeNull();
    // Sin API nueva: la misma lista de conversaciones.
    expect(chatService.conversaciones).toHaveBeenCalledTimes(1);
  });

  it("US-016: sin grupos, «Mis grupos» lo dice", async () => {
    await render(
      <ChatProvider>
        <ListaChats soloGrupos />
      </ChatProvider>,
    );
    expect(await screen.findByText("No pertenece a ningún grupo.")).toBeTruthy();
  });

  it("US-016 (CA-7): la pestaña del módulo «Chat» lleva el total de no leídos, dicho en el nombre", async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICAS}>
        <ChatProvider>
          <CabeceraDeModulos />
        </ChatProvider>
      </SafeAreaProvider>,
    );
    await act(async () => {});
    expect(screen.getByRole("tab", { name: "Chat, 3 sin leer" })).toHaveTextContent("·Chat3");
  });
});
