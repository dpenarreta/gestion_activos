import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMINISTRADOR,
  ASISTENTE,
  COLABORADOR,
  JEFE,
  SUPERVISOR,
  errorApi,
  servicioFalso,
} from "./gestionHumanaDatos";

/*
 * Cada pantalla de Gestión Humana se pinta, y muestra sus estados de carga,
 * vacío, error y sin acceso.
 */

const servicio = servicioFalso();
vi.mock("../src/api/novedadesService", async (importOriginal) => ({
  ...(await importOriginal()),
  novedadesService: servicio,
}));

const { ProveedorNovedades } =
  await import("../src/pages/GestionHumana/ContextoNovedades");
const { Colaboradores } =
  await import("../src/pages/GestionHumana/Colaboradores");
const { HistorialRegistros } =
  await import("../src/pages/GestionHumana/HistorialRegistros");
const { RepositorioMensual } =
  await import("../src/pages/GestionHumana/RepositorioMensual");
const { HorasDepuradas } =
  await import("../src/pages/GestionHumana/HorasDepuradas");
const { IngresosSalidas } =
  await import("../src/pages/GestionHumana/IngresosSalidas");
const { ConfiguracionModulo } =
  await import("../src/pages/GestionHumana/ConfiguracionModulo");
const { DiasLaborados } =
  await import("../src/pages/GestionHumana/DiasLaborados");

function pintar(Pantalla) {
  return render(
    <MemoryRouter>
      <ProveedorNovedades>
        <Pantalla />
      </ProveedorNovedades>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // Respuestas por defecto en cada prueba: un `mockRejectedValue` de una
  // prueba anterior no se arrastra a la siguiente.
  Object.assign(servicio, servicioFalso());
  sessionStorage.clear();
  servicio.yo.mockResolvedValue(SUPERVISOR);
});

describe("Acceso al módulo", () => {
  it("mientras se sabe quién es la persona, «Cargando…»", () => {
    servicio.yo.mockReturnValue(new Promise(() => {}));
    pintar(DiasLaborados);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
  });

  it("sin acceso al módulo lo dice, con el mensaje del servidor", async () => {
    servicio.yo.mockRejectedValue(
      errorApi(
        403,
        "No tiene acceso al módulo Control Operativo de Novedades.",
        "permission_denied",
      ),
    );
    pintar(Colaboradores);
    expect(
      await screen.findByText(
        "No tiene acceso al módulo Control Operativo de Novedades.",
      ),
    ).toBeInTheDocument();
  });

  it("un error al cargar se puede reintentar", async () => {
    servicio.yo.mockRejectedValueOnce(errorApi(500, "Error del servidor."));
    pintar(Colaboradores);
    expect(await screen.findByText("Error del servidor.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByText(
        "Todavía no hay colaboradores registrados en esta base.",
      ),
    ).toBeInTheDocument();
  });

  it("el Administrador elige el supervisor arriba, con «Todos los supervisores»", async () => {
    servicio.yo.mockResolvedValue(ADMINISTRADOR);
    servicio.supervisores.mockResolvedValue([
      { id: 7, name: "Sofía Supervisora" },
    ]);
    servicio.matriz.mockReturnValue(new Promise(() => {}));
    pintar(DiasLaborados);
    const selector = await screen.findByLabelText("Supervisor");
    expect(
      await screen.findByRole("option", { name: "Sofía Supervisora" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Todos los supervisores" }),
    ).toBeInTheDocument();
    expect(selector).toHaveValue("7");
  });
});

describe("Colaboradores", () => {
  it("lista la base con la cédula tal como llega", async () => {
    servicio.colaboradores.mockResolvedValue([COLABORADOR]);
    pintar(Colaboradores);
    expect(await screen.findByText("••••••0405")).toBeInTheDocument();
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Editar a Ana Pérez" }),
    ).toBeInTheDocument();
  });

  it("vacía, ofrece agregar el primero", async () => {
    pintar(Colaboradores);
    expect(
      await screen.findByText(
        "Todavía no hay colaboradores registrados en esta base.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Agregar el primero" }));
    expect(
      await screen.findByRole("dialog", { name: "Agregar colaborador" }),
    ).toBeInTheDocument();
  });

  it("el alta exige cédula y nombre, con el error bajo cada campo", async () => {
    pintar(Colaboradores);
    fireEvent.click(
      await screen.findByRole("button", { name: /Agregar colaborador/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Escriba la cédula.")).toBeInTheDocument();
    expect(
      screen.getByText("Escriba los nombres completos."),
    ).toBeInTheDocument();
    expect(servicio.crearColaborador).not.toHaveBeenCalled();
  });

  it("cambiar el estado empieza sin elegir y avisa el correo antes de confirmar", async () => {
    servicio.colaboradores.mockResolvedValue([COLABORADOR]);
    pintar(Colaboradores);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Más acciones para Ana Pérez",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Cambiar estado" }));
    const dialogo = await screen.findByRole("dialog", {
      name: "Cambiar estado operativo",
    });
    const confirmar = within(dialogo).getByRole("button", {
      name: "Confirmar cambio",
    });
    expect(confirmar).toBeDisabled();
    fireEvent.change(within(dialogo).getByLabelText(/Nuevo estado/), {
      target: { value: "INACTIVE" },
    });
    expect(
      within(dialogo).getByText(
        /se enviará por correo la notificación de salida/,
      ),
    ).toBeInTheDocument();
    expect(confirmar).toBeEnabled();
    expect(
      within(dialogo).getByRole("button", { name: "Cerrar ventana" }),
    ).toBeInTheDocument();
  });

  it("el error de carga se muestra con reintento", async () => {
    servicio.colaboradores.mockRejectedValue(
      errorApi(500, "No se pudo leer la base."),
    );
    pintar(Colaboradores);
    expect(
      await screen.findByText("No se pudo leer la base."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reintentar" }),
    ).toBeInTheDocument();
  });

  it("el Asistente solo consulta", async () => {
    servicio.yo.mockResolvedValue(ASISTENTE);
    servicio.colaboradores.mockResolvedValue([COLABORADOR]);
    pintar(Colaboradores);
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Agregar colaborador/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Editar a Ana Pérez" }),
    ).not.toBeInTheDocument();
  });
});

describe("Historial de registros", () => {
  it("el Supervisor no lo consulta: se le indica el repositorio", async () => {
    pintar(HistorialRegistros);
    expect(
      await screen.findByText(
        /lo consultan el Administrador y el Asistente de Operaciones/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Repositorio mensual" }),
    ).toBeInTheDocument();
    expect(servicio.historial).not.toHaveBeenCalled();
  });

  it("el Asistente ve los eventos, con la marca de texto además del color", async () => {
    servicio.yo.mockResolvedValue(ASISTENTE);
    servicio.historial.mockResolvedValue({
      count: 1,
      results: [
        {
          id: 1,
          action: "collaborator.status_changed",
          actor_name: "Sofía",
          actor_role: "SUPERVISOR_OPERACIONES",
          supervisor_id: 7,
          supervisor_name: "Sofía Supervisora",
          period: "2026-11",
          target_type: "collaborator",
          target_id: "10",
          target_label: "Ana Pérez (••••••0405)",
          field: "status",
          old_value: "Activo",
          new_value: "Inactivo",
          reason: "Renuncia",
          source_file: "",
          created_at: "2026-11-03T15:00:00Z",
          highlight: "danger",
        },
      ],
    });
    pintar(HistorialRegistros);
    expect(
      await screen.findByText("Ana Pérez (••••••0405)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Cambio de estado")).toBeInTheDocument();
    expect(screen.getByText("Supervisor de Operaciones")).toBeInTheDocument();
  });

  it("vacío", async () => {
    servicio.yo.mockResolvedValue(ASISTENTE);
    pintar(HistorialRegistros);
    expect(
      await screen.findByText("Sin eventos registrados en este período."),
    ).toBeInTheDocument();
  });
});

describe("Repositorio mensual", () => {
  it("vacío", async () => {
    pintar(RepositorioMensual);
    expect(
      await screen.findByText("Todavía no hay períodos registrados."),
    ).toBeInTheDocument();
  });

  it("muestra los cierres de cada equipo y las correcciones", async () => {
    servicio.repositorio.mockResolvedValue([
      {
        code: "2026-10",
        label: "Octubre 2026",
        start_date: "2026-09-23",
        end_date: "2026-10-22",
        supervisors: [
          {
            supervisor_id: 7,
            supervisor_name: "Sofía Supervisora",
            status: "CLOSED",
            closed_at: "2026-10-23T15:00:00Z",
            closed_by: "Sofía",
            summary: {
              active_collaborators: 12,
              worked_hours: "960",
              pending_cells: 0,
            },
          },
        ],
        corrections: [
          {
            id: 3,
            target: "WORKED_DAY",
            supervisor_name: "Sofía Supervisora",
            original_values: { hours: "8" },
            new_values: { hours: "4" },
            reason: "Permiso médico",
            corrected_by: "Ada",
            created_at: "2026-10-25T15:00:00Z",
          },
        ],
      },
    ]);
    pintar(RepositorioMensual);
    expect(
      await screen.findByRole("heading", { name: "Octubre 2026" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/12 colaboradores · 960 h laboradas/),
    ).toBeInTheDocument();
    expect(screen.getByText("horas: 4")).toBeInTheDocument();
    expect(screen.getByText("Motivo: Permiso médico")).toBeInTheDocument();
  });

  it("error al cargar", async () => {
    servicio.repositorio.mockRejectedValue(
      errorApi(403, "No tiene habilitada la consulta del repositorio."),
    );
    pintar(RepositorioMensual);
    expect(
      await screen.findByText(
        "No tiene habilitada la consulta del repositorio.",
      ),
    ).toBeInTheDocument();
  });
});

describe("Horas depuradas", () => {
  it("sin base todavía, el Jefe la puede crear", async () => {
    servicio.yo.mockResolvedValue(JEFE);
    servicio.depuracion.mockResolvedValue({
      period: "2026-11",
      label: "Noviembre 2026",
      exists: false,
      can_create: true,
      can_edit: true,
      month_ended: true,
      source: {
        records: 5,
        overtime_hours: "10",
        saturday_hours: "2",
        supervisors_total: 2,
        supervisors_closed: 2,
      },
    });
    pintar(HorasDepuradas);
    expect(
      await screen.findByRole("button", {
        name: /Crear la base de depuración/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Todavía no existe la base depurable/),
    ).toBeInTheDocument();
  });

  it("quien no depura ni administra no la ve", async () => {
    pintar(HorasDepuradas);
    expect(
      await screen.findByText(/la trabaja el Jefe de Operaciones/),
    ).toBeInTheDocument();
    expect(servicio.depuracion).not.toHaveBeenCalled();
  });
});

describe("Ingresos y salidas", () => {
  it("sin ninguno de sus permisos lo dice", async () => {
    servicio.accesoMovimientos.mockResolvedValue({
      entries: false,
      exits: false,
      can_manage: false,
    });
    render(
      <MemoryRouter>
        <IngresosSalidas />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText(/No tiene acceso a Ingresos ni a Salidas/),
    ).toBeInTheDocument();
  });

  it("lista los ingresos con sus totales y la cédula tal como llega", async () => {
    servicio.accesoMovimientos.mockResolvedValue({
      entries: true,
      exits: false,
      can_manage: false,
    });
    servicio.movimientos.mockResolvedValue({
      results: [
        {
          id: "A10",
          kind: "ALTA",
          kind_label: "Alta en el sistema",
          registered_at: "2026-10-01T15:00:00Z",
          collaborator_id: 10,
          cedula: "••••••0405",
          full_name: "Ana Pérez",
          cargo: "Courier",
          area: "Operaciones",
          regional: "Sierra",
          supervisor: "Sofía Supervisora",
          status: "ACTIVE",
          status_label: "Activo",
          registered_by: "Sofía",
          origin: "Formulario",
        },
      ],
      count: 1,
      page: 1,
      page_size: 25,
      counters: { movements: 1, people: 1, altas: 1, reingresos: 0 },
    });
    render(
      <MemoryRouter>
        <IngresosSalidas />
      </MemoryRouter>,
    );
    expect(await screen.findByText("••••••0405")).toBeInTheDocument();
    expect(screen.getByText("Alta en el sistema")).toBeInTheDocument();
    expect(screen.getByText("Personas distintas")).toBeInTheDocument();
    // Una sola pestaña permitida: no se pintan pestañas.
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(servicio.movimientos).toHaveBeenCalledWith(
      "entries",
      expect.objectContaining({ page: 1, page_size: 25, order: "desc" }),
    );
  });

  it("vacío", async () => {
    servicio.accesoMovimientos.mockResolvedValue({
      entries: false,
      exits: true,
      can_manage: false,
    });
    servicio.movimientos.mockResolvedValue({
      results: [],
      count: 0,
      page: 1,
      page_size: 25,
      counters: { movements: 0, people: 0 },
    });
    render(
      <MemoryRouter>
        <IngresosSalidas />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText("Todavía no hay salidas registradas."),
    ).toBeInTheDocument();
  });
});

describe("Configuración del módulo", () => {
  beforeEach(() => {
    servicio.yo.mockResolvedValue(ADMINISTRADOR);
    servicio.permisosPorRol.mockResolvedValue({
      roles: [
        {
          role: "SUPERVISOR_OPERACIONES",
          permissions: [
            {
              codename: "novedades.importar",
              label: "Importar información desde Excel",
              state: "configurable",
              enabled: false,
            },
            {
              codename: "novedades.colaboradores_gestionar",
              label: "Registrar colaboradores",
              state: "mandatory",
              enabled: true,
            },
          ],
          last_change: null,
        },
      ],
    });
  });

  it("muestra la matriz por rol: solo lo configurable es un interruptor", async () => {
    pintar(ConfiguracionModulo);
    expect(
      await screen.findByRole("heading", { name: "Supervisor de Operaciones" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: "Importar información desde Excel para Supervisor de Operaciones",
      }),
    ).not.toBeChecked();
    expect(screen.getByText("Obligatorio")).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });

  it("cambiar un permiso de rol pide el motivo y lo envía", async () => {
    servicio.cambiarPermisoDeRol.mockResolvedValue({ roles: [] });
    pintar(ConfiguracionModulo);
    fireEvent.click(
      await screen.findByRole("switch", {
        name: /Importar información desde Excel para Supervisor/,
      }),
    );
    const dialogo = await screen.findByRole("dialog", {
      name: /Habilitar para Supervisor de Operaciones/,
    });
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "Carga de inicio de mes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Habilitar" }));
    expect(dialogo).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(servicio.cambiarPermisoDeRol).toHaveBeenCalledWith({
        role: "SUPERVISOR_OPERACIONES",
        codename: "novedades.importar",
        enabled: true,
        reason: "Carga de inicio de mes",
      }),
    );
  });

  it("los destinatarios de correos: vacío por lista y alta con validación", async () => {
    servicio.destinatarios.mockResolvedValue({
      recipients: [],
      active_count: { ENTRY: 0, EXIT: 0 },
      delivery: "smtp",
      areas: [{ value: "TALENTO_HUMANO", label: "Talento Humano" }],
    });
    pintar(ConfiguracionModulo);
    fireEvent.click(await screen.findByRole("tab", { name: /Correos/ }));
    expect(
      await screen.findAllByText(
        "Sin destinatarios: nadie recibe estos correos.",
      ),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(
      await screen.findByText("Escriba la dirección de correo."),
    ).toBeInTheDocument();
    expect(servicio.crearDestinatario).not.toHaveBeenCalled();
  });
});
