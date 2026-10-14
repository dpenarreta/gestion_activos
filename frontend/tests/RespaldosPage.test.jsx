import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Cuándo se respalda solo, y respaldar ya.
 *
 * Lo que se prueba es que el «cuándo» se decida desde aquí: la tarea del
 * sistema pasa cada pocos minutos, siempre igual, y esta pantalla es la que
 * dice si toca. Si no lo dijera, cambiar la hora necesitaría un administrador
 * de servidores.
 */

const leer = vi.fn();
const guardar = vi.fn();
const respaldarAhora = vi.fn();
const archivos = vi.fn();
const borrar = vi.fn();

vi.mock("../src/api/respaldosService", () => ({
  respaldosService: {
    politica: (...args) => leer(...args),
    guardar: (...args) => guardar(...args),
    respaldarAhora: (...args) => respaldarAhora(...args),
    archivos: (...args) => archivos(...args),
    borrar: (...args) => borrar(...args),
  },
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { RespaldosPage } =
  await import("../src/pages/Admin/Configuracion/RespaldosPage");

const POLITICA = {
  activo: true,
  dias: [0, 1, 2, 3, 4, 5, 6],
  horas: ["02:30"],
  destino: "respaldos",
  conservar: 14,
  ultimo_programado: "2026-09-17T02:30:00-05:00",
  solicitado_en: null,
  ultima_ejecucion: "2026-09-17T02:33:10-05:00",
  ultimo_error: "",
  ultimo_en_disco: "2026-09-17T02:31:00-05:00",
  proximo: "2026-09-18T02:30:00-05:00",
  tarea_cada_minutos: 5,
  zona_horaria: "America/Guayaquil",
};

function respaldo(marca, extra = {}) {
  return {
    marca,
    fecha: `${marca.slice(0, 4)}-${marca.slice(4, 6)}-${marca.slice(6, 8)}T${marca.slice(9, 11)}:${marca.slice(11)}:00-05:00`,
    archivos: [],
    bytes: 21 * 1024 * 1024,
    tiene_base: true,
    tiene_adjuntos: true,
    contenido: { activos: 21, adjuntos: 1 },
    es_el_mas_reciente: false,
    ...extra,
  };
}

const EN_DISCO = {
  borra_la_base: true,
  respaldos: [
    respaldo("20261014-1525", { es_el_mas_reciente: true }),
    respaldo("20261013-0305"),
  ],
};

function pintar() {
  return render(
    <MemoryRouter>
      <RespaldosPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  permisos.add("configuracion.respaldos");
  leer.mockResolvedValue(POLITICA);
  guardar.mockImplementation((datos) =>
    Promise.resolve({ ...POLITICA, ...datos }),
  );
  archivos.mockResolvedValue(EN_DISCO);
  borrar.mockResolvedValue({});
  respaldarAhora.mockResolvedValue({
    ...POLITICA,
    solicitado_en: "2026-09-17T10:00:00-05:00",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("El horario del respaldo", () => {
  it("muestra cuándo fue el último y cuándo toca el próximo, en hora del sistema", async () => {
    /* Es la pregunta que trae a esta pantalla: de cuándo se puede volver. Y en
       la hora de Ecuador: «02:30» configurado se lee «02:30», no 07:30 UTC. */
    pintar();

    expect(await screen.findByText(/18\/09\/2026.*02:30/)).toBeInTheDocument();
    expect(screen.getByText(/17\/09\/2026.*02:31/)).toBeInTheDocument();
  });

  it("guarda los días y varias horas", async () => {
    pintar();

    // De lunes a viernes, quitando el fin de semana.
    fireEvent.click(
      await screen.findByRole("button", { name: "Lunes a viernes" }),
    );
    fireEvent.change(screen.getByLabelText("Agregar hora"), {
      target: { value: "13:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Agregar hora/ }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(guardar).toHaveBeenCalled());
    expect(guardar.mock.calls[0][0]).toMatchObject({
      activo: true,
      dias: [0, 1, 2, 3, 4],
      horas: ["02:30", "13:00"],
      destino: "respaldos",
      conservar: 14,
    });
  });

  it("un día se marca y se desmarca", async () => {
    pintar();

    const sabado = await screen.findByRole("button", { name: "Sábado" });
    expect(sabado).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(sabado);
    expect(sabado).toHaveAttribute("aria-pressed", "false");
  });

  it("la única hora no se puede quitar: sin horas no habría horario", async () => {
    pintar();

    await screen.findByText("02:30");
    expect(
      screen.queryByRole("button", { name: "Quitar 02:30" }),
    ).not.toBeInTheDocument();
  });

  it("apagado, lo dice en vez de anunciar un próximo que no ocurrirá", async () => {
    leer.mockResolvedValue({ ...POLITICA, activo: false, proximo: null });

    pintar();

    expect(
      await screen.findByText("Respaldo automático apagado"),
    ).toBeInTheDocument();
  });

  it("si el último falló, lo dice con el motivo", async () => {
    /* Un respaldo que falla todas las noches —Docker apagado, disco lleno— no
       puede quedar solo en una salida que nadie mira. */
    leer.mockResolvedValue({
      ...POLITICA,
      ultimo_error: "SQL Server no pudo escribir el respaldo",
    });

    pintar();

    expect(
      await screen.findByText("El último respaldo no se completó."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("SQL Server no pudo escribir el respaldo"),
    ).toBeInTheDocument();
  });
});

describe("Respaldar ahora", () => {
  it("deja la orden y dice cuánto tarda en empezar", async () => {
    pintar();

    fireEvent.click(
      await screen.findByRole("button", { name: /Respaldar ahora/ }),
    );

    await waitFor(() => expect(respaldarAhora).toHaveBeenCalled());
    expect(
      await screen.findByText(/en los próximos 5 minutos/),
    ).toBeInTheDocument();
    // Pedirlo dos veces no hace dos: el botón queda en espera.
    expect(screen.getByRole("button", { name: /en cola/ })).toBeDisabled();
  });

  it("avisa cuando la tarea lo terminó", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    leer
      .mockResolvedValueOnce({
        ...POLITICA,
        solicitado_en: "2026-09-17T10:00:00-05:00",
      })
      .mockResolvedValue(POLITICA);

    pintar();
    await screen.findByText(/en los próximos 5 minutos/);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(
      await screen.findByText("Respaldo terminado y verificado."),
    ).toBeInTheDocument();
  });
});

describe("Respaldos guardados", () => {
  it("lista los respaldos con su tamaño y lo que incluyen", async () => {
    pintar();

    expect(await screen.findByText("2 respaldos · 42 MB")).toBeInTheDocument();
    expect(
      screen.getAllByText("21 activos · 1 adjuntos").length,
    ).toBeGreaterThan(0);
  });

  it("el más reciente no se puede borrar, y dice por qué", async () => {
    pintar();

    await screen.findByText("2 respaldos · 42 MB");
    const motivos = screen.getAllByText(
      /Es el más reciente: se conserva siempre/,
    );
    expect(motivos.length).toBeGreaterThan(0);
    const botones = screen.getAllByRole("button", { name: /Borrar/ });
    const protegido = botones.find((b) =>
      b.getAttribute("aria-describedby")?.includes("20261014-1525"),
    );
    expect(protegido).toBeDisabled();
    expect(botones.filter((b) => !b.disabled).length).toBeGreaterThan(0);
  });

  it("borrar pide confirmación y después borra ese respaldo", async () => {
    pintar();

    await screen.findByText("2 respaldos · 42 MB");
    const borrables = screen
      .getAllByRole("button", { name: /^Borrar$/ })
      .filter((b) => !b.disabled);
    fireEvent.click(borrables[0]);

    expect(borrar).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/no se podrá recuperar/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Borrar respaldo" }));

    await waitFor(() => expect(borrar).toHaveBeenCalledWith("20261013-0305"));
    // Se vuelve a leer la carpeta para que la lista quede al día.
    await waitFor(() => expect(archivos).toHaveBeenCalledTimes(2));
  });

  it("sin la carpeta de la base montada, avisa que la copia queda en el servidor", async () => {
    archivos.mockResolvedValue({ ...EN_DISCO, borra_la_base: false });

    pintar();

    expect(
      await screen.findByText(/la copia de la base queda en el servidor/),
    ).toBeInTheDocument();
  });
});

describe("Quién puede cambiarlo", () => {
  it("configurar la apariencia no habilita a cambiar el respaldo", async () => {
    /* Eran el mismo permiso y son responsabilidades distintas: cambiar el logo
       no debería decidir de cuándo se puede volver si algo se pierde. */
    permisos.clear();
    permisos.add("configuracion.editar");
    permisos.add("configuracion.ver");
    pintar();

    expect(
      await screen.findByLabelText("Respaldar automáticamente"),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Lunes" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Respaldar ahora/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Guardar" }),
    ).not.toBeInTheDocument();
    // Ve los respaldos, pero no los borra.
    await screen.findByText("2 respaldos · 42 MB");
    expect(
      screen.queryByRole("button", { name: /Borrar/ }),
    ).not.toBeInTheDocument();
  });

  it("si no se puede cargar, lo dice", async () => {
    leer.mockRejectedValue({
      response: { data: { error: { message: "Sin permiso." } } },
    });

    pintar();

    expect(await screen.findByText("Sin permiso.")).toBeInTheDocument();
  });
});
