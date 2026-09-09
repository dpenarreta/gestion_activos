import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReportesPage } from "../src/pages/Admin/Reportes/ReportesPage";

const CATALOGO = {
  reportes: [
    {
      clave: "inventario-general",
      nombre: "Inventario general",
      descripcion: "Todos los activos registrados, con su ficha resumida.",
      fuente: "activos",
      parametros: ["departamento", "ubicacion", "tipo", "criticidad", "uso"],
      columnas: [
        { clave: "codigo_barras", etiqueta: "Código" },
        { clave: "nombre", etiqueta: "Nombre" },
      ],
    },
    {
      clave: "historial-reparaciones",
      nombre: "Historial de reparaciones",
      descripcion: "Bitácora de intervenciones con causa, solución y costo.",
      fuente: "mantenimientos",
      parametros: [
        "desde",
        "hasta",
        "activo",
        "tipo_mantenimiento",
        "departamento",
      ],
      columnas: [{ clave: "fecha", etiqueta: "Ingreso" }],
    },
  ],
  formatos: ["xlsx", "csv", "pdf"],
  max_filas: 10000,
  max_filas_pdf: 1000,
};

const VISTA = {
  reporte: CATALOGO.reportes[0],
  columnas: [
    { clave: "codigo_barras", etiqueta: "Código" },
    { clave: "nombre", etiqueta: "Nombre" },
  ],
  filas: [["GA-LAP-000001", "Laptop Contabilidad"]],
  total: 1,
  mostradas: 1,
  filtros: "",
};

vi.mock("../src/api/reportesService", () => ({
  reportesService: {
    catalogo: vi.fn(() => Promise.resolve(CATALOGO)),
    vistaPrevia: vi.fn(() => Promise.resolve(VISTA)),
    descargar: vi.fn(() => Promise.resolve(new Blob(["x"]))),
  },
}));

vi.mock("../src/api/organizacionService", () => ({
  departamentosService: { list: vi.fn(() => Promise.resolve({ results: [] })) },
  empleadosService: { list: vi.fn(() => Promise.resolve({ results: [] })) },
  ubicacionesService: { list: vi.fn(() => Promise.resolve({ results: [] })) },
}));

vi.mock("../src/api/activosService", () => ({
  tiposDispositivoService: {
    list: vi.fn(() => Promise.resolve({ results: [] })),
  },
}));

vi.mock("../src/utils/descargas", () => ({ descargarBlob: vi.fn() }));

let permiso = true;
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: () => permiso,
}));

const { reportesService } = await import("../src/api/reportesService");
const { descargarBlob } = await import("../src/utils/descargas");

describe("Pantalla de reportes", () => {
  beforeEach(() => {
    permiso = true;
    vi.clearAllMocks();
  });

  it("lista los reportes que publica el catálogo, sin conocerlos de antemano", async () => {
    render(<ReportesPage />);

    expect(await screen.findAllByText("Inventario general")).not.toHaveLength(
      0,
    );
    expect(screen.getByText("Historial de reparaciones")).toBeInTheDocument();
  });

  it("dibuja los filtros que declara cada reporte", async () => {
    render(<ReportesPage />);
    await screen.findAllByText("Inventario general");

    // El inventario filtra por alcance; el historial, por período.
    expect(screen.getByText("Criticidad")).toBeInTheDocument();
    expect(screen.queryByText("Desde")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Historial de reparaciones"));

    await waitFor(() => expect(screen.getByText("Desde")).toBeInTheDocument());
    expect(screen.getByText("Tipo de intervención")).toBeInTheDocument();
  });

  it("muestra una vista previa antes de descargar", async () => {
    render(<ReportesPage />);

    expect(await screen.findByText("GA-LAP-000001")).toBeInTheDocument();
    expect(screen.getByText("Código")).toBeInTheDocument();
  });

  it("descarga en los tres formatos del documento", async () => {
    render(<ReportesPage />);
    await screen.findByText("GA-LAP-000001");

    fireEvent.click(screen.getByRole("button", { name: /Excel/ }));

    await waitFor(() =>
      expect(reportesService.descargar).toHaveBeenCalledWith(
        "inventario-general",
        "xlsx",
        {},
      ),
    );
    expect(descargarBlob).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /CSV/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /PDF/ })).toBeInTheDocument();
  });

  it("no ofrece la descarga a quien solo puede consultar", async () => {
    /* El archivo sale del sistema y circula por correo; la pantalla no. */
    permiso = false;
    render(<ReportesPage />);
    await screen.findAllByText("Inventario general");

    expect(screen.getByRole("button", { name: /Excel/ })).toBeDisabled();
  });
});
