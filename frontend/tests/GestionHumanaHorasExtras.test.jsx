import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  COLABORADOR,
  MESES,
  SUPERVISOR,
  errorApi,
  servicioFalso,
} from "./gestionHumanaDatos";

/*
 * Horas extras: el estado del mes, la captura masiva con guardado
 * automático por lotes, el alta individual y la consulta.
 */

const servicio = servicioFalso();
vi.mock("../src/api/novedadesService", async (importOriginal) => ({
  ...(await importOriginal()),
  novedadesService: servicio,
}));

const { ProveedorNovedades } =
  await import("../src/pages/GestionHumana/ContextoNovedades");
const { HorasExtras } = await import("../src/pages/GestionHumana/HorasExtras");

function pintar() {
  return render(
    <MemoryRouter>
      <ProveedorNovedades>
        <HorasExtras />
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
  servicio.mesesDeHorasExtras.mockResolvedValue(MESES);
  servicio.colaboradores.mockResolvedValue([COLABORADOR]);
});

async function agregarFila() {
  const fecha = await screen.findByLabelText(
    "Fecha de trabajo de las filas nuevas",
  );
  fireEvent.change(fecha, { target: { value: "2026-11-03" } });
  fireEvent.click(
    screen.getByRole("button", { name: /Agregar colaboradores/ }),
  );
  const dialogo = await screen.findByRole("dialog", {
    name: /Agregar colaboradores · 03\/11\/2026/,
  });
  fireEvent.click(
    await within(dialogo).findByRole("checkbox", { name: /Ana Pérez/ }),
  );
  fireEvent.click(
    within(dialogo).getByRole("button", { name: "Agregar 1 fila(s)" }),
  );
}

describe("Horas extras", () => {
  it("muestra el estado del mes que calcula el servidor", async () => {
    pintar();
    expect(await screen.findByText(/Mes en curso/)).toBeInTheDocument();
    expect(screen.getByText("miércoles 02/12/2026 23:59")).toBeInTheDocument();
    expect(screen.getByLabelText("Mes de horas extras")).toHaveValue("2026-11");
    // En curso no se cierra.
    expect(
      screen.queryByRole("button", { name: /Cerrar mes/ }),
    ).not.toBeInTheDocument();
  });

  it("captura masiva: la fila completa se guarda sola, por lote", async () => {
    servicio.guardarLoteHorasExtras.mockImplementation((periodo, filas) =>
      Promise.resolve({
        summary: {
          created: filas.length,
          updated: 0,
          unchanged: 0,
          errors: 0,
          total: filas.length,
        },
        rows: filas.map((f) => ({
          client_key: f.client_key,
          status: "created",
          errors: {},
          record_id: 99,
          version: 1,
        })),
      }),
    );
    pintar();
    await agregarFila();

    // Recién agregada: «Nueva · incompleta», sin reproches ni envío.
    expect(await screen.findByText("Nueva · incompleta")).toBeInTheDocument();
    expect(screen.queryByText(/Registre horas extras o de sábado/)).toBeNull();
    expect(screen.getByText("Nuevas:").parentElement).toHaveTextContent(
      "Nuevas: 1",
    );
    expect(servicio.guardarLoteHorasExtras).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Horas extras de Ana Pérez/), {
      target: { value: "2" },
    });

    await waitFor(
      () =>
        expect(servicio.guardarLoteHorasExtras).toHaveBeenCalledWith(
          "2026-11",
          [
            expect.objectContaining({
              collaborator_id: 10,
              date: "2026-11-03",
              overtime_hours: "2",
              saturday_hours: "",
              is_saturday: false,
              is_sunday: false,
              is_holiday: null,
              id: null,
            }),
          ],
        ),
      { timeout: 3000 },
    );
    expect(await screen.findByText("Guardada")).toBeInTheDocument();
    // De la identidad solo viaja el id: la cédula y el nombre los pone el servidor.
    const enviada = servicio.guardarLoteHorasExtras.mock.calls[0][1][0];
    expect(enviada).not.toHaveProperty("cedula");
    expect(enviada).not.toHaveProperty("full_name");
  });

  it("una fila rechazada queda marcada con su motivo", async () => {
    servicio.guardarLoteHorasExtras.mockImplementation((periodo, filas) =>
      Promise.resolve({
        summary: { created: 0, updated: 0, unchanged: 0, errors: 1, total: 1 },
        rows: filas.map((f) => ({
          client_key: f.client_key,
          status: "duplicate",
          errors: {
            date: "Ya existe un registro de Ana Pérez el 03/11/2026; edítelo en lugar de crear otro.",
          },
        })),
      }),
    );
    pintar();
    await agregarFila();
    fireEvent.change(
      await screen.findByLabelText(/^Horas extras de Ana Pérez/),
      { target: { value: "3" } },
    );

    expect(
      await screen.findByText(
        /Ya existe un registro de Ana Pérez el 03\/11\/2026/,
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Con error")).toBeInTheDocument();
    expect(
      screen.getByText(/0 fila\(s\) guardadas; 1 no se guardaron/),
    ).toBeInTheDocument();
  });

  it("alta individual desde la consulta", async () => {
    servicio.crearHorasExtras.mockResolvedValue({ id: 5 });
    pintar();
    fireEvent.click(
      await screen.findByRole("tab", { name: /Consulta de registros/ }),
    );
    expect(
      await screen.findByText("No hay horas extras registradas en este mes."),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Registrar una novedad/ }),
    );
    const dialogo = await screen.findByRole("dialog", {
      name: "Registrar horas extras",
    });
    // Sin datos, los errores salen bajo cada campo.
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar" }));
    expect(
      await within(dialogo).findByText("Elija al colaborador."),
    ).toBeInTheDocument();
    expect(servicio.crearHorasExtras).not.toHaveBeenCalled();

    await within(dialogo).findByRole("option", { name: /Ana Pérez/ });
    fireEvent.change(within(dialogo).getByLabelText(/Colaborador/), {
      target: { value: "10" },
    });
    fireEvent.change(within(dialogo).getByLabelText(/Fecha de trabajo/), {
      target: { value: "2026-11-03" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Horas extras"), {
      target: { value: "1,5" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar" }));

    await waitFor(() =>
      expect(servicio.crearHorasExtras).toHaveBeenCalledWith(
        expect.objectContaining({
          collaborator_id: 10,
          date: "2026-11-03",
          overtime_hours: "1.5",
        }),
      ),
    );
    expect(await screen.findByText("Novedad registrada.")).toBeInTheDocument();
  });

  it("la consulta muestra los registros tal como llegan (cédula enmascarada)", async () => {
    servicio.yo.mockResolvedValue({
      ...SUPERVISOR,
      permissions: ["novedades.acceder"],
    });
    servicio.horasExtras.mockResolvedValue({
      indicators: {
        records: 1,
        overtime_hours: "2",
        saturday_hours: "0",
        supervisors_reporting: 1,
        collaborators_with_records: 1,
      },
      count: 1,
      offset: 0,
      limit: 200,
      records: [
        {
          id: 1,
          collaborator_id: 10,
          date: "2026-11-03",
          cedula: "••••••0405",
          full_name: "Ana Pérez",
          regional: "Sierra",
          area: "Operaciones",
          cargo: "Courier",
          supervisor_id: 7,
          supervisor_name: "Sofía Supervisora",
          period: "2026-11",
          overtime_hours: "2",
          saturday_hours: "0",
          is_saturday: false,
          is_sunday: false,
          is_holiday: false,
          work_done: "Entrega",
          observations: "",
          version: 1,
          created_by_name: "Sofía",
          updated_by_name: "Sofía",
          created_at: "2026-11-03T20:00:00Z",
          updated_at: "2026-11-03T20:00:00Z",
        },
      ],
    });
    pintar();
    // Sin permiso de registro, solo la consulta.
    expect(await screen.findByText("••••••0405")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /Captura masiva/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Registrar una novedad/ }),
    ).not.toBeInTheDocument();
  });

  it("estado de error de la consulta, con reintento", async () => {
    servicio.yo.mockResolvedValue({
      ...SUPERVISOR,
      permissions: ["novedades.acceder"],
    });
    servicio.horasExtras.mockRejectedValueOnce(
      errorApi(403, "No tiene habilitada la consulta del consolidado."),
    );
    pintar();
    expect(
      await screen.findByText(
        "No tiene habilitada la consulta del consolidado.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reintentar" }),
    ).toBeInTheDocument();
  });
});
