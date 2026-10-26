import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOTIVO, darMotivo } from "./motivo";

/*
 * Carga masiva de personas del organigrama: descargar la plantilla, subirla
 * para validarla (sin guardar) y confirmar. Con errores no se puede confirmar.
 */

const servicio = {
  plantillaPersonas: vi.fn(),
  exportarOrganigrama: vi.fn(),
  cargarPersonas: vi.fn(),
};
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: servicio,
}));
const descargarBlob = vi.fn();
vi.mock("../src/utils/descargas", () => ({ descargarBlob }));

const { CargaPersonas } =
  await import("../src/pages/Institucional/CargaPersonas");

const VALIDO = {
  valido: true,
  errores: [],
  total_errores: 0,
  avisos: ["«Analista · Comercial» tiene 2 plazas y se cargan 3 personas."],
  cargos: 3,
  personas: 3,
  con_cuenta: 1,
  sin_cuenta: 2,
  aplicado: false,
};

beforeEach(() => vi.clearAllMocks());

function subir() {
  const archivo = new File(["x"], "organigrama-personas.xlsx");
  fireEvent.change(screen.getByLabelText("Plantilla llena (.xlsx)"), {
    target: { files: [archivo] },
  });
  return archivo;
}

describe("Carga masiva de personas", () => {
  it("descarga la plantilla vacía o el organigrama completo", async () => {
    const plantilla = new Blob(["vacía"]);
    const completo = new Blob(["completo"]);
    servicio.plantillaPersonas.mockResolvedValue(plantilla);
    servicio.exportarOrganigrama.mockResolvedValue(completo);
    render(<CargaPersonas onCerrar={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Plantilla de carga masiva/ }),
    );
    await waitFor(() =>
      expect(descargarBlob).toHaveBeenCalledWith(
        plantilla,
        "plantilla-carga-organigrama.xlsx",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Organigrama completo/ }),
    );
    await waitFor(() =>
      expect(descargarBlob).toHaveBeenLastCalledWith(
        completo,
        expect.stringMatching(/^organigrama-completo-\d{4}-\d{2}-\d{2}\.xlsx$/),
      ),
    );
  });

  it("valida sin guardar, muestra el reporte y al confirmar aplica", async () => {
    servicio.cargarPersonas
      .mockResolvedValueOnce(VALIDO)
      .mockResolvedValueOnce({ ...VALIDO, aplicado: true });
    const onCargado = vi.fn();
    render(<CargaPersonas onCerrar={() => {}} onCargado={onCargado} />);
    expect(screen.getByRole("button", { name: "Validar" })).toBeDisabled();
    const archivo = subir();
    fireEvent.click(screen.getByRole("button", { name: "Validar" }));

    expect(
      await screen.findByText(/Todavía no se guardó nada/),
    ).toBeInTheDocument();
    // Validar no pide motivo: no cambia nada.
    expect(servicio.cargarPersonas).toHaveBeenCalledWith(archivo, {
      confirmar: false,
      motivo: null,
    });
    expect(screen.getByText(/1 con cuenta/)).toBeInTheDocument();
    expect(
      screen.getByText(/tiene 2 plazas y se cargan 3/),
    ).toBeInTheDocument();
    expect(onCargado).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar carga" }));
    await darMotivo();
    expect(await screen.findByText(/Carga aplicada/)).toBeInTheDocument();
    expect(servicio.cargarPersonas).toHaveBeenLastCalledWith(archivo, {
      confirmar: true,
      motivo: MOTIVO,
    });
    expect(onCargado).toHaveBeenCalled();
  });

  it("con errores los lista y no deja confirmar", async () => {
    servicio.cargarPersonas.mockRejectedValue({
      response: {
        status: 400,
        data: {
          valido: false,
          errores: ["Hoja «Comercial», fila 7: escriba nombres y apellidos."],
          total_errores: 1,
          avisos: [],
        },
      },
    });
    render(<CargaPersonas onCerrar={() => {}} />);
    subir();
    fireEvent.click(screen.getByRole("button", { name: "Validar" }));
    expect(
      await screen.findByText(/fila 7: escriba nombres y apellidos/),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/1 error/);
    expect(
      screen.queryByRole("button", { name: "Confirmar carga" }),
    ).toBeNull();
  });
});
