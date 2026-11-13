import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * La tarjeta «Mientras no está» de la ficha del usuario (US-018): quién
 * aprueba por la persona mientras está ausente, con el permiso
 * `usuarios.reemplazo`. El servicio va simulado.
 */

const servicio = { reemplazo: vi.fn(), guardarReemplazo: vi.fn() };
vi.mock("../src/api/adminUsersService", () => ({
  adminUsersService: servicio,
}));
vi.mock("../src/api/chatService", () => ({
  chatService: {
    directorio: () =>
      Promise.resolve([
        { id: 7, nombre: "Tatiana Ruiz", cargo: "Talento Humano" },
      ]),
  },
}));

const { ReemplazoDeLaCuenta } =
  await import("../src/pages/Admin/Users/ReemplazoDeLaCuenta");

const BASE = {
  modo: "jefe",
  persona: null,
  jefe: { id: 3, nombre: "Gerardo Pérez" },
  ausencia: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  servicio.reemplazo.mockResolvedValue(BASE);
});

describe("Mientras no está", () => {
  it("muestra lo configurado en tercera persona y si hoy está ausente", async () => {
    servicio.reemplazo.mockResolvedValue({
      ...BASE,
      ausencia: {
        clave: "vacaciones",
        texto: "De vacaciones hasta el 20/11",
        hasta: "2026-11-20",
      },
    });
    render(<ReemplazoDeLaCuenta usuarioId={10} puedeEditar />);
    expect(
      await screen.findByText("¿Quién aprueba por esta persona?"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Su jefe inmediato (Gerardo Pérez)"),
    ).toBeChecked();
    expect(
      screen.getByText("De vacaciones hasta el 20/11"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/usted/i)).toBeNull();
    expect(servicio.reemplazo).toHaveBeenCalledWith(10);
  });

  it("sin el permiso, solo para leer", async () => {
    render(<ReemplazoDeLaCuenta usuarioId={10} puedeEditar={false} />);
    const jefe = await screen.findByLabelText(
      "Su jefe inmediato (Gerardo Pérez)",
    );
    expect(jefe).toBeDisabled();
    expect(screen.getByLabelText("Otra persona")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /guardar/i })).toBeNull();
    expect(screen.getByText(/solo puede verlo/i)).toBeInTheDocument();
  });

  it("con «Otra persona» pide elegirla antes de guardar", async () => {
    render(<ReemplazoDeLaCuenta usuarioId={10} puedeEditar />);
    fireEvent.click(await screen.findByLabelText("Otra persona"));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Guardar quién aprueba" }),
      );
    });
    expect(servicio.guardarReemplazo).not.toHaveBeenCalled();
    expect(
      screen.getByText("No se pudo guardar quién aprueba por esta persona."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Elija a la persona que aprobará por ella.").length,
    ).toBeGreaterThan(0);
  });

  it("vuelve al jefe inmediato y lo guarda", async () => {
    servicio.reemplazo.mockResolvedValue({
      ...BASE,
      modo: "persona",
      persona: { id: 7, nombre: "Tatiana Ruiz" },
    });
    servicio.guardarReemplazo.mockResolvedValue(BASE);
    render(<ReemplazoDeLaCuenta usuarioId={10} puedeEditar />);
    fireEvent.click(
      await screen.findByLabelText("Su jefe inmediato (Gerardo Pérez)"),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Guardar quién aprueba" }),
      );
    });
    expect(servicio.guardarReemplazo).toHaveBeenCalledWith(10, {
      modo: "jefe",
    });
    expect(
      await screen.findByText(
        "Quedó guardado. La persona recibió un aviso en la campana.",
      ),
    ).toBeInTheDocument();
  });

  it("un error del servidor se dice en la tarjeta", async () => {
    servicio.reemplazo.mockResolvedValue({
      ...BASE,
      modo: "persona",
      persona: { id: 7, nombre: "Tatiana Ruiz" },
    });
    servicio.guardarReemplazo.mockRejectedValue({
      response: {
        status: 403,
        data: {
          error: {
            message:
              "Solo un superusuario configura esto para otro superusuario.",
          },
        },
      },
    });
    render(<ReemplazoDeLaCuenta usuarioId={10} puedeEditar />);
    fireEvent.click(
      await screen.findByLabelText("Su jefe inmediato (Gerardo Pérez)"),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Guardar quién aprueba" }),
      );
    });
    expect(
      await screen.findByText(/solo un superusuario configura esto/i),
    ).toBeInTheDocument();
  });
});
