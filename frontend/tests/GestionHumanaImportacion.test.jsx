import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorApi, servicioFalso } from "./gestionHumanaDatos";

/*
 * La importación desde Excel en dos pasos: vista previa (no guarda nada) y
 * confirmación con qué hacer con lo que ya existe.
 */

const servicio = servicioFalso();
vi.mock("../src/api/novedadesService", async (importOriginal) => ({
  ...(await importOriginal()),
  novedadesService: servicio,
}));

const { ImportarExcel } =
  await import("../src/pages/GestionHumana/ImportarExcel");

const LOTE = {
  id: 31,
  kind: "OVERTIME",
  status: "PREVIEW",
  period: "2026-11",
  file_name: "horas.xlsx",
  rows: [],
  errors: [
    { row: 4, column: "CEDULA", message: "La cédula 0999 no está en su base." },
  ],
  summary: {
    total_rows: 3,
    valid_rows: 2,
    invalid_rows: 1,
    existing_items: 1,
    new_items: 1,
    already_imported: false,
    warnings: [],
  },
  strategy: "",
  created_at: "2026-11-04T15:00:00Z",
};

const MES = {
  label: "Noviembre 2026",
  start_date: "2026-11-01",
  end_date: "2026-11-30",
};

function pintar(props = {}) {
  const onCerrar = vi.fn();
  const onImportado = vi.fn();
  render(
    <ImportarExcel
      tipo="OVERTIME"
      periodo="2026-11"
      rango={MES}
      onCerrar={onCerrar}
      onImportado={onImportado}
      {...props}
    />,
  );
  return { onCerrar, onImportado };
}

function elegirArchivo(nombre = "horas.xlsx") {
  const archivo = new File(["contenido"], nombre, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  fireEvent.change(screen.getByLabelText(/Archivo de Excel/), {
    target: { files: [archivo] },
  });
  return archivo;
}

beforeEach(() => {
  // Respuestas por defecto en cada prueba: un `mockRejectedValue` de una
  // prueba anterior no se arrastra a la siguiente.
  Object.assign(servicio, servicioFalso());
});

describe("Importar desde Excel", () => {
  it("sin archivo no avanza y lo dice bajo el campo", () => {
    pintar();
    fireEvent.click(screen.getByRole("button", { name: "Ver vista previa" }));
    expect(
      screen.getByText("Elija el archivo de Excel (.xlsx)."),
    ).toBeInTheDocument();
    expect(servicio.vistaPrevia).not.toHaveBeenCalled();
  });

  it("rechaza en la pantalla lo que no es .xlsx", () => {
    pintar();
    elegirArchivo("horas.csv");
    fireEvent.click(screen.getByRole("button", { name: "Ver vista previa" }));
    expect(
      screen.getByText(/debe ser de Excel con extensión \.xlsx/),
    ).toBeInTheDocument();
    expect(servicio.vistaPrevia).not.toHaveBeenCalled();
  });

  it("paso 1: vista previa; paso 2: confirmación con la estrategia elegida", async () => {
    servicio.vistaPrevia.mockResolvedValue(LOTE);
    servicio.confirmarImportacion.mockResolvedValue({
      ...LOTE,
      status: "CONFIRMED",
      summary: { ...LOTE.summary, applied: 2, skipped: 0 },
    });
    const { onImportado } = pintar();
    const archivo = elegirArchivo();
    fireEvent.click(screen.getByRole("button", { name: "Ver vista previa" }));

    await waitFor(() =>
      expect(servicio.vistaPrevia).toHaveBeenCalledWith({
        kind: "OVERTIME",
        period: "2026-11",
        supervisorId: undefined,
        archivo,
      }),
    );
    const dialogo = screen.getByRole("dialog");
    expect(
      await within(dialogo).findByText("Paso 2 de 2 · Revise y confirme"),
    ).toBeInTheDocument();
    expect(
      within(dialogo).getByText("La cédula 0999 no está en su base.", {
        exact: false,
      }),
    ).toBeInTheDocument();
    // Nada se guardó todavía.
    expect(servicio.confirmarImportacion).not.toHaveBeenCalled();

    fireEvent.change(
      within(dialogo).getByLabelText("Registros que ya existen"),
      {
        target: { value: "update" },
      },
    );
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Confirmar importación" }),
    );

    await waitFor(() =>
      expect(servicio.confirmarImportacion).toHaveBeenCalledWith(31, "update"),
    );
    expect(onImportado).toHaveBeenCalledWith(
      "Importación aplicada: 2 aplicados, 0 omitidos, 1 con error.",
      "warn",
    );
  });

  it("cerrar en la vista previa cancela la importación", async () => {
    servicio.vistaPrevia.mockResolvedValue(LOTE);
    const { onCerrar } = pintar();
    elegirArchivo();
    fireEvent.click(screen.getByRole("button", { name: "Ver vista previa" }));
    await screen.findByText("Paso 2 de 2 · Revise y confirme");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar ventana" }));
    // Se eligió un archivo: la ventana pregunta antes de descartarlo.
    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
    await waitFor(() =>
      expect(servicio.cancelarImportacion).toHaveBeenCalledWith(31),
    );
    expect(onCerrar).toHaveBeenCalled();
  });

  it("muestra el error del servidor al leer el archivo", async () => {
    servicio.vistaPrevia.mockRejectedValue(
      errorApi(400, "Error en la solicitud.", "validation_error", {
        file: ["El archivo supera 10 MB."],
      }),
    );
    pintar();
    elegirArchivo();
    fireEvent.click(screen.getByRole("button", { name: "Ver vista previa" }));
    expect(
      await screen.findByText(/El archivo supera 10 MB/),
    ).toBeInTheDocument();
  });

  it("la base de colaboradores dice a qué equipo va y lista cada fila", async () => {
    servicio.vistaPrevia.mockResolvedValue({
      ...LOTE,
      kind: "COLLABORATORS",
      errors: [],
      rows: [
        {
          row: 2,
          cedula: "0102030405",
          full_name: "Ana Pérez",
          status: "NEW",
          changes: {},
        },
        {
          row: 3,
          cedula: "0911111111",
          full_name: "Luis Mora",
          status: "EXISTING",
          changes: { cargo: ["Courier", "Supervisor de ruta"] },
        },
      ],
      summary: {
        total_rows: 2,
        new_items: 1,
        existing_items: 1,
        to_update: 1,
        valid_rows: 2,
        invalid_rows: 0,
      },
    });
    pintar({
      tipo: "COLLABORATORS",
      periodo: undefined,
      rango: undefined,
      supervisorId: 7,
      supervisorNombre: "Sofía",
    });
    expect(screen.getByText("Sofía")).toBeInTheDocument();
    elegirArchivo();
    fireEvent.click(screen.getByRole("button", { name: "Ver vista previa" }));
    await waitFor(() =>
      expect(servicio.vistaPrevia).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "COLLABORATORS",
          period: "",
          supervisorId: 7,
        }),
      ),
    );
    expect(
      await screen.findByText("Cargo: Courier → Supervisor de ruta"),
    ).toBeInTheDocument();
    expect(screen.getByText("Existente · se actualizaría")).toBeInTheDocument();
  });
});
