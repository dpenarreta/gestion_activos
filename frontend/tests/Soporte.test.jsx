import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Mesa de ayuda: «Soporte TI» (nuevo ticket con los datos de «Mi perfil» y la
 * ficha de un ticket propio), la bandeja y la ficha del ticket del equipo.
 */

const servicio = {
  solicitar: vi.fn(),
  crearTicket: vi.fn(),
  miTicket: vi.fn(),
  responderMiTicket: vi.fn(),
  confirmarMiTicket: vi.fn(),
  encuestaMiTicket: vi.fn(),
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
  misTickets: vi.fn(),
};
vi.mock("../src/api/soporteService", () => ({ soporteService: servicio }));
// Quien abre la bandeja: por defecto, alguien del equipo de la mesa.
const sesion = { permisos: ["soporte.atender"] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { permissions: sesion.permisos },
    isAuthenticated: true,
  }),
}));
const misDatos = { obtener: vi.fn(), guardar: vi.fn() };
vi.mock("../src/api/misDatosService", () => ({ misDatosService: misDatos }));

const { NuevoTicket } = await import("../src/pages/Ayuda/NuevoTicket");
const { MiTicket } = await import("../src/pages/Ayuda/MiTicket");
const { Bandeja } = await import("../src/pages/Soporte/Bandeja");
const { TicketDetalle } = await import("../src/pages/Soporte/TicketDetalle");

function base(clave, etiqueta, tipo) {
  return {
    clave,
    etiqueta,
    tipo,
    ayuda: "",
    opciones: [],
    obligatorio: true,
    base: true,
    categorias: [],
  };
}

const MIS_DATOS = {
  nombre: "Carla Ordóñez",
  nombres: "Carla",
  apellidos: "Ordóñez",
  correo: "carla@grupolaar.com",
  telefono: "0994182273",
  area: { id: 2, nombre: "Cobranzas" },
  agencia: { id: 1, nombre: "Loja · Agencia" },
  cargo: { id: 5, nombre: "Analista · Cobranzas" },
  cargos: [{ id: 5, nombre: "Analista · Cobranzas" }],
  faltan: [],
};

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
  campos: [
    base("categoria", "Categoría", "lista"),
    base("caso", "Caso de ayuda", "lista"),
    base("descripcion", "Describa el problema", "parrafo"),
    base("impacto", "¿A quién afecta?", "lista"),
    base("urgencia", "¿Puede seguir trabajando?", "lista"),
  ],
  mis_datos: MIS_DATOS,
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

describe("Soporte TI: nuevo ticket", () => {
  it("carga los datos de quien pide y solo pregunta el problema", async () => {
    servicio.solicitar.mockResolvedValue(FORMULARIO);
    servicio.crearTicket.mockResolvedValue({
      id: 42,
      numero: "TCK-2026-000042",
      posicion: 4,
      estado: "nuevo",
      fuera_de_horario: true,
    });
    pintar(<NuevoTicket />, "/admin/ayuda", "/admin/ayuda");

    // Sus datos vienen de «Mi perfil»: no se vuelven a pedir.
    expect(await screen.findByText("Carla Ordóñez")).toBeInTheDocument();
    expect(screen.getByText("Loja · Agencia")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre y apellido")).toBeNull();

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
    fireEvent.change(screen.getByLabelText("¿A quién afecta?"), {
      target: { value: "medio" },
    });
    fireEvent.change(screen.getByLabelText("¿Puede seguir trabajando?"), {
      target: { value: "alta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear ticket" }));

    await waitFor(() => expect(servicio.crearTicket).toHaveBeenCalled());
    const [campos] = servicio.crearTicket.mock.calls[0];
    expect(campos).toMatchObject({
      caso: "4",
      descripcion: "No prende",
      impacto: "medio",
      urgencia: "alta",
    });
    expect(campos).not.toHaveProperty("categoria");
    expect(campos).not.toHaveProperty("nombre");
    expect(await screen.findByText("TCK-2026-000042")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(
      screen.getByText(/fuera del horario de atención/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver mi ticket" })).toHaveAttribute(
      "href",
      "/admin/ayuda/tickets/42",
    );
  });

  it("si le faltan datos, los pide antes y quedan guardados", async () => {
    servicio.solicitar
      .mockResolvedValueOnce({
        ...FORMULARIO,
        mis_datos: {
          ...MIS_DATOS,
          telefono: "",
          agencia: null,
          faltan: ["agencia"],
        },
      })
      .mockResolvedValue(FORMULARIO);
    misDatos.guardar.mockResolvedValue(MIS_DATOS);
    pintar(<NuevoTicket />, "/admin/ayuda", "/admin/ayuda");

    expect(await screen.findByText("Complete sus datos")).toBeInTheDocument();
    expect(screen.getByText(/complete: agencia/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Describa el problema")).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Teléfono/), {
      target: { value: "0994182273" },
    });
    fireEvent.click(screen.getByLabelText(/Autorizo a la empresa/));
    fireEvent.change(screen.getByLabelText("Agencia"), {
      target: { value: "1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Guardar y continuar" }),
    );
    await waitFor(() =>
      expect(misDatos.guardar).toHaveBeenCalledWith(
        expect.objectContaining({ telefono: "0994182273", agencia: "1" }),
      ),
    );
    expect(
      await screen.findByLabelText("Describa el problema"),
    ).toBeInTheDocument();
  });

  it("si la mesa de la empresa no está configurada, lo dice", async () => {
    servicio.solicitar.mockResolvedValue({ ...FORMULARIO, disponible: false });
    pintar(<NuevoTicket />, "/admin/ayuda", "/admin/ayuda");
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

describe("Mis tickets: la ficha de un ticket propio", () => {
  it("muestra la posición en la cola y deja responder", async () => {
    servicio.miTicket.mockResolvedValue(SEGUIMIENTO);
    servicio.responderMiTicket.mockResolvedValue({
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
    pintar(<MiTicket />, "/admin/ayuda/tickets/42", "/admin/ayuda/tickets/:id");

    expect(await screen.findByText("3")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Responder"), {
      target: { value: "Sigue igual" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() =>
      expect(servicio.responderMiTicket).toHaveBeenCalledWith(
        "42",
        "Sigue igual",
        [],
      ),
    );
    expect(await screen.findByText("Sigue igual")).toBeInTheDocument();
  });

  it("un ticket atendido se puede confirmar como resuelto", async () => {
    servicio.miTicket.mockResolvedValue({
      ...SEGUIMIENTO,
      estado: "atendido",
      estado_display: "Atendido",
      posicion: null,
      atiende: "Jorge Andrade",
      puede_confirmar: true,
    });
    servicio.confirmarMiTicket.mockResolvedValue({
      ...SEGUIMIENTO,
      estado: "cerrado",
      estado_display: "Cerrado",
      posicion: null,
      puede_responder: false,
    });
    pintar(<MiTicket />, "/admin/ayuda/tickets/42", "/admin/ayuda/tickets/:id");

    expect(
      await screen.findByText("Lo atiende Jorge Andrade"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sí, quedó resuelto" }));
    await waitFor(() =>
      expect(servicio.confirmarMiTicket).toHaveBeenCalledWith("42"),
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
      puede: {
        ver_todos: false,
        asignar: false,
        registrar: true,
        aprobar_horas: false,
      },
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

  // Auditoría UX/UI, fase 2 (28/10/2026): un fallo no es una cola vacía.
  it("«Tomar siguiente» distingue la cola vacía de un error", async () => {
    servicio.bandeja.mockResolvedValue({
      tecnico: {
        id: 1,
        nivel: "N1 · Mesa de ayuda",
        categorias: [],
        capacidad: 1,
        en_horario: true,
        abiertos: 0,
        cola_para_mi: 0,
      },
      cola_total: 0,
      puede: {
        ver_todos: false,
        asignar: false,
        registrar: false,
        aprobar_horas: false,
      },
    });
    servicio.tickets.mockResolvedValue({
      results: [],
      count: 0,
      next: null,
      previous: null,
    });
    servicio.tomarSiguiente.mockRejectedValueOnce({
      response: {
        status: 404,
        data: { detail: "No hay tickets en la cola que usted pueda atender." },
      },
    });
    pintar(<Bandeja />, "/admin/soporte/bandeja", "/admin/soporte/bandeja");

    const boton = await screen.findByRole("button", {
      name: /Tomar siguiente/,
    });
    fireEvent.click(boton);
    expect(
      await screen.findByText(
        "No hay tickets en la cola que usted pueda atender.",
      ),
    ).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).toBeNull();

    servicio.tomarSiguiente.mockRejectedValueOnce({
      response: { status: 500, data: null },
    });
    fireEvent.click(screen.getByRole("button", { name: /Tomar siguiente/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo tomar el siguiente ticket.",
    );
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

  // Auditoría UX/UI, fase 2 (28/10/2026).
  it("sin motivo no escala: marca el campo y le lleva el foco", async () => {
    servicio.ticket.mockResolvedValue(ticket());
    servicio.escalar.mockReset();
    pintar(
      <TicketDetalle />,
      "/admin/soporte/tickets/42",
      "/admin/soporte/tickets/:id",
    );

    const nota = await screen.findByLabelText("Nota o motivo");
    fireEvent.change(nota, { target: { value: "   " } });
    fireEvent.click(
      screen.getByRole("button", { name: "Escalar al siguiente nivel" }),
    );
    expect(servicio.escalar).not.toHaveBeenCalled();
    expect(nota).toHaveAttribute("aria-invalid", "true");
    expect(nota).toHaveAccessibleDescription(
      /Escriba el motivo para escalar el ticket/,
    );
    expect(nota).toHaveFocus();

    // Al escribirlo, el error se va.
    fireEvent.change(nota, { target: { value: "Falla de placa" } });
    expect(nota).not.toHaveAttribute("aria-invalid");
  });

  it("esperar al usuario también pide la nota; marcar atendido no", async () => {
    servicio.ticket.mockResolvedValue(ticket());
    servicio.cambiarEstado.mockReset();
    servicio.cambiarEstado.mockResolvedValue(
      ticket({ estado: "atendido", estado_display: "Atendido" }),
    );
    pintar(
      <TicketDetalle />,
      "/admin/soporte/tickets/42",
      "/admin/soporte/tickets/:id",
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Esperar al usuario" }),
    );
    expect(servicio.cambiarEstado).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nota o motivo")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Marcar como atendido" }),
    );
    await waitFor(() =>
      expect(servicio.cambiarEstado).toHaveBeenCalledWith(42, "atendido", ""),
    );
    // El aviso sale en la tarjeta de las acciones, no arriba de la página.
    const tarjeta = screen
      .getByRole("heading", { name: "Qué se puede hacer" })
      .closest("section");
    expect(
      await within(tarjeta).findByText("Estado actualizado."),
    ).toBeInTheDocument();
  });

  it("elige antes de escribir si responde al usuario o deja una nota interna", async () => {
    servicio.ticket.mockResolvedValue(ticket());
    servicio.respuestas.mockResolvedValue([]);
    servicio.responder.mockReset();
    servicio.responder.mockResolvedValue(ticket());
    pintar(
      <TicketDetalle />,
      "/admin/soporte/tickets/42",
      "/admin/soporte/tickets/:id",
    );

    const responder = await screen.findByRole("button", {
      name: "Responder al usuario",
    });
    const interna = screen.getByRole("button", { name: "Nota interna" });
    // Por defecto, responder al usuario.
    expect(responder).toHaveAttribute("aria-pressed", "true");
    expect(interna).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Responder" })).toHaveAttribute(
      "type",
      "submit",
    );

    fireEvent.click(interna);
    expect(interna).toHaveAttribute("aria-pressed", "true");
    expect(responder).toHaveAttribute("aria-pressed", "false");
    const caja = screen.getByLabelText("Nota interna (el usuario no la ve)");
    expect(caja).toHaveClass("soporte-respuesta--interna");
    fireEvent.change(caja, { target: { value: "Revisar la placa" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Guardar nota interna" }),
    );
    await waitFor(() =>
      expect(servicio.responder).toHaveBeenCalledWith(
        42,
        { texto: "Revisar la placa", interno: true },
        [],
      ),
    );
    expect(
      await screen.findByText("Nota interna guardada."),
    ).toBeInTheDocument();
  });

  it("las sugerencias «/» son una lista de opciones que Escape cierra", async () => {
    servicio.ticket.mockResolvedValue(ticket());
    servicio.respuestas.mockResolvedValue([
      { id: 1, atajo: "reinicio", titulo: "Pedir reinicio", texto: "Hola" },
    ]);
    pintar(
      <TicketDetalle />,
      "/admin/soporte/tickets/42",
      "/admin/soporte/tickets/:id",
    );

    const caja = await screen.findByLabelText("Respuesta al usuario");
    fireEvent.change(caja, { target: { value: "/rei" } });
    // Una lista de botones (no un listbox con botones adentro).
    const lista = await screen.findByRole("list", {
      name: "Respuestas predefinidas",
    });
    expect(within(lista).getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("1 respuestas sugeridas")).toBeInTheDocument();
    fireEvent.keyDown(caja, { key: "Escape" });
    expect(
      screen.queryByRole("list", { name: "Respuestas predefinidas" }),
    ).toBeNull();
  });
});

describe("Mis solicitudes en la bandeja", () => {
  it("quien no es del equipo ve solo lo que creó, en todos sus estados", async () => {
    sesion.permisos = [];
    servicio.misTickets.mockResolvedValue([
      {
        id: 7,
        numero: "TCK-2026-000007",
        categoria: "Hardware",
        caso: "No enciende",
        estado: "nuevo",
        estado_display: "En cola",
        criticidad: "alta",
        criticidad_display: "Alta",
        posicion: 3,
        creado: "2026-10-21T15:00:00Z",
        atendido_en: null,
      },
      {
        id: 5,
        numero: "TCK-2026-000005",
        categoria: "Accesos",
        caso: "Olvidé mi clave",
        estado: "cerrado",
        estado_display: "Cerrado",
        criticidad: "baja",
        criticidad_display: "Baja",
        posicion: null,
        creado: "2026-10-01T15:00:00Z",
        atendido_en: "2026-10-01T18:00:00Z",
      },
    ]);
    pintar(<Bandeja />, "/admin/soporte/bandeja", "/admin/soporte/bandeja");

    const tabla = await screen.findByRole("table", { name: "Mis solicitudes" });
    expect(within(tabla).getByText("En cola")).toBeInTheDocument();
    expect(within(tabla).getByText("Cerrado")).toBeInTheDocument();
    expect(within(tabla).getByText("3")).toBeInTheDocument();
    // Abre su ficha de seguimiento, no la del equipo (sin notas internas).
    expect(
      within(tabla).getByRole("link", { name: "TCK-2026-000007" }),
    ).toHaveAttribute("href", "/admin/ayuda/tickets/7");
    // Ni el estado de técnico ni las pestañas del equipo.
    expect(servicio.bandeja).not.toHaveBeenCalled();
    expect(servicio.tickets).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("navigation", { name: "Qué tickets ver" }),
    ).toBeNull();
    sesion.permisos = ["soporte.atender"];
  });
});
