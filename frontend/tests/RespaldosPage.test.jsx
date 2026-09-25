import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Cuándo se respalda solo.
 *
 * Lo que se prueba es que el «cuándo» se decida desde aquí: la tarea del
 * sistema corre cada hora, siempre igual, y esta pantalla es la que dice si
 * toca. Si no lo dijera, cambiar «semanal» por «diaria» necesitaría un
 * administrador de servidores.
 */

const leer = vi.fn();
const guardar = vi.fn();

vi.mock("../src/api/respaldosService", () => ({
  respaldosService: {
    politica: (...args) => leer(...args),
    guardar: (...args) => guardar(...args),
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
  frecuencia: "diaria",
  frecuencia_display: "Diaria",
  dia_semanal: 0,
  hora: "02:00:00",
  destino: "respaldos",
  conservar: 14,
  ultimo_respaldo: "2026-09-17",
  ultimo_en_disco: "2026-09-17T15:36:59+00:00",
  proximo: "2026-09-18 02:00",
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
  guardar.mockResolvedValue({ ...POLITICA, frecuencia: "semanal" });
});

describe("La configuración de respaldos", () => {
  it("configurar la apariencia ya no habilita a cambiar el respaldo", async () => {
    /* Eran el mismo permiso y son responsabilidades distintas: cambiar el logo
       no debería decidir de cuándo se puede volver si algo se pierde. */
    permisos.clear();
    permisos.add("configuracion.editar");
    permisos.add("configuracion.ver");
    pintar();

    await screen.findByText("2026-09-18 02:00");
    expect(screen.getByLabelText("Cada cuánto")).toBeDisabled();
  });

  it("muestra cuándo fue el último y cuándo toca el próximo", async () => {
    /* Es la pregunta que trae a esta pantalla: de cuándo se puede volver. */
    pintar();

    expect(await screen.findByText("2026-09-18 02:00")).toBeInTheDocument();
    expect(screen.getByText(/17\/09\/2026/)).toBeInTheDocument();
  });

  it("el día de la semana solo se pide si la frecuencia es semanal", async () => {
    pintar();

    await screen.findByLabelText("Cada cuánto");
    expect(screen.queryByLabelText("Qué día")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Cada cuánto"), {
      target: { value: "semanal" },
    });

    expect(await screen.findByLabelText("Qué día")).toBeInTheDocument();
  });

  it("guarda la frecuencia, la hora y la carpeta", async () => {
    pintar();

    fireEvent.change(await screen.findByLabelText("A partir de qué hora"), {
      target: { value: "03:30" },
    });
    fireEvent.change(screen.getByLabelText("Carpeta de destino"), {
      target: { value: "D:/respaldos" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(guardar).toHaveBeenCalled());
    expect(guardar.mock.calls[0][0]).toMatchObject({
      activo: true,
      hora: "03:30",
      destino: "D:/respaldos",
      conservar: 14,
    });
  });

  it("apagado, lo dice en vez de anunciar un próximo que no ocurrirá", async () => {
    leer.mockResolvedValue({ ...POLITICA, activo: false, proximo: null });

    pintar();

    expect(
      await screen.findByText("Respaldo automático apagado"),
    ).toBeInTheDocument();
  });

  it("sin permiso de editar se consulta, no se cambia", async () => {
    permisos.clear();

    pintar();

    expect(await screen.findByLabelText("Cada cuánto")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Guardar" }),
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
