import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlertasPage } from "../src/pages/Admin/Alertas/AlertasPage";

const CONFIGURACION = {
  dias_sin_asignar: 90,
  dias_reparacion_pendiente: 15,
  dias_sin_actualizacion: 365,
  avisar_proximos_a_reemplazo: true,
  avisar_garantias_por_vencer: true,
  avisar_demasiadas_reparaciones: true,
  avisar_sin_asignar: true,
  avisar_reparaciones_pendientes: true,
  avisar_custodios_inactivos: true,
  avisar_sin_actualizacion: true,
  notificaciones_activas: false,
  frecuencia: "diaria",
  dia_envio_semanal: 0,
  omitir_si_no_hay_pendientes: true,
  destinatarios: [],
  ultimo_envio: null,
};

const RESUMEN = {
  total_alertas: 0,
  total_elementos: 0,
  por_severidad: { alta: 0, media: 0, baja: 0 },
  alertas: [],
  configuracion: CONFIGURACION,
};

const DESTINATARIOS = [
  {
    id: 7,
    username: "jefe_ti",
    nombre: "Ana Jefa",
    correo: "a****@empresa.com",
  },
];

const ENVIOS = [
  {
    id: 3,
    resultado: "omitido",
    resultado_display: "Omitido",
    origen: "programado",
    origen_display: "Programado",
    motivo: "No hay alertas pendientes y está configurado omitir esos días.",
    total_alertas: 0,
    total_elementos: 0,
    total_destinatarios: 0,
    created_at: "2026-09-09T08:00:00Z",
  },
];

vi.mock("../src/api/alertasService", () => ({
  alertasService: {
    resumen: vi.fn(() => Promise.resolve(RESUMEN)),
    configuracion: vi.fn(() => Promise.resolve(CONFIGURACION)),
    guardarConfiguracion: vi.fn(() => Promise.resolve(CONFIGURACION)),
    destinatariosDisponibles: vi.fn(() => Promise.resolve(DESTINATARIOS)),
    historialEnvios: vi.fn(() => Promise.resolve(ENVIOS)),
    enviarPrueba: vi.fn(() =>
      Promise.resolve({
        detail: "Se envió el resumen de prueba a admin@empresa.com.",
      }),
    ),
  },
}));

vi.mock("../src/hooks/usePermission", () => ({
  usePermission: () => true,
}));

const { alertasService } = await import("../src/api/alertasService");

async function abrirConfiguracion() {
  render(
    <MemoryRouter>
      <AlertasPage />
    </MemoryRouter>,
  );
  const boton = await screen.findByRole("button", {
    name: "Configurar alertas",
  });
  fireEvent.click(boton);
}

describe("Notificaciones por correo del centro de alertas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ofrece como destinatarios solo a quienes pueden ver las alertas", async () => {
    await abrirConfiguracion();

    expect(await screen.findByText("Ana Jefa")).toBeInTheDocument();
    // La dirección llega enmascarada: sirve para reconocer a la persona, no
    // para tener el directorio de correos del personal.
    expect(screen.getByText("a****@empresa.com")).toBeInTheDocument();
  });

  it("pregunta el día solo cuando el envío es semanal", async () => {
    await abrirConfiguracion();
    await screen.findByText("Ana Jefa");

    expect(screen.queryByLabelText("Día del envío")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Frecuencia"), {
      target: { value: "semanal" },
    });
    expect(screen.getByLabelText("Día del envío")).toBeInTheDocument();
  });

  it("envía la prueba al correo de quien la pide y muestra el resultado", async () => {
    await abrirConfiguracion();
    await screen.findByText("Ana Jefa");

    fireEvent.click(
      screen.getByRole("button", { name: "Enviar una prueba a mi correo" }),
    );

    await waitFor(() =>
      expect(alertasService.enviarPrueba).toHaveBeenCalledTimes(1),
    );
    expect(
      await screen.findByText(
        "Se envió el resumen de prueba a admin@empresa.com.",
      ),
    ).toBeInTheDocument();
  });

  it("muestra por qué no se envió un resumen, no solo los que salieron", async () => {
    await abrirConfiguracion();
    await screen.findByText("Ana Jefa");

    // Un envío omitido y uno fallido se ven igual desde fuera —nadie recibió
    // nada— y solo el motivo los distingue.
    expect(screen.getByText("Últimos envíos")).toBeInTheDocument();
    expect(screen.getByText(/omitir esos días/)).toBeInTheDocument();
  });
});
