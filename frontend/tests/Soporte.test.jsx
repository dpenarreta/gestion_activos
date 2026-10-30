import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  cambiarPrioridad: vi.fn(),
  tomar: vi.fn(),
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
    // En una línea al final: «Le contactaremos como …».
    expect(
      await screen.findByText(/Carla Ordóñez · .*Loja · Agencia/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre y apellido")).toBeNull();

    expect(screen.getByLabelText(/^Caso de ayuda/)).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Categoría/), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText(/^Caso de ayuda/), {
      target: { value: "4" },
    });
    // Sin «Prioridad: …» bajo el caso: la persona no sabe qué es «P1» y la
    // prioridad final depende de lo que responda.
    expect(screen.queryByText(/^Prioridad:/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Describa el problema/), {
      target: { value: "No prende" },
    });
    fireEvent.change(screen.getByLabelText(/^¿A quién afecta\?/), {
      target: { value: "medio" },
    });
    fireEvent.change(screen.getByLabelText(/^¿Puede seguir trabajando\?/), {
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
    expect(
      screen.getByText("Hay 3 tickets antes que el suyo."),
    ).toBeInTheDocument();
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
    expect(screen.queryByLabelText(/^Describa el problema/)).toBeNull();
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
      await screen.findByLabelText(/^Describa el problema/),
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

describe("Soporte TI a prueba de errores (auditoría UX/UI, 30/10/2026)", () => {
  it("sin completar, dice qué falta bajo cada campo, en «usted», y no envía", async () => {
    servicio.solicitar.mockResolvedValue(FORMULARIO);
    servicio.crearTicket.mockReset();
    pintar(<NuevoTicket />, "/admin/ayuda", "/admin/ayuda");

    fireEvent.click(
      await screen.findByRole("button", { name: "Crear ticket" }),
    );
    expect(servicio.crearTicket).not.toHaveBeenCalled();
    const descripcion = screen.getByLabelText(/^Describa el problema/);
    expect(descripcion).toHaveAttribute("aria-invalid", "true");
    expect(descripcion).toHaveAccessibleDescription(/Cuéntenos qué pasa\./);
    expect(screen.getByLabelText(/^Categoría/)).toHaveAccessibleDescription(
      /Elija la categoría de su problema\./,
    );
    // Primero se cuenta el problema: la descripción va antes que la
    // categoría.
    const campos = screen.getAllByRole("combobox").concat(descripcion);
    expect(
      descripcion.compareDocumentPosition(screen.getByLabelText(/^Categoría/)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(campos.length).toBeGreaterThan(1);
  });

  it("sugiere la categoría y el caso con lo que escribió", async () => {
    servicio.solicitar.mockResolvedValue(FORMULARIO);
    pintar(<NuevoTicket />, "/admin/ayuda", "/admin/ayuda");

    fireEvent.change(await screen.findByLabelText(/^Describa el problema/), {
      target: { value: "Mi computadora no enciende desde la mañana" },
    });
    const sugerencia = await screen.findByRole("button", {
      name: "Hardware › No enciende",
    });
    fireEvent.click(sugerencia);
    expect(screen.getByLabelText(/^Categoría/)).toHaveValue("3");
    expect(screen.getByLabelText(/^Caso de ayuda/)).toHaveValue("4");
    expect(sugerencia).toHaveAttribute("aria-pressed", "true");
  });

  it("si el servidor lo rechaza, el aviso sale junto al botón", async () => {
    servicio.solicitar.mockResolvedValue(FORMULARIO);
    servicio.crearTicket.mockRejectedValueOnce({
      response: { status: 500, data: null },
    });
    pintar(<NuevoTicket />, "/admin/ayuda", "/admin/ayuda");
    fireEvent.change(await screen.findByLabelText(/^Describa el problema/), {
      target: { value: "No prende" },
    });
    fireEvent.change(screen.getByLabelText(/^Categoría/), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText(/^Caso de ayuda/), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText(/^¿A quién afecta\?/), {
      target: { value: "bajo" },
    });
    fireEvent.change(screen.getByLabelText(/^¿Puede seguir trabajando\?/), {
      target: { value: "baja" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear ticket" }));
    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent("No se pudo crear el ticket.");
    await waitFor(() => expect(aviso).toHaveFocus());
  });

  it("«Cambiar mis datos» se puede cancelar sin perder lo escrito", async () => {
    servicio.solicitar.mockResolvedValue(FORMULARIO);
    pintar(<NuevoTicket />, "/admin/ayuda", "/admin/ayuda");
    fireEvent.change(await screen.findByLabelText(/^Describa el problema/), {
      target: { value: "No prende" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar mis datos" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(screen.getByLabelText(/^Describa el problema/)).toHaveValue(
      "No prende",
    );
  });
});

describe("Mis tickets: qué sigue (auditoría UX/UI, 30/10/2026)", () => {
  it("dice cuándo le responden y ofrece «No, sigue el problema»", async () => {
    servicio.miTicket.mockResolvedValue({
      ...SEGUIMIENTO,
      estado: "atendido",
      estado_display: "Atendido",
      posicion: null,
      atiende: "Jorge Andrade",
      puede_confirmar: true,
      plazos: {
        respuesta: "2999-01-01T15:00:00Z",
        solucion: null,
        respondido: false,
      },
    });
    pintar(<MiTicket />, "/admin/ayuda/tickets/42", "/admin/ayuda/tickets/:id");

    expect(
      await screen.findByText(/Le responderemos antes del/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "No, sigue el problema" }),
    );
    expect(screen.getByLabelText(/El problema sigue/)).toHaveFocus();
  });

  it("un ticket cerrado dice qué hacer si el problema vuelve", async () => {
    servicio.miTicket.mockResolvedValue({
      ...SEGUIMIENTO,
      estado: "cerrado",
      estado_display: "Cerrado",
      posicion: null,
      puede_responder: false,
    });
    pintar(<MiTicket />, "/admin/ayuda/tickets/42", "/admin/ayuda/tickets/:id");
    expect(
      await screen.findByRole("link", { name: "cree un ticket nuevo" }),
    ).toHaveAttribute("href", "/admin/ayuda");
  });

  it("responder vacío pide el mensaje o un archivo", async () => {
    servicio.miTicket.mockResolvedValue(SEGUIMIENTO);
    servicio.responderMiTicket.mockReset();
    pintar(<MiTicket />, "/admin/ayuda/tickets/42", "/admin/ayuda/tickets/:id");
    fireEvent.click(await screen.findByRole("button", { name: "Enviar" }));
    expect(servicio.responderMiTicket).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText(/^(Responder|¿Quiere agregar algo\?)$/),
    ).toHaveAccessibleDescription("Escriba su mensaje o adjunte un archivo.");
  });

  it("la lista pone primero lo que le toca a la persona", async () => {
    sesion.permisos = [];
    servicio.misTickets.mockResolvedValue([
      {
        id: 1,
        numero: "TCK-2026-000001",
        categoria: "Hardware",
        caso: "No enciende",
        estado: "nuevo",
        estado_display: "En cola",
        prioridad: "critica",
        prioridad_display: "P1 · Crítica",
        posicion: 1,
        creado: "2026-10-21T15:00:00Z",
      },
      {
        id: 2,
        numero: "TCK-2026-000002",
        categoria: "Accesos",
        caso: "Olvidé mi clave",
        estado: "esperando_usuario",
        estado_display: "Esperando al usuario",
        prioridad: "baja",
        prioridad_display: "P4 · Baja",
        posicion: null,
        creado: "2026-10-01T15:00:00Z",
      },
    ]);
    try {
      pintar(<Bandeja />, "/admin/soporte/bandeja", "/admin/soporte/bandeja");
      const tabla = await screen.findByRole("table", { name: "Mis tickets" });
      const filas = within(tabla).getAllByRole("row").slice(1);
      expect(filas[0]).toHaveTextContent("Le respondieron: lea y conteste");
      expect(filas[1]).toHaveTextContent("Es el siguiente en la cola.");
      // La prioridad, sin el código «P1».
      expect(within(filas[1]).getByText("Crítica")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Un ticket necesita algo de usted",
      );
    } finally {
      sesion.permisos = ["soporte.atender"];
    }
  });
});

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

    expect(
      await screen.findByText("Hay 2 tickets antes que el suyo."),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByLabelText(/^(Responder|¿Quiere agregar algo\?)$/),
      {
        target: { value: "Sigue igual" },
      },
    );
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
        cola_para_mi: 1,
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

describe("La bandeja: qué vence y qué falta", () => {
  const cabecera = (extra = {}) => ({
    tecnico: {
      id: 1,
      nivel: "N1 · Mesa de ayuda",
      categorias: ["Hardware"],
      capacidad: 2,
      en_horario: true,
      abiertos: 1,
      cola_para_mi: 0,
    },
    cola_total: 7,
    categorias_sin_tecnicos: ["Accesos", "Redes"],
    puede: {
      ver_todos: true,
      asignar: true,
      registrar: false,
      aprobar_horas: false,
    },
    ...extra,
  });

  it("abre en «Mis tickets» del técnico y muestra el plazo que importa", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
    servicio.bandeja.mockResolvedValue(cabecera());
    servicio.tickets.mockResolvedValue({
      results: [
        {
          id: 3,
          numero: "TCK-2026-000003",
          estado: "asignado",
          estado_display: "Asignado",
          prioridad: "critica",
          prioridad_display: "P1 · Crítica",
          caso: "Tracking caído",
          categoria: "Hardware",
          nivel: "N1 · Mesa de ayuda",
          solicitante_nombre: "Carla",
          created_at: "2026-10-21T12:00:00Z",
          sla: {
            estado: "en_plazo",
            vence: "2026-10-31T12:00:00Z",
            respuesta: {
              estado: "vencida",
              vence: "2026-10-21T12:15:00Z",
            },
          },
        },
      ],
      count: 1,
      next: null,
      previous: null,
    });
    pintar(<Bandeja />, "/admin/soporte/bandeja", "/admin/soporte/bandeja");

    // La pestaña se decide al saber que es técnico (antes caía en «Mis
    // solicitudes» al recargar).
    expect(
      await screen.findByRole("tab", { name: "Mis tickets" }),
    ).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(servicio.tickets).toHaveBeenCalledWith(
        expect.objectContaining({ ambito: "mios" }),
      ),
    );
    // El reloj de respuesta, vencido, y no «Sin iniciar».
    expect(
      (await screen.findAllByText("Respuesta vencida hace 9 d"))[0],
    ).toBeInTheDocument();
    // Una sola escala: la prioridad.
    expect(
      screen.queryByRole("columnheader", { name: "Criticidad" }),
    ).toBeNull();
    vi.useRealTimers();
  });

  it("avisa de las categorías sin técnicos y no invita a tomar si no hay nada", async () => {
    servicio.bandeja.mockResolvedValue(cabecera());
    servicio.tickets.mockResolvedValue({
      results: [],
      count: 0,
      next: null,
      previous: null,
    });
    pintar(<Bandeja />, "/admin/soporte/bandeja", "/admin/soporte/bandeja");

    expect(
      await screen.findByText(
        /2 categorías no tienen técnicos \(Accesos, Redes\)/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2 categorías no tienen técnicos/),
    ).toHaveTextContent("2 categorías no tienen técnicos (Accesos, Redes)");
    expect(
      screen.getByRole("link", { name: "Asignar técnicos" }),
    ).toHaveAttribute("href", "/admin/configuracion/soporte");
    expect(
      screen.getByRole("button", { name: /Tomar siguiente/ }),
    ).toBeDisabled();
    expect(
      screen.getByText("No hay tickets de sus categorías en la cola"),
    ).toBeInTheDocument();
  });

  it("filtra los vencidos y por prioridad", async () => {
    servicio.bandeja.mockResolvedValue(cabecera());
    servicio.tickets.mockResolvedValue({
      results: [],
      count: 0,
      next: null,
      previous: null,
    });
    pintar(<Bandeja />, "/admin/soporte/bandeja", "/admin/soporte/bandeja");
    fireEvent.click(await screen.findByLabelText("Solo vencidos"));
    await waitFor(() =>
      expect(servicio.tickets).toHaveBeenLastCalledWith(
        expect.objectContaining({ vencidos: "true" }),
      ),
    );
    fireEvent.change(screen.getByLabelText("Prioridad"), {
      target: { value: "critica" },
    });
    await waitFor(() =>
      expect(servicio.tickets).toHaveBeenLastCalledWith(
        expect.objectContaining({ prioridad: "critica", vencidos: "true" }),
      ),
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

  /** La ventana de una acción y su campo. */
  async function abrirAccion(boton) {
    fireEvent.click(await screen.findByRole("button", { name: boton }));
    return screen.findByRole("dialog");
  }

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

    const ventana = await abrirAccion("Marcar como atendido");
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Marcar como atendido" }),
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

  it("escalar explica qué pasa y manda el motivo", async () => {
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

    const ventana = await abrirAccion("Escalar al siguiente nivel");
    expect(ventana).toHaveAccessibleName("Escalar al siguiente nivel");
    expect(ventana).toHaveAccessibleDescription(/Deja de estar a su cargo/);
    fireEvent.change(
      within(ventana).getByLabelText(/Motivo para el nivel siguiente/),
      { target: { value: "Falla de placa" } },
    );
    fireEvent.click(within(ventana).getByRole("button", { name: "Escalar" }));
    await waitFor(() =>
      expect(servicio.escalar).toHaveBeenCalledWith(42, "Falla de placa"),
    );
    expect(
      await screen.findByText(/ya no está a su cargo/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sin motivo no escala: marca el campo y le lleva el foco", async () => {
    servicio.ticket.mockResolvedValue(ticket());
    servicio.escalar.mockReset();
    pintar(
      <TicketDetalle />,
      "/admin/soporte/tickets/42",
      "/admin/soporte/tickets/:id",
    );

    const ventana = await abrirAccion("Escalar al siguiente nivel");
    const nota = within(ventana).getByLabelText(
      /Motivo para el nivel siguiente/,
    );
    fireEvent.change(nota, { target: { value: "   " } });
    fireEvent.click(within(ventana).getByRole("button", { name: "Escalar" }));
    expect(servicio.escalar).not.toHaveBeenCalled();
    expect(nota).toHaveAttribute("aria-invalid", "true");
    expect(nota).toHaveAccessibleDescription(
      /Escriba el motivo para escalar el ticket/,
    );
    expect(nota).toHaveFocus();

    // Al escribirlo, el error se va; «Cancelar» con texto escrito pregunta
    // antes de descartarlo, y no escala.
    fireEvent.change(nota, { target: { value: "Falla de placa" } });
    expect(nota).not.toHaveAttribute("aria-invalid");
    fireEvent.click(within(ventana).getByRole("button", { name: "Cancelar" }));
    fireEvent.click(
      within(
        await screen.findByRole("dialog", { name: "¿Descartar los cambios?" }),
      ).getByRole("button", { name: "Descartar" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(servicio.escalar).not.toHaveBeenCalled();
  });

  it("esperar al usuario pide qué necesita; atendido explica y confirma", async () => {
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

    let ventana = await abrirAccion(/Esperar al usuario \(pausa el plazo\)/);
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviar y esperar" }),
    );
    expect(servicio.cambiarEstado).not.toHaveBeenCalled();
    expect(
      within(ventana).getByLabelText(/Qué necesita del usuario/),
    ).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(within(ventana).getByRole("button", { name: "Cancelar" }));

    ventana = await abrirAccion("Marcar como atendido");
    expect(ventana).toHaveAccessibleDescription(
      /Se avisa a Carla Ordóñez para que confirme/,
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Marcar como atendido" }),
    );
    await waitFor(() =>
      expect(servicio.cambiarEstado).toHaveBeenCalledWith(42, "atendido", ""),
    );
    // El aviso sale en la tarjeta de las acciones, no arriba de la página.
    const tarjeta = screen
      .getByRole("heading", { name: "Acciones" })
      .closest("section");
    expect(
      await within(tarjeta).findByText("Estado actualizado."),
    ).toBeInTheDocument();
  });

  it("si el servidor rechaza la acción, el error sale en la ventana", async () => {
    servicio.ticket.mockResolvedValue(ticket());
    servicio.escalar.mockReset();
    servicio.escalar.mockRejectedValue({
      response: { data: { error: { message: "No hay un nivel siguiente." } } },
    });
    pintar(
      <TicketDetalle />,
      "/admin/soporte/tickets/42",
      "/admin/soporte/tickets/:id",
    );
    const ventana = await abrirAccion("Escalar al siguiente nivel");
    fireEvent.change(
      within(ventana).getByLabelText(/Motivo para el nivel siguiente/),
      { target: { value: "Falla de placa" } },
    );
    fireEvent.click(within(ventana).getByRole("button", { name: "Escalar" }));
    expect(await within(ventana).findByRole("alert")).toHaveTextContent(
      "No hay un nivel siguiente.",
    );
  });

  it("un técnico toma el ticket de la cola que está mirando", async () => {
    servicio.ticket.mockResolvedValue(
      ticket({
        estado: "nuevo",
        estado_display: "En cola",
        tecnico: null,
        permisos: {
          acciones: [],
          tomar: true,
          responder: false,
          escalar: false,
          asignar: false,
        },
      }),
    );
    servicio.tomar.mockResolvedValue(ticket());
    pintar(
      <TicketDetalle />,
      "/admin/soporte/tickets/42",
      "/admin/soporte/tickets/:id",
    );
    // Sin la «Nota o motivo» suelta que no servía para nada.
    expect(
      await screen.findByRole("button", { name: /Tomar este ticket/ }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Nota o motivo")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Tomar este ticket/ }));
    await waitFor(() => expect(servicio.tomar).toHaveBeenCalledWith(42));
    expect(
      await screen.findByText("El ticket es suyo: ya puede trabajarlo."),
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

    const tabla = await screen.findByRole("table", { name: "Mis tickets" });
    expect(within(tabla).getByText("En cola")).toBeInTheDocument();
    expect(within(tabla).getAllByText("Cerrado")[0]).toBeInTheDocument();
    // «Qué sigue», en palabras.
    expect(
      within(tabla).getByText("Hay 2 tickets antes que el suyo."),
    ).toBeInTheDocument();
    // Abre su ficha de seguimiento, no la del equipo (sin notas internas).
    expect(
      within(tabla).getByRole("link", {
        name: "Ver el ticket TCK-2026-000007",
      }),
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

/*
 * En el teléfono (auditoría UX/UI, fase 3, 28/10/2026): las ocho columnas de
 * la bandeja solo se leían desplazándose de lado; cada ticket va en una
 * tarjeta con sus datos clave y un botón de 44 px para abrirlo.
 */
describe("La bandeja en el teléfono", () => {
  const original = window.matchMedia;

  beforeEach(() => {
    window.matchMedia = vi.fn((consulta) => ({
      matches: consulta.includes("max-width: 880px"),
      media: consulta,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    window.matchMedia = original;
  });

  it("cada ticket del equipo es una tarjeta que abre su ficha", async () => {
    servicio.bandeja.mockResolvedValue({
      tecnico: {
        id: 1,
        nivel: "N1 · Mesa de ayuda",
        categorias: [],
        capacidad: 3,
        en_horario: true,
        abiertos: 1,
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
      results: [ticket()],
      count: 1,
      next: null,
      previous: null,
    });
    pintar(<Bandeja />, "/admin/soporte/bandeja", "/admin/soporte/bandeja");

    const lista = await screen.findByRole("list", { name: "Tickets" });
    const [tarjeta] = within(lista).getAllByRole("listitem");
    expect(tarjeta).toHaveTextContent("TCK-2026-000042");
    expect(tarjeta).toHaveTextContent("No enciende");
    expect(tarjeta).toHaveTextContent("Carla Ordóñez");
    expect(tarjeta).toHaveTextContent("Atiende: Jorge Andrade");
    expect(
      within(tarjeta).getByRole("link", {
        name: "Abrir ticket TCK-2026-000042",
      }),
    ).toHaveAttribute("href", "/admin/soporte/tickets/42");
  });

  it("«Mis solicitudes» también va en tarjetas, hacia la ficha de quien pide", async () => {
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
    ]);
    try {
      pintar(<Bandeja />, "/admin/soporte/bandeja", "/admin/soporte/bandeja");

      const lista = await screen.findByRole("list", {
        name: "Mis tickets",
      });
      const [tarjeta] = within(lista).getAllByRole("listitem");
      expect(tarjeta).toHaveTextContent("Hay 2 tickets antes que el suyo.");
      expect(
        within(tarjeta).getByRole("link", {
          name: "Ver el ticket TCK-2026-000007",
        }),
      ).toHaveAttribute("href", "/admin/ayuda/tickets/7");
    } finally {
      sesion.permisos = ["soporte.atender"];
    }
  });
});

describe("La ficha del ticket, de un vistazo (auditoría UX/UI, 30/10/2026)", () => {
  function abrir() {
    pintar(
      <TicketDetalle />,
      "/admin/soporte/tickets/42",
      "/admin/soporte/tickets/:id",
    );
  }

  it("un ticket que no existe lo dice en español y lleva a la bandeja", async () => {
    servicio.ticket.mockRejectedValueOnce({
      response: {
        status: 404,
        data: { detail: "No Ticket matches the given query." },
      },
    });
    abrir();
    expect(
      await screen.findByText(/Este ticket no existe o ya no tiene acceso/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Volver a la bandeja" }),
    ).toHaveAttribute("href", "/admin/soporte/bandeja");
    expect(screen.queryByRole("button", { name: /Reintentar/ })).toBeNull();
  });

  it("arriba dice qué toca y por qué no se puede tomar", async () => {
    servicio.ticket.mockResolvedValue(
      ticket({
        estado: "nuevo",
        estado_display: "En cola",
        tecnico: null,
        permisos: {
          acciones: [],
          tomar: false,
          motivo_no_tomar: "Usted no atiende la categoría «Hardware».",
          responder: false,
          escalar: false,
          asignar: true,
        },
      }),
    );
    servicio.tecnicos.mockResolvedValue([]);
    abrir();
    expect(
      await screen.findByText("Nadie lo ha tomado: asígnelo a un técnico."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Usted no atiende la categoría «Hardware»."),
    ).toBeInTheDocument();
  });

  it("cada mensaje dice quién habló y un cerrado explica por qué no se responde", async () => {
    servicio.ticket.mockResolvedValue(
      ticket({
        estado: "cerrado",
        estado_display: "Cerrado",
        cerrado_en: "2026-10-20T15:00:00Z",
        encuesta: { calificacion: 4, resuelto: true, comentario: "Rápido" },
        mensajes: [
          {
            id: 1,
            texto: "No prende",
            del_solicitante: true,
            interno: false,
            autor: "Carla Ordóñez",
            fecha: "2026-10-16T10:00:00Z",
            adjuntos: [],
          },
          {
            id: 2,
            texto: "Revisar la fuente",
            del_solicitante: false,
            interno: true,
            autor: "Jorge Andrade",
            fecha: "2026-10-16T11:00:00Z",
            adjuntos: [],
          },
        ],
        permisos: {
          acciones: [],
          responder: true,
          escalar: false,
          asignar: false,
        },
      }),
    );
    abrir();
    const hilo = (await screen.findByText("Revisar la fuente")).closest("ul");
    expect(within(hilo).getByText("Usuario")).toBeInTheDocument();
    expect(within(hilo).getByText("Nota interna")).toBeInTheDocument();
    expect(screen.getByText(/ya no se puede responder/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Respuesta al usuario/)).toBeNull();
    // La encuesta del usuario, a la vista del equipo.
    expect(screen.getByText("4 de 5")).toBeInTheDocument();
    expect(screen.getByText("«Rápido»")).toBeInTheDocument();
  });

  it("la prioridad dice en qué quedará y no deja guardar sin cambios", async () => {
    servicio.ticket.mockResolvedValue(
      ticket({
        prioridad: "media",
        prioridad_display: "P3 · Media",
        impacto: "bajo",
        urgencia: "alta",
        permisos: {
          acciones: [],
          responder: false,
          escalar: false,
          asignar: false,
          prioridad: true,
        },
      }),
    );
    abrir();
    const boton = await screen.findByRole("button", {
      name: "Cambiar prioridad",
    });
    expect(boton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Impacto"), {
      target: { value: "alto" },
    });
    expect(
      screen.getByText(/Quedará en: P1 · Crítica \(antes/),
    ).toBeInTheDocument();
    expect(boton).toBeEnabled();
    fireEvent.click(boton);
    expect(servicio.cambiarPrioridad).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Justificación/)).toHaveAccessibleDescription(
      /Diga por qué cambia la prioridad\./,
    );
  });
});

describe("Mis tickets: qué le toca y qué pasó (auditoría UX/UI, 30/10/2026)", () => {
  function abrir() {
    pintar(<MiTicket />, "/admin/ayuda/tickets/42", "/admin/ayuda/tickets/:id");
  }

  it("si soporte espera su respuesta, se lo dice y lo lleva a responder", async () => {
    servicio.miTicket.mockResolvedValue({
      ...SEGUIMIENTO,
      estado: "esperando_usuario",
      estado_display: "Esperando su respuesta",
      posicion: null,
      atiende: "Jorge Andrade",
      mensajes: [
        {
          id: 1,
          texto: "¿Qué modelo es?",
          del_solicitante: false,
          autor: "Jorge Andrade",
          fecha: "2026-10-16T11:00:00Z",
          adjuntos: [],
        },
      ],
    });
    abrir();
    expect(
      await screen.findByText(/Soporte necesita algo de usted/),
    ).toBeInTheDocument();
    // Quién habló, en texto.
    expect(screen.getByText("Soporte TI")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    expect(screen.getByLabelText("Responder")).toHaveFocus();
  });

  it("atendido: dice cuándo se cierra solo y no ofrece la encuesta todavía", async () => {
    servicio.miTicket.mockResolvedValue({
      ...SEGUIMIENTO,
      estado: "atendido",
      estado_display: "Resuelto: falta su confirmación",
      posicion: null,
      puede_confirmar: true,
      puede_encuestar: false,
      cierre_automatico: "2026-11-04",
    });
    servicio.confirmarMiTicket.mockResolvedValue({
      ...SEGUIMIENTO,
      estado: "cerrado",
      estado_display: "Cerrado",
      posicion: null,
      puede_responder: false,
      puede_encuestar: true,
    });
    abrir();
    expect(
      await screen.findByText(/Si no nos responde, se cerrará solo el/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "¿Cómo lo atendimos?" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sí, quedó resuelto" }));
    // Dice qué pasó y la encuesta aparece ahora.
    expect(
      await screen.findByText(/¡Gracias! Cerramos su ticket/),
    ).toHaveFocus();
    expect(
      screen.getByRole("heading", { name: "¿Cómo lo atendimos?" }),
    ).toBeInTheDocument();
  });

  it("un ticket que no es suyo o no existe tiene salida y no ofrece reintentar", async () => {
    servicio.miTicket.mockRejectedValueOnce({ response: { status: 404 } });
    abrir();
    expect(
      await screen.findByRole("heading", { name: "Ticket no disponible" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Ver mis tickets" }),
    ).toHaveAttribute("href", "/admin/ayuda?vista=mios");
    expect(screen.queryByRole("button", { name: /Reintentar/ })).toBeNull();
  });

  it("en la lista pide la encuesta pendiente y avisa los atrasados", async () => {
    sesion.permisos = [];
    servicio.misTickets.mockResolvedValue([
      {
        id: 1,
        numero: "TCK-2026-000001",
        categoria: "Hardware",
        caso: "No enciende",
        estado: "nuevo",
        estado_display: "En cola",
        prioridad: "media",
        prioridad_display: "P3 · Media",
        posicion: 3,
        atrasado: true,
        creado: "2026-10-21T15:00:00Z",
      },
      {
        id: 2,
        numero: "TCK-2026-000002",
        categoria: "Accesos",
        caso: "Olvidé mi clave",
        estado: "cerrado",
        estado_display: "Cerrado",
        prioridad: "baja",
        prioridad_display: "P4 · Baja",
        posicion: null,
        puede_encuestar: true,
        creado: "2026-10-01T15:00:00Z",
      },
    ]);
    try {
      pintar(<Bandeja />, "/admin/soporte/bandeja", "/admin/soporte/bandeja");
      const tabla = await screen.findByRole("table", { name: "Mis tickets" });
      const filas = within(tabla).getAllByRole("row").slice(1);
      expect(filas[0]).toHaveTextContent("Cuéntenos cómo le fue");
      expect(filas[1]).toHaveTextContent("Tarda más de lo previsto");
    } finally {
      sesion.permisos = ["soporte.atender"];
    }
  });
});
