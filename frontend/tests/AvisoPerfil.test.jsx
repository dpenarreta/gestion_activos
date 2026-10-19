import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El aviso de «Complete su información».
 *
 * Sale al iniciar sesión si al perfil le faltan datos (los que la Mesa de
 * ayuda carga en cada ticket), para que se llenen desde el principio. Si la
 * persona lo cierra, no vuelve a salir hasta su próximo inicio de sesión: los
 * cambios después se hacen en «Mi perfil».
 */

const misDatos = { obtener: vi.fn(), guardar: vi.fn() };
vi.mock("../src/api/misDatosService", () => ({ misDatosService: misDatos }));
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 7 } }),
}));

const { AvisoPerfil } =
  await import("../src/components/admin/AvisoPerfil/AvisoPerfil");

const COMPLETOS = {
  nombre: "Carla Ordóñez",
  nombres: "Carla",
  apellidos: "Ordóñez",
  correo: "carla@grupolaar.com",
  telefono: "0994182273",
  area: { id: 2, nombre: "Cobranzas" },
  agencia: { id: 1, nombre: "Loja · Agencia" },
  areas: [{ id: 2, nombre: "Cobranzas" }],
  agencias: [{ id: 1, nombre: "Loja · Agencia" }],
  faltan: [],
};
const INCOMPLETOS = {
  ...COMPLETOS,
  telefono: "",
  agencia: null,
  faltan: ["telefono", "agencia"],
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("Aviso de perfil incompleto", () => {
  it("con todo completo no aparece", async () => {
    misDatos.obtener.mockResolvedValue(COMPLETOS);
    render(<AvisoPerfil />);
    await waitFor(() => expect(misDatos.obtener).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("si faltan datos los pide y al guardarlos se cierra", async () => {
    misDatos.obtener.mockResolvedValue(INCOMPLETOS);
    misDatos.guardar.mockResolvedValue(COMPLETOS);
    render(<AvisoPerfil />);

    expect(
      await screen.findByRole("dialog", { name: "Complete su información" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/teléfono y agencia/)).toBeInTheDocument();
    // Área, agencia y cargo en la misma línea; el cargo, mientras el
    // catálogo esté vacío, no tiene qué elegir y no es obligatorio.
    const cargo = screen.getByLabelText("Cargo");
    expect(cargo).not.toBeRequired();
    expect(cargo).toHaveDisplayValue("Sin cargos disponibles");
    expect(cargo.closest(".col-md-4")).not.toBeNull();
    expect(screen.getByLabelText("Área").closest(".col-md-4")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Teléfono"), {
      target: { value: "0994182273" },
    });
    fireEvent.change(screen.getByLabelText("Agencia"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(misDatos.guardar).toHaveBeenCalledWith(
      expect.objectContaining({ telefono: "0994182273", agencia: "1" }),
    );
  });

  it("«Completar después» lo cierra y no vuelve en la misma sesión", async () => {
    misDatos.obtener.mockResolvedValue(INCOMPLETOS);
    const { unmount } = render(<AvisoPerfil />);

    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Completar después" }))[0],
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    // Otra pantalla del panel, misma sesión: ni siquiera se consulta.
    render(<AvisoPerfil />);
    expect(misDatos.obtener).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
