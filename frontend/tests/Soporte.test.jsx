import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Mesa de ayuda: el formulario público, el seguimiento por enlace, la bandeja
 * y la ficha del ticket.
 */

const servicio = {
  formulario: vi.fn(),
  crearTicket: vi.fn(),
  seguimiento: vi.fn(),
  responderComoSolicitante: vi.fn(),
  confirmarSolucion: vi.fn(),
  bandeja: vi.fn(),
  tickets: vi.fn(),
  ticket: vi.fn(),
  tecnicos: vi.fn(),
  tomarSiguiente: vi.fn(),
  cambiarEstado: vi.fn(),
  escalar: vi.fn(),
  asignar: vi.fn(),
  responder: vi.fn(),
  registrarHoras: vi.fn(),
  respuestas: vi.fn(),
  descargar: vi.fn(),
};
vi.mock("../src/api/soporteService", () => ({ soporteService: servicio }));

const { FormularioSoporte } =
  await import("../src/pages/Soporte/Publico/FormularioSoporte");
const { SeguimientoTicket } =
  await import("../src/pages/Soporte/Publico/SeguimientoTicket");
const { Bandeja } = await import("../src/pages/Soporte/Bandeja");
const { TicketDetalle } = await import("../src/pages/Soporte/TicketDetalle");

const FORMULARIO = {
  empresa: "LaarCourier",
  disponible: true,
  agencias: [{ id: 1, nombre: "Loja · Agencia", ciudad: "Loja" }],
  areas: [{ id: 2, nombre: "Cobranzas" }],
  categorias: [
    {
      id: 3,
      nombre: "Hardware",
      casos: [
        {
          id: 4,
          nombre: "No enciende",
          prioridad: "alta",
          prioridad_display: "Alta",
        },
      ],
    },
  ],
};

function Ruta() {
  return <p>Ruta cambiada</p>;
}

function pintar(elemento, ruta, patron) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path={patron} element={elemento} />
        <Route path="*" element={<Ruta />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  servicio.respuestas.mockResolvedValue([]);
});

describe("El formulario público", () => {
  it("pide los campos acordados, deduce la prioridad del caso y muestra la posición", async () => {
    servicio.formulario.mockResolvedValue(FORMULARIO);
    servicio.crearTicket.mockResolvedValue({
      numero: "TCK-2026-000042",
      posicion: 4,
      fuera_de_horario: true,
      token: "secreto",
    });
    pintar(<FormularioSoporte />, "/soporte/LC", "/soporte/:codigo");

    expect(await screen.findByText("LaarCourier")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nombre y apellido"), {
      target: { value: "Carla" },
    });
    fireEvent.change(screen.getByLabelText("Teléfono de contacto"), {
      target: { value: "0994182273" },
    });
    fireEvent.change(screen.getByLabelText("Correo"), {
      target: { value: "carla@x.com" },
    });
    fireEvent.change(screen.getByLabelText("Agencia"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Área"), { target: { value: "2" } });
    expect(screen.getByLabelText("Caso de ayuda")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Categoría"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Caso de ayuda"), {
      target: { value: "4" },
    });
    expect(screen.getByText("Prioridad: Alta")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Describa el problema"), {
      target: { value: "No prende" },
    });
    fireEvent.click(screen.getByLabelText(/Acepto que mis datos/));
    fireEvent.click(screen.getByRole("button", { name: "Crear ticket" }));

    await waitFor(() => expect(servicio.crearTicket).toHaveBeenCalled());
    const [codigo, campos] = servicio.crearTicket.mock.calls[0];
    expect(codigo).toBe("LC");
    expect(campos).toMatchObject({
      nombre: "Carla",
      sede: "1",
      area: "2",
      caso: "4",
      acepta_datos: true,
    });
    expect(campos).not.toHaveProperty("categoria");
    expect(await screen.findByText("TCK-2026-000042")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(
      screen.getByText(/fuera del horario de atención/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver mi ticket" })).toHaveAttribute(
      "href",
      "/soporte/seguimiento/secreto",
    );
  });

  it("si la mesa de la empresa no está configurada, lo dice", async () => {
    servicio.formulario.mockResolvedValue({ ...FORMULARIO, disponible: false });
    pintar(<FormularioSoporte />, "/soporte/LS", "/soporte/:codigo");
    expect(
      await screen.findByText(/todavía no está disponible/),
    ).toBeInTheDocument();
  });
});

const SEGUIMIENTO = {
  numero: "TCK-2026-000042",
  empresa: "LaarCourier",
  estado: "nuevo",
  estado_display: "En cola",
  posicion: 3,
  fuera_de_horario: false,
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

describe("El seguimiento", () => {
  it("muestra la posición en la cola y deja responder", async () => {
    servicio.seguimiento.mockResolvedValue(SEGUIMIENTO);
    servicio.responderComoSolicitante.mockResolvedValue({
      ...SEGUIMIENTO,
      mensajes: [
        {
          id: 1,
          texto: "Sigue igual",
          del_solicitante: true,
          autor: "Usted",
          fecha: "2026-10-16T11:00:00Z",
          adjuntos: [],
        },
      ],
    });
    pintar(
      <SeguimientoTicket />,
      "/soporte/seguimiento/secreto",
      "/soporte/seguimiento/:token",
    );

    expect(await screen.findByText("3")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Responder"), {
      target: { value: "Sigue igual" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() =>
      expect(servicio.responderComoSolicitante).toHaveBeenCalledWith(
        "secreto",
        "Sigue igual",
        [],
      ),
    );
    expect(await screen.findByText("Sigue igual")).toBeInTheDocument();
  });

  it("un ticket atendido se puede confirmar como resuelto", async () => {
    servicio.seguimiento.mockResolvedValue({
      ...SEGUIMIENTO,
      estado: "atendido",
      estado_display: "Atendido",
      posicion: null,
      atiende: "Jorge Andrade",
      puede_confirmar: true,
    });
    servicio.confirmarSolucion.mockResolvedValue({
      ...SEGUIMIENTO,
      estado: "cerrado",
      estado_display: "Cerrado",
      posicion: null,
      puede_responder: false,
    });
    pintar(
      <SeguimientoTicket />,
      "/soporte/seguimiento/secreto",
      "/soporte/seguimiento/:token",
    );

    expect(
      await screen.findByText("Lo atiende Jorge Andrade"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sí, quedó resuelto" }));
    await waitFor(() =>
      expect(servicio.confirmarSolucion).toHaveBeenCalledWith("secreto"),
    );
    expect(await screen.findByText("Cerrado")).toBeInTheDocument();
  });
});

describe("La bandeja", () => {
  it("dice el estado del técnico y «Tomar siguiente» abre el ticket", async () => {
    servicio.bandeja.mockResolvedValue({
      tecnico: {
        id: 1,
        nivel: "N1 · Mesa de ayuda",
        categorias: ["Hardware"],
        capacidad: 1,
        en_horario: true,
        abiertos: 0,
        cola_para_mi: 2,
      },
      cola_total: 5,
      puede: { ver_todos: false, asignar: false, aprobar_horas: false },
    });
    servicio.tickets.mockResolvedValue({
      results: [],
      count: 0,
      next: null,
      previous: null,
    });
    servicio.tomarSiguiente.mockResolvedValue({ id: 42 });
    pintar(<Bandeja />, "/admin/soporte/bandeja", "/admin/soporte/bandeja");

    expect(
      await screen.findByText("En horario de atención"),
    ).toBeInTheDocument();
    expect(screen.getByText(/5 ticket\(s\) esperan/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Tomar siguiente/ }));
    expect(await screen.findByText("Ruta cambiada")).toBeInTheDocument();
  });
});

function ticket(extra = {}) {
  return {
    id: 42,
    numero: "TCK-2026-000042",
    estado: "en_curso",
    estado_display: "En curso",
    prioridad: "alta",
    prioridad_display: "Alta",
    categoria: "Hardware",
    caso: "No enciende",
    agencia: "Loja · Agencia",
    area: "Cobranzas",
    nivel: "N1 · Mesa de ayuda",
    tecnico: { id: 1, nombre: "Jorge Andrade" },
    solicitante_nombre: "Carla Ordóñez",
    solicitante_telefono: "0994182273",
    solicitante_correo: "carla@x.com",
    descripcion: "No prende",
    sla: { estado: "en_plazo", vence: "2026-10-16T15:00:00Z", minutos: 120 },
    created_at: "2026-10-16T10:00:00Z",
    adjuntos: [],
    mensajes: [],
    movimientos: [],
    permisos: {
      acciones: ["esperando_usuario", "atendido"],
      responder: true,
      escalar: true,
      asignar: false,
    },
    registrar_horas: false,
    ...extra,
  };
}

describe("La ficha del ticket", () => {
  it("con «/» sugiere las respuestas predefinidas y las completa con el ticket", async () => {
    servicio.ticket.mockResolvedValue(ticket());
    servicio.respuestas.mockResolvedValue([
      {
        id: 1,
        atajo: "reinicio",
        titulo: "Pedir reinicio",
        texto: "Hola {{nombre}}, reinicie el equipo ({{numero}}).",
      },
    ]);
    pintar(
      <TicketDetalle />,
      "/admin/soporte/tickets/42",
      "/admin/soporte/tickets/:id",
    );

    const caja = await screen.findByLabelText("Respuesta al usuario");
    fireEvent.change(caja, { target: { value: "/rei" } });
    fireEvent.click(await screen.findByRole("button", { name: /reinicio/ }));
    expect(caja).toHaveValue(
      "Hola Carla Ordóñez, reinicie el equipo (TCK-2026-000042).",
    );
  });

  it("si actúa fuera de su horario, le pide registrar las horas", async () => {
    servicio.ticket.mockResolvedValue(ticket());
    servicio.cambiarEstado.mockResolvedValue(
      ticket({
        estado: "atendido",
        estado_display: "Atendido",
        registrar_horas: true,
        permisos: { acciones: [] },
      }),
    );
    servicio.registrarHoras.mockResolvedValue({});
    pintar(
      <TicketDetalle />,
      "/admin/soporte/tickets/42",
      "/admin/soporte/tickets/:id",
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Marcar como atendido" }),
    );
    expect(
      await screen.findByText("Está fuera de su horario de atención"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Horas"), {
      target: { value: "1.5" },
    });
    fireEvent.change(screen.getByLabelText("Qué hizo"), {
      target: { value: "Reinstalé el sistema" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() =>
      expect(servicio.registrarHoras).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ horas: "1.5" }),
      ),
    );
  });

  it("escalar manda el motivo", async () => {
    servicio.ticket.mockResolvedValue(ticket());
    servicio.escalar.mockResolvedValue({
      id: 42,
      numero: "TCK-2026-000042",
      estado: "nuevo",
      visible: false,
    });
    pintar(
      <TicketDetalle />,
      "/admin/soporte/tickets/42",
      "/admin/soporte/tickets/:id",
    );

    fireEvent.change(await screen.findByLabelText("Nota o motivo"), {
      target: { value: "Falla de placa" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Escalar al siguiente nivel" }),
    );
    await waitFor(() =>
      expect(servicio.escalar).toHaveBeenCalledWith(42, "Falla de placa"),
    );
    expect(
      await screen.findByText(/ya no está a su cargo/),
    ).toBeInTheDocument();
  });
});
