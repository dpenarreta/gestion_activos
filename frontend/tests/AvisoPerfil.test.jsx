import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El perfil obligatorio al entrar (20/10/2026).
 *
 * Si a la persona le falta cualquiera de nombres, apellidos, correo
 * institucional, teléfono, área, agencia o cargo, el sistema queda bloqueado
 * con una ventana que no se cierra: informa qué falta, dice que es
 * obligatorio y solo se sale completándolo (o cerrando la sesión). Vuelve en
 * cada carga mientras falte algo.
 */

const misDatos = { obtener: vi.fn(), guardar: vi.fn() };
vi.mock("../src/api/misDatosService", () => ({ misDatosService: misDatos }));
const logout = vi.fn();
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 7 }, logout }),
}));

const { AvisoPerfil } =
  await import("../src/components/admin/AvisoPerfil/AvisoPerfil");

const COMPLETOS = {
  nombre: "Carla Ordóñez",
  nombres: "Carla",
  apellidos: "Ordóñez",
  correo: "carla@grupolaar.com",
  correo_institucional: true,
  telefono: "0994182273",
  area: { id: 2, nombre: "Cobranzas" },
  agencia: { id: 1, nombre: "Loja · Agencia" },
  cargo: { id: 5, nombre: "Analista · Cobranzas" },
  areas: [{ id: 2, nombre: "Cobranzas" }],
  agencias: [{ id: 1, nombre: "Loja · Agencia" }],
  cargos: [{ id: 5, nombre: "Analista · Cobranzas" }],
  faltan: [],
};
const INCOMPLETOS = {
  ...COMPLETOS,
  telefono: "",
  agencia: null,
  cargo: null,
  faltan: ["agencia", "cargo"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

async function ventana() {
  return screen.findByRole("dialog", {
    name: "Complete su información para continuar",
  });
}

describe("Perfil obligatorio al entrar", () => {
  it("con todo completo no bloquea", async () => {
    misDatos.obtener.mockResolvedValue(COMPLETOS);
    render(<AvisoPerfil />);
    await waitFor(() => expect(misDatos.obtener).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("informa qué falta, que es obligatorio, y al completarlo deja continuar", async () => {
    misDatos.obtener.mockResolvedValue(INCOMPLETOS);
    misDatos.guardar.mockResolvedValue(COMPLETOS);
    render(<AvisoPerfil />);
    const dialogo = await ventana();
    expect(within(dialogo).getByText(/Es obligatorio/)).toBeInTheDocument();

    // Los siete datos, cada uno con si falta o está completo.
    const lista = within(dialogo).getByRole("list", {
      name: "Datos obligatorios",
    });
    const estados = within(lista)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(estados).toEqual([
      "Nombres: completo",
      "Apellidos: completo",
      "Correo institucional: completo",
      "Área: completo",
      "Agencia: falta",
      "Cargo: falta",
    ]);
    expect(within(dialogo).getByLabelText("Cargo")).toBeRequired();

    fireEvent.change(within(dialogo).getByLabelText(/^Teléfono/), {
      target: { value: "0994182273" },
    });
    fireEvent.click(within(dialogo).getByLabelText(/Autorizo a la empresa/));
    fireEvent.change(within(dialogo).getByLabelText("Agencia"), {
      target: { value: "1" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Cargo"), {
      target: { value: "5" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Guardar y continuar" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(misDatos.guardar).toHaveBeenCalledWith(
      expect.objectContaining({
        telefono: "0994182273",
        acepta_telefono: true,
        agencia: "1",
        cargo: "5",
      }),
    );
  });

  it("el teléfono es opcional: sin él se continúa, y si se escribe pide la autorización", async () => {
    misDatos.obtener.mockResolvedValue({
      ...INCOMPLETOS,
      telefono_autorizacion: {
        texto:
          "Autorizo a la empresa a guardar mi número de teléfono de contacto, sea personal o empresarial, y a que otras personas de la empresa lo usen para contactarme.",
        aceptado: false,
        aceptado_en: null,
      },
    });
    render(<AvisoPerfil />);
    const dialogo = await ventana();
    const telefono = within(dialogo).getByLabelText(/^Teléfono/);
    expect(telefono).not.toBeRequired();
    expect(telefono).toBeEnabled();
    expect(
      within(dialogo).getByText(/es opcional, no es obligatorio/),
    ).toBeInTheDocument();
    // Sin teléfono no se pide autorización.
    expect(
      within(dialogo).queryByLabelText(/personal o empresarial/),
    ).toBeNull();
    fireEvent.change(telefono, { target: { value: "0994182273" } });
    const autorizo = within(dialogo).getByLabelText(/personal o empresarial/);
    expect(autorizo).toBeRequired();
    expect(autorizo).not.toBeChecked();
    // Si lo borra, la autorización deja de pedirse.
    fireEvent.change(telefono, { target: { value: "" } });
    expect(
      within(dialogo).queryByLabelText(/personal o empresarial/),
    ).toBeNull();
  });

  it("si ya autorizó, lo dice con la fecha", async () => {
    misDatos.obtener.mockResolvedValue({
      ...INCOMPLETOS,
      telefono: "0994182273",
      telefono_autorizacion: {
        texto: "Autorizo a la empresa a guardar mi número de teléfono.",
        aceptado: true,
        aceptado_en: "2026-10-23T15:30:00Z",
      },
    });
    render(<AvisoPerfil />);
    const dialogo = await ventana();
    expect(
      within(dialogo).getByLabelText(/Autorizo a la empresa/),
    ).toBeChecked();
    expect(within(dialogo).getByText(/Autorizado el/)).toBeInTheDocument();
  });

  it("el cargo se elige una sola vez: al elegirlo se advierte, y si ya tiene uno no se cambia", async () => {
    misDatos.obtener.mockResolvedValue(INCOMPLETOS);
    const { unmount } = render(<AvisoPerfil />);
    let dialogo = await ventana();
    const cargo = within(dialogo).getByLabelText("Cargo");
    expect(cargo).not.toHaveAccessibleDescription(/no podrá cambiarlo/);
    fireEvent.change(cargo, {
      target: { value: "5" },
    });
    // La advertencia es la descripción del campo, no una alerta (auditoría
    // UX/UI, fase 2, 28/10/2026).
    expect(cargo).toHaveAccessibleDescription(
      /no podrá cambiarlo usted: solo TI o la administración/,
    );
    expect(within(dialogo).queryByRole("alert")).toBeNull();
    unmount();

    // Con cargo ya elegido, el campo queda fijo y dice quién lo cambia.
    misDatos.obtener.mockResolvedValue({
      ...COMPLETOS,
      telefono: "",
      agencia: null,
      faltan: ["agencia"],
    });
    render(<AvisoPerfil />);
    dialogo = await ventana();
    expect(within(dialogo).getByLabelText("Cargo")).toBeDisabled();
    expect(
      within(dialogo).getByText(/solo lo cambia TI o la administración/),
    ).toBeInTheDocument();
  });

  it("no se cierra: ni con Escape, ni con clic fuera, ni hay «Completar después»", async () => {
    misDatos.obtener.mockResolvedValue(INCOMPLETOS);
    render(<AvisoPerfil />);
    const dialogo = await ventana();
    expect(
      within(dialogo).queryByRole("button", { name: /Cerrar$|después/ }),
    ).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(dialogo, { key: "Escape" });
    fireEvent.click(dialogo.parentElement);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("si guarda y aún falta algo, sigue bloqueado", async () => {
    misDatos.obtener.mockResolvedValue(INCOMPLETOS);
    misDatos.guardar.mockResolvedValue({
      ...COMPLETOS,
      correo: "carla@gmail.com",
      correo_institucional: false,
      faltan: ["correo"],
    });
    render(<AvisoPerfil />);
    const dialogo = await ventana();
    fireEvent.change(within(dialogo).getByLabelText(/^Teléfono/), {
      target: { value: "0994182273" },
    });
    fireEvent.click(within(dialogo).getByLabelText(/Autorizo a la empresa/));
    fireEvent.change(within(dialogo).getByLabelText("Agencia"), {
      target: { value: "1" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Cargo"), {
      target: { value: "5" },
    });
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Guardar y continuar" }),
    );
    // El correo no lo cambia la persona: se le dice quién lo corrige.
    expect(
      await screen.findByText(/No es un correo institucional/),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("vuelve en cada carga mientras falte algo, y se puede cerrar sesión", async () => {
    misDatos.obtener.mockResolvedValue(INCOMPLETOS);
    const { unmount } = render(<AvisoPerfil />);
    await ventana();
    unmount();
    render(<AvisoPerfil />);
    const dialogo = await ventana();
    expect(misDatos.obtener).toHaveBeenCalledTimes(2);
    fireEvent.click(
      within(dialogo).getByRole("button", { name: /Cerrar sesión/ }),
    );
    expect(logout).toHaveBeenCalled();
  });
});
