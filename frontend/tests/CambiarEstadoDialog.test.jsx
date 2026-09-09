import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CambiarEstadoDialog } from "../src/components/activos/CambiarEstadoDialog/CambiarEstadoDialog";

vi.mock("../src/api/activosService", () => ({
  activosService: { cambiarEstado: vi.fn(() => Promise.resolve({})) },
}));

const { activosService } = await import("../src/api/activosService");

const ACTIVO = {
  id: 4,
  codigo_barras: "GA-LAP-000004",
  nombre: "Laptop Contabilidad",
  estado: "en_uso",
};

function abrir(activo = ACTIVO) {
  return render(
    <CambiarEstadoDialog activo={activo} onCerrar={() => {}} onGuardado={() => {}} />
  );
}

describe("Cambio de estado del activo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ofrece los nueve estados, separando los que sacan el equipo del parque", () => {
    abrir();

    // La agrupación no es cosmética: los tres de abajo tienen consecuencias
    // que los otros seis no tienen.
    expect(screen.getByRole("option", { name: "Disponible" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "En tránsito" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Robado" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(9);
  });

  it("exige motivo para las tres salidas, no solo para la baja", () => {
    abrir();

    fireEvent.change(screen.getByLabelText("Nuevo estado"), { target: { value: "perdido" } });

    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Motivo/), {
      target: { value: "No apareció en el conteo" },
    });
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeEnabled();
  });

  it("advierte de lo que implica sacar el equipo del inventario", () => {
    abrir();

    fireEvent.change(screen.getByLabelText("Nuevo estado"), { target: { value: "robado" } });

    expect(screen.getByText(/El equipo sale del inventario/)).toBeInTheDocument();
    expect(screen.getByText(/número de denuncia/)).toBeInTheDocument();
  });

  it("no deja cambiar el estado de un activo dado de baja", () => {
    /* La baja es definitiva: ofrecer el desplegable prometería algo que el
       backend rechaza. */
    abrir({ ...ACTIVO, estado: "dado_de_baja" });

    expect(screen.getByLabelText("Nuevo estado")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dar de baja" })).toBeDisabled();
    expect(screen.getByText(/regístrelo como uno nuevo/i)).toBeInTheDocument();
  });

  it("envía el cambio con su motivo", async () => {
    abrir();

    fireEvent.change(screen.getByLabelText("Nuevo estado"), { target: { value: "en_transito" } });
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "A la sucursal" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(activosService.cambiarEstado).toHaveBeenCalledWith(4, {
      estado: "en_transito",
      motivo: "A la sucursal",
    });
  });
});
