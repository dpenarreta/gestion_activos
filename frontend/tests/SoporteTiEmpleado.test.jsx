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
 * «Soporte TI» del empleado, revisión final UX/UI (28/10/2026): «Mis tickets»
 * con cargando, error y reintentar; la ficha que distingue la carga inicial
 * fallida del refresco fallido; el aviso de adjuntos omitidos y la encuesta
 * con radios nativos.
 */

const servicio = {
  miChat: vi.fn(() => Promise.resolve({ abierto: false, mensajes: [] })),
  escribirMiChat: vi.fn(),
  chatTicket: vi.fn(() => Promise.resolve({ abierto: false, mensajes: [] })),
  escribirChatTicket: vi.fn(),
  misTickets: vi.fn(),
  miTicket: vi.fn(),
  responderMiTicket: vi.fn(),
  encuestaMiTicket: vi.fn(),
  solicitar: vi.fn(),
  crearTicket: vi.fn(),
  formularioInterno: vi.fn(),
  personas: vi.fn(),
  registrar: vi.fn(),
};
vi.mock("../src/api/soporteService", () => ({ soporteService: servicio }));
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { permissions: [] }, isAuthenticated: true }),
}));

const { AyudaPage } = await import("../src/pages/Ayuda/AyudaPage");
const { MiTicket } = await import("../src/pages/Ayuda/MiTicket");
const { NuevoTicket } = await import("../src/pages/Ayuda/NuevoTicket");
const { RegistrarTicket } =
  await import("../src/pages/Soporte/RegistrarTicket");

function pintar(elemento, ruta, patron) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path={patron} element={elemento} />
      </Routes>
    </MemoryRouter>,
  );
}

function archivos(n) {
  return Array.from(
    { length: n },
    (_, i) => new File(["x"], `captura-${i + 1}.png`, { type: "image/png" }),
  );
}

const TICKET_LISTA = {
  id: 42,
  numero: "TCK-2026-000042",
  caso: "No enciende",
  categoria: "Hardware",
  estado: "en_cola",
  estado_display: "En cola",
  creado: "2026-10-16T10:00:00Z",
  posicion: 3,
};

const SEGUIMIENTO = {
  id: 42,
  numero: "TCK-2026-000042",
  estado: "en_cola",
  estado_display: "En cola",
  posicion: 3,
  categoria: "Hardware",
  caso: "No enciende",
  prioridad_display: "Alta",
  descripcion: "No prende",
  atiende: "",
  creado: "2026-10-16T10:00:00Z",
  adjuntos: [],
  mensajes: [],
  puede_responder: true,
  puede_confirmar: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Soporte TI: Mis tickets", () => {
  it("dice que carga, muestra el error con Reintentar y luego los tickets", async () => {
    servicio.misTickets
      .mockRejectedValueOnce(new Error("caída"))
      .mockResolvedValueOnce([TICKET_LISTA]);
    pintar(<AyudaPage />, "/admin/ayuda?vista=mios", "/admin/ayuda");

    // Mientras carga no hay una tabla vacía: se dice que carga.
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
    expect(screen.getByRole("tab", { name: "Mis tickets" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("No se pudieron cargar sus solicitudes.");
    fireEvent.click(within(alerta).getByRole("button", { name: "Reintentar" }));

    expect(
      await screen.findByRole("link", {
        name: "Ver el ticket TCK-2026-000042",
      }),
    ).toHaveAttribute("href", "/admin/ayuda/tickets/42");
    expect(servicio.misTickets).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("las pestañas son las comunes: panel asociado y flechas", async () => {
    servicio.misTickets.mockResolvedValue([]);
    servicio.solicitar.mockReturnValue(new Promise(() => {}));
    pintar(<AyudaPage />, "/admin/ayuda", "/admin/ayuda");

    const nuevo = screen.getByRole("tab", { name: "Nuevo ticket" });
    expect(nuevo).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      nuevo.id,
    );
    fireEvent.keyDown(nuevo, { key: "ArrowRight" });
    expect(
      await screen.findByText("Todavía no ha pedido ayuda."),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Mis tickets" })).toHaveFocus();
  });
});

describe("Soporte TI: la ficha de un ticket propio", () => {
  it("dice que carga y, si la carga falla, deja reintentar", async () => {
    servicio.miTicket
      .mockRejectedValueOnce(new Error("caída"))
      .mockResolvedValueOnce(SEGUIMIENTO);
    pintar(<MiTicket />, "/admin/ayuda/tickets/42", "/admin/ayuda/tickets/:id");

    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("No se pudo cargar su ticket.");
    fireEvent.click(within(alerta).getByRole("button", { name: "Reintentar" }));

    expect(
      await screen.findByRole("heading", { name: "Ticket TCK-2026-000042" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("si falla el refresco conserva el ticket y no dice «No encontramos»", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    servicio.miTicket
      .mockResolvedValueOnce(SEGUIMIENTO)
      .mockRejectedValueOnce(new Error("caída"))
      .mockResolvedValueOnce(SEGUIMIENTO);
    pintar(<MiTicket />, "/admin/ayuda/tickets/42", "/admin/ayuda/tickets/:id");

    expect(
      await screen.findByRole("heading", { name: "Ticket TCK-2026-000042" }),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(servicio.miTicket).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("heading", { name: "Ticket TCK-2026-000042" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No prende")).toBeInTheDocument();
    expect(screen.queryByText(/No encontramos/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Dentro de una región de estado siempre montada: se anuncia al aparecer.
    expect(
      screen
        .getByText(/No se pudo actualizar el ticket/)
        .closest('[role="status"]'),
    ).not.toBeNull();

    // El siguiente refresco bueno quita el aviso.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(
      screen.queryByText(/No se pudo actualizar el ticket/),
    ).not.toBeInTheDocument();
  });

  it("avisa cuántos adjuntos se omitieron al pasar de tres", async () => {
    servicio.miTicket.mockResolvedValue(SEGUIMIENTO);
    servicio.responderMiTicket.mockResolvedValue(SEGUIMIENTO);
    pintar(<MiTicket />, "/admin/ayuda/tickets/42", "/admin/ayuda/tickets/:id");

    const entrada = await screen.findByLabelText(/^Adjuntar captura o archivo/);
    fireEvent.change(entrada, { target: { files: archivos(5) } });
    expect(
      screen.getByText("Máx. 3 archivos; se omitieron 2."),
    ).toBeInTheDocument();
    expect(entrada).toHaveAccessibleDescription(
      "Máx. 3 archivos; se omitieron 2.",
    );

    fireEvent.change(
      screen.getByLabelText(/^(Responder|¿Quiere agregar algo\?)$/),
      {
        target: { value: "Van las capturas" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() =>
      expect(servicio.responderMiTicket).toHaveBeenCalledWith(
        "42",
        "Van las capturas",
        expect.any(Array),
      ),
    );
    expect(servicio.responderMiTicket.mock.calls[0][2]).toHaveLength(3);
    await waitFor(() =>
      expect(screen.queryByText(/se omitieron/)).not.toBeInTheDocument(),
    );
  });

  it("la encuesta usa radios nativos con nombre de grupo y explica el botón", async () => {
    servicio.miTicket.mockResolvedValue({
      ...SEGUIMIENTO,
      estado: "cerrado",
      estado_display: "Cerrado",
      posicion: null,
      puede_responder: false,
      puede_encuestar: true,
      encuesta: null,
    });
    pintar(<MiTicket />, "/admin/ayuda/tickets/42", "/admin/ayuda/tickets/:id");

    const grupo = await screen.findByRole("radiogroup", {
      name: "Calificación del servicio",
    });
    const estrellas = within(grupo).getAllByRole("radio");
    expect(estrellas).toHaveLength(5);
    // Radios nativos del mismo grupo: una sola parada de Tab y flechas.
    for (const estrella of estrellas) {
      expect(estrella.tagName).toBe("INPUT");
      expect(estrella).toHaveAttribute("type", "radio");
      expect(estrella).toHaveAttribute("name", "calificacion");
    }

    // El botón queda activo y dice qué falta al pulsarlo, junto a él
    // (antes deshabilitado: el motivo no se anunciaba).
    const enviar = screen.getByRole("button", { name: "Enviar encuesta" });
    expect(enviar).toBeEnabled();
    fireEvent.click(enviar);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Elija una calificación de 1 a 5 estrellas.",
    );

    fireEvent.click(within(grupo).getByRole("radio", { name: /^4 de 5/ }));
    expect(
      within(grupo).getByRole("radio", { name: "4 de 5: Satisfecho" }),
    ).toBeChecked();
    fireEvent.click(enviar);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Indique si su requerimiento se resolvió.",
    );
    fireEvent.click(screen.getByLabelText("Sí"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Aviso de adjuntos omitidos al crear el ticket", () => {
  it("en «Nuevo ticket»", async () => {
    servicio.solicitar.mockResolvedValue({
      empresa: "LaarCourier",
      disponible: true,
      agencias: [],
      areas: [],
      categorias: [],
      campos: [],
      mis_datos: {
        nombre: "Carla Ordóñez",
        correo: "carla@grupolaar.com",
        telefono: "0994182273",
        area: { id: 2, nombre: "Cobranzas" },
        agencia: { id: 1, nombre: "Loja · Agencia" },
        cargo: null,
        cargos: [],
        faltan: [],
      },
    });
    pintar(<NuevoTicket />, "/admin/ayuda", "/admin/ayuda");

    const entrada = await screen.findByLabelText(/^Capturas o archivos/);
    fireEvent.change(entrada, { target: { files: archivos(4) } });
    expect(
      screen.getByText("Máx. 3 archivos; se omitieron 1."),
    ).toBeInTheDocument();
    expect(entrada).toHaveAccessibleDescription(
      /Máx\. 3 archivos; se omitieron 1\./,
    );

    fireEvent.change(entrada, { target: { files: archivos(2) } });
    expect(screen.queryByText(/se omitieron/)).not.toBeInTheDocument();
  });

  it("en el alta interna de la mesa", async () => {
    servicio.formularioInterno.mockResolvedValue({
      empresa: "LaarCourier",
      soy_tecnico: false,
      canales: [{ id: "telefono", nombre: "Teléfono" }],
      agencias: [],
      areas: [],
      categorias: [],
      campos: [],
    });
    servicio.personas.mockResolvedValue([
      {
        id: 7,
        nombre: "Carla Ordóñez",
        correo: "carla@grupolaar.com",
        telefono: "0994182273",
        area: null,
        agencia: null,
        faltan: [],
      },
    ]);
    pintar(<RegistrarTicket />, "/r", "/r");

    fireEvent.click(
      await screen.findByRole("button", { name: /Carla Ordóñez/ }),
    );
    const entrada = screen.getByLabelText("Adjuntos (opcional, hasta 3)");
    fireEvent.change(entrada, { target: { files: archivos(6) } });
    expect(
      screen.getByText("Máx. 3 archivos; se omitieron 3."),
    ).toBeInTheDocument();
    expect(entrada).toHaveAccessibleDescription(
      "Máx. 3 archivos; se omitieron 3.",
    );
  });
});
