import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * «Nómina» en Configuración › Usuarios (US-021): la última sincronización,
 * «Sincronizar ahora» y el reporte. El servicio va simulado.
 */

const servicio = { estado: vi.fn(), sincronizar: vi.fn() };
vi.mock("../src/api/sincronizacionNominaService", () => ({
  sincronizacionNominaService: servicio,
}));

const { SincronizacionNomina } =
  await import("../src/pages/Admin/Users/SincronizacionNomina");

const ULTIMA = {
  id: 3,
  iniciada_en: "2026-11-16T07:00:00Z",
  automatica: true,
  actor: null,
  estado: "ok",
  estado_display: "Completa",
  empleados: 744,
  creadas: 743,
  actualizadas: 1,
  sin_cambios: 0,
  conflictos_total: 1,
  fuera_de_nomina_total: 1,
  error: "",
  conflictos: [
    {
      codigo: "20100009",
      nombre: "Ruiz Ana",
      motivo: "El código 20100009 ya lo tiene otra cuenta.",
    },
  ],
  fuera_de_nomina: [{ id: 5, usuario: "cargauio1", nombre: "Carga Uio" }],
};

const pintar = () =>
  render(
    <MemoryRouter>
      <SincronizacionNomina />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  servicio.estado.mockResolvedValue({
    configurada: true,
    corriendo: false,
    ultima: ULTIMA,
    anteriores: [],
    inactivas_desde_nomina: 743,
  });
});

describe("Sincronización con nómina", () => {
  it("muestra la última corrida con sus cifras y el detalle", async () => {
    pintar();
    expect(await screen.findByText(/automática/)).toBeInTheDocument();
    expect(screen.getByText("744")).toBeInTheDocument();
    expect(screen.getByText("inactivas por activar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ver el detalle/ }));
    expect(screen.getByText(/ya lo tiene otra cuenta/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Carga Uio" })).toHaveAttribute(
      "href",
      "/admin/users/5",
    );
  });

  it("«Sincronizar ahora» corre y dice el resultado", async () => {
    servicio.sincronizar.mockResolvedValue({
      ...ULTIMA,
      creadas: 2,
      actualizadas: 3,
      sin_cambios: 739,
    });
    pintar();
    const boton = await screen.findByRole("button", {
      name: "Sincronizar ahora",
    });
    await act(async () => {
      fireEvent.click(boton);
    });
    expect(servicio.sincronizar).toHaveBeenCalled();
    expect(
      await screen.findByText(
        "Listo: 2 cuentas creadas, 3 actualizadas y 739 sin cambios.",
      ),
    ).toBeInTheDocument();
  });

  it("sin configurar, lo dice y no deja sincronizar", async () => {
    servicio.estado.mockResolvedValue({
      configurada: false,
      corriendo: false,
      ultima: null,
      anteriores: [],
      inactivas_desde_nomina: 0,
    });
    pintar();
    expect(
      await screen.findByText(/no está configurada en este servidor/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sincronizar ahora" }),
    ).toBeDisabled();
  });
});
