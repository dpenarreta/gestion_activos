import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El contacto desde el buscador del chat (26/10/2026): cada persona tiene un
 * botón para ver su correo institucional y, si lo autorizó, su teléfono; lo
 * que no tiene no se muestra, y cada dato se copia con un botón.
 */

const servicio = {
  directorio: vi.fn(),
  contacto: vi.fn(),
  presencia: vi.fn(),
};
vi.mock("../src/api/chatService", () => ({ chatService: servicio }));
const iniciarDirecta = vi.fn();
vi.mock("../src/components/admin/Chat/ChatContext", () => ({
  useChat: () => ({ iniciarDirecta }),
}));
const copiarTexto = vi.fn();
vi.mock("../src/utils/copiar", () => ({
  copiarTexto: (...args) => copiarTexto(...args),
}));

const { Directorio } = await import("../src/components/admin/Chat/Panel");

const BETO = {
  id: 4,
  nombre: "Beto Ruiz",
  correo: "beto@grupolaar.com",
  area: "TI",
};

beforeEach(() => {
  vi.clearAllMocks();
  servicio.directorio.mockResolvedValue([BETO]);
  servicio.presencia.mockResolvedValue({});
  copiarTexto.mockResolvedValue(true);
});

async function abrirContacto() {
  render(<Directorio />);
  fireEvent.change(screen.getByLabelText("Buscar personas"), {
    target: { value: "beto" },
  });
  const boton = await screen.findByRole("button", {
    name: "Ver contacto de Beto Ruiz",
  });
  fireEvent.click(boton);
  return screen.findByRole("region", { name: "Contacto de Beto Ruiz" });
}

describe("El contacto de una persona en el chat", () => {
  it("muestra el correo institucional y el teléfono, y los copia", async () => {
    servicio.contacto.mockResolvedValue({
      id: 4,
      nombre: "Beto Ruiz",
      correo: "beto@grupolaar.com",
      telefono: "0991112222",
      cargo: "Analista",
      area: "TI",
    });
    const tarjeta = await abrirContacto();
    expect(servicio.contacto).toHaveBeenCalledWith(4);
    expect(
      await within(tarjeta).findByText("beto@grupolaar.com"),
    ).toBeInTheDocument();
    expect(
      within(tarjeta).getByText("Correo institucional"),
    ).toBeInTheDocument();
    expect(within(tarjeta).getByText("0991112222")).toBeInTheDocument();

    fireEvent.click(
      within(tarjeta).getByRole("button", {
        name: "Copiar correo institucional",
      }),
    );
    await waitFor(() =>
      expect(copiarTexto).toHaveBeenCalledWith("beto@grupolaar.com"),
    );
    expect(await within(tarjeta).findByText("Copiado")).toBeInTheDocument();

    fireEvent.click(
      within(tarjeta).getByRole("button", { name: "Copiar teléfono" }),
    );
    await waitFor(() => expect(copiarTexto).toHaveBeenCalledWith("0991112222"));
    // Ver el contacto no abre el chat.
    expect(iniciarDirecta).not.toHaveBeenCalled();
  });

  it("sin teléfono autorizado no aparece su etiqueta", async () => {
    servicio.contacto.mockResolvedValue({
      id: 4,
      nombre: "Beto Ruiz",
      correo: "beto@grupolaar.com",
      telefono: "",
      cargo: "",
      area: "",
    });
    const tarjeta = await abrirContacto();
    await within(tarjeta).findByText("beto@grupolaar.com");
    expect(within(tarjeta).queryByText("Teléfono")).toBeNull();
  });

  it("sin ningún dato lo dice", async () => {
    servicio.contacto.mockResolvedValue({
      id: 4,
      nombre: "Beto Ruiz",
      correo: "",
      telefono: "",
      cargo: "",
      area: "",
    });
    const tarjeta = await abrirContacto();
    expect(
      await within(tarjeta).findByText(
        "No tiene datos de contacto para mostrar.",
      ),
    ).toBeInTheDocument();
    expect(within(tarjeta).queryByText("Correo institucional")).toBeNull();
  });

  it("si no se puede copiar, pide seleccionarlo a mano", async () => {
    copiarTexto.mockResolvedValue(false);
    servicio.contacto.mockResolvedValue({
      id: 4,
      nombre: "Beto Ruiz",
      correo: "beto@grupolaar.com",
      telefono: "",
      cargo: "",
      area: "",
    });
    const tarjeta = await abrirContacto();
    await within(tarjeta).findByText("beto@grupolaar.com");
    fireEvent.click(
      within(tarjeta).getByRole("button", {
        name: "Copiar correo institucional",
      }),
    );
    expect(
      await within(tarjeta).findByText(/selecciónelo y cópielo/),
    ).toBeInTheDocument();
  });
});
