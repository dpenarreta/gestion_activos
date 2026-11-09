import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * «Responder solo con las fuentes» (09/11/2026): el aviso «sin_fuentes» del
 * chat, la descripción del modo General, la base vacía, las fuentes que abren
 * el PDF en la página citada y el interruptor de la base de conocimiento. El
 * servicio va simulado y el visor también (pdf.js no corre en jsdom).
 */

const servicio = {
  me: vi.fn(),
  chat: vi.fn(),
  documentos: vi.fn(),
  subirDocumento: vi.fn(),
  eliminarDocumento: vi.fn(),
  archivoDocumento: vi.fn(),
  ajustes: vi.fn(),
  cambiarAjustes: vi.fn(),
};
vi.mock("../src/api/novaService", async (importOriginal) => ({
  ...(await importOriginal()),
  novaService: servicio,
}));
const permisos = { lista: [] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, permissions: permisos.lista } }),
}));
vi.mock("../src/components/common/VisorPdf/VisorPdf", () => ({
  VisorPdf: ({ titulo, paginaInicial, onCerrar }) => (
    <div role="dialog" aria-label={titulo}>
      <p>Página inicial {paginaInicial}</p>
      <button type="button" onClick={onCerrar}>
        Cerrar visor
      </button>
    </div>
  ),
}));

const { NovaChatProvider, DESCRIPCION_SOLO_FUENTES } =
  await import("../src/components/admin/NovaChat/NovaChatContext");
const { ConversacionNova } =
  await import("../src/components/admin/NovaChat/ConversacionNova");
const { ConocimientoPage } =
  await import("../src/pages/GestionHumana/Nova/ConocimientoPage");

const ESTADO = {
  permisos: ["nova.chat"],
  chat_equipo: false,
  disponible: true,
  motivo: null,
  limite_diario: 40,
  solo_fuentes: true,
  hay_documentos: true,
};

const SIN_FUENTES =
  "No encontré esa información en los documentos de la base de conocimiento. Pruebe con otras palabras o consulte a Gestión Humana.";

function conChat(ui) {
  return render(
    <MemoryRouter>
      <NovaChatProvider>{ui}</NovaChatProvider>
    </MemoryRouter>,
  );
}

async function preguntar(texto) {
  await screen.findByText(/nova es una ia/i);
  const caja = screen.getByLabelText("Mensaje para Nova");
  fireEvent.change(caja, { target: { value: texto } });
  fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
  return caja;
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = ["nova.chat", "nova.conocimiento_ver"];
  servicio.me.mockResolvedValue(ESTADO);
});

describe("chat con «solo fuentes»", () => {
  it("el modo General dice que responde solo con los documentos", async () => {
    conChat(<ConversacionNova />);
    expect(
      await screen.findByText(new RegExp(DESCRIPCION_SOLO_FUENTES)),
    ).toBeInTheDocument();
    expect(DESCRIPCION_SOLO_FUENTES).toBe(
      "Nova responde solo con los documentos de la base de conocimiento.",
    );
    // En Mis tareas, la descripción propia del modo.
    fireEvent.change(screen.getByLabelText("Modo"), {
      target: { value: "tareas" },
    });
    expect(screen.queryByText(new RegExp(DESCRIPCION_SOLO_FUENTES))).toBeNull();
  });

  it("con el ajuste desactivado vuelve la descripción de siempre", async () => {
    servicio.me.mockResolvedValue({ ...ESTADO, solo_fuentes: false });
    conChat(<ConversacionNova />);
    expect(
      await screen.findByText(/preguntas generales y sobre los documentos/i),
    ).toBeInTheDocument();
  });

  it("«sin_fuentes» es un aviso informativo, no un error", async () => {
    servicio.chat.mockResolvedValueOnce({
      con_ia: false,
      motivo: "sin_fuentes",
      causa: null,
      mensaje: SIN_FUENTES,
      fuentes: [],
    });
    conChat(<ConversacionNova />);
    const caja = await preguntar("¿Cuál es la capital de Francia?");
    const registro = screen.getByRole("log");
    const aviso = await within(registro).findByText(SIN_FUENTES);
    expect(aviso.closest("li")).toHaveClass("nova-mensaje--aviso");
    expect(within(registro).queryByText("No se envió")).toBeNull();
    expect(caja).toHaveValue("");
    expect(screen.queryByRole("button", { name: /reintentar/i })).toBeNull();
    expect(
      within(registro).getByText("¿Cuál es la capital de Francia?"),
    ).toBeInTheDocument();
  });

  it("con la base vacía lo avisa antes de escribir, con enlace para quien gestiona", async () => {
    servicio.me.mockResolvedValue({ ...ESTADO, hay_documentos: false });
    permisos.lista = ["nova.chat", "nova.conocimiento_gestionar"];
    conChat(<ConversacionNova />);
    expect(
      await screen.findByText(
        /todavía no hay documentos en la base de conocimiento/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Subir documentos a la base de conocimiento",
      }),
    ).toHaveAttribute("href", "/admin/nova/conocimiento");
    // En Mis tareas no aplica (sus datos son fuente).
    fireEvent.change(screen.getByLabelText("Modo"), {
      target: { value: "tareas" },
    });
    expect(
      screen.queryByText(/todavía no hay documentos en la base/i),
    ).toBeNull();
  });

  it("con la base vacía, quien no gestiona ve el aviso sin enlace", async () => {
    servicio.me.mockResolvedValue({ ...ESTADO, hay_documentos: false });
    conChat(<ConversacionNova />);
    expect(
      await screen.findByText(
        /todavía no hay documentos en la base de conocimiento/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /subir documentos/i }),
    ).toBeNull();
  });

  it("las fuentes citadas abren el PDF en la página indicada", async () => {
    const blob = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    servicio.archivoDocumento.mockResolvedValue(blob);
    servicio.chat.mockResolvedValueOnce({
      con_ia: true,
      respuesta: "Son quince días [Reglamento interno, pág. 3].",
      fuentes: [
        {
          documento_id: 7,
          titulo: "Reglamento interno",
          pagina: 3,
          citada: true,
        },
        {
          documento_id: 7,
          titulo: "Reglamento interno",
          pagina: 5,
          citada: false,
        },
      ],
    });
    conChat(<ConversacionNova />);
    await preguntar("¿Cuántos días de vacaciones tengo?");
    expect(await screen.findByText("Fuentes citadas:")).toBeInTheDocument();
    expect(screen.queryByText(/reglamento interno, pág\. 5/i)).toBeNull();
    const enlace = screen.getByRole("button", {
      name: "Abrir Reglamento interno, pág. 3",
    });
    await act(async () => {
      fireEvent.click(enlace);
    });
    expect(servicio.archivoDocumento).toHaveBeenCalledWith(7);
    const visor = screen.getByRole("dialog", { name: "Reglamento interno" });
    expect(within(visor).getByText("Página inicial 3")).toBeInTheDocument();
    fireEvent.click(
      within(visor).getByRole("button", { name: "Cerrar visor" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sin permiso de ver la base, las fuentes son texto con su página", async () => {
    permisos.lista = ["nova.chat"];
    servicio.chat.mockResolvedValueOnce({
      con_ia: true,
      respuesta: "Son quince días.",
      fuentes: [
        {
          documento_id: 7,
          titulo: "Reglamento interno",
          pagina: 3,
          citada: false,
        },
      ],
    });
    conChat(<ConversacionNova />);
    await preguntar("¿Cuántos días de vacaciones tengo?");
    expect(
      await screen.findByText("Documentos consultados:"),
    ).toBeInTheDocument();
    expect(screen.getByText("Reglamento interno, pág. 3")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /abrir reglamento/i }),
    ).toBeNull();
  });

  it("si la fuente no se puede abrir, lo dice como alerta", async () => {
    servicio.archivoDocumento.mockRejectedValue(new Error("Network Error"));
    servicio.chat.mockResolvedValueOnce({
      con_ia: true,
      respuesta: "Son quince días.",
      fuentes: [
        {
          documento_id: 7,
          titulo: "Reglamento interno",
          pagina: 3,
          citada: false,
        },
      ],
    });
    conChat(<ConversacionNova />);
    await preguntar("¿Cuántos días de vacaciones tengo?");
    const enlace = await screen.findByRole("button", {
      name: "Abrir Reglamento interno, pág. 3",
    });
    await act(async () => {
      fireEvent.click(enlace);
    });
    const alerta = await screen.findByText(/sin conexión con el servidor/i);
    expect(alerta.closest('[role="alert"]')).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("interruptor de la base de conocimiento", () => {
  const LISTA = { resultados: [], gestionar: true, solo_fuentes: true };

  it("quien gestiona lo ve encendido, con su descripción, y lo apaga", async () => {
    permisos.lista = ["nova.conocimiento_gestionar"];
    servicio.documentos.mockResolvedValue(LISTA);
    servicio.cambiarAjustes.mockResolvedValue({
      solo_fuentes: false,
      gestionar: true,
    });
    render(<ConocimientoPage />);
    const interruptor = await screen.findByRole("switch", {
      name: "Responder solo con las fuentes",
    });
    expect(interruptor).toBeChecked();
    expect(interruptor).toHaveAccessibleDescription(
      "Encendido: Nova responde solo con estos documentos y, si no encuentra la respuesta en ellos, lo dice. Apagado: puede completar con conocimiento general y cita los documentos que use.",
    );
    await act(async () => {
      fireEvent.click(interruptor);
    });
    expect(servicio.cambiarAjustes).toHaveBeenCalledWith({
      solo_fuentes: false,
    });
    expect(interruptor).not.toBeChecked();
    const exito = await screen.findByText(/Listo: si los documentos no cubren/i);
    expect(exito.closest('[role="status"]')).toBeInTheDocument();
  });

  it("si no se guarda, sigue como estaba y lo dice como alerta", async () => {
    permisos.lista = ["nova.conocimiento_gestionar"];
    servicio.documentos.mockResolvedValue(LISTA);
    servicio.cambiarAjustes.mockRejectedValue(new Error("Network Error"));
    render(<ConocimientoPage />);
    const interruptor = await screen.findByRole("switch", {
      name: "Responder solo con las fuentes",
    });
    await act(async () => {
      fireEvent.click(interruptor);
    });
    expect(interruptor).toBeChecked();
    const alerta = await screen.findByText(/sin conexión con el servidor/i);
    expect(alerta.closest('[role="alert"]')).toBeInTheDocument();
  });

  it("quien solo ve la base no tiene el interruptor", async () => {
    permisos.lista = ["nova.conocimiento_ver"];
    servicio.documentos.mockResolvedValue({ ...LISTA, gestionar: false });
    render(<ConocimientoPage />);
    expect(
      await screen.findByText(/todavía no hay documentos/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
