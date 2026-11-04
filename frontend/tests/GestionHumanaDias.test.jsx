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
  SUPERVISOR,
  errorApi,
  matriz,
  servicioFalso,
} from "./gestionHumanaDatos";

/*
 * Días laborados: la matriz, la edición con guardado automático (sin
 * botón), el rechazo por celda y el cierre del período con confirmación.
 */

const servicio = servicioFalso();
vi.mock("../src/api/novedadesService", async (importOriginal) => ({
  ...(await importOriginal()),
  novedadesService: servicio,
}));

const { ProveedorNovedades } =
  await import("../src/pages/GestionHumana/ContextoNovedades");
const { DiasLaborados } =
  await import("../src/pages/GestionHumana/DiasLaborados");

function pintar() {
  return render(
    <MemoryRouter>
      <ProveedorNovedades>
        <DiasLaborados />
      </ProveedorNovedades>
    </MemoryRouter>,
  );
}

const celdaDelLunes = () =>
  screen.getByLabelText(/^Ana Pérez, Lunes 02\/11\/2026/);

beforeEach(() => {
  // Respuestas por defecto en cada prueba: un `mockRejectedValue` de una
  // prueba anterior no se arrastra a la siguiente.
  Object.assign(servicio, servicioFalso());
  sessionStorage.clear();
  servicio.yo.mockResolvedValue(SUPERVISOR);
  servicio.matriz.mockResolvedValue(matriz());
});

describe("Días laborados", () => {
  it("muestra la matriz del equipo con el período elegido arriba", async () => {
    pintar();
    expect((await screen.findAllByText("••••••0405"))[0]).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Días laborados" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("rowheader", { name: /Ana Pérez/ }),
    ).toBeInTheDocument();
    expect(celdaDelLunes()).toHaveValue("8");
    // El Supervisor no elige equipo: trabaja el suyo.
    expect(screen.queryByLabelText("Supervisor")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Período (del 23 al 22)")).toHaveValue(
      "2026-11",
    );
    expect(servicio.matriz).toHaveBeenCalledWith("2026-11", 7);
  });

  it("sábado y domingo no se editan", async () => {
    pintar();
    const domingo = await screen.findByLabelText(
      /^Ana Pérez, Domingo 01\/11\/2026/,
    );
    // Enfocable (para leer por qué), pero de solo lectura.
    expect(domingo).toHaveAttribute("aria-disabled", "true");
    expect(domingo).toHaveAttribute("readonly");
    expect(domingo).toHaveAccessibleName(/no admite registros/);
    fireEvent.focus(domingo);
    expect(
      screen.getByText(/Ana Pérez · 01\/11\/2026: Sábado o domingo/),
    ).toBeInTheDocument();
  });

  it("una fecha fuera de plazo se puede corregir y lo avisa; una vencida queda bloqueada", async () => {
    pintar();
    const tarde = await screen.findByLabelText(
      /^Ana Pérez, Viernes 30\/10\/2026/,
    );
    expect(tarde).not.toHaveAttribute("aria-disabled");
    expect(tarde).toHaveAccessibleName(/queda como fuera de plazo/);
    expect(tarde.closest("td")).toHaveClass("gh-celda--tarde");

    const vencida = screen.getByLabelText(/^Ana Pérez, Jueves 29\/10\/2026/);
    expect(vencida).toHaveAttribute("aria-disabled", "true");
    expect(vencida.closest("td")).toHaveClass("gh-celda--bloqueada");
    fireEvent.focus(vencida);
    expect(
      screen.getByText(/El plazo venció el lunes 02\/11\/2026 23:59/),
    ).toBeInTheDocument();
  });

  it("«Copiar a las filas de abajo» funciona sin teclado", async () => {
    const base = matriz();
    servicio.matriz.mockResolvedValue({
      ...base,
      rows: [
        ...base.rows,
        {
          ...base.rows[0],
          collaborator_id: 11,
          full_name: "Luis Mora",
          cells: {},
          total_hours: "0",
        },
      ],
    });
    pintar();
    fireEvent.focus(
      await screen.findByLabelText(/^Ana Pérez, Lunes 02\/11\/2026/),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Copiar a las filas de abajo/ }),
    );
    expect(screen.getByLabelText(/^Luis Mora, Lunes 02\/11\/2026/)).toHaveValue(
      "8",
    );
    expect(
      screen.getByLabelText(/^Luis Mora, Lunes 02\/11\/2026, por guardar/),
    ).toBeInTheDocument();
  });

  it("guarda solo al dejar la celda y avisa lo que el servidor confirmó", async () => {
    servicio.guardarCeldas.mockResolvedValue({ saved: 1 });
    pintar();
    const celda = await screen.findByLabelText(
      /^Ana Pérez, Martes 03\/11\/2026/,
    );
    fireEvent.change(celda, { target: { value: "7.5" } });
    expect(screen.getByText("Cambios por enviar: 1")).toBeInTheDocument();
    fireEvent.blur(celda);

    await waitFor(() =>
      expect(servicio.guardarCeldas).toHaveBeenCalledWith("2026-11", 7, [
        {
          collaborator_id: 10,
          date: "2026-11-03",
          hours: "7.5",
          version: null,
        },
      ]),
    );
    expect(await screen.findByText("Guardado")).toBeInTheDocument();
    // Tras guardar se vuelve a pedir la matriz con lo confirmado.
    expect(servicio.matriz).toHaveBeenCalledTimes(2);
  });

  it("envía la versión de la celda para no pisar el cambio de otra persona", async () => {
    servicio.guardarCeldas.mockResolvedValue({ saved: 1 });
    pintar();
    const celda = await screen.findByLabelText(
      /^Ana Pérez, Lunes 02\/11\/2026/,
    );
    fireEvent.change(celda, { target: { value: "0" } });
    fireEvent.blur(celda);
    await waitFor(() =>
      expect(servicio.guardarCeldas).toHaveBeenCalledWith("2026-11", 7, [
        { collaborator_id: 10, date: "2026-11-02", hours: "0", version: 1 },
      ]),
    );
  });

  it("Ctrl+D copia el valor de arriba (el mismo valor, nunca una serie) y lo guarda", async () => {
    const base = matriz();
    servicio.matriz.mockResolvedValue({
      ...base,
      rows: [
        ...base.rows,
        {
          ...base.rows[0],
          collaborator_id: 11,
          cedula: "0911111111",
          full_name: "Luis Mora",
          cells: {},
          total_hours: "0",
        },
      ],
    });
    servicio.guardarCeldas.mockResolvedValue({ saved: 1 });
    pintar();
    const celda = await screen.findByLabelText(
      /^Luis Mora, Lunes 02\/11\/2026/,
    );
    fireEvent.focus(celda);
    fireEvent.keyDown(celda, { key: "d", ctrlKey: true });

    expect(celda).toHaveValue("8");
    expect(
      screen.getByText(/02\/11\/2026: valor copiado en 1 fila/),
    ).toBeInTheDocument();
    await waitFor(
      () =>
        expect(servicio.guardarCeldas).toHaveBeenCalledWith("2026-11", 7, [
          {
            collaborator_id: 11,
            date: "2026-11-02",
            hours: "8",
            version: null,
          },
        ]),
      { timeout: 3000 },
    );
  });

  it("marca la celda que el servidor rechazó y conserva lo escrito", async () => {
    servicio.guardarCeldas.mockRejectedValue(
      errorApi(
        400,
        "Hay celdas con errores; no se guardó ningún cambio.",
        "invalid",
        {
          cells: [
            {
              collaborator_id: 10,
              date: "2026-11-02",
              message: "Ana Pérez 02/11: no puede superar 24 horas.",
            },
          ],
        },
      ),
    );
    pintar();
    const celda = await screen.findByLabelText(
      /^Ana Pérez, Lunes 02\/11\/2026/,
    );
    fireEvent.change(celda, { target: { value: "25" } });
    fireEvent.blur(celda);

    expect(
      await screen.findByText(/no puede superar 24 horas/),
    ).toBeInTheDocument();
    expect(celdaDelLunes()).toHaveAttribute("aria-invalid", "true");
    expect(celdaDelLunes()).toHaveValue("25");
    expect(
      screen.getByText(/1 celda\(s\) no se guardaron/),
    ).toBeInTheDocument();
  });

  it("un corte de red deja el cambio pendiente para reintentar", async () => {
    servicio.guardarCeldas.mockRejectedValue({ message: "Network Error" });
    pintar();
    const celda = await screen.findByLabelText(
      /^Ana Pérez, Martes 03\/11\/2026/,
    );
    fireEvent.change(celda, { target: { value: "8" } });
    fireEvent.blur(celda);
    expect(
      await screen.findByText("Pendiente de sincronizar"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reintentar ahora" }),
    ).toBeInTheDocument();
    // Lo pendiente queda en el respaldo de la pestaña, sin la cédula.
    const respaldo = JSON.parse(
      sessionStorage.getItem("gestion_humana:pendiente:dias|2026-11|7|7"),
    );
    expect(respaldo).toEqual({ "10|2026-11-03": "8" });
  });

  it("estado de error al cargar, con reintento", async () => {
    servicio.matriz.mockRejectedValueOnce(errorApi(500, "Error del servidor."));
    pintar();
    expect(await screen.findByText("Error del servidor.")).toBeInTheDocument();
    servicio.matriz.mockResolvedValue(matriz());
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect((await screen.findAllByText("••••••0405"))[0]).toBeInTheDocument();
  });

  it("estado vacío cuando el equipo no tiene colaboradores", async () => {
    servicio.matriz.mockResolvedValue(matriz({ rows: [] }));
    pintar();
    expect(
      await screen.findByText(
        /No hay colaboradores en la base de este supervisor/,
      ),
    ).toBeInTheDocument();
  });

  it("cerrar el período pide revisar el resumen y confirmar", async () => {
    servicio.resumenDeCierre.mockResolvedValue({
      period: "2026-11",
      period_label: "Noviembre 2026",
      supervisor_id: 7,
      supervisor_name: "Sofía Supervisora",
      collaborators: 1,
      active_collaborators: 1,
      worked_day_cells: 1,
      zero_cells: 0,
      pending_cells: 14,
      worked_hours: "8",
    });
    servicio.cerrarPeriodo.mockResolvedValue({
      already_closed: false,
      period: "2026-11",
      next_period: "2026-12",
      summary: {},
    });
    pintar();
    fireEvent.click(
      await screen.findByRole("button", { name: /Cerrar período/ }),
    );

    const dialogo = await screen.findByRole("dialog", {
      name: "Cerrar período",
    });
    expect(
      await within(dialogo).findByText(/El período termina el 22\/11\/2026/),
    ).toBeInTheDocument();
    expect(
      await within(dialogo).findByText(/Hay 14 celda\(s\) vacía\(s\)/),
    ).toBeInTheDocument();
    const confirmar = within(dialogo).getByRole("button", {
      name: "Cerrar período",
    });
    expect(confirmar).toBeDisabled();

    fireEvent.click(within(dialogo).getByLabelText(/Revisé la información/));
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);

    await waitFor(() =>
      expect(servicio.cerrarPeriodo).toHaveBeenCalledWith("2026-11", 7),
    );
    expect(
      await screen.findByText(/Se habilitó el siguiente período \(2026-12\)/),
    ).toBeInTheDocument();
  });

  it("no ofrece cerrar a quien no puede", async () => {
    servicio.matriz.mockResolvedValue(
      matriz({ closable: false, editable: false }),
    );
    pintar();
    (await screen.findAllByText("••••••0405"))[0];
    expect(
      screen.queryByRole("button", { name: /Cerrar período/ }),
    ).not.toBeInTheDocument();
    expect(celdaDelLunes()).toHaveAttribute("aria-disabled", "true");
  });
});
