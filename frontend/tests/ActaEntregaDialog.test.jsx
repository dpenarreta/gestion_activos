import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Acta de recepción de equipo AEE-LC-01 (16/11/2026): junta lo entregado a la
 * persona ese día, guarda la prueba de funcionalidad y descarga Word y PDF.
 */

const servicio = {
  preparar: vi.fn(),
  crear: vi.fn(),
  editar: vi.fn(),
  documento: vi.fn(),
  agregarEquipo: vi.fn(),
};
const descargarBlob = vi.fn();
vi.mock("../src/api/activosService", () => ({ actasEntregaService: servicio }));
vi.mock("../src/utils/descargas", () => ({ descargarBlob }));
const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { ActaEntregaDialog } =
  await import("../src/components/activos/ActaEntregaDialog/ActaEntregaDialog");

const equipo = (id, tipo, serie, acta_id = null) => ({
  id,
  created_at: "2026-11-06T10:00:00Z",
  acta_id,
  activo: {
    id: id * 10,
    codigo_barras: `ACT-IT-0${id}`,
    nombre: tipo,
    tipo,
    marca: "Genius",
    modelo: "DX-110",
    numero_serie: serie,
  },
});

const PREPARACION = {
  movimiento: 1,
  fecha: "2026-11-06",
  custodio: { id: 3, nombre: "Paul Ortega" },
  candidatos: [
    equipo(1, "Mouse", "36D98679707610"),
    equipo(2, "Laptop", "LAP-1"),
    equipo(3, "Teclado", "TEC-1", 99),
  ],
  acta: null,
  pruebas: [
    { clave: "on_off", etiqueta: "Prueba ON/OFF" },
    { clave: "mouse", etiqueta: "Función Mouse" },
  ],
};

beforeEach(() => {
  Object.values(servicio).forEach((f) => f.mockReset());
  descargarBlob.mockReset();
  permisos.clear();
});

describe("Acta de recepción de equipo", () => {
  it("elige lo entregado ese día, menos lo que ya está en otra acta, y guarda las pruebas", async () => {
    servicio.preparar.mockResolvedValue(PREPARACION);
    servicio.crear.mockResolvedValue({
      id: 7,
      movimientos: [
        equipo(1, "Mouse", "36D98679707610"),
        equipo(2, "Laptop", "LAP-1"),
      ],
      pruebas: { mouse: "ok" },
      nuevo_de_paquete: false,
      observaciones: "SE ENTREGA CARGADOR",
    });
    render(<ActaEntregaDialog movimientoId={1} onCerrar={() => {}} />);

    expect(await screen.findByText(/Paul Ortega/)).toBeInTheDocument();
    const casillas = screen.getAllByRole("checkbox");
    expect(casillas.map((c) => c.checked)).toEqual([true, true, false]);
    expect(casillas[2]).toBeDisabled();
    expect(screen.getByText(/ya está en el acta N.º 99/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("radio", { name: "Ok" })[1]);
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.change(screen.getByLabelText(/Observaciones/), {
      target: { value: "SE ENTREGA CARGADOR" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar acta" }));

    await waitFor(() =>
      expect(servicio.crear).toHaveBeenCalledWith({
        movimientos: [1, 2],
        pruebas: { mouse: "ok" },
        nuevo_de_paquete: false,
        observaciones: "SE ENTREGA CARGADOR",
        items_sin_codigo: [],
      }),
    );
    expect(await screen.findByText(/Acta N.º 7 guardada/)).toBeInTheDocument();
  });

  it("con el acta guardada, descarga el Word y el PDF", async () => {
    const acta = {
      id: 7,
      movimientos: [equipo(1, "Mouse", "S-1")],
      pruebas: {},
      nuevo_de_paquete: null,
      observaciones: "",
    };
    servicio.preparar.mockResolvedValue({ ...PREPARACION, acta });
    servicio.documento.mockResolvedValue(new Blob(["x"]));
    render(<ActaEntregaDialog movimientoId={1} onCerrar={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: /Word/ }));
    await waitFor(() =>
      expect(descargarBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        "acta-entrega-AEE-LC-01-7.docx",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /PDF/ }));
    await waitFor(() =>
      expect(servicio.documento).toHaveBeenCalledWith(7, "pdf"),
    );
  });

  it("no guarda un acta sin equipos", async () => {
    servicio.preparar.mockResolvedValue({
      ...PREPARACION,
      candidatos: [equipo(1, "Mouse", "S-1")],
    });
    render(<ActaEntregaDialog movimientoId={1} onCerrar={() => {}} />);
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar acta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Elija al menos un equipo",
    );
    expect(servicio.crear).not.toHaveBeenCalled();
  });

  it("agrega equipos escaneando o escribiendo el código, sin guardar el acta con el Enter (19/11/2026)", async () => {
    permisos.add("activos.asignar");
    servicio.preparar.mockResolvedValue({
      ...PREPARACION,
      candidatos: [equipo(1, "Laptop", "LAP-1")],
    });
    servicio.agregarEquipo.mockResolvedValue({
      movimiento: equipo(5, "Teclado", "TEC-77"),
      ya_estaba: false,
    });
    render(<ActaEntregaDialog movimientoId={1} onCerrar={() => {}} />);

    const campo = await screen.findByLabelText(
      "Agregar otro equipo que se entrega",
    );
    fireEvent.change(campo, { target: { value: "ACT-IT-05" } });
    // La pistola cierra con Enter: agrega el equipo, no guarda el acta.
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() =>
      expect(servicio.agregarEquipo).toHaveBeenCalledWith(1, "ACT-IT-05"),
    );
    expect(
      await screen.findByText(/asignado a Paul Ortega y agregado al acta/),
    ).toBeInTheDocument();
    expect(servicio.crear).not.toHaveBeenCalled();
    expect(campo).toHaveValue("");
    const casillas = screen.getAllByRole("checkbox");
    expect(casillas).toHaveLength(2);
    expect(casillas.every((c) => c.checked)).toBe(true);
  });

  it("dice por qué no se pudo agregar un equipo", async () => {
    permisos.add("activos.asignar");
    servicio.preparar.mockResolvedValue(PREPARACION);
    servicio.agregarEquipo.mockRejectedValue({
      response: {
        status: 400,
        data: { codigo: "ACT-9 está a cargo de Ana Ríos." },
      },
    });
    render(<ActaEntregaDialog movimientoId={1} onCerrar={() => {}} />);

    fireEvent.change(
      await screen.findByLabelText("Agregar otro equipo que se entrega"),
      { target: { value: "ACT-9" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    expect(
      await screen.findByText(/está a cargo de Ana Ríos/),
    ).toBeInTheDocument();
  });

  it("agrega ítems sin código que constan en el acta, sin asignar nada (19/11/2026)", async () => {
    servicio.preparar.mockResolvedValue(PREPARACION);
    servicio.crear.mockResolvedValue({
      id: 8,
      movimientos: [equipo(1, "Mouse", "36D98679707610")],
      pruebas: {},
      nuevo_de_paquete: null,
      observaciones: "",
      items_sin_codigo: [
        {
          equipo: "Cable HDMI",
          cantidad: 2,
          marca: "",
          modelo: "",
          serial: "",
        },
      ],
    });
    render(<ActaEntregaDialog movimientoId={1} onCerrar={() => {}} />);

    const campo = await screen.findByLabelText("Qué se entrega");
    // Sin descripción no se agrega.
    fireEvent.click(screen.getByRole("button", { name: /Agregar ítem/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Escriba qué se entrega",
    );
    fireEvent.change(campo, { target: { value: "Cable HDMI" } });
    fireEvent.change(screen.getByLabelText("Cantidad"), {
      target: { value: "2" },
    });
    // Enter agrega el ítem, no guarda el acta.
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(servicio.crear).not.toHaveBeenCalled();
    expect(screen.getByText("Cable HDMI")).toBeInTheDocument();
    expect(campo).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Guardar acta" }));
    await waitFor(() =>
      expect(servicio.crear).toHaveBeenCalledWith(
        expect.objectContaining({
          items_sin_codigo: [
            {
              equipo: "Cable HDMI",
              cantidad: 2,
              marca: "",
              modelo: "",
              serial: "",
            },
          ],
        }),
      ),
    );
    expect(servicio.agregarEquipo).not.toHaveBeenCalled();
  });

  it("un código que no existe se puede escribir como ítem sin código", async () => {
    permisos.add("activos.asignar");
    servicio.preparar.mockResolvedValue(PREPARACION);
    servicio.agregarEquipo.mockRejectedValue({
      response: { status: 404, data: { codigo: "Ningún equipo corresponde." } },
    });
    render(<ActaEntregaDialog movimientoId={1} onCerrar={() => {}} />);

    fireEvent.change(
      await screen.findByLabelText("Agregar otro equipo que se entrega"),
      { target: { value: "Diadema" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Escribirlo como ítem sin código",
      }),
    );
    expect(screen.getByLabelText("Qué se entrega")).toHaveValue("Diadema");
  });

  it("sin permiso para asignar no ofrece agregar equipos", async () => {
    servicio.preparar.mockResolvedValue(PREPARACION);
    render(<ActaEntregaDialog movimientoId={1} onCerrar={() => {}} />);
    await screen.findByText(/Paul Ortega/);
    expect(
      screen.queryByLabelText("Agregar otro equipo que se entrega"),
    ).toBeNull();
  });
});
