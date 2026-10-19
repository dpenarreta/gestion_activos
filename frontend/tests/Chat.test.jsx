import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El chat de la empresa: la barra acoplada, las pestañas que llegan
 * minimizadas, enviar, el archivo demasiado grande y la página completa.
 */

const servicio = {
  conversaciones: vi.fn(),
  novedades: vi.fn(),
  mensajes: vi.fn(),
  enviar: vi.fn(),
  leer: vi.fn(),
  directa: vi.fn(),
  crearGrupo: vi.fn(),
  directorio: vi.fn(),
  areas: vi.fn(),
  archivo: vi.fn(),
};
vi.mock("../src/api/chatService", () => ({ chatService: servicio }));

const { ChatProvider, INTERVALO_MS } =
  await import("../src/components/admin/Chat/ChatContext");
const { ChatDock } = await import("../src/components/admin/Chat/ChatDock");
const { ChatPage } = await import("../src/pages/Chat/ChatPage");

const GENERAL = {
  id: 1,
  tipo: "general",
  nombre: "Canal general",
  miembros: 40,
  no_leidos: 0,
  ultimo: null,
};
const CON_BETO = {
  id: 2,
  tipo: "directa",
  nombre: "Beto",
  miembros: 2,
  no_leidos: 0,
  ultimo: null,
};

function pintar(ruta = "/admin/activos") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <ChatProvider>
        <Routes>
          <Route path="/admin/chat" element={<ChatPage />} />
          <Route path="*" element={<p>Pantalla</p>} />
        </Routes>
        <ChatDock />
      </ChatProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  servicio.conversaciones.mockResolvedValue([GENERAL, CON_BETO]);
  servicio.novedades.mockResolvedValue({
    cursor: 10,
    mensajes: [],
    no_leidos: {},
    total_no_leidos: 0,
  });
  servicio.mensajes.mockResolvedValue({
    mensajes: [
      {
        id: 5,
        conversacion: 2,
        autor: { id: 9, nombre: "Beto" },
        propio: false,
        texto: "Hola, ¿cómo vas?",
        archivo: null,
        fecha: "2026-10-19T10:00:00Z",
      },
    ],
    hay_mas: false,
  });
  servicio.leer.mockResolvedValue({});
  servicio.directorio.mockResolvedValue([]);
  servicio.areas.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("La barra de chat", () => {
  it("abre una conversación desde el panel y envía un mensaje", async () => {
    servicio.enviar.mockResolvedValue({
      id: 11,
      conversacion: 2,
      autor: { id: 1, nombre: "Yo" },
      propio: true,
      texto: "Todo bien",
      archivo: null,
      fecha: "2026-10-19T10:01:00Z",
    });
    pintar();
    fireEvent.click(await screen.findByRole("button", { name: "Chat" }));
    const panel = screen.getByRole("region", { name: "Chat de la empresa" });
    fireEvent.click(await within(panel).findByRole("button", { name: /Beto/ }));

    const ventana = await screen.findByRole("region", { name: "Chat: Beto" });
    expect(
      await within(ventana).findByText("Hola, ¿cómo vas?"),
    ).toBeInTheDocument();
    expect(servicio.leer).toHaveBeenCalledWith(2);
    const caja = within(ventana).getByLabelText("Mensaje para Beto");
    fireEvent.change(caja, { target: { value: "Todo bien" } });
    fireEvent.keyDown(caja, { key: "Enter" });
    await waitFor(() =>
      expect(servicio.enviar).toHaveBeenCalledWith(2, "Todo bien", null),
    );
    expect(await within(ventana).findByText("Todo bien")).toBeInTheDocument();
  });

  it("un mensaje que llega abre su pestaña minimizada, con la conversación cerrada", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    servicio.conversaciones
      .mockResolvedValueOnce([GENERAL, CON_BETO])
      .mockResolvedValue([GENERAL, { ...CON_BETO, no_leidos: 1 }]);
    servicio.novedades
      .mockResolvedValueOnce({
        cursor: 10,
        mensajes: [],
        no_leidos: {},
        total_no_leidos: 0,
      })
      .mockResolvedValue({
        cursor: 12,
        mensajes: [
          {
            id: 12,
            conversacion: 2,
            autor: { id: 9, nombre: "Beto" },
            propio: false,
            texto: "¿Tienes un minuto?",
            archivo: null,
            fecha: "2026-10-19T10:02:00Z",
          },
        ],
        no_leidos: { 2: 1 },
        total_no_leidos: 1,
      });
    pintar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_MS + 100);
    });
    const ventana = await screen.findByRole("region", { name: "Chat: Beto" });
    expect(
      within(ventana).getByRole("button", { name: "Abrir" }),
    ).toBeInTheDocument();
    expect(within(ventana).queryByLabelText("Mensaje para Beto")).toBeNull();
    expect(within(ventana).getByLabelText("1 sin leer")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Chat: 1 mensajes sin leer" }),
    ).toBeInTheDocument();
  });

  it("un archivo de más de 10 MB sugiere enviarlo por correo", async () => {
    servicio.enviar.mockRejectedValue({
      response: {
        data: {
          error: {
            code: "archivo_grande",
            details: { correos: ["beto@grupolaar.com"], limite_mb: 10 },
          },
        },
      },
    });
    sessionStorage.setItem(
      "chat.ventanas",
      JSON.stringify([{ id: 2, abierta: true }]),
    );
    pintar();
    const ventana = await screen.findByRole("region", { name: "Chat: Beto" });
    const archivo = new File(["x"], "video.mp4", { type: "video/mp4" });
    fireEvent.change(
      within(ventana).getByLabelText("Adjuntar foto o archivo", {
        selector: "input",
      }),
      { target: { files: [archivo] } },
    );
    fireEvent.click(within(ventana).getByRole("button", { name: "Enviar" }));
    const enlace = await within(ventana).findByRole("link", {
      name: "beto@grupolaar.com",
    });
    expect(enlace.getAttribute("href")).toMatch(/^mailto:beto@grupolaar\.com/);
    expect(within(ventana).getByText(/supera los 10 MB/)).toBeInTheDocument();
  });
});

describe("Los colores", () => {
  it("las conversaciones grupales se distinguen de los directos", async () => {
    sessionStorage.setItem(
      "chat.ventanas",
      JSON.stringify([
        { id: 1, abierta: false },
        { id: 2, abierta: false },
      ]),
    );
    pintar();
    expect(
      await screen.findByRole("region", { name: "Chat: Canal general" }),
    ).toHaveClass("chat-ventana--grupo");
    expect(screen.getByRole("region", { name: "Chat: Beto" })).not.toHaveClass(
      "chat-ventana--grupo",
    );
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    const panel = screen.getByRole("region", { name: "Chat de la empresa" });
    expect(
      within(panel).getByRole("button", { name: /Canal general/ }),
    ).toHaveClass("chat-lista__item--grupo");
    expect(within(panel).getByRole("button", { name: /Beto/ })).not.toHaveClass(
      "chat-lista__item--grupo",
    );
  });
});

describe("La página del chat", () => {
  it("abre la conversación del enlace de la campana y oculta la barra", async () => {
    pintar("/admin/chat?c=2");
    expect(await screen.findByText("Hola, ¿cómo vas?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chat" })).toBeNull();
    await waitFor(() => expect(servicio.leer).toHaveBeenCalledWith(2));
  });
});
