import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * US-013 (CA-8): «Mi perfil» → Mis llamados de atención. Solo lectura: fecha
 * del hecho, número, causa, nivel, descripción y monto de las sanciones; sin
 * quién lo solicitó. Sin llamados la sección no aparece. `?seccion=llamados`
 * (el enlace del aviso) lleva el foco a la sección.
 */

const servicio = { mios: vi.fn() };
vi.mock("../src/api/llamadosService", () => ({ llamadosService: servicio }));

const { MisLlamados } = await import("../src/pages/MisDatos/MisLlamados");

const LLAMADOS = [
  {
    id: 1,
    numero: "LA-0001",
    fecha_hecho: "2026-11-05",
    causa: { id: 1, nombre: "Firma del rol de pagos" },
    nivel: { id: 12, nombre: "Segundo llamado (escrito)", tipo: "escrito" },
    descripcion: "No firmó el rol.",
    monto: null,
    estado: "emitido",
    solicitado_por: { id: 9, nombre: "Jefe Secreto" },
  },
  {
    id: 2,
    numero: "LA-0002",
    fecha_hecho: "2026-10-01",
    causa: { id: 1, nombre: "Firma del rol de pagos" },
    nivel: { id: 13, nombre: "Sanción económica", tipo: "sancion_economica" },
    descripcion: "Reincidencia.",
    monto: "10.00",
    estado: "anulado",
  },
];

function pintar(ruta = "/") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <MisLlamados />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  delete window.matchMedia;
});

describe("Mis llamados de atención", () => {
  it("lista fecha del hecho, número, causa, nivel, descripción y monto, y atenúa el anulado", async () => {
    servicio.mios.mockResolvedValue(LLAMADOS);
    pintar();
    expect(
      await screen.findByRole("heading", { name: /mis llamados de atención/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/si tiene dudas o desea presentar sus observaciones/i),
    ).toBeInTheDocument();
    for (const columna of [
      "Fecha del hecho",
      "N.º",
      "Causa",
      "Nivel",
      "Descripción",
      "Monto de la sanción",
    ]) {
      expect(
        screen.getByRole("columnheader", { name: columna }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText("05/11/2026")).toBeInTheDocument();
    expect(screen.getByText("LA-0001")).toBeInTheDocument();
    expect(screen.getAllByText("Firma del rol de pagos")).toHaveLength(2);
    expect(screen.getByText("Segundo llamado (escrito)")).toBeInTheDocument();
    expect(screen.getByText("No firmó el rol.")).toBeInTheDocument();
    expect(screen.getByText(/10,00/)).toBeInTheDocument();
    const anulado = screen.getByText(/anulado: no cuenta/i);
    expect(anulado).toHaveClass("mz-faint");
    expect(anulado.closest("tr")).not.toHaveClass("mz-faint");
    // No hay forma de editar ni se muestra quién lo solicitó.
    expect(screen.queryByText("Jefe Secreto")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("en un celular se muestra en tarjetas, no en tabla", async () => {
    window.matchMedia = (consulta) => ({
      matches: consulta.includes("575"),
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
    servicio.mios.mockResolvedValue(LLAMADOS);
    pintar();
    const lista = await screen.findByRole("list", {
      name: /mis llamados de atención/i,
    });
    expect(lista.querySelectorAll("li")).toHaveLength(2);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/anulado: no cuenta/i)).toBeInTheDocument();
  });

  it("sin llamados no muestra la sección", async () => {
    servicio.mios.mockResolvedValue([]);
    const { container } = pintar();
    await waitFor(() => expect(servicio.mios).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("si el servidor no ofrece la función (403), tampoco se muestra", async () => {
    servicio.mios.mockRejectedValue({ response: { status: 403 } });
    const { container } = pintar();
    await waitFor(() => expect(servicio.mios).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("ante un fallo, lo dice y reintenta", async () => {
    servicio.mios
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce(LLAMADOS);
    pintar();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no se pudieron cargar/i,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("No firmó el rol.")).toBeInTheDocument();
  });

  it("?seccion=llamados desplaza y enfoca el título de la sección", async () => {
    servicio.mios.mockResolvedValue(LLAMADOS);
    const desplazar = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = desplazar;
    pintar("/?seccion=llamados");
    const titulo = await screen.findByRole("heading", {
      name: /mis llamados de atención/i,
    });
    await waitFor(() => expect(titulo).toHaveFocus());
    expect(desplazar).toHaveBeenCalled();
    delete window.HTMLElement.prototype.scrollIntoView;
  });

  it("sin el parámetro no roba el foco", async () => {
    servicio.mios.mockResolvedValue(LLAMADOS);
    pintar();
    const titulo = await screen.findByRole("heading", {
      name: /mis llamados de atención/i,
    });
    expect(titulo).not.toHaveFocus();
  });
});
