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
 * Las mejoras «antes de la Ola 1»: los dos relojes y el ajuste de prioridad
 * en la ficha, el alta interna con canal, la encuesta, el horario de la mesa y
 * los indicadores del piloto.
 */

const servicio = {
  ticket: vi.fn(),
  respuestas: vi.fn(),
  tecnicos: vi.fn(),
  cambiarPrioridad: vi.fn(),
  formularioInterno: vi.fn(),
  registrar: vi.fn(),
  personas: vi.fn(),
  miTicket: vi.fn(),
  encuestaMiTicket: vi.fn(),
  reportes: vi.fn(),
  config: { mesa: vi.fn(), guardarMesa: vi.fn() },
};
vi.mock("../src/api/soporteService", () => ({ soporteService: servicio }));

const { TicketDetalle } = await import("../src/pages/Soporte/TicketDetalle");
const { RegistrarTicket } =
  await import("../src/pages/Soporte/RegistrarTicket");
const { MiTicket } = await import("../src/pages/Ayuda/MiTicket");
const { HorarioMesaSoporte } =
  await import("../src/pages/Soporte/Configuracion/ConfiguracionSoporte");
const { ReportesSoporte } =
  await import("../src/pages/Soporte/ReportesSoporte");

function Destino() {
  return <p>Ficha abierta</p>;
}

function pintar(elemento, ruta, patron) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path={patron} element={elemento} />
        <Route path="/admin/soporte/tickets/:id" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  servicio.respuestas.mockResolvedValue([]);
});

const TICKET = {
  id: 42,
  numero: "TCK-2026-000042",
  estado: "en_curso",
  estado_display: "En curso",
  tipo: "incidente",
  tipo_display: "Incidente",
  codigo: "CAM-01",
  prioridad: "alta",
  prioridad_display: "P2 · Alta",
  prioridad_base: "alta",
  canal: "telefono",
  canal_display: "Teléfono",
  registrado_por: "Jorge Andrade",
  categoria: "Dispositivos de campo",
  caso: "Handheld con falla",
  agencia: "Loja",
  area: "Operaciones",
  nivel: "N1 · Mesa de ayuda",
  tecnico: { id: 1, nombre: "Jorge Andrade" },
  solicitante_nombre: "Carla",
  solicitante_telefono: "",
  solicitante_correo: "carla@x.com",
  impacto: "",
  urgencia: "",
  descripcion: "No escanea",
  sla: {
    estado: "en_plazo",
    vence: "2026-10-16T18:00:00Z",
    minutos: 480,
    respuesta: { estado: "cumplida", vence: null, minutos: 30 },
  },
  reaperturas: 1,
  created_at: "2026-10-16T10:00:00Z",
  adjuntos: [],
  mensajes: [],
  movimientos: [],
  permisos: { acciones: [], prioridad: true },
};

describe("La ficha con el flujo ITIL", () => {
  it("muestra tipo, código, canal y los dos relojes", async () => {
    servicio.ticket.mockResolvedValue(TICKET);
    pintar(<TicketDetalle />, "/t/42", "/t/:id");
    // Tipo, categoría y código en la línea bajo el caso.
    expect(
      await screen.findByText(/^Incidente · .* · CAM-01$/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Registrado por Jorge Andrade"),
    ).toBeInTheDocument();
    expect(screen.getByText("Respondida a tiempo")).toBeInTheDocument();
    expect(screen.getByText("En plazo")).toBeInTheDocument();
  });

  it("ajusta la prioridad por la matriz, con justificación", async () => {
    servicio.ticket.mockResolvedValue(TICKET);
    servicio.cambiarPrioridad.mockResolvedValue({
      ...TICKET,
      prioridad: "critica",
      prioridad_display: "P1 · Crítica",
    });
    pintar(<TicketDetalle />, "/t/42", "/t/:id");
    fireEvent.change(await screen.findByLabelText("Impacto"), {
      target: { value: "alto" },
    });
    fireEvent.change(screen.getByLabelText("Urgencia"), {
      target: { value: "alta" },
    });
    fireEvent.change(screen.getByLabelText(/^Justificación/), {
      target: { value: "Toda la bodega sin escáneres" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar prioridad" }));
    await waitFor(() =>
      expect(servicio.cambiarPrioridad).toHaveBeenCalledWith(42, {
        impacto: "alto",
        urgencia: "alta",
        justificacion: "Toda la bodega sin escáneres",
      }),
    );
    expect(
      await screen.findByText(/el plazo se recalculó/),
    ).toBeInTheDocument();
  });
});

describe("El alta interna", () => {
  it("registra con su canal y se lo asigna a quien llama", async () => {
    servicio.formularioInterno.mockResolvedValue({
      empresa: "LaarCourier",
      disponible: true,
      soy_tecnico: true,
      canales: [
        { id: "telefono", nombre: "Teléfono" },
        { id: "whatsapp", nombre: "WhatsApp" },
      ],
      agencias: [{ id: 1, nombre: "Loja · Agencia" }],
      areas: [],
      categorias: [
        {
          id: 3,
          nombre: "Dispositivos de campo",
          casos: [
            { id: 4, nombre: "Handheld", prioridad_display: "P2 · Alta" },
          ],
        },
      ],
      campos: [
        {
          clave: "categoria",
          etiqueta: "Categoría",
          tipo: "lista",
          base: true,
          obligatorio: true,
          categorias: [],
        },
        {
          clave: "caso",
          etiqueta: "Caso",
          tipo: "lista",
          base: true,
          obligatorio: true,
          categorias: [],
        },
        {
          clave: "descripcion",
          etiqueta: "Descripción",
          tipo: "parrafo",
          base: true,
          obligatorio: true,
          categorias: [],
        },
      ],
    });
    servicio.personas.mockResolvedValue([
      {
        id: 7,
        nombre: "Carla Ordóñez",
        correo: "carla@grupolaar.com",
        telefono: "",
        area: { id: 2, nombre: "Cobranzas" },
        agencia: null,
        faltan: ["telefono", "agencia"],
      },
    ]);
    servicio.registrar.mockResolvedValue({ id: 42 });
    pintar(<RegistrarTicket />, "/r", "/r");

    // Solo personas registradas: se elige de la lista y sus datos se cargan.
    fireEvent.click(
      await screen.findByRole("button", { name: /Carla Ordóñez/ }),
    );
    expect(screen.getByText("Cobranzas")).toBeInTheDocument();
    // Le faltan teléfono y agencia: se completan para este ticket.
    fireEvent.change(screen.getByLabelText(/^Teléfono/), {
      target: { value: "0994182273" },
    });
    fireEvent.change(screen.getByLabelText(/^Agencia/), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("¿Por dónde llegó?"), {
      target: { value: "whatsapp" },
    });
    fireEvent.change(screen.getByLabelText(/^Categoría/), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText(/^Caso/), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText(/^Descripción/), {
      target: { value: "No escanea" },
    });
    fireEvent.click(screen.getByLabelText(/Me lo asigno/));
    fireEvent.click(screen.getByRole("button", { name: "Registrar ticket" }));

    await waitFor(() => expect(servicio.registrar).toHaveBeenCalled());
    const [campos] = servicio.registrar.mock.calls[0];
    expect(campos).toMatchObject({
      canal: "whatsapp",
      asignarme: "true",
      solicitante: 7,
      telefono: "0994182273",
      sede: "1",
      caso: "4",
    });
    expect(await screen.findByText("Ficha abierta")).toBeInTheDocument();
  });
});

describe("La encuesta de satisfacción", () => {
  it("se responde con estrellas, resuelto y comentario", async () => {
    const base = {
      numero: "TCK-2026-000042",
      empresa: "LaarCourier",
      estado: "cerrado",
      estado_display: "Cerrado",
      posicion: null,
      categoria: "Hardware",
      caso: "No enciende",
      prioridad_display: "P3 · Media",
      descripcion: "x",
      creado: "2026-10-16T10:00:00Z",
      adjuntos: [],
      mensajes: [],
      puede_responder: false,
      puede_confirmar: false,
      puede_encuestar: true,
      encuesta: null,
    };
    servicio.miTicket.mockResolvedValue(base);
    servicio.encuestaMiTicket.mockResolvedValue({
      ...base,
      puede_encuestar: false,
      encuesta: { calificacion: 4, resuelto: true, comentario: "" },
    });
    pintar(<MiTicket />, "/admin/ayuda/tickets/42", "/admin/ayuda/tickets/:id");

    fireEvent.click(await screen.findByRole("radio", { name: /^4 de 5/ }));
    fireEvent.click(screen.getByLabelText("Sí"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar encuesta" }));
    await waitFor(() =>
      expect(servicio.encuestaMiTicket).toHaveBeenCalledWith("42", {
        calificacion: 4,
        resuelto: true,
        comentario: "",
      }),
    );
    expect(
      await screen.findByText(/Gracias por su respuesta/),
    ).toBeInTheDocument();
  });
});

describe("Horario y metas de la mesa", () => {
  it("guarda las metas, el 24/7 y el horario", async () => {
    const mesa = {
      meta_sla: 85,
      meta_sla_critica: 95,
      critica_24x7: true,
      horario_por_defecto: true,
      horarios: [{ dia_semana: 0, hora_inicio: "08:00", hora_fin: "17:30" }],
      feriados: [],
    };
    servicio.config.mesa.mockResolvedValue(mesa);
    servicio.config.guardarMesa.mockResolvedValue({
      ...mesa,
      meta_sla: 90,
      horario_por_defecto: false,
    });
    render(<HorarioMesaSoporte />);
    expect(
      await screen.findByText(/Rige el horario por defecto/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Meta de cumplimiento (%)"), {
      target: { value: "90" },
    });
    fireEvent.click(screen.getByLabelText(/horas calendario/));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(servicio.config.guardarMesa).toHaveBeenCalledWith(
        expect.objectContaining({ meta_sla: 90, critica_24x7: false }),
      ),
    );
  });
});

describe("Los indicadores del piloto", () => {
  it("muestran FCR, satisfacción y el cumplimiento por prioridad contra su meta", async () => {
    servicio.reportes.mockResolvedValue({
      kpis: {
        creados: 10,
        en_cola: 1,
        atendidos: 8,
        canal_oficial: 70,
        cumplimiento_respuesta: 95,
        cumplimiento_sla: 88,
        meta_sla: 85,
        fcr: 62.5,
        csat: 4.3,
        respuesta_encuesta: 50,
        reabiertos: 0,
        minutos_promedio: 90,
        escalados_sla: 0,
        horas_fuera_aprobadas: "0",
      },
      prioridades: [
        {
          prioridad: "critica",
          etiqueta: "P1 · Crítica",
          tickets: 2,
          cumplimiento: 90,
          meta: 95,
        },
        {
          prioridad: "media",
          etiqueta: "P3 · Media",
          tickets: 8,
          cumplimiento: 87.5,
          meta: 85,
        },
      ],
      graficos: [],
      tecnicos: [],
    });
    render(<ReportesSoporte />);
    expect(await screen.findByText("62.5 %")).toBeInTheDocument();
    expect(screen.getByText("4.3 / 5")).toBeInTheDocument();
    expect(screen.getByText("50 % respondió la encuesta")).toBeInTheDocument();
    // Cada indicador dice si cumple su meta, en texto y en el color.
    const sla = screen
      .getByText("Solucionados a tiempo", { selector: ".mz-kpi-label" })
      .closest(".mz-kpi");
    expect(within(sla).getByText("88 %")).toBeInTheDocument();
    expect(
      within(sla).getByText(/Cumple la meta \(≥ 85 %\)/),
    ).toBeInTheDocument();
    expect(sla).toHaveClass("mz-kpi--ok");
    const canal = screen
      .getByText("Pedidos por el sistema", { selector: ".mz-kpi-label" })
      .closest(".mz-kpi");
    expect(
      within(canal).getByText(/No cumple la meta \(≥ 80 %\)/),
    ).toBeInTheDocument();
    expect(canal).toHaveClass("mz-kpi--bad");
    expect(screen.getByText("90 % · no cumple la meta")).toHaveClass(
      "soporte-meta--bajo",
    );
    expect(screen.getByText("87.5 %")).toHaveClass("soporte-meta--ok");
  });

  it("los vencidos sin responder se ven y bajan el cumplimiento", async () => {
    servicio.reportes.mockResolvedValue({
      kpis: {
        creados: 7,
        en_cola: 7,
        atendidos: 0,
        cumplimiento_respuesta: 0,
        medidos_respuesta: 1,
        respuestas_vencidas: 1,
        cumplimiento_sla: null,
        medidos_sla: 0,
        vencidos_abiertos: 0,
        meta_sla: 85,
      },
      prioridades: [
        {
          prioridad: "critica",
          etiqueta: "P1 · Crítica",
          tickets: 1,
          cumplimiento: 0,
          meta: 95,
          plazo_respuesta: 15,
          plazo_solucion: 240,
        },
      ],
      graficos: [],
      tecnicos: [],
    });
    render(<ReportesSoporte />);
    const respuesta = (
      await screen.findByText("Respondidos a tiempo", {
        selector: ".mz-kpi-label",
      })
    ).closest(".mz-kpi");
    expect(respuesta).toHaveClass("mz-kpi--bad");
    expect(
      within(respuesta).getByText("1 sin responder con el plazo vencido"),
    ).toBeInTheDocument();
    const solucion = screen
      .getByText("Solucionados a tiempo", { selector: ".mz-kpi-label" })
      .closest(".mz-kpi");
    expect(within(solucion).getByText("—")).toBeInTheDocument();
    expect(
      within(solucion).getByText("Aún no hay tickets para medir"),
    ).toBeInTheDocument();
    // Los plazos de la prioridad, junto al cumplimiento.
    const fila = screen.getByText("P1 · Crítica").closest("tr");
    expect(within(fila).getByText("15 min")).toBeInTheDocument();
    expect(within(fila).getByText("4 h")).toBeInTheDocument();
    // Por defecto, el mes en curso.
    expect(servicio.reportes).toHaveBeenCalledWith({
      periodo: expect.stringMatching(/^\d{4}-\d{2}$/),
    });
  });
});

describe("Nombres propios de la mesa", () => {
  it("guarda el nombre propio de un estado", async () => {
    servicio.config.mesa.mockResolvedValue({
      meta_sla: 85,
      meta_sla_critica: 95,
      critica_24x7: true,
      horario_por_defecto: false,
      horarios: [],
      feriados: [],
      etiquetas: {},
      etiquetas_por_defecto: {
        estados: { atendido: "Atendido" },
        prioridades: { critica: "P1 · Crítica" },
      },
    });
    servicio.config.guardarMesa.mockImplementation(async (datos) => ({
      ...datos,
      horario_por_defecto: false,
      etiquetas_por_defecto: {
        estados: { atendido: "Atendido" },
        prioridades: { critica: "P1 · Crítica" },
      },
    }));
    render(<HorarioMesaSoporte />);
    expect(screen.queryByLabelText("Dominios de correo internos")).toBeNull();
    fireEvent.change(await screen.findByLabelText("Atendido"), {
      target: { value: "Resuelto" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(servicio.config.guardarMesa).toHaveBeenCalledWith(
        expect.objectContaining({
          etiquetas: { estados: { atendido: "Resuelto" } },
        }),
      ),
    );
  });
});
