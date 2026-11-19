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
 * El acta de entrega en la ficha del equipo (19/11/2026): consultar cualquiera
 * de los equipos de una entrega muestra el acta original con todos ellos.
 */

const servicio = {
  delEquipo: vi.fn(),
  preparar: vi.fn(() => new Promise(() => {})),
  documento: vi.fn(),
};
const descargarBlob = vi.fn();
vi.mock("../src/api/activosService", () => ({ actasEntregaService: servicio }));
vi.mock("../src/utils/descargas", () => ({ descargarBlob }));
vi.mock("../src/hooks/usePermission", () => ({ usePermission: () => false }));

const { ActaDelEquipo: Tarjeta } =
  await import("../src/components/activos/ActaDelEquipo/ActaDelEquipo");

const ActaDelEquipo = (props) => (
  <MemoryRouter>
    <Tarjeta {...props} />
  </MemoryRouter>
);

const movimiento = (id, activoId, tipo, serie) => ({
  id,
  created_at: "2026-11-06T10:00:00Z",
  acta_id: 7,
  activo: {
    id: activoId,
    codigo_barras: `ACT-IT-0${activoId}`,
    nombre: tipo,
    tipo,
    marca: "Genius",
    modelo: "DX-110",
    numero_serie: serie,
  },
});

const ACTA = {
  id: 7,
  fecha: "2026-11-06",
  custodio: { id: 3, nombre: "Paul Ortega", cargo: "Analista" },
  tecnico: { id: 1, nombre: "David Vargas" },
  movimientos: [
    movimiento(1, 10, "Laptop", "S-1"),
    movimiento(2, 20, "Mouse", "S-2"),
    movimiento(3, 30, "Teclado", "S-3"),
    movimiento(4, 40, "Audífonos", "S-4"),
  ],
  pruebas: {},
  nuevo_de_paquete: null,
  observaciones: "",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ActaDelEquipo", () => {
  it("muestra el acta original con todos los equipos y marca el consultado", async () => {
    servicio.delEquipo.mockResolvedValue([ACTA]);
    render(<ActaDelEquipo activoId={30} />);

    const acta = await screen.findByRole("article", { name: "Acta N.º 7" });
    expect(servicio.delEquipo).toHaveBeenCalledWith(30);
    expect(within(acta).getByText(/Paul Ortega/)).toBeInTheDocument();
    const filas = within(acta).getAllByRole("row").slice(1);
    expect(filas).toHaveLength(4);
    const este = filas.find((f) => f.getAttribute("aria-current") === "true");
    expect(within(este).getByText("Teclado")).toBeInTheDocument();
    expect(within(este).getByText("Este equipo")).toBeInTheDocument();
    // Los demás equipos del acta enlazan a su ficha.
    expect(
      within(acta).getByRole("link", { name: "ACT-IT-010" }),
    ).toHaveAttribute("href", "/admin/activos/10");
    expect(within(este).queryByRole("link")).toBeNull();
  });

  it("descarga el PDF del acta para imprimirla", async () => {
    servicio.delEquipo.mockResolvedValue([ACTA]);
    servicio.documento.mockResolvedValue(new Blob(["%PDF"]));
    render(<ActaDelEquipo activoId={10} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /PDF para imprimir/ }),
    );

    await waitFor(() =>
      expect(descargarBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        "acta-entrega-AEE-LC-01-7.pdf",
      ),
    );
    expect(servicio.documento).toHaveBeenCalledWith(7, "pdf");
  });

  it("abre el acta para verla o corregirla desde la asignación de este equipo", async () => {
    servicio.delEquipo.mockResolvedValue([ACTA]);
    render(<ActaDelEquipo activoId={20} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Ver o corregir/ }),
    );

    expect(servicio.preparar).toHaveBeenCalledWith(2);
  });

  it("sin acta lo dice y explica dónde se genera", async () => {
    servicio.delEquipo.mockResolvedValue([]);
    render(<ActaDelEquipo activoId={99} />);

    expect(
      await screen.findByText(/todavía no tiene acta de entrega/),
    ).toBeInTheDocument();
  });

  it("si falla la consulta permite reintentar", async () => {
    servicio.delEquipo
      .mockRejectedValueOnce(new Error("red"))
      .mockResolvedValueOnce([ACTA]);
    render(<ActaDelEquipo activoId={10} />);

    fireEvent.click(await screen.findByRole("button", { name: /Reintentar/ }));

    expect(
      await screen.findByRole("article", { name: "Acta N.º 7" }),
    ).toBeInTheDocument();
  });
});
