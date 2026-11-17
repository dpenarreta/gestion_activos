import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Tras confirmar Mi perfil, el área y la agencia las corrige en la ficha del
 * usuario quien tenga `usuarios.corregir_perfil` (17/11/2026).
 */

const perfil = vi.fn();
const corregirPerfil = vi.fn();
vi.mock("../src/api/adminUsersService", () => ({
  adminUsersService: { perfil, corregirPerfil },
}));

const { PerfilDeLaCuenta } =
  await import("../src/pages/Admin/Users/PerfilDeLaCuenta");

const DATOS = {
  area: { id: 1, nombre: "Comercial" },
  agencia: { id: 10, nombre: "Matriz Quito" },
  confirmado: true,
  areas: [
    { id: 1, nombre: "Comercial" },
    { id: 2, nombre: "Cartera" },
  ],
  agencias: [
    { id: 10, nombre: "Matriz Quito" },
    { id: 11, nombre: "Guayaquil" },
  ],
};

beforeEach(() => {
  perfil.mockReset();
  corregirPerfil.mockReset();
});

describe("Datos de Mi perfil en la ficha", () => {
  it("corrige la agencia de una persona que ya confirmó", async () => {
    perfil.mockResolvedValue(DATOS);
    corregirPerfil.mockResolvedValue({
      ...DATOS,
      agencia: { id: 11, nombre: "Guayaquil" },
    });
    render(<PerfilDeLaCuenta usuarioId={7} />);
    expect(
      await screen.findByText(/ya confirmó su perfil/),
    ).toBeInTheDocument();
    const boton = screen.getByRole("button", { name: "Corregir datos" });
    expect(boton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Agencia"), {
      target: { value: "11" },
    });
    fireEvent.click(boton);
    await waitFor(() =>
      expect(corregirPerfil).toHaveBeenCalledWith(7, { area: 1, agencia: 11 }),
    );
    expect(await screen.findByText(/Datos corregidos/)).toBeInTheDocument();
  });
});
