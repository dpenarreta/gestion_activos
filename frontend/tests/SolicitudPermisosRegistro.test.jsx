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
 * Cada permiso aprobado genera sus ausencias en Gestión Humana (05/11/2026):
 * el tipo dice qué descuenta, si se pide por días o por horas y qué ausencia
 * registra; la solicitud por horas lleva su horario; una aprobada la cancela
 * Gestión Humana con comentario.
 */

const permisos = { lista: [] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { permissions: permisos.lista } }),
}));

const servicio = {
  tipos: vi.fn(),
  solicitudes: vi.fn(),
  solicitud: vi.fn(),
  resumen: vi.fn(),
  solicitar: vi.fn(),
  aprobar: vi.fn(),
  rechazar: vi.fn(),
  cancelar: vi.fn(),
  escalar: vi.fn(),
  adjunto: vi.fn(),
  opciones: vi.fn(),
  flujos: vi.fn(),
  guardarFlujo: vi.fn(),
  eliminarFlujo: vi.fn(),
  evaluar: vi.fn(),
};
vi.mock("../src/api/licenciasService", () => ({ licenciasService: servicio }));

const { SolicitudPermisosPage } =
  await import("../src/pages/Institucional/SolicitudPermisosPage");
const { FlujosPermisoPage } =
  await import("../src/pages/Institucional/FlujosPermisoPage");

const VACACIONES = {
  id: 1,
  nombre: "Vacaciones",
  descripcion: "Días de descanso",
  adjunto: "no",
  descuento: "vacaciones",
  unidad: "dias",
  pasos: [
    { nombre: "Jefatura", aprobadores: ["Su jefe inmediato (organigrama)"] },
  ],
};

const POR_HORAS = {
  ...VACACIONES,
  id: 5,
  nombre: "Permiso por horas",
  descuento: "sueldo",
  unidad: "horas",
  pide_motivo: false,
};

const SOLICITUD = {
  id: 7,
  flujo: "Vacaciones",
  solicitante: { id: 3, nombre: "Ana Vera" },
  desde: "2026-11-02",
  hasta: "2026-11-06",
  dias: 5,
  unidad: "dias",
  descuento: "vacaciones",
  hora_desde: null,
  hora_hasta: null,
  minutos: null,
  motivo: "",
  estado: "pendiente",
  estado_display: "Pendiente",
  paso_actual: "Jefatura",
  pendiente_de: [{ id: 4, nombre: "Julia Paz" }],
  tiene_adjunto: false,
  adjunto_nombre: "",
  created_at: "2026-10-19T15:00:00Z",
  cerrada_en: null,
};

const SOLICITUD_POR_HORAS = {
  ...SOLICITUD,
  id: 8,
  flujo: "Permiso por horas",
  desde: "2026-11-10",
  hasta: "2026-11-10",
  dias: 1,
  unidad: "horas",
  descuento: "sueldo",
  hora_desde: "08:00",
  hora_hasta: "10:30",
  minutos: 150,
};

const DETALLE = {
  ...SOLICITUD,
  acciones: [],
  puedo: { resolver: false, escalar: false, cancelar: false },
};

const FLUJO_GUARDADO = {
  id: 3,
  nombre: "Vacaciones",
  descripcion: "",
  activo: true,
  adjunto: "no",
  orden: 0,
  dias_minimos: 5,
  dias_maximos: 0,
  sabados_por_periodo: 2,
  domingos_por_periodo: 2,
  restricciones: "",
  pide_motivo: false,
  solicitudes_en_curso: 0,
  tiene_solicitudes: false,
  pasos: [
    {
      id: 11,
      nombre: "Jefatura",
      aprobadores: [{ tipo: "jefe_inmediato", descripcion: "Su jefe" }],
    },
  ],
  avisos_aprobada: [{ tipo: "solicitante", descripcion: "Quien solicita" }],
  avisos_rechazada: [],
};

function pintar(elemento, ruta = "/") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>{elemento}</MemoryRouter>,
  );
}

const errorDeCampos = (details) => ({
  response: {
    status: 400,
    data: { error: { message: "Error en la solicitud.", details } },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = [];
  servicio.evaluar.mockResolvedValue({ reglas: [], bloquea: false });
  servicio.solicitudes.mockResolvedValue([SOLICITUD]);
  servicio.resumen.mockResolvedValue({ por_aprobar: 0 });
  servicio.tipos.mockResolvedValue([VACACIONES]);
  servicio.solicitud.mockResolvedValue(DETALLE);
  servicio.opciones.mockResolvedValue({ personas: [], roles: [], cargos: [] });
});

async function abrirEditorNuevo() {
  permisos.lista = ["licencias.configurar"];
  servicio.flujos.mockResolvedValue([]);
  servicio.guardarFlujo.mockResolvedValue({});
  pintar(<FlujosPermisoPage />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Nuevo tipo de permiso/ }),
  );
  const ventana = screen.getByRole("dialog", { name: "Nuevo tipo de permiso" });
  fireEvent.change(within(ventana).getByLabelText(/^Nombre del permiso/), {
    target: { value: "Permiso por horas" },
  });
  const seccion = within(ventana).getByRole("region", {
    name: "Cómo se registra",
  });
  return { ventana, seccion };
}

describe("Configurar flujos: cómo se registra", () => {
  it("«vacaciones» fija el tipo de ausencia (como texto) y la unidad días", async () => {
    const { ventana, seccion } = await abrirEditorNuevo();
    // Por defecto, permiso con sueldo y ausencia personal.
    expect(
      within(seccion).getByRole("radio", {
        name: /Permiso con sueldo \(no se descuenta\)/,
      }),
    ).toBeChecked();
    // Solo Personal y Médica se eligen.
    const tipo = within(seccion).getByLabelText(
      /^Tipo de ausencia en Gestión Humana/,
    );
    expect(
      within(tipo)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Personal", "Médica"]);
    // Un tipo nuevo no lleva la nota de las solicitudes existentes.
    expect(seccion).not.toHaveTextContent(/solo valen para las solicitudes/);

    fireEvent.click(within(seccion).getByRole("radio", { name: /^Horas/ }));
    fireEvent.click(
      within(seccion).getByRole("radio", {
        name: /Se descuenta de las vacaciones pendientes/,
      }),
    );
    // Fijado: se dice como texto, sin selector desactivado.
    expect(
      within(seccion).queryByRole("combobox", {
        name: /Tipo de ausencia/,
      }),
    ).toBeNull();
    expect(seccion).toHaveTextContent(
      "Vacaciones · fijado porque se descuenta de las vacaciones",
    );
    expect(within(seccion).getByRole("radio", { name: /^Días/ })).toBeChecked();
    expect(
      within(seccion).getByRole("radio", { name: /^Horas/ }),
    ).toBeDisabled();
    expect(seccion).toHaveTextContent(
      "Las vacaciones se piden por días, no por horas.",
    );
    // Los fines de semana por período aparecen solo con vacaciones.
    expect(
      within(ventana).getByLabelText("Sábados por período"),
    ).toBeInTheDocument();

    // Al dejar de descontar vacaciones, la ausencia pasa a personal.
    fireEvent.click(
      within(seccion).getByRole("radio", { name: /Se descuenta del sueldo/ }),
    );
    expect(
      within(seccion).getByLabelText(/^Tipo de ausencia en Gestión Humana/),
    ).toHaveValue("PERSONAL");
    expect(within(ventana).queryByLabelText("Sábados por período")).toBeNull();
  });

  it("por horas oculta el mínimo y el máximo, y el tipo médico explica qué se protege", async () => {
    const { ventana, seccion } = await abrirEditorNuevo();
    const minimo = within(ventana).getByLabelText(/^Mínimo de días seguidos/);
    fireEvent.change(minimo, { target: { value: "3" } });
    fireEvent.click(
      within(seccion).getByRole("radio", { name: /Se descuenta del sueldo/ }),
    );
    fireEvent.click(within(seccion).getByRole("radio", { name: /^Horas/ }));
    expect(
      within(ventana).queryByLabelText(/^Mínimo de días seguidos/),
    ).toBeNull();
    expect(
      within(ventana).queryByLabelText(/^Máximo de días seguidos/),
    ).toBeNull();

    const tipo = within(seccion).getByLabelText(
      /^Tipo de ausencia en Gestión Humana/,
    );
    fireEvent.change(tipo, { target: { value: "MEDICO" } });
    expect(tipo).toHaveAccessibleDescription(/Dato de salud protegido/);
    expect(tipo).toHaveAccessibleDescription(
      /En las solicitudes, quienes aprueban ven el tipo, el motivo y el documento/,
    );

    fireEvent.click(
      within(ventana).getByRole("button", { name: "Crear tipo de permiso" }),
    );
    // El mínimo oculto no se manda: por horas va en 0.
    await waitFor(() =>
      expect(servicio.guardarFlujo).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          descuento: "sueldo",
          unidad: "horas",
          tipo_ausencia: "MEDICO",
          dias_minimos: 0,
          dias_maximos: 0,
        }),
      ),
    );
    expect(servicio.guardarFlujo.mock.calls[0][1]).not.toHaveProperty(
      "descuenta_vacaciones",
    );
  });

  it("con solicitudes no se cambia entre días y horas, y avisa que los cambios valen para las nuevas", async () => {
    permisos.lista = ["licencias.configurar"];
    const porHoras = {
      ...FLUJO_GUARDADO,
      nombre: "Permiso por horas",
      descuento: "ninguno",
      unidad: "horas",
      tipo_ausencia: "MEDICO",
      dias_minimos: 1,
      dias_maximos: 1,
      tiene_solicitudes: true,
    };
    servicio.flujos.mockResolvedValue([porHoras]);
    pintar(<FlujosPermisoPage />);
    // La tarjeta: su ausencia, por horas y sin «Mín. 1 días».
    const tarjeta = await screen.findByRole("region", {
      name: "Permiso por horas",
    });
    expect(tarjeta).toHaveTextContent("Ausencia médica");
    expect(tarjeta).toHaveTextContent("Por horas");
    expect(tarjeta).not.toHaveTextContent(/Mín\./);
    fireEvent.click(
      screen.getByRole("button", { name: "Editar Permiso por horas" }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Editar «Permiso por horas»",
    });
    const seccion = within(ventana).getByRole("region", {
      name: "Cómo se registra",
    });
    expect(seccion).toHaveTextContent(
      "Los cambios solo valen para las solicitudes nuevas.",
    );
    expect(
      within(seccion).getByRole("radio", { name: /^Días/ }),
    ).toBeDisabled();
    expect(
      within(seccion).getByRole("radio", { name: /^Horas/ }),
    ).toBeChecked();
    expect(
      within(seccion).getByRole("radiogroup", { name: "Se pide por" }),
    ).toHaveAccessibleDescription(/ya tiene solicitudes/);
    // Pasar a vacaciones obligaría a pedir por días: tampoco.
    expect(
      within(seccion).getByRole("radio", {
        name: /Se descuenta de las vacaciones pendientes/,
      }),
    ).toBeDisabled();
  });

  it("un tipo guardado solo con «descuenta vacaciones» se lee como vacaciones", async () => {
    permisos.lista = ["licencias.configurar"];
    servicio.flujos.mockResolvedValue([
      { ...FLUJO_GUARDADO, descuenta_vacaciones: true },
    ]);
    servicio.guardarFlujo.mockResolvedValue(FLUJO_GUARDADO);
    pintar(<FlujosPermisoPage />);
    // La tarjeta dice qué descuenta.
    expect(await screen.findByText("Descuenta vacaciones")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editar Vacaciones" }));
    const ventana = screen.getByRole("dialog", {
      name: "Editar «Vacaciones»",
    });
    expect(
      within(ventana).getByRole("radio", {
        name: /Se descuenta de las vacaciones pendientes/,
      }),
    ).toBeChecked();
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Guardar cambios" }),
    );
    await waitFor(() =>
      expect(servicio.guardarFlujo).toHaveBeenCalledWith(
        3,
        expect.objectContaining({
          descuento: "vacaciones",
          unidad: "dias",
          tipo_ausencia: "VACACIONES",
          sabados_por_periodo: 2,
        }),
      ),
    );
  });

  it("el error del servidor de un grupo de opciones va bajo el grupo", async () => {
    const { ventana } = await abrirEditorNuevo();
    servicio.guardarFlujo.mockRejectedValue(
      errorDeCampos({
        unidad: ["Las vacaciones se piden por días, no por horas."],
      }),
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Crear tipo de permiso" }),
    );
    // El error se marca en el grupo (un radio no admite aria-invalid).
    const grupo = within(ventana).getByRole("radiogroup", {
      name: "Se pide por",
    });
    await waitFor(() => expect(grupo).toHaveAttribute("aria-invalid", "true"));
    expect(grupo).toHaveAccessibleDescription(
      "Las vacaciones se piden por días, no por horas.",
    );
    expect(within(ventana).getByRole("alert")).toHaveTextContent(
      "Se pide por: Las vacaciones se piden por días, no por horas.",
    );
    // El foco va al primer campo marcado: el grupo, que lee su error.
    await waitFor(() => expect(grupo).toHaveFocus());
    // Al elegir otra opción, el error deja de verse.
    fireEvent.click(within(grupo).getByRole("radio", { name: /^Días/ }));
    fireEvent.click(within(grupo).getByRole("radio", { name: /^Horas/ }));
    expect(grupo).not.toHaveAttribute("aria-invalid");
  });
});

async function abrirNuevaSolicitud(tipos = [POR_HORAS]) {
  servicio.tipos.mockResolvedValue(tipos);
  pintar(<SolicitudPermisosPage />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Nueva solicitud/ }),
  );
  const ventana = screen.getByRole("dialog", {
    name: "Nueva solicitud de permiso",
  });
  await within(ventana).findByText("Jefatura");
  return ventana;
}

describe("Solicitud por horas", () => {
  it("pide una sola fecha y el horario, y muestra la duración en vivo", async () => {
    servicio.solicitar.mockResolvedValue(DETALLE);
    const ventana = await abrirNuevaSolicitud();
    // Qué descuenta, junto al tipo.
    expect(ventana).toHaveTextContent("Se descuenta del sueldo");
    // Una sola fecha: ni «Desde» ni «Hasta» de días.
    expect(within(ventana).queryByLabelText(/^Desde\s*\*/)).toBeNull();
    expect(within(ventana).queryByLabelText(/^Hasta\s*\*/)).toBeNull();
    // El calendario pide un solo día.
    expect(ventana).toHaveTextContent("Elija el día del permiso.");
    fireEvent.change(within(ventana).getByLabelText(/^Fecha/), {
      target: { value: "2026-11-10" },
    });

    // Sin horas no se envía: las dos se marcan a la vez, bajo su campo, y el
    // foco va a la primera.
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviar solicitud" }),
    );
    const inicio = within(ventana).getByLabelText(/^Desde las/);
    expect(inicio).toHaveAttribute("aria-invalid", "true");
    expect(inicio).toHaveAccessibleDescription("Indique la hora de inicio.");
    expect(
      within(ventana).getByLabelText(/^Hasta las/),
    ).toHaveAccessibleDescription("Indique la hora de fin.");
    await waitFor(() => expect(inicio).toHaveFocus());
    expect(servicio.solicitar).not.toHaveBeenCalled();

    // El fin antes del inicio se dice en vivo y no se envía.
    fireEvent.change(inicio, { target: { value: "08:00" } });
    const fin = within(ventana).getByLabelText(/^Hasta las/);
    fireEvent.change(fin, { target: { value: "07:00" } });
    expect(ventana).toHaveTextContent(/Revise las horas/);
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviar solicitud" }),
    );
    expect(fin).toHaveAccessibleDescription(
      "La hora de fin debe ser posterior a la de inicio.",
    );
    expect(servicio.solicitar).not.toHaveBeenCalled();

    fireEvent.change(fin, { target: { value: "10:30" } });
    expect(within(ventana).getByRole("status")).toHaveTextContent(
      "Duración: 2 h 30 min",
    );
    await waitFor(() =>
      expect(servicio.evaluar).toHaveBeenLastCalledWith(
        "5",
        "2026-11-10",
        "2026-11-10",
      ),
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviar solicitud" }),
    );
    await waitFor(() =>
      expect(servicio.solicitar).toHaveBeenCalledWith(
        {
          flujo: "5",
          desde: "2026-11-10",
          hasta: "2026-11-10",
          hora_desde: "08:00",
          hora_hasta: "10:30",
          motivo: "",
        },
        null,
      ),
    );
  });

  it("el día elegido en el calendario es el único día", async () => {
    const ventana = await abrirNuevaSolicitud();
    fireEvent.change(within(ventana).getByLabelText(/^Fecha/), {
      target: { value: "2026-12-07" },
    });
    fireEvent.click(
      within(ventana).getByRole("gridcell", { name: "9 de diciembre de 2026" }),
    );
    fireEvent.click(
      within(ventana).getByRole("gridcell", {
        name: "11 de diciembre de 2026",
      }),
    );
    expect(within(ventana).getByLabelText(/^Fecha/)).toHaveValue("2026-12-11");
    const marcados = within(ventana)
      .getAllByRole("gridcell")
      .filter((c) => c.getAttribute("aria-selected") === "true")
      .map((c) => c.textContent);
    expect(marcados).toEqual(["11"]);
  });

  it("los errores del servidor van bajo su campo: horas y fecha", async () => {
    servicio.solicitar.mockRejectedValue(
      errorDeCampos({
        hora_hasta: ["La hora de fin debe ser posterior a la de inicio."],
        hasta: [
          "Un permiso por horas es de un solo día: «Desde» y «Hasta» deben coincidir.",
        ],
      }),
    );
    const ventana = await abrirNuevaSolicitud();
    fireEvent.change(within(ventana).getByLabelText(/^Desde las/), {
      target: { value: "09:00" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Hasta las/), {
      target: { value: "11:00" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviar solicitud" }),
    );
    const fecha = within(ventana).getByLabelText(/^Fecha/);
    await waitFor(() => expect(fecha).toHaveAttribute("aria-invalid", "true"));
    expect(fecha).toHaveAccessibleDescription(
      /Un permiso por horas es de un solo día/,
    );
    expect(
      within(ventana).getByLabelText(/^Hasta las/),
    ).toHaveAccessibleDescription(
      "La hora de fin debe ser posterior a la de inicio.",
    );
    // El foco va al primer campo marcado.
    await waitFor(() => expect(fecha).toHaveFocus());
  });

  it("un tipo por días no manda horas", async () => {
    servicio.solicitar.mockResolvedValue(DETALLE);
    const ventana = await abrirNuevaSolicitud([VACACIONES]);
    expect(within(ventana).queryByLabelText(/^Desde las/)).toBeNull();
    expect(ventana).toHaveTextContent(
      "Se descuenta de las vacaciones pendientes",
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviar solicitud" }),
    );
    await waitFor(() => expect(servicio.solicitar).toHaveBeenCalled());
    expect(servicio.solicitar.mock.calls[0][0]).not.toHaveProperty(
      "hora_desde",
    );
  });

  it("al pasar de un tipo por días a uno por horas, «hasta» es el mismo día", async () => {
    servicio.solicitar.mockResolvedValue(DETALLE);
    const ventana = await abrirNuevaSolicitud([VACACIONES, POR_HORAS]);
    fireEvent.change(within(ventana).getByLabelText(/^Desde\s*\*/), {
      target: { value: "2026-11-02" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Hasta\s*\*/), {
      target: { value: "2026-11-06" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Tipo de permiso/), {
      target: { value: "5" },
    });
    expect(within(ventana).getByLabelText(/^Fecha/)).toHaveValue("2026-11-02");
    await waitFor(() =>
      expect(servicio.evaluar).toHaveBeenLastCalledWith(
        "5",
        "2026-11-02",
        "2026-11-02",
      ),
    );
  });

  it("en un tipo médico, el motivo pide no escribir diagnósticos", async () => {
    const medico = {
      ...POR_HORAS,
      id: 6,
      nombre: "Permiso médico",
      pide_motivo: true,
      tipo_ausencia: "MEDICO",
    };
    const ventana = await abrirNuevaSolicitud([VACACIONES, medico]);
    // Con un tipo que no es médico, sin la ayuda.
    expect(
      within(ventana).getByLabelText(/^Motivo/),
    ).not.toHaveAccessibleDescription(/diagnósticos/);
    fireEvent.change(within(ventana).getByLabelText(/^Tipo de permiso/), {
      target: { value: "6" },
    });
    expect(
      within(ventana).getByLabelText(/^Motivo/),
    ).toHaveAccessibleDescription(
      "No escriba diagnósticos; basta con adjuntar el certificado.",
    );
  });

  it("si el servidor expone `es_medico` en vez de `tipo_ausencia`, también avisa", async () => {
    const ventana = await abrirNuevaSolicitud([
      { ...POR_HORAS, pide_motivo: true, es_medico: true },
    ]);
    expect(
      within(ventana).getByLabelText(/^Motivo/),
    ).toHaveAccessibleDescription(/No escriba diagnósticos/);
  });

  it("si no se cargan los tipos, deja reintentar", async () => {
    servicio.tipos
      .mockRejectedValueOnce({
        response: { data: { error: { message: "Sin conexión." } } },
      })
      .mockResolvedValueOnce([POR_HORAS]);
    pintar(<SolicitudPermisosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Nueva solicitud/ }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Nueva solicitud de permiso",
    });
    expect(await within(ventana).findByRole("alert")).toHaveTextContent(
      "Sin conexión.",
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Reintentar" }),
    );
    expect(await within(ventana).findByText("Jefatura")).toBeInTheDocument();
  });
});

describe("Detalle y lista: descuento, horario y cancelar una aprobada", () => {
  it("la lista muestra qué descuenta, el horario y la duración", async () => {
    servicio.solicitudes.mockResolvedValue([SOLICITUD_POR_HORAS, SOLICITUD]);
    pintar(<SolicitudPermisosPage />);
    const tabla = screen.getByRole("table");
    expect(
      await within(tabla).findByText("Se descuenta del sueldo"),
    ).toBeInTheDocument();
    expect(within(tabla).getByText("08:00 a 10:30")).toBeInTheDocument();
    expect(within(tabla).getByText("2 h 30 min")).toBeInTheDocument();
    expect(
      within(tabla).getByText("Se descuenta de las vacaciones pendientes"),
    ).toBeInTheDocument();
    expect(within(tabla).getByText("5 días")).toBeInTheDocument();
    expect(
      within(tabla).getByRole("button", { name: /de 08:00 a 10:30/ }),
    ).toBeInTheDocument();
  });

  it("el detalle de una por horas muestra horario, duración y descuento", async () => {
    servicio.solicitud.mockResolvedValue({
      ...DETALLE,
      ...SOLICITUD_POR_HORAS,
    });
    pintar(<SolicitudPermisosPage />, "/?solicitud=8");
    const ventana = await screen.findByRole("dialog", {
      name: "Permiso por horas · Ana Vera",
    });
    const datos = within(ventana).getByText("Horario").closest("dl");
    expect(datos).toHaveTextContent("08:00 a 10:30");
    expect(datos).toHaveTextContent("Duración2 h 30 min");
    expect(datos).toHaveTextContent("DescuentoSe descuenta del sueldo");
  });

  it("una por horas sin horario no muestra « a » vacío", async () => {
    servicio.solicitudes.mockResolvedValue([
      { ...SOLICITUD_POR_HORAS, hora_desde: null, hora_hasta: null },
    ]);
    servicio.solicitud.mockResolvedValue({
      ...DETALLE,
      ...SOLICITUD_POR_HORAS,
      hora_desde: null,
      hora_hasta: null,
    });
    pintar(<SolicitudPermisosPage />, "/?solicitud=8");
    const ventana = await screen.findByRole("dialog", {
      name: "Permiso por horas · Ana Vera",
    });
    expect(within(ventana).queryByText("Horario")).toBeNull();
    expect(
      within(ventana).getByText("Duración").closest("div"),
    ).toHaveTextContent("2 h 30 min");
    // En la lista, ni en el nombre del botón ni en la fecha.
    const tabla = document.querySelector(".solicitudes-tabla");
    const fila = await within(tabla).findByRole("button", {
      name: /^Permiso por horas/,
    });
    expect(fila).not.toHaveAccessibleName(/, de /);
    expect(tabla.querySelector(".solicitudes-tabla__horario")).toBeNull();
  });

  it("Gestión Humana cancela una aprobada con comentario y la consecuencia a la vista", async () => {
    permisos.lista = ["licencias.ver_todas"];
    const aprobada = {
      ...DETALLE,
      estado: "aprobada",
      // Del servidor: cuántos días de vacaciones vuelven al cancelarla.
      dias_a_devolver: 3,
      puedo: {
        resolver: false,
        escalar: false,
        cancelar: true,
        cancelar_pide_comentario: true,
      },
    };
    servicio.solicitud.mockResolvedValue(aprobada);
    servicio.cancelar.mockResolvedValue({
      ...aprobada,
      estado: "cancelada",
      puedo: { resolver: false, escalar: false, cancelar: false },
    });
    pintar(<SolicitudPermisosPage />, "/?solicitud=7");
    const ventana = await screen.findByRole("dialog", {
      name: "Vacaciones · Ana Vera",
    });
    expect(ventana).toHaveTextContent(/Esta solicitud ya está aprobada/);
    expect(
      within(ventana).getByText("(obligatorio para cancelar)"),
    ).toBeInTheDocument();
    const comentario = within(ventana).getByLabelText(/Comentario/);
    expect(comentario).toHaveAttribute("aria-required", "true");

    // Sin comentario no se pregunta ni se envía: el error va bajo el campo.
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Cancelar solicitud" }),
    );
    expect(comentario).toHaveAttribute("aria-invalid", "true");
    expect(comentario).toHaveAccessibleDescription(/explique por qué/);
    expect(comentario).toHaveFocus();
    expect(screen.queryByRole("dialog", { name: /¿Cancelar/ })).toBeNull();

    fireEvent.change(comentario, {
      target: { value: "Se reincorporó antes por pedido de su jefatura" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Cancelar solicitud" }),
    );
    const pregunta = await screen.findByRole("dialog", { name: /¿Cancelar/ });
    // Dice a quién y cuántos días vuelven.
    expect(pregunta).toHaveTextContent(
      "Se quitarán las ausencias de Ana Vera en Gestión Humana y se le devolverán 3 días de vacaciones.",
    );
    expect(pregunta).toHaveTextContent(/«Se reincorporó antes/);
    // Ninguna opción viene elegida: el foco no queda en la que cancela.
    const confirmarBoton = within(pregunta).getByRole("button", {
      name: "Cancelar solicitud aprobada",
    });
    expect(confirmarBoton).not.toHaveFocus();
    fireEvent.click(confirmarBoton);
    await waitFor(() =>
      expect(servicio.cancelar).toHaveBeenCalledWith(
        "7",
        "Se reincorporó antes por pedido de su jefatura",
      ),
    );
    expect(
      await within(ventana).findByText(
        /se le devolvieron 3 días de vacaciones/,
      ),
    ).toBeInTheDocument();
    expect(servicio.cancelar).toHaveBeenCalledTimes(1);
  });

  it("el error del comentario que manda el servidor va bajo el campo", async () => {
    servicio.solicitud.mockResolvedValue({
      ...DETALLE,
      estado: "aprobada",
      descuento: "sueldo",
      dias_a_devolver: 0,
      puedo: {
        resolver: false,
        escalar: false,
        cancelar: true,
        cancelar_pide_comentario: true,
      },
    });
    servicio.cancelar.mockRejectedValue(
      errorDeCampos({
        comentario: ["Diga por qué se cancela una solicitud aprobada."],
      }),
    );
    pintar(<SolicitudPermisosPage />, "/?solicitud=7");
    const ventana = await screen.findByRole("dialog", {
      name: "Vacaciones · Ana Vera",
    });
    const comentario = within(ventana).getByLabelText(/Comentario/);
    fireEvent.change(comentario, { target: { value: "Por error" } });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Cancelar solicitud" }),
    );
    const pregunta = await screen.findByRole("dialog", { name: /¿Cancelar/ });
    // Sin vacaciones, la consecuencia no habla de devolver días.
    expect(pregunta).toHaveTextContent(
      "Se quitarán las ausencias de Ana Vera en Gestión Humana.",
    );
    expect(pregunta).not.toHaveTextContent(/devolverán/);
    fireEvent.click(
      within(pregunta).getByRole("button", {
        name: "Cancelar solicitud aprobada",
      }),
    );
    await waitFor(() =>
      expect(comentario).toHaveAccessibleDescription(
        "Diga por qué se cancela una solicitud aprobada.",
      ),
    );
    await waitFor(() => expect(comentario).toHaveFocus());
  });

  it("quien la pidió cancela la suya pendiente sin comentario obligatorio", async () => {
    servicio.solicitud.mockResolvedValue({
      ...DETALLE,
      puedo: {
        resolver: false,
        escalar: false,
        cancelar: true,
        cancelar_pide_comentario: false,
      },
    });
    servicio.cancelar.mockResolvedValue({ ...DETALLE, estado: "cancelada" });
    pintar(<SolicitudPermisosPage />, "/?solicitud=7");
    const ventana = await screen.findByRole("dialog", {
      name: "Vacaciones · Ana Vera",
    });
    expect(within(ventana).queryByText(/ya está aprobada/)).toBeNull();
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Cancelar solicitud" }),
    );
    const pregunta = await screen.findByRole("dialog", {
      name: "¿Cancelar la solicitud?",
    });
    fireEvent.click(
      within(pregunta).getByRole("button", { name: "Cancelar solicitud" }),
    );
    await waitFor(() =>
      expect(servicio.cancelar).toHaveBeenCalledWith("7", ""),
    );
  });
});

describe("Cancelar una aprobada sin `dias_a_devolver` del servidor", () => {
  it("con descuento de vacaciones lo dice sin número; sin descuento, no", async () => {
    servicio.solicitud.mockResolvedValue({
      ...DETALLE,
      estado: "aprobada",
      puedo: {
        resolver: false,
        escalar: false,
        cancelar: true,
        cancelar_pide_comentario: true,
      },
    });
    pintar(<SolicitudPermisosPage />, "/?solicitud=7");
    const ventana = await screen.findByRole("dialog", {
      name: "Vacaciones · Ana Vera",
    });
    expect(ventana).toHaveTextContent(
      "Se quitarán las ausencias de Ana Vera en Gestión Humana y se le devolverán los días de vacaciones descontados.",
    );
    expect(ventana).not.toHaveTextContent(/devolverán \d/);
  });
});
