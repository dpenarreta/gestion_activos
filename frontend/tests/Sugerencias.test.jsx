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
 * Sugerencias y errores: reportar (un error pide su impacto), seguir lo suyo
 * y, con permiso, ver todos y cambiar su estado.
 */

const servicio = {
  opciones: vi.fn(),
  listar: vi.fn(),
  detalle: vi.fn(),
  reportar: vi.fn(),
  comentar: vi.fn(),
  cambiarEstado: vi.fn(),
  captura: vi.fn(),
};
vi.mock("../src/api/sugerenciasService", () => ({
  sugerenciasService: servicio,
}));

const { SugerenciasPage } =
  await import("../src/pages/Institucional/SugerenciasPage");

const OPCIONES = {
  modulos: [
    { id: "institucional", nombre: "Institucional" },
    { id: "chat", nombre: "Chat" },
  ],
  impactos: [
    { id: "bajo", nombre: "Bajo" },
    { id: "alto", nombre: "Alto: no deja trabajar" },
  ],
  estados: [
    { id: "nuevo", nombre: "Nuevo" },
    { id: "en_revision", nombre: "En revisión" },
    { id: "resuelto", nombre: "Resuelto" },
  ],
  gestiona: false,
};
const REPORTE = {
  id: 7,
  tipo: "error",
  tipo_display: "Error del sistema",
  titulo: "No carga el organigrama",
  modulo: "institucional",
  modulo_display: "Institucional",
  impacto: "alto",
  impacto_display: "Alto: no deja trabajar",
  estado: "nuevo",
  estado_display: "Nuevo",
  autor: { id: 1, nombre: "Rosa Vera" },
  tiene_captura: false,
  created_at: "2026-10-20T15:00:00Z",
  descripcion: "Se queda cargando.",
  comentarios: [],
};

function pintar(ruta = "/") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <SugerenciasPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  servicio.opciones.mockResolvedValue(OPCIONES);
  servicio.listar.mockResolvedValue([REPORTE]);
  servicio.detalle.mockResolvedValue(REPORTE);
});

describe("Sugerencias y errores", () => {
  it("sin permiso abre directo el formulario y no ve reportes", async () => {
    servicio.reportar.mockResolvedValue({ id: 8, titulo: "x", tipo: "error" });
    pintar();
    const ventana = await screen.findByRole("region", {
      name: "Nuevo reporte",
    });
    // Ni pestañas ni listado: los reportes son reservados.
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(servicio.listar).not.toHaveBeenCalled();
    expect(within(ventana).queryByLabelText("¿Cuánto le afecta?")).toBeNull();
    fireEvent.click(
      within(ventana).getByRole("radio", { name: /error del sistema/ }),
    );
    fireEvent.change(within(ventana).getByLabelText("Módulo"), {
      target: { value: "chat" },
    });
    fireEvent.change(within(ventana).getByLabelText("Título"), {
      target: { value: "No envía mensajes" },
    });
    fireEvent.change(within(ventana).getByLabelText(/Qué pasó/), {
      target: { value: "Al enviar un mensaje no aparece." },
    });
    fireEvent.change(within(ventana).getByLabelText("¿Cuánto le afecta?"), {
      target: { value: "alto" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviar reporte" }),
    );
    await waitFor(() =>
      expect(servicio.reportar).toHaveBeenCalledWith(
        {
          tipo: "error",
          modulo: "chat",
          titulo: "No envía mensajes",
          descripcion: "Al enviar un mensaje no aparece.",
          impacto: "alto",
        },
        null,
      ),
    );
    expect(
      await screen.findByText(/su reporte #8 quedó registrado/),
    ).toBeInTheDocument();
    // El formulario queda en blanco para otro reporte.
    expect(screen.getByLabelText("Título")).toHaveValue("");
  });

  it("quien gestiona ve todos y cambia el estado desde el detalle", async () => {
    servicio.opciones.mockResolvedValue({ ...OPCIONES, gestiona: true });
    servicio.cambiarEstado.mockResolvedValue({
      ...REPORTE,
      estado: "resuelto",
      estado_display: "Resuelto",
    });
    pintar("/?reporte=7");
    expect(
      await screen.findByRole("tab", { name: "Mis reportes" }),
    ).toBeInTheDocument();
    // Quien gestiona no ve el formulario en la página: lo abre con su botón.
    expect(screen.queryByRole("region", { name: "Nuevo reporte" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Todos" }));
    await waitFor(() =>
      expect(servicio.listar).toHaveBeenLastCalledWith("todos", {}),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "#7 · No carga el organigrama",
    });
    fireEvent.change(within(ventana).getByLabelText("Respuesta o nota"), {
      target: { value: "Corregido." },
    });
    fireEvent.change(within(ventana).getByLabelText("Cambiar estado"), {
      target: { value: "resuelto" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Aplicar estado" }),
    );
    await waitFor(() =>
      expect(servicio.cambiarEstado).toHaveBeenCalledWith(
        7,
        "resuelto",
        "Corregido.",
      ),
    );
  });
});
