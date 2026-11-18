import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* Los roles de Configuración desde Asignación de cargos (18/11/2026: un
   cargo y un rol son lo mismo y se dan desde los dos lados). */

const servicio = { cambiarRol: vi.fn() };
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: servicio,
}));

const { RolesDePersona } =
  await import("../src/pages/Institucional/RolesDePersona");

const CATALOGO = [
  { id: 1, nombre: "Auditor" },
  { id: 2, nombre: "Brigada de emergencia" },
];

beforeEach(() => vi.clearAllMocks());

describe("Otros roles de una persona", () => {
  it("añade un rol con el botón (no al mover el desplegable) y lo quita", async () => {
    const onCambio = vi.fn();
    servicio.cambiarRol.mockResolvedValueOnce({
      usuario: 7,
      roles: [{ id: 2, nombre: "Brigada de emergencia" }],
    });
    render(
      <RolesDePersona
        persona={{ id: 7, nombre: "Rosa Vera", roles: [] }}
        catalogo={CATALOGO}
        onCambio={onCambio}
      />,
    );
    expect(screen.getByText("Solo el de su cargo")).toBeInTheDocument();

    const desplegable = screen.getByRole("combobox", {
      name: "Rol para añadir a Rosa Vera",
    });
    fireEvent.change(desplegable, { target: { value: "2" } });
    // Elegir no basta: hace falta «Añadir».
    expect(servicio.cambiarRol).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));
    await waitFor(() =>
      expect(servicio.cambiarRol).toHaveBeenCalledWith(7, 2, "dar"),
    );
    expect(
      await screen.findByRole("list", { name: "Roles de Rosa Vera" }),
    ).toHaveTextContent("Brigada de emergencia");
    expect(onCambio).toHaveBeenCalledWith(
      "Rosa Vera ahora tiene el rol «Brigada de emergencia».",
    );

    servicio.cambiarRol.mockResolvedValueOnce({ usuario: 7, roles: [] });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Quitar el rol Brigada de emergencia a Rosa Vera",
      }),
    );
    await waitFor(() =>
      expect(servicio.cambiarRol).toHaveBeenLastCalledWith(7, 2, "quitar"),
    );
    expect(await screen.findByText("Solo el de su cargo")).toBeInTheDocument();
  });

  it("si el servidor lo niega, avisa del error", async () => {
    const onError = vi.fn();
    servicio.cambiarRol.mockRejectedValueOnce({
      response: { status: 403, data: { detail: "No puede dar el rol." } },
    });
    render(
      <RolesDePersona
        persona={{ id: 7, nombre: "Rosa Vera", roles: [] }}
        catalogo={CATALOGO}
        onError={onError}
      />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Rol para añadir a Rosa Vera" }),
      { target: { value: "1" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
