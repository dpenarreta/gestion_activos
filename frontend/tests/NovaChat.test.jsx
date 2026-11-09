import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El chat de Nova (panel flotante y página) y su base de conocimiento. El
 * servicio va simulado: la conversación vive en el navegador y se reenvía
 * como `historial` en cada mensaje.
 */

const servicio = {
  me: vi.fn(),
  chat: vi.fn(),
  documentos: vi.fn(),
  subirDocumento: vi.fn(),
  eliminarDocumento: vi.fn(),
  archivoDocumento: vi.fn(),
};
vi.mock("../src/api/novaService", async (importOriginal) => ({
  ...(await importOriginal()),
  novaService: servicio,
}));
const permisos = { lista: [] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, permissions: permisos.lista } }),
}));
// El chat interno: solo importa si despliega algo hacia arriba.
const chatInterno = { valor: null };
vi.mock("../src/components/admin/Chat/ChatContext", () => ({
  useChat: () => chatInterno.valor,
}));
const modulos = { apagados: new Set() };
vi.mock("../src/modulos/EstadoModulos", async (importOriginal) => ({
  ...(await importOriginal()),
  useEstadoModulos: () => ({ apagados: modulos.apagados, veApagados: false }),
}));

const { NovaChatProvider, construirHistorial, MENSAJE_SALUD, MENSAJE_LIMITE } =
  await import("../src/components/admin/NovaChat/NovaChatContext");
const { ConversacionNova } =
  await import("../src/components/admin/NovaChat/ConversacionNova");
const { LanzadorNova } =
  await import("../src/components/admin/NovaChat/LanzadorNova");
const { ConocimientoPage } =
  await import("../src/pages/GestionHumana/Nova/ConocimientoPage");
const { NovaPage } = await import("../src/pages/GestionHumana/Nova/NovaPage");
const { getVisibleAdminMenu } =
  await import("../src/components/admin/AdminSidebar/staticAdminMenu");
const { moduloDeRuta } = await import("../src/modulos/modulos");

const ESTADO = {
  permisos: ["nova.chat"],
  chat_equipo: false,
  disponible: true,
  motivo: null,
  limite_diario: 40,
};

function conChat(ui, ruta = "/admin/gestion-humana") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <NovaChatProvider>{ui}</NovaChatProvider>
    </MemoryRouter>,
  );
}

/** Simula una pantalla táctil (`pointer: coarse`) mientras dura `fn`. */
async function enTactil(fn) {
  const original = window.matchMedia;
  window.matchMedia = (query) => ({
    ...original(query),
    matches: query.includes("pointer: coarse"),
  });
  try {
    await fn();
  } finally {
    window.matchMedia = original;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = ["nova.chat"];
  chatInterno.valor = null;
  modulos.apagados = new Set();
  servicio.me.mockResolvedValue(ESTADO);
});

describe("historial del chat", () => {
  it("solo reenvía preguntas con su respuesta, sin avisos, con tope", () => {
    const mensajes = [
      { rol: "usuario", texto: "a" },
      { rol: "aviso", texto: "Sin IA" },
      { rol: "usuario", texto: "b" },
      { rol: "modelo", texto: "B" },
      { rol: "usuario", texto: "c" },
      { rol: "modelo", texto: "C" },
    ];
    expect(construirHistorial(mensajes)).toEqual([
      { rol: "usuario", texto: "b" },
      { rol: "modelo", texto: "B" },
      { rol: "usuario", texto: "c" },
      { rol: "modelo", texto: "C" },
    ]);
    expect(construirHistorial(mensajes, 3)).toEqual([
      { rol: "usuario", texto: "c" },
      { rol: "modelo", texto: "C" },
    ]);
  });
});

describe("conversación", () => {
  it("Enter envía, Shift+Enter no, y la respuesta llega al registro", async () => {
    let responder;
    servicio.chat.mockReturnValueOnce(
      new Promise((r) => {
        responder = r;
      }),
    );
    conChat(<ConversacionNova />);
    expect(await screen.findByText(/nova es una ia/i)).toBeInTheDocument();
    expect(screen.getByText(/seudónimos/i)).toBeInTheDocument();

    const caja = screen.getByLabelText("Mensaje para Nova");
    fireEvent.change(caja, { target: { value: "Hola" } });
    fireEvent.keyDown(caja, { key: "Enter", shiftKey: true });
    expect(servicio.chat).not.toHaveBeenCalled();

    fireEvent.keyDown(caja, { key: "Enter" });
    expect(servicio.chat).toHaveBeenCalledWith({
      modo: "general",
      mensaje: "Hola",
      historial: [],
    });
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(
      /nova está escribiendo/i,
    );
    expect(caja).toHaveValue("");
    await act(async () =>
      responder({
        con_ia: true,
        respuesta: "Buenos días.",
        fuentes: [{ documento_id: 3, titulo: "Reglamento", pagina: 2 }],
      }),
    );
    const registro = screen.getByRole("log", {
      name: "Conversación con Nova",
    });
    expect(within(registro).getByText("Hola")).toBeInTheDocument();
    expect(within(registro).getByText("Buenos días.")).toBeInTheDocument();
    expect(
      within(registro).getByText("Reglamento, pág. 2"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nova está escribiendo/i)).toBeNull();

    // El segundo mensaje lleva la conversación anterior.
    servicio.chat.mockResolvedValueOnce({
      con_ia: false,
      mensaje: "Alcanzó el límite.",
    });
    fireEvent.change(caja, { target: { value: "¿Y ahora?" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    expect(servicio.chat).toHaveBeenLastCalledWith({
      modo: "general",
      mensaje: "¿Y ahora?",
      historial: [
        { rol: "usuario", texto: "Hola" },
        { rol: "modelo", texto: "Buenos días." },
      ],
    });
    expect(await screen.findByText("Alcanzó el límite.")).toBeInTheDocument();
  });

  it("un mensaje vacío avisa sin enviar", async () => {
    conChat(<ConversacionNova />);
    await screen.findByText(/nova es una ia/i);
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /escriba su mensaje/i,
    );
    expect(servicio.chat).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Mensaje para Nova")).toHaveFocus();
  });

  it("el modo Equipo solo aparece para quien lo tiene", async () => {
    conChat(<ConversacionNova />);
    await screen.findByText(/nova es una ia/i);
    const modos = () =>
      within(screen.getByLabelText("Modo"))
        .getAllByRole("option")
        .map((o) => o.textContent);
    expect(modos()).toEqual(["General", "Mis tareas"]);
  });

  it("con el modo Equipo, cada modo lleva su conversación", async () => {
    servicio.me.mockResolvedValue({ ...ESTADO, chat_equipo: true });
    servicio.chat.mockResolvedValue({ con_ia: true, respuesta: "Listo." });
    conChat(<ConversacionNova />);
    await screen.findByRole("option", { name: "Mi equipo" });
    fireEvent.change(screen.getByLabelText("Modo"), {
      target: { value: "equipo" },
    });
    fireEvent.change(screen.getByLabelText("Mensaje para Nova"), {
      target: { value: "¿Cómo va el equipo?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    expect(servicio.chat).toHaveBeenCalledWith(
      expect.objectContaining({ modo: "equipo" }),
    );
    expect(await screen.findByText("Listo.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Modo"), {
      target: { value: "general" },
    });
    expect(screen.queryByText("Listo.")).toBeNull();
  });

  it("dice por qué Nova no está disponible", async () => {
    servicio.me.mockResolvedValue({
      ...ESTADO,
      disponible: false,
      motivo: "sin_clave",
    });
    conChat(<ConversacionNova />);
    const aviso = await screen.findByText(
      /no está configurada en este entorno/i,
    );
    const region = aviso.closest('[role="status"]');
    expect(region).toHaveClass("mz-alert");
    expect(aviso).toHaveTextContent(/pida al administrador/i);
    // Sin sugerencias y con la caja de solo lectura, descrita por el aviso.
    expect(screen.queryByText(/puede empezar con una de estas/i)).toBeNull();
    const caja = screen.getByLabelText("Mensaje para Nova");
    expect(caja).toHaveAttribute("readonly");
    expect(caja.getAttribute("aria-describedby")).toContain(region.id);
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    expect(servicio.chat).not.toHaveBeenCalled();
  });

  it("en Mis tareas un mensaje sobre salud queda «No se envió» y sugiere el modo General", async () => {
    servicio.chat.mockResolvedValueOnce({
      con_ia: false,
      motivo: "bloqueado",
      causa: "salud",
      mensaje: "Por privacidad…",
    });
    conChat(<ConversacionNova />);
    await screen.findByText(/nova es una ia/i);
    fireEvent.change(screen.getByLabelText("Modo"), {
      target: { value: "tareas" },
    });
    expect(MENSAJE_SALUD).toMatch(
      /Si es una pregunta general sobre políticas, hágala en el modo General\./,
    );
    const caja = screen.getByLabelText("Mensaje para Nova");
    fireEvent.change(caja, { target: { value: "Tengo reposo médico" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    const registro = screen.getByRole("log");
    expect(
      await within(registro).findByText(MENSAJE_SALUD),
    ).toBeInTheDocument();
    expect(within(registro).getByText("No se envió")).toBeInTheDocument();
    expect(within(registro).getByText("Aviso:")).toHaveClass("visually-hidden");
    expect(caja).toHaveValue("Tengo reposo médico");
    expect(screen.queryByRole("button", { name: /reintentar/i })).toBeNull();
  });

  it("al llegar al límite lo dice y pone al día el estado", async () => {
    servicio.chat.mockResolvedValueOnce({
      con_ia: false,
      motivo: "limite",
      mensaje: "Alcanzó el límite de 40 consultas…",
    });
    conChat(<ConversacionNova />);
    await screen.findByText(/nova es una ia/i);
    fireEvent.change(screen.getByLabelText("Mensaje para Nova"), {
      target: { value: "Hola" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    expect(await screen.findByText(MENSAJE_LIMITE)).toBeInTheDocument();
    expect(servicio.me).toHaveBeenCalledTimes(2);
  });

  it("sin red: alerta con «Reintentar» que vuelve a enviar", async () => {
    servicio.chat.mockRejectedValueOnce(new Error("Network Error"));
    conChat(<ConversacionNova />);
    await screen.findByText(/nova es una ia/i);
    const caja = screen.getByLabelText("Mensaje para Nova");
    fireEvent.change(caja, { target: { value: "Hola" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    const reintentar = await screen.findByRole("button", {
      name: /reintentar/i,
    });
    expect(reintentar.closest('[role="alert"]')).toHaveClass("mz-alert--bad");
    expect(screen.getByText("No se envió")).toBeInTheDocument();
    expect(caja).toHaveValue("Hola");

    servicio.chat.mockResolvedValueOnce({ con_ia: true, respuesta: "Hola." });
    await act(async () => {
      fireEvent.click(reintentar);
    });
    expect(servicio.chat).toHaveBeenCalledTimes(2);
    expect(servicio.chat).toHaveBeenLastCalledWith(
      expect.objectContaining({ mensaje: "Hola", historial: [] }),
    );
    expect(await screen.findByText("Hola.")).toBeInTheDocument();
    expect(screen.queryByText("No se envió")).toBeNull();
    expect(screen.queryByRole("button", { name: /reintentar/i })).toBeNull();
    expect(caja).toHaveValue("");
  });

  it("si ya escribió otro mensaje, el que falló no lo pisa", async () => {
    let fallar;
    servicio.chat.mockReturnValueOnce(
      new Promise((_r, rechazar) => {
        fallar = rechazar;
      }),
    );
    conChat(<ConversacionNova />);
    await screen.findByText(/nova es una ia/i);
    const caja = screen.getByLabelText("Mensaje para Nova");
    fireEvent.change(caja, { target: { value: "Primero" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    fireEvent.change(caja, { target: { value: "Segundo" } });
    await act(async () => fallar(new Error("Network Error")));
    expect(caja).toHaveValue("Segundo");
    expect(screen.getByText("No se envió")).toBeInTheDocument();
  });

  it("el exceso de caracteres se anuncia como alerta", async () => {
    conChat(<ConversacionNova />);
    await screen.findByText(/nova es una ia/i);
    fireEvent.change(screen.getByLabelText("Mensaje para Nova"), {
      target: { value: "a".repeat(2001) },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "El mensaje tiene 2001 caracteres y el máximo es 2000.",
    );
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
    expect(servicio.chat).not.toHaveBeenCalled();
  });

  it("en pantallas táctiles Enter no envía y no se muestra la ayuda", async () => {
    await enTactil(async () => {
      conChat(<ConversacionNova />);
      await screen.findByText(/nova es una ia/i);
      expect(screen.queryByText(/shift\+enter/i)).toBeNull();
      const caja = screen.getByLabelText("Mensaje para Nova");
      fireEvent.change(caja, { target: { value: "Hola" } });
      fireEvent.keyDown(caja, { key: "Enter" });
      expect(servicio.chat).not.toHaveBeenCalled();
    });
  });

  it("el aviso de privacidad dice qué pasa con la salud en cada modo", async () => {
    servicio.me.mockResolvedValue({ ...ESTADO, chat_equipo: true });
    conChat(<ConversacionNova />);
    expect(
      await screen.findByText(
        "Nova es una IA y puede equivocarse. No se envían nombres. Puede preguntar por políticas sobre licencias o permisos médicos, pero no escriba datos de salud suyos ni de otras personas.",
      ),
    ).toBeInTheDocument();
    await screen.findByRole("option", { name: "Mi equipo" });
    for (const modo of ["tareas", "equipo"]) {
      fireEvent.change(screen.getByLabelText("Modo"), {
        target: { value: modo },
      });
      expect(
        screen.getByText(
          "Nova es una IA y puede equivocarse. No se envían nombres. En este modo no se envían datos de salud.",
        ),
      ).toBeInTheDocument();
    }
  });

  it("el aviso de privacidad es una línea con el detalle plegado", async () => {
    conChat(<ConversacionNova />);
    expect(
      await screen.findByText(/^Nova es una IA y puede equivocarse\./),
    ).toBeInTheDocument();
    const detalle = screen.getByText("Cómo se protegen sus datos");
    expect(detalle.tagName).toBe("SUMMARY");
    expect(
      screen.getByText(/cada modo tiene su propia conversación/i),
    ).toBeInTheDocument();
  });
});

describe("botón flotante", () => {
  it("no aparece sin permiso", () => {
    permisos.lista = [];
    conChat(<LanzadorNova />);
    expect(screen.queryByRole("button", { name: /nova/i })).toBeNull();
  });

  it("no aparece en la página de Nova", () => {
    conChat(<LanzadorNova />, "/admin/nova");
    expect(screen.queryByRole("button", { name: /nova/i })).toBeNull();
  });

  it("se oculta mientras el chat interno está desplegado", () => {
    chatInterno.valor = { abierto: true };
    conChat(<LanzadorNova />);
    expect(screen.queryByRole("button", { name: /nova/i })).toBeNull();
  });

  it("no aparece con Gestión Humana apagado", () => {
    modulos.apagados = new Set(["gestion_humana"]);
    conChat(<LanzadorNova />);
    expect(screen.queryByRole("button", { name: /nova/i })).toBeNull();
  });

  it("«Abrir en página» lleva el foco a la caja de la página", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      conChat(
        <>
          <LanzadorNova />
          <Routes>
            <Route path="/admin/nova" element={<NovaPage />} />
            <Route path="*" element={null} />
          </Routes>
        </>,
      );
      fireEvent.click(screen.getByRole("button", { name: /nova/i }));
      const panel = await screen.findByRole("dialog", { name: "Nova" });
      fireEvent.click(
        within(panel).getByRole("link", { name: /abrir en página/i }),
      );
      await act(async () => {
        vi.advanceTimersByTime(10);
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByRole("heading", { name: "Nova" })).toBeInTheDocument();
      expect(screen.getByLabelText("Mensaje para Nova")).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it("abre el panel con el foco en la caja y lo cierra", async () => {
    conChat(<LanzadorNova />);
    const boton = screen.getByRole("button", { name: /nova/i });
    fireEvent.click(boton);
    const panel = await screen.findByRole("dialog", { name: "Nova" });
    expect(within(panel).getByLabelText("Mensaje para Nova")).toHaveFocus();
    fireEvent.click(within(panel).getByRole("button", { name: "Cerrar Nova" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(boton).toHaveFocus();
  });
});

describe("base de conocimiento", () => {
  const DOCUMENTO = {
    id: 5,
    titulo: "Reglamento interno",
    nombre_original: "reglamento.pdf",
    tamano_bytes: 204800,
    paginas: 12,
    fragmentos: 20,
    subido_por: "Adela",
    creado: "2026-11-09T10:00:00-05:00",
  };

  it("quien solo ve no tiene subir ni eliminar", async () => {
    permisos.lista = ["nova.conocimiento_ver"];
    servicio.documentos.mockResolvedValue({
      resultados: [DOCUMENTO],
      gestionar: false,
    });
    render(<ConocimientoPage />);
    expect(await screen.findByText("reglamento.pdf")).toBeInTheDocument();
    expect(screen.queryByText(/agregar un documento/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /eliminar/i })).toBeNull();
  });

  it("elimina con confirmación (sin window.confirm)", async () => {
    permisos.lista = ["nova.conocimiento_gestionar"];
    const confirmar = vi.spyOn(window, "confirm");
    servicio.documentos.mockResolvedValue({
      resultados: [DOCUMENTO],
      gestionar: true,
    });
    servicio.eliminarDocumento.mockResolvedValue({});
    render(<ConocimientoPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: /eliminar reglamento interno/i,
      }),
    );
    const dialogo = screen.getByRole("dialog", { name: "Eliminar documento" });
    servicio.documentos.mockResolvedValue({ resultados: [], gestionar: true });
    await act(async () => {
      fireEvent.click(
        within(dialogo).getByRole("button", { name: "Eliminar" }),
      );
    });
    expect(servicio.eliminarDocumento).toHaveBeenCalledWith(5);
    expect(confirmar).not.toHaveBeenCalled();
    const exito = await screen.findByText("Se eliminó «Reglamento interno».");
    expect(exito.closest('[role="status"]')).toBeInTheDocument();
    expect(exito.closest(".mz-alert")).toHaveClass("mz-alert--ok");
  });

  it("si no se puede abrir, lo dice como alerta", async () => {
    permisos.lista = ["nova.conocimiento_ver"];
    servicio.documentos.mockResolvedValue({
      resultados: [DOCUMENTO],
      gestionar: false,
    });
    servicio.archivoDocumento.mockRejectedValue(new Error("Network Error"));
    render(<ConocimientoPage />);
    const ver = await screen.findByRole("button", {
      name: /ver reglamento interno/i,
    });
    await act(async () => {
      fireEvent.click(ver);
    });
    const alerta = await screen.findByText(/sin conexión con el servidor/i);
    expect(alerta.closest('[role="alert"]')).toBeInTheDocument();
    expect(alerta.closest(".mz-alert")).toHaveClass("mz-alert--bad");
  });

  it("busca en vivo y sube un PDF", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      permisos.lista = ["nova.conocimiento_gestionar"];
      servicio.documentos.mockResolvedValue({
        resultados: [],
        gestionar: true,
      });
      servicio.subirDocumento.mockResolvedValue({
        ...DOCUMENTO,
        titulo: "Política",
      });
      render(<ConocimientoPage />);
      fireEvent.change(await screen.findByRole("searchbox"), {
        target: { value: "politica" },
      });
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(servicio.documentos).toHaveBeenLastCalledWith("politica");

      const archivo = new File(["%PDF-1.4"], "politica.pdf", {
        type: "application/pdf",
      });
      fireEvent.change(screen.getByLabelText("Documento PDF"), {
        target: { files: [archivo] },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /subir/i }));
      });
      expect(servicio.subirDocumento).toHaveBeenCalledWith(archivo, "");
      expect(
        await screen.findByText(/se agregó «política»/i),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("menú de Nova", () => {
  it("la entrada del chat se llama «Conversar con Nova»", () => {
    const menu = getVisibleAdminMenu(
      ["nova.chat", "nova.conocimiento_ver"],
      "gestion_humana",
    );
    const grupo = menu.find((item) => item.id === "gh-nova");
    expect(grupo.children.map((c) => c.name)).toEqual([
      "Conversar con Nova",
      "Base de conocimiento",
    ]);
  });
});

describe("módulo de las rutas de Nova", () => {
  it("es Gestión Humana", () => {
    expect(moduloDeRuta("/admin/nova")).toBe("gestion_humana");
    expect(moduloDeRuta("/admin/nova/conocimiento")).toBe("gestion_humana");
    expect(moduloDeRuta("/admin/novatos")).toBe("activos");
  });
});
