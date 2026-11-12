import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * US-012: cancelar vacaciones aprobadas desde «Mis vacaciones».
 */

const permisos = { lista: [] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { permissions: permisos.lista } }),
}));

const servicio = {
  misVacaciones: vi.fn(),
  personasVacaciones: vi.fn(),
  vacacionesDe: vi.fn(),
};
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: servicio,
}));

const licencias = { cancelar: vi.fn() };
vi.mock("../src/api/licenciasService", () => ({
  licenciasService: licencias,
}));

const insignias = { avisar: vi.fn() };
vi.mock("../src/utils/insigniasDelMenu", () => ({
  avisarCambioDeInsignias: (...args) => insignias.avisar(...args),
}));

const { MisVacacionesPage } =
  await import("../src/pages/Institucional/MisVacacionesPage");

function pintar() {
  return render(
    <MemoryRouter>
      <MisVacacionesPage />
    </MemoryRouter>,
  );
}

const BASE = {
  persona: { id: 1, nombre: "Ana" },
  correspondientes: 15,
  gozados: 0,
  pendientes: 15,
  reservados: 0,
  disponibles: 15,
  periodos_con_pendientes: 1,
  regla: { sabados: 0, domingos: 0 },
  en_curso: [],
  periodos: [
    {
      id: 1,
      nombre: "2025 – 2026",
      desde: "2025-03-01",
      hasta: "2026-02-28",
      correspondientes: 15,
      gozados: 0,
      pendientes: 15,
      reservados: 0,
      disponibles: 15,
      sabados: 0,
      domingos: 0,
      nota: "",
      goces: [],
    },
  ],
};

const POR_EMPEZAR = {
  id: 71,
  desde: "2026-12-14",
  hasta: "2026-12-18",
  dias: 5,
  momento: "por_empezar",
  puede_cancelar: true,
  // Antes de empezar el servidor no manda opciones: se devuelve todo.
  opciones_devolver: [],
  dias_por_opcion: { restantes: 5, todos: 5, ninguno: 0 },
};
const EN_CURSO = {
  id: 72,
  desde: "2026-11-09",
  hasta: "2026-11-20",
  dias: 10,
  momento: "en_curso",
  puede_cancelar: true,
  opciones_devolver: ["restantes", "todos", "ninguno"],
  dias_por_opcion: { restantes: 4, todos: 10, ninguno: 0 },
};
const TERMINADA = {
  id: 73,
  desde: "2026-10-05",
  hasta: "2026-10-09",
  dias: 5,
  momento: "terminada",
  puede_cancelar: false,
  opciones_devolver: [],
  dias_por_opcion: { restantes: 0, todos: 5, ninguno: 0 },
};

function conAprobadas(aprobadas) {
  servicio.misVacaciones.mockResolvedValue({ ...BASE, aprobadas });
}

async function abrir(indice = 0) {
  const boton = (
    await screen.findAllByRole("button", { name: /^Cancelar vacaciones/ })
  )[indice];
  // Un clic real deja el foco en el botón; fireEvent.click no.
  boton.focus();
  fireEvent.click(boton);
  return {
    boton,
    ventana: await screen.findByRole("dialog", { name: "Cancelar vacaciones" }),
  };
}

const enviar = (ventana) =>
  fireEvent.click(
    within(ventana).getByRole("button", { name: "Cancelar vacaciones" }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = [];
  conAprobadas([]);
});

describe("Vacaciones aprobadas", () => {
  it("sin aprobadas no hay sección", async () => {
    pintar();
    await screen.findByText("Disponibles para pedir");
    expect(
      screen.queryByRole("region", { name: "Vacaciones aprobadas" }),
    ).toBeNull();
  });

  it("lista fechas, días y momento; el botón solo donde puede_cancelar", async () => {
    conAprobadas([POR_EMPEZAR, EN_CURSO, TERMINADA]);
    pintar();
    const seccion = await screen.findByRole("region", {
      name: "Vacaciones aprobadas",
    });
    const filas = within(seccion).getAllByRole("listitem");
    expect(filas).toHaveLength(3);
    expect(filas[0]).toHaveTextContent("14/12/2026 al 18/12/2026");
    expect(filas[0]).toHaveTextContent("5 días");
    expect(within(filas[0]).getByText("Por empezar")).toBeInTheDocument();
    expect(within(filas[1]).getByText("En curso")).toBeInTheDocument();
    expect(within(filas[2]).getByText("Terminadas")).toBeInTheDocument();
    // El botón dice a qué vacaciones se refiere.
    expect(
      within(filas[0]).getByRole("button", {
        name: "Cancelar vacaciones del 14/12/2026 al 18/12/2026",
      }),
    ).toBeInTheDocument();
    expect(
      within(filas[2]).queryByRole("button", { name: /Cancelar vacaciones/ }),
    ).toBeNull();
    // Terminadas y propias: se dice a quién pedirlo.
    expect(filas[2]).toHaveTextContent(
      "Para cancelarlas, pídalo a Gestión Humana.",
    );
  });
});

describe("Ventana para cancelar", () => {
  it("por empezar: pide un Motivo, explica y envía la única opción", async () => {
    conAprobadas([POR_EMPEZAR]);
    licencias.cancelar.mockResolvedValue({ id: 71, estado: "cancelada" });
    pintar();
    const { ventana } = await abrir();
    expect(ventana).toHaveTextContent(
      "Cancela sus vacaciones antes de que empiecen. Se le devolverán los 5 días. Se avisará a su jefe inmediato.",
    );
    expect(ventana).toHaveTextContent(
      "Esta acción no se puede deshacer: para volver a tomarlas habrá que pedirlas de nuevo.",
    );
    expect(ventana).not.toHaveTextContent(/y a la persona/);
    expect(within(ventana).queryByRole("radio")).toBeNull();
    const motivo = within(ventana).getByLabelText(/^Motivo/);
    expect(motivo).toHaveAttribute("aria-required", "true");

    // Sin motivo no se envía y el error va bajo el campo.
    enviar(ventana);
    expect(motivo).toHaveAccessibleDescription(/Escriba el motivo/);
    expect(licencias.cancelar).not.toHaveBeenCalled();

    fireEvent.change(motivo, { target: { value: "Cambió el viaje" } });
    // Tras cancelar, la recarga ya no trae esas vacaciones.
    conAprobadas([]);
    enviar(ventana);
    await waitFor(() =>
      // Sin opciones, no se envía `devolver`: el servidor devuelve todo.
      expect(licencias.cancelar).toHaveBeenCalledWith(
        71,
        "Cambió el viaje",
        undefined,
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Se cancelaron las vacaciones del 14/12/2026 al 18/12/2026. Se devolvieron 5 días. Se avisó a su jefe inmediato.",
    );
    await waitFor(() =>
      expect(servicio.misVacaciones).toHaveBeenCalledTimes(2),
    );
    expect(insignias.avisar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Vacaciones aprobadas" }),
      ).toBeNull(),
    );
    expect(screen.getByRole("status")).toHaveFocus();
  });

  it("en curso: Justificación y radios con las tres opciones, a elegir", async () => {
    conAprobadas([EN_CURSO]);
    licencias.cancelar.mockResolvedValue({ id: 72, estado: "cancelada" });
    pintar();
    const { ventana } = await abrir();
    const grupo = within(ventana).getByRole("radiogroup", {
      name: /¿Qué pasa con los días\?/,
    });
    expect(grupo.tagName).toBe("FIELDSET");
    expect(ventana).toHaveTextContent("Sus vacaciones ya empezaron.");
    const radios = within(grupo).getAllByRole("radio");
    expect(radios.map((r) => r.labels[0].textContent)).toEqual([
      "Devolver los días que faltan: 4 días (desde hoy, incluido)",
      "Devolver todos los días: 10 días",
      "No devolver días: los 10 días siguen contando como gozados",
    ]);
    expect(radios.every((r) => !r.checked)).toBe(true);
    const justificacion = within(ventana).getByLabelText(/^Justificación/);

    // Sin nada: error en la justificación y en la elección de días.
    enviar(ventana);
    expect(justificacion).toHaveAccessibleDescription(
      /Escriba la justificación/,
    );
    expect(grupo).toHaveAccessibleDescription(/Elija qué pasa con los días/);
    expect(licencias.cancelar).not.toHaveBeenCalled();

    fireEvent.change(justificacion, { target: { value: "Se reincorporó" } });
    // Con un error, el grupo queda marcado y cada radio apunta al error.
    await waitFor(() => expect(grupo).toHaveAttribute("aria-invalid", "true"));
    expect(radios[0]).toHaveAccessibleDescription(/Elija qué pasa/);
    fireEvent.click(radios[2]);
    enviar(ventana);
    await waitFor(() =>
      expect(licencias.cancelar).toHaveBeenCalledWith(
        72,
        "Se reincorporó",
        "ninguno",
      ),
    );
    // El éxito sale de la opción enviada: sin devolver, no dice «10 días».
    expect(await screen.findByRole("status")).toHaveTextContent(
      "No se devolvieron días. Se avisó a su jefe inmediato y a quienes las aprobaron.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(/10 días/);
  });

  it("en curso con una sola opción: texto informativo, sin radios", async () => {
    conAprobadas([{ ...EN_CURSO, opciones_devolver: ["restantes"] }]);
    licencias.cancelar.mockResolvedValue({ id: 72 });
    pintar();
    const { ventana } = await abrir();
    expect(within(ventana).queryByRole("radio")).toBeNull();
    expect(ventana).toHaveTextContent(
      "Se le devolverán los 4 días que faltan (desde hoy, incluido).",
    );
    fireEvent.change(within(ventana).getByLabelText(/^Justificación/), {
      target: { value: "Cambio de planes" },
    });
    enviar(ventana);
    await waitFor(() =>
      expect(licencias.cancelar).toHaveBeenCalledWith(
        72,
        "Cambio de planes",
        "restantes",
      ),
    );
  });

  it("terminada (Gestión Humana): errores del servidor junto a su campo", async () => {
    conAprobadas([
      {
        ...TERMINADA,
        puede_cancelar: true,
        opciones_devolver: ["todos", "ninguno"],
      },
    ]);
    licencias.cancelar.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            message: "Error en la solicitud.",
            details: {
              comentario: ["Diga por qué."],
              devolver: ["Esa opción no está permitida."],
            },
          },
        },
      },
    });
    pintar();
    const { ventana } = await abrir();
    expect(
      within(ventana)
        .getAllByRole("radio")
        .map((r) => r.labels[0].textContent),
    ).toEqual([
      "Devolver todos los días: 5 días",
      "No devolver días: los 5 días siguen contando como gozados",
    ]);
    const justificacion = within(ventana).getByLabelText(/^Justificación/);
    fireEvent.change(justificacion, { target: { value: "Error de carga" } });
    fireEvent.click(within(ventana).getByLabelText(/^Devolver todos los días/));
    enviar(ventana);
    await waitFor(() =>
      expect(justificacion).toHaveAccessibleDescription("Diga por qué."),
    );
    expect(
      within(ventana).getByRole("radiogroup", {
        name: /¿Qué pasa con los días\?/,
      }),
    ).toHaveAccessibleDescription("Esa opción no está permitida.");
    // La ventana sigue abierta y nada se avisó.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(insignias.avisar).not.toHaveBeenCalled();
  });

  it("un error sin campo (403) se muestra en la ventana", async () => {
    conAprobadas([POR_EMPEZAR]);
    licencias.cancelar.mockRejectedValue({
      response: {
        status: 403,
        data: { error: { message: "No tiene permiso para esto." } },
      },
    });
    pintar();
    const { ventana } = await abrir();
    fireEvent.change(within(ventana).getByLabelText(/^Motivo/), {
      target: { value: "Por error" },
    });
    enviar(ventana);
    expect(await within(ventana).findByRole("alert")).toHaveTextContent(
      "No tiene permiso para esto.",
    );
  });

  it("«Volver» cierra sin cancelar y el foco regresa al botón", async () => {
    conAprobadas([POR_EMPEZAR]);
    pintar();
    const { boton, ventana } = await abrir();
    fireEvent.click(within(ventana).getByRole("button", { name: "Volver" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(boton).toHaveFocus();
    expect(licencias.cancelar).not.toHaveBeenCalled();
  });

  it("al ver a otra persona: mismo botón, avisa también a la persona y recarga la suya", async () => {
    permisos.lista = ["vacaciones.ver_todas"];
    servicio.personasVacaciones.mockResolvedValue([
      { id: 9, nombre: "Beto Paz", periodos: 1, pendientes: 3, disponibles: 3 },
    ]);
    servicio.vacacionesDe.mockResolvedValue({
      ...BASE,
      persona: { id: 9, nombre: "Beto Paz" },
      aprobadas: [POR_EMPEZAR],
    });
    licencias.cancelar.mockResolvedValue({ id: 71 });
    pintar();
    fireEvent.click(
      await screen.findByText(/Consultar las vacaciones de otra persona/),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Beto Paz/ }));
    const { ventana } = await abrir();
    expect(ventana).toHaveTextContent(
      "Cancela las vacaciones de Beto Paz antes de que empiecen. Se le devolverán los 5 días. Se avisará a su jefe inmediato y a Beto Paz.",
    );
    expect(ventana).toHaveTextContent("Vacaciones de Beto Paz");
    fireEvent.change(within(ventana).getByLabelText(/^Motivo/), {
      target: { value: "Pedido por su jefatura" },
    });
    enviar(ventana);
    await waitFor(() => expect(licencias.cancelar).toHaveBeenCalled());
    await waitFor(() => expect(servicio.vacacionesDe).toHaveBeenCalledTimes(2));
    expect(servicio.vacacionesDe).toHaveBeenLastCalledWith(9);
    expect(insignias.avisar).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Se cancelaron las vacaciones de Beto Paz del 14/12/2026 al 18/12/2026. Se devolvieron 5 días. Se avisó a su jefe inmediato y a Beto Paz.",
    );
  });

  it("de otra persona, terminada y sin permiso, no hay botón ni la nota de pedirlo", async () => {
    permisos.lista = ["vacaciones.ver_todas"];
    servicio.personasVacaciones.mockResolvedValue([
      { id: 9, nombre: "Beto Paz", periodos: 1, pendientes: 3, disponibles: 3 },
    ]);
    servicio.vacacionesDe.mockResolvedValue({
      ...BASE,
      persona: { id: 9, nombre: "Beto Paz" },
      aprobadas: [TERMINADA],
    });
    pintar();
    fireEvent.click(
      await screen.findByText(/Consultar las vacaciones de otra persona/),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Beto Paz/ }));
    const seccion = await screen.findByRole("region", {
      name: "Vacaciones aprobadas",
    });
    expect(
      within(seccion).queryByRole("button", { name: /Cancelar/ }),
    ).toBeNull();
    expect(seccion).not.toHaveTextContent(/pídalo a Gestión Humana/);
  });

  it("un error de «devolver» sin radios en pantalla avisa que cambió y recarga al cerrar", async () => {
    conAprobadas([POR_EMPEZAR]);
    licencias.cancelar.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            message: "Error en la solicitud.",
            details: { devolver: ["Esa opción no está permitida."] },
          },
        },
      },
    });
    pintar();
    const { ventana } = await abrir();
    fireEvent.change(within(ventana).getByLabelText(/^Motivo/), {
      target: { value: "Cambio" },
    });
    enviar(ventana);
    expect(await within(ventana).findByRole("alert")).toHaveTextContent(
      "Estas vacaciones cambiaron de estado. Cierre y vuelva a abrir para ver las opciones.",
    );
    fireEvent.click(within(ventana).getByRole("button", { name: "Volver" }));
    // Lo escrito se pregunta antes de descartar.
    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
    await waitFor(() =>
      expect(servicio.misVacaciones).toHaveBeenCalledTimes(2),
    );
  });

  it("si ya estaba cancelada: lo dice, deja solo «Cerrar» y recarga al cerrar", async () => {
    conAprobadas([EN_CURSO]);
    licencias.cancelar.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            code: "solicitud_cerrada",
            message: "La solicitud ya está cerrada.",
            details: null,
          },
        },
      },
    });
    pintar();
    const { ventana } = await abrir();
    fireEvent.change(within(ventana).getByLabelText(/^Justificación/), {
      target: { value: "Cambio" },
    });
    fireEvent.click(within(ventana).getByLabelText(/^Devolver todos/));
    enviar(ventana);
    expect(await within(ventana).findByRole("alert")).toHaveTextContent(
      "Estas vacaciones ya se habían cancelado.",
    );
    expect(
      within(ventana).queryByRole("button", { name: "Cancelar vacaciones" }),
    ).toBeNull();
    expect(within(ventana).queryByLabelText(/^Justificación/)).toBeNull();
    conAprobadas([]);
    fireEvent.click(
      within(ventana).getAllByRole("button", { name: "Cerrar" }).at(-1),
    );
    await waitFor(() =>
      expect(servicio.misVacaciones).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sin código propio, un 400 sin campos ni details también es «ya cancelada»", async () => {
    conAprobadas([POR_EMPEZAR]);
    licencias.cancelar.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: { code: "invalid", message: "Cerrada.", details: null },
        },
      },
    });
    pintar();
    const { ventana } = await abrir();
    fireEvent.change(within(ventana).getByLabelText(/^Motivo/), {
      target: { value: "Cambio" },
    });
    enviar(ventana);
    expect(await within(ventana).findByRole("alert")).toHaveTextContent(
      "Estas vacaciones ya se habían cancelado.",
    );
  });

  it("con error en los días, el foco va al primer radio", async () => {
    conAprobadas([EN_CURSO]);
    pintar();
    const { ventana } = await abrir();
    fireEvent.change(within(ventana).getByLabelText(/^Justificación/), {
      target: { value: "Cambio" },
    });
    enviar(ventana);
    await waitFor(() =>
      expect(within(ventana).getAllByRole("radio")[0]).toHaveFocus(),
    );
  });

  it("solo Gestión Humana ve que «todos» borra las ausencias pasadas", async () => {
    conAprobadas([EN_CURSO]);
    pintar();
    const { ventana } = await abrir();
    expect(ventana).not.toHaveTextContent(/ausencias ya pasadas/);
  });

  it("Gestión Humana: «Devolver todos los días» avisa de las ausencias ya pasadas", async () => {
    permisos.lista = ["licencias.anular_aprobadas"];
    conAprobadas([EN_CURSO]);
    pintar();
    const { ventana } = await abrir();
    expect(
      within(ventana).getByLabelText(/^Devolver todos los días/),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByLabelText(
        "Devolver todos los días: 10 días (se borran también las ausencias ya pasadas)",
      ),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByLabelText(/^No devolver días/).labels[0],
    ).not.toHaveTextContent(/ausencias/);
  });

  it("mientras se envía, «Volver» y la X quedan deshabilitados", async () => {
    conAprobadas([POR_EMPEZAR]);
    licencias.cancelar.mockReturnValue(new Promise(() => {}));
    pintar();
    const { ventana } = await abrir();
    fireEvent.change(within(ventana).getByLabelText(/^Motivo/), {
      target: { value: "Cambio" },
    });
    enviar(ventana);
    await waitFor(() =>
      expect(
        within(ventana).getByRole("button", { name: "Cancelando…" }),
      ).toBeDisabled(),
    );
    expect(
      within(ventana).getByRole("button", { name: "Volver" }),
    ).toBeDisabled();
    // Escape no cierra ni pregunta «¿Descartar?» mientras se envía.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Descartar" })).toBeNull();
    // La X y el pie dicen «Cerrar»: los dos deshabilitados.
    for (const cerrar of within(ventana).getAllByRole("button", {
      name: "Cerrar",
    })) {
      expect(cerrar).toBeDisabled();
    }
  });
});
