import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Importar la matriz legal (Excel de Administración) y la ficha de la
 * obligación (27/10/2026).
 */

const servicio = { importar: vi.fn(), guardarFicha: vi.fn() };
vi.mock("../src/api/matrizService", () => ({ matrizService: servicio }));

const { ImportarMatrizModal } =
  await import("../src/pages/Matriz/ImportarMatrizModal");
const { FichaObligacion } = await import("../src/pages/Matriz/FichaObligacion");

const PLAN = {
  filas: 3,
  crear: 2,
  actualizar: 1,
  por_confirmar: 1,
  vencidas: 0,
  entidades_nuevas: ["GAD Municipal Machala"],
  sedes_nuevas: ["Macas"],
  responsable: { id: 1, nombre: "Daniela Albán", correo: "dani@grupolaar.com" },
  suplente: { id: 2, nombre: "Andrés Lima", correo: "andres@grupolaar.com" },
  errores: [],
  avisos: [
    "CONSOLIDADO, fila 247: la fecha «2024-15-05» tenía el día y el mes invertidos.",
  ],
  aplicado: null,
  obligaciones: [
    {
      fila: "CONSOLIDADO, fila 2",
      nombre: "Patente · Machala",
      tema: "CONT",
      entidad: "GAD Municipal Machala",
      sede: "Machala",
      periodicidad: "anual",
      vencimiento: "2026-12-31",
      por_confirmar: true,
      accion: "crear",
    },
    {
      fila: "CONSOLIDADO, fila 3",
      nombre: "Seguro de vehículo · PCX-8344",
      tema: "SEG",
      entidad: "Aseguradora del Sur C.A.",
      sede: "Matriz Quito",
      periodicidad: "anual",
      vencimiento: "2027-07-01",
      por_confirmar: false,
      accion: "crear",
    },
    {
      fila: "CONTABILIDAD, fila 5",
      nombre: "Declaración IVA Mensual",
      tema: "CONT",
      entidad: "Servicio de Rentas Internas",
      sede: null,
      periodicidad: "mensual",
      vencimiento: "2026-08-11",
      por_confirmar: false,
      accion: "actualizar",
    },
  ],
};

const archivo = new File(["x"], "MATRIZ LEGAL FINAL.xlsx");

beforeEach(() => vi.clearAllMocks());

describe("Importar matriz legal", () => {
  it("primero simula y muestra qué haría; luego importa", async () => {
    servicio.importar.mockResolvedValueOnce(PLAN).mockResolvedValueOnce({
      ...PLAN,
      aplicado: {
        creadas: 2,
        actualizadas: 1,
        entidades_nuevas: 1,
        sedes_nuevas: 1,
      },
    });
    const onImportado = vi.fn();
    render(
      <ImportarMatrizModal onCerrar={() => {}} onImportado={onImportado} />,
    );
    // Antes de simular no se ofrece importar.
    expect(screen.queryByRole("button", { name: /^Importar/ })).toBeNull();

    fireEvent.change(screen.getByLabelText("Archivo (.xlsx)"), {
      target: { files: [archivo] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Simular/ }));
    expect(await screen.findByText("se crean")).toBeInTheDocument();
    expect(servicio.importar).toHaveBeenCalledWith(archivo, false);
    expect(screen.getByText(/Daniela Albán/)).toBeInTheDocument();
    expect(screen.getByText("Macas")).toBeInTheDocument();
    expect(screen.getByText("Patente · Machala")).toBeInTheDocument();
    expect(screen.getByText("por confirmar")).toBeInTheDocument();

    // Filtrar las que quedan con fecha por confirmar.
    fireEvent.click(
      screen.getByRole("button", { name: /Por confirmar \(1\)/ }),
    );
    const tabla = screen.getByRole("table");
    expect(within(tabla).getAllByRole("row")).toHaveLength(2);

    fireEvent.click(
      screen.getByRole("button", { name: "Importar (3 obligaciones)" }),
    );
    await waitFor(() =>
      expect(servicio.importar).toHaveBeenLastCalledWith(archivo, true),
    );
    expect(
      await screen.findByText(/2 obligaciones creadas y 1 actualizadas/),
    ).toBeInTheDocument();
    expect(onImportado).toHaveBeenCalled();
  });

  it("con errores no deja importar y dice por qué", async () => {
    servicio.importar.mockResolvedValue({
      ...PLAN,
      errores: ["No hay una cuenta activa con el correo dani@grupolaar.com."],
    });
    render(<ImportarMatrizModal onCerrar={() => {}} />);
    fireEvent.change(screen.getByLabelText("Archivo (.xlsx)"), {
      target: { files: [archivo] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Simular/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No hay una cuenta activa",
    );
    expect(screen.getByRole("button", { name: /^Importar \(/ })).toBeDisabled();
  });
});

describe("Ficha de la obligación", () => {
  const obligacion = {
    id: 9,
    nombre: "Seguro de vehículo · PCX-8344",
    ficha: {
      tipo: "seguro",
      emitido_en: "2026-06-01",
      aseguradora: "Aseguradora del Sur C.A.",
      placa: "PCX-8344",
      prima: null,
      prima_detalle: "2.80 por persona",
      valor_asegurado: "18000.00",
      renovado: null,
      notas: "",
    },
  };

  it("muestra los datos que tiene y se edita", async () => {
    servicio.guardarFicha.mockResolvedValue({});
    const onGuardada = vi.fn();
    render(
      <FichaObligacion
        obligacion={obligacion}
        puedeEditar
        onGuardada={onGuardada}
      />,
    );
    expect(screen.getByText("Seguro")).toBeInTheDocument();
    expect(screen.getByText("PCX-8344")).toBeInTheDocument();
    expect(screen.getByText("2.80 por persona")).toBeInTheDocument();
    // Lo vacío no se muestra.
    expect(screen.queryByText("Broker")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Editar ficha/ }));
    fireEvent.change(screen.getByLabelText("Broker"), {
      target: { value: "Multiapoyo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar ficha" }));
    await waitFor(() =>
      expect(servicio.guardarFicha).toHaveBeenCalledWith(
        9,
        expect.objectContaining({
          broker: "Multiapoyo",
          prima: null,
          placa: "PCX-8344",
        }),
      ),
    );
    expect(onGuardada).toHaveBeenCalled();
  });

  it("sin ficha y sin permiso no aparece", () => {
    const { container } = render(
      <FichaObligacion obligacion={{ id: 1, nombre: "x", ficha: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
